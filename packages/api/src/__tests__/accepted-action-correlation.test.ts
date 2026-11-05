import { loadPayloads, storeFields } from "../services/payload-storage.js";
import { beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { Phase, providerAcceptedDecisionId, type CanonicalGameEvent, type PrivateDecisionTrace, type GameTurnIntentV1, type GameTurnCommitResultV1 } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  reconcileAcceptedActionCorrelations,
} from "../services/accepted-action-correlation.js";
import { createInitialGameExecutionStateV1 } from "../services/game-turn-commit.js";
import { createEvidenceManifest } from "../services/game-evidence.js";
import { recoverPrivateTraceIndex } from "../services/private-trace-index-recovery.js";
import type { PrivateTraceStorageAdapter } from "../services/private-trace-storage.js";
import { getDurableRunInspection } from "../services/game-durable-run.js";
import { appendGameEvents } from "../services/game-events.js";
import {
  appendDurableEventsAndPublishWatchState,
  reconcileAcceptedActionsForLifecycle,
} from "../services/game-lifecycle.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

function voteEvent(
  gameId: string,
  decisionId: string,
  sequence = 1,
): CanonicalGameEvent {
  return {
    sequence,
    gameId,
    round: 1,
    phase: Phase.VOTE,
    type: "vote.cast",
    timestamp: "2026-07-25T00:00:00.000Z",
    source: "engine",
    visibility: "producer",
    payloadVersion: 1,
    sourcePointers: [{
      kind: "agent_turn",
      actorId: "atlas",
      action: "vote",
      round: 1,
      phase: Phase.VOTE,
      decisionId,
    }],
    payload: {
      voterId: "atlas",
      empowerTarget: "mira",
      exposeTarget: "echo",
    },
  };
}

async function seedSidecars(
  db: DrizzleDB,
  params: {
    gameId: string;
    ownerEpoch: string;
    decisionId: string;
    eventSequence?: number;
    action?: string;
  },
): Promise<void> {
  const action = params.action ?? "vote";
  await db.insert(schema.gameEvidenceManifests).values({
    id: randomUUID(),
    gameId: params.gameId,
    ownerEpoch: params.ownerEpoch,
    decisionId: params.decisionId,
    eventSequence: params.eventSequence,
    evidenceType: "private_decision_trace",
    retentionClass: "debug",
    accessScope: "producer_admin",
    metadata: { action },
  });
  await db.insert(schema.gameCognitiveArtifacts).values(await storeFields({
    id: randomUUID(),
    gameId: params.gameId,
    decisionId: params.decisionId,
    eventSequence: params.eventSequence,
    captureVersion: 1,
    artifactType: "thinking",
    actorRole: "player",
    action,
    phase: Phase.VOTE,
    round: 1,
    payloadByteLength: 2,
    payload: {},
  }, {"payload":"json-gzip"}));
  await db.insert(schema.gamePromptReuseAppliedSources).values({
    id: randomUUID(),
    gameId: params.gameId,
    ownerEpoch: params.ownerEpoch,
    decisionId: params.decisionId,
    eventSequence: params.eventSequence ?? 0,
    comparable: true,
    reusableCharacters: 120,
    reusableTokenEstimate: 30,
    firstBreak: "user_message",
  });
}

