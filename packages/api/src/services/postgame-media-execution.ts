import { renderExecutionConfig, type RenderExecution } from "@influence/engine/render-execution-config";
import { and, count, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { schema, type DrizzleDB } from "../db/index.js";
import { claimPostgameMedia } from "./postgame-media-worker.js";

type Transaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
export type RendererIdentity = { generation: string; workerDigest: string; workerInstanceId: string };
export type RenderReleaseCommand = {
  operation: "accept" | "accept-local" | "drain";
  generation: string;
  workerDigest: string;
  previousGeneration: string | null;
};

export function remoteRenderingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return renderExecutionConfig(env).mode === "remote";
}

export function parseRendererIdentity(headers: Headers): RendererIdentity | null {
  const generation = headers.get("x-render-generation");
  const workerDigest = headers.get("x-render-worker-digest");
  const workerInstanceId = headers.get("x-render-worker-instance");
  return validGeneration(generation) && validDigest(workerDigest) && workerInstanceId && workerInstanceId.length <= 2048
    ? { generation, workerDigest, workerInstanceId } : null;
}

export function parseRenderReleaseCommand(body: unknown): RenderReleaseCommand | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if ((value.operation !== "accept" && value.operation !== "accept-local" && value.operation !== "drain")
    || !validGeneration(value.generation) || !validDigest(value.workerDigest)
    || !(value.previousGeneration === null || validGeneration(value.previousGeneration))) return null;
  return { operation: value.operation, generation: value.generation, workerDigest: value.workerDigest, previousGeneration: value.previousGeneration };
}
function validGeneration(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}
function validDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

async function lockRelease(tx: Transaction) {
  await tx.insert(schema.postgameMediaRenderRelease).values({ id: 1 }).onConflictDoNothing();
  return (await tx.select().from(schema.postgameMediaRenderRelease).where(eq(schema.postgameMediaRenderRelease.id, 1)).for("update"))[0]!;
}
function admitted(row: typeof schema.postgameMediaRenderRelease.$inferSelect, identity: RendererIdentity | null) {
  return row.mode === "remote" && !!identity && !row.draining && row.generation === identity.generation && row.workerDigest === identity.workerDigest;
}

export async function rendererControl(db: DrizzleDB, identity: RendererIdentity | null) {
  return db.transaction(async tx => {
    const row = await lockRelease(tx);
    return { admitted: admitted(row, identity), generation: row.generation, draining: row.draining };
  });
}

export async function claimRemotePostgameMedia(db: DrizzleDB, workerToken: string, identity: RendererIdentity | null) {
  return db.transaction(async tx => {
    const row = await lockRelease(tx);
    if (!admitted(row, identity)) return { admitted: false as const, claim: null };
    return { admitted: true as const, claim: await claimPostgameMedia(tx, `${workerToken}:${identity!.workerInstanceId}`) };
  });
}

export async function claimLocalPostgameMedia(db: DrizzleDB, workerToken: string) {
  return db.transaction(async tx => {
    const row = await lockRelease(tx);
    if (row.mode !== "local" || row.draining) return { admitted: false as const, claim: null };
    return { admitted: true as const, claim: await claimPostgameMedia(tx, workerToken) };
  });
}

export async function getRenderRelease(db: DrizzleDB) {
  const [row] = await db.select().from(schema.postgameMediaRenderRelease).where(eq(schema.postgameMediaRenderRelease.id, 1));
  const [active] = await db.select({ value: count() }).from(schema.gamePostgameMedia).where(and(
    inArray(schema.gamePostgameMedia.status, ["claimed", "rendering", "composing", "uploading"]),
    gt(schema.gamePostgameMedia.leaseExpiresAt, new Date().toISOString()),
  ));
  return { generation: row?.generation ?? null, workerDigest: row?.workerDigest ?? null, mode: row?.mode ?? "local", draining: row?.draining ?? false, activeLeases: active?.value ?? 0 };
}

