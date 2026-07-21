import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { GameState, Phase } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { appendGameEvents } from "../services/game-events.js";
import {
  buildMatchAccessContext,
  resolveMatchAccessContext,
  type MatchAccessContext,
} from "../services/match-access-context.js";
import {
  classifyAuthorizedTranscriptRow,
  evaluateTranscriptLaneAccess,
  loadTrustedHuddleSessions,
  selectAuthorizedTranscriptRows,
  type TranscriptAuthorizationEvidence,
  type TranscriptRowAuthInput,
} from "../services/transcript-visibility-policy.js";
import {
  fixedClock,
  insertGame,
  insertOwner,
} from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

describe("transcript visibility policy", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("lane access requires participating ownership, not creator-only", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      walletAddress: "0xvislane00000000000000000000000000000001",
    });
    const createdOnly = await insertGame(db, { slug: "vis-creator-only" });
    await db.update(schema.games).set({ createdById: userId }).where(eq(schema.games.id, createdOnly));

    const creator = await resolveMatchAccessContext(db, {
      subjectUserId: userId,
      gameIdOrSlug: createdOnly,
    });
    expect(creator.status).toBe("resolved");
    if (creator.status !== "resolved") return;
    expect(evaluateTranscriptLaneAccess(creator.context)).toEqual({ status: "denied" });

    const joined = await insertGame(db, { slug: "vis-joined" });
    await insertPlayer(db, { gameId: joined, userId, name: "Owner" });
    const owner = await resolveMatchAccessContext(db, {
      subjectUserId: userId,
      gameIdOrSlug: joined,
    });
    expect(owner.status).toBe("resolved");
    if (owner.status !== "resolved") return;
    expect(evaluateTranscriptLaneAccess(owner.context).status).toBe("authorized");
  });

  test("public + safe system authorize; unsafe/legacy system and diary omit", () => {
    const evidence = evidenceForOwned(["owner-1"]);

    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "public",
      speakerPlayerId: "other",
      audiencePlayerIds: [],
      captureVersion: 1,
      entrySequence: 1,
    }), evidence)).toBe("public");

    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "system",
      captureVersion: 1,
      entrySequence: 2,
      audiencePlayerIds: [],
      dialogueKind: "system_announcement",
    }), evidence)).toBe("system");

    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "system",
      captureVersion: 1,
      entrySequence: 3,
      audiencePlayerIds: [],
      dialogueKind: "not_a_real_kind",
    }), evidence)).toBeNull();

    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "system",
      captureVersion: null,
      entrySequence: null,
      dialogueKind: null,
    }), evidence)).toBeNull();

    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "diary",
      captureVersion: 1,
    }), evidence)).toBeNull();
  });

  test("modern mingle authorizes owned sender even when recipients exclude sender", () => {
    const owned = "owner-1";
    const evidence = evidenceForOwned([owned]);

    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "mingle",
      captureVersion: 1,
      entrySequence: 10,
      speakerPlayerId: owned,
      audiencePlayerIds: ["peer-a", "peer-b"],
    }), evidence)).toBe("mingle");

    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "mingle",
      captureVersion: 1,
      entrySequence: 11,
      speakerPlayerId: "peer-a",
      audiencePlayerIds: [owned, "peer-b"],
    }), evidence)).toBe("mingle");

    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "whisper",
      captureVersion: 1,
      entrySequence: 12,
      speakerPlayerId: "peer-a",
      audiencePlayerIds: ["peer-b"],
    }), evidence)).toBeNull();
  });

  test("legacy mingle/whisper uses unambiguous name-or-ID; malformed recipients omit", () => {
    const alice = randomUUID();
    const bob = randomUUID();
    const context = contextWithRoster([
      { id: alice, name: "Alice", userId: "u1", agentProfileId: null },
      { id: bob, name: "Bob", userId: null, agentProfileId: null },
    ], [alice]);
    const evidence: TranscriptAuthorizationEvidence = {
      ownedPlayerIds: context.ownedPlayerIds,
      resolvePlayerId: (token) => context.resolvePlayerId(token),
      trustedHuddleSessions: [],
      trustedPrefixHealthy: true,
    };

    // Owned sender by name, recipients exclude sender.
    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "mingle",
      fromPlayerId: "Alice",
      toPlayerIds: JSON.stringify(["Bob"]),
    }), evidence)).toBe("legacy_mingle");

    // Owned recipient by id.
    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "whisper",
      fromPlayerId: bob,
      toPlayerIds: JSON.stringify([alice]),
    }), evidence)).toBe("legacy_whisper");

    // Malformed restricted recipients omit.
    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "mingle",
      fromPlayerId: "Alice",
      toPlayerIds: "{not-json",
    }), evidence)).toBeNull();

    // Non-member private room omits.
    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "mingle",
      fromPlayerId: "Bob",
      toPlayerIds: JSON.stringify(["Bob"]),
    }), evidence)).toBeNull();
  });

  test("two owned players union huddles with shared public dedupe", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      walletAddress: "0xvisunion0000000000000000000000000000001",
    });
    const gameId = await insertGame(db, {
      slug: "vis-union",
      status: "in_progress",
    });
    await db.update(schema.games).set({ transcriptCaptureVersion: 1 }).where(eq(schema.games.id, gameId));
    const alice = await insertPlayer(db, { gameId, userId, name: "Alice" });
    const bob = await insertPlayer(db, { gameId, userId, name: "Bob" });
    const cara = await insertPlayer(db, { gameId, name: "Cara" });
    const dax = await insertPlayer(db, { gameId, name: "Dax" });

    const state = new GameState([
      { id: alice, name: "Alice" },
      { id: bob, name: "Bob" },
      { id: cara, name: "Cara" },
      { id: dax, name: "Dax" },
    ], { gameId, now: fixedClock() });
    state.startRound();
    const ab = state.recordAllianceProposal({
      lineageId: "lineage-ab",
      allianceId: "alliance-ab",
      versionId: "version-ab",
      proposerId: alice,
      name: "AB",
      memberIds: [alice, cara],
      purpose: "test",
      timebox: null,
    }, { phase: Phase.MINGLE_I });
    state.recordAllianceResponse({
      lineageId: "lineage-ab",
      versionId: ab.versionId,
      playerId: cara,
      response: "accepted",
    }, { phase: Phase.MINGLE_I });
    const bd = state.recordAllianceProposal({
      lineageId: "lineage-bd",
      allianceId: "alliance-bd",
      versionId: "version-bd",
      proposerId: bob,
      name: "BD",
      memberIds: [bob, dax],
      purpose: "test",
      timebox: null,
    }, { phase: Phase.MINGLE_I });
    state.recordAllianceResponse({
      lineageId: "lineage-bd",
      versionId: bd.versionId,
      playerId: dax,
      response: "accepted",
    }, { phase: Phase.MINGLE_I });
    state.recordAllianceHuddleCompleted({
      id: "session-ac",
      scheduleId: "schedule-ac",
      allianceId: "alliance-ab",
      window: "pre_vote",
      round: 1,
      pass: 1,
      speakerIds: [alice, cara],
      completedAt: "2026-06-14T00:01:00.000Z",
    });
    state.recordAllianceHuddleCompleted({
      id: "session-bd",
      scheduleId: "schedule-bd",
      allianceId: "alliance-bd",
      window: "pre_vote",
      round: 1,
      pass: 1,
      speakerIds: [bob, dax],
      completedAt: "2026-06-14T00:02:00.000Z",
    });

    const ownerEpoch = await insertOwner(db, gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events: state.getCanonicalEvents() });

    await db.insert(schema.transcripts).values([
      modernPublic(gameId, 1, "House opens the floor.", 1),
      modernHuddle(gameId, 2, {
        speakerPlayerId: alice,
        audiencePlayerIds: [alice, cara],
        sessionId: "session-ac",
        text: "Alice private plan",
        timestamp: 2,
      }),
      modernHuddle(gameId, 3, {
        speakerPlayerId: bob,
        audiencePlayerIds: [bob, dax],
        sessionId: "session-bd",
        text: "Bob private plan",
        timestamp: 3,
      }),
      modernHuddle(gameId, 4, {
        speakerPlayerId: cara,
        audiencePlayerIds: [cara, dax],
        sessionId: "session-foreign",
        text: "Nonmember foreign huddle",
        timestamp: 4,
        // No trusted session for this id — must omit without affecting counts of returned rows.
        allianceId: "alliance-foreign",
      }),
      modernPublic(gameId, 5, "Public vote opens.", 5),
    ]);

    const resolution = await resolveMatchAccessContext(db, {
      subjectUserId: userId,
      gameIdOrSlug: gameId,
    });
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;

    const result = await selectAuthorizedTranscriptRows(db, resolution.context);
    expect(result.lane.status).toBe("authorized");
    const texts = result.rows.map((row) => {
      // refs do not include text — re-check authorization classes and sequences
      return `${row.entrySequence}:${row.visibilityClass}`;
    });
    expect(texts).toEqual([
      "1:public",
      "2:huddle",
      "3:huddle",
      "5:public",
    ]);
    expect(result.rows.some((row) => row.entrySequence === 4)).toBe(false);
    // No hidden-row diagnostics on the authorized view.
    expect(JSON.stringify(result.rows)).not.toContain("Nonmember");
    expect(JSON.stringify(result.rows)).not.toContain("omitted");
  });

  test("joining later never reveals earlier non-member huddle; closed membership remains readable", () => {
    const owned = "owner-1";
    const earlySpeakers = ["a", "b"];
    const laterSpeakers = [owned, "c"];
    const evidence: TranscriptAuthorizationEvidence = {
      ownedPlayerIds: new Set([owned]),
      resolvePlayerId: (token) => token,
      trustedPrefixHealthy: true,
      trustedHuddleSessions: [
        {
          sessionId: "early",
          allianceId: "ally-early",
          round: 1,
          window: "pre_vote",
          phase: "PRE_VOTE_HUDDLE",
          speakerIds: earlySpeakers,
          speakerKey: earlySpeakers.slice().sort().join("\0"),
        },
        {
          sessionId: "later",
          allianceId: "ally-later",
          round: 2,
          window: "pre_vote",
          phase: "PRE_VOTE_HUDDLE",
          speakerIds: laterSpeakers,
          speakerKey: laterSpeakers.slice().sort().join("\0"),
        },
      ],
    };

    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "huddle",
      captureVersion: 1,
      entrySequence: 1,
      round: 1,
      phase: "PRE_VOTE_HUDDLE",
      speakerPlayerId: "a",
      audiencePlayerIds: earlySpeakers,
      safeContext: {
        version: 1,
        sessionId: "early",
        sessionAudiencePlayerIds: earlySpeakers,
      },
    }), evidence)).toBeNull();

    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "huddle",
      captureVersion: 1,
      entrySequence: 2,
      round: 2,
      phase: "PRE_VOTE_HUDDLE",
      speakerPlayerId: owned,
      audiencePlayerIds: laterSpeakers,
      safeContext: {
        version: 1,
        sessionId: "later",
        sessionAudiencePlayerIds: laterSpeakers,
      },
    }), evidence)).toBe("huddle");
  });

  test("canonical invalidity before a huddle fails that huddle closed; public/mingle remain", () => {
    const owned = "owner-1";
    const speakers = [owned, "peer"];
    const evidence: TranscriptAuthorizationEvidence = {
      ownedPlayerIds: new Set([owned]),
      resolvePlayerId: (token) => token,
      trustedPrefixHealthy: false,
      trustedHuddleSessions: [], // session after break never loaded
    };

    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "huddle",
      captureVersion: 1,
      entrySequence: 20,
      speakerPlayerId: owned,
      audiencePlayerIds: speakers,
      safeContext: {
        version: 1,
        sessionId: "session-after-break",
        sessionAudiencePlayerIds: speakers,
      },
    }), evidence)).toBeNull();

    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "public",
      captureVersion: 1,
      entrySequence: 21,
      audiencePlayerIds: [],
    }), evidence)).toBe("public");

    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "mingle",
      captureVersion: 1,
      entrySequence: 22,
      speakerPlayerId: owned,
      audiencePlayerIds: [owned, "peer"],
    }), evidence)).toBe("mingle");
  });

  test("malformed public legacy metadata does not suppress safe public text", () => {
    const evidence = evidenceForOwned(["owner-1"]);
    expect(classifyAuthorizedTranscriptRow(baseRow({
      scope: "public",
      fromPlayerId: "Alice",
      toPlayerIds: "{broken",
      captureVersion: null,
      entrySequence: null,
    }), evidence)).toBe("public");
  });

  test("loadTrustedHuddleSessions only includes completed sessions from trusted prefix", async () => {
    const gameId = await insertGame(db, { slug: "vis-trusted-prefix", status: "in_progress" });
    const alice = randomUUID();
    const bob = randomUUID();
    const state = new GameState([
      { id: alice, name: "Alice" },
      { id: bob, name: "Bob" },
    ], { gameId, now: fixedClock() });
    state.startRound();
    const ab = state.recordAllianceProposal({
      lineageId: "lineage-t",
      allianceId: "alliance-t",
      versionId: "version-t",
      proposerId: alice,
      name: "T",
      memberIds: [alice, bob],
      purpose: "test",
      timebox: null,
    }, { phase: Phase.MINGLE_I });
    state.recordAllianceResponse({
      lineageId: "lineage-t",
      versionId: ab.versionId,
      playerId: bob,
      response: "accepted",
    }, { phase: Phase.MINGLE_I });
    state.recordAllianceHuddleCompleted({
      id: "session-t",
      scheduleId: "schedule-t",
      allianceId: "alliance-t",
      window: "pre_vote",
      round: 1,
      pass: 1,
      speakerIds: [alice, bob],
      completedAt: "2026-06-14T00:01:00.000Z",
    });
    const ownerEpoch = await insertOwner(db, gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events: state.getCanonicalEvents() });

    const load = await loadTrustedHuddleSessions(db, gameId);
    expect(load.trustedPrefixHealthy).toBe(true);
    expect(load.sessions).toHaveLength(1);
    expect(load.sessions[0]?.sessionId).toBe("session-t");
    expect(load.sessions[0]?.speakerIds).toEqual([alice, bob]);
  });

  test("producer/sysop metadata does not widen MatchAccessContext ownership", async () => {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      walletAddress: "0xvisprod00000000000000000000000000000001",
    });
    const gameId = await insertGame(db, { slug: "vis-no-widen" });
    // Subject is not a participant.
    const other = randomUUID();
    await db.insert(schema.users).values({
      id: other,
      walletAddress: "0xvisprod00000000000000000000000000000002",
    });
    await insertPlayer(db, { gameId, userId: other, name: "Other" });

    const resolution = await resolveMatchAccessContext(db, {
      subjectUserId: userId,
      gameIdOrSlug: gameId,
    });
    expect(resolution.status).toBe("not_accessible");
  });
});

