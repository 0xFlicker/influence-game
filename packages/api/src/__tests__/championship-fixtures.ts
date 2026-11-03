import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ChampionshipPolicies } from "@influence/engine/championship";
import { schema } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { storeJson } from "../services/payload-storage.js";
import { createChampionshipDraft } from "../services/championships.js";

// Test-only choices are explicit fixtures, not production policy defaults.
export const policies: ChampionshipPolicies = {
  roleComposition: { werewolf: 2, seer: 1, doctor: 1, villager: 4 }, points: { win: 1, loss: 0, draw: 0 },
  equalScoreFallback: "season_rank", participationMinimumCompletedGames: 1, ownerAttribution: "qualification",
};
export async function championshipFixture() {
  const db = await setupTestDB();
  const actorId = randomUUID(), seasonId = randomUUID();
  await db.insert(schema.users).values({ id: actorId, displayName: "Championship test owner", email: `${actorId}@example.test` });
  await db.insert(schema.seasons).values({ id: seasonId, slug: `season-${seasonId}`, name: "Season 0", status: "final" });
  const agents: string[] = [];
  const gameId = randomUUID();
  await db.insert(schema.games).values({ id: gameId, slug: `source-${gameId}`, status: "completed", config: "{}", seasonId, minPlayers: 8, maxPlayers: 8 });
  for (let index = 0; index < 8; index++) {
    const id = randomUUID(), revision = randomUUID(); agents.push(id);
    await db.insert(schema.agentProfiles).values({ id, userId: actorId, name: `Finalist ${index}`, personality: "Frozen personality", strategyStyle: "Influence strategy", werewolfStrategyStyle: "Werewolf strategy" });
    await db.insert(schema.agentRevisions).values({ id: revision, agentProfileId: id, ordinal: 1, trigger: "profile_create", magnitude: "initial", fingerprint: `test-${id}`,
      behaviorSnapshot: await storeJson({}), effectiveRuntimeSnapshot: await storeJson({}), revisionPolicyVersion: "test" });
    await db.update(schema.agentProfiles).set({ currentRevisionId: revision }).where(eq(schema.agentProfiles.id, id));
    await db.insert(schema.competitionReceipts).values({ id: randomUUID(), seasonId, gameId, ownerId: actorId, agentProfileId: id, agentRevisionId: revision,
      agentNameSnapshot: `Finalist ${index}`, eligibilityStatus: "eligible", lobbySize: 8, placement: index + 1,
      basePoints: 100 - index, totalPoints: 100 - index, scoringPolicyVersion: "test", earnedAt: "2026-10-01T00:00:00.000Z" });
  }
  const event = await createChampionshipDraft(db, { actorId, sourceSeasonId: seasonId, name: "Season 0 Championship", slug: `event-${seasonId}` });
  return { db, actorId, seasonId, agents, event };
}
