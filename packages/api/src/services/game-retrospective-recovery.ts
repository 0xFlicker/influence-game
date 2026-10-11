import { and, desc, eq } from "drizzle-orm";
import { assertRetrospectiveInput, durableProviderLogicalCallId, prepareRetrospectiveRequest, providerLogicalCallId, replayCanonicalEvents,
  type RetrospectiveExecutionError, type RetrospectiveFailureCode, type RetrospectiveFailureStage, type RetrospectiveOutcomeSource } from "@influence/engine";
import { replayWerewolf } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { readWerewolfEvents } from "./werewolf-games.js";
import { sha256StableJson } from "./stable-hash.js";
import { checkRecoveryAdmissionInTransaction } from "./deployment-admission.js";

type ReadDB = Pick<DrizzleDB, "select">;
export interface RetrospectiveFrontier {
  head: { sequence: number; hash: string };
  outcome: RetrospectiveOutcomeSource;
  stage: RetrospectiveFailureStage | "complete";
  definitionHash: string | null;
  inputHash: string | null;
  actorId: string | null;
  ordinal: number | null;
  requestHash: string | null;
  providerLogicalCallId: string | null;
}
export interface RetrospectiveFailure extends RetrospectiveFrontier {
  version: 1;
  id: string;
  code: RetrospectiveFailureCode;
  ownerEpoch: string;
  failedAt: string;
}
export class RetrospectiveRecoveryError extends Error {
  constructor(readonly code: "unavailable" | "conflict" | "admission_closed", message: string) { super(message); }
}

/** Derive the suspended slot from validated authority, never from error prose. */
export async function readRetrospectiveFrontier(db: ReadDB, game: Pick<typeof schema.games.$inferSelect, "id" | "gameKind">): Promise<RetrospectiveFrontier> {
  if (game.gameKind === "werewolf") {
    const events = await readWerewolfEvents(db, game.id), state = replayWerewolf(events), last = events.at(-1);
    const result = events.find(event => event.type === "werewolf.completed");
    if (!last || !result || !state.outcome) throw new RetrospectiveRecoveryError("unavailable", "No canonical outcome is available");
    const request = state.retrospective && state.retrospective.statements.length < state.retrospective.definition.speakerIds.length
      ? prepareRetrospectiveRequest(state.retrospective) : null;
    return { head: { sequence: last.sequence, hash: sha256StableJson(last) },
      outcome: { gameId: game.id, gameKind: "werewolf", eventSequence: result.sequence, eventHash: sha256StableJson(result) },
      stage: !state.retrospective ? "initialize" : request ? "statement" : "complete",
      definitionHash: state.retrospective?.definition.definitionHash ?? null, inputHash: state.retrospective?.definition.inputHash ?? null,
      actorId: request?.actorId ?? null, ordinal: request?.ordinal ?? null, requestHash: request ? sha256StableJson(request) : null,
      providerLogicalCallId: request ? providerLogicalCallId(game.id, { actor: { id: request.actorId, name: state.players.find(player => player.id === request.actorId)!.name, role: "player" },
        action: "retrospective-statement", round: state.day, semantic: { version: 1, kind: "werewolf_action", eventSequence: state.sequence + 1 } }) : null };
  }
  const persisted = await getPersistedGameEvents(db, game.id);
  if (persisted.status !== "complete" || !persisted.persistedHead) throw new RetrospectiveRecoveryError("unavailable", "Canonical history is unavailable");
  const state = replayCanonicalEvents(persisted.events.map(event => event.envelope));
  if (!state.retrospectiveOutcomeSource) throw new RetrospectiveRecoveryError("unavailable", "No canonical outcome is available");
  const request = state.retrospective && state.retrospective.statements.length < state.retrospective.definition.speakerIds.length
    ? prepareRetrospectiveRequest(state.retrospective) : null;
  const [execution] = await db.select().from(schema.gameExecutionStates).where(eq(schema.gameExecutionStates.gameId, game.id));
  if (!execution || execution.eventHeadSequence !== persisted.persistedHead.sequence || execution.eventHeadHash !== persisted.persistedHead.eventHash
    || execution.executionCursor.kind !== "retrospective" && execution.executionCursor.kind !== "terminal") {
    throw new RetrospectiveRecoveryError("unavailable", "Retrospective execution frontier does not match its canonical history");
  }
  const cursor = execution.executionCursor;
  if (cursor.kind === "retrospective" && (cursor.stage !== (!state.retrospective ? "initialize" : request ? "statement" : "complete")
    || cursor.stage !== "initialize" && cursor.definitionHash !== state.retrospective?.definition.definitionHash
    || cursor.stage === "statement" && cursor.ordinal !== request?.ordinal)) {
    throw new RetrospectiveRecoveryError("unavailable", "Retrospective cursor differs from its accepted prefix");
  }
  return { head: { sequence: persisted.persistedHead.sequence, hash: persisted.persistedHead.eventHash }, outcome: state.retrospectiveOutcomeSource,
    stage: !state.retrospective ? "initialize" : request ? "statement" : "complete", definitionHash: state.retrospective?.definition.definitionHash ?? null,
    inputHash: state.retrospective?.definition.inputHash ?? null, actorId: request?.actorId ?? null, ordinal: request?.ordinal ?? null,
    requestHash: request ? sha256StableJson(request) : null,
    providerLogicalCallId: request ? durableProviderLogicalCallId({ gameId: game.id, turnId: `${game.id}:turn:${execution.committedTurnSequence + 1}`, subcallSlot: 1 }) : null };
}

