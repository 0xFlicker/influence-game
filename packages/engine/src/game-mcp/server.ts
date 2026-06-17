#!/usr/bin/env bun
import {
  gameMcpGameArtifactUri,
  gameMcpSessionGamesUri,
  gameMcpSessionUri,
  GameMcpReadModel,
  type GameMcpArtifactKind,
  type GameMcpSourceKind,
  type GameMcpSessionStatus,
} from "./read-model";
import type { CanonicalEventQueryMode } from "../canonical-events";
import type { Phase } from "../types";

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

function requiredNumber(args: Record<string, unknown>, key: string): number {
  const value = optionalNumber(args, key);
  if (value === undefined) throw new Error(`${key} is required`);
  return value;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function optionalSearchSources(args: Record<string, unknown>): GameMcpSourceKind[] | undefined {
  const value = args.sources;
  if (!Array.isArray(value)) return undefined;
  return value.filter((source): source is GameMcpSourceKind =>
    source === "events" ||
    source === "turns" ||
    source === "progress" ||
    source === "transcript" ||
    source === "game_json",
  );
}

export class GameMcpJsonRpcServer {
  constructor(private readonly readModel: GameMcpReadModel) {}

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
          resources: {},
          tools: {},
        },
        serverInfo: {
          name: "influence-game-log",
          version: "0.1.0",
        },
        instructions: [
          "Read-only local/producer analysis server for simulation artifacts.",
          "Raw turn logs and game JSON may include producer-visible thinking/reasoningContext; MCP clients in this trusted local analysis context are free to inspect it.",
          "Do not expose this stdio server to untrusted clients or treat search/resource output as player-visible.",
        ].join(" "),
      };
    }

    if (method === "resources/list") {
      const sessions = this.readModel.listSessions();
      return {
        resources: [
          {
            uri: "influence-game://sessions",
            name: "Simulation sessions",
            mimeType: "application/json",
          },
          ...sessions.flatMap((session) => {
            const games = this.readModel.listGames({ sessionId: session.sessionId });
            return [
              {
                uri: gameMcpSessionUri(session.sessionId),
                name: `Simulation session ${session.sessionId}`,
                mimeType: "application/json",
              },
              {
                uri: gameMcpSessionGamesUri(session.sessionId),
                name: `Games in ${session.sessionId}`,
                mimeType: "application/json",
              },
              ...games.flatMap((game) => [
                ...(game.hasEvents
                  ? [{
                      uri: gameMcpGameArtifactUri(game.sessionId, game.gameNumber, "events"),
                      name: `${game.sessionId} game ${game.gameNumber} canonical events`,
                      mimeType: "application/jsonl",
                    }]
                  : []),
                ...(game.hasProjection
                  ? [{
                      uri: gameMcpGameArtifactUri(game.sessionId, game.gameNumber, "projection"),
                      name: `${game.sessionId} game ${game.gameNumber} projection`,
                      mimeType: "application/json",
                    }]
                  : []),
                ...(game.hasTurns
                  ? [{
                      uri: gameMcpGameArtifactUri(game.sessionId, game.gameNumber, "turns"),
                      name: `${game.sessionId} game ${game.gameNumber} turn records`,
                      mimeType: "application/jsonl",
                    }]
                  : []),
                ...(game.hasProgress
                  ? [{
                      uri: gameMcpGameArtifactUri(game.sessionId, game.gameNumber, "progress"),
                      name: `${game.sessionId} game ${game.gameNumber} progress log`,
                      mimeType: "application/jsonl",
                    }]
                  : []),
                ...(game.hasTranscript
                  ? [{
                      uri: gameMcpGameArtifactUri(game.sessionId, game.gameNumber, "transcript"),
                      name: `${game.sessionId} game ${game.gameNumber} text transcript`,
                      mimeType: "text/plain",
                    }]
                  : []),
                ...(game.hasJson
                  ? [{
                      uri: gameMcpGameArtifactUri(game.sessionId, game.gameNumber, "game_json"),
                      name: `${game.sessionId} game ${game.gameNumber} full game JSON`,
                      mimeType: "application/json",
                    }]
                  : []),
              ]),
            ];
          }),
        ],
      };
    }

    if (method === "resources/read") {
      const uri = String(asRecord(params).uri ?? "");
      if (uri === "influence-game://sessions") {
        return {
          contents: [{ uri, mimeType: "application/json", text: JSON.stringify(this.readModel.listSessions(), null, 2) }],
        };
      }

      const sessionMatch = /^influence-game:\/\/sessions\/([^/]+)$/.exec(uri);
      if (sessionMatch?.[1]) {
        const sessionId = decodeURIComponent(sessionMatch[1]);
        return {
          contents: [{ uri, mimeType: "application/json", text: JSON.stringify(this.readModel.readSession(sessionId), null, 2) }],
        };
      }

      const gamesMatch = /^influence-game:\/\/sessions\/([^/]+)\/games$/.exec(uri);
      if (gamesMatch?.[1]) {
        const sessionId = decodeURIComponent(gamesMatch[1]);
        return {
          contents: [{ uri, mimeType: "application/json", text: JSON.stringify(this.readModel.listGames({ sessionId }), null, 2) }],
        };
      }

      const artifactMatch = /^influence-game:\/\/sessions\/([^/]+)\/games\/(\d+)\/(events|projection|turns|progress|transcript|game-json)$/.exec(uri);
      if (!artifactMatch?.[1] || !artifactMatch[2] || !artifactMatch[3]) {
        throw new Error(`Unknown resource URI: ${uri}`);
      }
      const sessionId = decodeURIComponent(artifactMatch[1]);
      const gameNumber = Number.parseInt(artifactMatch[2], 10);
      const artifact = (artifactMatch[3] === "game-json" ? "game_json" : artifactMatch[3]) as GameMcpArtifactKind;
      const game = this.readModel.listGames({ sessionId }).find((candidate) => candidate.gameNumber === gameNumber);
      if (!game) throw new Error(`Unknown game ${gameNumber} in session ${sessionId}`);
      const text = artifact === "events"
        ? this.readModel.readEvents(sessionId, gameNumber).map((event) => JSON.stringify(event)).join("\n")
        : artifact === "turns"
          ? this.readModel.readTurnRecords(sessionId, gameNumber).map((record) => JSON.stringify(record.record)).join("\n")
          : artifact === "progress"
            ? this.readModel.readProgressRecords(sessionId, gameNumber).map((record) => JSON.stringify(record.record)).join("\n")
            : artifact === "transcript"
              ? this.readModel.readTranscript(sessionId, gameNumber)
              : artifact === "game_json"
                ? this.readModel.readGameJson(sessionId, gameNumber)
                : JSON.stringify(this.readModel.readProjection(sessionId, gameNumber), null, 2);
      const mimeType = artifact === "projection" || artifact === "game_json"
        ? "application/json"
        : artifact === "transcript"
          ? "text/plain"
          : "application/jsonl";
      return {
        contents: [{ uri, mimeType, text }],
      };
    }

    if (method === "tools/list") {
      return {
        tools: [
          {
            name: "list_sessions",
            description: "List simulation sessions available in the corpus root.",
            inputSchema: {
              type: "object",
              properties: {
                status: { type: "string", enum: ["running", "completed", "failed", "stale_running", "unknown"] },
                limit: { type: "number" },
              },
            },
          },
          {
            name: "list_games",
            description: "List games across the corpus or inside one simulation session.",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
                withEventsOnly: { type: "boolean" },
              },
            },
          },
          {
            name: "read_projection",
            description: "Replay canonical events and return the current domain projection for one session/game.",
            inputSchema: {
              type: "object",
              properties: { sessionId: { type: "string" }, gameNumber: { type: "number" } },
              required: ["sessionId", "gameNumber"],
            },
          },
          {
            name: "filter_events",
            description: "Filter canonical events by session, game, type, phase, actor, sequence, or visibility mode.",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
                gameNumber: { type: "number" },
                type: { type: "string" },
                phase: { type: "string" },
                actorId: { type: "string" },
                visibilityMode: { type: "string", enum: ["public", "player", "producer"] },
                sinceSequence: { type: "number" },
                limit: { type: "number" },
              },
            },
          },
          {
            name: "player_timeline",
            description: "Return canonical events that mention a player id or name within one session/game.",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
                gameNumber: { type: "number" },
                player: { type: "string" },
                visibilityMode: { type: "string", enum: ["public", "player", "producer"] },
                limit: { type: "number" },
              },
              required: ["sessionId", "gameNumber", "player"],
            },
          },
          {
            name: "search_logs",
            description: "Search local producer/debug artifacts across the corpus, including turn logs and full game JSON with producer-visible thinking/reasoningContext that MCP clients may inspect in this trusted local analysis context.",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
                sessionId: { type: "string" },
                gameNumber: { type: "number" },
                sources: {
                  type: "array",
                  items: { type: "string", enum: ["events", "turns", "progress", "transcript", "game_json"] },
                },
                limit: { type: "number" },
              },
              required: ["query"],
            },
          },
          {
            name: "linked_records",
            description: "Return a canonical event and any linked turn records addressed by source pointers.",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
                gameNumber: { type: "number" },
                eventSequence: { type: "number" },
              },
              required: ["sessionId", "gameNumber", "eventSequence"],
            },
          },
        ],
      };
    }

    if (method === "tools/call") {
      const request = asRecord(params);
      const name = String(request.name ?? "");
      const args = asRecord(request.arguments);
      if (name === "list_sessions") {
        return content(this.readModel.listSessions({
          status: optionalString(args, "status") as GameMcpSessionStatus | undefined,
          limit: optionalNumber(args, "limit"),
        }));
      }
      if (name === "list_games") {
        return content(this.readModel.listGames({
          sessionId: optionalString(args, "sessionId"),
          withEventsOnly: optionalBoolean(args, "withEventsOnly"),
        }));
      }
      if (name === "read_projection") {
        return content(this.readModel.readProjectionRecord(requiredString(args, "sessionId"), requiredNumber(args, "gameNumber")));
      }
      if (name === "filter_events") {
        return content(this.readModel.filterEvents({
          sessionId: optionalString(args, "sessionId"),
          gameNumber: optionalNumber(args, "gameNumber"),
          type: optionalString(args, "type"),
          phase: optionalString(args, "phase") as Phase | undefined,
          actorId: optionalString(args, "actorId"),
          visibilityMode: optionalString(args, "visibilityMode") as CanonicalEventQueryMode | undefined,
          sinceSequence: optionalNumber(args, "sinceSequence"),
          limit: optionalNumber(args, "limit"),
        }));
      }
      if (name === "player_timeline") {
        return content(this.readModel.readPlayerTimeline(
          requiredString(args, "sessionId"),
          requiredNumber(args, "gameNumber"),
          requiredString(args, "player"),
          optionalString(args, "visibilityMode") as CanonicalEventQueryMode | undefined,
          optionalNumber(args, "limit"),
        ));
      }
      if (name === "search_logs") {
        return content(this.readModel.searchLogs({
          query: requiredString(args, "query"),
          sessionId: optionalString(args, "sessionId"),
          gameNumber: optionalNumber(args, "gameNumber"),
          sources: optionalSearchSources(args),
          limit: optionalNumber(args, "limit"),
        }));
      }
      if (name === "linked_records") {
        return content(this.readModel.readLinkedRecords(
          requiredString(args, "sessionId"),
          requiredNumber(args, "gameNumber"),
          requiredNumber(args, "eventSequence"),
        ));
      }
      throw new Error(`Unknown or mutation-shaped tool is not supported: ${name}`);
    }

    throw new Error(`Unsupported MCP method: ${method}`);
  }
}

export function createGameMcpServer(simulationsRoot: string): GameMcpJsonRpcServer {
  return new GameMcpJsonRpcServer(new GameMcpReadModel(simulationsRoot));
}

export async function runStdioGameMcpServer(simulationsRoot: string): Promise<void> {
  const server = createGameMcpServer(simulationsRoot);
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
  const simulationsRoot = process.argv[2];
  if (!simulationsRoot) {
    console.error("Usage: bun run src/game-mcp/server.ts <simulations-root-or-batch-dir>");
    process.exit(1);
  }
  runStdioGameMcpServer(simulationsRoot).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
