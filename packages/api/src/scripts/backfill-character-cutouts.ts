/** Operator backfill. Production only queues; inference runs in Batch or local Docker. */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { createDB, closeDB, schema } from "../db/index.js";
import { createCharacterCutoutRoutes } from "../routes/character-cutouts.js";
import { cutoutMode, expireCutoutLeases, CUTOUT_RECIPE, prepareCutoutDemands, reserveCutout } from "../services/character-cutouts.js";
import { cutoutNeedsWork, cutoutProgress, discoverCutoutSources, enqueueCutoutSelection, inspectCutoutSources, retryCutoutFailures, selectCutoutBatch, type CutoutSelection } from "../services/character-cutout-backfill.js";

export function parseCutoutCommand(args: string[], env: Record<string, string | undefined>) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    env: { type: "string" }, agent: { type: "string" }, game: { type: "string" }, scope: { type: "string" },
    job: { type: "string" }, demand: { type: "string" }, limit: { type: "string" }, wait: { type: "string" }, "dry-run": { type: "boolean" },
  } });
  const command = positionals[0];
  if (positionals.length !== 1 || !command || !["inventory", "run", "status", "retry"].includes(command)) throw new Error("Usage: cutouts:backfill inventory|run|status|retry --env local|production (--agent ID | --game ID | --scope example-models | --job IDs | --demand IDs) [--limit 1..100] [--wait SECONDS] [--dry-run]");
  if (env.INFLUENCE_DEPLOYMENT_ENVIRONMENT === "staging" || env.NODE_ENV === "staging" || values.env === "staging") throw new Error("Staging cutouts are hard-disabled");
  if (values.env !== "local" && values.env !== "production") throw new Error("Explicit --env local|production required");
  const dbUrl = env.DATABASE_URL ?? (values.env === "local" ? "postgresql://influence:influence@127.0.0.1:54320/influence_dev" : "");
  if (!dbUrl) throw new Error("Production requires an explicit DATABASE_URL");
  if (values.env === "local") {
    if (env.INFLUENCE_DEPLOYMENT_ENVIRONMENT || env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(new URL(dbUrl).hostname)) throw new Error("Local target requires a localhost database and local environment");
  } else if (env.INFLUENCE_DEPLOYMENT_ENVIRONMENT !== "prod") throw new Error("Production requires INFLUENCE_DEPLOYMENT_ENVIRONMENT=prod");
  const selectors = [values.agent, values.game, values.scope, values.job, values.demand].filter(v => v !== undefined);
  if (selectors.length !== 1 || !selectors[0]?.trim()) throw new Error("Select exactly one agent, game, scope, job list or demand list");
  if (values.scope && values.scope !== "example-models") throw new Error("Only --scope example-models is supported");
  if (command === "retry" && !values.job && !values.demand) throw new Error("Retry requires explicitly selected --job or --demand IDs");
  if (["run", "inventory"].includes(command) && (values.job || values.demand)) throw new Error("Use status/retry for explicit job/demand IDs");
  const limit = values.limit === undefined ? 100 : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (command === "run" && values.limit === undefined)) throw new Error("Run requires --limit 1..100 source references");
  const wait = values.wait === undefined ? 0 : Number(values.wait);
  if (!Number.isInteger(wait) || wait < 0 || wait > 3600) throw new Error("Wait must be 0..3600 seconds");
  if (wait && (["inventory", "status"].includes(command) || values["dry-run"])) throw new Error("Wait is only supported for run/retry without --dry-run");
  const ids = (values.job ?? values.demand)?.split(",") ?? [];
  if (ids.length > 100 || ids.some(id => !id.trim()) || new Set(ids).size !== ids.length) throw new Error("Select 1..100 distinct IDs");
  const selection: CutoutSelection | null = values.agent ? { agent: values.agent } : values.game ? { game: values.game } : values.scope ? { scope: "example-models" } : null;
  const mutate = ["run", "retry"].includes(command) && !values["dry-run"];
  if (values.env === "production" && mutate && cutoutMode(env) !== "aws-batch") throw new Error("Production writes require configured aws-batch mode");
  return { command, environment: values.env, dbUrl, selection, ids, kind: values.job ? "job" as const : "demand" as const, limit, wait, mutate };
}

