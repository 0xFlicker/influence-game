import {
  invalidMcpOAuthScopeSetReason,
  mcpOAuthScopeSetIsSubset,
  mcpOAuthScopesToArray,
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

export interface GameMcpEligibilitySnapshot {
  clientScopes: readonly McpOAuthScope[];
  hasProducerRole: boolean;
}

export type GameMcpEligibilityResolver = (
  identity: GameMcpEligibilityIdentity,
) => Promise<GameMcpEligibilitySnapshot | null>;

export function createGameMcpEligibilityResolver(
  db: DrizzleDB,
): GameMcpEligibilityResolver {
  return async (identity) => {
    const [clientScopes, hasProducerRole] = await Promise.all([
      resolveMcpOAuthClientScopeEnvelope(db, identity.clientId),
      hasCurrentProducerRoleForUserId(db, identity.userId),
    ]);
    if (!clientScopes || hasProducerRole === null) return null;
    return { clientScopes, hasProducerRole };
  };
}

type GameMcpRequiredRole = "producer";

interface GameMcpToolScopeAlternative {
  requiredScopes: readonly McpOAuthScope[];
  catalogBaselineScopes: readonly McpOAuthScope[];
  clientEnvelopeScopes: readonly McpOAuthScope[];
  requiredRole?: GameMcpRequiredRole;
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

export const GAME_MCP_TOOL_NAMES = Object.freeze(
  Object.keys(GAME_MCP_TOOL_ACCESS) as GameMcpToolName[],
);

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
      requiredScopes: readonly McpOAuthScope[];
    }
  | {
      outcome: "step_up";
      requiredScopes: readonly McpOAuthScope[];
      challengeScopes: readonly McpOAuthScope[];
    }
  | {
      outcome: "unavailable";
    };

export function isGameMcpToolName(name: string): name is GameMcpToolName {
  return Object.hasOwn(GAME_MCP_TOOL_ACCESS, name);
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

  const authScopes = new Set(auth.scopes);
  const clientScopes = new Set(eligibility.clientScopes);
  const alternatives = GAME_MCP_TOOL_ACCESS[name].scopeAlternatives;
  const roleAllows = (alternative: GameMcpToolScopeAlternative) =>
    alternative.requiredRole !== "producer" || eligibility.hasProducerRole;
  const clientAllows = (alternative: GameMcpToolScopeAlternative) =>
    alternative.clientEnvelopeScopes.every((scope) => clientScopes.has(scope));
  const grantAllows = (alternative: GameMcpToolScopeAlternative) =>
    alternative.requiredScopes.every((scope) => authScopes.has(scope));

  return {
    known: true,
    catalogEligible: alternatives.some((alternative) =>
      roleAllows(alternative) &&
      clientAllows(alternative) &&
      alternative.catalogBaselineScopes.every((scope) => authScopes.has(scope))
    ),
    grantSatisfied: alternatives.some(grantAllows),
    invocationAllowed: alternatives.some((alternative) =>
      roleAllows(alternative) &&
      clientAllows(alternative) &&
      grantAllows(alternative)
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

  const authScopes = new Set(auth.scopes);
  const clientScopes = new Set(eligibility.clientScopes);
  const alternatives = GAME_MCP_TOOL_ACCESS[name].scopeAlternatives;
  const roleAllows = (alternative: GameMcpToolScopeAlternative) =>
    alternative.requiredRole !== "producer" || eligibility.hasProducerRole;
  const clientAllows = (alternative: GameMcpToolScopeAlternative) =>
    alternative.clientEnvelopeScopes.every((scope) => clientScopes.has(scope));
  const grantAllows = (alternative: GameMcpToolScopeAlternative) =>
    alternative.requiredScopes.every((scope) => authScopes.has(scope));

  const allowed = alternatives.find((alternative) =>
    roleAllows(alternative) &&
    clientAllows(alternative) &&
    grantAllows(alternative)
  );
  if (allowed) {
    return {
      outcome: "allowed",
      requiredScopes: allowed.requiredScopes,
    };
  }

  const stepUp = alternatives.find((alternative) =>
    roleAllows(alternative) &&
    clientAllows(alternative) &&
    alternative.catalogBaselineScopes.every((scope) => authScopes.has(scope))
  );
  if (!stepUp) return { outcome: "unavailable" };

  const challengeScopeSet = new Set<McpOAuthScope>([
    ...auth.scopes,
    ...stepUp.requiredScopes,
  ]);
  if (
    invalidMcpOAuthScopeSetReason(challengeScopeSet) ||
    !mcpOAuthScopeSetIsSubset(challengeScopeSet, clientScopes) ||
    (challengeScopeSet.has("producer") && !eligibility.hasProducerRole)
  ) {
    return { outcome: "unavailable" };
  }

  return {
    outcome: "step_up",
    requiredScopes: stepUp.requiredScopes,
    challengeScopes: mcpOAuthScopesToArray(challengeScopeSet),
  };
}

function specsFor<TName extends GameMcpToolName>(
  names: readonly TName[],
  scopeAlternatives: readonly GameMcpToolScopeAlternative[],
): Record<TName, GameMcpToolAccessSpec> {
  return Object.fromEntries(
    names.map((name) => [name, { name, scopeAlternatives }]),
  ) as unknown as Record<TName, GameMcpToolAccessSpec>;
}
