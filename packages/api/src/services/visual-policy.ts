import { and, eq, sql } from "drizzle-orm";
import type { DurableGameTurnSnapshotV1 } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import { recordVisualOperationEvent } from "./visual-diagnostics.js";
import { visualExecutionBoundaryGuard } from "./visual-execution-boundary.js";
import { readGameExecutionState } from "./game-turn-commit.js";

export type VisualFailurePolicy = "best_effort" | "require_visuals";
export const visualFailurePolicy = (config: Record<string, unknown>): VisualFailurePolicy => config.visualFailurePolicy === "require_visuals" ? "require_visuals" : "best_effort";

/** Discovery validates the saved Influence pause against its committed execution head. */
export async function readInfluenceVisualPause(db: Pick<DrizzleDB, "select">, gameId: string) {
  const [game] = await db.select({ kind: schema.games.gameKind, status: schema.games.status, config: schema.games.config })
    .from(schema.games).where(eq(schema.games.id, gameId));
  if (!game || game.kind !== "influence" || game.status !== "suspended") return null;
  const config = JSON.parse(game.config) as Record<string, unknown>;
  const pause = config.visualPause;
  if (config.visualMode !== true || !pause || typeof pause !== "object" || Array.isArray(pause)) return null;
  const value = pause as Record<string, unknown>;
  if (value.kind !== undefined || !Number.isSafeInteger(value.boundarySequence) || Number(value.boundarySequence) < 0
    || typeof value.reason !== "string" || !value.reason.trim()) return null;
  const execution = await readGameExecutionState(db, gameId);
  if (!execution || execution.heads.turnSequence !== value.boundarySequence) return null;
  return { boundarySequence: Number(value.boundarySequence), reason: value.reason };
}

export class VisualPreparationBlocked extends Error {
  constructor(message: string, readonly snapshot: DurableGameTurnSnapshotV1) {
    super(message);
    this.name = "VisualPreparationBlocked";
  }
}

/** Only the explicit championship policy reaches this owner-fenced suspension. */
export async function pauseForVisualRepair(db: DrizzleDB, failure: VisualPreparationBlocked): Promise<void> {
  const { gameId, ownerEpoch, heads, cursor } = failure.snapshot.execution;
  const guard = visualExecutionBoundaryGuard(db, { gameId, ownerEpoch, heads, cursor });
  await db.transaction(async (tx) => {
    await guard(tx);
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId));
    if (!game) throw new Error("Game not found");
    const config = JSON.parse(game.config) as Record<string, unknown>;
    // An operator can change policy while an attempt is in flight.
    if (visualFailurePolicy(config) !== "require_visuals") return;
    await recordVisualOperationEvent(tx, gameId, `boundary:${heads.turnSequence}:paused:${ownerEpoch}`, {
      boundarySequence: heads.turnSequence, kind: "paused", outcome: "paused", message: failure.message,
    });
    await tx.update(schema.games).set({ status: "suspended", endedAt: null,
      config: JSON.stringify({ ...config, visualPause: { boundarySequence: heads.turnSequence, reason: failure.message } }),
    }).where(eq(schema.games.id, gameId));
    await tx.update(schema.gameRunOwners).set({ status: "expired", closedAt: new Date().toISOString(), kernelHealth: "suspended", failureReason: "visual_preparation", failureDetails: { boundarySequence: heads.turnSequence } })
      .where(and(eq(schema.gameRunOwners.gameId, gameId), eq(schema.gameRunOwners.ownerEpoch, ownerEpoch), eq(schema.gameRunOwners.status, "active")));
  });
}

export async function setVisualFailurePolicy(db: DrizzleDB, gameId: string, policy: VisualFailurePolicy, operatorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('influence.game-turn'), hashtext(${gameId}))`);
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).for("update");
    if (!game || JSON.parse(game.config).visualMode !== true) throw new Error("Visual game not found");
    if (!["waiting", "in_progress", "suspended"].includes(game.status)) throw new Error("Game has ended");
    const config = JSON.parse(game.config) as Record<string, unknown>;
    if (visualFailurePolicy(config) === policy) return;
    await tx.update(schema.games).set({ config: JSON.stringify({ ...config, visualFailurePolicy: policy }) }).where(eq(schema.games.id, gameId));
    await recordVisualOperationEvent(tx, gameId, `policy:${crypto.randomUUID()}`, { kind: "policy", outcome: "success", message: `${operatorId} selected ${policy}` });
  });
}

/** Returns the unchanged committed cursor to the existing worker adoption path. */
export async function resumeVisualGame(db: DrizzleDB, gameId: string, operatorId: string): Promise<void> {
  const [game] = await db.select({ kind: schema.games.gameKind }).from(schema.games).where(eq(schema.games.id, gameId));
  if (game?.kind === "werewolf") {
    const { resumeWerewolfVisualGame } = await import("./werewolf-visual-policy.js");
    return resumeWerewolfVisualGame(db, gameId, operatorId);
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('influence.game-turn'), hashtext(${gameId}))`);
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).for("update");
    if (!game || game.status !== "suspended") throw new Error("Game is not paused for visual repair");
    const config = JSON.parse(game.config) as Record<string, unknown>;
    if (!config.visualPause) throw new Error("This pause is not owned by visual preparation");
    const { visualPause: _pause, ...next } = config;
    await tx.update(schema.games).set({ status: "in_progress", endedAt: null, config: JSON.stringify(next) }).where(eq(schema.games.id, gameId));
    await recordVisualOperationEvent(tx, gameId, `resume:${crypto.randomUUID()}`, { kind: "resumed", outcome: "pending", message: `${operatorId} requested resume from the committed visual boundary` });
  });
}
