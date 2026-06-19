import { createDB, type DrizzleDB } from "../db/index.js";
import type { McpOAuthScope } from "../services/mcp-oauth.js";
import type { GameMcpAuthContext } from "./auth.js";
import {
  ProductionGameMcpReadModel,
  type ProductionGameMcpEventFilter,
  type ProductionGameMcpPlayerTimelineOptions,
  type ProductionGameMcpRoundFactsOptions,
} from "./read-model.js";
import type { CanonicalEventQueryMode } from "@influence/engine";
import type {
  CognitiveArtifactActorRole,
  CognitiveArtifactType,
} from "../db/schema.js";

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

function oauthSecurityScheme(scope: McpOAuthScope) {
  return {
    type: "oauth2",
    scopes: [scope],
  };
}

export class ProductionGameMcpJsonRpcServer {
  constructor(private readonly readModel: ProductionGameMcpReadModel) {}

  async handle(
    request: JsonRpcRequest,
    auth: GameMcpAuthContext,
  ): Promise<JsonRpcResponse | null> {
    if (request.id === undefined) {
      return null;
    }

    try {
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: await this.route(request.method, request.params, auth),
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

  private async route(
    method: string,
    params: unknown,
    auth: GameMcpAuthContext,
  ): Promise<unknown> {
    const isProducer = auth.authProfile === "producer_mcp";
    if (method === "initialize") {
      return {
        protocolVersion: "2025-06-18",
        capabilities: {
          resources: {},
          tools: {},
        },
        serverInfo: {
          name: "influence-game-production",
          version: "0.1.0",
        },
        instructions: isProducer
          ? [
              "Read-only deployed producer inspection server for Influence games.",
              "A valid OAuth bearer token with scope=mcp grants global access to the wired producer MCP tools.",
              "Developer evidence and producer-visible private reasoning are available through explicit private trace tools.",
            ].join(" ")
          : [
              "Read-only user-facing MCP server for Influence games.",
              "A valid OAuth bearer token with scope=games grants access to games you created or joined and your player/agent records.",
              "Developer evidence and private trace tools are not available on this resource.",
            ].join(" "),
      };
    }

    if (method === "resources/list") {
      return {
        resources: [
          {
            uri: "influence-game://deployed/games",
            name: isProducer ? "Deployed Influence games" : "Your Influence games",
            mimeType: "application/json",
          },
        ],
      };
    }

    if (method === "resources/read") {
      const uri = String(asRecord(params).uri ?? "");
      if (uri !== "influence-game://deployed/games") {
        throw new Error(`Unknown resource URI: ${uri}`);
      }
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify(await this.readModel.listGames(auth), null, 2),
        }],
      };
    }

    if (method === "tools/list") {
      return { tools: productionGameMcpTools(auth.scope, isProducer) };
    }

    if (method === "tools/call") {
      const request = asRecord(params);
      const name = String(request.name ?? "");
      const args = asRecord(request.arguments);

      if (name === "list_games") {
        return content(await this.readModel.listGames(auth, optionalNumber(args, "limit")));
      }
      if (name === "read_projection") {
        return content(await this.readModel.readProjection(requiredString(args, "gameIdOrSlug"), auth));
      }
      if (name === "read_round_facts") {
        return content(await this.readModel.readRoundFacts(roundFactsArgs(args), auth));
      }
      if (name === "filter_events") {
        return content(await this.readModel.filterEvents(eventFilterArgs(args), auth));
      }
      if (name === "player_timeline") {
        return content(await this.readModel.playerTimeline(playerTimelineArgs(args), auth));
      }
      if (name === "list_cognitive_artifacts") {
        return content(await this.readModel.listCognitiveArtifacts(cognitiveArtifactListArgs(args), auth));
      }
      if (name === "read_cognitive_artifact") {
        return content(await this.readModel.readCognitiveArtifact(cognitiveArtifactReadArgs(args), auth));
      }
      if (!isProducer) {
        throw new Error(`Unknown or producer-only tool is not supported for scope=games: ${name}`);
      }
      if (name === "inspect_durable_run") {
        return content(await this.readModel.inspectDurableRun(requiredString(args, "gameIdOrSlug"), auth));
      }
      if (name === "list_trace_manifests") {
        return content(await this.readModel.listTraceManifests(
          requiredString(args, "gameIdOrSlug"),
          auth,
          optionalNumber(args, "limit"),
        ));
      }
      if (name === "read_trace_content") {
        return content(await this.readModel.readTraceContent({
          manifestId: requiredString(args, "manifestId"),
          gameId: optionalString(args, "gameId"),
          purpose: optionalString(args, "purpose"),
          maxBytes: optionalNumber(args, "maxBytes"),
        }, auth));
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
        }, auth));
      }

      throw new Error(`Unknown or mutation-shaped tool is not supported: ${name}`);
    }

    throw new Error(`Unsupported MCP method: ${method}`);
  }
}

