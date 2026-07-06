import { beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  buildCompletedGameResults,
  createEdgeSmokeDuskEvents,
  EDGE_SMOKE_DUSK_EXPECTED,
  EDGE_SMOKE_DUSK_GAME_ID,
  EDGE_SMOKE_DUSK_PLAYERS,
  Phase,
  type AllianceHuddleOutcome,
  type AllianceProposalLineage,
  type AllianceRecord,
  type CanonicalGameEvent,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { appendGameEvents } from "../services/game-events.js";
import { createSessionToken } from "../middleware/auth.js";
import { createAdminRoutes } from "../routes/admin.js";
import { createGameRoutes } from "../routes/games.js";
import {
  getPostgameHighlights,
  getPostgameHighlightsDiagnostics,
} from "../services/postgame-highlights.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";

const ADMIN_USER_ID = "postgame-highlights-admin";
const GAMER_USER_ID = "postgame-highlights-gamer";

beforeEach(() => {
  process.env.JWT_SECRET = "test-jwt-secret-postgame-highlights";
});

describe("postgame highlights service", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("returns a public House Cut without admin-only rejection details", async () => {
    await insertEdgeSmokeDusk(db, addNamedAllianceOverlay(createEdgeSmokeDuskEvents(EDGE_SMOKE_DUSK_GAME_ID)));

    const result = await getPostgameHighlights(db, EDGE_SMOKE_DUSK_EXPECTED.slug);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schemaVersion).toBe(2);
    expect(result.highlights.schemaVersion).toBe(2);
    expect(result.highlights.state).toBe("main_cut");
    expect(result.highlights.cut?.kind).toBe("main");
    expect(result.highlights.scenes.length).toBeGreaterThanOrEqual(3);
    expect(result.highlights.scenes.every((scene) => scene.receipts.length > 0)).toBe(true);
    expect(result.highlights.scenes.every((scene) => scene.visualBrief.visualType.length > 0)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("posterDirection");
    expect(JSON.stringify(result)).not.toContain("forbiddenInventions");
    expect(JSON.stringify(result)).not.toContain("rejectedBackdropCategories");
    expect("diagnostics" in result.highlights).toBe(false);
    expect(JSON.stringify(result)).not.toContain("\"confidence\"");
    expect(JSON.stringify(result)).not.toContain("\"eventRefs\"");
    expect(JSON.stringify(result)).not.toContain("\"eventType\"");
    expect(JSON.stringify(result)).not.toContain("\"sequence\"");
    expect(JSON.stringify(result)).not.toContain("sourcePointers");
    expect(JSON.stringify(result)).not.toContain("payloadVersion");
    expect(JSON.stringify(result)).not.toContain("privateReasoning");
  });

  test("returns admin diagnostics with selected and rejected scene rationale", async () => {
    await insertEdgeSmokeDusk(db, addNamedAllianceOverlay(createEdgeSmokeDuskEvents(EDGE_SMOKE_DUSK_GAME_ID)));

    const result = await getPostgameHighlightsDiagnostics(db, EDGE_SMOKE_DUSK_GAME_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schemaVersion).toBe(2);
    expect(result.highlights.schemaVersion).toBe(2);
    expect(result.highlights.state).toBe("main_cut");
    expect(result.highlights.diagnostics.selectedSceneIds.length).toBeGreaterThanOrEqual(3);
    expect(result.highlights.diagnostics.selectedCandidates.every((candidate) =>
      candidate.reasons.includes("selected_for_main_cut")
    )).toBe(true);
    expect(result.highlights.diagnostics.selectedCandidates.every((candidate) =>
      candidate.visualBrief.visualType.length > 0
    )).toBe(true);
    expect(result.highlights.scenes.some((scene) =>
      scene.visualBrief.diagnostics.forbiddenInventions.length > 0
    )).toBe(true);
    expect(result.highlights.diagnostics.rejectedCandidates.some((candidate) =>
      candidate.reasons.includes("duplicate_story_beat")
    )).toBe(true);
    expect(JSON.stringify(result)).not.toContain("sourcePointers");
    expect(JSON.stringify(result)).not.toContain("payloadVersion");
  });

  test("serves the public highlights route without diagnostics", async () => {
    await insertEdgeSmokeDusk(db, addNamedAllianceOverlay(createEdgeSmokeDuskEvents(EDGE_SMOKE_DUSK_GAME_ID)));
    const app = createPublicRoutesApp(db);

    const response = await app.request(`/api/games/${EDGE_SMOKE_DUSK_EXPECTED.slug}/postgame/highlights`);
    const body = (await response.json()) as Awaited<ReturnType<typeof getPostgameHighlights>>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.highlights.state).toBe("main_cut");
    expect("diagnostics" in body.highlights).toBe(false);
    expect(body.highlights.scenes.every((scene) => scene.receipts.length > 0)).toBe(true);
    expect(body.highlights.scenes.every((scene) => scene.visualBrief.templateLabel.length > 0)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("posterDirection");
    expect(JSON.stringify(body)).not.toContain("forbiddenInventions");
    expect(JSON.stringify(body)).not.toContain("\"confidence\"");
    expect(JSON.stringify(body)).not.toContain("\"eventRefs\"");
    expect(JSON.stringify(body)).not.toContain("\"eventType\"");
    expect(JSON.stringify(body)).not.toContain("\"sequence\"");
  });

  test("rejects public highlights reads before a game is completed", async () => {
    const gameId = await insertGame(db, {
      id: "highlights-running-game",
      slug: "highlights-running-game",
      status: "in_progress",
    });
    const app = createPublicRoutesApp(db);

    const response = await app.request(`/api/games/${gameId}/postgame/highlights`);
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(409);
    expect(body.status).toBe("not_completed");
  });

  test("keeps full highlight diagnostics on the admin route only", async () => {
    await insertEdgeSmokeDusk(db, addNamedAllianceOverlay(createEdgeSmokeDuskEvents(EDGE_SMOKE_DUSK_GAME_ID)));
    await insertRouteUsers(db);
    const adminToken = await createSessionToken(ADMIN_USER_ID, {
      roles: ["admin"],
      permissions: ["view_admin"],
    });
    const gamerToken = await createSessionToken(GAMER_USER_ID, {
      roles: ["player"],
      permissions: ["join_game"],
    });
    const app = createAdminRoutesApp(db);

    const denied = await app.request(
      `/api/admin/games/${EDGE_SMOKE_DUSK_EXPECTED.slug}/postgame/highlights/diagnostics`,
      { headers: { Authorization: `Bearer ${gamerToken}` } },
    );
    expect(denied.status).toBe(403);

    const allowed = await app.request(
      `/api/admin/games/${EDGE_SMOKE_DUSK_EXPECTED.slug}/postgame/highlights/diagnostics`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    const body = (await allowed.json()) as Awaited<ReturnType<typeof getPostgameHighlightsDiagnostics>>;

    expect(allowed.status).toBe(200);
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.highlights.diagnostics.selectedCandidates.some((candidate) =>
      candidate.reasons.includes("selected_for_main_cut")
    )).toBe(true);
    expect(body.highlights.diagnostics.rejectedCandidates.some((candidate) =>
      candidate.reasons.includes("duplicate_story_beat")
    )).toBe(true);
    expect(body.highlights.diagnostics.selectedCandidates.some((candidate) =>
      candidate.visualBrief.factualSlots.length > 0
    )).toBe(true);
  });

  test("keeps alliance-free completed games in the unsupported no-artifact state", async () => {
    await insertEdgeSmokeDusk(db, createEdgeSmokeDuskEvents(EDGE_SMOKE_DUSK_GAME_ID));

    const result = await getPostgameHighlights(db, EDGE_SMOKE_DUSK_EXPECTED.slug);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.highlights.state).toBe("unsupported_ineligible");
    expect(result.highlights.eligibility.status).toBe("unsupported");
    expect(result.highlights.eligibility.reason).toBe("missing_alliance_receipts");
    expect(result.highlights.cut).toBeNull();
    expect(result.highlights.scenes).toEqual([]);
  });
});

