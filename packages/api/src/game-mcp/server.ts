import { createDB, type DrizzleDB } from "../db/index.js";
import type { GameMcpAuthContext } from "./auth.js";
import type { McpOAuthScope } from "../services/mcp-scope-policy.js";
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
import {
  INFLUENCE_MCP_APP_RESOURCE_URI,
  createInfluenceMcpAppResource,
  createInfluenceMcpAppResourceContent,
  createInfluenceMcpAppToolMeta,
} from "./app-resource.js";
import {
  getGameMcpRules,
  listGameMcpArchetypes,
  searchGameMcpRules,
} from "./rules.js";
import { USER_SELECTABLE_AGENT_ARCHETYPE_KEYS } from "../services/agent-archetypes.js";
import {
  AgentProfileManagementError,
  createOwnedAgent,
  getOwnedAgent,
  listOwnedAgents,
  searchOwnedAgents,
  updateOwnedAgent,
} from "../services/agent-profile-management.js";
import {
  QueueEnrollmentError,
  getQueueStatus,
  joinQueue,
  leaveQueue,
  listOpenGames,
} from "../services/queue-enrollment.js";

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
  error?: { code: number; message: string; data?: unknown };
}

function oauthSecurityScheme(scopes: readonly McpOAuthScope[]) {
  return {
    type: "oauth2",
    scopes,
  };
}

