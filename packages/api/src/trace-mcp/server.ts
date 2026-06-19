#!/usr/bin/env bun
import { createDB } from "../db/index.js";
import { PrivateTraceReadModel } from "./read-model.js";

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function content(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export class TraceMcpJsonRpcServer {
  constructor(private readonly readModel: PrivateTraceReadModel) {}

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (request.id === undefined) {
      return null;
    }

    try {
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: await this.route(request.method, request.params),
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async route(method: string, params: unknown): Promise<unknown> {
    if (method === "initialize") {
      return {
        protocolVersion: "2025-06-18",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "influence-trace-local",
          version: "0.1.0",
        },
        instructions: [
          "Read-only local/producer analysis server for API durable-run private traces.",
          "This stdio server uses local repo environment/database credentials and is not a product/admin MCP endpoint.",
          "Use list_manifests for metadata, read_content for explicit raw trace reads, and keep output local to trusted producer tooling.",
        ].join(" "),
      };
    }

    if (method === "tools/list") {
      return {
        tools: [
          {
            name: "list_durable_runs",
            description: "List recent API durable runs with private trace manifest counts.",
            inputSchema: {
              type: "object",
              properties: {
                limit: { type: "number" },
              },
            },
          },
          {
            name: "inspect_durable_run",
            description: "Return the sanitized durable-run inspection summary for one game id or slug.",
            inputSchema: {
              type: "object",
              properties: {
                gameIdOrSlug: { type: "string" },
              },
              required: ["gameIdOrSlug"],
            },
          },
          {
            name: "list_manifests",
            description: "List private trace manifests for one game id or slug without returning raw trace content.",
            inputSchema: {
              type: "object",
              properties: {
                gameIdOrSlug: { type: "string" },
                limit: { type: "number" },
              },
              required: ["gameIdOrSlug"],
            },
          },
          {
            name: "read_content",
            description: "Read raw private trace JSON/JSONL content for a selected manifest through the evidence access path.",
            inputSchema: {
              type: "object",
              properties: {
                manifestId: { type: "string" },
                gameId: { type: "string" },
                purpose: { type: "string" },
                maxBytes: { type: "number" },
              },
              required: ["manifestId"],
            },
          },
          {
            name: "search_reasoning_traces",
            description: "Search private trace content inside one durable run, bounded by manifest filters and result limits.",
            inputSchema: {
              type: "object",
              properties: {
                gameIdOrSlug: { type: "string" },
                query: { type: "string" },
                actor: { type: "string" },
                action: { type: "string" },
                phase: { type: "string" },
                limit: { type: "number" },
                maxBytes: { type: "number" },
              },
              required: ["gameIdOrSlug", "query"],
            },
          },
        ],
      };
    }

    if (method === "tools/call") {
      const request = asRecord(params);
      const name = String(request.name ?? "");
      const args = asRecord(request.arguments);

      if (name === "list_durable_runs") {
        return content(await this.readModel.listDurableRuns(optionalNumber(args, "limit")));
      }
      if (name === "inspect_durable_run") {
        return content(await this.readModel.inspectDurableRun(requiredString(args, "gameIdOrSlug")));
      }
      if (name === "list_manifests") {
        return content(await this.readModel.listManifests(
          requiredString(args, "gameIdOrSlug"),
          optionalNumber(args, "limit"),
        ));
      }
      if (name === "read_content") {
        return content(await this.readModel.readContent(requiredString(args, "manifestId"), {
          gameId: optionalString(args, "gameId"),
          purpose: optionalString(args, "purpose") ?? "local_trace_mcp_read_content",
          maxBytes: optionalNumber(args, "maxBytes"),
        }));
      }
      if (name === "search_reasoning_traces") {
        return content(await this.readModel.searchReasoningTraces({
          gameIdOrSlug: requiredString(args, "gameIdOrSlug"),
          query: requiredString(args, "query"),
          actor: optionalString(args, "actor"),
          action: optionalString(args, "action"),
          phase: optionalString(args, "phase"),
          limit: optionalNumber(args, "limit"),
          maxBytes: optionalNumber(args, "maxBytes"),
        }));
      }
      throw new Error(`Unknown or mutation-shaped tool is not supported: ${name}`);
    }

    throw new Error(`Unsupported MCP method: ${method}`);
  }
}

export function createTraceMcpServer(): TraceMcpJsonRpcServer {
  return new TraceMcpJsonRpcServer(new PrivateTraceReadModel(createDB()));
}

export async function runStdioTraceMcpServer(): Promise<void> {
  const server = createTraceMcpServer();
  let buffer = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        let request: JsonRpcRequest;
        try {
          request = JSON.parse(line) as JsonRpcRequest;
        } catch {
          const response: JsonRpcResponse = {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          };
          process.stdout.write(`${JSON.stringify(response)}\n`);
          newlineIndex = buffer.indexOf("\n");
          continue;
        }
        const response = await server.handle(request);
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }
}

if (import.meta.main) {
  runStdioTraceMcpServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