export function createProductionGameMcpServer(
  db: DrizzleDB = createDB(),
): ProductionGameMcpJsonRpcServer {
  return new ProductionGameMcpJsonRpcServer(new ProductionGameMcpReadModel(db));
}

function productionGameMcpTools(scope: McpOAuthScope, includeProducerTools: boolean): unknown[] {
  const tools = [
    tool({
      name: "list_games",
      description: includeProducerTools
        ? "List recent deployed games with event-log and projection status."
        : "List your Influence games with event-log and projection status.",
      properties: {
        limit: { type: "number" },
      },
      scope,
    }),
    tool({
      name: "read_projection",
      description: "Replay persisted canonical events into the projection summary for one accessible game ID or slug.",
      properties: {
        gameIdOrSlug: { type: "string" },
      },
      required: ["gameIdOrSlug"],
      scope,
    }),
    tool({
      name: "read_round_facts",
      description: includeProducerTools
        ? "Read sanitized revealed vote, power, Council, and player-status facts for one deployed game round without private trace content or raw canonical envelopes."
        : "Read sanitized revealed vote, power, Council, and player-status facts for one accessible game round.",
      properties: {
        gameIdOrSlug: { type: "string" },
        round: { type: "number" },
      },
      required: ["gameIdOrSlug"],
      scope,
    }),
    tool({
      name: "filter_events",
      description: includeProducerTools
        ? "Filter persisted canonical events by game, type, phase, actor, sequence range, visibility mode, or limit."
        : "Filter player-visible canonical events by game, type, phase, actor, sequence range, or limit.",
      properties: {
        gameIdOrSlug: { type: "string" },
        eventType: { type: "string" },
        phase: { type: "string" },
        actor: { type: "string" },
        visibilityMode: {
          type: "string",
          enum: includeProducerTools ? ["public", "player", "producer"] : ["public", "player"],
        },
        fromSequence: { type: "number" },
        toSequence: { type: "number" },
        limit: { type: "number" },
      },
      required: ["gameIdOrSlug"],
      scope,
    }),
    tool({
      name: "player_timeline",
      description: includeProducerTools
        ? "Return canonical events that mention a player ID or name."
        : "Return player-visible canonical events that mention a player ID or name in an accessible game.",
      properties: {
        gameIdOrSlug: { type: "string" },
        player: { type: "string" },
        visibilityMode: {
          type: "string",
          enum: includeProducerTools ? ["public", "player", "producer"] : ["public", "player"],
        },
        limit: { type: "number" },
      },
      required: ["gameIdOrSlug", "player"],
      scope,
    }),
    tool({
      name: "list_cognitive_artifacts",
      description: includeProducerTools
        ? "List split reasoning, thinking, and strategy artifact metadata for one deployed game without returning payload bodies."
        : "List authorized reasoning, thinking, and strategy artifact metadata for one game you participated in.",
      properties: {
        gameIdOrSlug: { type: "string" },
        artifactType: { type: "string", enum: ["reasoning", "thinking", "strategy"] },
        actorPlayerId: { type: "string" },
        limit: { type: "number" },
      },
      required: ["gameIdOrSlug"],
      scope,
    }),
    tool({
      name: "read_cognitive_artifact",
      description: includeProducerTools
        ? "Read one authorized split cognitive artifact payload, or producer diagnostics for unavailable split artifacts."
        : "Read one authorized split cognitive artifact payload by game, artifact id, artifact type, and actor player id. Reasoning is owner-only; thinking and strategy are participant-visible.",
      properties: {
        gameIdOrSlug: { type: "string" },
        artifactId: { type: "string" },
        artifactType: { type: "string", enum: ["reasoning", "thinking", "strategy"] },
        actorRole: { type: "string", enum: ["player", "juror", "house", "system", "producer"] },
        actorPlayerId: { type: "string" },
        purpose: { type: "string" },
      },
      required: includeProducerTools
        ? ["gameIdOrSlug", "artifactId"]
        : ["gameIdOrSlug", "artifactId", "artifactType", "actorPlayerId"],
      scope,
    }),
  ];
  if (!includeProducerTools) return tools;
  return [
    ...tools,
    tool({
      name: "inspect_durable_run",
      description: "Return the durable-run inspection summary for one game ID or slug.",
      properties: {
        gameIdOrSlug: { type: "string" },
      },
      required: ["gameIdOrSlug"],
      scope,
    }),
    tool({
      name: "list_trace_manifests",
      description: "List private trace manifests for one game without returning raw trace content.",
      properties: {
        gameIdOrSlug: { type: "string" },
        limit: { type: "number" },
      },
      required: ["gameIdOrSlug"],
      scope,
    }),
    tool({
      name: "read_trace_content",
      description: "Read raw private trace content for an explicit manifest ID through the evidence access path.",
      properties: {
        manifestId: { type: "string" },
        gameId: { type: "string" },
        purpose: { type: "string" },
        maxBytes: { type: "number" },
      },
      required: ["manifestId"],
      scope,
    }),
    tool({
      name: "search_reasoning_traces",
      description: "Search bounded private reasoning trace previews inside one deployed game.",
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
      scope,
    }),
  ];
}