function createPublicRoutesApp(db: DrizzleDB) {
  const app = new Hono();
  app.route("/", createGameRoutes(db));
  return app;
}

function createAdminRoutesApp(db: DrizzleDB) {
  const app = new Hono();
  app.route("/", createAdminRoutes(db));
  return app;
}

async function insertRouteUsers(db: DrizzleDB): Promise<void> {
  await db.insert(schema.users).values([
    {
      id: ADMIN_USER_ID,
      email: "highlights-admin@test.example",
      displayName: "Highlights Admin",
    },
    {
      id: GAMER_USER_ID,
      email: "highlights-gamer@test.example",
      displayName: "Highlights Gamer",
    },
  ]);
}

async function insertEdgeSmokeDusk(
  db: DrizzleDB,
  events: readonly CanonicalGameEvent[],
): Promise<void> {
  const userId = "user-lilith";
  const agentProfileId = "agent-lilith";
  await db.insert(schema.users).values({
    id: userId,
    email: "lilith@test.example",
    displayName: "Lilith Owner",
  });
  await db.insert(schema.agentProfiles).values({
    id: agentProfileId,
    userId,
    name: EDGE_SMOKE_DUSK_PLAYERS.lilith.name,
    personality: "Precise and socially patient.",
    personaKey: "strategic",
  });
  const gameId = await insertGame(db, {
    id: EDGE_SMOKE_DUSK_GAME_ID,
    slug: EDGE_SMOKE_DUSK_EXPECTED.slug,
    status: "completed",
    config: {
      maxRounds: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
      modelTier: "budget",
      visibility: "public",
      viewerMode: "speedrun",
    },
  });
  await db.update(schema.games)
    .set({ endedAt: "2026-07-01T00:00:00.000Z" })
    .where(eq(schema.games.id, gameId));

  await db.insert(schema.gamePlayers).values(Object.values(EDGE_SMOKE_DUSK_PLAYERS).map((player) => ({
    id: player.id,
    gameId,
    userId: player.id === EDGE_SMOKE_DUSK_PLAYERS.lilith.id ? userId : null,
    agentProfileId: player.id === EDGE_SMOKE_DUSK_PLAYERS.lilith.id ? agentProfileId : null,
    persona: JSON.stringify({
      name: player.name,
      personality: `${player.name} fixture persona`,
      personaKey: "strategic",
    }),
    agentConfig: JSON.stringify({ model: "test-model", temperature: 0 }),
  })));
  await db.insert(schema.gameResults).values({
    id: randomUUID(),
    gameId,
    winnerId: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
    roundsPlayed: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
    tokenUsage: JSON.stringify({ promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0 }),
    finishedAt: "2026-07-01T00:00:00.000Z",
  });
  const ownerEpoch = await insertOwner(db, gameId);
  await appendGameEvents(db, {
    gameId,
    ownerEpoch,
    events,
  });
}

