import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { schema, type DrizzleDB } from "../db/index.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import {
  exportOwnedSeasonReceipts,
  getOwnedAgentSeasonAnalysis,
  getProducerSeasonDiagnostics,
  getPublicSeasonDashboard,
  getPublicGameCompetitionReceipts,
} from "../services/season-read-model.js";
import {
  closeSeason,
  createSeason,
  finalizeSeason,
} from "../services/seasons.js";
import { ProductionGameMcpReadModel } from "../game-mcp/read-model.js";
import { createSeasonRoutes } from "../routes/seasons.js";
import { setupTestDB } from "./test-utils.js";

describe("season read model", () => {
  test("derives both crowns and exact Architect weights from eligible receipts", async () => {
    const fixture = await seedStandingsFixture();
    const dashboard = await getPublicSeasonDashboard(fixture.db, fixture.seasonSlug);

    expect(dashboard?.agentStandings.map((standing) => [standing.agentName, standing.totalPoints])).toEqual([
      ["Alpha", 120],
      ["Solo", 112],
      ["Beta", 44],
      ["Gamma", 40],
      ["Delta", 6],
    ]);
    expect(dashboard?.architectStandings[0]).toMatchObject({
      ownerId: fixture.ownerA,
      totalPointsHundredths: 15200,
      contributions: [
        { agentName: "Alpha", sourcePoints: 120, weightPercent: 100, weightedPointsHundredths: 12000 },
        { agentName: "Beta", sourcePoints: 44, weightPercent: 50, weightedPointsHundredths: 2200 },
        { agentName: "Gamma", sourcePoints: 40, weightPercent: 25, weightedPointsHundredths: 1000 },
      ],
    });
    assertNoHiddenCompetitionEvidence(dashboard);
  });

  test("returns owner-only revision analysis without classifier or hidden rating fields", async () => {
    const fixture = await seedStandingsFixture();
    const allowed = await getOwnedAgentSeasonAnalysis(fixture.db, {
      seasonIdOrSlug: fixture.seasonSlug,
      agentId: fixture.alphaId,
      ownerId: fixture.ownerA,
    });
    const denied = await getOwnedAgentSeasonAnalysis(fixture.db, {
      seasonIdOrSlug: fixture.seasonSlug,
      agentId: fixture.alphaId,
      ownerId: fixture.ownerB,
    });

    expect(allowed).toMatchObject({
      agent: { id: fixture.alphaId, name: "Alpha" },
      summary: { totalPoints: 120, gamesPlayed: 1, wins: 1 },
    });
    expect(allowed?.revisions).toHaveLength(1);
    assertNoHiddenCompetitionEvidence(allowed);
    expect(denied).toBeNull();
  });

  test("adds the agent's current season total to game receipts", async () => {
    const fixture = await seedStandingsFixture();
    const alpha = (await fixture.db.select().from(schema.agentProfiles))
      .find((profile) => profile.id === fixture.alphaId)!;
    const laterGameId = randomUUID();
    await fixture.db.insert(schema.games).values({
      id: laterGameId,
      slug: `later-${laterGameId}`,
      config: "{}",
      status: "completed",
      trackType: "free",
      seasonId: fixture.seasonId,
      minPlayers: 4,
      maxPlayers: 4,
      endedAt: "2026-07-20T00:00:00.000Z",
    });
    await fixture.db.insert(schema.competitionReceipts).values({
      id: randomUUID(),
      seasonId: fixture.seasonId,
      gameId: laterGameId,
      ownerId: fixture.ownerA,
      agentProfileId: fixture.alphaId,
      agentRevisionId: alpha.currentRevisionId!,
      ownerDisplayNameSnapshot: "Architect A",
      agentNameSnapshot: "Alpha",
      eligibilityStatus: "eligible",
      lobbySize: 4,
      placement: 3,
      basePoints: 5,
      fieldBonus: 0,
      totalPoints: 5,
      scoringPolicyVersion: "season-scoring-v1",
      earnedAt: "2026-07-20T00:00:00.000Z",
    });

    const game = await getPublicGameCompetitionReceipts(
      fixture.db,
      fixture.seasonSlug,
      fixture.firstGameId,
    );

    expect(game?.receipts[0]).toMatchObject({
      agentName: "Alpha",
      totalPoints: 120,
      seasonTotalPoints: 125,
    });
  });

  test("exports bounded owner data with JSON parity and spreadsheet-safe CSV", async () => {
    const fixture = await seedStandingsFixture({ injectedName: true });
    const json = await exportOwnedSeasonReceipts(fixture.db, {
      seasonIdOrSlug: fixture.seasonSlug,
      ownerId: fixture.ownerA,
      format: "json",
    });
    const csv = await exportOwnedSeasonReceipts(fixture.db, {
      seasonIdOrSlug: fixture.seasonSlug,
      ownerId: fixture.ownerA,
      format: "csv",
      limit: 2,
    });

    expect(json?.rowCount).toBe(4);
    expect(JSON.parse(json!.body).receipts).toHaveLength(4);
    expect(csv).toMatchObject({ rowCount: 2, truncated: true, contentType: "text/csv" });
    expect(csv?.body).toContain("'=SUM(A1:A2)");
    expect(csv?.body.split("\n")).toHaveLength(3);

    const oneAgent = await exportOwnedSeasonReceipts(fixture.db, {
      seasonIdOrSlug: fixture.seasonSlug,
      ownerId: fixture.ownerA,
      agentId: fixture.alphaId,
      format: "json",
    });
    expect(oneAgent?.rowCount).toBe(1);
  });

  test("keeps private evidence available only through the producer read", async () => {
    const fixture = await seedStandingsFixture();
    const producer = await getProducerSeasonDiagnostics(fixture.db, fixture.seasonSlug);
    expect(producer?.ratings[0]).toMatchObject({ mu: 25, sigma: 25 / 3 });
    expect(producer?.receiptEvidence[0]?.opponentRatings).toEqual([{ mu: 25, sigma: 25 / 3 }]);
    expect(producer?.ratingEvents.some((event) =>
      event.eventType === "revision_recalibration"
      && event.evidence.classification === "producer-only"
    )).toBe(true);
    expect(producer?.ratingSnapshots).toEqual([]);
  });

  test("readiness ignores cancelled seats and requires at least one eligible receipt", async () => {
    const cancelledFixture = await seedStandingsFixture();
    const cancelledGameId = randomUUID();
    await cancelledFixture.db.insert(schema.games).values({
      id: cancelledGameId,
      slug: `cancelled-${cancelledGameId}`,
      config: "{}",
      status: "cancelled",
      trackType: "free",
      seasonId: cancelledFixture.seasonId,
      minPlayers: 4,
      maxPlayers: 4,
    });
    await cancelledFixture.db.insert(schema.gamePlayers).values({
      id: randomUUID(),
      gameId: cancelledGameId,
      userId: cancelledFixture.ownerA,
      agentProfileId: cancelledFixture.alphaId,
      persona: "{}",
      agentConfig: "{}",
    });
    await cancelledFixture.db.update(schema.seasons).set({ status: "closing" });
    expect((await getProducerSeasonDiagnostics(
      cancelledFixture.db, cancelledFixture.seasonSlug,
    ))?.readiness).toMatchObject({ unsettledOwnedSeats: 0, canFinalize: true });

    const ineligibleFixture = await seedStandingsFixture();
    await ineligibleFixture.db.update(schema.seasons).set({ status: "closing" });
    await ineligibleFixture.db.update(schema.competitionReceipts)
      .set({
        eligibilityStatus: "ineligible",
        eligibilityReason: "test",
        placement: null,
        basePoints: 0,
        fieldBonus: 0,
        totalPoints: 0,
      });
    expect((await getProducerSeasonDiagnostics(
      ineligibleFixture.db, ineligibleFixture.seasonSlug,
    ))?.readiness.canFinalize).toBe(false);
  });

  test("reconciles four field combinations across REST, MCP, JSON, and CSV", async () => {
    const fixture = await seedStandingsFixture();
    await closeSeason(fixture.db, fixture.seasonId, "2026-07-20T00:00:00.000Z");
    await finalizeSeason(fixture.db, fixture.seasonId, "2026-07-21T00:00:00.000Z");
    const restResponse = await createSeasonRoutes(fixture.db).request(
      `/api/seasons/${fixture.seasonSlug}`,
    );
    expect(restResponse.status).toBe(200);
    const rest = await restResponse.json() as Awaited<ReturnType<typeof getPublicSeasonDashboard>>;
    const mcp = await new ProductionGameMcpReadModel(fixture.db).readSeason(fixture.seasonSlug);
    const jsonExport = await exportOwnedSeasonReceipts(fixture.db, {
      seasonIdOrSlug: fixture.seasonSlug,
      ownerId: fixture.ownerA,
      format: "json",
    });
    const csvExport = await exportOwnedSeasonReceipts(fixture.db, {
      seasonIdOrSlug: fixture.seasonSlug,
      ownerId: fixture.ownerA,
      format: "csv",
    });

    expect(rest).not.toBeNull();
    expect(mcp.agentStandings).toEqual(rest!.agentStandings);
    expect(mcp.architectStandings).toEqual(rest!.architectStandings);
    expect(rest!.honors?.agentChampion.agentId).toBe(rest!.agentStandings[0]!.agentId);
    expect(rest!.honors?.architectChampion.ownerId).toBe(rest!.architectStandings[0]!.ownerId);
    const jsonReceipts = (JSON.parse(jsonExport!.body) as {
      receipts: Array<{ agentId: string; totalPoints: number; lobbySize: number; fieldBonus: number }>;
    }).receipts;
    expect(new Set(jsonReceipts.map((receipt) =>
      `${receipt.lobbySize}:${receipt.fieldBonus > 0 ? "bonus" : "baseline"}`
    )).size).toBeGreaterThanOrEqual(4);
    const alphaStanding = rest!.agentStandings.find((standing) => standing.ownerId === fixture.ownerA
      && standing.agentId === fixture.alphaId)!;
    expect(alphaStanding.totalPoints).toBe(
      jsonReceipts.filter((receipt) => receipt.agentId === fixture.alphaId)
        .reduce((sum, receipt) => sum + receipt.totalPoints, 0),
    );
    const totalPointsColumn = csvExport!.body.split("\n")[0]!.split(",").indexOf("totalPoints");
    const csvTotal = csvExport!.body.split("\n").slice(1).reduce((sum, line) => {
      const cell = line.split(",")[totalPointsColumn] ?? "0";
      return sum + Number(cell.replaceAll('"', ""));
    }, 0);
    expect(csvTotal).toBe(jsonReceipts.reduce((sum, receipt) => sum + receipt.totalPoints, 0));
    const publicGame = await getPublicGameCompetitionReceipts(
      fixture.db, fixture.seasonSlug, fixture.firstGameId,
    );
    expect(JSON.stringify(publicGame)).not.toContain("revisionId");
    expect(JSON.parse(jsonExport!.body).receipts[0]).toHaveProperty("revisionId");
    assertNoHiddenCompetitionEvidence(rest);
    assertNoHiddenCompetitionEvidence(mcp);
    assertNoHiddenCompetitionEvidence(JSON.parse(jsonExport!.body));
  });
});

