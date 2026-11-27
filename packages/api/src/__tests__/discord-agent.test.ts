import { afterAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { completedWerewolfResultsFixture, werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { planVisualScene } from "@influence/engine/visual-scene-plan";
import { projectWerewolfPresentation } from "@influence/engine/werewolf/presentation";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { createDiscordAgentRoutes } from "../routes/discord-agent.js";
import { activeOffer, destination, prepareReply, roomContext, validatedConsent, validatedReply, withTurnFeedback, type DiscordMessage } from "../discord/conversation/policy.js";
import { filterInference, mcpBridgeResponse } from "../discord/conversation/sandbox.js";
import { prepareVisualScene, storeVisualArtifact } from "../services/visual-scene-store.js";
import { setupTestDB } from "./test-utils.js";

const guild = "1521918107554152468";
const room = "1521921716224393437";
const dm = "1521921716224393438";
const alice = "1521921716224393439";
const bob = "1521921716224393440";
const message = "1521921716224393441";
const secret = "house-agent-test".repeat(4);
const configuration = { DISCORD_HOUSE_GUILD_ID: guild, DISCORD_AGENT_ROOM_ID: room, DISCORD_CONTROLLER_TOKEN: secret };
const original = Object.fromEntries(Object.keys(configuration).map(key => [key, process.env[key]]));
let db: DrizzleDB;
let app: ReturnType<typeof createDiscordAgentRoutes>;

beforeEach(async () => {
  Object.assign(process.env, configuration);
  db = await setupTestDB();
  await seedRBAC(db);
  await db.insert(schema.users).values([{ id: "alice", displayName: "Alice" }, { id: "bob", displayName: "Bob" }]);
  await db.insert(schema.discordConnections).values([
    { userId: "alice", discordId: alice, guildId: guild, username: "alice" },
    { userId: "bob", discordId: bob, guildId: guild, username: "bob" },
  ]);
  app = createDiscordAgentRoutes(db);
});
afterAll(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function request(action: string, body: object, authority = secret) {
  return app.request("/api/internal/discord/agent/" + action, { method: "POST",
    headers: { authorization: "Bearer " + authority, "content-type": "application/json" }, body: JSON.stringify(body) });
}
function turnBody(kind: "room" | "dm", discordId = alice) {
  return { kind, discordId, channelId: kind === "room" ? room : dm, messageId: message };
}
async function grant(kind: "room" | "dm", discordId = alice, spoilerGame?: string) {
  const response = await request("turn", { ...turnBody(kind, discordId), spoilerGame });
  expect(response.status).toBe(200);
  return (await response.json() as { grant: string }).grant;
}
async function role(name: string) {
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, name));
  await db.insert(schema.userRoles).values({ userId: "alice", roleId: role!.id });
}
async function tool(grant: string, name: string, args: object) {
  return request("mcp", { grant, method: "tools/call", name, args });
}
async function tools(grant: string) {
  const response = await request("mcp", { grant, method: "tools/list" });
  return (await response.json() as { tools: Array<{ name: string }> }).tools.map(t => t.name);
}
async function content(response: Response) {
  expect(response.status).toBe(200);
  return JSON.parse((await response.json() as { content: [{ text: string }] }).content[0].text);
}

test("season queue exposes public counts and draw times without queue identities or hidden games", async () => {
  await db.insert(schema.seasons).values([
    { id: "s1", slug: "season-one", name: "Season One", status: "active" },
    { id: "s0", slug: "season-zero", name: "Season Zero", status: "final" },
  ]);
  await db.insert(schema.agentProfiles).values({ id: "queued-private-agent", userId: "alice", name: "Queued Agent", personality: "private" });
  await db.insert(schema.freeGameQueue).values({ id: "private-queue-row", userId: "alice", agentProfileId: "queued-private-agent" });
  await db.insert(schema.games).values([
    { id: "season-public", slug: "season-public", seasonId: "s1", config: "{}" },
    { id: "season-hidden", slug: "season-hidden", seasonId: "s1", config: '{"visibility":"unlisted"}' },
  ]);
  const shared = await grant("room");
  expect((await content(await tool(shared, "list_seasons", {}))).seasons).toHaveLength(2);
  const open = await content(await tool(shared, "read_season", { season: "season-one" }));
  expect(open).toMatchObject({
    entriesOpen: true, agentsEntered: 1, nextDrawAt: expect.any(String), drawTimeZone: "America/Denver",
    publicGames: [{ slug: "season-public" }],
  });
  expect(open.publicGames).toHaveLength(1);
  expect(JSON.stringify(open)).not.toContain("queued-private-agent");
  expect((await content(await tool(await grant("dm", bob), "read_season", { season: "s1" }))).publicGames).toEqual([]);
  expect(await content(await tool(shared, "read_season", { season: "s0" }))).toMatchObject({
    entriesOpen: false, agentsEntered: null, nextDrawAt: null,
  });
  await db.update(schema.seasons).set({ admissionStartsAt: new Date(Date.now() + 86_400_000).toISOString() }).where(eq(schema.seasons.id, "s1"));
  expect(await content(await tool(shared, "read_season", { season: "s1" }))).toMatchObject({
    season: { status: "active" }, entriesOpen: false, agentsEntered: null, nextDrawAt: null,
  });
  const link = "https://thehouse.game/seasons?season=season-one";
  expect(prepareReply(link, "https://thehouse.game").render(new Set())).toBe(link);
  expect(prepareReply(link + "&token=bad", "https://thehouse.game").render(new Set())).toBe("[link removed]");
});

test("the verified owner sees only their games and private agent details while the room is egalitarian", async () => {
  await db.insert(schema.games).values([{ id: "public-game", slug: "public-game", config: "{}" },
    { id: "mine-game", slug: "mine-game", config: '{"visibility":"unlisted"}' },
    { id: "unrelated-game", slug: "unrelated-game", config: "{}" }]);
  await db.insert(schema.agentProfiles).values([
    { id: "alice-agent", userId: "alice", name: "Alice Finch", personality: "alice-private" },
    { id: "bob-agent", userId: "bob", name: "Bob Finch", personality: "bob-private" },
  ]);
  await db.insert(schema.gamePlayers).values({ id: "seat", userId: "alice", agentProfileId: "alice-agent",
    gameId: "mine-game", persona: '{"name":"Alice Finch"}', agentConfig: "{}" });
  await db.insert(schema.transcripts).values([
    { gameId: "mine-game", round: 1, phase: "mingle", scope: "public", text: "announced publicly", timestamp: 1 },
    { gameId: "mine-game", round: 1, phase: "mingle", scope: "whisper", text: "other-private", timestamp: 2 },
    { gameId: "public-game", round: 1, phase: "mingle", scope: "huddle", text: "shared-house-record", timestamp: 3 },
  ]);
  const owner = await grant("dm");
  const shared = await grant("room");
  expect((await content(await tool(owner, "list_games", {}))).games.map((g: { id: string }) => g.id)).toEqual(["mine-game"]);
  expect((await tool(owner, "read_game", { game: "unrelated-game" })).status).toBe(403);
  expect((await tool(shared, "read_game", { game: "mine-game" })).status).toBe(403);
  expect(JSON.stringify(await content(await tool(owner, "read_speech", { game: "mine-game" })))).not.toContain("other-private");
  expect(JSON.stringify(await content(await tool(shared, "read_speech", { game: "public-game" })))).toContain("shared-house-record");
  expect(JSON.stringify(await content(await tool(owner, "read_agent", { agent: "alice-agent" })))).toContain("alice-private");
  for (const g of [owner, shared, await grant("dm", bob)]) {
    const read = await tool(g, "read_agent", { agent: "alice-agent" });
    if (g === owner) expect(read.status).toBe(200);
    else expect(await read.text()).not.toContain("alice-private");
  }
});

test("fresh explicit roles, link revocation and credential separation fence every tool", async () => {
  expect((await request("turn", turnBody("room"), "unauthorized")).status).toBe(401);
  expect((await request("turn", { ...turnBody("room"), channelId: dm })).status).toBe(403);
  await role("sysop");
  expect(await tools(await grant("dm"))).not.toContain("read_game_reasoning");
  await role("producer");
  const staff = await grant("dm");
  expect(await tools(staff)).toContain("read_game_reasoning");
  expect(await tools(await grant("room"))).not.toContain("read_game_reasoning");
  expect((await tool(staff, "update_agent", {})).status).toBe(403);
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, "alice"));
  expect((await request("validate", { grant: staff, games: [] })).status).toBe(403);
  await role("admin");
  const admin = await grant("dm");
  expect(await tools(admin)).toContain("read_account");
  await db.update(schema.discordConnections).set({ disconnecting: true }).where(eq(schema.discordConnections.discordId, alice));
  expect((await tool(admin, "get_rules", { gameKind: "influence" })).status).toBe(403);
});

