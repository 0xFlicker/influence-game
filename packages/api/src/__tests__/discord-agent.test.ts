import { afterAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { createDiscordAgentRoutes } from "../routes/discord-agent.js";
import { activeOffer, destination, roomContext, safeReply, validatedConsent, validatedReply, withTurnFeedback, type DiscordMessage } from "../discord/conversation/policy.js";
import { filterInference, mcpBridgeResponse } from "../discord/conversation/sandbox.js";
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

test("structured consent rejects malformed output and cannot borrow another member's offer", () => {
  const m: DiscordMessage = { id: message, channel_id: room, guild_id: guild, content: "Sure", type: 0, author: { id: alice } };
  const offer = { channel: room, game: "wolf", member: alice, link: "link", reply: "reply", expires: 1000 };
  expect(destination(m, guild, room)).toBe("room");
  expect(destination({ ...m, channel_id: dm }, guild, room)).toBeNull();
  expect(activeOffer(offer, m, "link", 999)).toBe(offer);
  expect(activeOffer(offer, { ...m, author: { id: bob } }, "link", 999)).toBeUndefined();
  expect(activeOffer(offer, m, "relinked", 999)).toBeUndefined();
  expect(activeOffer(offer, m, "link", 1000)).toBeUndefined();
  expect(validatedConsent({ allowed: true })).toBe(true);
  for (const invalid of [null, {}, "yes", { allowed: "true" }, { allowed: true, role: "staff" }]) {
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
  expect(safeReply("[The House](" + canonical + ")", origin)).toBe("[The House](" + canonical + ")");
  expect(safeReply("See [the profile](https://elsewhere.example/profile/thehouse).", origin)).toBe("See the profile.");
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
