import { describe, expect, test } from "bun:test";
import {
  ProductionGameMcpJsonRpcServer,
  createProductionGameMcpServer,
} from "../game-mcp/server.js";
import {
  INFLUENCE_MCP_APP_RESOURCE_URI,
  createInfluenceMcpAppResourceContent,
} from "../game-mcp/app-resource.js";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  ProductionGameMcpReadModel,
} from "../game-mcp/read-model.js";
import type { PrivateTraceReadModel } from "../services/private-trace-read-model.js";
import type { GameMcpAuthContext } from "../game-mcp/auth.js";
import { createSeason } from "../services/seasons.js";
import { setupTestDB } from "./test-utils.js";

const GAMES_AUTH: GameMcpAuthContext = {
  userId: "user-1",
  clientId: "client-1",
  resource: "http://127.0.0.1:3000/mcp",
  scope: "agents:read agents:write games:read",
  scopes: ["agents:read", "agents:write", "games:read"],
  authProfile: "subject",
  expiresAt: 1_800_000_000,
};

const PRODUCER_AUTH: GameMcpAuthContext = {
  userId: "producer-1",
  clientId: "client-1",
  resource: "http://127.0.0.1:3000/mcp",
  scope: "producer",
  scopes: ["producer"],
  authProfile: "producer",
  expiresAt: 1_800_000_000,
};

function expectMatchesJsonSchema(value: unknown, schema: unknown): void {
  const errors = validateJsonSchema(value, schema, "$");
  if (errors.length > 0) {
    throw new Error(`JSON schema validation failed:\n${errors.join("\n")}`);
  }
}

