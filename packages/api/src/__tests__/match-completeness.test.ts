/**
 * U6 — Match manifest and lane completeness (table-driven).
 *
 * Covers overall-state derivation, Season 0 behavior, authorization denial,
 * formal-speech parity findings, live watermarks, and follow-up capability shapes.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  buildFormalSpeechParity,
  extractFormalSpeechEventObservations,
  formalSpeechObservationFromTranscriptRow,
} from "../services/formal-speech-parity.js";
import {
  composeMatchManifest,
  deriveOverallState,
  isLiveGameStatus,
  readMatchManifest,
  type MatchCompletenessComposeInput,
  type MatchCognitionLaneStatus,
  type MatchFactLaneStatus,
  type MatchFollowUpCapabilityKind,
  type MatchLaneAuthorization,
  type MatchLaneCompleteness,
  type MatchOverallState,
  type MatchTranscriptLaneStatus,
} from "../services/match-completeness.js";
import { buildGameCompletionSettlementSummary } from "../services/game-completion-settlement.js";
import { buildFinaleIntegrity } from "../services/game-durable-run.js";
import {
  FORMAL_SPEECH_CAPTURE_VERSION,
  initialGameTranscriptStateValues,
  TRANSCRIPT_CAPTURE_VERSION,
} from "../services/transcript-capture.js";
import { COGNITIVE_ARTIFACT_CAPTURE_VERSION } from "../services/cognitive-artifact-writer.js";
import { serializeTranscriptEntry } from "../services/transcript-serialization.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame } from "./durable-run-test-utils.js";
import { buildFormalSpeechCorrelationKey, Phase } from "@influence/engine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function emptySettlement() {
  return buildGameCompletionSettlementSummary(null);
}

function baseGame(overrides: Partial<MatchCompletenessComposeInput["game"]> = {}) {
  return {
    id: "game-1",
    slug: "game-1",
    status: "completed",
    transcriptCaptureVersion: TRANSCRIPT_CAPTURE_VERSION,
    formalSpeechCaptureVersion: FORMAL_SPEECH_CAPTURE_VERSION,
    cognitiveArtifactCaptureVersion: COGNITIVE_ARTIFACT_CAPTURE_VERSION,
    ...overrides,
  };
}

function ownerAccess(overrides: Partial<MatchCompletenessComposeInput["access"]> = {}) {
  return {
    hasCanonicalAccess: true,
    hasParticipatingOwnership: true,
    isCreator: true,
    ownedSeatCount: 1,
    ...overrides,
  };
}

function creatorOnlyAccess() {
  return ownerAccess({
    hasParticipatingOwnership: false,
    isCreator: true,
    ownedSeatCount: 0,
  });
}

function healthyFacts(): MatchCompletenessComposeInput["eventLog"] {
  return { status: "complete", lastTrustedSequence: 42, eventCount: 42 };
}

function healthyProjection(): MatchCompletenessComposeInput["projection"] {
  return { status: "complete", lastSequence: 42, settlementSafe: false };
}

function settledTranscriptState() {
  return {
    gameId: "game-1",
    captureVersion: TRANSCRIPT_CAPTURE_VERSION,
    ownerEpoch: "epoch-1",
    durableEventSequence: 42,
    durableEventHash: "sha256:abc",
    durableSequence: 10,
    durableCount: 10,
    prefixDigest: "sha256:digest",
    terminalState: "complete",
    terminalCount: 10,
    terminalDigest: "sha256:digest",
  };
}

function liveTranscriptState(watermark = 7) {
  return {
    ...settledTranscriptState(),
    durableSequence: watermark,
    durableCount: watermark,
    terminalState: "unset",
    terminalCount: null,
    terminalDigest: null,
  };
}

function emptyParity() {
  return buildFormalSpeechParity({
    formalSpeechCaptureVersion: FORMAL_SPEECH_CAPTURE_VERSION,
    events: [],
    transcriptObservations: [],
    judgmentDetected: false,
  });
}

function completeFinale() {
  return buildFinaleIntegrity([
    {
      type: "judgment.speech_recorded",
      payload: { speechKind: "opening_statement", playerId: "a", text: "o1", provenance: "agent" },
    },
    {
      type: "judgment.speech_recorded",
      payload: { speechKind: "opening_statement", playerId: "b", text: "o2", provenance: "agent" },
    },
    {
      type: "judgment.speech_recorded",
      payload: { speechKind: "closing_argument", playerId: "a", text: "c1", provenance: "agent" },
    },
    {
      type: "judgment.speech_recorded",
      payload: { speechKind: "closing_argument", playerId: "b", text: "c2", provenance: "timeout" },
    },
    {
      type: "jury.winner_determined",
      payload: { winnerId: "a", method: "majority", tally: { votes: {} }, voteCounts: [] },
    },
  ]);
}

function compose(overrides: Partial<MatchCompletenessComposeInput> = {}) {
  const input: MatchCompletenessComposeInput = {
    game: baseGame(),
    access: ownerAccess(),
    eventLog: healthyFacts(),
    projection: healthyProjection(),
    completionSettlement: emptySettlement(),
    transcriptState: settledTranscriptState(),
    privateLaneAuthorized: true,
    huddlePrerequisite: {
      sessions: [],
      trustedPrefixHealthy: true,
      lastTrustedSequence: 42,
      omittedUntrustedSessionCount: 0,
    },
    formalSpeechParity: emptyParity(),
    finaleIntegrity: { judgmentDetected: false, status: "not_applicable", openingStatementCount: 0, closingArgumentCount: 0, expectedOpeningStatements: null, expectedClosingArguments: null, findings: [] },
    ...overrides,
  };
  return composeMatchManifest(input);
}

// ---------------------------------------------------------------------------
// Pure composition / overall state
// ---------------------------------------------------------------------------

describe("match-completeness compose (table-driven)", () => {
  const cases: Array<{
    name: string;
    overrides: Partial<MatchCompletenessComposeInput>;
    expectOverall: MatchOverallState;
    expectTranscriptCompleteness?: MatchLaneCompleteness;
    expectFactCompleteness?: MatchLaneCompleteness;
    expectCognitionAuth?: MatchLaneAuthorization;
    expectTranscriptAuth?: MatchLaneAuthorization;
    capabilityKinds?: MatchFollowUpCapabilityKind[];
    absentCapabilityKinds?: MatchFollowUpCapabilityKind[];
  }> = [
    {
      name: "completed healthy facts + settled transcript → complete even without cognition activity",
      overrides: {
        game: baseGame({ status: "completed" }),
        formalSpeechParity: emptyParity(),
        finaleIntegrity: completeFinale(),
      },
      expectOverall: "complete",
      expectTranscriptCompleteness: "complete",
      expectFactCompleteness: "complete",
      capabilityKinds: ["match_transcript", "canonical_events", "owned_match_cognition", "postgame_analysis"],
    },
    {
      name: "live game → live_current through watermarks, never complete",
      overrides: {
        game: baseGame({ status: "in_progress" }),
        transcriptState: liveTranscriptState(5),
        eventLog: { status: "complete", lastTrustedSequence: 12, eventCount: 12 },
        projection: { status: "complete", lastSequence: 12, settlementSafe: false },
      },
      expectOverall: "live_current",
      expectTranscriptCompleteness: "current",
      expectFactCompleteness: "current",
      absentCapabilityKinds: ["postgame_analysis"],
    },
    {
      name: "creator-only → fact authorized, transcript/cognition denied without hidden counts",
      overrides: {
        access: creatorOnlyAccess(),
        privateLaneAuthorized: false,
        huddlePrerequisite: null,
        game: baseGame({ status: "completed" }),
      },
      expectOverall: "watchable_with_diagnostics",
      expectTranscriptAuth: "denied",
      expectCognitionAuth: "denied",
      expectFactCompleteness: "complete",
      capabilityKinds: ["canonical_events"],
      absentCapabilityKinds: ["match_transcript", "owned_match_cognition"],
    },
    {
      name: "Season 0 completed with transcript → watchable_with_diagnostics + legacy parity",
      overrides: {
        game: baseGame({
          status: "completed",
          transcriptCaptureVersion: 0,
          formalSpeechCaptureVersion: 0,
          cognitiveArtifactCaptureVersion: 0,
        }),
        transcriptState: null,
        formalSpeechParity: buildFormalSpeechParity({
          formalSpeechCaptureVersion: 0,
          events: [],
          transcriptObservations: [],
          judgmentDetected: true,
        }),
        finaleIntegrity: buildFinaleIntegrity([
          {
            type: "jury.winner_determined",
            payload: { winnerId: "a", method: "majority", tally: { votes: {} }, voteCounts: [] },
          },
        ]),
      },
      expectOverall: "watchable_with_diagnostics",
      expectTranscriptCompleteness: "partial",
    },
    {
      name: "invalid event log → degraded overall; speech gap does not reclassify as only issue",
      overrides: {
        eventLog: { status: "invalid", lastTrustedSequence: 3, eventCount: 10 },
        projection: { status: "incomplete", lastSequence: 3, settlementSafe: false },
      },
      expectOverall: "degraded",
      expectFactCompleteness: "degraded",
    },
    {
      name: "huddle prerequisite degraded → transcript partial, facts remain healthy",
      overrides: {
        huddlePrerequisite: {
          sessions: [],
          trustedPrefixHealthy: false,
          lastTrustedSequence: 2,
          omittedUntrustedSessionCount: 1,
        },
      },
      expectOverall: "watchable_with_diagnostics",
      expectTranscriptCompleteness: "partial",
      expectFactCompleteness: "complete",
    },
    {
      name: "terminal transcript partial → watchable_with_diagnostics",
      overrides: {
        transcriptState: {
          ...settledTranscriptState(),
          terminalState: "partial",
          terminalCount: 8,
          terminalDigest: "sha256:other",
        },
      },
      expectOverall: "watchable_with_diagnostics",
      expectTranscriptCompleteness: "partial",
    },
    {
      name: "missing transcript state on modern capture → degraded/unavailable path",
      overrides: {
        transcriptState: null,
      },
      expectOverall: "degraded",
      expectTranscriptCompleteness: "unavailable",
    },
    {
      name: "cognition capture version 0 → cognition unavailable does not prevent complete",
      overrides: {
        game: baseGame({
          status: "completed",
          cognitiveArtifactCaptureVersion: 0,
        }),
      },
      expectOverall: "complete",
      expectCognitionAuth: "authorized",
      absentCapabilityKinds: ["owned_match_cognition"],
    },
  ];

  for (const tc of cases) {
    test(tc.name, () => {
      const manifest = compose(tc.overrides);
      expect(manifest.overall.state).toBe(tc.expectOverall);
      if (tc.expectTranscriptCompleteness) {
        expect(manifest.lanes.transcript.completeness).toBe(tc.expectTranscriptCompleteness);
      }
      if (tc.expectFactCompleteness) {
        expect(manifest.lanes.facts.completeness).toBe(tc.expectFactCompleteness);
      }
      if (tc.expectTranscriptAuth) {
        expect(manifest.lanes.transcript.authorization).toBe(tc.expectTranscriptAuth);
      }
      if (tc.expectCognitionAuth) {
        expect(manifest.lanes.cognition.authorization).toBe(tc.expectCognitionAuth);
      }
      if (tc.capabilityKinds) {
        const kinds = new Set(manifest.nextReads.map((c) => c.kind));
        for (const kind of tc.capabilityKinds) {
          expect(kinds.has(kind)).toBe(true);
        }
      }
      if (tc.absentCapabilityKinds) {
        const kinds = new Set(manifest.nextReads.map((c) => c.kind));
        for (const kind of tc.absentCapabilityKinds) {
          expect(kinds.has(kind)).toBe(false);
        }
      }
      // Never complete on live
      if (manifest.overall.live) {
        expect(manifest.overall.state).not.toBe("complete");
        expect(manifest.lanes.facts.completeness).not.toBe("complete");
        expect(manifest.lanes.transcript.completeness).not.toBe("complete");
      }
      // Domain capabilities never carry MCP tool name fields
      for (const cap of manifest.nextReads) {
        expect(cap).not.toHaveProperty("toolName");
        expect(cap).not.toHaveProperty("tool");
        expect(typeof cap.starterArguments.gameIdOrSlug).toBe("string");
      }
      // Lanes remain distinct objects
      expect(manifest.lanes.facts.authority).toBe("canonical_facts");
      expect(manifest.lanes.transcript.authority).toBe("transcript");
      expect(manifest.lanes.cognition.authority).toBe("cognition");
      expect(manifest.formalSpeechParity.authority).toBe("formal_speech_parity");
      // Cognition optional never exposes owned seat IDs
      expect(manifest.access).not.toHaveProperty("ownedPlayerIds");
      expect(typeof manifest.access.ownedSeatCount).toBe("number");
    });
  }

  test("live watermark surfaces exact durable sequence", () => {
    const manifest = compose({
      game: baseGame({ status: "in_progress" }),
      transcriptState: liveTranscriptState(9),
      eventLog: { status: "complete", lastTrustedSequence: 20, eventCount: 20 },
    });
    expect(manifest.lanes.transcript.readThrough).toMatchObject({
      mode: "live_watermark",
      throughEntrySequence: 9,
    });
    expect(manifest.lanes.facts.lastTrustedSequence).toBe(20);
    expect(manifest.overall.state).toBe("live_current");
  });

  test("denied private lanes never invent transcript capability starter args", () => {
    const manifest = compose({
      access: creatorOnlyAccess(),
      privateLaneAuthorized: false,
      huddlePrerequisite: null,
    });
    expect(manifest.lanes.transcript.followUpCapabilities).toEqual([]);
    expect(manifest.lanes.cognition.followUpCapabilities).toEqual([]);
    expect(manifest.lanes.transcript.readThrough.throughEntrySequence).toBeNull();
    expect(manifest.lanes.transcript.huddlePrerequisite.status).toBe("denied");
  });
});

// ---------------------------------------------------------------------------
// Formal speech parity
// ---------------------------------------------------------------------------

describe("formal-speech-parity", () => {
  test("Season 0 with Judgment reports known_legacy_gap and missing_event without inventing expected counts", () => {
    const parity = buildFormalSpeechParity({
      formalSpeechCaptureVersion: 0,
      events: [],
      transcriptObservations: [],
      judgmentDetected: true,
    });
    expect(parity.status).toBe("known_legacy_gap");
    expect(parity.expectedAuthorizedCount).toBeNull();
    expect(parity.prerequisiteStatus).toBe("legacy");
    expect(parity.findings.map((f) => f.code).sort()).toEqual([
      "known_legacy_gap",
      "missing_event",
    ]);
    // Findings never carry speech prose
    for (const finding of parity.findings) {
      expect(JSON.stringify(finding)).not.toContain("I deserve");
    }
  });

  test("current capture: event without transcript → missing_transcript", () => {
    const key = buildFormalSpeechCorrelationKey({
      kind: "closing_argument",
      playerId: "player-a",
      round: 4,
      phase: Phase.CLOSING_ARGUMENTS,
    });
    const parity = buildFormalSpeechParity({
      formalSpeechCaptureVersion: 1,
      events: [
        {
          sequence: 1,
          round: 4,
          phase: Phase.CLOSING_ARGUMENTS,
          type: "judgment.speech_recorded",
          payload: {
            speechKind: "closing_argument",
            playerId: "player-a",
            text: "I deserve the win",
            provenance: "agent",
          },
        },
        {
          sequence: 2,
          round: 4,
          phase: Phase.JURY_VOTE,
          type: "jury.winner_determined",
          payload: { winnerId: "player-a", method: "majority", tally: { votes: {} }, voteCounts: [] },
        },
      ],
      transcriptObservations: [],
      judgmentDetected: true,
    });
    expect(parity.findings.some((f) => f.code === "missing_transcript")).toBe(true);
    expect(parity.findings.some((f) => f.correlationKey === key)).toBe(true);
    expect(parity.status).toBe("partial");
    // Prose not on findings
    expect(JSON.stringify(parity.findings)).not.toContain("I deserve the win");
  });

  test("current capture: transcript without event → missing_event", () => {
    const key = buildFormalSpeechCorrelationKey({
      kind: "plea",
      playerId: "player-b",
      round: 4,
      phase: Phase.PLEA,
    });
    const parity = buildFormalSpeechParity({
      formalSpeechCaptureVersion: 1,
      events: [],
      transcriptObservations: [
        {
          correlationKey: key,
          text: "Please spare me",
          phase: Phase.PLEA,
          round: 4,
          speakerPlayerId: "player-b",
          entrySequence: 3,
          rowId: 99,
        },
      ],
      judgmentDetected: false,
    });
    expect(parity.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_event", correlationKey: key, lane: "endgame" }),
      ]),
    );
  });

  test("current capture: matching keys with agreeing text → complete", () => {
    const openA = buildFormalSpeechCorrelationKey({
      kind: "opening_statement",
      playerId: "a",
      round: 4,
      phase: Phase.OPENING_STATEMENTS,
    });
    const openB = buildFormalSpeechCorrelationKey({
      kind: "opening_statement",
      playerId: "b",
      round: 4,
      phase: Phase.OPENING_STATEMENTS,
    });
    const closeA = buildFormalSpeechCorrelationKey({
      kind: "closing_argument",
      playerId: "a",
      round: 4,
      phase: Phase.CLOSING_ARGUMENTS,
    });
    const closeB = buildFormalSpeechCorrelationKey({
      kind: "closing_argument",
      playerId: "b",
      round: 4,
      phase: Phase.CLOSING_ARGUMENTS,
    });
    const speeches = [
      { key: openA, kind: "opening_statement", playerId: "a", phase: Phase.OPENING_STATEMENTS, text: "open a" },
      { key: openB, kind: "opening_statement", playerId: "b", phase: Phase.OPENING_STATEMENTS, text: "open b" },
      { key: closeA, kind: "closing_argument", playerId: "a", phase: Phase.CLOSING_ARGUMENTS, text: "close a" },
      { key: closeB, kind: "closing_argument", playerId: "b", phase: Phase.CLOSING_ARGUMENTS, text: "close b" },
    ] as const;

    const events: Array<{
      sequence: number;
      round: number;
      phase: string;
      type: string;
      payload: Record<string, unknown>;
    }> = speeches.map((s, i) => ({
      sequence: i + 1,
      round: 4,
      phase: s.phase,
      type: "judgment.speech_recorded",
      payload: {
        speechKind: s.kind,
        playerId: s.playerId,
        text: s.text,
        provenance: "agent",
      },
    }));
    events.push({
      sequence: 5,
      round: 4,
      phase: Phase.JURY_VOTE,
      type: "jury.winner_determined",
      payload: { winnerId: "a", method: "majority", tally: { votes: {} }, voteCounts: [] },
    });

    const transcriptObservations = speeches.map((s, i) => ({
      correlationKey: s.key,
      text: s.text,
      phase: s.phase,
      round: 4,
      speakerPlayerId: s.playerId,
      entrySequence: i + 1,
      rowId: i + 1,
    }));

    const parity = buildFormalSpeechParity({
      formalSpeechCaptureVersion: 1,
      events,
      transcriptObservations,
      judgmentDetected: true,
    });
    expect(parity.status).toBe("complete");
    expect(parity.findings).toEqual([]);
    expect(parity.expectedAuthorizedCount).toBe(4);
  });

  test("text mismatch → degraded with mismatch finding", () => {
    const key = buildFormalSpeechCorrelationKey({
      kind: "plea",
      playerId: "p1",
      round: 3,
      phase: Phase.PLEA,
    });
    const parity = buildFormalSpeechParity({
      formalSpeechCaptureVersion: 1,
      events: [
        {
          sequence: 1,
          round: 3,
          phase: Phase.PLEA,
          type: "endgame.speech_recorded",
          payload: {
            speechKind: "plea",
            playerId: "p1",
            text: "raw plea",
            provenance: "agent",
            correlationKey: key,
          },
        },
      ],
      transcriptObservations: [
        {
          correlationKey: key,
          text: "totally different dialogue",
          phase: Phase.PLEA,
          round: 3,
          speakerPlayerId: "p1",
          entrySequence: 1,
          rowId: 1,
        },
      ],
      judgmentDetected: false,
    });
    expect(parity.status).toBe("degraded");
    expect(parity.findings.map((f) => f.code)).toContain("mismatch");
  });

  test("extractFormalSpeechEventObservations reconstructs judgment keys", () => {
    const obs = extractFormalSpeechEventObservations([
      {
        sequence: 1,
        round: 4,
        phase: Phase.OPENING_STATEMENTS,
        type: "judgment.speech_recorded",
        payload: {
          speechKind: "opening_statement",
          playerId: "atlas",
          text: "hello",
          provenance: "agent",
        },
      },
    ]);
    expect(obs).toHaveLength(1);
    expect(obs[0]!.correlationKey).toBe(
      buildFormalSpeechCorrelationKey({
        kind: "opening_statement",
        playerId: "atlas",
        round: 4,
        phase: Phase.OPENING_STATEMENTS,
      }),
    );
  });

  test("formalSpeechObservationFromTranscriptRow ignores ordinary dialogue", () => {
    expect(
      formalSpeechObservationFromTranscriptRow({
        id: 1,
        entrySequence: 1,
        round: 1,
        phase: "LOBBY",
        text: "hi",
        speakerPlayerId: "x",
        safeContext: {},
      }),
    ).toBeNull();

    const key = "endgame:plea:r4:PLEA:p1";
    const obs = formalSpeechObservationFromTranscriptRow({
      id: 2,
      entrySequence: 2,
      round: 4,
      phase: "PLEA",
      text: "plea text",
      speakerPlayerId: "p1",
      safeContext: { formalSpeechCorrelationKey: key },
    });
    expect(obs?.correlationKey).toBe(key);
  });
});

// ---------------------------------------------------------------------------
// deriveOverallState edge cases
// ---------------------------------------------------------------------------

describe("deriveOverallState", () => {
  function laneFacts(overrides: Partial<MatchFactLaneStatus> = {}): MatchFactLaneStatus {
    return {
      authority: "canonical_facts",
      authorization: "authorized",
      availability: "available",
      completeness: "complete",
      captureVersion: null,
      eventLogStatus: "complete",
      projectionStatus: "complete",
      lastTrustedSequence: 1,
      projectionLastSequence: 1,
      settlementSafeProjection: false,
      diagnostics: [],
      followUpCapabilities: [],
      ...overrides,
    };
  }
  function laneTx(overrides: Partial<MatchTranscriptLaneStatus> = {}): MatchTranscriptLaneStatus {
    return {
      authority: "transcript",
      authorization: "authorized",
      availability: "available",
      completeness: "complete",
      captureVersion: 1,
      readThrough: {
        mode: "completed_terminal",
        throughEntrySequence: 1,
        durableEventSequence: 1,
        terminalState: "complete",
        durableCount: 1,
        terminalCount: 1,
      },
      huddlePrerequisite: {
        status: "healthy",
        trustedPrefixHealthy: true,
        lastTrustedSequence: 1,
      },
      limitations: [],
      diagnostics: [],
      followUpCapabilities: [],
      ...overrides,
    };
  }
  function laneCog(overrides: Partial<MatchCognitionLaneStatus> = {}): MatchCognitionLaneStatus {
    return {
      authority: "cognition",
      authorization: "authorized",
      availability: "unavailable",
      completeness: "unavailable",
      captureVersion: 0,
      optional: true,
      diagnostics: [],
      followUpCapabilities: [],
      ...overrides,
    };
  }

  test("optional cognition unavailable does not block complete", () => {
    expect(
      deriveOverallState({
        live: false,
        privateAuthorized: true,
        facts: laneFacts(),
        transcript: laneTx(),
        cognition: laneCog(),
        formalSpeechParity: emptyParity(),
      }),
    ).toBe("complete");
  });

  test("isLiveGameStatus only for in_progress", () => {
    expect(isLiveGameStatus("in_progress")).toBe(true);
    expect(isLiveGameStatus("completed")).toBe(false);
    expect(isLiveGameStatus("waiting")).toBe(false);
    expect(isLiveGameStatus("suspended")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: readMatchManifest against DB
// ---------------------------------------------------------------------------

describe("readMatchManifest integration", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("owner of live modern game gets live_current with watermarks and capabilities", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      walletAddress: `0x${userId.replace(/-/g, "").slice(0, 40)}`,
    });
    const gameId = await insertGame(db, {
      slug: `live-manifest-${randomUUID().slice(0, 8)}`,
      status: "in_progress",
    });
    await db.update(schema.games).set({
      transcriptCaptureVersion: 1,
      formalSpeechCaptureVersion: 1,
      cognitiveArtifactCaptureVersion: 1,
    }).where(eq(schema.games.id, gameId));
    await db.insert(schema.gameTranscriptStates).values({
      ...initialGameTranscriptStateValues(gameId, 1),
      durableSequence: 3,
      durableCount: 3,
      durableEventSequence: 5,
    });
    await db.insert(schema.gamePlayers).values({
      id: randomUUID(),
      gameId,
      userId,
      persona: JSON.stringify({ name: "Owner", personality: "careful" }),
      agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
    });

    const result = await readMatchManifest(db, { gameIdOrSlug: gameId }, { subjectUserId: userId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.overall.state).toBe("live_current");
    expect(result.manifest.lanes.transcript.readThrough.throughEntrySequence).toBe(3);
    expect(result.manifest.lanes.transcript.completeness).toBe("current");
    expect(result.manifest.nextReads.some((c) => c.kind === "match_transcript")).toBe(true);
    expect(result.manifest.nextReads.some((c) => c.kind === "owned_match_cognition")).toBe(true);
    for (const cap of result.manifest.nextReads) {
      expect(cap.starterArguments.gameIdOrSlug).toBeTruthy();
      expect(JSON.stringify(cap)).not.toMatch(/read_match_|toolName/);
    }
  });

  test("creator-only completed game denies private lanes", async () => {
    const creatorId = randomUUID();
    await db.insert(schema.users).values({ id: creatorId });
    const gameId = await insertGame(db, {
      slug: `creator-manifest-${randomUUID().slice(0, 8)}`,
      status: "completed",
    });
    await db.update(schema.games).set({
      createdById: creatorId,
      transcriptCaptureVersion: 1,
      formalSpeechCaptureVersion: 1,
      cognitiveArtifactCaptureVersion: 1,
    }).where(eq(schema.games.id, gameId));
    await db.insert(schema.gameTranscriptStates).values({
      ...initialGameTranscriptStateValues(gameId, 1),
      durableSequence: 2,
      durableCount: 2,
      terminalState: "complete",
      terminalCount: 2,
      terminalDigest: initialGameTranscriptStateValues(gameId, 1).prefixDigest,
    });

    const result = await readMatchManifest(db, { gameIdOrSlug: gameId }, { subjectUserId: creatorId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.lanes.transcript.authorization).toBe("denied");
    expect(result.manifest.lanes.cognition.authorization).toBe("denied");
    expect(result.manifest.lanes.facts.authorization).toBe("authorized");
    expect(result.manifest.access.ownedSeatCount).toBe(0);
    expect(result.manifest.nextReads.some((c) => c.kind === "match_transcript")).toBe(false);
  });

  test("Season 0 owner gets legacy parity + system limitation without counts", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      walletAddress: `0x${userId.replace(/-/g, "").slice(0, 40)}`,
    });
    const gameId = await insertGame(db, {
      slug: `s0-manifest-${randomUUID().slice(0, 8)}`,
      status: "completed",
    });
    await db.update(schema.games).set({
      transcriptCaptureVersion: 0,
      formalSpeechCaptureVersion: 0,
      cognitiveArtifactCaptureVersion: 0,
    }).where(eq(schema.games.id, gameId));
    const playerId = randomUUID();
    await db.insert(schema.gamePlayers).values({
      id: playerId,
      gameId,
      userId,
      persona: JSON.stringify({ name: "LegacyOwner", personality: "careful" }),
      agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
    });
    // Legacy public closing-argument-style row (no modern fields)
    await db.insert(schema.transcripts).values({
      gameId,
      round: 4,
      phase: "CLOSING_ARGUMENTS",
      fromPlayerId: "LegacyOwner",
      scope: "public",
      text: "My closing argument as spoken in Season 0",
      thinking: null,
      timestamp: Date.now(),
    });

    const result = await readMatchManifest(db, { gameIdOrSlug: gameId }, { subjectUserId: userId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.game.transcriptCaptureVersion).toBe(0);
    expect(result.manifest.formalSpeechParity.status).toBe("known_legacy_gap");
    expect(result.manifest.formalSpeechParity.expectedAuthorizedCount).toBeNull();
    expect(
      result.manifest.lanes.transcript.limitations.some(
        (l) => l.code === "legacy_system_dialogue_unclassified",
      ),
    ).toBe(true);
    // No hidden row-count fields on limitations (message may say "without counts")
    for (const lim of result.manifest.lanes.transcript.limitations) {
      expect(lim).not.toHaveProperty("omittedCount");
      expect(lim).not.toHaveProperty("rowCount");
      expect(lim).not.toHaveProperty("hiddenCount");
    }
    expect(result.manifest.overall.state).toBe("watchable_with_diagnostics");
  });

  test("inaccessible game is non-enumerating not_accessible", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({ id: userId });
    const result = await readMatchManifest(
      db,
      { gameIdOrSlug: randomUUID() },
      { subjectUserId: userId },
    );
    expect(result).toMatchObject({ ok: false, status: "not_accessible" });
  });

  test("unknown input fields rejected", async () => {
    const result = await readMatchManifest(
      db,
      { gameIdOrSlug: "x", extra: true },
      { subjectUserId: randomUUID() },
    );
    expect(result).toMatchObject({ ok: false, status: "invalid_input", field: "extra" });
  });

  test("serializeTranscriptEntry preserves formalSpeechCorrelationKey for parity", () => {
    const key = buildFormalSpeechCorrelationKey({
      kind: "plea",
      playerId: "player-1",
      round: 4,
      phase: Phase.PLEA,
    });
    const row = serializeTranscriptEntry(
      "game-1",
      {
        round: 4,
        phase: Phase.PLEA,
        timestamp: 1,
        from: "player-1",
        scope: "public",
        text: "plea",
        entrySequence: 1,
        speakerPlayerId: "player-1",
        audiencePlayerIds: [],
        dialogueKind: "public_speech",
        dialogueContext: {
          version: 1,
          formalSpeechCorrelationKey: key,
        },
      },
      { transcriptCaptureVersion: 1 },
    );
    expect(row.safeContext).toMatchObject({
      version: 1,
      formalSpeechCorrelationKey: key,
    });
  });
});