export class ProductionGameMcpJsonRpcServer {
  constructor(
    private readonly readModel: ProductionGameMcpReadModel,
    private readonly db?: DrizzleDB,
  ) {}

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
          ...jsonRpcErrorData(error),
        },
      };
    }
  }

  private async route(
    method: string,
    params: unknown,
    auth: GameMcpAuthContext,
  ): Promise<unknown> {
    const isProducer = hasScope(auth, "producer");
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
        instructions: [
          "Influence MCP server for agent management, pre-match enrollment, game inspection, and producer diagnostics.",
          `Granted OAuth scopes: ${auth.scope}.`,
          "agents:read allows owned-agent and queue context; agents:write allows agent changes and supported pre-match enrollment; games:read allows accessible game inspection; producer allows global developer/private trace inspection.",
          "This server must not be used for active-match actions such as voting, Mingle/lobby messages, diary-room actions, timers, phase controls, Council, power, or moderator actions.",
        ].join(" "),
      };
    }

    if (method === "resources/list") {
      const resources = canReadGames(auth)
        ? [
            {
              uri: "influence-game://deployed/games",
              name: isProducer ? "Deployed Influence games" : "Your Influence games",
              mimeType: "application/json",
            },
          ]
        : [];
      return {
        resources: isProducer || !hasScope(auth, "games:read")
          ? resources
          : [...resources, createInfluenceMcpAppResource()],
      };
    }

    if (method === "resources/read") {
      const uri = String(asRecord(params).uri ?? "");
      if (!isProducer && uri === INFLUENCE_MCP_APP_RESOURCE_URI) {
        requireScopes(auth, ["games:read"]);
        return {
          contents: [createInfluenceMcpAppResourceContent()],
        };
      }
      if (uri !== "influence-game://deployed/games") {
        throw new Error(`Unknown resource URI: ${uri}`);
      }
      requireAnyScope(auth, ["games:read", "producer"]);
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify(await this.readModel.listGames(auth), null, 2),
        }],
      };
    }

    if (method === "tools/list") {
      return { tools: productionGameMcpTools(auth) };
    }

    if (method === "tools/call") {
      const request = asRecord(params);
      const name = String(request.name ?? "");
      const args = asRecord(request.arguments);

      if (name === "list_games") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return content(await this.readModel.listGames(auth, optionalNumber(args, "limit")));
      }
      if (name === "read_projection") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return content(await this.readModel.readProjection(requiredString(args, "gameIdOrSlug"), auth));
      }
      if (name === "read_round_facts") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return content(await this.readModel.readRoundFacts(roundFactsArgs(args), auth));
      }
      if (name === "filter_events") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return content(await this.readModel.filterEvents(eventFilterArgs(args), auth));
      }
      if (name === "player_timeline") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return content(await this.readModel.playerTimeline(playerTimelineArgs(args), auth));
      }
      if (name === "list_cognitive_artifacts") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return content(await this.readModel.listCognitiveArtifacts(cognitiveArtifactListArgs(args), auth));
      }
      if (name === "read_cognitive_artifact") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return content(await this.readModel.readCognitiveArtifact(cognitiveArtifactReadArgs(args), auth));
      }
      if (name === "get_rules") {
        requireScopes(auth, ["games:read"]);
        return content(getGameMcpRules());
      }
      if (name === "search_rules") {
        requireScopes(auth, ["games:read"]);
        return content(searchGameMcpRules({
          query: requiredString(args, "query"),
          limit: optionalNumber(args, "limit"),
        }));
      }
      if (name === "list_archetypes") {
        requireScopes(auth, ["agents:read"]);
        return content(listGameMcpArchetypes({
          includeStrategyHints: optionalBoolean(args, "includeStrategyHints"),
        }));
      }
      if (name === "list_agents") {
        requireScopes(auth, ["agents:read"]);
        const db = this.requireManagementDb();
        return content(await listOwnedAgents(db, {
          ...mcpManagementContext(auth),
          limit: optionalNumber(args, "limit"),
        }));
      }
      if (name === "get_agent") {
        requireScopes(auth, ["agents:read"]);
        const db = this.requireManagementDb();
        return content(await getOwnedAgent(db, {
          ...mcpManagementContext(auth),
          agentId: requiredString(args, "agentId"),
        }));
      }
      if (name === "search_agents") {
        requireScopes(auth, ["agents:read"]);
        const db = this.requireManagementDb();
        return content(await searchOwnedAgents(db, {
          ...mcpManagementContext(auth),
          query: requiredString(args, "query"),
          limit: optionalNumber(args, "limit"),
        }));
      }
      if (name === "get_queue_status") {
        requireScopes(auth, ["agents:read"]);
        const db = this.requireManagementDb();
        return content(await getQueueStatus(db, mcpManagementContext(auth), args));
      }
      if (name === "list_open_games") {
        requireScopes(auth, ["agents:read"]);
        const db = this.requireManagementDb();
        return content(await listOpenGames(db, args));
      }
      if (name === "create_agent") {
        requireScopes(auth, ["agents:read", "agents:write"]);
        const db = this.requireManagementDb();
        return content(await createOwnedAgent(db, mcpManagementContext(auth), args));
      }
      if (name === "update_agent") {
        requireScopes(auth, ["agents:read", "agents:write"]);
        const db = this.requireManagementDb();
        return content(await updateOwnedAgent(db, mcpManagementContext(auth), args));
      }
      if (name === "join_queue") {
        requireScopes(auth, ["agents:read", "agents:write"]);
        const db = this.requireManagementDb();
        return content(await joinQueue(db, mcpManagementContext(auth), args));
      }
      if (name === "leave_queue") {
        requireScopes(auth, ["agents:read", "agents:write"]);
        const db = this.requireManagementDb();
        return content(await leaveQueue(db, mcpManagementContext(auth), args));
      }
      if (name === "inspect_durable_run") {
        requireScopes(auth, ["producer"]);
        return content(await this.readModel.inspectDurableRun(requiredString(args, "gameIdOrSlug"), auth));
      }
      if (name === "list_trace_manifests") {
        requireScopes(auth, ["producer"]);
        return content(await this.readModel.listTraceManifests(
          requiredString(args, "gameIdOrSlug"),
          auth,
          optionalNumber(args, "limit"),
        ));
      }
      if (name === "read_trace_content") {
        requireScopes(auth, ["producer"]);
        return content(await this.readModel.readTraceContent({
          manifestId: requiredString(args, "manifestId"),
          gameId: optionalString(args, "gameId"),
          purpose: optionalString(args, "purpose"),
          maxBytes: optionalNumber(args, "maxBytes"),
        }, auth));
      }
      if (name === "search_reasoning_traces") {
        requireScopes(auth, ["producer"]);
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

      throw new Error(`Unknown or unauthorized MCP tool is not supported for granted scopes: ${name}`);
    }

    throw new Error(`Unsupported MCP method: ${method}`);
  }

  private requireManagementDb(): DrizzleDB {
    if (!this.db) {
      throw new Error("MCP management tools require a database connection");
    }
    return this.db;
  }
}

export function createProductionGameMcpServer(
  db: DrizzleDB = createDB(),
): ProductionGameMcpJsonRpcServer {
  return new ProductionGameMcpJsonRpcServer(new ProductionGameMcpReadModel(db), db);
}

function hasScope(auth: GameMcpAuthContext, scope: McpOAuthScope): boolean {
  return auth.scopes.includes(scope);
}

function canReadGames(auth: GameMcpAuthContext): boolean {
  return hasScope(auth, "games:read") || hasScope(auth, "producer");
}

function requireScopes(auth: GameMcpAuthContext, requiredScopes: readonly McpOAuthScope[]): void {
  const missing = requiredScopes.find((scope) => !hasScope(auth, scope));
  if (missing) {
    throw new Error(`Missing required MCP scope: ${missing}`);
  }
}

function requireAnyScope(auth: GameMcpAuthContext, requiredScopes: readonly McpOAuthScope[]): void {
  if (!requiredScopes.some((scope) => hasScope(auth, scope))) {
    throw new Error(`Missing required MCP scope: ${requiredScopes.join(" or ")}`);
  }
}