export async function mutateRenderRelease(db: DrizzleDB, command: RenderReleaseCommand): Promise<boolean> {
  return db.transaction(async tx => {
    const row = await lockRelease(tx);
    // Exact replay is idempotent; a stale CAS never overwrites a newer epoch.
    const mode = command.operation === "accept-local" ? "local" : "remote";
    if (command.operation !== "drain" && row.mode === mode && row.generation === command.generation && row.workerDigest === command.workerDigest && !row.draining) return true;
    if (row.generation !== command.previousGeneration) return false;
    if (command.operation === "drain") {
      if (row.generation !== command.generation || row.workerDigest !== command.workerDigest) return false;
      await tx.update(schema.postgameMediaRenderRelease).set({ draining: true }).where(eq(schema.postgameMediaRenderRelease.id, 1));
    } else {
      // Every new epoch requires completed drain and no leases, including same-mode
      // releases. The row lock also fences claim races.
      {
        if (row.generation !== null && !row.draining) return false;
        const [active] = await tx.select({ value: count() }).from(schema.gamePostgameMedia).where(and(
          inArray(schema.gamePostgameMedia.status, ["claimed", "rendering", "composing", "uploading"]),
          gt(schema.gamePostgameMedia.leaseExpiresAt, new Date().toISOString()),
        ));
        if (active?.value) return false;
      }
      // Permanent tombstones prevent A -> B -> A readmission. Rollback uses
      // a fresh epoch even when it selects a previously accepted image digest.
      const inserted = await tx.insert(schema.postgameMediaRenderGenerations).values({ generation: command.generation, workerDigest: command.workerDigest }).onConflictDoNothing().returning();
      if (inserted.length === 0) return false;
      await tx.update(schema.postgameMediaRenderRelease).set({ generation: command.generation, workerDigest: command.workerDigest, mode, draining: false }).where(eq(schema.postgameMediaRenderRelease.id, 1));
      if (mode === "remote") await tx.insert(schema.postgameMediaWakeOutbox).values({});
    }
    return true;
  });
}

export function signedRenderWake(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000).toString()) {
  return { "X-Render-Timestamp": timestamp, "X-Render-Signature": createHmac("sha256", secret).update(`${timestamp}\n${body}`).digest("hex") };
}

// Every sweep repairs lost notification/launcher/STOPPED delivery, including
// expired leases. Terminal failed/waiting_music jobs deliberately stay terminal.
export async function dispatchRenderWakes(db: DrizzleDB, options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; execution?: RenderExecution } = {}) {
  const env = options.env ?? process.env;
  const execution = options.execution ?? renderExecutionConfig(env);
  if (execution.mode !== "remote") return 0;
  const url = env.POSTGAME_MEDIA_WAKE_URL;
  const secret = env.POSTGAME_MEDIA_WAKE_SECRET;
  const environment = execution.environment;
  if (!url || !secret || (environment !== "prod" && environment !== "staging")) throw new Error("Remote render wake configuration is incomplete");
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password) throw new Error("Render wake URL must be HTTPS without credentials");
  return db.transaction(async tx => {
    // One dispatcher owns repair + delivery at a time across API processes.
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(198724, 1) AS acquired`);
    if (!lock[0]?.acquired) return 0;
    const [pending] = await tx.select({ id: schema.postgameMediaWakeOutbox.id }).from(schema.postgameMediaWakeOutbox).where(isNull(schema.postgameMediaWakeOutbox.deliveredAt)).limit(1);
    if (!pending) {
      const [work] = await tx.select({ gameId: schema.gamePostgameMedia.gameId }).from(schema.gamePostgameMedia).where(or(
        eq(schema.gamePostgameMedia.status, "queued"),
        and(inArray(schema.gamePostgameMedia.status, ["claimed", "rendering", "composing", "uploading"]), sql`${schema.gamePostgameMedia.leaseExpiresAt} <= ${new Date().toISOString()}`),
      )).limit(1);
      if (work) await tx.insert(schema.postgameMediaWakeOutbox).values({});
    }
    const rows = await tx.select().from(schema.postgameMediaWakeOutbox).where(isNull(schema.postgameMediaWakeOutbox.deliveredAt)).limit(10).for("update", { skipLocked: true });
    for (const row of rows) {
      const body = JSON.stringify({ schemaVersion: 1, operation: "wake", environment, requestId: row.id });
      const response = await (options.fetch ?? fetch)(target, { method: "POST", headers: { "Content-Type": "application/json", ...signedRenderWake(body, secret) }, body, signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error(`Render wake rejected (${response.status})`);
      await tx.update(schema.postgameMediaWakeOutbox).set({ deliveredAt: new Date().toISOString() }).where(eq(schema.postgameMediaWakeOutbox.id, row.id));
    }
    // Keep receipts briefly for diagnosis; generation tombstones never expire.
    await tx.delete(schema.postgameMediaWakeOutbox).where(sql`${schema.postgameMediaWakeOutbox.deliveredAt}::timestamptz < now() - interval '7 days'`);
    return rows.length;
  });
}

export function startRenderWakeDispatcher(db: DrizzleDB, canDispatch: () => boolean) {
  let stopped = false;
  let running: Promise<unknown> | null = null;
  const sweep = () => {
    if (stopped || running || !canDispatch()) return;
    running = dispatchRenderWakes(db).catch(() => console.warn("[postgame-media] Render wake delivery deferred")).finally(() => { running = null; });
  };
  const timer = setInterval(sweep, 30_000);
  timer.unref();
  sweep();
  return { async stop() { stopped = true; clearInterval(timer); await running; } };
}