function validateJsonSchema(value: unknown, rawSchema: unknown, path: string): string[] {
  if (!rawSchema || typeof rawSchema !== "object" || Array.isArray(rawSchema)) {
    return [`${path}: invalid schema`];
  }
  const schema = rawSchema as Record<string, unknown>;
  if (Array.isArray(schema.anyOf)) {
    const alternatives = schema.anyOf.map((candidate) => validateJsonSchema(value, candidate, path));
    return alternatives.some((errors) => errors.length === 0)
      ? []
      : [`${path}: did not match anyOf`];
  }
  if ("const" in schema && value !== schema.const) return [`${path}: expected const ${String(schema.const)}`];
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return [`${path}: value is not in enum`];

  if (schema.type === "null") return value === null ? [] : [`${path}: expected null`];
  if (schema.type === "string") return typeof value === "string" ? [] : [`${path}: expected string`];
  if (schema.type === "number") return typeof value === "number" ? [] : [`${path}: expected number`];
  if (schema.type === "boolean") return typeof value === "boolean" ? [] : [`${path}: expected boolean`];
  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    return value.flatMap((item, index) => validateJsonSchema(item, schema.items, `${path}[${index}]`));
  }
  if (schema.type !== "object") return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path}: expected object`];

  const record = value as Record<string, unknown>;
  const properties = schema.properties && typeof schema.properties === "object"
    ? schema.properties as Record<string, unknown>
    : {};
  const errors: string[] = [];
  for (const required of Array.isArray(schema.required) ? schema.required : []) {
    if (typeof required === "string" && !(required in record)) errors.push(`${path}.${required}: required`);
  }
  for (const [key, childValue] of Object.entries(record)) {
    if (key in properties) errors.push(...validateJsonSchema(childValue, properties[key], `${path}.${key}`));
    else if (schema.additionalProperties === false) errors.push(`${path}.${key}: additional property`);
  }
  return errors;
}

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
      "list_seasons",
      "read_season_standings",
      "read_season_game_receipts",
      "list_agent_games",
      "read_game_brief",
      "read_jury_breakdown",
      "read_player_game_summary",
      "read_game_turning_points",
      "read_projection",
      "read_round_facts",
      "read_agent_alliances",
      "filter_events",
      "player_timeline",
      "list_cognitive_artifacts",
      "read_cognitive_artifact",
      "read_producer_season_diagnostics",
      "inspect_durable_run",
      "read_producer_game_analysis",
      "list_trace_manifests",
      "read_trace_content",
      "search_reasoning_traces",
    ]);
    expect(JSON.stringify(tools)).toContain("\"scopes\":[\"producer\"]");
    expect(JSON.stringify(tools)).not.toContain("start_game");
    expect(JSON.stringify(tools)).not.toContain("create_agent");
    expect(JSON.stringify(tools)).not.toContain("join_queue");
    const searchTool = tools.find((tool) => (tool as { name: string }).name === "search_reasoning_traces");
    expect(JSON.stringify(searchTool)).not.toContain("maxBytesPerObject");
    expect(JSON.stringify(searchTool)).toContain("maxBytes");
    const briefTool = tools.find((tool) => (tool as { name: string }).name === "read_game_brief");
    expect(JSON.stringify(briefTool)).toContain("outputSchema");
    expect(JSON.stringify(briefTool)).toContain("finalVote");
    expect(JSON.stringify(briefTool)).toContain("executiveSummary");
    expect(JSON.stringify(briefTool)).toContain("highlightedEliminations");
    expect(JSON.stringify(briefTool)).toContain("gameMomentum");
    expect(JSON.stringify(briefTool)).toContain("roundSummaries");
    expect(JSON.stringify(briefTool)).toContain("derivedVoteCohorts");
    expect(JSON.stringify(briefTool)).toContain("postgame");
    const listAgentGamesTool = tools.find((tool) => (tool as { name: string }).name === "list_agent_games") as {
      inputSchema: { oneOf?: unknown };
      outputSchema: unknown;
    };
    expect(listAgentGamesTool.inputSchema.oneOf).toEqual([
      { required: ["agentId"] },
      { required: ["agentName"] },
    ]);
    expect(JSON.stringify(listAgentGamesTool.outputSchema)).toContain("finalJuryVoteTotal");
    const agentAlliancesTool = tools.find((tool) => (tool as { name: string }).name === "read_agent_alliances") as {
      inputSchema: { properties: Record<string, unknown> };
    };
    expect(agentAlliancesTool.inputSchema.properties).toHaveProperty("player");
    expect(agentAlliancesTool.inputSchema.properties).toHaveProperty("playerId");
    expect(agentAlliancesTool.inputSchema.properties).toHaveProperty("agentId");
    expect(agentAlliancesTool.inputSchema.properties.detailLevel).toEqual({
      type: "string",
      enum: ["compact", "full"],
    });
    const juryTool = tools.find((tool) => (tool as { name: string }).name === "read_jury_breakdown") as {
      inputSchema: { properties: Record<string, unknown> };
      outputSchema: unknown;
    };
    expect(juryTool.inputSchema.properties).not.toHaveProperty("detailLevel");
    expect(JSON.stringify(juryTool.outputSchema)).toContain("perJurorVotes");
    expect(JSON.stringify(juryTool.outputSchema)).toContain("runnerUpSupporters");
    const playerSummaryTool = tools.find((tool) => (tool as { name: string }).name === "read_player_game_summary") as {
      inputSchema: { properties: Record<string, unknown> };
      outputSchema: unknown;
    };
    expect(playerSummaryTool.inputSchema.properties).not.toHaveProperty("detailLevel");
    expect(JSON.stringify(playerSummaryTool.outputSchema)).toContain("majorityAlignmentByRound");
    expect(JSON.stringify(playerSummaryTool.outputSchema)).toContain("overallGameShape");
    const turningPointsTool = tools.find((tool) => (tool as { name: string }).name === "read_game_turning_points") as {
      inputSchema: { properties: Record<string, unknown> };
    };
    expect(turningPointsTool.inputSchema.properties).not.toHaveProperty("detailLevel");
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
      "list_seasons",
      "read_season_standings",
      "read_season_game_receipts",
      "list_agent_games",
      "read_game_brief",
      "read_jury_breakdown",
      "read_player_game_summary",
      "read_game_turning_points",
      "read_projection",
      "read_round_facts",
      "read_agent_alliances",
      "filter_events",
      "player_timeline",
      "list_cognitive_artifacts",
      "read_cognitive_artifact",
      "get_rules",
      "search_rules",
      "list_archetypes",
      "list_agents",
      "get_agent",
      "search_agents",
      "get_queue_status",
      "list_open_games",
      "read_agent_season",
      "export_agent_season_data",
      "create_agent",
      "update_agent",
      "join_queue",
      "leave_queue",
    ]);
    expect(JSON.stringify(tools)).toContain("\"scopes\":[\"games:read\"]");
    expect(JSON.stringify(tools)).toContain("private huddle artifacts, which remain owner-only");
    expect(JSON.stringify(tools)).toContain("\"scopes\":[\"agents:read\",\"agents:write\"]");
    expect(JSON.stringify(tools)).not.toContain("read_trace_content");
    expect(JSON.stringify(tools)).not.toContain("\"scopes\":[\"producer\"]");
    expect(JSON.stringify(tools)).not.toContain("\"vote\"");
    expect(JSON.stringify(tools)).not.toContain("mingle_message");
    expect(JSON.stringify(tools)).not.toContain("ready_check");
    expect(JSON.stringify(tools)).not.toContain("generate_image");
    expect(JSON.stringify(tools)).not.toContain("image_generation");
  });

  test("marks user-facing management reads and mutations accurately", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    const response = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }, GAMES_AUTH);

    expect(response?.error).toBeUndefined();
    const tools = ((response?.result as { tools: Array<{ name: string; annotations: { readOnlyHint: boolean }; inputSchema: unknown; outputSchema?: unknown; description: string }> }).tools);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(byName.get("list_archetypes")?.annotations.readOnlyHint).toBe(true);
    expect(byName.get("list_agents")?.annotations.readOnlyHint).toBe(true);
    expect(byName.get("create_agent")?.annotations.readOnlyHint).toBe(false);
    expect(byName.get("update_agent")?.annotations.readOnlyHint).toBe(false);
    expect(byName.get("join_queue")?.annotations.readOnlyHint).toBe(false);
    expect(byName.get("leave_queue")?.annotations.readOnlyHint).toBe(false);
    expect(JSON.stringify(byName.get("create_agent")?.inputSchema)).toContain("diplomat");
    expect(JSON.stringify(byName.get("create_agent")?.inputSchema)).not.toContain("broker");
    expect(byName.get("search_agents")?.description).toContain("use update_agent");
    expect(byName.get("create_agent")?.description).toContain("separate competitive identity");
    expect(byName.get("create_agent")?.description).toContain("Never use create_agent to tune");
    expect(byName.get("update_agent")?.description).toContain("regardless of whether the competitor is unenrolled");
    expect(byName.get("update_agent")?.description).toContain("started or suspended seats remain pinned");
    expect(JSON.stringify(byName.get("create_agent")?.outputSchema)).toContain("profileRevision");
    expect(JSON.stringify(byName.get("update_agent")?.outputSchema)).toContain("waitingSeats");
    expect(byName.get("join_queue")?.description).toContain("Side effect");
  });

  test("initialization prefers update_agent for every existing owned identity", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    const response = await server.handle({
      jsonrpc: "2.0",
      id: "init-guidance",
      method: "initialize",
    }, GAMES_AUTH);

    const instructions = String((response?.result as { instructions?: string }).instructions);
    expect(instructions).toContain("resolve the user's owned Agent Profile");
    expect(instructions).toContain("Use update_agent for any existing owned competitor regardless of enrollment");
    expect(instructions).toContain("Use create_agent only for a distinctly named separate career");
    expect(instructions).toContain("must not be used for active-match actions");
  });

  test("advertises list_games as the user-facing MCP App entry point", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    const response = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }, GAMES_AUTH);

    expect(response?.error).toBeUndefined();
    const tools = ((response?.result as { tools: unknown[] }).tools);
    const listGames = tools.find((tool) =>
      (tool as { name: string }).name === "list_games"
    ) as { _meta: Record<string, unknown>; securitySchemes: unknown[] };

    expect(listGames._meta["openai/outputTemplate"]).toBe(INFLUENCE_MCP_APP_RESOURCE_URI);
    expect(listGames._meta["openai/widgetAccessible"]).toBe(true);
    expect(listGames._meta.securitySchemes).toEqual(listGames.securitySchemes);
    expect(JSON.stringify(listGames)).toContain("\"scopes\":[\"games:read\"]");
  });

  test("does not advertise producer tools as MCP App entry points", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    const response = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }, PRODUCER_AUTH);

    expect(response?.error).toBeUndefined();
    const tools = ((response?.result as { tools: unknown[] }).tools);
    expect(JSON.stringify(tools)).not.toContain("openai/outputTemplate");
    expect(JSON.stringify(tools)).toContain("read_trace_content");
  });

  test("lists and reads the user-facing MCP App HTML resource", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    const listed = await server.handle({
      jsonrpc: "2.0",
      id: "resources",
      method: "resources/list",
    }, GAMES_AUTH);
    const resources = (listed?.result as { resources: Array<{ uri: string }> }).resources;

    expect(resources.map((resource) => resource.uri)).toContain(INFLUENCE_MCP_APP_RESOURCE_URI);

    const read = await server.handle({
      jsonrpc: "2.0",
      id: "app",
      method: "resources/read",
      params: { uri: INFLUENCE_MCP_APP_RESOURCE_URI },
    }, GAMES_AUTH);

    expect(read?.error).toBeUndefined();
    const contents = (read?.result as { contents: Array<{ mimeType: string; text: string; _meta?: unknown }> }).contents;
    expect(contents[0]?.mimeType).toBe("text/html");
    expect(contents[0]?.text).toContain("<!doctype html>");
    expect(contents[0]?.text).toContain("Influence games");
    expect(contents[0]?.text).toContain("callTool(\"list_games\"");
    expect(contents[0]?.text).toContain("JSON.parse(text.text)");
    expect(contents[0]?.text).toContain("Promise.race");
    expect(contents[0]?.text).toContain("Timed out while reading Influence games.");
    expect(contents[0]?.text).not.toContain("return {};");
    expect(contents[0]?.text).not.toContain("<iframe");
    expect(contents[0]?.text).not.toContain("access_token");
    expect(contents[0]?.text).not.toContain("Authorization");
    expect(contents[0]?.text).not.toContain("/mcp/producer");
    expect(contents[0]?.text).not.toContain("read_trace_content");
    expect(JSON.stringify(contents[0]?._meta)).toContain("openai/widgetDescription");
  });

  test("MCP App HTML renders games through the host tool bridge", async () => {
    const app = await runMcpAppHtml({
      callTool: async () => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            canonicalGameFacts: {
              games: [{
                slug: "season-one",
                status: "running",
                trackType: "mingle",
                createdAt: "2026-06-28",
              }],
            },
          }),
        }],
      }),
    });

    expect(app.status.textContent).toBe("Connected");
    expect(app.summary.textContent).toBe("Connected. 1 game available.");
    expect(app.games.children).toHaveLength(1);
    expect(app.games.children[0]?.textContent).toContain("season-one");
    expect(app.games.children[0]?.textContent).toContain("running");
  });

  test("MCP App HTML renders bridge, malformed payload, and timeout failures", async () => {
    const missingBridge = await runMcpAppHtml(undefined);
    expect(missingBridge.status.textContent).toBe("Bridge unavailable");
    expect(missingBridge.summary.textContent).toContain("did not expose a tool bridge");

    const malformed = await runMcpAppHtml({
      callTool: async () => ({
        content: [{ type: "text", text: "{not json" }],
      }),
    });
    expect(malformed.status.textContent).toBe("Read failed");
    expect(malformed.summary.textContent).toContain("JSON");
    expect(malformed.summary.textContent).not.toContain("No Influence games");

    const timedOut = await runMcpAppHtml({
      callTool: () => new Promise(() => undefined),
    }, {
      setTimeout: (handler) => {
        handler();
        return 0;
      },
    });
    expect(timedOut.status.textContent).toBe("Read failed");
    expect(timedOut.summary.textContent).toBe("Timed out while reading Influence games.");
  });

  test("does not list the MCP App resource for producer auth", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    const listed = await server.handle({
      jsonrpc: "2.0",
      id: "resources",
      method: "resources/list",
    }, PRODUCER_AUTH);
    const resources = (listed?.result as { resources: Array<{ uri: string }> }).resources;

    expect(resources.map((resource) => resource.uri)).not.toContain(INFLUENCE_MCP_APP_RESOURCE_URI);
  });

  test("rejects the MCP App resource for producer auth", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    const read = await server.handle({
      jsonrpc: "2.0",
      id: "producer-app",
      method: "resources/read",
      params: { uri: INFLUENCE_MCP_APP_RESOURCE_URI },
    }, PRODUCER_AUTH);

    expect(read?.result).toBeUndefined();
    expect(read?.error?.message).toContain(`Unknown resource URI: ${INFLUENCE_MCP_APP_RESOURCE_URI}`);
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
    const result = response?.result as { structuredContent: unknown; content: Array<{ text: string }> };
    expect(result.structuredContent).toEqual({ ok: true });
    const text = result.content[0]?.text;
    expect(text).toContain("\"ok\": true");
  });

  test("routes postgame tool calls with compact arguments", async () => {
    const calls: unknown[] = [];
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel({
      readGameBrief: async (args: unknown) => {
        calls.push(args);
        return {
          schemaVersion: 1,
          ok: true,
          postgame: {
            executiveSummary: [{ text: "Lilith Voss defeated Kestrel 4-3." }],
            summary: { winner: { name: "Lilith Voss" } },
          },
        };
      },
    }));

    const response = await server.handle({
      jsonrpc: "2.0",
      id: "brief",
      method: "tools/call",
      params: {
        name: "read_game_brief",
        arguments: {
          gameIdOrSlug: "edge-smoke-dusk",
          detailLevel: "standard",
          includeEvidence: false,
        },
      },
    }, GAMES_AUTH);

    expect(response?.error).toBeUndefined();
    expect(calls).toEqual([{
      gameIdOrSlug: "edge-smoke-dusk",
      detailLevel: "standard",
      includeEvidence: false,
    }]);
    const result = response?.result as { structuredContent: { ok: boolean }; content: Array<{ text: string }> };
    expect(result.structuredContent.ok).toBe(true);
    expect(result.content[0]?.text).toContain("Lilith Voss");
    expect(result.content[0]?.text).toContain("Lilith Voss defeated Kestrel 4-3.");
    expect(result.content[0]?.text).not.toContain("\"postgame\"");
    expect(result.content[0]?.text).not.toContain("\"summary\"");
  });

  test("forwards read_agent_alliances detailLevel", async () => {
    const calls: unknown[] = [];
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel({
      readAgentAlliances: async (args: unknown) => {
        calls.push(args);
        return { schemaVersion: 1, allianceFacts: null };
      },
    }));

    const response = await server.handle({
      jsonrpc: "2.0",
      id: "agent-alliances-full",
      method: "tools/call",
      params: {
        name: "read_agent_alliances",
        arguments: {
          gameIdOrSlug: "game-1",
          player: "Ada",
          detailLevel: "full",
        },
      },
    }, GAMES_AUTH);

    expect(response?.error).toBeUndefined();
    expect(calls).toEqual([{
      gameIdOrSlug: "game-1",
      player: "Ada",
      playerId: undefined,
      agentId: undefined,
      detailLevel: "full",
    }]);
  });

  test("rejects unsupported or invalid postgame detailLevel arguments", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());

    const invalidBrief = await server.handle({
      jsonrpc: "2.0",
      id: "invalid-brief",
      method: "tools/call",
      params: {
        name: "read_game_brief",
        arguments: {
          gameIdOrSlug: "edge-smoke-dusk",
          detailLevel: "verbose",
        },
      },
    }, GAMES_AUTH);
    expect(invalidBrief?.error?.message).toBe("detailLevel must be one of: brief, standard, full");

    const unsupportedJury = await server.handle({
      jsonrpc: "2.0",
      id: "unsupported-jury",
      method: "tools/call",
      params: {
        name: "read_jury_breakdown",
        arguments: {
          gameIdOrSlug: "edge-smoke-dusk",
          detailLevel: "brief",
        },
      },
    }, GAMES_AUTH);
    expect(unsupportedJury?.error?.message).toBe(
      "detailLevel is only supported by read_game_brief and read_producer_game_analysis",
    );
  });

  test("routes list_archetypes without producer or database access", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    const response = await server.handle({
      jsonrpc: "2.0",
      id: "archetypes",
      method: "tools/call",
      params: { name: "list_archetypes", arguments: { includeStrategyHints: true } },
    }, GAMES_AUTH);

    expect(response?.error).toBeUndefined();
    const text = ((response?.result as { content: Array<{ text: string }> }).content[0]?.text);
    expect(text).toContain("\"key\": \"diplomat\"");
    expect(text).toContain("\"strategyHint\"");
    expect(text).not.toContain("\"key\": \"broker\"");
  });

  test("routes management calls through the authenticated user only", async () => {
    const db = await setupTestDB();
    await db.insert(schema.users).values([
      {
        id: GAMES_AUTH.userId,
        email: "games-user@test.example",
        displayName: "Games User",
        rating: 1377,
        peakRating: 1401,
      },
      {
        id: "other-user",
        email: "other-user@test.example",
        displayName: "Other User",
      },
    ]);
    await db.insert(schema.agentProfiles).values([
      {
        id: "owned-agent",
        userId: GAMES_AUTH.userId,
        name: "Owned Agent",
        personality: "Visible owner prompt",
        personaKey: "diplomat",
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      },
      {
        id: "other-agent",
        userId: "other-user",
        name: "Other Agent",
        personality: "Hidden other prompt",
        personaKey: "provocateur",
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      },
    ]);
    const server = createProductionGameMcpServer(db);

    const response = await server.handle({
      jsonrpc: "2.0",
      id: "agents",
      method: "tools/call",
      params: { name: "list_agents", arguments: {} },
    }, GAMES_AUTH);

    expect(response?.error).toBeUndefined();
    const text = ((response?.result as { content: Array<{ text: string }> }).content[0]?.text);
    expect(text).toContain("Owned Agent");
    expect(text).toContain("Visible owner prompt");
    expect(text).toContain("\"currentElo\": 1377");
    expect(text).not.toContain("Other Agent");
    expect(text).not.toContain("Hidden other prompt");
  });

  test("updates one enrolled identity and returns its revision and enrollment receipt", async () => {
    const db = await setupTestDB();
    await db.insert(schema.users).values({
      id: GAMES_AUTH.userId,
      email: "games-user@test.example",
      displayName: "Games User",
    });
    const server = createProductionGameMcpServer(db);
    const toolsResponse = await server.handle({
      jsonrpc: "2.0",
      id: "agent-command-schemas",
      method: "tools/list",
    }, GAMES_AUTH);
    const commandSchemas = new Map(
      ((toolsResponse?.result as { tools: Array<{ name: string; outputSchema?: unknown }> }).tools)
        .map((tool) => [tool.name, tool.outputSchema]),
    );
    expect(() => expectMatchesJsonSchema({}, commandSchemas.get("create_agent")))
      .toThrow("required");
    const createdResponse = await server.handle({
      jsonrpc: "2.0",
      id: "create-lillith",
      method: "tools/call",
      params: {
        name: "create_agent",
        arguments: {
          displayName: "Lillith Contract",
          archetype: "strategic",
          personalityPrompt: "Patient and observant.",
          publicBiography: null,
          strategyStyle: "Build trust before acting.",
          avatarUrl: "https://cdn.example/lillith.png",
        },
      },
    }, GAMES_AUTH);
    expect(createdResponse?.error).toBeUndefined();
    const created = (createdResponse?.result as {
      structuredContent: {
        agent: { id: string };
        receipt: { agent: { agentProfileId: string } };
      };
    }).structuredContent;
    expectMatchesJsonSchema(created, commandSchemas.get("create_agent"));

    await db.insert(schema.games).values({
      id: "mcp-revision-waiting",
      slug: "mcp-revision-waiting",
      config: JSON.stringify({ modelTier: "budget" }),
      status: "waiting",
      trackType: "custom",
      minPlayers: 1,
      maxPlayers: 4,
    });
    const openJoinResponse = await server.handle({
      jsonrpc: "2.0",
      id: "seat-lillith",
      method: "tools/call",
      params: {
        name: "join_queue",
        arguments: {
          queueType: "open-game",
          agentId: created.agent.id,
          gameIdOrSlug: "mcp-revision-waiting",
        },
      },
    }, GAMES_AUTH);
    expect(openJoinResponse?.error).toBeUndefined();
    await createSeason(db, { slug: "mcp-revision-season", name: "MCP Revision Season" });
    const standingResponse = await server.handle({
      jsonrpc: "2.0",
      id: "stand-lillith",
      method: "tools/call",
      params: {
        name: "join_queue",
        arguments: { queueType: "daily-free", agentId: created.agent.id },
      },
    }, GAMES_AUTH);
    expect(standingResponse?.error).toBeUndefined();

    const updatedResponse = await server.handle({
      jsonrpc: "2.0",
      id: "update-lillith",
      method: "tools/call",
      params: {
        name: "update_agent",
        arguments: {
          agentId: created.agent.id,
          strategyStyle: "Use earned trust to coordinate a decisive late move.",
        },
      },
    }, GAMES_AUTH);
    expect(updatedResponse?.error).toBeUndefined();
    const updated = (updatedResponse?.result as {
      structuredContent: {
        agent: {
          id: string;
          currentRevision: { revisionId: string; ordinal: number; active: boolean };
          activeEnrollment: {
            revision: { disposition: string; effectiveRevisionId: string | null };
          };
        };
        receipt: {
          agent: { agentProfileId: string; identityDisposition: string };
          profileRevision: { revisionId: string; outcome: string; active: boolean };
          dailyFree: string;
          waitingSeats: { total: number; reconciled: number; games: Array<{ effectiveRevisionId: string | null }> };
          frozenSeats: { unchanged: number };
        };
      };
    }).structuredContent;
    expectMatchesJsonSchema(updated, commandSchemas.get("update_agent"));

    expect(updated.agent.id).toBe(created.agent.id);
    expect(updated.receipt).toMatchObject({
      agent: {
        agentProfileId: created.agent.id,
        identityDisposition: "preserved",
      },
      profileRevision: { outcome: "created", active: true },
      dailyFree: "preserved_follows_profile",
      waitingSeats: { total: 1, reconciled: 1 },
      frozenSeats: { unchanged: 0 },
    });
    expect(updated.agent.currentRevision.revisionId).toBe(
      updated.receipt.profileRevision.revisionId,
    );
    expect(updated.agent.activeEnrollment.revision).toEqual({
      disposition: "follows-current",
      effectiveRevisionId: updated.receipt.waitingSeats.games[0]?.effectiveRevisionId ?? null,
    });
    expect(created.receipt.agent.agentProfileId).toBe(updated.agent.id);
  });

  test("keeps name-taken MCP errors generic and non-retryable", async () => {
    const db = await setupTestDB();
    await db.insert(schema.users).values([
      { id: GAMES_AUTH.userId, email: "games-user@test.example" },
      { id: "other-owner", email: "other-owner@test.example" },
    ]);
    await db.insert(schema.agentProfiles).values({
      id: "private-conflict-agent",
      userId: "other-owner",
      name: "Private Conflict",
      personality: "Must not leak.",
    });
    const server = createProductionGameMcpServer(db);

    const response = await server.handle({
      jsonrpc: "2.0",
      id: "duplicate-agent",
      method: "tools/call",
      params: {
        name: "create_agent",
        arguments: {
          displayName: "  PRIVATE CONFLICT ",
          archetype: "strategic",
          personalityPrompt: "A separate attempt.",
          publicBiography: null,
          strategyStyle: null,
          avatarUrl: "https://cdn.example/new.png",
        },
      },
    }, GAMES_AUTH);

    expect(response?.result).toBeUndefined();
    expect(response?.error).toMatchObject({
      message: "That agent name is already in use. Choose another name.",
      data: {
        code: "agent_name_taken",
        statusCode: 409,
        retryable: false,
      },
    });
    expect(JSON.stringify(response?.error)).not.toContain("private-conflict-agent");
    expect(JSON.stringify(response?.error)).not.toContain("other-owner");
  });

  test("returns structured domain error data for management failures", async () => {
    const db = await setupTestDB();
    await db.insert(schema.users).values({
      id: GAMES_AUTH.userId,
      email: "games-user@test.example",
      displayName: "Games User",
    });
    const server = createProductionGameMcpServer(db);

    const response = await server.handle({
      jsonrpc: "2.0",
      id: "bad-agent",
      method: "tools/call",
      params: {
        name: "create_agent",
        arguments: {
          displayName: "Broker Maybe",
          archetype: "broker",
          personalityPrompt: "Not currently user-selectable.",
        },
      },
    }, GAMES_AUTH);

    expect(response?.result).toBeUndefined();
    expect(response?.error?.message).toContain("Invalid archetype");
    expect(response?.error?.data).toMatchObject({
      code: "invalid_archetype",
      statusCode: 400,
      details: {
        supportedArchetypes: expect.arrayContaining(["diplomat", "martyr"]),
      },
    });
  });

  test("reports MCP avatar completion status without exposing a standalone image tool", async () => {
    delete process.env.API_KAT_IMGNAI_KEY;
    delete process.env.API_KAT_IMGNAI_SECRET;
    const db = await setupTestDB();
    await db.insert(schema.users).values({
      id: GAMES_AUTH.userId,
      email: "games-user@test.example",
      displayName: "Games User",
    });
    const server = createProductionGameMcpServer(db);

    const response = await server.handle({
      jsonrpc: "2.0",
      id: "create-agent",
      method: "tools/call",
      params: {
        name: "create_agent",
        arguments: {
          displayName: "Avatarless MCP",
          archetype: "diplomat",
          publicBiography: null,
          strategyStyle: null,
          personalityPrompt: "Watches the room before choosing a side.",
        },
      },
    }, GAMES_AUTH);

    expect(response?.error).toBeUndefined();
    const structured = (response?.result as { structuredContent: { avatarCompletion?: { status: string; reason: string } } }).structuredContent;
    expect(structured.avatarCompletion).toMatchObject({
      status: "skipped",
    });
    expect(structured.avatarCompletion?.reason).toContain("not configured");
    const text = (response?.result as { content: Array<{ text: string }> }).content[0]?.text;
    expect(text).toContain("avatarCompletion");
    expect(text).not.toContain("prompt");
  });

  test("keeps MCP explicit avatar ahead of automatic completion", async () => {
    const db = await setupTestDB();
    await db.insert(schema.users).values({
      id: GAMES_AUTH.userId,
      email: "games-user@test.example",
      displayName: "Games User",
    });
    const server = createProductionGameMcpServer(db);

    const response = await server.handle({
      jsonrpc: "2.0",
      id: "create-agent-avatar",
      method: "tools/call",
      params: {
        name: "create_agent",
        arguments: {
          displayName: "Avatar MCP",
          archetype: "diplomat",
          publicBiography: null,
          strategyStyle: null,
          personalityPrompt: "Already has a portrait.",
          avatarUrl: "https://cdn.example/avatar.png",
        },
      },
    }, GAMES_AUTH);

    expect(response?.error).toBeUndefined();
    const structured = (response?.result as { structuredContent: { agent: { avatarUrl: string }; avatarCompletion?: { status: string } } }).structuredContent;
    expect(structured.agent.avatarUrl).toBe("https://cdn.example/avatar.png");
    expect(structured.avatarCompletion?.status).toBe("already_provided");
    expect(await db.select().from(schema.avatarGenerationRequests)).toEqual([]);
    const changes = await db.select().from(schema.avatarChangeEvents);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.source).toBe("mcp_provided_avatar");
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
      readAgentAlliances: async (_args: unknown, access: unknown) => {
        calls.push({ method: "readAgentAlliances", access });
        return { allianceFacts: null };
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
      id: "agent-alliances",
      method: "tools/call",
      params: { name: "read_agent_alliances", arguments: { gameIdOrSlug: "game-1", player: "Ada" } },
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
      { method: "readAgentAlliances", access: GAMES_AUTH },
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
      "Unknown or unauthorized MCP tool is not supported for granted scopes: start_game",
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
      "Missing required MCP scope: producer",
    );
  });

  test("rejects active-match-shaped user tool calls", async () => {
    const server = new ProductionGameMcpJsonRpcServer(fakeReadModel());
    for (const name of ["vote", "mingle_message", "ready_check", "start_game"]) {
      const response = await server.handle({
        jsonrpc: "2.0",
        id: name,
        method: "tools/call",
        params: { name, arguments: { gameIdOrSlug: "game-1" } },
      }, GAMES_AUTH);

      expect(response?.error?.message).toBe(
        `Unknown or unauthorized MCP tool is not supported for granted scopes: ${name}`,
      );
    }
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
    listSeasons: async () => ({ schemaVersion: 1, seasons: [] }),
    readSeason: async () => ({ schemaVersion: 1 }),
    readSeasonGameReceipts: async () => ({ schemaVersion: 1, receipts: [] }),
    readOwnedAgentSeason: async () => ({ schemaVersion: 1 }),
    exportOwnedSeason: async () => ({ schemaVersion: 1 }),
    readProducerSeasonDiagnostics: async () => ({ schemaVersion: 1 }),
    listAgentGames: async () => ({ schemaVersion: 1, ok: true, agent: { name: "Agent" }, games: [], diagnostics: [] }),
    readGameBrief: async () => ({ schemaVersion: 1, ok: true, postgame: null }),
    readJuryBreakdown: async () => ({ schemaVersion: 1, ok: true, jury: null }),
    readPlayerGameSummary: async () => ({ schemaVersion: 1, ok: true, player: null }),
    readGameTurningPoints: async () => ({ schemaVersion: 1, ok: true, turningPoints: [] }),
    readProjection: async () => ({ projection: null }),
    readRoundFacts: async () => ({ roundFacts: null }),
    readAgentAlliances: async () => ({ allianceFacts: null }),
    filterEvents: async () => ({ events: [] }),
    playerTimeline: async () => ({ events: [] }),
    inspectDurableRun: async () => ({ durableRun: null }),
    readProducerGameAnalysis: async () => ({ schemaVersion: 1, ok: true, producerAnalysis: null }),
    listTraceManifests: async () => ({ manifests: [] }),
    readTraceContent: async () => ({ content: "" }),
    searchReasoningTraces: async () => ({ matches: [] }),
    listCognitiveArtifacts: async () => ({ artifacts: [] }),
    readCognitiveArtifact: async () => ({ artifact: null }),
    ...overrides,
  } as unknown as ProductionGameMcpReadModel;
}

class FakeElement {
  className = "";
  children: FakeElement[] = [];
  private text = "";

  get textContent(): string {
    return this.text || this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }
}

type FakeOpenAiBridge = {
  callTool: (...args: unknown[]) => unknown;
};

async function runMcpAppHtml(
  openai?: FakeOpenAiBridge,
  options: {
    setTimeout?: (handler: () => void, timeout?: number) => unknown;
  } = {},
): Promise<{
  status: FakeElement;
  summary: FakeElement;
  games: FakeElement;
}> {
  const html = createInfluenceMcpAppResourceContent().text;
  const script = html.match(/<script>\n([\s\S]*?)\n  <\/script>/)?.[1];
  if (!script) throw new Error("MCP App script was not found");

  const elements: {
    status: FakeElement;
    summary: FakeElement;
    games: FakeElement;
    [id: string]: FakeElement;
  } = {
    status: new FakeElement(),
    summary: new FakeElement(),
    games: new FakeElement(),
  };
  const documentShim = {
    getElementById: (id: string) => elements[id],
    createElement: (_tagName: string) => new FakeElement(),
  };
  const windowShim: {
    openai?: FakeOpenAiBridge;
    setTimeout: (handler: () => void, timeout?: number) => unknown;
  } = {
    setTimeout: options.setTimeout ??
      ((handler, timeout) => globalThis.setTimeout(handler, timeout)),
  };
  if (openai) windowShim.openai = openai;

  new Function("window", "document", script)(windowShim, documentShim);
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));

  return {
    status: elements.status,
    summary: elements.summary,
    games: elements.games,
  };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