test("House link resolution returns canonical public profile and agent references through the share registry", async () => {
  const origin = "https://thehouse.game";
  const [house] = await db.update(schema.users).set({ handle: "thehouse" }).where(eq(schema.users.id, "alice")).returning();
  await db.insert(schema.agentProfiles).values([
    { id: "house-agent", userId: "alice", name: "House Agent", personality: "private personality" },
    { id: "private-draft", userId: "alice", name: "Unapproved Agent", personality: "private draft", moderationRequired: true },
  ]);
  await db.insert(schema.houseShareLinks).values([
    { code: "Lk3WEcewWi", path: "/profile/thehouse" },
    { code: "Lk3WEcewWj", path: "/agents/house-agent" },
    { code: "Lk3WEcewWk", path: "/about" },
  ]);
  const shared = await grant("room", bob);
  expect(await tools(shared)).toContain("resolve_house_link");
  const resolve = (url: string, session = shared) => contentForLink(session, url);
  for (const url of [`${origin}/profile/thehouse`, `${origin}/profile/${house!.publicId}`, `${origin}/s/Lk3WEcewWi`, `${origin}/s/Lk3WEcewWi?app=mini`]) {
    expect(await resolve(url)).toEqual({ status: "found", kind: "player", reference: house!.publicId, url: `${origin}/profile/thehouse` });
  }
  for (const url of [`${origin}/agents/house-agent`, "/s/Lk3WEcewWj"]) {
    expect(await resolve(url)).toEqual({ status: "found", kind: "agent", reference: "house-agent", url: `${origin}/agents/house-agent` });
  }
  for (const url of [
    "https://elsewhere.example/profile/thehouse", `${origin}/s/Lk3WEcewWi?token=invalid`, `${origin}/s/Lk3WEcewWk`,
    `${origin}/s/Lk3WEcewWi?app=mini#fragment`, `${origin}/s/Lk3WEcewWi?app=mini&token=invalid`,
    `${origin}/s/Lk3WEcewWm`, `${origin}/profile/junk/../thehouse`, `${origin}/profile/thehouse?redirect=/agents/house-agent`,
  ]) {
    expect(await resolve(url)).toEqual({ status: "not_found" });
  }
  expect(await resolve(`${origin}/agents/private-draft`, await grant("dm"))).toEqual({ status: "not_found" });
  const profile = `${origin}/profile/thehouse`;
  const agent = `${origin}/agents/house-agent`;
  const validate = () => request("validate", { grant: shared, games: [], links: [profile, agent, profile, `${origin}/s/Lk3WEcewWi`] });
  expect(await (await validate()).json()).toEqual({ valid: true, links: [profile, agent] });
  await db.update(schema.agentProfiles).set({ archivedAt: "now" }).where(eq(schema.agentProfiles.id, "house-agent"));
  await db.update(schema.users).set({ deletedAt: "now" }).where(eq(schema.users.id, "alice"));
  expect(await (await validate()).json()).toEqual({ valid: true, links: [] });
});

