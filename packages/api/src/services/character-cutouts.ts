import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import sharp from "sharp";
import { schema, type DrizzleDB } from "../db/index.js";
import { payloadHash, readPayload, storeBinary } from "./payload-storage.js";
import { readVisualProfileImage } from "./visual-game-assets.js";

export const CUTOUT_RECIPE = "birefnet-general-58f621f0-rembg2.0.86-r1";
export const CUTOUT_MAX_BYTES = 32 * 1024 * 1024;
const jobs = schema.characterCutouts;
const demands = schema.characterCutoutDemands;

export function cutoutMode(env: Record<string, string | undefined> = process.env): "disabled" | "local" | "aws-batch" {
  if (env.INFLUENCE_DEPLOYMENT_ENVIRONMENT === "staging" || env.NODE_ENV === "staging") return "disabled";
  const mode = env.CHARACTER_CUTOUT_MODE ?? "disabled";
  if (mode === "disabled") return mode;
  if (mode !== "local" && mode !== "aws-batch") throw new Error("Invalid CHARACTER_CUTOUT_MODE");
  const url = new URL(env.CUTOUT_API_URL ?? "");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("CUTOUT_API_URL must be an origin");
  if (mode === "aws-batch") {
    if (env.INFLUENCE_DEPLOYMENT_ENVIRONMENT !== "prod" || url.protocol !== "https:" || !env.CUTOUT_BATCH_QUEUE || !env.CUTOUT_BATCH_JOB_DEFINITION) throw new Error("AWS cutouts require production, HTTPS API origin, queue and job definition");
  } else if (env.INFLUENCE_DEPLOYMENT_ENVIRONMENT || env.NODE_ENV === "production" || url.protocol !== "http:" || !["localhost", "127.0.0.1", "host.docker.internal"].includes(url.hostname)) {
    throw new Error("Local cutouts require a localhost API");
  }
  return mode;
}

/** Only server-selected frozen references enter this queue. No caller-supplied URLs. */
export async function requestCharacterCutouts(db: DrizzleDB, gameId: string, sources: Record<string, string>): Promise<Record<string, string>> {
  if (!Object.keys(sources).length) return {};
  try {
    if (cutoutMode() !== "disabled") await db.insert(demands).values(Object.entries(sources).map(([playerId, sourceKey]) => ({
      id: crypto.randomUUID(), gameId, playerId, sourceKey, recipe: CUTOUT_RECIPE,
    }))).onConflictDoNothing();
    return await readyCharacterCutoutUrls(db, gameId, sources);
  } catch (error) {
    // Optional media must never block a game or playback; report the operational failure.
    console.error("[character-cutouts] Demand unavailable", { gameId, error });
    return {};
  }
}

/** Read-only pinning survives disabled generation and excludes arrivals after the cutoff. */
export async function readyCharacterCutoutUrls(db: Pick<DrizzleDB, "select">, gameId: string, sources: Record<string, string>, before?: Date) {
  // Live reads share the worker's database clock and sub-millisecond precision.
  const cutoff = before ?? sql`clock_timestamp()`;
  const ready = await db.select({ demand: demands }).from(demands).innerJoin(jobs, eq(demands.cutoutId, jobs.id))
    .where(and(eq(demands.gameId, gameId), eq(demands.recipe, CUTOUT_RECIPE), eq(jobs.status, "ready"), lte(jobs.readyAt, cutoff), lte(demands.createdAt, cutoff)));
  return Object.fromEntries(ready.filter(row => sources[row.demand.playerId] === row.demand.sourceKey)
    .map(row => [row.demand.playerId, `/api/games/${encodeURIComponent(gameId)}/cutouts/${row.demand.id}`]));
}

export async function readyCutoutsByHash(db: Pick<DrizzleDB, "select">, hashes: string[], before: string) {
  if (!hashes.length) return new Map<string, typeof jobs.$inferSelect>();
  const rows = await db.select().from(jobs).where(and(inArray(jobs.sourceHash, hashes), eq(jobs.recipe, CUTOUT_RECIPE), eq(jobs.status, "ready"), lte(jobs.readyAt, new Date(before))));
  return new Map(rows.map(row => [row.sourceHash, row]));
}

/** Store source bytes before publishing a durable job reference. */
export async function enqueueCutout(db: DrizzleDB, bytes: Buffer) {
  if (bytes.length > CUTOUT_MAX_BYTES) throw new Error("Cutout source exceeds image upload limit");
  const metadata = await sharp(bytes, { limitInputPixels: 16_000_000 }).metadata();
  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw new Error("Invalid cutout source image");
  const rotated = metadata.orientation && metadata.orientation >= 5;
  const source = await storeBinary(bytes);
  await db.insert(jobs).values({ id: crypto.randomUUID(), sourceHash: payloadHash(bytes), recipe: CUTOUT_RECIPE, source,
    width: rotated ? metadata.height : metadata.width, height: rotated ? metadata.width : metadata.height,
  }).onConflictDoNothing();
  const [job] = await db.select().from(jobs).where(and(eq(jobs.sourceHash, source.sha256), eq(jobs.recipe, CUTOUT_RECIPE)));
  if (!job) throw new Error("Cutout enqueue lost its durable reference");
  return job;
}

