import { beforeEach, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { listHouseGames } from "../services/house-game-access.js";
import {
  readHouseGame,
  readHouseGameThinking,
  readHouseInspectionResults,
} from "../services/house-game-inspection.js";
import {
  houseContent,
  validateHouseInput,
  houseOutputSchemas,
} from "../game-mcp/house-contracts.js";
import {
  decodeHouseCursor,
  encodeHouseCursor,
} from "../services/house-read-cursor.js";
let db: DrizzleDB;
beforeEach(async () => {
  db = await setupTestDB();
});
async function wolf(status: "completed" | "in_progress" = "completed") {
  const id = "wolf-id",
    events = await werewolfResultsFixture("village", id);
  await db.insert(schema.games).values({
    id,
    slug: "wolf-slug",
    gameKind: "werewolf",
    status,
    startedAt: new Date().toISOString(),
    config: '{"visibility":"unlisted"}',
  });
  await db
    .insert(schema.werewolfEvents)
    .values(
      events.map((event) => ({ gameId: id, sequence: event.sequence, event })),
    );
  return { id, events };
}
test("mixed public catalog filters before limits; known Unlisted lookup works and hidden fails", async () => {
  const { id } = await wolf();
  await db.insert(schema.games).values([
    { id: "public", slug: "public", config: "{}" },
    { id: "hidden", slug: "hidden", config: "{}", hiddenAt: "now" },
    { id: "invalid", slug: "invalid", config: '{"visibility":"private"}' },
  ]);
  const catalog = await listHouseGames(
    db,
    { limit: 1 },
    { userId: "stranger", producer: false },
  );
  expect(catalog.games.map((g) => g.id)).toEqual(["public"]);
  houseContent("list_games", catalog);
  const inventory=await listHouseGames(db,{collection:"producer"},{userId:"producer",producer:true});
  expect(inventory.games.some(game=>game.id==="hidden")).toBe(true);
  expect(houseContent("list_games",inventory).structuredContent.followUps).toEqual([]);
  const page = await readHouseGame(db, {
    gameIdOrSlug: "wolf-slug",
    view: "replay",
    limit: 1,
  });
  houseContent("read_game", page);
  expect(page.gameKind).toBe("werewolf");
  expect(JSON.stringify(page)).not.toContain('"role"');
  expect(JSON.stringify(page)).not.toContain("SECRET_");
  await db
    .update(schema.games)
    .set({ hiddenAt: "now" })
    .where(eq(schema.games.id, id));
  await expect(readHouseGame(db, { gameIdOrSlug: id })).rejects.toMatchObject({
    code: "not_accessible",
  });
  await expect(
    listHouseGames(
      db,
      { collection: "producer" },
      { userId: "stranger", producer: false },
    ),
  ).rejects.toMatchObject({ code: "not_accessible" });
});
test("Werewolf pagination preserves audience prefixes, rejects cursor substitution and includes results only explicitly", async () => {
  const { id } = await wolf();
  let cursor: string | undefined;
  const positions: number[] = [];
  for (let n = 0; n < 100; n++) {
    const page = await readHouseGame(db, {
      gameIdOrSlug: id,
      view: "replay",
      cursor,
      limit: 3,
    });
    houseContent("read_game", page);
    if (page.gameKind !== "werewolf") throw Error("wrong adapter");
    positions.push(...page.entries.map((e) => e.cursor));
    expect(page.snapshot?.cursor).toBe(page.position.cursor);
    expect(page.pollCursor).toBeNull();
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  expect(positions).toEqual(
    Array.from({ length: positions.length }, (_, i) => i + 1),
  );
  expect(positions.length).toBeGreaterThan(10);
  await expect(
    readHouseGame(db, { gameIdOrSlug: id, audience: "omniscient", cursor }),
  ).rejects.toMatchObject({ code: "invalid_cursor" });
  const results = await readHouseInspectionResults(db, id);
  houseContent("read_game_results", results);
  expect(results.gameKind).toBe("werewolf");
  const omni = await readHouseGame(db, {
    gameIdOrSlug: id,
    audience: "omniscient",
  });
  if (omni.gameKind !== "werewolf") throw Error("wrong adapter");
  const thinking = await readHouseGameThinking(db, {
    gameIdOrSlug: id,
    audience: "omniscient",
    position: [omni.position.cursor],
    limit: 2,
  });
  houseContent("read_game_thinking", thinking);
  expect(thinking.entries.length).toBeLessThanOrEqual(2);
});
test("pinned pages drain before following growth; empty polls are stable; cancelled does not poll", async () => {
  const { id, events } = await wolf("in_progress");
  await db
    .delete(schema.werewolfEvents)
    .where(eq(schema.werewolfEvents.gameId, id));
  await db
    .insert(schema.werewolfEvents)
    .values(
      events
        .slice(0, 8)
        .map((event) => ({ gameId: id, sequence: event.sequence, event })),
    );
  const first = await readHouseGame(db, {
    gameIdOrSlug: id,
    view: "replay",
    limit: 1,
  });
  await db
    .insert(schema.werewolfEvents)
    .values(
      events
        .slice(8)
        .map((event) => ({ gameId: id, sequence: event.sequence, event })),
    );
  let page = first;
  while (page.nextCursor)
    page = await readHouseGame(db, {
      gameIdOrSlug: id,
      cursor: page.nextCursor,
    });
  expect(page.pollCursor).toBeString();
  const grown = await readHouseGame(db, {
    gameIdOrSlug: id,
    cursor: page.pollCursor!,
  });
  expect(grown).not.toEqual(page);
  await db
    .update(schema.games)
    .set({ status: "cancelled" })
    .where(eq(schema.games.id, id));
  const stopped = await readHouseGame(db, { gameIdOrSlug: id });
  expect(stopped.pollCursor).toBeNull();
  await expect(readHouseInspectionResults(db, id)).rejects.toMatchObject({
    code: "not_completed",
  });
});
test("waiting games are valid empty reads, strict inputs and schemas reject extra evidence", async () => {
  await db.insert(schema.games).values({
    id: "waiting",
    slug: "waiting",
    gameKind: "werewolf",
    config: "{}",
  });
  const page = await readHouseGame(db, { gameIdOrSlug: "waiting" });
  expect(page.snapshot).toBeNull();
  houseContent("read_game", page);
  for (const bad of [
    { gameIdOrSlug: "waiting", limit: 0 },
    { gameIdOrSlug: "waiting", limit: 1.2 },
    { gameIdOrSlug: "waiting", extra: "secret" },
    {},
  ])
    expect(() => validateHouseInput("read_game", bad)).toThrow();
  expect(() =>
    houseContent("read_game", { ...page, rawReasoning: "secret" }),
  ).toThrow();
  expect(houseOutputSchemas.read_game).toBeDefined();
  const binding = {
    gameId: "waiting",
    gameKind: "werewolf" as const,
    audience: "mystery" as const,
    lane: "history" as const,
    actorId: null,
  };
  const token = encodeHouseCursor({
    version: 1,
    ...binding,
    after: [2],
    through: [1],
    poll: false,
    cutoff: [],
  });
  expect(() => decodeHouseCursor(token, binding)).toThrow();
});
test("Influence public dialogue excludes huddles, thinking and untyped system rows", async () => {
  await db
    .insert(schema.games)
    .values({ id: "inf", slug: "inf", config: "{}" });
  await db.insert(schema.transcripts).values(
    (["public", "huddle", "thinking", "system"] as const).map((scope, i) => ({
      gameId: "inf",
      scope,
      round: 1,
      phase: "LOBBY",
      text: `TEXT_${scope}`,
      thinking: "SECRET_THINKING",
      timestamp: i + 1,
    })),
  );
  const page = await readHouseGame(db, { gameIdOrSlug: "inf", view: "replay" });
  houseContent("read_game", page);
  if (page.gameKind !== "influence") throw Error("wrong adapter");
  expect(page.dialogue.map((d) => d.text)).toEqual(["TEXT_public"]);
  expect(JSON.stringify(page)).not.toContain("SECRET_THINKING");
  expect(page.position.transcriptSequence).toBeNull();
});

test("partial casting is public but strategy is not; mine includes waiting and frozen seats", async () => {
  await db
    .insert(schema.users)
    .values([{ id: "creator" }, { id: "participant" }]);
  await db.insert(schema.agentProfiles).values({
    id: "profile",
    userId: "participant",
    name: "Cast name",
    personality: "SECRET_PERSONALITY",
    strategyStyle: "SECRET_STRATEGY",
    werewolfStrategyStyle: "SECRET_WOLF_STRATEGY",
    personaKey: "observer",
  });
  await db.insert(schema.games).values({
    id: "casting",
    slug: "casting",
    gameKind: "werewolf",
    createdById: "creator",
    config: '{"visibility":"unlisted"}',
  });
  await db
    .insert(schema.werewolfLobbySeats)
    .values({ id: "seat", gameId: "casting", agentProfileId: "profile" });
  const page = await readHouseGame(db, { gameIdOrSlug: "casting" });
  houseContent("read_game", page);
  if (page.gameKind !== "werewolf") throw Error("wrong adapter");
  expect(page.casting).toEqual([
    { id: "seat", name: "Cast name", personaKey: "observer", available: true },
  ]);
  expect(JSON.stringify(page)).not.toContain("SECRET_");
  for (const userId of ["creator", "participant"])
    expect(
      (
        await listHouseGames(
          db,
          { collection: "mine" },
          { userId, producer: false },
        )
      ).games.map((g) => g.id),
    ).toEqual(["casting"]);
  const { id, events } = await wolf();
  const start = events[0]!;
  if (start.type !== "werewolf.started") throw Error("fixture");
  start.payload.players[0]!.agentProfileId = "profile";
  await db
    .update(schema.werewolfEvents)
    .set({ event: start })
    .where(
      and(
        eq(schema.werewolfEvents.gameId, id),
        eq(schema.werewolfEvents.sequence, 1),
      ),
    );
  expect(
    (
      await listHouseGames(
        db,
        { collection: "mine" },
        { userId: "participant", producer: false },
      )
    ).games.map((g) => g.id),
  ).toContain(id);
  await db
    .update(schema.agentProfiles)
    .set({ userId: "creator" })
    .where(eq(schema.agentProfiles.id, "profile"));
  expect(
    (
      await listHouseGames(
        db,
        { collection: "mine" },
        { userId: "participant", producer: false },
      )
    ).games,
  ).toEqual([]);
});

test("current remains at the latest board with limit one; empty polls do not repeat speech", async () => {
  const { id } = await wolf("in_progress");
  const current = await readHouseGame(db, { gameIdOrSlug: id, limit: 1 });
  if (current.gameKind !== "werewolf") throw Error("wrong adapter");
  expect(current.entries).toHaveLength(1);
  expect(current.snapshot?.outcome).not.toBeNull();
  const poll = await readHouseGame(db, {
    gameIdOrSlug: id,
    cursor: current.pollCursor!,
  });
  if (poll.gameKind !== "werewolf") throw Error("wrong adapter");
  expect(poll.entries).toEqual([]);
  expect(poll.position).toEqual(current.position);
  expect(poll.pollCursor).toBe(current.pollCursor);
  await expect(
    readHouseGame(db, {
      gameIdOrSlug: id,
      cursor: current.pollCursor!,
      view: "current",
    }),
  ).rejects.toMatchObject({ code: "invalid_input" });
  for (const limit of [-1, 0, 21, 1.5])
    await expect(
      readHouseGame(db, { gameIdOrSlug: id, limit }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  for (const position of [[-1], [1.2], [Number.MAX_SAFE_INTEGER], [1, 2]])
    await expect(
      readHouseGameThinking(db, {
        gameIdOrSlug: id,
        audience: "omniscient",
        position,
      }),
    ).rejects.toBeDefined();
  await expect(
    readHouseGameThinking(db, {
      gameIdOrSlug: id,
      audience: "public",
      position: [1],
    }),
  ).rejects.toMatchObject({ code: "invalid_input" });
});

test("pack dialogue and thinking require Omniscient; missing or invalid history fails explicitly", async () => {
  const events = await werewolfResultsFixture("disagreement", "pack");
  await db.insert(schema.games).values({
    id: "pack",
    slug: "pack",
    gameKind: "werewolf",
    status: "completed",
    startedAt: new Date().toISOString(),
    config: "{}",
  });
  await db.insert(schema.werewolfEvents).values(
    events.map((event) => ({
      gameId: "pack",
      sequence: event.sequence,
      event,
    })),
  );
  const strings: Record<string, string> = {};
  for (const audience of ["mystery", "omniscient"] as const) {
    let cursor: string | undefined;
    let all = "";
    do {
      const page = await readHouseGame(db, {
        gameIdOrSlug: "pack",
        view: "replay",
        audience,
        cursor,
        limit: 20,
      });
      houseContent("read_game", page);
      all += JSON.stringify(page);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    strings[audience] = all;
  }
  expect(strings.mystery).not.toContain("SECRET_PACK");
  expect(strings.omniscient).toContain("SECRET_PACK");
  expect(strings.omniscient).not.toContain("SECRET_THINKING");
  expect(strings.omniscient).not.toContain("SECRET_STRATEGY");
  const page = await readHouseGame(db, {
    gameIdOrSlug: "pack",
    audience: "omniscient",
  });
  if (page.gameKind !== "werewolf") throw Error("wrong adapter");
  const thinking = await readHouseGameThinking(db, {
    gameIdOrSlug: "pack",
    audience: "omniscient",
    position: [page.position.cursor],
    limit: 1,
  });
  expect(thinking.entries).toHaveLength(1);
  expect(thinking.nextCursor).toBeString();
  houseContent("read_game_thinking", thinking);
  await expect(
    readHouseGameThinking(db, {
      gameIdOrSlug: "pack",
      audience: "omniscient",
      position: [page.position.cursor - 1],
      cursor: thinking.nextCursor!,
    }),
  ).rejects.toMatchObject({ code: "invalid_cursor" });
  await expect(
    readHouseGameThinking(db, {
      gameIdOrSlug: "pack",
      audience: "omniscient",
      position: [page.position.cursor],
      actorId: "other",
      cursor: thinking.nextCursor!,
    }),
  ).rejects.toMatchObject({ code: "invalid_cursor" });
  await db
    .delete(schema.werewolfEvents)
    .where(eq(schema.werewolfEvents.sequence, events.length));
  await expect(
    readHouseGame(db, { gameIdOrSlug: "pack" }),
  ).rejects.toMatchObject({ code: "unavailable" });
});

test("byte budgets retain whole multibyte dialogue and reject a single oversized entry", async () => {
  await db
    .insert(schema.games)
    .values({ id: "bytes", slug: "bytes", config: "{}" });
  const text = "🐺".repeat(7000);
  await db.insert(schema.transcripts).values(
    [1, 2, 3].map((entrySequence) => ({
      gameId: "bytes",
      scope: "public" as const,
      round: 1,
      phase: "LOBBY",
      text,
      entrySequence,
      timestamp: entrySequence,
    })),
  );
  let cursor: string | undefined;
  let total = 0;
  do {
    const page = await readHouseGame(db, {
      gameIdOrSlug: "bytes",
      view: "replay",
      limit: 20,
      cursor,
    });
    const result = houseContent("read_game", page);
    expect(
      Buffer.byteLength(JSON.stringify(result.structuredContent)),
    ).toBeLessThanOrEqual(65536);
    if (page.gameKind !== "influence") throw Error("wrong adapter");
    expect(page.dialogue.every((entry) => entry.text === text)).toBe(true);
    total += page.dialogue.length;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(total).toBe(3);
  await db
    .update(schema.transcripts)
    .set({ text: "🐺".repeat(18000) })
    .where(eq(schema.transcripts.gameId, "bytes"));
  await expect(
    readHouseGame(db, { gameIdOrSlug: "bytes", view: "replay" }),
  ).rejects.toMatchObject({ code: "entry_too_large" });
});

test("twenty-day results and long-game thinking remain bounded without truncating ballots", async () => {
  const events = await werewolfResultsFixture("disagreement", "long", 20);
  await db.insert(schema.games).values({
    id: "long",
    slug: "long",
    gameKind: "werewolf",
    status: "completed",
    startedAt: new Date().toISOString(),
    config: "{}",
  });
  await db.insert(schema.werewolfEvents).values(
    events.map((event) => ({
      gameId: "long",
      sequence: event.sequence,
      event,
    })),
  );
  const result = houseContent(
    "read_game_results",
    await readHouseInspectionResults(db, "long"),
  );
  expect(
    Buffer.byteLength(JSON.stringify(result.structuredContent)),
  ).toBeLessThanOrEqual(256 * 1024);
  expect(JSON.stringify(result)).not.toContain("SECRET_THINKING");
  const latest = await readHouseGame(db, {
    gameIdOrSlug: "long",
    audience: "omniscient",
    limit: 1,
  });
  if (latest.gameKind !== "werewolf") throw Error("wrong adapter");
  const start = performance.now();
  const thinking = await readHouseGameThinking(db, {
    gameIdOrSlug: "long",
    audience: "omniscient",
    position: [latest.position.cursor],
    limit: 20,
  });
  houseContent("read_game_thinking", thinking);
  console.info(
    `House twenty-day thinking: ${Math.round(performance.now() - start)}ms, ${thinking.entries.length} entries`,
  );
  expect(thinking.entries).toHaveLength(20);
  expect(thinking.nextCursor).toBeString();
});

test("specialized Influence readers reject Werewolf after authorization; shared costs and traces remain producer-only", async () => {
  const { ProductionGameMcpReadModel } = await import(
    "../game-mcp/read-model.js"
  );
  const { id } = await wolf();
  await db.insert(schema.users).values({ id: "creator" });
  await db
    .update(schema.games)
    .set({ createdById: "creator" })
    .where(eq(schema.games.id, id));
  const model = new ProductionGameMcpReadModel(db),
    producer = { userId: "producer", authProfile: "producer" as const },
    stranger = { userId: "stranger", authProfile: "subject" as const },
    creator = { userId: "creator", authProfile: "subject" as const };
  for (const access of [producer, creator])
    await expect(model.readProjection(id, access)).rejects.toMatchObject({
      code: "unsupported_game_kind",
      followUps: [
        {
          tool: "read_game",
          arguments: { gameIdOrSlug: id, view: "current", audience: "mystery" },
        },
      ],
    });
  await expect(model.readProjection(id, stranger)).rejects.toMatchObject({
    code: "not_accessible",
  });
  await expect(
    model.readMatchTranscript({ gameIdOrSlug: id }, creator),
  ).rejects.toMatchObject({ code: "not_accessible" });
  await expect(model.inspectDurableRun(id, producer)).rejects.toMatchObject({
    code: "unsupported_game_kind",
  });
  expect(await model.readProducerGameCostDetail(id, producer)).toBeDefined();
  expect((await model.listTraceManifests(id, producer)).schemaVersion).toBe(2);
  await expect(model.readProducerGameCostDetail(id, stranger)).rejects.toThrow(
    "Producer-only",
  );
  await expect(model.listTraceManifests(id, stranger)).rejects.toThrow(
    "Producer-only",
  );
  await db
    .update(schema.games)
    .set({ hiddenAt: "now" })
    .where(eq(schema.games.id, id));
  await expect(model.readProjection(id, producer)).rejects.toMatchObject({
    code: "unsupported_game_kind",
    followUps: [],
  });
});

test("Influence canonical frames and thinking use separate exact cutoffs and the public watch policy", async () => {
  const { insertGame, insertOwner, createCanonicalEventFixture } = await import(
    "./durable-run-test-utils.js"
  );
  const { appendGameEvents } = await import("../services/game-events.js");
  const { getPublicWatchIntelligence } = await import(
    "../services/public-watch-intelligence.js"
  );
  const id = await insertGame(db, {
    slug: "canonical-house",
    status: "in_progress",
  });
  await db
    .update(schema.games)
    .set({ config: "{}" })
    .where(eq(schema.games.id, id));
  await db
    .insert(schema.gamePlayers)
    .values(
      ["atlas", "echo", "mira", "nyx"].map((player) => ({
        id: player,
        gameId: id,
        persona: JSON.stringify({
          name: player,
          personality: "SECRET_PERSONALITY",
          strategy: "SECRET_STRATEGY",
        }),
        agentConfig: "{}",
      })),
    );
  const publicEvents = createCanonicalEventFixture(id);
  const last = publicEvents.at(-1)!;
  const events = [
    ...publicEvents,
    {
      ...last,
      sequence: last.sequence + 1,
      type: "shields.expired" as const,
      payloadVersion: 1 as const,
      visibility: "producer" as const,
      payload: { expiredPlayerIds: [] },
    },
  ];
  await appendGameEvents(db, {
    gameId: id,
    ownerEpoch: await insertOwner(db, id),
    events,
  });
  await db.insert(schema.transcripts).values([
    {
      gameId: id,
      round: 1,
      phase: "VOTE",
      scope: "public",
      fromPlayerId: "atlas",
      entrySequence: 1,
      text: "FIRST",
      thinking: "EARLY_THOUGHT",
      timestamp: 1,
    },
    {
      gameId: id,
      round: 1,
      phase: "VOTE",
      scope: "public",
      fromPlayerId: "atlas",
      entrySequence: 2,
      text: "LATER",
      thinking: "FUTURE_THOUGHT",
      timestamp: 2,
    },
    {
      gameId: id,
      round: 1,
      phase: "VOTE",
      scope: "huddle",
      fromPlayerId: "atlas",
      entrySequence: 3,
      text: "PRIVATE",
      thinking: "PRIVATE_THOUGHT",
      timestamp: 3,
    },
  ]);
  const current = await readHouseGame(db, { gameIdOrSlug: id, limit: 1 });
  houseContent("read_game", current);
  if (current.gameKind !== "influence" || !current.snapshot)
    throw Error("missing canonical board");
  expect(current.position.eventSequence).toBe(publicEvents.at(-1)!.sequence);
  expect(current.position.transcriptSequence).toBe(2);
  expect(current.facts.length + current.dialogue.length).toBe(1);
  expect(JSON.stringify(current)).not.toContain("SECRET_");
  expect(JSON.stringify(current)).not.toContain("THOUGHT");
  const replay = await readHouseGame(db, {
    gameIdOrSlug: id,
    view: "replay",
    limit: 20,
  });
  if (replay.gameKind !== "influence") throw Error("adapter");
  expect(
    replay.facts.some((frame) => frame.sequence === last.sequence + 1),
  ).toBe(false);
  const position = [current.position.eventSequence, 1];
  const thinking = await readHouseGameThinking(db, {
    gameIdOrSlug: id,
    audience: "public",
    actorId: "atlas",
    position,
    limit: 20,
  });
  houseContent("read_game_thinking", thinking);
  const browser = await getPublicWatchIntelligence(db, {
    gameIdOrSlug: id,
    actorPlayerId: "atlas",
    round: current.snapshot.round,
    phase: current.snapshot.phase,
    throughEventSequence: position[0],
    throughTranscriptSequence: 1,
    limit: 8,
  });
  if (!browser.ok) throw Error("browser policy");
  expect(thinking.entries).toEqual(browser.intelligence.thinking.cards);
  expect(thinking.effectiveLimit).toBe(8);
  expect(JSON.stringify(thinking)).toContain("EARLY_THOUGHT");
  expect(JSON.stringify(thinking)).not.toContain("FUTURE_THOUGHT");
  expect(JSON.stringify(thinking)).not.toContain("PRIVATE_THOUGHT");
  await expect(
    readHouseGameThinking(db, {
      gameIdOrSlug: id,
      audience: "public",
      actorId: "atlas",
      position: [position[0]!, 3],
    }),
  ).rejects.toMatchObject({ code: "invalid_cursor" });
});
