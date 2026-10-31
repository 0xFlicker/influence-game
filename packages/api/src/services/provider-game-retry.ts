import { and, eq } from "drizzle-orm";
import { providerLogicalCallId, ProviderCircuitOpenError, type ProviderDeferredError } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";

interface ProviderRetry {
  logicalCallId: string;
  attempt: number;
  readyAt: string;
  code: string;
}

export function providerRetryPending(config: string, now = Date.now()): boolean {
  const retry = (JSON.parse(config) as { providerRetry?: ProviderRetry }).providerRetry;
  return Boolean(retry && Date.parse(retry.readyAt) > now);
}

/** Persist a retry wave without touching the planned turn, events or accepted results. */
export async function deferProviderGame(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
  error: ProviderDeferredError,
): Promise<void> {
  await db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games)
      .where(eq(schema.games.id, gameId)).for("update");
    if (!game || game.status !== "in_progress") return;
    const [owner] = await tx.select().from(schema.gameRunOwners).where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, ownerEpoch),
      eq(schema.gameRunOwners.status, "active"),
    )).for("update");
    if (!owner || (owner.expiresAt && Date.parse(owner.expiresAt) <= Date.now())) return;

    const config = JSON.parse(game.config) as Record<string, unknown> & { providerRetry?: ProviderRetry };
    const logicalCallId = providerLogicalCallId(gameId, error.coordinate);
    const attempt = config.providerRetry?.logicalCallId === logicalCallId ? config.providerRetry.attempt + 1 : 1;
    const code = error.failure.outcome.kind;
    const suspend = attempt >= 24
      || (error.failure instanceof ProviderCircuitOpenError && error.failure.haltManifest)
      || ["authentication", "configuration", "request_error", "budget_exhausted"].includes(code);
    const now = new Date().toISOString();
    const delayMs = Math.min(30 * 60_000, 60_000 * 2 ** Math.min(attempt - 1, 5));
    const readyAt = new Date(Date.now() + delayMs).toISOString();
    const retry: ProviderRetry = { logicalCallId, attempt, readyAt, code };
    await tx.update(schema.games).set({
      status: suspend ? "suspended" : "in_progress",
      endedAt: null,
      config: JSON.stringify({ ...config, providerRetry: retry }),
    }).where(eq(schema.games.id, gameId));
    await tx.update(schema.gameRunOwners).set({
      status: "expired",
      closedAt: now,
      expiresAt: now,
      kernelHealth: suspend ? "suspended" : "healthy",
      failureReason: suspend ? "provider_execution_suspended" : "provider_execution_deferred",
      failureDetails: { ...retry },
    }).where(eq(schema.gameRunOwners.id, owner.id));
  });
}
