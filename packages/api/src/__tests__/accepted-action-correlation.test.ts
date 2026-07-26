import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { Phase, type CanonicalGameEvent } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  reconcileAcceptedActionCorrelations,
} from "../services/accepted-action-correlation.js";
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
  await db.insert(schema.gameCognitiveArtifacts).values({
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
  });
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

describe("accepted action correlation", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
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
    const cognition = (await db.select().from(schema.gameCognitiveArtifacts)
      .where(eq(schema.gameCognitiveArtifacts.decisionId, decisionId)))[0]!;
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
