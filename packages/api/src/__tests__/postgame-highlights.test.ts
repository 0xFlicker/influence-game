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
  type HouseHighlightSceneCard,
  type HouseHighlightsProjection,
  type PlayerRef,
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
  redactHouseHighlightsDiagnostics,
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
    expect(result.schemaVersion).toBe(3);
    expect(result.highlights.schemaVersion).toBe(3);
    expect(result.highlights.state).toBe("main_cut");
    expect(result.highlights.cut?.kind).toBe("main");
    expect(result.highlights.scenes.length).toBeGreaterThanOrEqual(3);
    expect(result.highlights.scenes.every((scene) => scene.receipts.length > 0)).toBe(true);
    expect(result.highlights.scenes.every((scene) => ["medium", "high"].includes(scene.confidence))).toBe(true);
    expect(result.highlights.scenes.every((scene) => scene.visualBrief.visualType.length > 0)).toBe(true);
    expect(result.highlights.scenes.every(hasPublicSceneShape)).toBe(true);
    const firstVoteScene = result.highlights.scenes.find((scene) =>
      scene.visualBrief.visualType === "betrayal_vote"
    ) as {
      visualCard?: {
        factLines: Array<{ kind: string; text: string }>;
        template: string;
        altText: string;
        primaryAgents: Array<{ id: string; name: string; avatarUrl?: string | null }>;
        secondaryAgents: Array<{ id: string; name: string; avatarUrl?: string | null }>;
      };
    } | undefined;
    expect(firstVoteScene?.visualCard?.template).toBe("hero_vote_action");
    expect(firstVoteScene?.visualCard?.altText.length).toBeGreaterThan(0);
    expect(firstVoteScene?.visualCard?.altText).not.toMatch(/[.!?]{2,}/);
    expect([
      ...(firstVoteScene?.visualCard?.primaryAgents ?? []),
      ...(firstVoteScene?.visualCard?.secondaryAgents ?? []),
    ].every((agent) => agent.avatarUrl?.startsWith("https://cdn.example.test/avatars/"))).toBe(true);
    expect(firstVoteScene?.visualCard?.factLines.some((line) => /eliminated|voted|alliance/i.test(line.text))).toBe(true);
    expect(firstVoteScene?.visualCard?.factLines.map((line) => line.kind)).not.toContain("elimination");
    expect(firstVoteScene?.visualCard?.factLines.map((line) => line.kind)).not.toContain("outcome");
    expect(JSON.stringify(firstVoteScene?.visualCard)).not.toMatch(/proof link|vote record|alliance receipt|receipt badge/i);
    const allianceFactLines = result.highlights.scenes.flatMap((scene) =>
      scene.visualCard.factLines.filter((line) => line.kind === "alliance_membership")
    );
    expect(allianceFactLines.every((line) => line.receiptIds.length > 0)).toBe(true);
    expect(allianceFactLines.some((line) => line.text.includes("a named alliance"))).toBe(false);
    for (const scene of result.highlights.scenes) {
      const roundLabel = scene.visualCard.roundLabel;
      if (!roundLabel) continue;
      expect(scene.visualCard.outcome).not.toContain(roundLabel);
      expect(scene.visualCard.factLines.some((line) => line.text.includes(roundLabel))).toBe(false);
    }
    expect(result.highlights.scenes.filter((scene) =>
      scene.visualCard.factLines.some((line) => line.kind === "vote_action")
    ).flatMap((scene) =>
      scene.visualCard.factLines.map((line) => line.kind)
    )).not.toContain("elimination");
    expect(result.highlights.scenes.flatMap((scene) =>
      scene.visualCard.factLines.map((line) => line.text)
    ).some((text) => /[.!?]\s+in Round/i.test(text))).toBe(false);
    expect("diagnostics" in result.highlights).toBe(false);
    expectNoPublicHighlightsLeaks(result);
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
    expect(body.schemaVersion).toBe(3);
    expect(body.highlights.schemaVersion).toBe(3);
    expect(body.highlights.state).toBe("main_cut");
    expect("diagnostics" in body.highlights).toBe(false);
    expect(body.highlights.scenes.every((scene) => scene.receipts.length > 0)).toBe(true);
    expect(body.highlights.scenes.every((scene) => ["medium", "high"].includes(scene.confidence))).toBe(true);
    expect(body.highlights.scenes.every((scene) => scene.visualBrief.templateLabel.length > 0)).toBe(true);
    expect(body.highlights.scenes.every(hasPublicSceneShape)).toBe(true);
    expectNoPublicHighlightsLeaks(body);
  });

  test("does not call a higher power-holder the runner-up for lower-ranked power scenes", () => {
    const leader = player("leader", "Lyra");
    const primary = player("primary", "Orion");

    const result = redactHouseHighlightsDiagnostics(
      powerStreakProjection(primary),
      {
        roundSummaries: [],
        summary: {
          finalists: [],
          dominantEmpoweredPlayers: [
            { player: leader, votes: 5 },
            { player: primary, votes: 3 },
          ],
        },
      },
    );

    const factText = result.scenes[0]?.visualCard.factLines.map((line) => line.text).join(" ");
    expect(factText).toContain("Orion held power 3 times.");
    expect(factText).not.toContain("Lyra was next");
  });

  test("names the true runner-up for the top power-holder", () => {
    const leader = player("leader", "Lyra");
    const runnerUp = player("runner-up", "Orion");

    const result = redactHouseHighlightsDiagnostics(
      powerStreakProjection(leader),
      {
        roundSummaries: [],
        summary: {
          finalists: [],
          dominantEmpoweredPlayers: [
            { player: leader, votes: 5 },
            { player: runnerUp, votes: 3 },
          ],
        },
      },
    );

    const fact = result.scenes[0]?.visualCard.factLines.find((line) => line.id.endsWith(":power-comparison"));
    expect(fact?.text).toBe("Lyra held power 5 times; Orion was next with 3.");
    expect(fact?.agentIds).toEqual(["leader", "runner-up"]);
  });

  test("does not call tied power leaders runner-up facts", () => {
    const leader = player("leader", "Lyra");
    const tied = player("tied", "Orion");

    const result = redactHouseHighlightsDiagnostics(
      powerStreakProjection(leader),
      {
        roundSummaries: [],
        summary: {
          finalists: [],
          dominantEmpoweredPlayers: [
            { player: leader, votes: 5 },
            { player: tied, votes: 5 },
          ],
        },
      },
    );

    const factText = result.scenes[0]?.visualCard.factLines.map((line) => line.text).join(" ");
    expect(factText).toContain("Lyra held power 5 times.");
    expect(factText).not.toContain("Orion was next with 5");
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

function player(id: string, name: string): PlayerRef {
  return { id, name };
}

function powerStreakProjection(primary: PlayerRef): HouseHighlightsProjection {
  const receiptId = "power:test";
  const scene: HouseHighlightSceneCard = {
    id: "power-scene",
    title: `${primary.name} kept taking the room's power`,
    category: "triumph" as const,
    involvedAgents: [primary],
    houseHook: `${primary.name} kept receiving power votes.`,
    setup: "Power votes kept returning to the same agent.",
    conflict: "Each repeat made the control structure visible.",
    payoff: `${primary.name} controlled power repeatedly.`,
    receipts: [{
      id: receiptId,
      tier: "vote_record" as const,
      label: "Power vote record",
      description: `${primary.name} received repeated power votes.`,
      factRefs: ["round:power"],
    }],
    confidence: "high" as const,
    deepLink: {
      surface: "results" as const,
      label: "Open power details",
      round: 1,
      anchor: "round-1",
    },
    visualBrief: {
      visualType: "power_streak" as const,
      templateLabel: "Power streak",
      primaryAgents: [primary],
      secondaryAgents: [],
      factualSlots: [
        {
          key: "primary_agent" as const,
          label: "Primary agent",
          status: "filled" as const,
          source: "canonical_fact" as const,
          agents: [primary],
          receiptIds: [receiptId],
        },
        {
          key: "round" as const,
          label: "Round",
          status: "filled" as const,
          source: "canonical_fact" as const,
          value: "1",
          receiptIds: [receiptId],
        },
      ],
      truthOverlays: ["agent_identity", "power_tally", "outcome_caption"],
      backdrop: {
        category: "spotlight_stage" as const,
        generatedAllowed: true,
        description: "Empty spotlight stage.",
      },
      shareFraming: ["page_native"],
      diagnostics: {
        forbiddenInventions: [],
        warnings: [],
        rejectedBackdropCategories: [],
      },
    },
  };
  return {
    schemaVersion: 2,
    state: "main_cut",
    eligibility: {
      status: "eligible",
      reason: null,
      allianceReceiptCount: 1,
    },
    thesis: "Power kept consolidating.",
    cut: {
      kind: "main",
      title: "Power kept consolidating.",
      thesis: "Power kept consolidating.",
      shareCaption: "Power kept consolidating.",
      scenes: [scene],
    },
    scenes: [scene],
    noCutReason: null,
    fallbackLinks: [],
    diagnostics: {
      selectedSceneIds: [scene.id],
      selectedCandidates: [],
      rejectedCandidates: [],
      notes: [],
    },
  };
}

const PUBLIC_HIGHLIGHTS_FORBIDDEN_TERMS = [
  "posterDirection",
  "forbiddenInventions",
  "rejectedBackdropCategories",
  "truthOverlays",
  "factualSlots",
  "proof_link",
  "receipt_badge",
  "\"eventRefs\"",
  "\"eventType\"",
  "\"sequence\"",
  "sourcePointers",
  "payloadVersion",
  "privateReasoning",
  "hiddenTrace",
  "storageKey",
  "rawProviderResponse",
  "original_data_url",
  "diagnostics",
] as const;

function expectNoPublicHighlightsLeaks(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const term of PUBLIC_HIGHLIGHTS_FORBIDDEN_TERMS) {
    expect(serialized).not.toContain(term);
  }
}

function hasPublicSceneShape(scene: unknown): boolean {
  const record = scene as Record<string, unknown>;
  expect(Object.keys(record).sort()).toEqual([
    "category",
    "confidence",
    "conflict",
    "deepLink",
    "houseHook",
    "id",
    "involvedAgents",
    "payoff",
    "receipts",
    "setup",
    "title",
    "visualBrief",
    "visualCard",
  ].sort());
  expect(Object.keys(record.visualBrief as Record<string, unknown>).sort()).toEqual([
    "backdrop",
    "primaryAgents",
    "secondaryAgents",
    "shareFraming",
    "templateLabel",
    "visualType",
  ].sort());
  expect((record.receipts as Array<Record<string, unknown>>).every((receipt) =>
    !("eventRefs" in receipt)
  )).toBe(true);
  return true;
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
  const agentProfileIds = Object.fromEntries(
    Object.values(EDGE_SMOKE_DUSK_PLAYERS).map((player) => [player.id, `agent-${player.id}`]),
  );
  await db.insert(schema.users).values({
    id: userId,
    email: "lilith@test.example",
    displayName: "Lilith Owner",
  });
  await db.insert(schema.agentProfiles).values(Object.values(EDGE_SMOKE_DUSK_PLAYERS).map((player) => ({
    id: agentProfileIds[player.id]!,
    userId,
    name: player.name,
    personality: `${player.name} fixture profile.`,
    personaKey: "strategic",
    avatarUrl: `https://cdn.example.test/avatars/${player.id}.png`,
  })));
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
    agentProfileId: agentProfileIds[player.id],
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
