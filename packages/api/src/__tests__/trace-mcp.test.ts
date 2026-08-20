import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { schema } from "../db/index.js";
import { PRIVATE_TRACE_EVIDENCE_TYPE } from "../services/private-trace-writer.js";
import { createTraceMcpServer, TraceMcpJsonRpcServer } from "../trace-mcp/server.js";
import type { PrivateTraceReadModel } from "../trace-mcp/read-model.js";
import { setupTestDB } from "./test-utils.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";

function parseToolContent(result: unknown): unknown {
  const record = result as { content?: Array<{ type: "text"; text: string }> };
  const text = record.content?.[0]?.text;
  if (!text) throw new Error("missing tool text content");
  return JSON.parse(text) as unknown;
}

class MockTraceReadModel {
  calls: Array<{ name: string; args: unknown }> = [];
  manifestResult: Record<string, unknown> = {
    ok: true,
    totalCount: 1,
    pageSize: 1,
    nextCursor: null,
    linkageSummary: { status: "complete" },
    manifests: [{ id: "manifest-1", action: "vote" }],
  };

  async listDurableRuns(limit?: number) {
    this.calls.push({ name: "listDurableRuns", args: { limit } });
    return [{ id: "game-1", status: "completed", traceManifestCount: 1 }];
  }

  async inspectDurableRun(gameIdOrSlug: string) {
    this.calls.push({ name: "inspectDurableRun", args: { gameIdOrSlug } });
    return { schemaVersion: 2, game: { id: gameIdOrSlug } };
  }

  async listManifests(gameIdOrSlug: string, options?: { limit?: number; cursor?: string }) {
    this.calls.push({ name: "listManifests", args: { gameIdOrSlug, options } });
    return {
      ...this.manifestResult,
      gameId: gameIdOrSlug,
    };
  }

  async readContent(manifestId: string, args: unknown) {
    const extra = args as Record<string, unknown>;
    this.calls.push({ name: "readContent", args: { manifestId, ...extra } });
    return { ok: true, response: { manifest: { id: manifestId }, content: "{\"hello\":\"trace\"}" } };
  }

  async searchReasoningTraces(args: unknown) {
    this.calls.push({ name: "searchReasoningTraces", args });
    return { gameId: "game-1", matches: [{ manifestId: "manifest-1", preview: "hidden reasoning" }] };
  }
}

