import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CanonicalGameEvent } from "../canonical-events";
import { GameMcpReadModel } from "../game-mcp/read-model";
import { createGameMcpServer } from "../game-mcp/server";
import { Phase, PlayerStatus } from "../types";

let tempDirs: string[] = [];

function makeTempCorpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "influence-game-mcp-"));
  tempDirs.push(dir);
  return dir;
}

function makeSession(corpusDir: string, sessionId: string): string {
  const dir = join(corpusDir, sessionId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function event(overrides: Partial<CanonicalGameEvent>): CanonicalGameEvent {
  return {
    sequence: 1,
    gameId: "game-fixed",
    round: 0,
    phase: Phase.INIT,
    type: "game.roster_initialized",
    timestamp: "2026-06-11T00:00:00.000Z",
    source: "engine",
    visibility: "system",
    payloadVersion: 1,
    sourcePointers: [],
    payload: {
      players: [
        { id: "atlas", name: "Atlas", status: PlayerStatus.ALIVE, shielded: false },
        { id: "vera", name: "Vera", status: PlayerStatus.ALIVE, shielded: false },
      ],
    },
    ...overrides,
  } as CanonicalGameEvent;
}

function canonicalEvents(extra: CanonicalGameEvent[] = []): CanonicalGameEvent[] {
  return [
    event({}),
    event({
      sequence: 2,
      round: 1,
      phase: Phase.LOBBY,
      type: "round.started",
      visibility: "system",
      payload: { round: 1 },
    }),
    event({
      sequence: 3,
      round: 1,
      phase: Phase.VOTE,
      type: "vote.cast",
      visibility: "producer",
      sourcePointers: [{ kind: "agent_turn", sequence: 1, action: "vote", round: 1, phase: Phase.VOTE, actorId: "atlas" }],
      payload: { voterId: "atlas", empowerTarget: "vera", exposeTarget: "vera" },
    }),
    ...extra,
  ];
}

function writeCanonicalGame(sessionDir: string, gameNumber = 1): void {
  writeFileSync(
    join(sessionDir, `game-${gameNumber}-events.jsonl`),
    `${canonicalEvents().map((canonicalEvent) => JSON.stringify({ canonicalEvent })).join("\n")}\n`,
  );
  writeFileSync(
    join(sessionDir, `game-${gameNumber}-turns.jsonl`),
    `${JSON.stringify({
      sequence: 1,
      action: "vote",
      round: 1,
      thinking: "Atlas plans a quiet coalition with Vera.",
      actor: { id: "atlas", name: "Atlas" },
    })}\n`,
  );
  writeFileSync(
    join(sessionDir, `game-${gameNumber}-progress.jsonl`),
    `${JSON.stringify({ event: "game_start", gameNumber })}\n${JSON.stringify({ event: "game_completed", gameNumber })}\n`,
  );
  writeFileSync(join(sessionDir, `game-${gameNumber}.txt`), "Atlas tells Vera about the quiet coalition.\n");
  writeFileSync(join(sessionDir, `game-${gameNumber}.json`), JSON.stringify({ transcript: "quiet coalition full JSON" }, null, 2));
  writeFileSync(join(sessionDir, "stats.json"), JSON.stringify({ partial: false, completedGames: 1, failedGames: 0, requestedGames: 1, model: "mock" }));
  writeFileSync(join(sessionDir, "results.json"), JSON.stringify({ metadata: { timestamp: "2026-06-11T00:00:00.000Z", variant: "baseline" }, games: [] }));
}

function writeLegacyGame(sessionDir: string, gameNumber = 2): void {
  writeFileSync(
    join(sessionDir, `game-${gameNumber}-turns.jsonl`),
    `${JSON.stringify({ sequence: 1, action: "mingle", thinking: "Legacy reasoning mentions Vera." })}\n`,
  );
  writeFileSync(join(sessionDir, `game-${gameNumber}-progress.jsonl`), `${JSON.stringify({ event: "game_start", gameNumber })}\n`);
  writeFileSync(join(sessionDir, `game-${gameNumber}.txt`), "Legacy transcript mentions Vera.\n");
  writeFileSync(join(sessionDir, `game-${gameNumber}.json`), JSON.stringify({ notes: "Legacy full JSON mentions Vera." }));
  writeFileSync(join(sessionDir, "stats.json"), JSON.stringify({ partial: true, completedGames: 0, failedGames: 0, requestedGames: 1, model: "legacy" }));
}

describe("game MCP corpus read model", () => {
  it("discovers sessions and reports per-game artifact capabilities", () => {
    const corpusDir = makeTempCorpus();
    writeCanonicalGame(makeSession(corpusDir, "batch-2026-06-11T20-05-24"));
    writeLegacyGame(makeSession(corpusDir, "batch-legacy"));
    const readModel = new GameMcpReadModel(corpusDir);

    expect(readModel.listSessions().map((session) => session.sessionId)).toEqual([
      "batch-legacy",
      "batch-2026-06-11T20-05-24",
    ]);
    expect(readModel.listGames({ sessionId: "batch-2026-06-11T20-05-24" })).toMatchObject([
      { sessionId: "batch-2026-06-11T20-05-24", gameNumber: 1, hasEvents: true, hasProjection: true, hasTurns: true },
    ]);
    expect(readModel.listGames({ sessionId: "batch-legacy" })).toMatchObject([
      { sessionId: "batch-legacy", gameNumber: 2, hasEvents: false, hasProjection: false, hasTurns: true },
    ]);
  });

  it("ignores a trailing partial JSONL write, then rereads when the file is completed", () => {
    const corpusDir = makeTempCorpus();
    const sessionDir = makeSession(corpusDir, "batch-live");
    const completed = canonicalEvents();
    const lastEvent = event({
      sequence: 4,
      round: 1,
      phase: Phase.VOTE,
      type: "player.last_message_recorded",
      visibility: "public",
      payload: { playerId: "atlas", message: "Last complete line" },
    });
    const completeLastLine = JSON.stringify({ canonicalEvent: lastEvent });
    const eventsPath = join(sessionDir, "game-1-events.jsonl");
    writeFileSync(eventsPath, `${completed.map((canonicalEvent) => JSON.stringify({ canonicalEvent })).join("\n")}\n${completeLastLine.slice(0, 20)}\n\n`);
    const readModel = new GameMcpReadModel(corpusDir);

    expect(readModel.readEvents("batch-live", 1)).toHaveLength(3);

    writeFileSync(eventsPath, `${completed.map((canonicalEvent) => JSON.stringify({ canonicalEvent })).join("\n")}\n${completeLastLine}\n`);

    expect(readModel.readEvents("batch-live", 1)).toHaveLength(4);
  });

  it("queries projections, events, player timelines, searches, and linked turn records by session/game", () => {
    const corpusDir = makeTempCorpus();
    writeCanonicalGame(makeSession(corpusDir, "batch-query"));
    const readModel = new GameMcpReadModel(corpusDir);

    const projection = readModel.readProjection("batch-query", 1);
    expect(projection.players.atlas?.name).toBe("Atlas");
    expect(projection.currentVoteTally.empowerVotes.atlas).toBe("vera");

    expect(readModel.filterEvents({ sessionId: "batch-query", gameNumber: 1, type: "vote.cast" })).toMatchObject([
      { citation: { sessionId: "batch-query", gameNumber: 1, sourceKind: "events", eventSequence: 3 } },
    ]);
    expect(readModel.readPlayerTimeline("batch-query", 1, "Atlas", "producer").map((entry) => entry.event.type)).toContain("vote.cast");
    expect(readModel.readPlayerTimeline("batch-query", 1, "Vera", "producer").map((entry) => entry.event.type)).toContain("vote.cast");
    expect(readModel.readPlayerTimeline("batch-query", 1, "Atlas", "player").map((entry) => entry.event.type)).not.toContain("vote.cast");

    const searchResults = readModel.searchLogs({ query: "quiet coalition", sessionId: "batch-query", sources: ["turns", "transcript", "game_json"] });
    expect(searchResults.map((result) => result.citation.sourceKind).sort()).toEqual(["game_json", "transcript", "turns"]);

    const linked = readModel.readLinkedRecords("batch-query", 1, 3);
    expect(linked.event.event.type).toBe("vote.cast");
    expect(linked.turns).toHaveLength(1);
    expect(linked.turns[0]).toMatchObject({ record: { action: "vote" } });
  });

  it("searches Mingle intent and strategic reflection turn records for strategy validation", () => {
    const corpusDir = makeTempCorpus();
    const sessionDir = makeSession(corpusDir, "batch-strategy-validation");
    writeCanonicalGame(sessionDir);
    writeFileSync(
      join(sessionDir, "game-1-turns.jsonl"),
      [
        {
          sequence: 1,
          type: "agent_turn",
          action: "mingle-intent",
          round: 1,
          phase: Phase.MINGLE,
          actor: { id: "atlas", name: "Atlas" },
          visibility: "private",
          response: {
            purpose: "Find one player willing to compare Vera reads.",
            provisionalTarget: null,
            noTargetReason: "Atlas has only soft social evidence.",
            openingAsk: "Ask whether Vera's warmth feels rehearsed or genuine.",
          },
          thinking: "Atlas should not overcommit yet.",
        },
        {
          sequence: 2,
          type: "agent_turn",
          action: "strategic-reflection",
          round: 1,
          phase: Phase.VOTE,
          actor: { id: "atlas", name: "Atlas" },
          visibility: "private",
          response: {
            reflectedPhase: Phase.VOTE,
            certainties: ["Mira kept her promise"],
            suspicions: ["Vera avoided naming a vote"],
            allies: ["Mira"],
            threats: ["Vera"],
            plan: "Keep Mira close and test Finn next.",
          },
          thinking: "Atlas updates his private map after the vote.",
        },
      ].map((record) => JSON.stringify(record)).join("\n") + "\n",
    );
    const readModel = new GameMcpReadModel(corpusDir);

    const intentResults = readModel.searchLogs({
      query: "mingle-intent",
      sessionId: "batch-strategy-validation",
      gameNumber: 1,
      sources: ["turns"],
    });
    const reflectionResults = readModel.searchLogs({
      query: "strategic-reflection",
      sessionId: "batch-strategy-validation",
      gameNumber: 1,
      sources: ["turns"],
    });

    expect(intentResults).toHaveLength(1);
    expect(intentResults[0]).toMatchObject({
      citation: { sourceKind: "turns", line: 1 },
      record: {
        action: "mingle-intent",
        response: {
          purpose: "Find one player willing to compare Vera reads.",
          provisionalTarget: null,
          noTargetReason: "Atlas has only soft social evidence.",
        },
      },
    });
    expect(reflectionResults).toHaveLength(1);
    expect(reflectionResults[0]).toMatchObject({
      citation: { sourceKind: "turns", line: 2 },
      record: {
        action: "strategic-reflection",
        response: {
          reflectedPhase: Phase.VOTE,
          plan: "Keep Mira close and test Finn next.",
        },
      },
    });
  });

  it("disambiguates linked turn fallback matches by actor and phase", () => {
    const corpusDir = makeTempCorpus();
    const sessionDir = makeSession(corpusDir, "batch-linked");
    writeFileSync(
      join(sessionDir, "game-1-events.jsonl"),
      `${canonicalEvents([
        event({
          sequence: 4,
          round: 1,
          phase: Phase.VOTE,
          type: "vote.cast",
          visibility: "producer",
          sourcePointers: [{ kind: "agent_turn", action: "vote", round: 1, phase: Phase.VOTE, actorId: "vera" }],
          payload: { voterId: "vera", empowerTarget: "atlas", exposeTarget: "atlas" },
        }),
      ]).map((canonicalEvent) => JSON.stringify({ canonicalEvent })).join("\n")}\n`,
    );
    writeFileSync(
      join(sessionDir, "game-1-turns.jsonl"),
      [
        { sequence: 1, action: "vote", round: 1, phase: Phase.VOTE, actor: { id: "atlas", name: "Atlas" } },
        { sequence: 2, action: "vote", round: 1, phase: Phase.VOTE, actor: { id: "vera", name: "Vera" } },
      ].map((record) => JSON.stringify(record)).join("\n"),
    );
    const readModel = new GameMcpReadModel(corpusDir);

    const linked = readModel.readLinkedRecords("batch-linked", 1, 4);

    expect(linked.turns).toHaveLength(1);
    expect(linked.turns[0]?.record?.actor).toEqual({ id: "vera", name: "Vera" });
  });

  it("keeps corpus queries working when another session has a bad event log", () => {
    const corpusDir = makeTempCorpus();
    writeCanonicalGame(makeSession(corpusDir, "batch-good"));
    const badSessionDir = makeSession(corpusDir, "batch-bad");
    writeFileSync(join(badSessionDir, "game-1-events.jsonl"), `{not json}\n${JSON.stringify({ ignored: true })}\n`);
    const readModel = new GameMcpReadModel(corpusDir);

    expect(readModel.listGames()).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: "batch-good", gameNumber: 1, hasEvents: true }),
      expect.objectContaining({ sessionId: "batch-bad", gameNumber: 1, hasEvents: true }),
    ]));
    expect(readModel.filterEvents({ type: "vote.cast" }).map((entry) => entry.citation.sessionId)).toEqual(["batch-good"]);
    expect(() => readModel.readProjection("batch-bad", 1)).toThrow();
  });

  it("ignores symlinked artifacts that point outside the simulation session", () => {
    const corpusDir = makeTempCorpus();
    const sessionDir = makeSession(corpusDir, "batch-symlink");
    const outsideDir = makeTempCorpus();
    const outsideTranscript = join(outsideDir, "outside.txt");
    writeFileSync(outsideTranscript, "secret outside corpus text");
    symlinkSync(outsideTranscript, join(sessionDir, "game-1.txt"));
    const safeSessionDir = makeSession(corpusDir, "batch-safe");
    writeCanonicalGame(safeSessionDir);

    const readModel = new GameMcpReadModel(corpusDir);

    expect(readModel.listSessions().map((session) => session.sessionId)).not.toContain("batch-symlink");
    expect(readModel.searchLogs({ query: "secret outside corpus text" })).toEqual([]);
  });

  it("keeps legacy sessions searchable but refuses projection without a canonical event log", () => {
    const corpusDir = makeTempCorpus();
    writeLegacyGame(makeSession(corpusDir, "batch-legacy"));
    const readModel = new GameMcpReadModel(corpusDir);

    expect(readModel.searchLogs({ query: "legacy", sessionId: "batch-legacy" }).length).toBeGreaterThan(0);
    expect(() => readModel.readProjection("batch-legacy", 2)).toThrow("No canonical event log");
  });
});

