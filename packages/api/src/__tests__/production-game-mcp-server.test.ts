import { describe, expect, test } from "bun:test";
import {
  ProductionGameMcpJsonRpcServer,
  createProductionGameMcpServer,
} from "../game-mcp/server.js";
import type { DrizzleDB } from "../db/index.js";
import {
  ProductionGameMcpReadModel,
} from "../game-mcp/read-model.js";
import type { PrivateTraceReadModel } from "../services/private-trace-read-model.js";
import type { GameMcpAuthContext } from "../game-mcp/auth.js";

const GAMES_AUTH: GameMcpAuthContext = {
  userId: "user-1",
  clientId: "client-1",
  resource: "http://127.0.0.1:3000/mcp",
  scope: "games",
  authProfile: "games_subject",
  expiresAt: 1_800_000_000,
};

const PRODUCER_AUTH: GameMcpAuthContext = {
  userId: "producer-1",
  clientId: "client-1",
  resource: "http://127.0.0.1:3000/mcp/producer",
  scope: "mcp",
  authProfile: "producer_mcp",
  expiresAt: 1_800_000_000,
};

describe("ProductionGameMcpJsonRpcServer", () => {
  test("advertises deployed read-only tools with MCP auth metadata", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    const response = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }, PRODUCER_AUTH);

    expect(response?.error).toBeUndefined();
    const tools = ((response?.result as { tools: unknown[] }).tools);
    expect(tools.map((tool) => (tool as { name: string }).name)).toEqual([
      "list_games",
      "read_projection",
      "read_round_facts",
      "filter_events",
      "player_timeline",
      "list_cognitive_artifacts",
      "read_cognitive_artifact",
      "inspect_durable_run",
      "list_trace_manifests",
      "read_trace_content",
      "search_reasoning_traces",
    ]);
    expect(JSON.stringify(tools)).toContain("\"scopes\":[\"mcp\"]");
    expect(JSON.stringify(tools)).not.toContain("start_game");
    const searchTool = tools.find((tool) => (tool as { name: string }).name === "search_reasoning_traces");
    expect(JSON.stringify(searchTool)).not.toContain("maxBytesPerObject");
    expect(JSON.stringify(searchTool)).toContain("maxBytes");
  });

  test("advertises only user-facing tools for games-scope auth", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    const response = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }, GAMES_AUTH);

    expect(response?.error).toBeUndefined();
    const tools = ((response?.result as { tools: unknown[] }).tools);
    expect(tools.map((tool) => (tool as { name: string }).name)).toEqual([
      "list_games",
      "read_projection",
      "read_round_facts",
      "filter_events",
      "player_timeline",
      "list_cognitive_artifacts",
      "read_cognitive_artifact",
    ]);
    expect(JSON.stringify(tools)).toContain("\"scopes\":[\"games\"]");
    expect(JSON.stringify(tools)).not.toContain("read_trace_content");
    expect(JSON.stringify(tools)).not.toContain("\"scopes\":[\"mcp\"]");
  });

  test("routes tool calls to the production read model", async () => {
    const calls: string[] = [];
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel({
      listGames: async () => {
        calls.push("listGames");
        return { ok: true };
      },
    }));

    const response = await server.handle({
      jsonrpc: "2.0",
      id: "call-1",
      method: "tools/call",
      params: { name: "list_games", arguments: { limit: 1 } },
    }, PRODUCER_AUTH);

    expect(response?.id).toBe("call-1");
    expect(response?.error).toBeUndefined();
    expect(calls).toEqual(["listGames"]);
    const text = ((response?.result as { content: Array<{ text: string }> }).content[0]?.text);
    expect(text).toContain("\"ok\": true");
  });

  test("forwards read_round_facts arguments to the production read model", async () => {
    const calls: unknown[] = [];
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel({
      readRoundFacts: async (args: unknown) => {
        calls.push(args);
        return { schemaVersion: 1, canonicalGameFacts: { roundFacts: { round: 2 } } };
      },
    }));

    const response = await server.handle({
      jsonrpc: "2.0",
      id: "round-facts",
      method: "tools/call",
      params: { name: "read_round_facts", arguments: { gameIdOrSlug: "game-1", round: 2 } },
    }, PRODUCER_AUTH);

    expect(response?.error).toBeUndefined();
    expect(calls).toEqual([{ gameIdOrSlug: "game-1", round: 2 }]);
    const text = ((response?.result as { content: Array<{ text: string }> }).content[0]?.text);
    expect(text).toContain("\"round\": 2");
  });

  test("forwards games auth context to user-facing resources and tools", async () => {
    const calls: Array<{ method: string; access: unknown }> = [];
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel({
      listGames: async (_access: unknown, _limit?: number) => {
        calls.push({ method: "listGames", access: _access });
        return { games: [] };
      },
      readProjection: async (_gameIdOrSlug: string, access: unknown) => {
        calls.push({ method: "readProjection", access });
        return { projection: null };
      },
      readRoundFacts: async (_args: unknown, access: unknown) => {
        calls.push({ method: "readRoundFacts", access });
        return { roundFacts: null };
      },
      filterEvents: async (_args: unknown, access: unknown) => {
        calls.push({ method: "filterEvents", access });
        return { events: [] };
      },
      playerTimeline: async (_args: unknown, access: unknown) => {
        calls.push({ method: "playerTimeline", access });
        return { events: [] };
      },
      listCognitiveArtifacts: async (_args: unknown, access: unknown) => {
        calls.push({ method: "listCognitiveArtifacts", access });
        return { artifacts: [] };
      },
      readCognitiveArtifact: async (_args: unknown, access: unknown) => {
        calls.push({ method: "readCognitiveArtifact", access });
        return { artifact: null };
      },
    }));

    await server.handle({
      jsonrpc: "2.0",
      id: "resource-read",
      method: "resources/read",
      params: { uri: "influence-game://deployed/games" },
    }, GAMES_AUTH);
    await server.handle({
      jsonrpc: "2.0",
      id: "list",
      method: "tools/call",
      params: { name: "list_games", arguments: { limit: 1 } },
    }, GAMES_AUTH);
    await server.handle({
      jsonrpc: "2.0",
      id: "projection",
      method: "tools/call",
      params: { name: "read_projection", arguments: { gameIdOrSlug: "game-1" } },
    }, GAMES_AUTH);
    await server.handle({
      jsonrpc: "2.0",
      id: "round-facts",
      method: "tools/call",
      params: { name: "read_round_facts", arguments: { gameIdOrSlug: "game-1", round: 2 } },
    }, GAMES_AUTH);
    await server.handle({
      jsonrpc: "2.0",
      id: "events",
      method: "tools/call",
      params: { name: "filter_events", arguments: { gameIdOrSlug: "game-1" } },
    }, GAMES_AUTH);
    await server.handle({
      jsonrpc: "2.0",
      id: "timeline",
      method: "tools/call",
      params: { name: "player_timeline", arguments: { gameIdOrSlug: "game-1", player: "Ada" } },
    }, GAMES_AUTH);
    await server.handle({
      jsonrpc: "2.0",
      id: "cognitive-list",
      method: "tools/call",
      params: { name: "list_cognitive_artifacts", arguments: { gameIdOrSlug: "game-1", artifactType: "thinking" } },
    }, GAMES_AUTH);
    await server.handle({
      jsonrpc: "2.0",
      id: "cognitive-read",
      method: "tools/call",
      params: {
        name: "read_cognitive_artifact",
        arguments: {
          gameIdOrSlug: "game-1",
          artifactId: "artifact-1",
          artifactType: "thinking",
          actorPlayerId: "player-1",
        },
      },
    }, GAMES_AUTH);

    expect(calls).toEqual([
      { method: "listGames", access: GAMES_AUTH },
      { method: "listGames", access: GAMES_AUTH },
      { method: "readProjection", access: GAMES_AUTH },
      { method: "readRoundFacts", access: GAMES_AUTH },
      { method: "filterEvents", access: GAMES_AUTH },
      { method: "playerTimeline", access: GAMES_AUTH },
      { method: "listCognitiveArtifacts", access: GAMES_AUTH },
      { method: "readCognitiveArtifact", access: GAMES_AUTH },
    ]);
  });

  test("rejects unknown or mutation-shaped tools before read model calls", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    const response = await server.handle({
      jsonrpc: "2.0",
      id: "bad-tool",
      method: "tools/call",
      params: { name: "start_game", arguments: { gameIdOrSlug: "g1" } },
    }, PRODUCER_AUTH);

    expect(response?.error?.message).toBe(
      "Unknown or mutation-shaped tool is not supported: start_game",
    );
  });

  test("rejects producer-only tools for games-scope auth", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    const response = await server.handle({
      jsonrpc: "2.0",
      id: "trace-tool",
      method: "tools/call",
      params: { name: "read_trace_content", arguments: { manifestId: "m1" } },
    }, GAMES_AUTH);

    expect(response?.error?.message).toBe(
      "Unknown or producer-only tool is not supported for scope=games: read_trace_content",
    );
  });

  test("forwards supported trace search maxBytes and ignores legacy scan caps", async () => {
    const calls: unknown[] = [];
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel({
      searchReasoningTraces: async (args: unknown) => {
        calls.push(args);
        return { schemaVersion: 1, privateReasoning: { matches: [] } };
      },
    }));

    const response = await server.handle({
      jsonrpc: "2.0",
      id: "search",
      method: "tools/call",
      params: {
        name: "search_reasoning_traces",
        arguments: {
          gameIdOrSlug: "game-1",
          query: "Arden",
          limit: 3,
          maxBytes: 4096,
          maxBytesPerObject: 1,
        },
      },
    }, PRODUCER_AUTH);

    expect(response?.error).toBeUndefined();
    expect(calls).toEqual([{
      gameIdOrSlug: "game-1",
      query: "Arden",
      actor: undefined,
      action: undefined,
      phase: undefined,
      limit: 3,
      maxBytes: 4096,
    }]);
  });

  test("uses a developer-sized default raw trace read limit", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const readModel = new ProductionGameMcpReadModel(
      {} as DrizzleDB,
      {
        readContent: async (manifestId: string, options: Record<string, unknown>) => {
          calls.push({ manifestId, ...options });
          return {
            ok: true,
            response: {
              manifest: { id: manifestId },
              content: "{}",
              byteLength: 2,
              sha256: "sha256:test",
            },
          };
        },
      } as unknown as PrivateTraceReadModel,
    );

    await readModel.readTraceContent({ manifestId: "manifest-1" }, PRODUCER_AUTH);

    expect(calls).toEqual([{
      manifestId: "manifest-1",
      gameId: undefined,
      purpose: "production_game_mcp_read_trace_content",
      maxBytes: 8 * 1024 * 1024,
    }]);
  });

  test("player timelines preserve event-log diagnostics", async () => {
    const readModel = {
      filterEvents: async () => ({
        schemaVersion: 1 as const,
        game: {
          id: "game-1",
          status: "running",
          trackType: "standard",
          createdAt: "2026-06-19T00:00:00.000Z",
        },
        canonicalGameFacts: {
          eventLogStatus: "invalid",
          validPrefixLength: 2,
          events: [],
        },
        diagnostics: [{ code: "hash_mismatch" }],
      }),
    } as unknown as ProductionGameMcpReadModel;

    const timeline = await ProductionGameMcpReadModel.prototype.playerTimeline.call(
      readModel,
      { gameIdOrSlug: "game-1", player: "Ada" },
      PRODUCER_AUTH,
    );

    expect(timeline.canonicalGameFacts).toMatchObject({
      player: "Ada",
      eventLogStatus: "invalid",
      validPrefixLength: 2,
    });
    expect(timeline.diagnostics).toEqual([{ code: "hash_mismatch" }]);
  });

  test("constructs without private trace storage configuration", async () => {
    const previous = {
      endpoint: process.env.LINODE_PRIVATE_CONTENT_ENDPOINT,
      accessKey: process.env.LINODE_PRIVATE_CONTENT_ACCESS_KEY,
      secretKey: process.env.LINODE_PRIVATE_CONTENT_SECRET_KEY,
      bucket: process.env.LINODE_PRIVATE_CONTENT_BUCKET,
    };
    delete process.env.LINODE_PRIVATE_CONTENT_ENDPOINT;
    delete process.env.LINODE_PRIVATE_CONTENT_ACCESS_KEY;
    delete process.env.LINODE_PRIVATE_CONTENT_SECRET_KEY;
    delete process.env.LINODE_PRIVATE_CONTENT_BUCKET;

    try {
      const server = createProductionGameMcpServer({} as DrizzleDB);
      const response = await server.handle({
        jsonrpc: "2.0",
        id: "init",
        method: "initialize",
      }, PRODUCER_AUTH);

      expect(response?.error).toBeUndefined();
      expect(response?.result).toMatchObject({
        serverInfo: { name: "influence-game-production" },
      });
    } finally {
      restoreEnv("LINODE_PRIVATE_CONTENT_ENDPOINT", previous.endpoint);
      restoreEnv("LINODE_PRIVATE_CONTENT_ACCESS_KEY", previous.accessKey);
      restoreEnv("LINODE_PRIVATE_CONTENT_SECRET_KEY", previous.secretKey);
      restoreEnv("LINODE_PRIVATE_CONTENT_BUCKET", previous.bucket);
    }
  });
});

function fakeReadModel(
  overrides: Partial<Record<keyof ProductionGameMcpReadModel, unknown>> = {},
): ProductionGameMcpReadModel {
  return {
    listGames: async () => ({ games: [] }),
    readProjection: async () => ({ projection: null }),
    readRoundFacts: async () => ({ roundFacts: null }),
    filterEvents: async () => ({ events: [] }),
    playerTimeline: async () => ({ events: [] }),
    inspectDurableRun: async () => ({ durableRun: null }),
    listTraceManifests: async () => ({ manifests: [] }),
    readTraceContent: async () => ({ content: "" }),
    searchReasoningTraces: async () => ({ matches: [] }),
    listCognitiveArtifacts: async () => ({ artifacts: [] }),
    readCognitiveArtifact: async () => ({ artifact: null }),
    ...overrides,
  } as unknown as ProductionGameMcpReadModel;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