function evidenceForOwned(ownedIds: string[]): TranscriptAuthorizationEvidence {
  const owned = new Set(ownedIds);
  return {
    ownedPlayerIds: owned,
    resolvePlayerId: (token) => (owned.has(token) || token.length > 0 ? token : null),
    trustedHuddleSessions: [],
    trustedPrefixHealthy: true,
  };
}

function contextWithRoster(
  roster: Array<{ id: string; name: string; userId: string | null; agentProfileId: string | null }>,
  ownedIds: string[],
): MatchAccessContext {
  const ownedSet = new Set(ownedIds);
  return buildMatchAccessContext({
    subjectUserId: "user-1",
    gameId: "game-1",
    gameSlug: "slug",
    gameStatus: "in_progress",
    transcriptCaptureVersion: 1,
    isCreator: false,
    hasParticipatingOwnership: ownedIds.length > 0,
    hasCanonicalAccess: true,
    ownedPlayerIds: ownedSet,
    ownedAgentProfileIds: new Set(),
    ownedSeats: roster
      .filter((p) => ownedSet.has(p.id))
      .map((p) => ({ playerId: p.id, name: p.name, agentProfileId: p.agentProfileId })),
    roster,
  });
}

function baseRow(overrides: Partial<TranscriptRowAuthInput>): TranscriptRowAuthInput {
  return {
    id: overrides.id ?? 1,
    entrySequence: overrides.entrySequence === undefined ? null : overrides.entrySequence,
    scope: overrides.scope ?? "public",
    round: overrides.round ?? 1,
    phase: overrides.phase ?? "LOBBY",
    timestamp: overrides.timestamp ?? 1,
    fromPlayerId: overrides.fromPlayerId ?? null,
    toPlayerIds: overrides.toPlayerIds === undefined ? null : overrides.toPlayerIds,
    speakerPlayerId: overrides.speakerPlayerId ?? null,
    audiencePlayerIds: overrides.audiencePlayerIds === undefined ? null : overrides.audiencePlayerIds,
    captureVersion: overrides.captureVersion === undefined ? null : overrides.captureVersion,
    dialogueKind: overrides.dialogueKind === undefined ? null : overrides.dialogueKind,
    safeContext: overrides.safeContext === undefined ? null : overrides.safeContext,
  };
}