async function seedStandingsFixture(options: { injectedName?: boolean } = {}) {
  const db = await setupTestDB();
  const ownerA = await insertUser(db, "Architect A");
  const ownerB = await insertUser(db, "Architect B");
  const agents = await Promise.all([
    createAgent(db, ownerA, options.injectedName ? "=SUM(A1:A2)" : "Alpha"),
    createAgent(db, ownerA, "Beta"),
    createAgent(db, ownerA, "Gamma"),
    createAgent(db, ownerA, "Delta"),
    createAgent(db, ownerB, "Solo"),
  ]);
  const [alpha, beta, gamma, delta, solo] = agents;
  const season = await createSeason(db, {
    slug: `read-model-${randomUUID()}`,
    name: "Read Model Season",
    createdById: ownerA,
  });
  const lobbySizes = [4, 8, 12, 4, 8];
  const placements = [1, 2, 3, 3, 1];
  const basePoints = [100, 37, 33, 6, 100];
  const fieldBonuses = [20, 7, 7, 0, 12];
  const awards = basePoints.map((base, index) => base + fieldBonuses[index]!);
  let firstGameId: string | null = null;
  for (let index = 0; index < agents.length; index += 1) {
    const agent = agents[index]!;
    const gameId = randomUUID();
    firstGameId ??= gameId;
    await db.insert(schema.games).values({
      id: gameId,
      slug: `source-${index}-${gameId}`,
      config: "{}",
      status: "completed",
      trackType: "free",
      seasonId: season.id,
      minPlayers: lobbySizes[index]!,
      maxPlayers: lobbySizes[index]!,
      endedAt: `2026-07-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`,
    });
    const receiptId = randomUUID();
    const totalPoints = awards[index]!;
    await db.insert(schema.competitionReceipts).values({
      id: receiptId,
      seasonId: season.id,
      gameId,
      ownerId: agent.ownerId,
      agentProfileId: agent.profile.id,
      agentRevisionId: agent.revisionId,
      ownerDisplayNameSnapshot: agent.ownerId === ownerA ? "Architect A" : "Architect B",
      agentNameSnapshot: agent.profile.name,
      eligibilityStatus: "eligible",
      lobbySize: lobbySizes[index]!,
      placement: placements[index]!,
      basePoints: basePoints[index]!,
      fieldBonus: fieldBonuses[index]!,
      totalPoints,
      accountRatingDelta: index - 2,
      scoringPolicyVersion: "season-scoring-v1",
      earnedAt: `2026-07-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`,
    });
    await db.insert(schema.competitionReceiptEvidence).values({
      receiptId,
      ratingPolicyVersion: "competition-rating-v1",
      pregameRating: { mu: 25, sigma: 25 / 3 },
      postgameRating: { mu: 26, sigma: 8 },
      opponentRatings: [{ mu: 25, sigma: 25 / 3 }],
      fieldStrengthEvidence: {
        bonusRate: fieldBonuses[index]! / basePoints[index]!,
      },
    });
    await db.insert(schema.competitionRatingEvents).values({
      id: randomUUID(),
      idempotencyKey: `read-model:${agent.profile.id}`,
      agentProfileId: agent.profile.id,
      agentRevisionId: agent.revisionId,
      seasonId: season.id,
      gameId,
      eventType: "game_result",
      beforeMu: 25,
      beforeSigma: 25 / 3,
      afterMu: 26,
      afterSigma: 8,
      ratingPolicyVersion: "competition-rating-v1",
      revisionPolicyVersion: "agent-revision-v1",
      evidence: {},
    });
    await db.insert(schema.agentCompetitionRatings).values({
      agentProfileId: agent.profile.id,
      effectiveRevisionId: agent.revisionId,
      mu: 25,
      sigma: 25 / 3,
      gamesPlayed: 1,
      ratingPolicyVersion: "competition-rating-v1",
    });
  }
  await db.insert(schema.competitionRatingEvents).values({
    id: randomUUID(),
    idempotencyKey: `read-model:revision:${alpha!.profile.id}`,
    agentProfileId: alpha!.profile.id,
    agentRevisionId: alpha!.revisionId,
    seasonId: null,
    gameId: null,
    eventType: "revision_recalibration",
    beforeMu: 25,
    beforeSigma: 7,
    afterMu: 25,
    afterSigma: 8,
    ratingPolicyVersion: "competition-rating-v1",
    revisionPolicyVersion: "agent-revision-v1",
    evidence: { classification: "producer-only" },
  });
  return {
    db,
    ownerA,
    ownerB,
    seasonSlug: season.slug,
    seasonId: season.id,
    firstGameId: firstGameId!,
    alphaId: alpha!.profile.id,
    betaId: beta!.profile.id,
    gammaId: gamma!.profile.id,
    deltaId: delta!.profile.id,
    soloId: solo!.profile.id,
  };
}

function assertNoHiddenCompetitionEvidence(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    '"mu"',
    '"sigma"',
    '"expected"',
    '"opponentRatings"',
    '"ratingBefore"',
    '"ratingAfter"',
    '"magnitude"',
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
}

async function createAgent(db: DrizzleDB, ownerId: string, name: string) {
  const profile = (await createOwnedAgentProfile(db, { userId: ownerId }, {
    name,
    personality: `${name} personality`,
  })).profile;
  const revision = (await db.select().from(schema.agentRevisions))
    .find((candidate) => candidate.agentProfileId === profile.id)!;
  return { ownerId, profile, revisionId: revision.id };
}

async function insertUser(db: DrizzleDB, displayName: string): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.users).values({ id, displayName, email: `${id}@example.test` });
  return id;
}
