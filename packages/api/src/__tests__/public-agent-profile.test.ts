import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { createPublicPlayerRoutes } from "../routes/public-players.js";
import { grantAward } from "../services/awards.js";
import { completedCurrentWerewolfFixture, completedWerewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { withPublicArtworkCapacity } from "../services/public-artwork-admission.js";
import { contentImageFixture } from "./content-image-fixture.js";
import { storeAgentDraftImage } from "../services/agent-draft-images.js";
import { storeBinary, storeJson } from "../services/payload-storage.js";

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
  expect(Object.keys(body.profile).sort()).toEqual(["name", "avatarUrl", "fullBodyImageUrl", "role", "profileHref", "owner", "competition", "werewolfRecord", "awards", "recentResults"].sort());
  expect(body.profile.profileHref).toBe(`/agents/${agent}`);
  expect(body.profile.fullBodyImageUrl).toBeNull();
  expect(body.profile.werewolfRecord).toEqual({ wins: 0, losses: 0, draws: 0 });
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

test("public card identity and artwork follow agent eligibility without exposing history", async () => {
  const { db, app, owner, agent } = await fixture();
  await db.update(schema.agentProfiles).set({ avatarUrl: "/avatars/personas/strategic.png" }).where(eq(schema.agentProfiles.id, agent));
  const card = await app.request(`/api/public/agents/${agent}/card`);
  expect(card.status).toBe(200);
  expect(await card.json()).toEqual({ schemaVersion: 1, status: "found", profile: { name: "Public Agent", avatarUrl: "/avatars/personas/strategic.png", profileHref: `/agents/${agent}`, awards: [] } });
  await grantAward(db, { definitionCode: "season-0-agent-participant", recipient: { type: "agent", id: agent }, actorId: owner, sourceKey: "card-fixture", evidence: { secret: "PRIVATE_AWARD" }, reason: "PRIVATE_REASON", requestId: randomUUID() });
  const awardedCard = await (await app.request(`/api/public/agents/${agent}/card`)).json() as { profile: { awards: Array<{ code: string }> } };
  expect(awardedCard.profile.awards.map(award => award.code)).toEqual(["season-0-agent-participant"]);
  expect(JSON.stringify(awardedCard)).not.toContain("PRIVATE_");
  expect((await app.request(`/api/public/agents/${agent}/art?kind=portrait`)).status).toBe(200);
  await db.update(schema.users).set({ walletAddress: "imported-private-fixture" }).where(eq(schema.users.id, owner));
  expect((await app.request(`/api/public/agents/${agent}/card`)).status).toBe(404);
  expect((await app.request(`/api/public/agents/${agent}/art?kind=portrait`)).status).toBe(404);
  await db.update(schema.users).set({ walletAddress: "0x1234567890abcdef1234567890abcdef12345678" }).where(eq(schema.users.id, owner));
  await db.update(schema.agentProfiles).set({ moderationRequired: true, contentRevisionId: null }).where(eq(schema.agentProfiles.id, agent));
  expect((await app.request(`/api/public/agents/${agent}/card`)).status).toBe(404);
  expect((await app.request(`/api/public/agents/${agent}/art?kind=portrait`)).status).toBe(404);
});

test("public artwork is limited to eligible agents and an explicit image kind", async () => {
  const { db, app, agent } = await fixture();
  await db.update(schema.agentProfiles).set({ avatarUrl: "/avatars/personas/strategic.png" }).where(eq(schema.agentProfiles.id, agent));
  const portrait = await app.request(`/api/public/agents/${agent}/art?kind=portrait`);
  expect(portrait.status).toBe(200);
  expect(portrait.headers.get("content-type")).toBe("image/png");
  expect(portrait.headers.get("cache-control")).toBe("private, no-store");
  expect((await portrait.arrayBuffer()).byteLength).toBeGreaterThan(0);
  expect((await app.request(`/api/public/agents/${agent}/art?kind=body`)).status).toBe(404);
  expect((await app.request(`/api/public/agents/${agent}/art?kind=full-body`)).status).toBe(404);
  expect((await app.request(`/api/public/agents/${agent}/art?kind=anything`)).status).toBe(400);
  await db.update(schema.agentProfiles).set({ archivedAt: "2026-11-01T00:00:00.000Z" }).where(eq(schema.agentProfiles.id, agent));
  expect((await app.request(`/api/public/agents/${agent}/art?kind=portrait`)).status).toBe(404);
});

test("profile artwork serves the approved full body before a derivative exists and keeps drafts private", async () => {
  const { db, app, owner, agent } = await fixture();
  const profileUrl = `/api/public/agents/${agent}`;
  const artUrl = `${profileUrl}/art?kind=full-body`;
  const source = "/avatars/personas/full-body-v1/strategic.webp";
  await db.update(schema.agentProfiles).set({ fullBodyReferenceUrl: source }).where(eq(schema.agentProfiles.id, agent));
  const body = await (await app.request(profileUrl)).json() as FoundProfile;
  expect(body.profile.fullBodyImageUrl).toBe(artUrl);
  expect(JSON.stringify(body)).not.toContain(source);
  const response = await app.request(artUrl);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/webp");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  expect((await app.request(`${profileUrl}/art?kind=body`)).status).toBe(404);

  const draft = await storeAgentDraftImage(db, owner, new Uint8Array([1, 2, 3]));
  await db.update(schema.agentProfiles).set({ fullBodyReferenceUrl: draft }).where(eq(schema.agentProfiles.id, agent));
  expect((await app.request(artUrl)).status).toBe(404);

  await db.update(schema.agentProfiles).set({ fullBodyReferenceUrl: source, archivedAt: "2026-11-01T00:00:00.000Z" }).where(eq(schema.agentProfiles.id, agent));
  expect((await app.request(artUrl)).status).toBe(404);
});

test("public agent artwork selects the saved derivative of the currently published body", async () => {
  const { db, app, owner, agent } = await fixture();
  const source = "/avatars/personas/full-body-v1/strategic.webp";
  const cutout = await contentImageFixture(`characters/${randomUUID()}.png`);
  const hash = "c".repeat(64), revision = randomUUID();
  await db.insert(schema.agentContentAssets).values({ hash, bytes: await storeBinary(Buffer.from("source")), transparentUrl: cutout });
  await db.insert(schema.agentContentRevisions).values({ id: revision, agentProfileId: agent, userId: owner, fingerprint: "public-art-test", snapshot: await storeJson({ assets: { [source]: hash } }) });
  await db.update(schema.agentProfiles).set({ fullBodyReferenceUrl: source, contentRevisionId: revision }).where(eq(schema.agentProfiles.id, agent));
  const image = await app.request(`/api/public/agents/${agent}/art?kind=body`);
  expect(image.status).toBe(200);
  expect(image.headers.get("content-type")).toBe("image/png");
  const fullBody = await app.request(`/api/public/agents/${agent}/art?kind=full-body`);
  expect(fullBody.status).toBe(200);
  expect(await sharp(Buffer.from(await fullBody.arrayBuffer())).metadata()).toMatchObject({ format: "webp", width: 1, height: 1 });
  await db.update(schema.agentProfiles).set({ fullBodyReferenceUrl: "/different-body.png" }).where(eq(schema.agentProfiles.id, agent));
  expect((await app.request(`/api/public/agents/${agent}/art?kind=body`)).status).toBe(404);
});

test("public artwork rejects excess concurrent renders and releases capacity", async () => {
  const { app, agent } = await fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const active = Array.from({ length: 4 }, () => withPublicArtworkCapacity(() => gate));
  try {
    const response = await app.request(`/api/public/agents/${agent}/art?kind=portrait`);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
  } finally { release(); await Promise.all(active); }
  expect((await app.request(`/api/public/agents/${agent}/art?kind=portrait`)).status).toBe(404);
});

test("Werewolf history includes only this agent's canonical completed public participation", async () => {
  const { db, app, owner, agent, other } = await fixture();
  async function werewolf(slug: string, outcome: "win" | "loss" | "draw", visibility = "public", hiddenAt?: string) {
    const game = randomUUID();
    const events = outcome === "draw" ? await completedCurrentWerewolfFixture(game, 10) : await completedWerewolfResultsFixture("village", game);
    const [start] = events;
    const finish = events.find(event => event.type === "werewolf.completed");
    if (start?.type !== "werewolf.started" || !finish) throw Error("Invalid fixture");
    const focus = start.payload.players.find(player => outcome === "draw" || finish.payload.winnerIds.includes(player.id) === (outcome === "win"));
    if (!focus) throw Error("Fixture has no matching outcome");
    for (const player of start.payload.players) player.agentProfileId = player === focus ? agent : other;
    await db.insert(schema.games).values({ id: game, slug, gameKind: "werewolf", status: "completed", endedAt: "2026-11-01T00:00:00.000Z", hiddenAt, config: JSON.stringify({ visibility }) });
    await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: game, sequence: event.sequence, event })));
    return focus.id;
  }
  const winnerId = await werewolf("public-agent-wolf-win", "win");
  await werewolf("public-agent-wolf-loss", "loss");
  await werewolf("public-agent-wolf-draw", "draw");
  await werewolf("unlisted-agent-wolf-win", "win", "unlisted");
  await werewolf("hidden-agent-wolf-win", "win", "public", "2026-11-02T00:00:00.000Z");
  await influence(db, owner, agent, "public-agent-influence");
  const response = await app.request(`/api/public/agents/${agent}?game=werewolf`), body = await response.json() as FoundProfile;
  expect(response.status).toBe(200);
  expect(body.profile.recentResults).toHaveLength(3);
  expect(body.profile.recentResults.find(row => row.gameSlug === "public-agent-wolf-win"))
    .toMatchObject({ agentProfileId: agent, gameKind: "werewolf", playerId: winnerId, result: { outcome: "win" } });
  expect(body.profile.werewolfRecord).toEqual({ wins: 1, losses: 1, draws: 1 });
  expect(body.profile.competition).toEqual({ gamesPlayed: 0, wins: 0, winRate: 0 });
  const influenceOnly = await (await app.request(`/api/public/agents/${agent}?game=influence`)).json() as FoundProfile;
  expect(influenceOnly.profile.recentResults.map(row => row.gameSlug)).toEqual(["public-agent-influence"]);
  expect(influenceOnly.profile.werewolfRecord).toEqual(body.profile.werewolfRecord);
  expect(JSON.stringify(body)).not.toMatch(/PRIVATE_|SECRET_|nightActions|thinking|strategyStyle|unlisted-agent-wolf|hidden-agent-wolf/);
});
