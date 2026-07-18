import {
  invalidMcpOAuthScopeSetReason,
  mcpOAuthScopeSetIncludesAll,
  mcpOAuthScopeSetIsSubset,
  mcpOAuthScopesToArray,
  type McpOAuthRequiredRole,
  type McpOAuthScope,
} from "../services/mcp-scope-policy.js";
import type { DrizzleDB } from "../db/index.js";
import {
  hasCurrentProducerRoleForUserId,
  resolveMcpOAuthClientScopeEnvelope,
} from "../services/mcp-oauth.js";
import type { GameMcpAuthContext } from "./auth.js";

export type GameMcpEligibilityIdentity = Pick<
  GameMcpAuthContext,
  "userId" | "clientId" | "resource"
>;

export interface GameMcpEligibilityRequest extends GameMcpEligibilityIdentity {
  needsProducerRole: boolean;
}

export interface GameMcpEligibilitySnapshot {
  clientScopes: readonly McpOAuthScope[];
  hasProducerRole: boolean;
}

export type GameMcpEligibilityResolver = (
  request: GameMcpEligibilityRequest,
) => Promise<GameMcpEligibilitySnapshot | null>;

export function createGameMcpEligibilityResolver(
  db: DrizzleDB,
): GameMcpEligibilityResolver {
  return async (request) => {
    const clientScopesPromise = resolveMcpOAuthClientScopeEnvelope(
      db,
      request.clientId,
    );
    if (!request.needsProducerRole) {
      const clientScopes = await clientScopesPromise;
      return clientScopes ? { clientScopes, hasProducerRole: false } : null;
    }

    const [clientScopes, hasProducerRole] = await Promise.all([
      clientScopesPromise,
      hasCurrentProducerRoleForUserId(db, request.userId),
    ]);
    if (!clientScopes || hasProducerRole === null) return null;
    return { clientScopes, hasProducerRole };
  };
}

interface GameMcpToolScopeAlternative {
  requiredScopes: readonly McpOAuthScope[];
  catalogBaselineScopes: readonly McpOAuthScope[];
  clientEnvelopeScopes: readonly McpOAuthScope[];
  requiredRole?: McpOAuthRequiredRole;
}

export interface GameMcpToolAccessSpec {
  name: GameMcpToolName;
  scopeAlternatives: readonly GameMcpToolScopeAlternative[];
}

const SHARED_GAME_READ_TOOLS = [
  "list_games",
  "list_seasons",
  "read_player_profile",
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
] as const;

const GAME_READ_TOOLS = [
  "get_rules",
  "search_rules",
] as const;

const AGENT_READ_TOOLS = [
  "list_archetypes",
  "list_agents",
  "get_agent",
  "search_agents",
  "get_queue_status",
  "list_open_games",
  "read_agent_season",
  "export_agent_season_data",
] as const;

const AGENT_WRITE_TOOLS = [
  "create_agent",
  "update_agent",
  "join_queue",
  "leave_queue",
] as const;

const PRODUCER_TOOLS = [
  "read_producer_season_diagnostics",
  "inspect_durable_run",
  "read_producer_game_analysis",
  "list_trace_manifests",
  "read_trace_content",
  "search_reasoning_traces",
] as const;

export type GameMcpToolName =
  | typeof SHARED_GAME_READ_TOOLS[number]
  | typeof GAME_READ_TOOLS[number]
  | typeof AGENT_READ_TOOLS[number]
  | typeof AGENT_WRITE_TOOLS[number]
  | typeof PRODUCER_TOOLS[number];

const PRODUCER_ALTERNATIVE: GameMcpToolScopeAlternative = {
  requiredScopes: ["producer"],
  catalogBaselineScopes: [],
  clientEnvelopeScopes: ["producer"],
  requiredRole: "producer",
};

const GAME_READ_ALTERNATIVE: GameMcpToolScopeAlternative = {
  requiredScopes: ["games:read"],
  catalogBaselineScopes: ["games:read"],
  clientEnvelopeScopes: ["games:read"],
};

const AGENT_READ_ALTERNATIVE: GameMcpToolScopeAlternative = {
  requiredScopes: ["agents:read"],
  catalogBaselineScopes: ["agents:read"],
  clientEnvelopeScopes: ["agents:read"],
};

const AGENT_WRITE_ALTERNATIVE: GameMcpToolScopeAlternative = {
  requiredScopes: ["agents:read", "agents:write"],
  catalogBaselineScopes: ["agents:read"],
  clientEnvelopeScopes: ["agents:read", "agents:write"],
};

export const GAME_MCP_TOOL_ACCESS = {
  ...specsFor(SHARED_GAME_READ_TOOLS, [PRODUCER_ALTERNATIVE, GAME_READ_ALTERNATIVE]),
  ...specsFor(GAME_READ_TOOLS, [GAME_READ_ALTERNATIVE]),
  ...specsFor(AGENT_READ_TOOLS, [AGENT_READ_ALTERNATIVE]),
  ...specsFor(AGENT_WRITE_TOOLS, [AGENT_WRITE_ALTERNATIVE]),
  ...specsFor(PRODUCER_TOOLS, [PRODUCER_ALTERNATIVE]),
} satisfies Record<GameMcpToolName, GameMcpToolAccessSpec>;

