import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { createPublicPlayerRoutes } from "../routes/public-players.js";
import { grantAward } from "../services/awards.js";
import { completedWerewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";

type FoundProfile = Extract<Awaited<ReturnType<typeof import("../services/public-agent-profile.js").getPublicAgentProfile>>, { status: "found" }>;

async function fixture() {
  const db = await setupTestDB(), owner = randomUUID(), agent = randomUUID(), other = randomUUID();
  await db.insert(schema.users).values({ id: owner, handle: "public-architect", displayName: "Public Architect", email: "PRIVATE_EMAIL@example.test", walletAddress: "0x1234567890abcdef1234567890abcdef12345678" });
  await db.insert(schema.agentProfiles).values([
    { id: agent, userId: owner, name: "Public Agent", personaKey: "strategic", personality: "PRIVATE_PERSONALITY", strategyStyle: "PRIVATE_INFLUENCE", werewolfStrategyStyle: "PRIVATE_WEREWOLF", backstory: "PRIVATE_BACKSTORY" },
    { id: other, userId: owner, name: "Other Owned Agent", personality: "PRIVATE_OTHER" },
  ]);
  return { db, owner, agent, other, app: createPublicPlayerRoutes(db) };
}
async function influence(db: DrizzleDB, owner: string, agent: string, slug: string, visibility = "public", endedAt = "2026-10-01T00:00:00.000Z") {
  const game = randomUUID();
  await db.insert(schema.games).values({ id: game, slug, status: "completed", endedAt, config: JSON.stringify({ visibility }) });
  await db.insert(schema.gamePlayers).values({ id: randomUUID(), gameId: game, userId: owner, agentProfileId: agent, persona: JSON.stringify({ name: "Frozen Public Name", personality: "PRIVATE_SEAT" }), agentConfig: "{}" });
  return game;
}

test("anonymous agent profile is allowlisted, agent-scoped before limits, and excludes hidden/unlisted games", async () => {
  const { db, app, owner, agent, other } = await fixture();
  await influence(db, owner, agent, "public-agent-game");
  await influence(db, owner, agent, "unlisted-agent-game", "unlisted");
  const hidden = await influence(db, owner, agent, "hidden-agent-game");
  await db.update(schema.games).set({ hiddenAt: "2026-10-02T00:00:00.000Z" }).where(eq(schema.games.id, hidden));
  for (let i = 0; i < 21; i++) await influence(db, owner, other, `other-agent-game-${i}`, "public", "2026-11-01T00:00:00.000Z");
  await grantAward(db, { definitionCode: "season-0-agent-participant", recipient: { type: "agent", id: agent }, actorId: owner, sourceKey: "public-agent-fixture", evidence: { secret: "PRIVATE_AWARD" }, reason: "PRIVATE_REASON", requestId: randomUUID() });
  const response = await app.request(`/api/public/agents/${agent}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.json() as FoundProfile;
  expect(Object.keys(body.profile).sort()).toEqual(["name", "avatarUrl", "role", "profileHref", "owner", "competition", "awards", "recentResults"].sort());
  expect(body.profile.profileHref).toBe(`/agents/${agent}`);
  expect(body.profile.owner!.displayName).toBe("Public Architect");
  expect(Object.keys(body.profile.owner!).sort()).toEqual(["publicId", "handle", "displayName"].sort());
  expect(body.profile.awards).toHaveLength(1);
  expect(body.profile.recentResults.map((row: { gameSlug: string }) => row.gameSlug)).toEqual(["public-agent-game"]);
  expect(JSON.stringify(body)).not.toMatch(/PRIVATE_|unlisted-agent-game|hidden-agent-game|other-agent-game|0x1234567890/);
  expect((await app.request(`/api/public/agents/${agent}?game=invalid`)).status).toBe(400);
});

test("unavailable, archived, unapproved and synthetic agents return anonymous no-store 404s", async () => {
  const { db, app, owner, agent } = await fixture();
  const get = () => app.request(`/api/public/agents/${agent}`);
  await db.update(schema.agentProfiles).set({ moderationRequired: true, contentRevisionId: null }).where(eq(schema.agentProfiles.id, agent));
  expect((await get()).status).toBe(404);
  await db.update(schema.agentProfiles).set({ moderationRequired: false, archivedAt: "2026-11-01T00:00:00.000Z" }).where(eq(schema.agentProfiles.id, agent));
  expect((await get()).status).toBe(404);
  await db.update(schema.agentProfiles).set({ archivedAt: null }).where(eq(schema.agentProfiles.id, agent));
  await db.update(schema.users).set({ walletAddress: "imported-private-fixture" }).where(eq(schema.users.id, owner));
  expect((await get()).status).toBe(404);
  const absent = await app.request(`/api/public/agents/${randomUUID()}`);
  expect(absent.status).toBe(404);
  expect(absent.headers.get("Cache-Control")).toBe("no-store");
  expect(await absent.json()).toEqual({ schemaVersion: 1, status: "not_found" });
});

test("Werewolf history includes only this agent's canonical completed public participation", async () => {
  const { db, app, owner, agent, other } = await fixture();
  const game = randomUUID(), events = await completedWerewolfResultsFixture("village", game), start = events[0]!;
  if (start.type !== "werewolf.started") throw Error("Invalid fixture");
  start.payload.players.forEach((player, i) => { player.agentProfileId = i === 0 ? agent : other; });
  await db.insert(schema.games).values({ id: game, slug: "public-agent-werewolf", gameKind: "werewolf", status: "completed", endedAt: "2026-11-01T00:00:00.000Z", config: "{}" });
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: game, sequence: event.sequence, event })));
  await influence(db, owner, agent, "public-agent-influence");
  const response = await app.request(`/api/public/agents/${agent}?game=werewolf`), body = await response.json() as FoundProfile;
  expect(response.status).toBe(200);
  expect(body.profile.recentResults).toHaveLength(1);
  expect(body.profile.recentResults[0]).toMatchObject({ agentProfileId: agent, gameKind: "werewolf", playerId: start.payload.players[0]!.id });
  expect(body.profile.recentResults[0]!.result).not.toBeNull();
  expect(JSON.stringify(body)).not.toMatch(/PRIVATE_|nightActions|thinking|strategyStyle/);
});