function productionGameMcpTools(auth: GameMcpAuthContext): unknown[] {
  const includeProducerTools = hasScope(auth, "producer");
  const tools: unknown[] = [];

  if (canReadGames(auth)) {
    const gameReadScopes: McpOAuthScope[] = includeProducerTools ? ["producer"] : ["games:read"];
    tools.push(
    tool({
      name: "list_games",
      description: includeProducerTools
        ? "List recent deployed games with event-log and projection status."
        : "List your Influence games with event-log and projection status. Call for game inspection, not for active-match actions.",
      properties: {
        limit: { type: "number" },
      },
      scopes: gameReadScopes,
      readOnlyHint: true,
      appMeta: includeProducerTools ? undefined : createInfluenceMcpAppToolMeta(),
    }),
    tool({
      name: "read_projection",
      description: "Replay persisted canonical events into the projection summary for one accessible game ID or slug.",
      properties: {
        gameIdOrSlug: { type: "string" },
      },
      required: ["gameIdOrSlug"],
      scopes: gameReadScopes,
      readOnlyHint: true,
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
      scopes: gameReadScopes,
      readOnlyHint: true,
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
      scopes: gameReadScopes,
      readOnlyHint: true,
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
      scopes: gameReadScopes,
      readOnlyHint: true,
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
      scopes: gameReadScopes,
      readOnlyHint: true,
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
      scopes: gameReadScopes,
      readOnlyHint: true,
    }),
    );
  }

  if (hasScope(auth, "games:read")) {
    tools.push(...gameRulesTools());
  }
  if (hasScope(auth, "agents:read")) {
    tools.push(...userAgentReadTools());
  }
  if (hasScope(auth, "agents:write")) {
    tools.push(...userAgentWriteTools());
  }
  if (!includeProducerTools) {
    return tools;
  }
  return [
    ...tools,
    tool({
      name: "inspect_durable_run",
      description: "Return the durable-run inspection summary for one game ID or slug.",
      properties: {
        gameIdOrSlug: { type: "string" },
      },
      required: ["gameIdOrSlug"],
      scopes: ["producer"],
      readOnlyHint: true,
    }),
    tool({
      name: "list_trace_manifests",
      description: "List private trace manifests for one game without returning raw trace content.",
      properties: {
        gameIdOrSlug: { type: "string" },
        limit: { type: "number" },
      },
      required: ["gameIdOrSlug"],
      scopes: ["producer"],
      readOnlyHint: true,
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
      scopes: ["producer"],
      readOnlyHint: true,
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
      scopes: ["producer"],
      readOnlyHint: true,
    }),
  ];
}

function gameRulesTools(): unknown[] {
  return [
    tool({
      name: "get_rules",
      description: "Read Influence gameplay rules, archetypes, free-game basics, rating provenance, and beginner strategy. Call when the user asks how the game works. Do not call for active-match actions. Requires games:read. No side effects.",
      properties: {},
      scopes: ["games:read"],
      readOnlyHint: true,
    }),
    tool({
      name: "search_rules",
      description: "Search Influence rules by topic or keyword. Call for targeted gameplay questions. Do not call to vote, message, use power, or otherwise participate in a live match. Requires games:read. No side effects.",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
      scopes: ["games:read"],
      readOnlyHint: true,
    }),
  ];
}

function userAgentReadTools(): unknown[] {
  return [
    tool({
      name: "list_archetypes",
      description: "List valid user-selectable agent archetypes for create_agent and update_agent, with labels and creation hints. Call before choosing or validating an archetype. Requires agents:read. No side effects.",
      properties: {
        includeStrategyHints: { type: "boolean" },
      },
      scopes: ["agents:read"],
      readOnlyHint: true,
    }),
    tool({
      name: "list_agents",
      description: "List the authenticated user's own reusable agents with prompts, biographies, stats, account-level ELO provenance, queue state, and active enrollment. Call to compare or choose an agent. Requires agents:read. No side effects.",
      properties: {
        limit: { type: "number" },
      },
      scopes: ["agents:read"],
      readOnlyHint: true,
    }),
    tool({
      name: "get_agent",
      description: "Read one owned agent by agentId with rich queue, rating-provenance, and active-enrollment metadata. Call when an agent was already selected. Requires agents:read. No side effects.",
      properties: {
        agentId: { type: "string" },
      },
      required: ["agentId"],
      scopes: ["agents:read"],
      readOnlyHint: true,
    }),
    tool({
      name: "search_agents",
      description: "Search only the authenticated user's agents by name, archetype, biography, personality prompt, or strategy style. Call when the user names or describes an agent. Requires agents:read. No side effects.",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
      scopes: ["agents:read"],
      readOnlyHint: true,
    }),
    tool({
      name: "get_queue_status",
      description: "Inspect supported pre-match queue status, currently daily-free. Call before joining/leaving or to answer whether the user is queued. Do not use for active match status or actions. Requires agents:read. No side effects.",
      properties: {
        queueType: { type: "string", enum: ["daily-free"] },
      },
      scopes: ["agents:read"],
      readOnlyHint: true,
    }),
    tool({
      name: "list_open_games",
      description: "List joinable waiting open games with slots, ruleset metadata, and start estimate. Call before join_queue with queueType=open-game. Requires agents:read. No side effects.",
      properties: {
        limit: { type: "number" },
      },
      scopes: ["agents:read"],
      readOnlyHint: true,
    }),
  ];
}