function modernPublic(gameId: string, sequence: number, text: string, timestamp: number) {
  return {
    gameId,
    round: 1,
    phase: "LOBBY",
    fromPlayerId: null,
    scope: "public" as const,
    toPlayerIds: null,
    text,
    timestamp,
    entrySequence: sequence,
    speakerPlayerId: null,
    audiencePlayerIds: [] as string[],
    captureVersion: 1,
    dialogueKind: "public_speech" as const,
    safeContext: { version: 1 as const },
  };
}

function modernHuddle(
  gameId: string,
  sequence: number,
  params: {
    speakerPlayerId: string;
    audiencePlayerIds: string[];
    sessionId: string;
    text: string;
    timestamp: number;
    allianceId?: string;
  },
) {
  return {
    gameId,
    round: 1,
    phase: Phase.PRE_VOTE_HUDDLE,
    fromPlayerId: params.speakerPlayerId,
    scope: "huddle" as const,
    toPlayerIds: JSON.stringify(params.audiencePlayerIds.filter((id) => id !== params.speakerPlayerId)),
    text: params.text,
    timestamp: params.timestamp,
    entrySequence: sequence,
    speakerPlayerId: params.speakerPlayerId,
    audiencePlayerIds: params.audiencePlayerIds,
    captureVersion: 1,
    dialogueKind: "huddle_speech" as const,
    safeContext: {
      version: 1 as const,
      sessionId: params.sessionId,
      allianceId: params.allianceId ?? "alliance",
      sessionAudiencePlayerIds: params.audiencePlayerIds,
      window: "pre_vote",
    },
  };
}

async function insertPlayer(
  db: DrizzleDB,
  params: {
    gameId: string;
    userId?: string;
    agentProfileId?: string;
    name: string;
  },
): Promise<string> {
  const playerId = randomUUID();
  await db.insert(schema.gamePlayers).values({
    id: playerId,
    gameId: params.gameId,
    userId: params.userId,
    agentProfileId: params.agentProfileId,
    persona: JSON.stringify({ name: params.name, personality: "test" }),
    agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
  });
  return playerId;
}