async function recoveredDecision(db: DrizzleDB, durable = false) {
  const gameId = await insertGame(db, { status: "in_progress" });
  const oldOwner = await insertOwner(db, gameId, { status: "expired" });
  const ownerEpoch = await insertOwner(db, gameId);
  const attemptId = randomUUID();
  const callId = randomUUID();
  const hash = `sha256:${"a".repeat(64)}`;
  await db.insert(schema.providerLogicalCalls).values({ id: callId, gameId, actorName: "Atlas", actorRole: "player", action: "vote", semanticCoordinate: {}, semanticCoordinateHash: hash });
  await db.insert(schema.providerCallAttempts).values({
    id: attemptId, logicalCallId: callId, gameId, ownerEpoch: oldOwner,
    attemptOrdinal: 1, transportAttemptId: randomUUID(), reservationHash: hash,
    terminalHash: hash, status: "terminal", transport: "chat_completions",
    providerProfileId: "test", modelName: "test", startedAt: "2026-11-05T00:00:00Z",
    completedAt: "2026-11-05T00:00:01Z", latencyMs: 1000, outcomeKind: "usable", disposition: "accepted",
  });
  await db.update(schema.providerLogicalCalls).set(await storeFields({
    acceptedAttemptId: attemptId, acceptedCatalogId: "test", acceptedValue: {},
    acceptedValueSha256: hash, acceptedAt: "2026-11-05T00:00:01Z",
  }, { acceptedValue: "json-gzip" })).where(eq(schema.providerLogicalCalls.id, callId));
  const decisionId = providerAcceptedDecisionId(attemptId);
  await appendGameEvents(db, { gameId, ownerEpoch, events: [voteEvent(gameId, decisionId)] });
  if (durable) {
    const turnId = `${gameId}:turn:1`;
    const state = createInitialGameExecutionStateV1({ gameId, ownerEpoch, xstateSnapshot: { value: "vote" }, cursor: { version: 1, kind: "phase_enter", actor: "vote" } });
    const intent: GameTurnIntentV1 = { version: 1, gameId, turnId, turnSequence: 1, seed: "recovery-test", baseHeads: state.heads,
      branch: { version: 1, kind: "single_provider", action: "vote" }, actorIds: ["atlas"], targetIds: [], handles: [], participantIds: ["atlas"],
      providerSubcalls: [{ version: 1, slot: 1, logicalCallId: callId, semanticCoordinate: { version: 1, kind: "durable_turn", turnId, subcallSlot: 1 }, actorId: "atlas", action: "vote", contractId: "test-vote" }] };
    const committedAt = "2026-11-05T00:00:02Z";
    const commitResult: GameTurnCommitResultV1 = { version: 1, gameId, turnId, turnSequence: 1, intentHash: hash, effectHash: hash, committedAt,
      state, canonicalEvents: [{ sequence: 1, eventHash: hash, event: voteEvent(gameId, decisionId) }], dialogueSequences: [], publications: [], alreadyCommitted: false };
    await db.insert(schema.gameTurns).values(await storeFields({ id: turnId, gameId, turnSequence: 1, status: "committed" as const,
      plannedOwnerEpoch: oldOwner, committedOwnerEpoch: ownerEpoch, baseEventSequence: 0, baseDialogueSequence: 0, basePublicationSequence: 0,
      intent, intentHash: hash, effectHash: hash, committedAt, commitResult }, { intent: "json-gzip", commitResult: "json-gzip" }));
    await db.update(schema.providerLogicalCalls).set({ canonicalEventSequence: null, canonicalCommittedAt: null, gameTurnId: turnId, gameTurnSubcallSlot: 1, gameTurnCommittedAt: committedAt }).where(eq(schema.providerLogicalCalls.id, callId));
  }
  return { gameId, oldOwner, ownerEpoch, decisionId, callId, attemptId };
}