async function main() {
  const options = parseCutoutCommand(process.argv.slice(2), process.env);
  const port = Number(process.env.CUTOUT_BACKFILL_PORT ?? 3018);
  if (options.environment === "local") {
    process.env.INFLUENCE_LOCAL_UPLOAD_DIR ??= fileURLToPath(new URL("../../.local-uploads", import.meta.url));
    process.env.CHARACTER_CUTOUT_MODE = "local";
    process.env.CUTOUT_API_URL = `http://host.docker.internal:${port}`;
    cutoutMode();
  }
  const db = createDB(options.dbUrl);
  let server: ReturnType<typeof Bun.serve> | undefined;
  let interrupted = false;
  const stop = () => { interrupted = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const emit = (value: unknown) => console.log(JSON.stringify(value));
  try {
    let demandIds: string[] = [], jobIds: string[] = [];
    let selectedJobIds: string[] = [];
    let selectionIncomplete = false;
    if (options.selection) {
      const { sources, warnings } = await discoverCutoutSources(db, options.selection);
      const rows = await inspectCutoutSources(db, sources);
      const batch = selectCutoutBatch(rows, options.limit);
      const counts: Record<string, number> = {};
      for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
      emit({ environment: options.environment, recipe: CUTOUT_RECIPE, command: options.command, dryRun: !options.mutate,
        total: rows.length, counts, warnings, selected: batch.length, remaining: rows.filter(cutoutNeedsWork).length > batch.length,
        rows: options.command === "run" ? batch : rows });
      if (!options.mutate) return;
      selectionIncomplete = !("scope" in options.selection) && rows.filter(cutoutNeedsWork).length > batch.length;
      demandIds = await enqueueCutoutSelection(db, batch);
      selectedJobIds = (await cutoutProgress(db, demandIds)).jobs.map(job => job.id);
      // Include ready/active/failed selection members for single-shot completion,
      // even when they correctly required no new work.
      if (!("scope" in options.selection)) {
        const current = await inspectCutoutSources(db, sources);
        demandIds = [...new Set(current.flatMap(row => row.demandId ? [row.demandId] : []))];
        jobIds = [...new Set(current.flatMap(row => row.jobId ? [row.jobId] : []))];
        if (current.some(row => !row.demandId)) emit({ warning: "Selection exceeds --limit; repeat run to associate remaining sources" });
      }
    } else {
      demandIds = options.kind === "demand" ? options.ids : [];
      jobIds = options.kind === "job" ? options.ids : [];
      emit(await cutoutProgress(db, demandIds, jobIds));
      if (!options.mutate) return;
      await retryCutoutFailures(db, options.kind, options.ids);
      if (demandIds.length) await prepareCutoutDemands(db, demandIds);
      selectedJobIds = (await cutoutProgress(db, demandIds, jobIds)).jobs.map(job => job.id);
    }
    // Print the durable resume handles before any worker launch/wait.
    emit({ environment: options.environment, demandIds, jobIds, progress: await cutoutProgress(db, demandIds, jobIds) });
    const deadline = Date.now() + options.wait * 1000;
    if (options.environment === "local") {
      await expireCutoutLeases(db, new Date(), selectedJobIds);
      const progress = await cutoutProgress(db, [], selectedJobIds);
      for (const job of progress.jobs) {
        if (interrupted || (options.wait && Date.now() >= deadline)) break;
        if (job.status !== "pending") continue;
        server ??= Bun.serve({ hostname: "0.0.0.0", port, fetch: createCharacterCutoutRoutes(db).fetch });
        const reserved = await reserveCutout(db, job.id);
        if (!reserved) continue;
        const name = `house-cutout-${crypto.randomUUID()}`;
        emit({ jobId: job.id, status: "processing", container: name, cpus: 2, memoryGiB: 16 });
        const child = Bun.spawn(["docker", "run", "--rm", "--name", name, "--cpus=2", "--memory=16g", "--memory-swap=16g",
          "-e", "CUTOUT_API_URL", "-e", "CUTOUT_JOB_ID", "-e", "CUTOUT_JOB_TOKEN", process.env.CUTOUT_DOCKER_IMAGE ?? "house-character-cutouts:local"], {
          env: { ...process.env, CUTOUT_JOB_ID: job.id, CUTOUT_JOB_TOKEN: reserved.token }, stdout: "inherit", stderr: "inherit",
        });
        let done = false;
        const exited = child.exited.then(code => { done = true; return code; });
        while (!done && !interrupted && (!options.wait || Date.now() < deadline)) await Bun.sleep(250);
        if (!done) {
          await Bun.spawn(["docker", "stop", "--time", "2", name], { stdout: "ignore", stderr: "inherit" }).exited;
          child.kill();
        }
        const code = await exited;
        if (code !== 0) {
          const error = `Docker exited ${code}; lease retained until expiry`;
          await db.update(schema.characterCutouts).set({ error }).where(and(eq(schema.characterCutouts.id, job.id), eq(schema.characterCutouts.tokenHash, reserved.job.tokenHash!)));
          emit({ jobId: job.id, error }); break;
        }
      }
    }
    let progress = await cutoutProgress(db, demandIds, jobIds);
    while (!progress.complete && !progress.failed && !interrupted && Date.now() < deadline) {
      await Bun.sleep(Math.min(2000, Math.max(0, deadline - Date.now())));
      progress = await cutoutProgress(db, demandIds, jobIds);
    }
    emit({ ...progress, complete: progress.complete && !selectionIncomplete, selectionIncomplete, interrupted, waitExpired: Boolean(options.wait && !progress.complete && !progress.failed && !interrupted) });
    if (interrupted) process.exitCode = 130;
    else if (progress.failed) process.exitCode = 1;
    else if (selectionIncomplete || (!progress.complete && (options.wait || options.environment === "local"))) process.exitCode = 2;
  } finally {
    server?.stop(true);
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    await closeDB(options.dbUrl);
  }
}
if (import.meta.main) await main();
