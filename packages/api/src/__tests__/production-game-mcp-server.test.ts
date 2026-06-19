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

describe("ProductionGameMcpJsonRpcServer", () => {
  test("advertises deployed read-only tools with MCP auth metadata", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    const response = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    expect(response?.error).toBeUndefined();
    const tools = ((response?.result as { tools: unknown[] }).tools);
    expect(tools.map((tool) => (tool as { name: string }).name)).toEqual([
      "list_games",
      "read_projection",
      "filter_events",
      "player_timeline",
      "inspect_durable_run",
      "list_trace_manifests",
      "read_trace_content",
      "search_reasoning_traces",
    ]);
    expect(JSON.stringify(tools)).toContain("\"scopes\":[\"mcp\"]");
    expect(JSON.stringify(tools)).not.toContain("start_game");
    const searchTool = tools.find((tool) => (tool as { name: string }).name === "search_reasoning_traces");
    expect(JSON.stringify(searchTool)).not.toContain("maxBytesPerObject");
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
    });

    expect(response?.id).toBe("call-1");
    expect(response?.error).toBeUndefined();
    expect(calls).toEqual(["listGames"]);
    const text = ((response?.result as { content: Array<{ text: string }> }).content[0]?.text);
    expect(text).toContain("\"ok\": true");
  });

  test("rejects unknown or mutation-shaped tools before read model calls", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    const response = await server.handle({
      jsonrpc: "2.0",
      id: "bad-tool",
      method: "tools/call",
      params: { name: "start_game", arguments: { gameIdOrSlug: "g1" } },
    });

    expect(response?.error?.message).toBe(
      "Unknown or mutation-shaped tool is not supported: start_game",
    );
  });

  test("does not expose or forward trace search scan byte caps", async () => {
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
          maxBytesPerObject: 1,
        },
      },
    });

    expect(response?.error).toBeUndefined();
    expect(calls).toEqual([{
      gameIdOrSlug: "game-1",
      query: "Arden",
      actor: undefined,
      action: undefined,
      phase: undefined,
      limit: 3,
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

    await readModel.readTraceContent({ manifestId: "manifest-1" });

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
      });

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
    filterEvents: async () => ({ events: [] }),
    playerTimeline: async () => ({ events: [] }),
    inspectDurableRun: async () => ({ durableRun: null }),
    listTraceManifests: async () => ({ manifests: [] }),
    readTraceContent: async () => ({ content: "" }),
    searchReasoningTraces: async () => ({ matches: [] }),
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
