import { afterAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { createDiscordAgentRoutes } from "../routes/discord-agent.js";
import { getNextDailyFreeDrawAt } from "../services/free-game-schedule.js";
import { setupTestDB } from "./test-utils.js";

const guild = "1521918107554152468";
const room = "1521921716224393437";
const dm = "1521921716224393438";
const alice = "1521921716224393439";
const bob = "1521921716224393440";
const message = "1521921716224393441";
const renewedMessage = "1521921716224393442";
const secret = "discord-season-navigation-test".repeat(3);
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
  await db.insert(schema.seasons).values([
    { id: "current", slug: "season-current", name: "Current Season", status: "active" },
    { id: "closed", slug: "season-closed", name: "Closed Season", status: "final" },
  ]);
  app = createDiscordAgentRoutes(db);
});

afterAll(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function request(action: string, body: object) {
  return app.request("/api/internal/discord/agent/" + action, {
    method: "POST", headers: { authorization: "Bearer " + secret, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

async function turn(kind: "room" | "dm", discordId = alice, messageId = message) {
  const response = await request("turn", { kind, discordId, channelId: kind === "room" ? room : dm, messageId });
  expect(response.status).toBe(200);
  return (await response.json() as { grant: string }).grant;
}

function seasonRequest(grant: string, season: string, cursor?: string) {
  return request("mcp", { grant, method: "tools/call", name: "read_season", args: { season, cursor } });
}

interface SeasonPage {
  season: { id: string; status: string };
  publicGames: Array<{ id: string; gameUrl: string }>;
  nextCursor: string | null;
  gameScope: string;
}

async function readSeason(grant: string, season: string, cursor?: string): Promise<SeasonPage> {
  const response = await seasonRequest(grant, season, cursor);
  expect(response.status).toBe(200);
  return JSON.parse((await response.json() as { content: [{ text: string }] }).content[0].text);
}

test("season admission windows and lifecycle remain distinct with an empty public feed", async () => {
  const shared = await turn("room");
  await db.insert(schema.agentProfiles).values({ id: "private-entrant", userId: "alice", name: "Private Entrant", personality: "draft", moderationRequired: true });
  await db.insert(schema.freeGameQueue).values({ id: "entry", userId: "alice", agentProfileId: "private-entrant" });
  const open = await readSeason(shared, "season-current");
  expect(open).toMatchObject({
    season: { id: "current", status: "active" }, seasonUrl: "https://thehouse.game/seasons?season=season-current",
    entriesOpen: true, agentsEntered: 1, seatsPerDraw: 12, nextDrawAt: getNextDailyFreeDrawAt(),
    publicGames: [], nextCursor: null,
  });
  expect(JSON.stringify(open)).not.toContain("private-entrant");

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const closedWindow = { entriesOpen: false, agentsEntered: null, seatsPerDraw: null, nextDrawAt: null, publicGames: [], nextCursor: null };
  await db.update(schema.seasons).set({ admissionStartsAt: tomorrow }).where(eq(schema.seasons.id, "current"));
  expect(await readSeason(shared, "current")).toMatchObject({ season: { status: "active", admissionStartsAt: tomorrow }, ...closedWindow });
  await db.update(schema.seasons).set({ admissionStartsAt: null, admissionClosesAt: yesterday }).where(eq(schema.seasons.id, "current"));
  expect(await readSeason(shared, "current")).toMatchObject({ season: { status: "active", admissionClosesAt: yesterday }, ...closedWindow });
  await db.update(schema.seasons).set({ status: "closing" }).where(eq(schema.seasons.id, "current"));
  expect(await readSeason(shared, "current")).toMatchObject({ season: { status: "closing" }, ...closedWindow });
  expect(await readSeason(shared, "season-closed")).toMatchObject({ season: { status: "final" }, ...closedWindow });
});

test("season continuation keeps status and tie ordering and reapplies current public and owner scope", async () => {
  const gameIds = Array.from({ length: 27 }, (_, index) => `game-${String(index).padStart(2, "0")}`);
  const createdAt = "2026-11-20T00:00:00.000Z";
  await db.insert(schema.games).values([
    ...gameIds.map(id => ({ id, slug: id, seasonId: "current", createdAt, config: "{}",
      status: id === "game-00" ? "in_progress" as const : id === "game-25" ? "waiting" as const : "completed" as const })),
    { id: "zz-bob-game", slug: "zz-bob-game", seasonId: "current", createdAt, status: "completed", config: "{}" },
    { id: "hidden-game", slug: "hidden-game", seasonId: "current", status: "in_progress", config: "{}", hiddenAt: createdAt },
    { id: "unlisted-game", slug: "unlisted-game", seasonId: "current", status: "in_progress", config: '{"visibility":"unlisted"}' },
    { id: "different-season-game", slug: "different-season-game", seasonId: "closed", status: "in_progress", config: "{}" },
  ]);
  await db.insert(schema.gamePlayers).values([...gameIds, "hidden-game", "unlisted-game", "different-season-game", "zz-bob-game"].map(gameId => ({
    id: `${gameId}-seat`, gameId, userId: gameId === "zz-bob-game" ? "bob" : "alice", persona: "{}", agentConfig: "{}",
  })));

  const shared = await turn("room");
  const owner = await turn("dm");
  const otherOwner = await turn("dm", bob);
  const first = await readSeason(owner, "season-current");
  const expected = ["game-00", ...gameIds.slice(1).reverse().filter(id => id !== "game-25"), "game-25"];
  expect(first.gameScope).toBe("public_games_your_agents_played");
  expect(first.publicGames.map(game => game.id)).toEqual(expected.slice(0, 24));
  expect(first.nextCursor).toBeString();
  expect(first.publicGames[0]?.gameUrl).toBe("https://thehouse.game/games/game-00");
  const cursor = first.nextCursor!;

  const renewedOwner = await turn("dm", alice, renewedMessage);
  const second = await readSeason(renewedOwner, "current", cursor);
  expect(second.publicGames.map(game => game.id)).toEqual(expected.slice(24));
  expect(second.nextCursor).toBeNull();
  expect((await readSeason(otherOwner, "current")).publicGames.map(game => game.id)).toEqual(["zz-bob-game"]);
  expect((await seasonRequest(otherOwner, "current", cursor)).status).toBe(403);
  expect((await seasonRequest(shared, "current", cursor)).status).toBe(403);
  expect((await seasonRequest(renewedOwner, "closed", cursor)).status).toBe(403);
  expect((await seasonRequest(renewedOwner, "current", "malformed")).status).toBe(403);

  const firstShared = await readSeason(shared, "current");
  expect(firstShared.gameScope).toBe("public");
  expect(firstShared.publicGames.map(game => game.id)).toEqual([expected[0]!, "zz-bob-game", ...expected.slice(1, 23)]);
  expect(firstShared.nextCursor).toBeString();
  await db.update(schema.games).set({ config: '{"visibility":"unlisted"}' }).where(eq(schema.games.id, "game-02"));
  await db.delete(schema.gamePlayers).where(eq(schema.gamePlayers.id, "game-01-seat"));
  expect((await readSeason(renewedOwner, "current", cursor)).publicGames.map(game => game.id)).toEqual(["game-25"]);
  expect((await readSeason(shared, "current", firstShared.nextCursor!)).publicGames.map(game => game.id))
    .toEqual(["game-03", "game-01", "game-25"]);

  const [producer] = await db.select().from(schema.roles).where(eq(schema.roles.name, "producer"));
  await db.insert(schema.userRoles).values({ userId: "alice", roleId: producer!.id });
  const staff = await turn("dm");
  expect((await seasonRequest(staff, "current", cursor)).status).toBe(403);
  await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, "alice"));
  await db.delete(schema.discordConnections).where(eq(schema.discordConnections.discordId, alice));
  await db.insert(schema.discordConnections).values({ userId: "alice", discordId: alice, guildId: guild, username: "alice" });
  expect((await seasonRequest(await turn("dm"), "current", cursor)).status).toBe(403);
});