function userAgentWriteTools(): unknown[] {
  const writeScopes: readonly McpOAuthScope[] = ["agents:read", "agents:write"];
  return [
    tool({
      name: "create_agent",
      description: "Create one owned reusable Influence agent from coarse authoring fields. Call when the user asks to create a new agent. Do not use to create agents for other users or act inside a live match. Requires agents:read and agents:write. Side effect: inserts an agent profile.",
      properties: {
        displayName: { type: "string" },
        archetype: { type: "string", enum: USER_SELECTABLE_AGENT_ARCHETYPE_KEYS },
        personalityPrompt: { type: "string" },
        publicBiography: nullableStringSchema(),
        strategyStyle: nullableStringSchema(),
        avatarUrl: nullableStringSchema(),
      },
      required: ["displayName", "archetype", "personalityPrompt"],
      scopes: writeScopes,
      readOnlyHint: false,
    }),
    tool({
      name: "update_agent",
      description: "Update mutable fields on one owned agent. Call when the user asks to tune an existing agent before enrollment. Do not pass ownership or immutable identifiers other than agentId. Requires agents:read and agents:write. Side effect: updates an agent profile.",
      properties: {
        agentId: { type: "string" },
        displayName: { type: "string" },
        archetype: { anyOf: [{ type: "string", enum: USER_SELECTABLE_AGENT_ARCHETYPE_KEYS }, { type: "null" }] },
        personalityPrompt: { type: "string" },
        publicBiography: nullableStringSchema(),
        strategyStyle: nullableStringSchema(),
        avatarUrl: nullableStringSchema(),
      },
      required: ["agentId"],
      scopes: writeScopes,
      readOnlyHint: false,
    }),
    tool({
      name: "join_queue",
      description: "Enroll one owned agent into a supported pre-match queue. Use queueType=daily-free for the daily draw, or queueType=open-game with gameIdOrSlug for a waiting open game. Do not use for active-match participation. Requires agents:read and agents:write. Side effect: inserts a queue entry or waiting game player row.",
      properties: {
        queueType: { type: "string", enum: ["daily-free", "open-game"] },
        agentId: { type: "string" },
        gameIdOrSlug: { type: "string" },
      },
      required: ["queueType", "agentId"],
      scopes: writeScopes,
      readOnlyHint: false,
    }),
    tool({
      name: "leave_queue",
      description: "Leave a supported pre-match queue idempotently, currently daily-free. Call when the user asks to remove their queued agent. Do not use for active-match exits or game actions. Requires agents:read and agents:write. Side effect: deletes the daily-free queue entry if present.",
      properties: {
        queueType: { type: "string", enum: ["daily-free"] },
      },
      scopes: writeScopes,
      readOnlyHint: false,
    }),
  ];
}

function tool(input: {
  name: string;
  description: string;
  properties: Record<string, unknown>;
  required?: string[];
  scopes: readonly McpOAuthScope[];
  readOnlyHint: boolean;
  appMeta?: Record<string, unknown>;
}): unknown {
  const securityScheme = oauthSecurityScheme(input.scopes);
  return {
    name: input.name,
    description: input.description,
    inputSchema: {
      type: "object",
      properties: input.properties,
      ...(input.required && { required: input.required }),
    },
    securitySchemes: [securityScheme],
    annotations: {
      readOnlyHint: input.readOnlyHint,
    },
    _meta: {
      securitySchemes: [securityScheme],
      ...input.appMeta,
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

function jsonRpcErrorData(error: unknown): { data?: unknown } {
  if (error instanceof AgentProfileManagementError || error instanceof QueueEnrollmentError) {
    return {
      data: {
        code: error.code,
        statusCode: error.statusCode,
        ...(error.details && { details: error.details }),
      },
    };
  }
  return {};
}

function mcpManagementContext(auth: GameMcpAuthContext): {
  userId: string;
  publicBaseUrl?: string;
} {
  return {
    userId: auth.userId,
    publicBaseUrl: resourceOrigin(auth.resource),
  };
}

function resourceOrigin(resource: string): string | undefined {
  try {
    return new URL(resource).origin;
  } catch {
    return undefined;
  }
}

function nullableStringSchema(): unknown {
  return {
    anyOf: [
      { type: "string" },
      { type: "null" },
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

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
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