async function contentForLink(session: string, url: string) {
  return content(await tool(session, "resolve_house_link", { url }));
}

test("an Unlisted replay resolves in the owner's DM and stays unavailable in the room or another owner's DM", async () => {
  const origin = "https://thehouse.game";
  const id = "private-game-record";
  await db.insert(schema.games).values({ id, slug: "unlisted-replay", status: "completed", config: '{"visibility":"unlisted"}' });
  await db.insert(schema.gamePlayers).values({ id: "owned-seat", userId: "alice", gameId: id, persona: '{"name":"House Agent"}', agentConfig: "{}" });
  await db.insert(schema.houseShareLinks).values({ code: "Lk3WEcewWi", path: "/games/unlisted-replay/replay/42?cue=id%3A42&t=1.25" });
  const source = `${origin}/s/Lk3WEcewWi`;
  const replay = `${origin}/games/unlisted-replay/replay/42?cue=id%3A42&t=1.25`;
  const bare = `${origin}/games/unlisted-replay`;
  const owner = await grant("dm");
  expect(await contentForLink(owner, `${origin}/games/${id}`)).toMatchObject({ status: "found", kind: "game", reference: id, url: bare });
  const expected = { status: "found", kind: "replay", reference: id, url: replay, gameKind: "influence", audience: "public", position: { sequence: 42 } };
  for (const url of [source, replay]) expect(await contentForLink(owner, url)).toEqual(expected);
  for (const other of [await grant("dm", bob), await grant("room")]) {
    for (const url of [bare, source, replay, `${origin}/games/unknown`]) {
      expect(await contentForLink(other, url)).toEqual({ status: "not_found" });
    }
    expect(await (await request("validate", { grant: other, games: [], links: [bare, replay] })).json()).toEqual({ valid: true, links: [] });
  }
  await role("producer");
  const staff = await grant("dm");
  expect(await contentForLink(staff, source)).toEqual(expected);
  const validate = (session: string) => request("validate", { grant: session, games: [], links: [bare, replay] });
  expect(await (await validate(staff)).json()).toEqual({ valid: true, links: [bare, replay] });
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, "alice"));
  expect((await validate(staff)).status).toBe(403);
  expect(await (await validate(owner)).json()).toEqual({ valid: true, links: [bare, replay] });
  await db.update(schema.games).set({ hiddenAt: "now" }).where(eq(schema.games.id, id));
  expect(await (await validate(owner)).json()).toEqual({ valid: true, links: [] });
  expect(await contentForLink(owner, source)).toEqual({ status: "not_found" });
});