function addNamedAllianceOverlay(
  baseEvents: readonly CanonicalGameEvent[],
): CanonicalGameEvent[] {
  const completed = buildCompletedGameResults({
    events: baseEvents,
    terminalResult: {
      winnerId: EDGE_SMOKE_DUSK_EXPECTED.winnerId,
      winnerName: EDGE_SMOKE_DUSK_EXPECTED.winnerName,
      roundsPlayed: EDGE_SMOKE_DUSK_EXPECTED.roundsPlayed,
    },
  });
  const sequenceStart = Math.max(...baseEvents.map((event) => event.sequence)) + 1;
  const gameId = baseEvents[0]!.gameId;
  const overlayEvents = completed.eliminationOrder.slice(0, 2).flatMap((elimination, index) => {
    const round = completed.rounds.find((entry) => entry.round === elimination.round)!;
    const cuttingVoter = round.canonicalFacts.roundFacts.council.ledger.find((entry) =>
      entry.target.id === elimination.player.id
    )!.voter;
    return namedAllianceEventsForCut({
      gameId,
      eliminated: elimination.player,
      cuttingVoter,
      round: elimination.round,
      sequenceStart: sequenceStart + index * 4,
      suffix: index + 1,
    });
  });
  return [...baseEvents, ...overlayEvents];
}