function tool(input: {
  name: string;
  description: string;
  properties: Record<string, unknown>;
  required?: string[];
  scope: McpOAuthScope;
}): unknown {
  const securityScheme = oauthSecurityScheme(input.scope);
  return {
    name: input.name,
    description: input.description,
    inputSchema: {
      type: "object",
      properties: input.properties,
      ...(input.required && { required: input.required }),
    },
    securitySchemes: [securityScheme],
    _meta: {
      securitySchemes: [securityScheme],
    },
  };
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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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

function optionalVisibilityMode(args: Record<string, unknown>): CanonicalEventQueryMode | undefined {
  const value = optionalString(args, "visibilityMode");
  return value === "public" || value === "player" || value === "producer"
    ? value
    : undefined;
}

function eventFilterArgs(args: Record<string, unknown>): ProductionGameMcpEventFilter {
  return {
    gameIdOrSlug: requiredString(args, "gameIdOrSlug"),
    eventType: optionalString(args, "eventType"),
    phase: optionalString(args, "phase"),
    actor: optionalString(args, "actor"),
    visibilityMode: optionalVisibilityMode(args),
    fromSequence: optionalNumber(args, "fromSequence"),
    toSequence: optionalNumber(args, "toSequence"),
    limit: optionalNumber(args, "limit"),
  };
}

function playerTimelineArgs(args: Record<string, unknown>): ProductionGameMcpPlayerTimelineOptions {
  return {
    gameIdOrSlug: requiredString(args, "gameIdOrSlug"),
    player: requiredString(args, "player"),
    visibilityMode: optionalVisibilityMode(args),
    limit: optionalNumber(args, "limit"),
  };
}

function roundFactsArgs(args: Record<string, unknown>): ProductionGameMcpRoundFactsOptions {
  return {
    gameIdOrSlug: requiredString(args, "gameIdOrSlug"),
    round: optionalNumber(args, "round"),
  };
}

function optionalCognitiveArtifactType(args: Record<string, unknown>): CognitiveArtifactType | undefined {
  const value = optionalString(args, "artifactType");
  return value === "reasoning" || value === "thinking" || value === "strategy"
    ? value
    : undefined;
}

function optionalCognitiveActorRole(args: Record<string, unknown>): CognitiveArtifactActorRole | undefined {
  const value = optionalString(args, "actorRole");
  return value === "player" ||
    value === "juror" ||
    value === "house" ||
    value === "system" ||
    value === "producer"
    ? value
    : undefined;
}

function cognitiveArtifactListArgs(args: Record<string, unknown>) {
  return {
    gameIdOrSlug: requiredString(args, "gameIdOrSlug"),
    artifactType: optionalCognitiveArtifactType(args),
    actorPlayerId: optionalString(args, "actorPlayerId"),
    limit: optionalNumber(args, "limit"),
  };
}

function cognitiveArtifactReadArgs(args: Record<string, unknown>) {
  return {
    gameIdOrSlug: requiredString(args, "gameIdOrSlug"),
    artifactId: requiredString(args, "artifactId"),
    artifactType: optionalCognitiveArtifactType(args),
    actorRole: optionalCognitiveActorRole(args),
    actorPlayerId: optionalString(args, "actorPlayerId"),
    purpose: optionalString(args, "purpose"),
  };
}