test("Werewolf replay links discard unauthorized spoiler coordinates and keep authorized positions", async () => {
  const id = "wolf-link-record";
  const events = await werewolfResultsFixture("village", id);
  const result = events.findIndex(event => event.type === "werewolf.completed");
  expect(result).toBeGreaterThan(0);
  await db.insert(schema.games).values({ id, slug: "wolf-link", gameKind: "werewolf", status: "in_progress", startedAt: "now", config: "{}" });
  await db.insert(schema.werewolfEvents).values(events.slice(0, result).map(event => ({ gameId: id, sequence: event.sequence, event })));
  await db.insert(schema.gamePlayers).values({ id: "owned-seat", userId: "alice", gameId: id, persona: '{"name":"House Agent"}', agentConfig: "{}" });
  const gameUrl = "https://thehouse.game/games/wolf-link";
  const resultsUrl = `${gameUrl}/results`;
  const bare = `${gameUrl}/replay`;
  const omniscient = `${bare}?audience=omniscient&cue=private-cue&cursor=2&t=1.25#private-anchor`;
  const mystery = `${bare}?audience=mystery`;
  const mysteryMoment = `${mystery}&cursor=2`;
  const normal = await grant("room");
  const reveal = await grant("room", alice, id);
  const ownerReveal = await grant("dm", alice, id);
  expect(await contentForLink(normal, gameUrl)).toMatchObject({ kind: "game", audience: "mystery", url: gameUrl });
  expect(await contentForLink(ownerReveal, gameUrl)).toMatchObject({ kind: "game", audience: "mystery", url: gameUrl });
  expect(await contentForLink(reveal, resultsUrl)).toEqual({ status: "not_found" });
  for (const g of [normal, ownerReveal, await grant("room", alice, "different-game")]) {
    expect(await contentForLink(g, omniscient)).toEqual({
      status: "found", kind: "replay", reference: id, gameKind: "werewolf", audience: "mystery", url: mystery,
    });
  }
  expect(await contentForLink(normal, mysteryMoment)).toMatchObject({ audience: "mystery", url: mysteryMoment, position: { cursor: 2 } });
  expect(await contentForLink(reveal, omniscient)).toMatchObject({ audience: "omniscient", url: omniscient, position: { cursor: 2 } });
  const validate = (g: string) => request("validate", { grant: g, games: [], links: [omniscient, mysteryMoment] });
  expect(await (await validate(normal)).json()).toEqual({ valid: true, links: [mysteryMoment] });
  expect(await (await validate(ownerReveal)).json()).toEqual({ valid: true, links: [mysteryMoment] });
  expect(await (await validate(reveal)).json()).toEqual({ valid: true, links: [omniscient, mysteryMoment] });
  await db.insert(schema.werewolfEvents).values(events.slice(result).map(event => ({ gameId: id, sequence: event.sequence, event })));
  expect(await contentForLink(ownerReveal, resultsUrl)).toMatchObject({ kind: "game", reference: id, url: resultsUrl });
  expect(await contentForLink(await grant("dm", bob), resultsUrl)).toEqual({ status: "not_found" });
  await db.update(schema.games).set({ status: "completed" }).where(eq(schema.games.id, id));
  await db.insert(schema.houseShareLinks).values({ code: "Lk3WEcewWi", path: new URL(omniscient).pathname + new URL(omniscient).search + new URL(omniscient).hash });
  expect(await contentForLink(normal, "/s/Lk3WEcewWi")).toMatchObject({ audience: "omniscient", url: omniscient, position: { cursor: 2 } });
  expect(await (await validate(normal)).json()).toEqual({ valid: true, links: [omniscient, mysteryMoment] });
  expect(await (await validate(ownerReveal)).json()).toEqual({ valid: true, links: [mysteryMoment] });
});

