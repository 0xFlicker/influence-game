import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { appendGameEvents } from "../services/game-events.js";
import { getPublicWatchIntelligence } from "../services/public-watch-intelligence.js";
import { setupTestDB } from "./test-utils.js";
import {
  createResolvedRoundCanonicalEventFixture,
  insertGame,
  insertOwner,
} from "./durable-run-test-utils.js";

describe("getPublicWatchIntelligence", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("returns selected-player thinking, strategy, and canonical receipts without private fields", async () => {
    const gameId = await seedGameWithPlayers(db, "watch-intelligence-public");
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createResolvedRoundCanonicalEventFixture(gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    await insertArtifact(db, {
      id: "thinking-artifact",
      gameId,
      actorPlayerId: "atlas",
      artifactType: "thinking",
      action: "vote",
      eventSequence: events[2]?.sequence ?? 2,
      payload: {
        thinking: "Mira is drawing trust, so I should keep Echo close.",
        reasoningContext: "PRIVATE_REASONING_SENTINEL",
        prompt: "PROMPT_SENTINEL",
        storageKey: "STORAGE_KEY_SENTINEL",
      },
    });
    await insertArtifact(db, {
      id: "strategy-artifact",
      gameId,
      actorPlayerId: "atlas",
      artifactType: "strategy",
      action: "vote",
      eventSequence: events[3]?.sequence ?? 3,
      payload: {
        decisionLog: "Back Mira publicly while keeping Echo from feeling isolated.",
        strategicLens: "Stay useful to two voting blocs.",
        rawProviderResponse: "RAW_RESPONSE_SENTINEL",
        sourcePointers: [{ key: "TRACE_POINTER_SENTINEL" }],
      },
    });
    await insertArtifact(db, {
      id: "reasoning-artifact",
      gameId,
      actorPlayerId: "atlas",
      artifactType: "reasoning",
      action: "vote",
      payload: {
        reasoningContext: "REASONING_ARTIFACT_SENTINEL",
      },
    });

    await db.insert(schema.transcripts).values({
      gameId,
      round: 1,
      phase: "VOTE",
      fromPlayerId: "atlas",
      scope: "public",
      text: "I am voting for Mira.",
      thinking: "Transcript-level thought is still viewer-facing.",
      timestamp: 1_720_000_000_001,
    });

    const result = await getPublicWatchIntelligence(db, {
      gameIdOrSlug: "watch-intelligence-public",
      actorPlayerId: "atlas",
      round: 1,
      phase: "VOTE",
      limit: 4,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok result");
    expect(result.game).toMatchObject({
      id: gameId,
      slug: "watch-intelligence-public",
      status: "in_progress",
    });
    expect(result.context).toMatchObject({
      selectedPlayerId: "atlas",
      selectedPlayerName: "Atlas",
      round: 1,
      phase: "VOTE",
    });
    expect(result.intelligence.thinking.status).toBe("available");
    expect(result.intelligence.thinking.cards.map((card) => card.text)).toEqual(
      expect.arrayContaining([
        "Mira is drawing trust, so I should keep Echo close.",
        "Transcript-level thought is still viewer-facing.",
      ]),
    );
    expect(result.intelligence.strategy.status).toBe("available");
    expect(result.intelligence.strategy.cards.map((card) => card.text)).toEqual(
      expect.arrayContaining([
        "Back Mira publicly while keeping Echo from feeling isolated.",
        "Stay useful to two voting blocs.",
      ]),
    );
    expect(result.intelligence.receipts.status).toBe("available");
    expect(result.intelligence.receipts.canonicalGameFacts.availability).toMatchObject({
      canonicalFactsStatus: "available",
      eventLogStatus: "complete",
      projectionStatus: "complete",
      artifactDerivedFacts: { status: "not_used" },
    });
    expect(result.intelligence.receipts.canonicalGameFacts.roundFacts.standardVote.status).toBe("available");

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("PRIVATE_REASONING_SENTINEL");
    expect(serialized).not.toContain("PROMPT_SENTINEL");
    expect(serialized).not.toContain("STORAGE_KEY_SENTINEL");
    expect(serialized).not.toContain("RAW_RESPONSE_SENTINEL");
    expect(serialized).not.toContain("TRACE_POINTER_SENTINEL");
    expect(serialized).not.toContain("REASONING_ARTIFACT_SENTINEL");
    expect(serialized).not.toContain("payload");
  });

  test("omits hidden alliance action and huddle cards from public intelligence", async () => {
    const gameId = await seedGameWithPlayers(db, "watch-intelligence-huddle-hidden");
    await insertArtifact(db, {
      id: "alliance-action-thinking-artifact",
      gameId,
      actorPlayerId: "atlas",
      artifactType: "thinking",
      action: "alliance-action",
      phase: "MINGLE_I",
      payload: { thinking: "ALLIANCE_ACTION_THINKING_SENTINEL" },
    });
    await insertArtifact(db, {
      id: "alliance-action-strategy-artifact",
      gameId,
      actorPlayerId: "atlas",
      artifactType: "strategy",
      action: "alliance-action",
      phase: "MINGLE_I",
      payload: { decisionLog: "ALLIANCE_ACTION_STRATEGY_SENTINEL" },
    });
    await insertArtifact(db, {
      id: "huddle-thinking-artifact",
      gameId,
      actorPlayerId: "atlas",
      artifactType: "thinking",
      action: "alliance-huddle-turn",
      phase: "PRE_VOTE_HUDDLE",
      payload: { thinking: "HUDDLE_ARTIFACT_THINKING_SENTINEL" },
    });
    await insertArtifact(db, {
      id: "huddle-strategy-artifact",
      gameId,
      actorPlayerId: "atlas",
      artifactType: "strategy",
      action: "alliance-huddle-turn",
      phase: "PRE_VOTE_HUDDLE",
      payload: { decisionLog: "HUDDLE_ARTIFACT_STRATEGY_SENTINEL" },
    });
    await db.insert(schema.transcripts).values({
      gameId,
      round: 1,
      phase: "PRE_VOTE_HUDDLE",
      fromPlayerId: "atlas",
      scope: "huddle",
      text: "HUDDLE_TRANSCRIPT_TEXT_SENTINEL",
      thinking: "HUDDLE_TRANSCRIPT_THINKING_SENTINEL",
      timestamp: 1_720_000_000_002,
    });

    const result = await getPublicWatchIntelligence(db, {
      gameIdOrSlug: "watch-intelligence-huddle-hidden",
      actorPlayerId: "atlas",
      round: 1,
      phase: "VOTE",
      limit: 4,
    });

    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("ALLIANCE_ACTION_THINKING_SENTINEL");
    expect(serialized).not.toContain("ALLIANCE_ACTION_STRATEGY_SENTINEL");
    expect(serialized).not.toContain("HUDDLE_ARTIFACT_THINKING_SENTINEL");
    expect(serialized).not.toContain("HUDDLE_ARTIFACT_STRATEGY_SENTINEL");
    expect(serialized).not.toContain("HUDDLE_TRANSCRIPT_TEXT_SENTINEL");
    expect(serialized).not.toContain("HUDDLE_TRANSCRIPT_THINKING_SENTINEL");
  });

  test("requires a selected player before returning cognitive cards", async () => {
    const gameId = await seedGameWithPlayers(db, "watch-intelligence-select-player");
    await insertArtifact(db, {
      gameId,
      actorPlayerId: "atlas",
      artifactType: "thinking",
      action: "mingle",
      payload: { thinking: "This should wait until Atlas is selected." },
    });

    const result = await getPublicWatchIntelligence(db, {
      gameIdOrSlug: gameId,
      round: 1,
      phase: "MINGLE",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok result");
    expect(result.intelligence.thinking).toMatchObject({
      status: "select_player",
      cards: [],
    });
    expect(result.intelligence.strategy).toMatchObject({
      status: "select_player",
      cards: [],
    });
    expect(JSON.stringify(result)).not.toContain("This should wait");
  });

  test("renders structured strategy packets and prevents repeated decision logs from crowding the section", async () => {
    const gameId = await seedGameWithPlayers(db, "watch-intelligence-strategy-packet");
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createResolvedRoundCanonicalEventFixture(gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events });
    const sequenceFromEnd = (offset: number): number => {
      const sequence = events[events.length - offset]?.sequence;
      if (sequence === undefined) throw new Error("Expected enough canonical events for strategy fixture");
      return sequence;
    };

    await insertArtifact(db, {
      id: "current-council-strategy",
      gameId,
      actorPlayerId: "atlas",
      artifactType: "strategy",
      action: "last-message",
      phase: "COUNCIL",
      eventSequence: sequenceFromEnd(1),
      payload: {
        decisionLog: "Keep final words brief and do not name a fresh target.",
        strategyPacketSummary: {
          revisionId: "r1-introduction-1",
          previousRevisionId: null,
          updatedAtRound: 1,
          updatedAtPhase: "INTRODUCTION",
          objective: "Build rapport while identifying one reliable collaborator.",
          targetPosture: "No named target yet.",
          coalitionPosture: "Stay close to Mira without sounding locked.",
          nextSocialProbe: "Ask Bob for one concrete loyalty signal.",
          strategicLens: "coalition_geometry",
          strategicLensRationale: "Early room shape matters more than vote math.",
          uncertainty: "Bob may be mirroring the room.",
          reviseTrigger: "Mira stops reciprocating trust.",
          changedSincePrevious: "First packet.",
        },
      },
    });
    await insertArtifact(db, {
      id: "mingle-strategy-with-lens",
      gameId,
      actorPlayerId: "atlas",
      artifactType: "strategy",
      action: "mingle-turn",
      phase: "MINGLE",
      eventSequence: sequenceFromEnd(2),
      payload: {
        decisionLog: "Open a soft Bob conversation without committing.",
        strategicLens: "coalition_geometry",
        strategicLensRationale: "Bob and Mira are the likely hinge relationships.",
      },
    });
    await insertArtifact(db, {
      id: "older-mingle-strategy-a",
      gameId,
      actorPlayerId: "atlas",
      artifactType: "strategy",
      action: "mingle-turn",
      phase: "MINGLE",
      eventSequence: sequenceFromEnd(3),
      payload: {
        decisionLog: "Repeat a low-risk Bob probe.",
      },
    });
    await insertArtifact(db, {
      id: "older-mingle-strategy-b",
      gameId,
      actorPlayerId: "atlas",
      artifactType: "strategy",
      action: "mingle-turn",
      phase: "MINGLE",
      eventSequence: sequenceFromEnd(4),
      payload: {
        decisionLog: "Keep options open and avoid hard targets.",
      },
    });

    const result = await getPublicWatchIntelligence(db, {
      gameIdOrSlug: "watch-intelligence-strategy-packet",
      actorPlayerId: "atlas",
      round: 1,
      phase: "COUNCIL",
      limit: 4,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok result");
    const strategyCards = result.intelligence.strategy.cards;
    expect(strategyCards.map((card) => card.title)).toEqual([
      "Decision Log",
      "Strategy Packet",
      "Strategic Lens",
      "Lens Rationale",
    ]);
    expect(strategyCards.find((card) => card.title === "Strategy Packet")?.text).toContain(
      "Objective: Build rapport while identifying one reliable collaborator.",
    );
    expect(strategyCards.filter((card) => card.title === "Decision Log")).toHaveLength(1);
  });

  test("does not leak same-round future phase intelligence into an earlier replay phase", async () => {
    const gameId = await seedGameWithPlayers(db, "watch-intelligence-phase-boundary");
    await insertArtifact(db, {
      id: "lobby-thinking",
      gameId,
      actorPlayerId: "atlas",
      artifactType: "thinking",
      action: "lobby",
      phase: "LOBBY",
      payload: { thinking: "LOBBY_THINKING_SENTINEL" },
    });
    await insertArtifact(db, {
      id: "future-vote-thinking",
      gameId,
      actorPlayerId: "atlas",
      artifactType: "thinking",
      action: "vote",
      phase: "VOTE",
      payload: { thinking: "FUTURE_VOTE_THINKING_SENTINEL" },
    });
    await insertArtifact(db, {
      id: "future-diary-strategy",
      gameId,
      actorPlayerId: "atlas",
      artifactType: "strategy",
      action: "diary-room",
      phase: "DIARY_ROOM",
      payload: { decisionLog: "FUTURE_DIARY_STRATEGY_SENTINEL" },
    });
    await db.insert(schema.transcripts).values({
      gameId,
      round: 1,
      phase: "COUNCIL",
      fromPlayerId: "atlas",
      scope: "public",
      text: "This should not be visible yet.",
      thinking: "FUTURE_COUNCIL_TRANSCRIPT_SENTINEL",
      timestamp: 1_720_000_000_010,
    });

    const lobby = await getPublicWatchIntelligence(db, {
      gameIdOrSlug: "watch-intelligence-phase-boundary",
      actorPlayerId: "atlas",
      round: 1,
      phase: "LOBBY",
      limit: 4,
    });

    expect(lobby.ok).toBe(true);
    if (!lobby.ok) throw new Error("Expected ok lobby result");
    const lobbySerialized = JSON.stringify(lobby);
    expect(lobbySerialized).toContain("LOBBY_THINKING_SENTINEL");
    expect(lobbySerialized).not.toContain("FUTURE_VOTE_THINKING_SENTINEL");
    expect(lobbySerialized).not.toContain("FUTURE_DIARY_STRATEGY_SENTINEL");
    expect(lobbySerialized).not.toContain("FUTURE_COUNCIL_TRANSCRIPT_SENTINEL");

    const vote = await getPublicWatchIntelligence(db, {
      gameIdOrSlug: gameId,
      actorPlayerId: "atlas",
      round: 1,
      phase: "VOTE",
      limit: 4,
    });

    expect(vote.ok).toBe(true);
    if (!vote.ok) throw new Error("Expected ok vote result");
    const voteSerialized = JSON.stringify(vote);
    expect(voteSerialized).toContain("FUTURE_VOTE_THINKING_SENTINEL");
    expect(voteSerialized).not.toContain("FUTURE_DIARY_STRATEGY_SENTINEL");
    expect(voteSerialized).not.toContain("FUTURE_COUNCIL_TRANSCRIPT_SENTINEL");
  });

  test("returns not_found for missing games", async () => {
    const result = await getPublicWatchIntelligence(db, {
      gameIdOrSlug: "missing-game",
      actorPlayerId: "atlas",
    });

    expect(result).toEqual({
      ok: false,
      status: "not_found",
      error: "Game not found",
    });
  });
});

async function seedGameWithPlayers(db: DrizzleDB, slug: string): Promise<string> {
  const gameId = await insertGame(db, {
    slug,
    status: "in_progress",
  });
  await db.insert(schema.gamePlayers).values([
    playerRow(gameId, "atlas", "Atlas"),
    playerRow(gameId, "echo", "Echo"),
    playerRow(gameId, "mira", "Mira"),
    playerRow(gameId, "nyx", "Nyx"),
  ]);
  return gameId;
}

function playerRow(gameId: string, id: string, name: string): typeof schema.gamePlayers.$inferInsert {
  return {
    id,
    gameId,
    persona: JSON.stringify({ name, personality: "careful" }),
    agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
  };
}

async function insertArtifact(
  db: DrizzleDB,
  params: {
    id?: string;
    gameId: string;
    actorPlayerId: string;
    artifactType: "reasoning" | "thinking" | "strategy";
    action: string;
    payload: Record<string, unknown>;
    eventSequence?: number;
    round?: number;
    phase?: string;
  },
): Promise<void> {
  const payloadByteLength = Buffer.byteLength(JSON.stringify(params.payload), "utf8");
  await db.insert(schema.gameCognitiveArtifacts).values({
    id: params.id ?? randomUUID(),
    gameId: params.gameId,
    captureVersion: 1,
    eventSequence: params.eventSequence,
    artifactType: params.artifactType,
    actorRole: "player",
    actorPlayerId: params.actorPlayerId,
    action: params.action,
    phase: params.phase ?? "VOTE",
    round: params.round ?? 1,
    visibilityStatus: "active",
    payloadByteLength,
    payload: params.payload,
    retentionClass: "debug",
    redactionStatus: "active",
  });
}