export type GameMcpToolAccessDecision =
  | {
      known: false;
      catalogEligible: false;
      grantSatisfied: false;
      invocationAllowed: false;
    }
  | {
      known: true;
      catalogEligible: boolean;
      grantSatisfied: boolean;
      invocationAllowed: boolean;
    };

export type GameMcpToolInvocationDecision =
  | {
      outcome: "allowed";
    }
  | {
      outcome: "step_up";
      challengeScopes: readonly McpOAuthScope[];
    }
  | {
      outcome: "unavailable";
    };

export function isGameMcpToolName(name: string): name is GameMcpToolName {
  return Object.hasOwn(GAME_MCP_TOOL_ACCESS, name);
}

export function gameMcpToolNeedsProducerRole(name: GameMcpToolName): boolean {
  return GAME_MCP_TOOL_ACCESS[name].scopeAlternatives.some(
    (alternative) => alternative.requiredRole === "producer",
  );
}

export function resolveGameMcpToolAccess(
  name: string,
  auth: GameMcpAuthContext,
  eligibility: GameMcpEligibilitySnapshot,
): GameMcpToolAccessDecision {
  if (!isGameMcpToolName(name)) {
    return {
      known: false,
      catalogEligible: false,
      grantSatisfied: false,
      invocationAllowed: false,
    };
  }

  const context = accessContext(auth, eligibility);
  const alternatives = GAME_MCP_TOOL_ACCESS[name].scopeAlternatives;

  return {
    known: true,
    catalogEligible: alternatives.some((alternative) =>
      catalogAllows(alternative, context)
    ),
    grantSatisfied: alternatives.some((alternative) =>
      grantAllows(alternative, context)
    ),
    invocationAllowed: alternatives.some((alternative) =>
      invocationAllows(alternative, context)
    ),
  };
}

export function resolveGameMcpToolInvocation(
  name: string,
  auth: GameMcpAuthContext,
  eligibility: GameMcpEligibilitySnapshot | null,
): GameMcpToolInvocationDecision {
  if (!eligibility || !isGameMcpToolName(name)) {
    return { outcome: "unavailable" };
  }

  const context = accessContext(auth, eligibility);
  if (!mcpOAuthScopeSetIsSubset(context.authScopes, context.clientScopes)) {
    return { outcome: "unavailable" };
  }

  const alternatives = GAME_MCP_TOOL_ACCESS[name].scopeAlternatives;
  if (alternatives.some((alternative) => invocationAllows(alternative, context))) {
    return { outcome: "allowed" };
  }

  const stepUp = alternatives.find((alternative) =>
    catalogAllows(alternative, context)
  );
  if (!stepUp) return { outcome: "unavailable" };

  const challengeScopeSet = new Set<McpOAuthScope>([
    ...auth.scopes,
    ...stepUp.requiredScopes,
  ]);
  if (
    invalidMcpOAuthScopeSetReason(challengeScopeSet) ||
    !mcpOAuthScopeSetIsSubset(challengeScopeSet, context.clientScopes) ||
    (challengeScopeSet.has("producer") && !context.hasProducerRole)
  ) {
    return { outcome: "unavailable" };
  }

  return {
    outcome: "step_up",
    challengeScopes: mcpOAuthScopesToArray(challengeScopeSet),
  };
}

interface GameMcpToolAccessContext {
  authScopes: ReadonlySet<McpOAuthScope>;
  clientScopes: ReadonlySet<McpOAuthScope>;
  hasProducerRole: boolean;
}

function accessContext(
  auth: GameMcpAuthContext,
  eligibility: GameMcpEligibilitySnapshot,
): GameMcpToolAccessContext {
  return {
    authScopes: new Set(auth.scopes),
    clientScopes: new Set(eligibility.clientScopes),
    hasProducerRole: eligibility.hasProducerRole,
  };
}

function roleAllows(
  alternative: GameMcpToolScopeAlternative,
  context: GameMcpToolAccessContext,
): boolean {
  return alternative.requiredRole !== "producer" || context.hasProducerRole;
}

function clientAllows(
  alternative: GameMcpToolScopeAlternative,
  context: GameMcpToolAccessContext,
): boolean {
  return mcpOAuthScopeSetIncludesAll(
    context.clientScopes,
    alternative.clientEnvelopeScopes,
  );
}

function grantAllows(
  alternative: GameMcpToolScopeAlternative,
  context: GameMcpToolAccessContext,
): boolean {
  return mcpOAuthScopeSetIncludesAll(context.authScopes, alternative.requiredScopes);
}

function catalogAllows(
  alternative: GameMcpToolScopeAlternative,
  context: GameMcpToolAccessContext,
): boolean {
  return roleAllows(alternative, context) &&
    clientAllows(alternative, context) &&
    mcpOAuthScopeSetIncludesAll(
      context.authScopes,
      alternative.catalogBaselineScopes,
    );
}

function invocationAllows(
  alternative: GameMcpToolScopeAlternative,
  context: GameMcpToolAccessContext,
): boolean {
  return roleAllows(alternative, context) &&
    clientAllows(alternative, context) &&
    grantAllows(alternative, context);
}

function specsFor<TName extends GameMcpToolName>(
  names: readonly TName[],
  scopeAlternatives: readonly GameMcpToolScopeAlternative[],
): Record<TName, GameMcpToolAccessSpec> {
  return Object.fromEntries(
    names.map((name) => [name, { name, scopeAlternatives }]),
  ) as unknown as Record<TName, GameMcpToolAccessSpec>;
}