test("Werewolf defaults to Mystery until canonically resolved and fences live reveal to the exact game", async () => {
  const id = "wolf";
  const events = await werewolfResultsFixture("village", id);
  const result = events.findIndex(e => e.type === "werewolf.completed");
  expect(result).toBeGreaterThan(0);
  await db.insert(schema.games).values({ id, slug: id, gameKind: "werewolf", status: "in_progress", startedAt: "now", config: "{}" });
  await db.insert(schema.werewolfEvents).values(events.slice(0, result).map(event => ({ gameId: id, sequence: event.sequence, event })));
  await db.insert(schema.gameAssets).values({ id: "wolf-image", gameId: id, label: "banner", visibility: "spoiler",
    altText: "secret image", objectKey: "fixture-private-object", sha256: "test", byteLength: 1, width: 1, height: 1,
    createdById: "alice", updatedById: "alice", createdAt: "now", updatedAt: "now" });
  const normal = await grant("room");
  expect((await content(await tool(normal, "read_game", { game: id }))).audience).toBe("mystery");
  expect((await tool(normal, "read_game", { game: id, audience: "omniscient" })).status).toBe(403);
  expect((await tool(normal, "list_scene_images", { game: id, audience: "omniscient" })).status).toBe(403);
  expect((await tool(normal, "read_thinking", { game: id })).status).toBe(403);
  expect(await content(await tool(normal, "list_game_images", { game: id }))).toEqual([]);
  expect((await content(await tool(await grant("room", alice, "wrong-game"), "read_game", { game: id }))).audience).toBe("mystery");
  const revealing = await grant("room", alice, id);
  expect((await content(await tool(revealing, "read_game", { game: id }))).audience).toBe("omniscient");
  const art = await content(await tool(revealing, "list_game_images", { game: id }));
  expect(art[0].imageRef).toBeString();
  expect(JSON.stringify(art)).not.toContain("fixture-private-object");
  expect((await tool(await grant("room", bob, id), "inspect_image", { imageRef: art[0].imageRef })).status).toBe(403);
  expect((await tool(normal, "inspect_image", { imageRef: art[0].imageRef })).status).toBe(403);
  await db.insert(schema.werewolfEvents).values(events.slice(result).map(event => ({ gameId: id, sequence: event.sequence, event })));
  expect((await content(await tool(normal, "read_game", { game: id }))).audience).toBe("omniscient");
  expect(await (await request("spoiler", { grant: normal, game: id })).json()).toMatchObject({ settled: true });
});

