import { createDB, type DrizzleDB } from "../db/index.js";
import type { GameMcpAuthContext } from "./auth.js";
import type { McpOAuthScope } from "../services/mcp-scope-policy.js";
import {
  ProductionGameMcpReadModel,
  type ProductionGameMcpAgentAlliancesOptions,
  type ProductionGameMcpAgentGamesOptions,
  type ProductionGameMcpEventFilter,
  type ProductionGameMcpPlayerTimelineOptions,
  type ProductionGameMcpPlayerGameSummaryOptions,
  type ProductionGameMcpPostgameOptions,
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
import { AGENT_GENDER_VALUES } from "../lib/agent-gender.js";
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
import { agentCommandOutputSchema } from "./agent-tool-schemas.js";

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
          "Before changing an agent, resolve the user's owned Agent Profile with search_agents, list_agents, or get_agent. Use update_agent for any existing owned competitor regardless of enrollment; it preserves identity, career, and season history. Use create_agent only for a distinctly named separate career.",
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
      if (name === "list_seasons") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return content(await this.readModel.listSeasons());
      }
      if (name === "read_season_standings") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return content(await this.readModel.readSeason(requiredString(args, "seasonIdOrSlug")));
      }
      if (name === "read_season_game_receipts") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return content(await this.readModel.readSeasonGameReceipts(
          requiredString(args, "seasonIdOrSlug"),
          requiredString(args, "gameIdOrSlug"),
        ));
      }
      if (name === "list_agent_games") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return postgameContent(await this.readModel.listAgentGames(agentGamesArgs(args), auth));
      }
      if (name === "read_game_brief") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return postgameContent(await this.readModel.readGameBrief(postgameArgs(args), auth));
      }
      if (name === "read_jury_breakdown") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return postgameContent(await this.readModel.readJuryBreakdown(postgameArgs(args, { allowDetailLevel: false }), auth));
      }
      if (name === "read_player_game_summary") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return postgameContent(await this.readModel.readPlayerGameSummary(playerGameSummaryArgs(args), auth));
      }
      if (name === "read_game_turning_points") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return postgameContent(await this.readModel.readGameTurningPoints(postgameArgs(args, { allowDetailLevel: false }), auth));
      }
      if (name === "read_projection") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return content(await this.readModel.readProjection(requiredString(args, "gameIdOrSlug"), auth));
      }
      if (name === "read_round_facts") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return content(await this.readModel.readRoundFacts(roundFactsArgs(args), auth));
      }
      if (name === "read_agent_alliances") {
        requireAnyScope(auth, ["games:read", "producer"]);
        return content(await this.readModel.readAgentAlliances(agentAlliancesArgs(args), auth));
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
      if (name === "read_agent_season") {
        requireScopes(auth, ["agents:read"]);
        return content(await this.readModel.readOwnedAgentSeason(
          requiredString(args, "seasonIdOrSlug"),
          requiredString(args, "agentId"),
          auth,
        ));
      }
      if (name === "export_agent_season_data") {
        requireScopes(auth, ["agents:read"]);
        const format = optionalString(args, "format") ?? "json";
        if (format !== "json" && format !== "csv") throw new Error("format must be json or csv");
        return content(await this.readModel.exportOwnedSeason(
          requiredString(args, "seasonIdOrSlug"),
          format,
          auth,
          optionalNumber(args, "limit"),
          optionalString(args, "agentId"),
        ));
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
        return content(await createOwnedAgent(db, {
          ...mcpManagementContext(auth),
          avatarCompletion: { triggerSource: "mcp_create_default" },
          avatarChangeSource: "mcp_provided_avatar",
        }, args));
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
      if (name === "read_producer_game_analysis") {
        requireScopes(auth, ["producer"]);
        return postgameContent(await this.readModel.readProducerGameAnalysis(postgameArgs(args), auth));
      }
      if (name === "read_producer_season_diagnostics") {
        requireScopes(auth, ["producer"]);
        return content(await this.readModel.readProducerSeasonDiagnostics(
          requiredString(args, "seasonIdOrSlug"),
        ));
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
      name: "list_seasons",
      description: "List Influence championship seasons and their public status.",
      properties: {},
      scopes: gameReadScopes,
      readOnlyHint: true,
    }),
    tool({
      name: "read_season_standings",
      description: "Read receipt-derived Agent and Architect standings for one season.",
      properties: { seasonIdOrSlug: { type: "string" } },
      required: ["seasonIdOrSlug"],
      scopes: gameReadScopes,
      readOnlyHint: true,
    }),
    tool({
      name: "read_season_game_receipts",
      description: "Read public point receipts for one game in a championship season.",
      properties: {
        seasonIdOrSlug: { type: "string" },
        gameIdOrSlug: { type: "string" },
      },
      required: ["seasonIdOrSlug", "gameIdOrSlug"],
      scopes: gameReadScopes,
      readOnlyHint: true,
    }),
    tool({
      name: "list_agent_games",
      description: "List completed games played by one owned or visible Influence agent. Requires agentId or agentName.",
      inputSchema: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          agentName: { type: "string" },
          limit: { type: "number" },
        },
        oneOf: [
          { required: ["agentId"] },
          { required: ["agentName"] },
        ],
      },
      scopes: gameReadScopes,
      readOnlyHint: true,
      outputSchema: postgameOutputSchema("agentGames"),
    }),
    tool({
      name: "read_game_brief",
      description: "Read a compact postgame brief for one completed game: executive summary, winner, finalists, final vote, boot order, round summaries, derived vote cohorts, highlighted eliminations, momentum, turning points, and diagnostics.",
      properties: {
        gameIdOrSlug: { type: "string" },
        detailLevel: { type: "string", enum: ["brief", "standard", "full"] },
        includeEvidence: { type: "boolean" },
      },
      required: ["gameIdOrSlug"],
      scopes: gameReadScopes,
      readOnlyHint: true,
      outputSchema: postgameOutputSchema("gameBrief"),
    }),
    tool({
      name: "read_jury_breakdown",
      description: "Read finalist vote counts and per-juror final votes for one completed game, with deterministic relationship flags where derivable.",
      properties: {
        gameIdOrSlug: { type: "string" },
        includeEvidence: { type: "boolean" },
      },
      required: ["gameIdOrSlug"],
      scopes: gameReadScopes,
      readOnlyHint: true,
      outputSchema: postgameOutputSchema("juryBreakdown"),
    }),
    tool({
      name: "read_player_game_summary",
      description: "Read one player's compact full-game arc: placement, votes cast and received by round, majority alignment, risk moments, endgame facts, jury facts, and readable summary.",
      properties: {
        gameIdOrSlug: { type: "string" },
        player: { type: "string" },
        includeEvidence: { type: "boolean" },
      },
      required: ["gameIdOrSlug", "player"],
      scopes: gameReadScopes,
      readOnlyHint: true,
      outputSchema: postgameOutputSchema("playerSummary"),
    }),
    tool({
      name: "read_game_turning_points",
      description: "Read deterministic turning points for one completed game, with type enums, players involved, evidence refs when requested, confidence, and generated-safe descriptions.",
      properties: {
        gameIdOrSlug: { type: "string" },
        includeEvidence: { type: "boolean" },
      },
      required: ["gameIdOrSlug"],
      scopes: gameReadScopes,
      readOnlyHint: true,
      outputSchema: postgameOutputSchema("turningPoints"),
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
      name: "read_agent_alliances",
      description: includeProducerTools
        ? "Read one player's owner-scoped named-alliance facts: involved proposals, member alliances, huddle messages, and member-safe huddle outcomes."
        : "Read your agent's named-alliance facts: proposals involving them, alliances they belong to, huddle messages, and member-safe huddle outcomes.",
      properties: {
        gameIdOrSlug: { type: "string" },
        player: { type: "string" },
        playerId: { type: "string" },
        agentId: { type: "string" },
        detailLevel: { type: "string", enum: ["compact", "full"] },
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
        : "Read one authorized split cognitive artifact payload by game, artifact id, artifact type, and actor player id. Reasoning is owner-only; thinking and strategy are participant-visible except private huddle artifacts, which remain owner-only.",
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
      name: "read_producer_season_diagnostics",
      description: "Read producer-only hidden competition ratings, rating events, and receipt evidence for one season.",
      properties: { seasonIdOrSlug: { type: "string" } },
      required: ["seasonIdOrSlug"],
      scopes: ["producer"],
      readOnlyHint: true,
    }),
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
      name: "read_producer_game_analysis",
      description: "Read producer-only postgame analysis with derived vote cohorts, strategic-grade signals, private artifact indexes, trace-manifest indexes, and tuning diagnostics.",
      properties: {
        gameIdOrSlug: { type: "string" },
        detailLevel: { type: "string", enum: ["brief", "standard", "full"] },
        includeEvidence: { type: "boolean" },
      },
      required: ["gameIdOrSlug"],
      scopes: ["producer"],
      readOnlyHint: true,
      outputSchema: postgameOutputSchema("producerAnalysis"),
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
      description: "List the authenticated user's own reusable Agent Profiles with current revision, queue state, and whether an active enrollment follows current behavior or is pinned. Call before any mutation to resolve whether the requested competitor already exists; existing identities must use update_agent. Requires agents:read. No side effects.",
      properties: {
        limit: { type: "number" },
      },
      scopes: ["agents:read"],
      readOnlyHint: true,
    }),
    tool({
      name: "get_agent",
      description: "Read one owned Agent Profile by stable agentId, including its current revision and following-or-pinned enrollment state. Call when an agent was already selected, then use update_agent to tune that identity regardless of enrollment. Requires agents:read. No side effects.",
      properties: {
        agentId: { type: "string" },
      },
      required: ["agentId"],
      scopes: ["agents:read"],
      readOnlyHint: true,
    }),
    tool({
      name: "search_agents",
      description: "Search only the authenticated user's Agent Profiles by name, archetype, biography, personality prompt, or strategy style. Call first when the user names or describes a competitor; if found, use update_agent to preserve that stable identity. Requires agents:read. No side effects.",
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
      description: "Inspect the authenticated user's Standing Daily Agent, current eligibility, and relevant waiting/active game. Call before joining or leaving. Requires agents:read. No side effects.",
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
    tool({
      name: "read_agent_season",
      description: "Read the authenticated owner's receipt and revision-separated season analysis for one saved agent.",
      properties: {
        seasonIdOrSlug: { type: "string" },
        agentId: { type: "string" },
      },
      required: ["seasonIdOrSlug", "agentId"],
      scopes: ["agents:read"],
      readOnlyHint: true,
    }),
    tool({
      name: "export_agent_season_data",
      description: "Export the authenticated owner's bounded season receipt data, optionally for one agent, as JSON or spreadsheet-safe CSV.",
      properties: {
        seasonIdOrSlug: { type: "string" },
        agentId: { type: "string" },
        format: { type: "string", enum: ["json", "csv"] },
        limit: { type: "number" },
      },
      required: ["seasonIdOrSlug"],
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
      description: "Create a distinctly named Agent Profile as a separate competitive identity with independent career and season history. Never use create_agent to tune, revise, or re-enroll an existing competitor; resolve owned identities first and use update_agent when one exists. An agent_name_taken error reveals no conflicting identity, so search the owner's agents and update an owned match or choose a different name. Requires agents:read and agents:write. Side effects: inserts an agent profile and, when no avatar is supplied and quota allows, starts portrait generation reported through avatarCompletion.",
      properties: {
        displayName: { type: "string" },
        archetype: { type: "string", enum: USER_SELECTABLE_AGENT_ARCHETYPE_KEYS },
        personalityPrompt: { type: "string" },
        publicBiography: nullableStringSchema(),
        strategyStyle: nullableStringSchema(),
        gender: { anyOf: [{ type: "string", enum: AGENT_GENDER_VALUES }, { type: "null" }] },
        avatarUrl: nullableStringSchema(),
      },
      required: ["displayName", "archetype", "personalityPrompt"],
      scopes: writeScopes,
      readOnlyHint: false,
      outputSchema: agentCommandOutputSchema(),
    }),
    tool({
      name: "update_agent",
      description: "Tune an existing owned Agent Profile while preserving its stable identity, career, season history, and Standing Daily membership. Use update_agent regardless of whether the competitor is unenrolled, standing in Daily Free, seated in a waiting game, in progress, or suspended. Effective changes become active by default: waiting seats follow current behavior, while started or suspended seats remain pinned. Read the structured receipt for the revision and enrollment outcome. Requires agents:read and agents:write. Side effect: updates the existing agent profile and eligible waiting followers; it never performs active-match actions.",
      properties: {
        agentId: { type: "string" },
        displayName: { type: "string" },
        archetype: { anyOf: [{ type: "string", enum: USER_SELECTABLE_AGENT_ARCHETYPE_KEYS }, { type: "null" }] },
        personalityPrompt: { type: "string" },
        publicBiography: nullableStringSchema(),
        strategyStyle: nullableStringSchema(),
        gender: { anyOf: [{ type: "string", enum: AGENT_GENDER_VALUES }, { type: "null" }] },
        avatarUrl: nullableStringSchema(),
      },
      required: ["agentId"],
      scopes: writeScopes,
      readOnlyHint: false,
      outputSchema: agentCommandOutputSchema(),
    }),
    tool({
      name: "join_queue",
      description: "Set the user's standing Daily Free agent, or enroll an owned agent in a waiting open game. For queueType=daily-free, retrying the same agent is idempotent and choosing another owned agent switches the standing entry. Requires agents:read and agents:write. Side effect: creates or updates enrollment.",
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
      description: "Remove the user's standing Daily Free entry idempotently and suppress browser acquisition prompts for the rest of the active season. This does not exit an active game. Requires agents:read and agents:write. Side effect: removes standing enrollment.",
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
  properties?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  required?: string[];
  scopes: readonly McpOAuthScope[];
  readOnlyHint: boolean;
  appMeta?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}): unknown {
  const securityScheme = oauthSecurityScheme(input.scopes);
  return {
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema ?? {
      type: "object",
      properties: input.properties ?? {},
      ...(input.required && { required: input.required }),
    },
    ...(input.outputSchema && { outputSchema: input.outputSchema }),
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

function postgameOutputSchema(kind: string): Record<string, unknown> {
  const playerRefSchema = {
    type: "object",
    required: ["id", "name"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
    },
    additionalProperties: true,
  };
  const voteCountSchema = {
    type: "object",
    required: ["player", "votes"],
    properties: {
      player: playerRefSchema,
      votes: { type: "number" },
    },
    additionalProperties: true,
  };
  const finalVoteSchema = {
    type: "object",
    required: ["status", "winner", "runnerUp", "voteCounts", "totalVotes", "margin", "method"],
    properties: {
      status: { type: "string", enum: ["available", "unavailable"] },
      winner: nullableSchema(playerRefSchema),
      runnerUp: nullableSchema(playerRefSchema),
      voteCounts: { type: "array", items: voteCountSchema },
      totalVotes: { type: "number" },
      margin: nullableSchema({ type: "number" }),
      method: nullableSchema({ type: "string" }),
    },
    additionalProperties: true,
  };
  const gameSchema = {
    type: "object",
    required: ["id", "status", "trackType", "playerCount", "roundCount"],
    properties: {
      id: { type: "string" },
      slug: { type: "string" },
      status: { type: "string" },
      trackType: { type: "string" },
      playerCount: { type: "number" },
      roundCount: { type: "number" },
    },
    additionalProperties: true,
  };
  const diagnosticSchema = {
    type: "object",
    required: ["code", "severity", "message"],
    properties: {
      code: { type: "string" },
      severity: { type: "string", enum: ["info", "warning", "error"] },
      message: { type: "string" },
    },
    additionalProperties: true,
  };
  const diagnosticsSchema = { type: "array", items: diagnosticSchema };
  const derivedTextSchema = {
    type: "object",
    required: ["text", "confidence", "derivationMethod"],
    properties: {
      text: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      derivationMethod: { type: "string" },
    },
    additionalProperties: true,
  };
  const roundSummarySchema = {
    type: "object",
    required: ["round", "headline", "empowered", "empowerVoteCounts", "exposeLeaders", "eliminated", "majorityCohort"],
    properties: {
      round: { type: "number" },
      phase: nullableSchema({ type: "string" }),
      headline: nullableSchema(derivedTextSchema),
      empowered: nullableSchema(playerRefSchema),
      empowerVoteCounts: { type: "array", items: voteCountSchema },
      exposeLeaders: { type: "array", items: voteCountSchema },
      eliminated: nullableSchema(playerRefSchema),
      majorityCohort: {
        type: "object",
        required: ["basis", "target", "votes", "confidence"],
        properties: {
          basis: { type: "string" },
          alignedPlayers: { type: "array", items: playerRefSchema },
          target: nullableSchema(playerRefSchema),
          votes: { type: "number" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          derivationMethod: { type: "string" },
        },
        additionalProperties: true,
      },
      diagnostics: diagnosticsSchema,
    },
    additionalProperties: true,
  };
  const juryVoteSchema = {
    type: "object",
    required: ["juror", "finalist", "jurorEliminatedRound", "relationshipFlags"],
    properties: {
      juror: playerRefSchema,
      finalist: playerRefSchema,
      jurorEliminatedRound: nullableSchema({ type: "number" }),
      votedForMatchingVotePattern: nullableSchema({ type: "boolean" }),
      votedForFinalistWhoVotedToEliminateThem: nullableSchema({ type: "boolean" }),
      relationshipFlags: { type: "array", items: { type: "string" } },
    },
    additionalProperties: true,
  };
  const jurySchema = {
    type: "object",
    required: ["status", "finalists", "winner", "finalVote", "perJurorVotes", "juryNarrative", "winnerSupporters", "runnerUpSupporters"],
    properties: {
      status: { type: "string" },
      finalists: { type: "array", items: playerRefSchema },
      winner: nullableSchema(playerRefSchema),
      finalVote: finalVoteSchema,
      perJurorVotes: { type: "array", items: juryVoteSchema },
      juryNarrative: { type: "array", items: derivedTextSchema },
      winnerSupporters: { type: "array", items: playerRefSchema },
      runnerUpSupporters: { type: "array", items: playerRefSchema },
      narrativeHints: { type: "array", items: { type: "string" } },
      nonWinnerSupporters: { type: "array", items: playerRefSchema },
    },
    additionalProperties: true,
  };
  const playerSummarySchema = {
    type: "object",
    required: [
      "player",
      "placement",
      "status",
      "eliminatedRound",
      "won",
      "votesCastByRound",
      "majorityAlignmentByRound",
      "endgame",
      "jury",
      "overallGameShape",
      "readableSummary",
    ],
    properties: {
      player: playerRefSchema,
      placement: nullableSchema({ type: "number" }),
      status: { type: "string", enum: ["winner", "finalist", "eliminated", "unknown"] },
      eliminatedRound: nullableSchema({ type: "number" }),
      won: { type: "boolean" },
      votesCastByRound: { type: "array", items: { type: "object", additionalProperties: true } },
      empowerVotesReceivedByRound: { type: "array", items: { type: "object", additionalProperties: true } },
      exposeVotesReceivedByRound: { type: "array", items: { type: "object", additionalProperties: true } },
      councilVotesCast: { type: "array", items: { type: "object", additionalProperties: true } },
      councilVotesReceived: { type: "array", items: { type: "object", additionalProperties: true } },
      majorityAlignmentByRound: { type: "array", items: { type: "object", additionalProperties: true } },
      endgame: { type: "object", additionalProperties: true },
      jury: { type: "object", additionalProperties: true },
      overallGameShape: { type: "object", additionalProperties: true },
      readableSummary: { type: "string" },
      diagnostics: diagnosticsSchema,
    },
    additionalProperties: true,
  };
  const turningPointSchema = {
    type: "object",
    required: ["round", "type", "players", "confidence", "description", "derivationMethod", "criteria", "evidence"],
    properties: {
      round: { type: "number" },
      type: {
        type: "string",
        enum: [
          "power_shift",
          "majority_consolidation",
          "alliance_member_cut",
          "threat_removed",
          "jury_split",
          "endgame_pivot",
          "near_miss",
        ],
      },
      players: { type: "array", items: playerRefSchema },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      description: { type: "string" },
      derivationMethod: { type: "string" },
      criteria: { type: "object", additionalProperties: true },
      evidence: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  };
  const agentGameRowSchema = {
    type: "object",
    required: [
      "gameId",
      "status",
      "trackType",
      "placement",
      "survivedToEnd",
      "won",
      "eliminatedRound",
      "finalistNames",
      "diagnostics",
    ],
    properties: {
      gameId: { type: "string" },
      slug: { type: "string" },
      status: { type: "string" },
      trackType: { type: "string" },
      startedAt: { type: "string" },
      endedAt: { type: "string" },
      placement: nullableSchema({ type: "number" }),
      survivedToEnd: { type: "boolean" },
      won: { type: "boolean" },
      eliminatedRound: nullableSchema({ type: "number" }),
      winnerName: { type: "string" },
      finalistNames: { type: "array", items: { type: "string" } },
      finalJuryVoteTotal: { type: "number" },
      juryVotesReceived: { type: "number" },
      ratingDelta: { type: "number" },
      diagnostics: diagnosticsSchema,
    },
    additionalProperties: true,
  };
  const baseProperties: Record<string, unknown> = {
    schemaVersion: { type: "number" },
    ok: { type: "boolean", enum: [true] },
    game: gameSchema,
    diagnostics: diagnosticsSchema,
  };
  const errorSchema = {
    type: "object",
    required: ["ok", "status", "error"],
    properties: {
      ok: { type: "boolean", enum: [false] },
      status: { type: "string" },
      error: { type: "string" },
      resolutionCandidates: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
    },
    additionalProperties: true,
  };
  const summarySchema = {
    type: "object",
    required: ["winner", "finalists", "finalVote", "bootOrder", "roundCount", "playerCount"],
    properties: {
      winner: nullableSchema(playerRefSchema),
      finalists: { type: "array", items: playerRefSchema },
      finalVote: finalVoteSchema,
      bootOrder: { type: "array", items: { type: "object", additionalProperties: true } },
      roundCount: { type: "number" },
      playerCount: { type: "number" },
      dominantEmpoweredPlayers: { type: "array", items: voteCountSchema },
      mostExposedPlayers: { type: "array", items: voteCountSchema },
      unanimousOrNearUnanimousVotes: { type: "array", items: { type: "object", additionalProperties: true } },
      highlightedEliminations: { type: "array", items: { type: "object", additionalProperties: true } },
      majorEliminations: { type: "array", items: { type: "object", additionalProperties: true } },
      notableEndgameSequence: { type: "array", items: { type: "object", additionalProperties: true } },
    },
    additionalProperties: true,
  };
  const kindSchemas: Record<string, { required: string[]; properties: Record<string, unknown> }> = {
    agentGames: {
      required: ["schemaVersion", "ok", "agent", "games", "diagnostics"],
      properties: {
        agent: {
          type: "object",
          required: ["name"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
          },
          additionalProperties: true,
        },
        games: { type: "array", items: agentGameRowSchema },
      },
    },
    gameBrief: {
      required: ["schemaVersion", "ok", "game", "postgame"],
      properties: {
        postgame: {
          type: "object",
          required: ["schemaVersion", "source", "availability", "executiveSummary", "summary", "derivedVoteCohorts", "gameMomentum", "roundSummaries", "jury", "turningPoints", "diagnostics"],
          properties: {
            schemaVersion: { type: "number" },
            source: { type: "string" },
            availability: { type: "object", additionalProperties: true },
            executiveSummary: { type: "array", items: derivedTextSchema, maxItems: 5 },
            summary: summarySchema,
            derivedVoteCohorts: { type: "array", items: { type: "object", additionalProperties: true } },
            gameMomentum: { type: "array", items: { type: "object", additionalProperties: true } },
            roundSummaries: { type: "array", items: roundSummarySchema },
            jury: {
              type: "object",
              required: ["status", "finalists", "winner", "finalVote", "juryNarrative", "winnerSupporters", "runnerUpSupporters"],
              properties: {
                status: { type: "string" },
                finalists: { type: "array", items: playerRefSchema },
                winner: nullableSchema(playerRefSchema),
                finalVote: finalVoteSchema,
                juryNarrative: { type: "array", items: derivedTextSchema },
                winnerSupporters: { type: "array", items: playerRefSchema },
                runnerUpSupporters: { type: "array", items: playerRefSchema },
                narrativeHints: { type: "array", items: { type: "string" } },
                nonWinnerSupporters: { type: "array", items: playerRefSchema },
              },
              additionalProperties: true,
            },
            turningPoints: { type: "array", items: turningPointSchema },
            diagnostics: diagnosticsSchema,
          },
          additionalProperties: true,
        },
      },
    },
    juryBreakdown: {
      required: ["schemaVersion", "ok", "game", "jury"],
      properties: { jury: jurySchema },
    },
    playerSummary: {
      required: ["schemaVersion", "ok", "game", "player"],
      properties: { player: playerSummarySchema },
    },
    turningPoints: {
      required: ["schemaVersion", "ok", "game", "turningPoints", "diagnostics"],
      properties: {
        turningPoints: { type: "array", items: turningPointSchema },
      },
    },
    producerAnalysis: {
      required: ["schemaVersion", "ok", "game", "producerAnalysis", "developerEvidence"],
      properties: {
        producerAnalysis: {
          type: "object",
          required: ["executiveSummary", "gameMomentum", "derivedVoteCohorts", "inferredAlliances", "juryManagementAnalysis", "playerByPlayerStrategicGrades"],
          properties: {
            executiveSummary: { type: "array", items: derivedTextSchema, maxItems: 5 },
            gameMomentum: { type: "array", items: { type: "object", additionalProperties: true } },
            derivedVoteCohorts: { type: "array", items: { type: "object", additionalProperties: true } },
            inferredAlliances: { type: "object", additionalProperties: true },
            juryManagementAnalysis: { type: "object", additionalProperties: true },
            playerByPlayerStrategicGrades: { type: "array", items: { type: "object", additionalProperties: true } },
          },
          additionalProperties: true,
        },
        developerEvidence: { type: "object", additionalProperties: true },
      },
    },
  };
  const kindSchema = kindSchemas[kind] ?? { required: ["schemaVersion", "ok"], properties: {} };
  return {
    oneOf: [
      {
        type: "object",
        required: kindSchema.required,
        properties: {
          ...baseProperties,
          ...kindSchema.properties,
        },
        additionalProperties: true,
      },
      errorSchema,
    ],
  };
}

function nullableSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return {
    anyOf: [
      schema,
      { type: "null" },
    ],
  };
}

function postgameContent(value: unknown): { structuredContent: unknown; content: Array<{ type: "text"; text: string }> } {
  return {
    structuredContent: value,
    content: [
      {
        type: "text",
        text: summarizePostgameContent(value),
      },
    ],
  };
}

function summarizePostgameContent(value: unknown): string {
  const root = asRecord(value);
  if (root.ok === false) {
    return `Postgame read failed: ${String(root.error ?? root.status ?? "unknown error")}`;
  }
  if (Array.isArray(root.games)) {
    const agent = asRecord(root.agent);
    return `Returned ${root.games.length} completed game(s) for ${String(agent.name ?? "the requested agent")}. See structuredContent.games for placements and final-vote fields.`;
  }
  const postgame = asRecord(root.postgame);
  if (Object.keys(postgame).length > 0) {
    const summary = asRecord(postgame.summary);
    const winner = asRecord(summary.winner);
    const finalVote = asRecord(summary.finalVote);
    const executiveSummary = Array.isArray(postgame.executiveSummary)
      ? postgame.executiveSummary
        .map((entry) => asRecord(entry).text)
        .filter((text): text is string => typeof text === "string")
      : [];
    const voteText = typeof finalVote.totalVotes === "number"
      ? ` Final jury vote total: ${finalVote.totalVotes}.`
      : "";
    const executiveText = executiveSummary.length > 0
      ? ` Executive summary: ${executiveSummary.join(" ")}`
      : "";
    return `Returned postgame brief for ${winner.name ? `winner ${String(winner.name)}` : "the completed game"}.${voteText}${executiveText} See structuredContent.postgame for round summaries, derived vote cohorts, momentum, jury facts, and turning points.`;
  }
  const jury = asRecord(root.jury);
  if (Object.keys(jury).length > 0) {
    const winner = asRecord(jury.winner);
    const perJurorVotes = Array.isArray(jury.perJurorVotes) ? jury.perJurorVotes.length : 0;
    return `Returned jury breakdown${winner.name ? ` for winner ${String(winner.name)}` : ""} with ${perJurorVotes} juror vote(s). See structuredContent.jury.perJurorVotes.`;
  }
  const player = asRecord(root.player);
  if (Object.keys(player).length > 0) {
    const playerRef = asRecord(player.player);
    return `Returned player game summary for ${String(playerRef.name ?? "the requested player")}. See structuredContent.player for votes, majority alignment, risk, endgame, and jury facts.`;
  }
  if (Array.isArray(root.turningPoints)) {
    return `Returned ${root.turningPoints.length} deterministic turning point(s). See structuredContent.turningPoints for typed evidence.`;
  }
  if (root.producerAnalysis) {
    return "Returned producer-only postgame analysis with public executive summary, momentum, and private evidence indexes. See structuredContent.producerAnalysis and structuredContent.developerEvidence.";
  }
  return "Returned structured postgame result. See structuredContent for fields.";
}

function content(value: unknown): { structuredContent: unknown; content: Array<{ type: "text"; text: string }> } {
  return {
    structuredContent: value,
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
        retryable: error instanceof AgentProfileManagementError ? error.retryable : false,
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

function agentAlliancesArgs(args: Record<string, unknown>): ProductionGameMcpAgentAlliancesOptions {
  return {
    gameIdOrSlug: requiredString(args, "gameIdOrSlug"),
    player: optionalString(args, "player"),
    playerId: optionalString(args, "playerId"),
    agentId: optionalString(args, "agentId"),
    detailLevel: optionalAllianceDetailLevel(args),
  };
}

function optionalAllianceDetailLevel(args: Record<string, unknown>) {
  const value = optionalString(args, "detailLevel");
  if (!value) return undefined;
  if (value === "compact" || value === "full") return value;
  throw new Error("detailLevel must be one of: compact, full");
}

function optionalDetailLevel(args: Record<string, unknown>) {
  const value = optionalString(args, "detailLevel");
  if (!value) return undefined;
  if (value === "brief" || value === "standard" || value === "full") return value;
  throw new Error("detailLevel must be one of: brief, standard, full");
}

function postgameArgs(
  args: Record<string, unknown>,
  options: { allowDetailLevel?: boolean } = {},
): ProductionGameMcpPostgameOptions {
  if (options.allowDetailLevel === false && args.detailLevel !== undefined) {
    throw new Error("detailLevel is only supported by read_game_brief and read_producer_game_analysis");
  }
  return {
    gameIdOrSlug: requiredString(args, "gameIdOrSlug"),
    detailLevel: options.allowDetailLevel === false ? undefined : optionalDetailLevel(args),
    includeEvidence: optionalBoolean(args, "includeEvidence"),
  };
}

function agentGamesArgs(args: Record<string, unknown>): ProductionGameMcpAgentGamesOptions {
  const agentId = optionalString(args, "agentId");
  const agentName = optionalString(args, "agentName");
  if (!agentId && !agentName) {
    throw new Error("agentId or agentName is required");
  }
  return {
    agentId,
    agentName,
    limit: optionalNumber(args, "limit"),
  };
}

function playerGameSummaryArgs(args: Record<string, unknown>): ProductionGameMcpPlayerGameSummaryOptions {
  return {
    ...postgameArgs(args, { allowDetailLevel: false }),
    player: requiredString(args, "player"),
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