function namedAllianceEventsForCut({
  gameId,
  eliminated,
  cuttingVoter,
  round,
  sequenceStart,
  suffix,
}: {
  gameId: string;
  eliminated: { id: string; name: string };
  cuttingVoter: { id: string; name: string };
  round: number;
  sequenceStart: number;
  suffix: number;
}): CanonicalGameEvent[] {
  const timestamp = `2026-06-14T00:0${suffix}:00.000Z`;
  const allianceId = `alliance-smoke-vote-${suffix}`;
  const lineageId = `lineage-smoke-vote-${suffix}`;
  const versionId = `version-smoke-vote-${suffix}`;
  const outcomeId = `outcome-smoke-vote-${suffix}`;
  const sessionId = `session-smoke-vote-${suffix}`;
  const lineage: AllianceProposalLineage = {
    id: lineageId,
    allianceId,
    status: "activated",
    currentVersionId: versionId,
    versions: [{
      versionId,
      proposerId: cuttingVoter.id,
      terms: {
        name: `Smoke Vote Pair ${suffix}`,
        memberIds: [eliminated.id, cuttingVoter.id],
        purpose: `Hide the round ${round} vote behind a fake split.`,
        timebox: `round_${round}`,
      },
      requiredConsentMemberIds: [eliminated.id, cuttingVoter.id],
      counterIndex: 0,
      createdRound: round,
      createdAt: timestamp,
    }],
    responsesByVersion: {
      [versionId]: {
        [eliminated.id]: "accepted",
        [cuttingVoter.id]: "accepted",
      },
    },
    createdRound: round,
    createdAt: timestamp,
    resolvedRound: round,
    resolvedAt: timestamp,
  };
  const alliance: AllianceRecord = {
    id: allianceId,
    name: `Smoke Vote Pair ${suffix}`,
    memberIds: [eliminated.id, cuttingVoter.id],
    purpose: `Hide the round ${round} vote behind a fake split.`,
    timebox: `round_${round}`,
    status: "active",
    createdRound: round,
    createdAt: timestamp,
    updatedRound: round,
    updatedAt: timestamp,
    lineageIds: [lineageId],
    huddleOutcomeIds: [outcomeId],
  };
  const outcome: AllianceHuddleOutcome = {
    id: outcomeId,
    sessionId,
    allianceId: alliance.id,
    window: "pre_vote",
    round,
    ask: `Coordinate the round ${round} vote.`,
    plan: "Vote together, then deny there was a pact.",
    promises: ["Keep the pair quiet."],
    dissent: [],
    confidence: "medium",
    posture: "concealed",
    leakOrBetrayalClaims: [`${cuttingVoter.name} may leak the pair.`],
    createdAt: timestamp,
  };
  const eventBase = {
    gameId,
    round,
    timestamp,
    source: "engine" as const,
    visibility: "producer" as const,
    payloadVersion: 1 as const,
    sourcePointers: [],
  };
  return [
    {
      ...eventBase,
      sequence: sequenceStart,
      phase: Phase.MINGLE_I,
      type: "alliance.proposal_submitted",
      payload: { lineage },
    },
    {
      ...eventBase,
      sequence: sequenceStart + 1,
      phase: Phase.MINGLE_I,
      type: "alliance.activated",
      payload: { lineage, alliance },
    },
    {
      ...eventBase,
      sequence: sequenceStart + 2,
      phase: Phase.PRE_VOTE_HUDDLE,
      type: "alliance.huddle_completed",
      payload: {
        session: {
          id: sessionId,
          scheduleId: `schedule-smoke-vote-${suffix}`,
          allianceId: alliance.id,
          window: "pre_vote",
          round,
          pass: 1,
          speakerIds: [eliminated.id, cuttingVoter.id],
          completedAt: timestamp,
        },
      },
    },
    {
      ...eventBase,
      sequence: sequenceStart + 3,
      phase: Phase.PRE_VOTE_HUDDLE,
      type: "alliance.huddle_outcome_recorded",
      payload: { outcome, alliance },
    },
  ];
}