test("an explicit Mystery replay keeps text, continuation and published scene inspection at that audience", async () => {
  const id = "wolf-audience";
  const events = await completedWerewolfResultsFixture("village", id);
  await db.insert(schema.games).values({ id, slug: id, gameKind: "werewolf", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", config: "{}" });
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: id, sequence: event.sequence, event })));
  // This coordinate shows a village scene in Mystery and a different moment in Omniscient.
  const after = 10;
  const frame = projectWerewolfPresentation(events, "mystery", after);
  expect(frame).toMatchObject({ purpose: "village", roomId: "lobby" });
  expect(projectWerewolfPresentation(events, "omniscient", after).purpose).toBe("hunt");
  const image = await storeVisualArtifact(db, id, await sharp({ create: { width: 8, height: 12, channels: 3, background: "grey" } }).png().toBuffer());
  const cast = frame.participantIds.map(player => ({ id: player, name: player, referenceArtifactId: image, performanceInstructions: "" }));
  const plan = planVisualScene({ roomId: "lobby", backgroundArtifactId: null, cast });
  const scene = await prepareVisualScene(db, { gameId: id, boundarySequence: frame.boundary, plan });
  const createdAt = "2026-01-01T00:00:00.000Z";
  await db.insert(schema.visualMediaVersions).values({ id, gameId: id, sceneId: scene.id, version: 1, plan, imageArtifactId: image, annotatedArtifactId: image,
    localization: { count: cast.length, verifiedParticipantIds: cast.map(player => player.id), anchors: [] }, verificationVersion: "fixture", createdAt });
  await db.insert(schema.visualMediaPublications).values({ id, gameId: id, sceneId: scene.id, versionId: id, revision: 1, operatorId: "fixture", createdAt });

  const shared = await grant("room");
  await role("producer");
  const staff = await grant("dm");
  const url = `https://thehouse.game/games/${id}/replay?audience=mystery&cursor=${after}`;
  for (const session of [shared, staff]) {
    expect(await contentForLink(session, url)).toMatchObject({ audience: "mystery", position: { cursor: after }, url });
    expect((await content(await tool(session, "read_game", { game: id }))).audience).toBe("omniscient");
    const args = { game: id, audience: "mystery" };
    const first = await content(await tool(session, "read_game", args));
    expect(first).toMatchObject({ audience: "mystery", capabilities: { thinking: false } });
    expect(first.nextCursor).toBeString();
    expect((await content(await tool(session, "read_game", { ...args, cursor: first.nextCursor }))).audience).toBe("mystery");
    expect((await tool(session, "read_game", { game: id, cursor: first.nextCursor })).status).toBe(403);
    expect(await content(await tool(session, "list_scene_images", { game: id, after }))).toEqual([]);
    const scenes = await content(await tool(session, "list_scene_images", { ...args, after }));
    expect(scenes).toHaveLength(1);
    const inspect = await tool(session, "inspect_image", { imageRef: scenes[0].imageRef });
    expect(inspect.status).toBe(200);
    expect(await inspect.json()).toMatchObject({ content: [{ type: "image", mimeType: "image/png", data: expect.any(String) }] });
  }
});