/** Store the failed slot and release ownership atomically, preventing automatic redispatch. */
export async function pauseRetrospectiveExecution(db: DrizzleDB, gameId: string, ownerEpoch: string, error: RetrospectiveExecutionError): Promise<boolean> {
  return db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).for("update");
    const [owner] = await tx.select().from(schema.gameRunOwners).where(and(eq(schema.gameRunOwners.gameId, gameId), eq(schema.gameRunOwners.ownerEpoch, ownerEpoch))).for("update");
    if (!game || game.status !== "in_progress" || owner?.status !== "active" || !owner.expiresAt || Date.parse(owner.expiresAt) <= Date.now()) return false;
    const frontier = await readRetrospectiveFrontier(tx, game);
    if (frontier.stage !== error.stage) throw new RetrospectiveRecoveryError("conflict", "Failed step no longer matches the committed slot");
    const config = JSON.parse(game.config) as Record<string, unknown>, failedAt = new Date().toISOString();
    const fields = { version: 1 as const, ...frontier, code: error.code, ownerEpoch, failedAt };
    const failure: RetrospectiveFailure = { ...fields, id: sha256StableJson(fields) };
    await tx.update(schema.games).set({ status: "suspended", config: JSON.stringify({ ...config, retrospectiveFailure: failure }) }).where(eq(schema.games.id, gameId));
    await tx.update(schema.gameRunOwners).set({ status: "revoked", revokedAt: failedAt, closedAt: failedAt, kernelHealth: "suspended", failureReason: `retrospective_failed:${error.code}` }).where(eq(schema.gameRunOwners.id, owner.id));
    if (game.gameKind === "influence") await tx.update(schema.gameExecutionStates).set({ status: "repair_required", updatedAt: failedAt }).where(and(eq(schema.gameExecutionStates.gameId, gameId), eq(schema.gameExecutionStates.ownerEpoch, ownerEpoch)));
    return true;
  });
}

