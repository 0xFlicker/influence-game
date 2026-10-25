/** Local-only backfill; uses the production HTTP worker contract and durable payload store. */
import { resolve } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createDB, closeDB, schema } from "../db/index.js";
import { createCharacterCutoutRoutes } from "../routes/character-cutouts.js";
import { CUTOUT_RECIPE, enqueueCutout, expireCutoutLeases, prepareCutoutDemands, requestCharacterCutouts, reserveCutout } from "../services/character-cutouts.js";
import { werewolfReferenceMetadata } from "../services/werewolf-production.js";

const retryFailed = process.argv.includes("--retry-failed");
const args = process.argv.slice(2).filter(arg => arg !== "--retry-failed");
if (args.length !== 2 || !["--manifest", "--game"].includes(args[0]!)) {
  throw new Error("Usage: bun run cutouts:backfill --manifest sources.json | --game GAME_ID [--retry-failed] (localhost database only)");
}
const dbUrl = process.env.DATABASE_URL ?? "postgresql://influence:influence@127.0.0.1:54320/influence_dev";
if (!["localhost", "127.0.0.1"].includes(new URL(dbUrl).hostname)) throw new Error("Backfill requires a localhost database");
if (process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT || ["production", "staging"].includes(process.env.NODE_ENV ?? "")) throw new Error("Backfill is localhost only");
process.env.CHARACTER_CUTOUT_MODE = "local";
const port = Number(process.env.CUTOUT_BACKFILL_PORT ?? 3018);
process.env.CUTOUT_API_URL = `http://host.docker.internal:${port}`;
const db = createDB(dbUrl);
const jobIds = new Set<string>();
let server: ReturnType<typeof Bun.serve> | undefined;
try {
  if (args[0] === "--manifest") {
    const entries: unknown = await Bun.file(resolve(args[1]!)).json();
    if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry.sourcePath !== "string")) throw new Error("Manifest must contain objects with sourcePath");
    for (const entry of entries as Array<{ sourcePath: string }>) {
      const job = await enqueueCutout(db, Buffer.from(await Bun.file(entry.sourcePath).arrayBuffer()));
      jobIds.add(job.id);
    }
  } else {
    const gameId = args[1]!;
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
    if (!game) throw new Error("Game not found");
    const sources: Record<string, string> = {};
    if (game.gameKind === "werewolf") {
      for (const ref of await werewolfReferenceMetadata(db, gameId)) if (ref.bodyHash) sources[ref.profile.id] = `sha256:${ref.bodyHash}`;
    } else {
      const players = await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.gameId, gameId));
      for (const player of players) {
        const profile = JSON.parse(player.persona);
        if (typeof profile.fullBodyReferenceUrl === "string") sources[player.id] = profile.fullBodyReferenceUrl;
      }
      const [assets] = await db.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId));
      for (const member of assets?.cast ?? []) if (!member.portraitFallback) sources[member.id] = `/api/games/${gameId}/visual/artifacts/${member.referenceArtifactId}`;
    }
    await requestCharacterCutouts(db, gameId, sources);
    if (retryFailed) await db.update(schema.characterCutoutDemands).set({ error: null })
      .where(and(eq(schema.characterCutoutDemands.gameId, gameId), eq(schema.characterCutoutDemands.recipe, CUTOUT_RECIPE), isNull(schema.characterCutoutDemands.cutoutId)));
    while ((await db.select().from(schema.characterCutoutDemands).where(and(eq(schema.characterCutoutDemands.gameId, gameId), isNull(schema.characterCutoutDemands.cutoutId), isNull(schema.characterCutoutDemands.error)))).length) await prepareCutoutDemands(db);
    const demands = await db.select().from(schema.characterCutoutDemands).where(and(eq(schema.characterCutoutDemands.gameId, gameId), eq(schema.characterCutoutDemands.recipe, CUTOUT_RECIPE)));
    for (const demand of demands) {
      if (demand.error) throw new Error(`Source preparation failed: ${demand.error}`);
      if (demand.cutoutId) jobIds.add(demand.cutoutId);
    }
  }
  await expireCutoutLeases(db);
  if (retryFailed && jobIds.size) await db.update(schema.characterCutouts).set({ status: "pending", attempts: 0, error: null })
    .where(and(inArray(schema.characterCutouts.id, [...jobIds]), eq(schema.characterCutouts.status, "failed")));
  const app = createCharacterCutoutRoutes(db);
  // Docker Desktop forwards host.docker.internal to this local port. Every worker
  // endpoint is protected by its one-job capability, never an operator credential.
  server = Bun.serve({ hostname: "0.0.0.0", port, fetch: app.fetch });
  for (const id of jobIds) {
    const reserved = await reserveCutout(db, id);
    if (!reserved) continue;
    console.log(JSON.stringify({ job: id, sourceHash: reserved.job.sourceHash, status: "processing" }));
    const child = Bun.spawn(["docker", "run", "--rm", "--cpus=2", "--memory=16g", "--memory-swap=16g",
      "-e", "CUTOUT_API_URL", "-e", "CUTOUT_JOB_ID", "-e", "CUTOUT_JOB_TOKEN",
      process.env.CUTOUT_DOCKER_IMAGE ?? "house-character-cutouts:local"], {
      env: { ...process.env, CUTOUT_JOB_ID: id, CUTOUT_JOB_TOKEN: reserved.token }, stdout: "inherit", stderr: "inherit",
    });
    const code = await child.exited;
    if (code !== 0) throw new Error(`Docker worker exited ${code}; job ${id} retains its lease until expiry`);
  }
  const result = jobIds.size ? await db.select({ id: schema.characterCutouts.id, sourceHash: schema.characterCutouts.sourceHash,
    status: schema.characterCutouts.status, image: schema.characterCutouts.image }).from(schema.characterCutouts).where(inArray(schema.characterCutouts.id, [...jobIds])) : [];
  console.log(JSON.stringify({ recipe: CUTOUT_RECIPE, jobs: result }, null, 2));
  if (result.some(job => job.status !== "ready")) throw new Error("Some cutouts are not ready; inspect their leases/errors before retrying");
} finally {
  server?.stop(true);
  await closeDB(dbUrl);
}
