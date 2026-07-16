import { describe, expect, test } from "bun:test";
import { TraceMcpJsonRpcServer } from "../trace-mcp/server.js";
import type { PrivateTraceReadModel } from "../trace-mcp/read-model.js";

function parseToolContent(result: unknown): unknown {
  const record = result as { content?: Array<{ type: "text"; text: string }> };
  const text = record.content?.[0]?.text;
  if (!text) throw new Error("missing tool text content");
  return JSON.parse(text) as unknown;
}

class MockTraceReadModel {
  calls: Array<{ name: string; args: unknown }> = [];

  async listDurableRuns(limit?: number) {
    this.calls.push({ name: "listDurableRuns", args: { limit } });
    return [{ id: "game-1", status: "completed", traceManifestCount: 1 }];
  }

  async inspectDurableRun(gameIdOrSlug: string) {
    this.calls.push({ name: "inspectDurableRun", args: { gameIdOrSlug } });
    return { schemaVersion: 2, game: { id: gameIdOrSlug } };
  }

  async listManifests(gameIdOrSlug: string, limit?: number) {
    this.calls.push({ name: "listManifests", args: { gameIdOrSlug, limit } });
    return {
      gameId: gameIdOrSlug,
      totalCount: 1,
      manifests: [{ id: "manifest-1", gameId: gameIdOrSlug, action: "vote" }],
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
    const tools = (response?.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
    expect(tools).toEqual([
      "list_durable_runs",
      "inspect_durable_run",
      "list_manifests",
      "read_content",
      "search_reasoning_traces",
    ]);
    expect(JSON.stringify(tools)).not.toContain("retry");
    expect(JSON.stringify(tools)).not.toContain("resume");
    expect(JSON.stringify(tools)).not.toContain("restart");
    expect(JSON.stringify(response?.result)).not.toContain("maxBytesPerObject");
    expect(JSON.stringify(response?.result)).toContain("maxBytes");
  });

  test("routes trace tools to the read model", async () => {
    const readModel = new MockTraceReadModel();
    const server = new TraceMcpJsonRpcServer(readModel as unknown as PrivateTraceReadModel);

    const list = await server.handle({
      jsonrpc: "2.0",
      id: "list",
      method: "tools/call",
      params: { name: "list_manifests", arguments: { gameIdOrSlug: "game-1", limit: 5 } },
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
    expect(parseToolContent(read?.result)).toMatchObject({ ok: true });
    expect(parseToolContent(search?.result)).toMatchObject({ matches: [{ manifestId: "manifest-1" }] });
    expect(readModel.calls.map((call) => call.name)).toEqual([
      "listManifests",
      "readContent",
      "searchReasoningTraces",
    ]);
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