describe("game MCP JSON-RPC server", () => {
  it("exposes session-aware corpus resources and read-only tools", async () => {
    const corpusDir = makeTempCorpus();
    writeCanonicalGame(makeSession(corpusDir, "batch-rpc"));
    const server = createGameMcpServer(corpusDir);

    const init = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(init?.result).toMatchObject({ serverInfo: { name: "influence-game-log" } });

    const resources = await server.handle({ jsonrpc: "2.0", id: 2, method: "resources/list" });
    expect(JSON.stringify(resources?.result)).toContain("influence-game://sessions/batch-rpc/games/1/events");

    const missingSession = await server.handle({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "read_projection", arguments: { gameNumber: 1 } },
    });
    expect(missingSession?.error?.message).toContain("sessionId is required");

    const projection = await server.handle({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "read_projection", arguments: { sessionId: "batch-rpc", gameNumber: 1 } },
    });
    expect(JSON.stringify(projection?.result)).toContain("Atlas");
    const projectionContent = projection?.result as { content?: Array<{ text?: string }> } | undefined;
    expect(JSON.parse(projectionContent?.content?.[0]?.text ?? "{}")).toMatchObject({
      citation: { sourceKind: "events", eventSequence: 3 },
      projection: { players: { atlas: { name: "Atlas" } } },
    });

    const search = await server.handle({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "search_logs", arguments: { query: "quiet coalition", sessionId: "batch-rpc", limit: 2 } },
    });
    expect(JSON.stringify(search?.result)).toContain("quiet coalition");

    const rejected = await server.handle({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "mutate_game", arguments: { sessionId: "batch-rpc", gameNumber: 1 } },
    });
    expect(rejected?.error?.message).toContain("not supported");
  });

  it("keeps a single batch directory usable while still returning session ids", async () => {
    const corpusDir = makeTempCorpus();
    const sessionDir = makeSession(corpusDir, "batch-single");
    writeCanonicalGame(sessionDir);
    const server = createGameMcpServer(sessionDir);

    const games = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_games", arguments: {} },
    });

    expect(JSON.stringify(games?.result)).toContain("batch-single");
  });
});