describe("Trace MCP JSON-RPC server", () => {
  test("advertises local trace tools", async () => {
    const server = new TraceMcpJsonRpcServer(new MockTraceReadModel() as unknown as PrivateTraceReadModel);

    const response = await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(response?.error).toBeUndefined();
    const advertisedTools = (response?.result as {
      tools: Array<{ name: string; description: string; outputSchema?: Record<string, unknown> }>;
    }).tools;
    const toolNames = advertisedTools.map((tool) => tool.name);
    expect(toolNames).toEqual([
      "list_durable_runs",
      "inspect_durable_run",
      "list_manifests",
      "read_content",
      "search_reasoning_traces",
    ]);
    expect(JSON.stringify(toolNames)).not.toContain("retry");
    expect(JSON.stringify(toolNames)).not.toContain("resume");
    expect(JSON.stringify(toolNames)).not.toContain("restart");
    expect(JSON.stringify(response?.result)).not.toContain("maxBytesPerObject");
    expect(JSON.stringify(response?.result)).toContain("maxBytes");
    const manifestTool = advertisedTools.find((tool) => tool.name === "list_manifests");
    expect(manifestTool?.description).toContain("until it is null");
    expect(JSON.stringify(manifestTool?.outputSchema)).toContain("linkageSummary");
    expect(JSON.stringify(manifestTool?.outputSchema)).toContain("nextCursor");
  });

  test("routes trace tools to the read model", async () => {
    const readModel = new MockTraceReadModel();
    const server = new TraceMcpJsonRpcServer(readModel as unknown as PrivateTraceReadModel);

    const list = await server.handle({
      jsonrpc: "2.0",
      id: "list",
      method: "tools/call",
      params: {
        name: "list_manifests",
        arguments: { gameIdOrSlug: "game-1", limit: 5, cursor: "pi1.cursor" },
      },
    });
    const read = await server.handle({
      jsonrpc: "2.0",
      id: "read",
      method: "tools/call",
      params: { name: "read_content", arguments: { manifestId: "manifest-1", gameId: "game-1" } },
    });
    const search = await server.handle({
      jsonrpc: "2.0",
      id: "search",
      method: "tools/call",
      params: {
        name: "search_reasoning_traces",
        arguments: { gameIdOrSlug: "game-1", query: "reasoning", maxBytes: 512, maxBytesPerObject: 1 },
      },
    });

    expect(parseToolContent(list?.result)).toMatchObject({ gameId: "game-1", totalCount: 1 });
    expect((list?.result as { structuredContent?: unknown }).structuredContent).toMatchObject({
      gameId: "game-1",
      totalCount: 1,
      pageSize: 1,
    });
    expect(parseToolContent(read?.result)).toMatchObject({ ok: true });
    expect(parseToolContent(search?.result)).toMatchObject({ matches: [{ manifestId: "manifest-1" }] });
    expect(readModel.calls.map((call) => call.name)).toEqual([
      "listManifests",
      "readContent",
      "searchReasoningTraces",
    ]);
    expect(readModel.calls[0]!.args).toEqual({
      gameIdOrSlug: "game-1",
      options: { limit: 5, cursor: "pi1.cursor" },
    });
    expect(readModel.calls[2]!.args).toEqual({
      gameIdOrSlug: "game-1",
      query: "reasoning",
      actor: undefined,
      action: undefined,
      phase: undefined,
      limit: undefined,
      maxBytes: 512,
    });
  });

  test("returns manifest cursor failures as structured tool output", async () => {
    const readModel = new MockTraceReadModel();
    readModel.manifestResult = {
      ok: false,
      status: "cursor_invalid_or_stale",
      error: "Cursor is invalid or stale",
    };
    const server = new TraceMcpJsonRpcServer(readModel as unknown as PrivateTraceReadModel);

    const response = await server.handle({
      jsonrpc: "2.0",
      id: "invalid-cursor",
      method: "tools/call",
      params: {
        name: "list_manifests",
        arguments: { gameIdOrSlug: "missing", cursor: "pi1.invalid" },
      },
    });

    expect(parseToolContent(response?.result)).toEqual({
      ok: false,
      status: "cursor_invalid_or_stale",
      error: "Cursor is invalid or stale",
      gameId: "missing",
    });
    expect((response?.result as { structuredContent?: unknown }).structuredContent).toEqual(
      parseToolContent(response?.result),
    );
  });

  test("local server paginates without a production JWT secret", async () => {
    const db = await setupTestDB();
    const gameId = await insertGame(db, { slug: "local-trace-cursor-secret" });
    const ownerEpoch = await insertOwner(db, gameId);
    await db.insert(schema.gameEvidenceManifests).values([0, 1].map((index) => ({
      id: randomUUID(),
      gameId,
      ownerEpoch,
      evidenceType: PRIVATE_TRACE_EVIDENCE_TYPE,
      retentionClass: "debug",
      accessScope: "producer_admin",
      redactionStatus: "active" as const,
      metadata: { index },
      createdAt: "2026-08-19T12:00:00.000Z",
    })));

    const previousJwtSecret = process.env.JWT_SECRET;
    const previousCursorSecret = process.env.INFLUENCE_TRACE_MCP_CURSOR_SECRET;
    delete process.env.JWT_SECRET;
    process.env.INFLUENCE_TRACE_MCP_CURSOR_SECRET = "local-trace-cursor-secret-that-survives-reconnects";
    try {
      const firstServer = createTraceMcpServer(db);
      const firstResponse = await firstServer.handle({
        jsonrpc: "2.0",
        id: "first",
        method: "tools/call",
        params: {
          name: "list_manifests",
          arguments: { gameIdOrSlug: gameId, limit: 1 },
        },
      });
      const first = parseToolContent(firstResponse?.result) as {
        manifests: Array<{ id: string }>;
        nextCursor: string | null;
        totalCount: number;
      };
      expect(first).toMatchObject({ totalCount: 2, manifests: [{ id: expect.any(String) }] });
      expect(typeof first.nextCursor).toBe("string");

      const reconnectedServer = createTraceMcpServer(db);
      const secondResponse = await reconnectedServer.handle({
        jsonrpc: "2.0",
        id: "second",
        method: "tools/call",
        params: {
          name: "list_manifests",
          arguments: { gameIdOrSlug: gameId, limit: 1, cursor: first.nextCursor },
        },
      });
      expect(parseToolContent(secondResponse?.result)).toMatchObject({
        totalCount: 2,
        pageSize: 1,
        nextCursor: null,
      });
    } finally {
      if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousJwtSecret;
      if (previousCursorSecret === undefined) delete process.env.INFLUENCE_TRACE_MCP_CURSOR_SECRET;
      else process.env.INFLUENCE_TRACE_MCP_CURSOR_SECRET = previousCursorSecret;
    }
  });

  test("rejects unknown or mutation-shaped tools", async () => {
    const server = new TraceMcpJsonRpcServer(new MockTraceReadModel() as unknown as PrivateTraceReadModel);

    const response = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "delete_manifest", arguments: { manifestId: "manifest-1" } },
    });

    expect(response?.error?.message).toContain("Unknown or mutation-shaped tool");
  });
});