test("structured consent rejects malformed output and cannot borrow another member's offer", () => {
  const m: DiscordMessage = { id: message, channel_id: room, guild_id: guild, content: "Sure", type: 0, author: { id: alice } };
  const authority = { link: "link", lane: "room" as const };
  const offer = { ...authority, channel: room, game: "wolf", member: alice, reply: "reply", expires: 1000 };
  expect(destination(m, guild, room)).toBe("room");
  expect(destination({ ...m, channel_id: dm }, guild, room)).toBeNull();
  expect(activeOffer(offer, m, authority, 999)).toBe(offer);
  expect(activeOffer(offer, { ...m, author: { id: bob } }, authority, 999)).toBeUndefined();
  expect(activeOffer(offer, m, { ...authority, link: "relinked" }, 999)).toBeUndefined();
  expect(activeOffer(offer, m, authority, 1000)).toBeUndefined();
  expect(validatedConsent({ intent: "direct" })).toBe("direct");
  for (const invalid of [null, {}, "yes", { allowed: true }, { intent: "yes" }, { intent: "direct", role: "staff" }]) {
    expect(() => validatedConsent(invalid)).toThrow();
  }
  expect(() => validatedReply({ text: "yes", imageRefs: [], spoiler: { action: "authorize" } })).toThrow();
  const house = { type: "namespace", name: "mcp__house", tools: [{ type: "function", name: "get_rules" }] };
  const tools = [{ type: "web_search" }, { type: "custom", name: "apply_patch" }, house,
    { type: "function", name: "exec_command" }, { type: "namespace", name: "mcp__other", tools: house.tools }];
  expect(filterInference({ model: "model", stream: true, tools }, "model", new Set(["get_rules"]))?.tools).toEqual([house]);
  expect(filterInference({ model: "model", stream: true, tools }, "model", new Set())?.tools).toEqual([]);
  expect(filterInference({ model: "model", stream: true, tools }, "model", new Set(["read_agent"]))).toBeNull();
  const imageInput = (image_url: string) => ({ model: "model", stream: true, input: [
    { type: "function_call_output", output: [{ type: "input_image", image_url }] },
  ] });
  expect(filterInference(imageInput("https://elsewhere.example/private"), "model", new Set())).toBeNull();
  expect(filterInference(imageInput("data:image/png;base64,aGVsbG8="), "model", new Set())).not.toBeNull();
});