/** Shared, server-selected source boundary for inventory and durable preparation. */
export async function readCutoutSource(db: Pick<DrizzleDB, "select">, demand: { sourceKey: string; gameId: string | null; playerId: string }) {
  let bytes: Buffer;
  if (demand.sourceKey.startsWith("sha256:")) {
    const [source] = await db.select().from(schema.agentContentAssets).where(eq(schema.agentContentAssets.hash, demand.sourceKey.slice(7)));
    if (!source) throw new Error("Frozen content asset missing");
    bytes = await readPayload(source.bytes);
    if (payloadHash(bytes) !== demand.sourceKey.slice(7)) throw new Error("Frozen content asset hash mismatch");
  } else if (demand.gameId && demand.sourceKey.startsWith(`/api/games/${demand.gameId}/visual/artifacts/`)) {
    const id = demand.sourceKey.split("/").at(-1)!;
    const [source] = await db.select().from(schema.visualArtifacts).where(and(eq(schema.visualArtifacts.id, id), eq(schema.visualArtifacts.gameId, demand.gameId)));
    if (!source) throw new Error("Frozen visual artifact missing");
    bytes = await readPayload(source.image);
  } else {
    bytes = await readVisualProfileImage(demand.sourceKey, { name: demand.playerId, personaKey: "" });
  }
  return bytes;
}

export async function prepareCutoutDemands(db: DrizzleDB, ids?: string[]) {
  if (ids && !ids.length) return;
  const pending = await db.select().from(demands).where(and(eq(demands.recipe, CUTOUT_RECIPE), isNull(demands.cutoutId), isNull(demands.error), ids ? inArray(demands.id, ids) : undefined))
    .orderBy(asc(demands.createdAt), asc(demands.id)).limit(ids ? ids.length : 16);
  for (const demand of pending) {
    try {
      const bytes = await readCutoutSource(db, demand);
      const job = await enqueueCutout(db, bytes);
      await db.update(demands).set({ cutoutId: job.id }).where(and(eq(demands.id, demand.id), isNull(demands.cutoutId), isNull(demands.error)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Source preparation failed";
      await db.update(demands).set({ error: message.slice(0, 1000) }).where(and(eq(demands.id, demand.id), isNull(demands.cutoutId), isNull(demands.error)));
      console.error("[character-cutouts] Source preparation failed", { demandId: demand.id, error });
    }
  }
}

export async function expireCutoutLeases(db: DrizzleDB, now = new Date(), ids?: string[]) {
  if (ids && !ids.length) return;
  await db.update(jobs).set({ status: sql`CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END`,
    tokenHash: null, leaseUntil: null, error: "Worker did not finish before its lease expired" })
    .where(and(inArray(jobs.status, ["submitted", "running"]), lt(jobs.leaseUntil, now), ids ? inArray(jobs.id, ids) : undefined));
}

/** Atomic fencing happens before SubmitJob, including its ambiguous network outcomes. */
export async function reserveCutout(db: DrizzleDB, id: string, now = new Date()) {
  const token = randomBytes(32).toString("hex");
  const [job] = await db.update(jobs).set({ status: "submitted", tokenHash: payloadHash(Buffer.from(token)),
    attempts: sql`${jobs.attempts} + 1`, leaseUntil: new Date(now.getTime() + 60 * 60_000), batchJobId: null, error: null })
    .where(and(eq(jobs.id, id), eq(jobs.status, "pending"), lt(jobs.attempts, 3))).returning();
  return job ? { job, token } : null;
}

export function cutoutTokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
export async function claimCutout(db: DrizzleDB, id: string, token: string, recipe: string) {
  const [job] = await db.update(jobs).set({ status: "running", leaseUntil: new Date(Date.now() + 20 * 60_000) })
    .where(and(eq(jobs.id, id), eq(jobs.recipe, recipe), eq(jobs.status, "submitted"),
      eq(jobs.tokenHash, cutoutTokenHash(token)), sql`${jobs.leaseUntil} > now()`)).returning();
  return job;
}
export async function authorizedCutout(db: DrizzleDB, id: string, token: string) {
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.status, "running"),
    eq(jobs.tokenHash, cutoutTokenHash(token)), sql`${jobs.leaseUntil} > now()`));
  return job;
}

export async function acceptCutout(db: DrizzleDB, id: string, token: string, bytes: Buffer) {
  const job = await authorizedCutout(db, id, token);
  if (!job) return false;
  if (bytes.length > CUTOUT_MAX_BYTES) throw new Error("Cutout exceeds image upload limit");
  const decoder = sharp(bytes, { limitInputPixels: 16_000_000 });
  const meta = await decoder.metadata();
  if (meta.format !== "png" || !meta.hasAlpha || meta.channels !== 4 || meta.width !== job.width || meta.height !== job.height || (meta.pages ?? 1) !== 1) throw new Error("Cutout must be RGBA PNG with source dimensions");
  const alpha = await decoder.extractChannel("alpha").raw().toBuffer();
  if (!alpha.some(value => value === 0) || !alpha.some(value => value >= 250)) throw new Error("Cutout must contain foreground and transparent background");
  const image = await storeBinary(bytes);
  const changed = await db.update(jobs).set({ image, status: "ready", readyAt: sql`clock_timestamp()`, tokenHash: null, leaseUntil: null, error: null })
    .where(and(eq(jobs.id, id), eq(jobs.status, "running"), eq(jobs.tokenHash, cutoutTokenHash(token)), sql`${jobs.leaseUntil} > now()`))
    .returning({ id: jobs.id });
  return changed.length === 1;
}