export interface ResumeRetrospectiveInput { gameId: string; expectedHead: { sequence: number; hash: string }; expectedFailureId: string | null; idempotencyKey: string }
/** Trusted mutation service; callers must authorize current roles and the dedicated recovery grant. */
export async function resumeGameRetrospective(db: DrizzleDB, input: ResumeRetrospectiveInput) {
  if (!input.idempotencyKey || input.idempotencyKey.length > 100) throw new RetrospectiveRecoveryError("conflict", "A bounded idempotency key is required");
  return db.transaction(async tx => {
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, input.gameId)).for("update");
    if (!game) throw new RetrospectiveRecoveryError("unavailable", "Game is unavailable");
    const config = JSON.parse(game.config) as Record<string, unknown>, fingerprint = sha256StableJson(input);
    const previous = config.retrospectiveResume as { idempotencyKey?: string; fingerprint?: string } | undefined;
    if (previous?.idempotencyKey === input.idempotencyKey) {
      if (previous.fingerprint !== fingerprint) throw new RetrospectiveRecoveryError("conflict", "Idempotency key was used with a different recovery request");
      return { gameId: game.id, status: "in_progress" as const, alreadyResumed: true };
    }
    if (game.status !== "suspended") throw new RetrospectiveRecoveryError("conflict", "Only a paused retrospective can resume");
    const failure = config.retrospectiveFailure as RetrospectiveFailure | null | undefined;
    const [owner] = await tx.select().from(schema.gameRunOwners).where(eq(schema.gameRunOwners.gameId, game.id)).orderBy(desc(schema.gameRunOwners.createdAt)).limit(1);
    if ((failure?.id ?? null) !== input.expectedFailureId || !failure && owner?.failureReason !== "retrospective_paused") throw new RetrospectiveRecoveryError("conflict", "Recovery failure identity changed");
    if (failure) {
      const { id, ...fields } = failure;
      if (failure.version !== 1 || sha256StableJson(fields) !== id || owner?.ownerEpoch !== failure.ownerEpoch || owner.failureReason !== `retrospective_failed:${failure.code}`) {
        throw new RetrospectiveRecoveryError("unavailable", "Suspended failure identity is invalid");
      }
    }
    const frontier = await readRetrospectiveFrontier(tx, game);
    if (sha256StableJson(frontier.head) !== sha256StableJson(input.expectedHead)
      || failure && sha256StableJson(Object.fromEntries(Object.keys(frontier).map(key => [key, failure[key as keyof RetrospectiveFrontier]]))) !== sha256StableJson(frontier)) {
      throw new RetrospectiveRecoveryError("conflict", "Recovery frontier changed");
    }
    if (frontier.inputHash !== null) {
      const [stored] = await tx.select().from(schema.gameRetrospectiveInputs).where(eq(schema.gameRetrospectiveInputs.gameId, game.id));
      if (!stored) throw new RetrospectiveRecoveryError("unavailable", "Frozen retrospective input is unavailable");
      assertRetrospectiveInput(stored.input);
      if (stored.inputHash !== frontier.inputHash || sha256StableJson(stored.input) !== frontier.inputHash
        || sha256StableJson(stored.input.outcome) !== sha256StableJson(frontier.outcome)) throw new RetrospectiveRecoveryError("unavailable", "Frozen retrospective input changed");
    }
    const admission = await checkRecoveryAdmissionInTransaction(tx);
    if (!admission.ok) throw new RetrospectiveRecoveryError("admission_closed", admission.error);
    const resumedAt = new Date().toISOString();
    const [lastAttempt] = frontier.providerLogicalCallId ? await tx.select({ ordinal: schema.providerCallAttempts.attemptOrdinal }).from(schema.providerCallAttempts)
      .where(eq(schema.providerCallAttempts.logicalCallId, frontier.providerLogicalCallId)).orderBy(desc(schema.providerCallAttempts.attemptOrdinal)).limit(1) : [];
    await tx.update(schema.games).set({ status: "in_progress", config: JSON.stringify({ ...config, retrospectiveFailure: null,
      retrospectiveResume: { idempotencyKey: input.idempotencyKey, fingerprint, resumedAt,
        logicalCallId: frontier.providerLogicalCallId, retryAfterAttemptOrdinal: lastAttempt?.ordinal ?? 0 } }) }).where(eq(schema.games.id, game.id));
    if (game.gameKind === "influence") await tx.update(schema.gameExecutionStates).set({ status: frontier.stage === "complete" && (await tx.select().from(schema.gameExecutionStates).where(eq(schema.gameExecutionStates.gameId, game.id)))[0]?.executionCursor.kind === "terminal" ? "terminal" : "ready",
      retryState: null, updatedAt: resumedAt }).where(eq(schema.gameExecutionStates.gameId, game.id));
    return { gameId: game.id, status: "in_progress" as const, alreadyResumed: false };
  });
}