test("House MCP streams a compressed catalog through a fresh Unix response", async () => {
  const catalog = { tools: [{ name: "list_games" }] };
  const directory = await mkdtemp(join(tmpdir(), "house-mcp-test-"));
  const socket = join(directory, "mcp.sock");
  const upstream = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch: () => new Response(Bun.zstdCompressSync(JSON.stringify(catalog)), {
      headers: { "content-type": "application/json", "content-encoding": "zstd" },
    }),
  });
  let bridge: ReturnType<typeof Bun.serve> | undefined;
  try {
    bridge = Bun.serve({
      unix: socket,
      async fetch() {
        const response = await fetch(upstream.url);
        expect(response.headers.get("content-encoding")).toBe("zstd");
        return mcpBridgeResponse(response);
      },
    });
    const response = await fetch("http://house/mcp", { unix: socket });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.json()).toEqual(catalog);
  } finally {
    bridge?.stop(true);
    upstream.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("public profile lookup resolves a House share link and a display name to the same canonical profile", async () => {
  const origin = "https://thehouse.game";
  const canonical = origin + "/profile/thehouse";
  const short = origin + "/s/Lk3WEcewWi";
  await db.update(schema.users).set({ displayName: "The House", handle: "thehouse" }).where(eq(schema.users.id, "alice"));
  await db.insert(schema.houseShareLinks).values([
    { code: "Lk3WEcewWi", path: "/profile/thehouse" },
    { code: "Lk3WEcewWj", path: "/about" },
  ]);
  const shared = await grant("room", bob);
  for (const player of [short, canonical, "The House", "@thehouse"]) {
    expect(await content(await tool(shared, "read_player", { player }))).toMatchObject({
      status: "found", profileUrl: canonical, profile: { identity: { displayName: "The House", handle: "thehouse" } },
    });
  }
  for (const player of ["https://elsewhere.example/profile/thehouse", origin + "/s/Lk3WEcewWj"]) {
    expect(await content(await tool(shared, "read_player", { player }))).toMatchObject({ status: "not_found" });
  }
  await db.update(schema.users).set({ displayName: "The House", handle: "anotherhouse" }).where(eq(schema.users.id, "bob"));
  const result = await content(await tool(shared, "read_player", { player: "The House" }));
  expect(result.status).toBe("ambiguous");
  expect(result.candidates.map((candidate: { handle: string }) => candidate.handle).sort()).toEqual(["anotherhouse", "thehouse"]);
  await db.update(schema.users).set({ deletedAt: new Date().toISOString() }).where(eq(schema.users.id, "alice"));
  expect(await content(await tool(shared, "read_player", { player: short }))).toMatchObject({ status: "not_found" });
  expect(prepareReply("[The House](" + canonical + ")", origin).render(new Set([canonical]))).toBe("[The House](" + canonical + ")");
  expect(prepareReply("See [the profile](https://elsewhere.example/profile/thehouse).", origin).render(new Set())).toBe("See the profile.");
});

test("turn feedback refreshes typing and removes only its own acknowledgement after delivery", async () => {
  const calls: Array<[string | undefined, string]> = [];
  const typing = "/channels/" + room + "/typing";
  const reaction = "/channels/" + room + "/messages/" + message + "/reactions/" + encodeURIComponent("👀") + "/@me";
  const reply = await withTurnFeedback(async (path, init) => {
    calls.push([init.method, path]);
    return new Response(null, { status: 204 });
  }, { id: message, channel_id: room }, async () => {
    await Bun.sleep(7100);
    expect(calls).toEqual([["POST", typing], ["PUT", reaction], ["POST", typing]]);
    return "replied";
  });
  expect(reply).toBe("replied");
  expect(calls.at(-1)).toEqual(["DELETE", reaction]);
}, 15000);

test("room follow-ups receive prior House replies and an explicit same-room parent", () => {
  const id = (minutes: number) => ((BigInt(1764150000000 + minutes * 60_000) - 1420070400000n) << 22n).toString();
  const house = "1521918515752472606";
  const original: DiscordMessage = { id: id(0), channel_id: room, guild_id: guild, type: 0,
    content: "The House profile https://thehouse.game/s/Lk3WEcewWi", author: { id: alice } };
  const current: DiscordMessage = { ...original, id: id(8), type: 19, content: "Can you post it again?",
    message_reference: { channel_id: room, message_id: original.id } };
  const reply = { ...original, id: id(2), content: "The House profile is @thehouse", author: { id: house, bot: true } };
  const context = roomContext(current, [
    current, reply, original, original,
    { ...reply, id: id(1), author: { id: bob, bot: true } },
    { ...original, id: id(3), channel_id: dm },
    { ...original, id: id(9) },
    { ...original, id: id(-40) },
  ], house);
  expect(context.recent.map(({ speaker, text }) => [speaker, text])).toEqual([
    ["requesting_member", original.content], ["house", reply.content],
  ]);
  expect(context.repliedTo?.id).toBe(original.id);
  expect(roomContext({ ...current, message_reference: { channel_id: dm, message_id: original.id } }, [original], house).repliedTo).toBeUndefined();
});