describe("accepted action correlation", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test.each([false, true])("links recovered accepted captures without rewriting owner (durable=%s)", async (durable) => {
    const f = await recoveredDecision(db, durable);
    await seedSidecars(db, { ...f, ownerEpoch: f.oldOwner });
    const result = await reconcileAcceptedActionCorrelations(db, f);
    expect(result).toMatchObject({ linkedDecisionCount: 1, missingCaptureDecisionCount: 0, conflictDecisionCount: 0 });
    expect((await db.select().from(schema.gameEvidenceManifests))[0]).toMatchObject({ ownerEpoch: f.oldOwner, eventSequence: 1 });
    expect((await db.select().from(schema.gamePromptReuseAppliedSources))[0]).toMatchObject({ ownerEpoch: f.oldOwner, eventSequence: 1 });
    const repeat = await reconcileAcceptedActionCorrelations(db, f);
    expect(repeat.updatedManifestCount).toBe(0);
    expect(repeat.updatedCognitiveArtifactCount).toBe(0);
    expect(repeat.updatedPromptReuseSourceCount).toBe(0);
  });

  test("retains real PostgreSQL constraint diagnostics without leaking evidence parameters", async () => {
    const gameId = await insertGame(db, { status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId);
    const result = await createEvidenceManifest(db, { gameId, ownerEpoch, evidenceType: "private_decision_trace", retentionClass: "invalid", metadata: { privateText: "never log this evidence" } });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected constraint failure");
    expect(result.error).toBe("PostgreSQL 23514 (game_evidence_manifests_retention_class_check)");
    expect(JSON.stringify(result)).not.toContain("never log");
    expect(await db.select().from(schema.gameEvidenceManifests)).toHaveLength(0);
  });

  test("does not borrow an unrelated historical capture or a different event binding", async () => {
    const f = await recoveredDecision(db);
    const unrelated = await insertOwner(db, f.gameId, { status: "closed" });
    await seedSidecars(db, { ...f, ownerEpoch: unrelated });
    expect((await reconcileAcceptedActionCorrelations(db, f)).missingCaptureDecisionCount).toBe(1);
    await db.update(schema.gameEvidenceManifests).set({ ownerEpoch: f.oldOwner });
    await db.update(schema.providerLogicalCalls).set({ canonicalEventSequence: null, canonicalCommittedAt: null }).where(eq(schema.providerLogicalCalls.id, f.callId));
    expect((await reconcileAcceptedActionCorrelations(db, f)).missingCaptureDecisionCount).toBe(1);
    expect((await db.select().from(schema.gameEvidenceManifests))[0]!.eventSequence).toBeNull();
  });

  test("does not borrow a capture from an uncommitted or differently owned durable turn", async () => {
    const f = await recoveredDecision(db, true);
    await seedSidecars(db, { ...f, ownerEpoch: f.oldOwner });
    await db.update(schema.providerLogicalCalls).set({ gameTurnCommittedAt: null }).where(eq(schema.providerLogicalCalls.id, f.callId));
    expect((await reconcileAcceptedActionCorrelations(db, f)).missingCaptureDecisionCount).toBe(1);
    await db.update(schema.providerLogicalCalls).set({ gameTurnCommittedAt: "2026-11-05T00:00:02Z" }).where(eq(schema.providerLogicalCalls.id, f.callId));
    await db.update(schema.gameTurns).set({ committedOwnerEpoch: f.oldOwner });
    expect((await reconcileAcceptedActionCorrelations(db, f)).missingCaptureDecisionCount).toBe(1);
    expect((await db.select().from(schema.gameEvidenceManifests))[0]!.eventSequence).toBeNull();
  });

  test("plans orphan recovery read-only and restores verified index idempotently with provenance", async () => {
    const f = await recoveredDecision(db, true);
    const previous = process.env.LINODE_PRIVATE_CONTENT_BUCKET;
    process.env.LINODE_PRIVATE_CONTENT_BUCKET = "private-recovery-test";
    try {
      const trace: PrivateDecisionTrace = { version: 2, gameId: f.gameId, ownerEpoch: f.oldOwner, decisionId: f.decisionId,
        action: "vote", actor: { id: "atlas", name: "Atlas", role: "player" }, phase: Phase.VOTE, round: 1,
        createdAt: "2026-11-05T00:00:01Z", model: { name: "test" }, prompt: { messages: [] }, request: {}, response: { raw: { secret: "private reasoning" } } };
      let body = JSON.stringify(trace);
      const storage: PrivateTraceStorageAdapter = {
        putObject: async () => { throw new Error("Recovery must never rewrite objects"); },
        getObject: async () => ({ body }), headObject: async () => ({ contentLength: body.length }),
      };
      const input = { gameId: f.gameId, reason: "Reviewed disposable recovery fixture", key: `content/${f.gameId}/private-traces/orphan.json`, expectedSha256: `sha256:${createHash("sha256").update(body).digest("hex")}` };
      const plan = await recoverPrivateTraceIndex(db, input, storage);
      expect(plan).toMatchObject({ applied: false, alreadyIndexed: false, ownerEpoch: f.oldOwner, eventSequence: 1 });
      expect(JSON.stringify(plan)).not.toContain("private reasoning");
      expect(await db.select().from(schema.gameEvidenceManifests)).toHaveLength(0);
      body += " ";
      await expect(recoverPrivateTraceIndex(db, { ...input, apply: true }, storage)).rejects.toThrow("integrity");
      body = JSON.stringify(trace);
      await expect(recoverPrivateTraceIndex(db, { ...input, key: `content/${randomUUID()}/private-traces/orphan.json`, apply: true }, storage)).rejects.toThrow("another game");
      const results = await Promise.all([1, 2].map(() => recoverPrivateTraceIndex(db, { ...input, apply: true }, storage)));
      expect(results.filter(result => result.applied)).toHaveLength(1);
      const rows = await db.select().from(schema.gameEvidenceManifests);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ownerEpoch: f.oldOwner, eventSequence: 1, accessScope: "producer_admin", storageKey: input.key });
      expect(rows[0]!.metadata).toHaveProperty("indexRecovery");
      expect(JSON.stringify(rows[0])).not.toContain("private reasoning");
    } finally {
      if (previous === undefined) delete process.env.LINODE_PRIVATE_CONTENT_BUCKET; else process.env.LINODE_PRIVATE_CONTENT_BUCKET = previous;
    }
  });

  test("is idempotent and scopes every mutable sidecar to the exact game and owner", async () => {
    const gameId = await insertGame(db, { status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId);
    const decisionId = randomUUID();
    await appendGameEvents(db, {
      gameId,
      ownerEpoch,
      events: [voteEvent(gameId, decisionId)],
    });
    await seedSidecars(db, { gameId, ownerEpoch, decisionId });
    const priorOwnerEpoch = await insertOwner(db, gameId, { status: "closed" });
    await db.insert(schema.gameEvidenceManifests).values({
      id: randomUUID(),
      gameId,
      ownerEpoch: priorOwnerEpoch,
      decisionId,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: {},
    });
    await db.insert(schema.gamePromptReuseAppliedSources).values({
      id: randomUUID(),
      gameId,
      ownerEpoch: priorOwnerEpoch,
      decisionId,
      eventSequence: 0,
      comparable: false,
      reusableCharacters: 0,
      reusableTokenEstimate: 0,
    });
    await db.insert(schema.gameEvidenceManifests).values({
      id: randomUUID(),
      gameId,
      ownerEpoch,
      decisionId: null,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: {},
    });

    const otherGameId = await insertGame(db, { status: "in_progress" });
    const otherOwnerEpoch = await insertOwner(db, otherGameId);
    await seedSidecars(db, {
      gameId: otherGameId,
      ownerEpoch: otherOwnerEpoch,
      decisionId,
    });

    const first = await reconcileAcceptedActionCorrelations(db, { gameId, ownerEpoch });
    const second = await reconcileAcceptedActionCorrelations(db, { gameId, ownerEpoch });

    expect(first).toMatchObject({
      eligibleDecisionCount: 1,
      linkedDecisionCount: 1,
      conflictDecisionCount: 0,
      updatedManifestCount: 1,
      updatedCognitiveArtifactCount: 1,
      updatedPromptReuseSourceCount: 1,
      diagnostics: [],
    });
    expect(second).toMatchObject({
      eligibleDecisionCount: 1,
      linkedDecisionCount: 1,
      updatedManifestCount: 0,
      updatedCognitiveArtifactCount: 0,
      updatedPromptReuseSourceCount: 0,
      diagnostics: [],
    });

    const linkedManifest = (await db.select().from(schema.gameEvidenceManifests)
      .where(and(
        eq(schema.gameEvidenceManifests.gameId, gameId),
        eq(schema.gameEvidenceManifests.ownerEpoch, ownerEpoch),
        eq(schema.gameEvidenceManifests.decisionId, decisionId),
      )))[0]!;
    const otherManifest = (await db.select().from(schema.gameEvidenceManifests)
      .where(and(
        eq(schema.gameEvidenceManifests.gameId, otherGameId),
        eq(schema.gameEvidenceManifests.decisionId, decisionId),
      )))[0]!;
    const priorOwnerManifest = (await db.select().from(schema.gameEvidenceManifests)
      .where(and(
        eq(schema.gameEvidenceManifests.ownerEpoch, priorOwnerEpoch),
        eq(schema.gameEvidenceManifests.decisionId, decisionId),
      )))[0]!;
    const priorOwnerPromptSource = (await db.select()
      .from(schema.gamePromptReuseAppliedSources)
      .where(and(
        eq(schema.gamePromptReuseAppliedSources.ownerEpoch, priorOwnerEpoch),
        eq(schema.gamePromptReuseAppliedSources.decisionId, decisionId),
      )))[0]!;
    const legacyManifest = (await db.select().from(schema.gameEvidenceManifests)
      .where(and(
        eq(schema.gameEvidenceManifests.gameId, gameId),
        eq(schema.gameEvidenceManifests.ownerEpoch, ownerEpoch),
      ))).find((row) => row.decisionId === null)!;
    expect(linkedManifest.eventSequence).toBe(1);
    expect(otherManifest.eventSequence).toBeNull();
    expect(priorOwnerManifest.eventSequence).toBeNull();
    expect(priorOwnerPromptSource.eventSequence).toBe(0);
    expect(legacyManifest.eventSequence).toBeNull();

    const rollup = (await db.select().from(schema.gamePromptReuseRollups)
      .where(eq(schema.gamePromptReuseRollups.ownerEpoch, ownerEpoch)))[0]!;
    expect(rollup).toMatchObject({
      requestCount: 1,
      comparableCount: 1,
      reusableCharacters: 120,
      reusableTokenEstimate: 30,
      firstBreakCounts: { user_message: 1 },
      watermark: 1,
      coverage: "partial",
    });

    const inspection = await getDurableRunInspection(db, gameId);
    expect(inspection.ok).toBeTrue();
    if (!inspection.ok) throw new Error(inspection.error);
    expect(inspection.response.evidence.acceptedActionCorrelation).toEqual({
      eligibleDecisionCount: 1,
      linkedDecisionCount: 1,
      unresolvedDecisionCount: 0,
      missingCaptureDecisionCount: 0,
      conflictDecisionCount: 0,
    });
    expect(inspection.response.diagnostics).toEqual([]);
  });

  test("reconciles a durable flush from its newly inserted event subset", async () => {
    const gameId = await insertGame(db, { status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId);
    const firstDecisionId = randomUUID();
    const secondDecisionId = randomUUID();
    const firstEvent = voteEvent(gameId, firstDecisionId, 1);
    const secondEvent = voteEvent(gameId, secondDecisionId, 2);
    await appendGameEvents(db, { gameId, ownerEpoch, events: [firstEvent, secondEvent] });
    await seedSidecars(db, { gameId, ownerEpoch, decisionId: firstDecisionId });
    await seedSidecars(db, { gameId, ownerEpoch, decisionId: secondDecisionId });

    const result = await reconcileAcceptedActionCorrelations(db, {
      gameId,
      ownerEpoch,
      events: [secondEvent],
    });

    expect(result).toMatchObject({
      eligibleDecisionCount: 1,
      linkedDecisionCount: 1,
      updatedManifestCount: 1,
      updatedCognitiveArtifactCount: 1,
      updatedPromptReuseSourceCount: 1,
    });
    const manifests = await db.select().from(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.gameId, gameId));
    expect(manifests.find((row) => row.decisionId === firstDecisionId)?.eventSequence).toBeNull();
    expect(manifests.find((row) => row.decisionId === secondDecisionId)?.eventSequence).toBe(2);
  });

  test("refuses conflicting pre-existing links without changing canonical gameplay", async () => {
    const gameId = await insertGame(db, { status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId);
    const decisionId = randomUUID();
    await appendGameEvents(db, {
      gameId,
      ownerEpoch,
      events: [
        voteEvent(gameId, decisionId),
        {
          sequence: 2,
          gameId,
          round: 1,
          phase: Phase.VOTE,
          type: "round.started",
          timestamp: "2026-07-25T00:00:01.000Z",
          source: "engine",
          visibility: "public",
          payloadVersion: 1,
          sourcePointers: [],
          payload: { round: 1 },
        },
      ],
    });
    await seedSidecars(db, {
      gameId,
      ownerEpoch,
      decisionId,
      eventSequence: 2,
    });

    const result = await reconcileAcceptedActionCorrelations(db, { gameId, ownerEpoch });

    expect(result).toMatchObject({
      eligibleDecisionCount: 1,
      linkedDecisionCount: 0,
      conflictDecisionCount: 1,
      updatedManifestCount: 0,
      updatedCognitiveArtifactCount: 0,
      updatedPromptReuseSourceCount: 0,
      diagnostics: [{
        code: "accepted_action_correlation_conflict",
        decisionId,
        eventSequence: 1,
        conflictingSequences: [2],
      }],
    });
    const manifest = (await db.select().from(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.decisionId, decisionId)))[0]!;
    const eventRows = await db.select().from(schema.gameEvents)
      .where(eq(schema.gameEvents.gameId, gameId));
    const game = (await db.select().from(schema.games)
      .where(eq(schema.games.id, gameId)))[0]!;
    expect(manifest.eventSequence).toBe(2);
    expect(eventRows).toHaveLength(2);
    expect(game.status).toBe("in_progress");

    const inspection = await getDurableRunInspection(db, gameId);
    expect(inspection.ok).toBeTrue();
    if (!inspection.ok) throw new Error(inspection.error);
    expect(inspection.response.evidence.acceptedActionCorrelation).toMatchObject({
      eligibleDecisionCount: 1,
      linkedDecisionCount: 0,
      conflictDecisionCount: 1,
    });
    expect(inspection.response.diagnostics).toContainEqual({
      code: "accepted_action_correlation_conflict",
      severity: "error",
      message: "1 accepted decisions have conflicting event links",
    });
  });

  test("refuses sidecars whose trace action does not match the accepted action", async () => {
    const gameId = await insertGame(db, { status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId);
    const decisionId = randomUUID();
    await appendGameEvents(db, {
      gameId,
      ownerEpoch,
      events: [voteEvent(gameId, decisionId)],
    });
    await seedSidecars(db, {
      gameId,
      ownerEpoch,
      decisionId,
      action: "reflection",
    });

    const result = await reconcileAcceptedActionCorrelations(db, { gameId, ownerEpoch });

    expect(result).toMatchObject({
      eligibleDecisionCount: 1,
      linkedDecisionCount: 0,
      conflictDecisionCount: 1,
      updatedManifestCount: 0,
      updatedCognitiveArtifactCount: 0,
      updatedPromptReuseSourceCount: 0,
      diagnostics: [{
        code: "accepted_action_trace_action_mismatch",
        decisionId,
        eventSequence: 1,
        expectedAction: "vote",
        mismatchedSources: ["manifest", "cognition"],
      }],
    });
  });

  test("does not infer pre-migration links without a decision-bearing manifest", async () => {
    const gameId = await insertGame(db, { status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId);
    const decisionId = randomUUID();
    await appendGameEvents(db, {
      gameId,
      ownerEpoch,
      events: [voteEvent(gameId, decisionId)],
    });
    await seedSidecars(db, { gameId, ownerEpoch, decisionId });
    await db.delete(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.decisionId, decisionId));

    const result = await reconcileAcceptedActionCorrelations(db, { gameId, ownerEpoch });

    expect(result).toMatchObject({
      eligibleDecisionCount: 1,
      linkedDecisionCount: 0,
      missingCaptureDecisionCount: 1,
      updatedManifestCount: 0,
      updatedCognitiveArtifactCount: 0,
      updatedPromptReuseSourceCount: 0,
    });
    const cognition = (await loadPayloads(db.select().from(schema.gameCognitiveArtifacts)
      .where(eq(schema.gameCognitiveArtifacts.decisionId, decisionId))))[0]!;
    const promptSource = (await db.select()
      .from(schema.gamePromptReuseAppliedSources)
      .where(eq(schema.gamePromptReuseAppliedSources.decisionId, decisionId)))[0]!;
    expect(cognition.eventSequence).toBeNull();
    expect(promptSource.eventSequence).toBe(0);
  });

  test("repairs missing current-owner capture on a later empty flush", async () => {
    const gameId = await insertGame(db, { status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId);
    const decisionId = randomUUID();

    await appendDurableEventsAndPublishWatchState(db, {
      gameId,
      ownerEpoch,
      events: [voteEvent(gameId, decisionId)],
    });
    const degradedOwner = (await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch)))[0]!;
    expect(degradedOwner).toMatchObject({
      kernelHealth: "degraded",
      failureReason: expect.stringContaining("accepted_action_correlation_failed"),
    });
    const degradedInspection = await getDurableRunInspection(db, gameId);
    expect(degradedInspection.ok).toBeTrue();
    if (!degradedInspection.ok) throw new Error(degradedInspection.error);
    expect(degradedInspection.response.evidence.acceptedActionCorrelation).toMatchObject({
      eligibleDecisionCount: 1,
      linkedDecisionCount: 0,
      missingCaptureDecisionCount: 1,
    });
    expect(degradedInspection.response.diagnostics).toContainEqual({
      code: "accepted_action_private_capture_missing",
      severity: "warning",
      message: "1 accepted decisions are missing private capture rows",
    });

    await seedSidecars(db, { gameId, ownerEpoch, decisionId });
    await appendDurableEventsAndPublishWatchState(db, {
      gameId,
      ownerEpoch,
      events: [],
    });

    const manifest = (await db.select().from(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.decisionId, decisionId)))[0]!;
    const recoveredOwner = (await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch)))[0]!;
    expect(manifest.eventSequence).toBe(1);
    expect(recoveredOwner).toMatchObject({
      kernelHealth: "healthy",
      failureReason: null,
    });
  });

  test("final lifecycle reconciliation repairs a closed owner after delayed capture", async () => {
    const gameId = await insertGame(db, { status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId);
    const decisionId = randomUUID();

    await appendDurableEventsAndPublishWatchState(db, {
      gameId,
      ownerEpoch,
      events: [voteEvent(gameId, decisionId)],
    });
    await db.update(schema.gameRunOwners)
      .set({ status: "closed" })
      .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch));
    await seedSidecars(db, { gameId, ownerEpoch, decisionId });

    await reconcileAcceptedActionsForLifecycle(db, { gameId, ownerEpoch });

    const manifest = (await db.select().from(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.decisionId, decisionId)))[0]!;
    const recoveredOwner = (await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch)))[0]!;
    expect(manifest.eventSequence).toBe(1);
    expect(recoveredOwner).toMatchObject({
      status: "closed",
      kernelHealth: "healthy",
      failureReason: null,
    });
  });

  test("preserves unrelated owner degradation through correlation failure and recovery", async () => {
    const gameId = await insertGame(db, { status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId);
    const decisionId = randomUUID();
    await db.update(schema.gameRunOwners)
      .set({
        kernelHealth: "degraded",
        failureReason: "checkpoint_write_failed: sentinel",
      })
      .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch));

    await appendDurableEventsAndPublishWatchState(db, {
      gameId,
      ownerEpoch,
      events: [voteEvent(gameId, decisionId)],
    });
    await seedSidecars(db, { gameId, ownerEpoch, decisionId });
    await appendDurableEventsAndPublishWatchState(db, {
      gameId,
      ownerEpoch,
      events: [],
    });

    const owner = (await db.select().from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch)))[0]!;
    expect(owner).toMatchObject({
      kernelHealth: "degraded",
      failureReason: "checkpoint_write_failed: sentinel",
    });
  });

  test("reconciles the final accepted jury vote before the winner early return", async () => {
    const gameId = await insertGame(db, { status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId);
    const decisionId = randomUUID();
    await seedSidecars(db, {
      gameId,
      ownerEpoch,
      decisionId,
      action: "jury-vote",
    });
    await db.update(schema.gameCognitiveArtifacts)
      .set({ action: "jury-vote", phase: Phase.JURY_VOTE, round: 4 })
      .where(eq(schema.gameCognitiveArtifacts.decisionId, decisionId));

    await appendDurableEventsAndPublishWatchState(db, {
      gameId,
      ownerEpoch,
      events: [
        {
          sequence: 1,
          gameId,
          round: 4,
          phase: Phase.JURY_VOTE,
          type: "jury.vote_cast",
          timestamp: "2026-07-25T00:00:00.000Z",
          source: "engine",
          visibility: "producer",
          payloadVersion: 1,
          sourcePointers: [{
            kind: "agent_turn",
            actorId: "juror",
            action: "jury-vote",
            round: 4,
            phase: Phase.JURY_VOTE,
            decisionId,
          }],
          payload: { jurorId: "juror", finalistId: "atlas" },
        },
        {
          sequence: 2,
          gameId,
          round: 4,
          phase: Phase.JURY_VOTE,
          type: "jury.winner_determined",
          timestamp: "2026-07-25T00:00:01.000Z",
          source: "engine",
          visibility: "system",
          payloadVersion: 1,
          sourcePointers: [],
          payload: {
            tally: { votes: { juror: "atlas" } },
            winnerId: "atlas",
            method: "majority",
            voteCounts: [],
          },
        },
      ],
    });

    const manifest = (await db.select().from(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.decisionId, decisionId)))[0]!;
    expect(manifest.eventSequence).toBe(1);
  });

  test("links every accepted Tribunal tiebreak decision to its shared resolution", async () => {
    const gameId = await insertGame(db, { status: "in_progress" });
    const ownerEpoch = await insertOwner(db, gameId);
    const decisionIds = [randomUUID(), randomUUID()];
    for (const decisionId of decisionIds) {
      await seedSidecars(db, {
        gameId,
        ownerEpoch,
        decisionId,
        action: "tribunal-jury-tiebreaker-vote",
      });
    }

    await appendGameEvents(db, {
      gameId,
      ownerEpoch,
      events: [{
        sequence: 1,
        gameId,
        round: 4,
        phase: Phase.VOTE,
        type: "endgame.elimination_resolved",
        timestamp: "2026-07-25T00:00:00.000Z",
        source: "engine",
        visibility: "producer",
        payloadVersion: 1,
        sourcePointers: decisionIds.map((decisionId, index) => ({
          kind: "agent_turn" as const,
          actorId: `juror-${index + 1}`,
          action: "tribunal-jury-tiebreaker-vote",
          round: 4,
          phase: Phase.VOTE,
          decisionId,
        })),
        payload: {
          stage: "tribunal",
          tally: { votes: {} },
          juryTiebreakerVotes: {
            "juror-1": "atlas",
            "juror-2": "atlas",
          },
          eliminated: "atlas",
          method: "jury_tiebreaker",
        },
      }],
    });

    const result = await reconcileAcceptedActionCorrelations(db, { gameId, ownerEpoch });

    expect(result).toMatchObject({
      eligibleDecisionCount: 2,
      linkedDecisionCount: 2,
      conflictDecisionCount: 0,
      updatedManifestCount: 2,
      updatedCognitiveArtifactCount: 2,
      updatedPromptReuseSourceCount: 2,
      diagnostics: [],
    });
    const manifests = await db.select().from(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.gameId, gameId));
    expect(manifests.map((row) => row.eventSequence)).toEqual([1, 1]);
  });
});
