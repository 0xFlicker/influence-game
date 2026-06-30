export const MCP_OAUTH_SCOPE_VALUES = [
  "agents:read",
  "agents:write",
  "games:read",
  "producer",
] as const;

export type McpOAuthScope = typeof MCP_OAUTH_SCOPE_VALUES[number];
export type McpOAuthScopeGroup = "agents" | "games" | "developer";
export type McpOAuthRequiredRole = "producer";

export interface McpOAuthScopeDefinition {
  scope: McpOAuthScope;
  label: string;
  description: string;
  group: McpOAuthScopeGroup;
  defaultSelected: boolean;
  requiredScopes: readonly McpOAuthScope[];
  requiredRole?: McpOAuthRequiredRole;
}

export const MCP_OAUTH_SCOPE_DEFINITIONS: Record<McpOAuthScope, McpOAuthScopeDefinition> = {
  "agents:read": {
    scope: "agents:read",
    label: "Read agents",
    description: "View your saved Influence agents, archetypes, ratings, and queue state.",
    group: "agents",
    defaultSelected: true,
    requiredScopes: [],
  },
  "agents:write": {
    scope: "agents:write",
    label: "Manage agents",
    description: "Create or update your agents and enroll them in supported pre-match queues.",
    group: "agents",
    defaultSelected: true,
    requiredScopes: ["agents:read"],
  },
  "games:read": {
    scope: "games:read",
    label: "Read games",
    description: "Inspect games you created or joined, visible events, timelines, and allowed cognitive artifacts.",
    group: "games",
    defaultSelected: true,
    requiredScopes: [],
  },
  producer: {
    scope: "producer",
    label: "Developer access",
    description: "Inspect global game state, producer evidence, and private reasoning traces.",
    group: "developer",
    defaultSelected: false,
    requiredScopes: [],
    requiredRole: "producer",
  },
};

export const MCP_OAUTH_DEFAULT_SCOPES: readonly McpOAuthScope[] = [
  "agents:read",
  "games:read",
];

export const MCP_OAUTH_SCOPE_CHECK_VALUES = validCanonicalScopeValues();

export function isMcpOAuthScope(value: string): value is McpOAuthScope {
  return (MCP_OAUTH_SCOPE_VALUES as readonly string[]).includes(value);
}

export function parseMcpOAuthScopeSet(value: unknown): Set<McpOAuthScope> | null {
  if (typeof value !== "string") return null;
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;

  const scopes = new Set<McpOAuthScope>();
  for (const part of parts) {
    if (!isMcpOAuthScope(part)) return null;
    scopes.add(part);
  }
  return scopes;
}

export function parseAndValidateMcpOAuthScopes(value: unknown):
  | { ok: true; scopes: Set<McpOAuthScope>; scope: string }
  | { ok: false; reason: string } {
  const scopes = parseMcpOAuthScopeSet(value);
  if (!scopes) return { ok: false, reason: "scope must include one or more supported MCP scopes" };
  const invalidReason = invalidMcpOAuthScopeSetReason(scopes);
  if (invalidReason) return { ok: false, reason: invalidReason };
  return { ok: true, scopes, scope: normalizeMcpOAuthScopeSet(scopes) };
}

export function normalizeMcpOAuthScopeSet(scopes: Iterable<McpOAuthScope>): string {
  const set = new Set(scopes);
  return MCP_OAUTH_SCOPE_VALUES.filter((scope) => set.has(scope)).join(" ");
}

export function invalidMcpOAuthScopeSetReason(scopes: ReadonlySet<McpOAuthScope>): string | null {
  if (scopes.size === 0) return "scope selection cannot be empty";

  for (const scope of scopes) {
    const definition = MCP_OAUTH_SCOPE_DEFINITIONS[scope];
    for (const requiredScope of definition.requiredScopes) {
      if (!scopes.has(requiredScope)) {
        return `${scope} requires ${requiredScope}`;
      }
    }
  }

  return null;
}

export function mcpOAuthScopeSetIncludes(
  scopes: ReadonlySet<McpOAuthScope>,
  required: McpOAuthScope,
): boolean {
  return scopes.has(required);
}

export function mcpOAuthScopeSetIncludesAll(
  scopes: ReadonlySet<McpOAuthScope>,
  requiredScopes: readonly McpOAuthScope[],
): boolean {
  return requiredScopes.every((scope) => scopes.has(scope));
}

export function mcpOAuthScopeSetIsSubset(
  candidate: ReadonlySet<McpOAuthScope>,
  allowed: ReadonlySet<McpOAuthScope>,
): boolean {
  for (const scope of candidate) {
    if (!allowed.has(scope)) return false;
  }
  return true;
}

export function mcpOAuthScopeSetHasProducer(scopes: ReadonlySet<McpOAuthScope>): boolean {
  return scopes.has("producer");
}

export function mcpOAuthScopeSetIsRefreshEligible(scopes: ReadonlySet<McpOAuthScope>): boolean {
  return !mcpOAuthScopeSetHasProducer(scopes);
}

export function mcpOAuthScopesToArray(scopes: ReadonlySet<McpOAuthScope>): McpOAuthScope[] {
  return MCP_OAUTH_SCOPE_VALUES.filter((scope) => scopes.has(scope));
}

export function scopeSetFromArray(scopes: readonly McpOAuthScope[]): Set<McpOAuthScope> {
  return new Set(scopes);
}

function validCanonicalScopeValues(): readonly string[] {
  const values: string[] = [];
  const count = MCP_OAUTH_SCOPE_VALUES.length;
  for (let mask = 1; mask < (1 << count); mask += 1) {
    const scopes = new Set<McpOAuthScope>();
    for (let index = 0; index < count; index += 1) {
      const scope = MCP_OAUTH_SCOPE_VALUES[index];
      if (scope && mask & (1 << index)) scopes.add(scope);
    }
    if (!invalidMcpOAuthScopeSetReason(scopes)) {
      values.push(normalizeMcpOAuthScopeSet(scopes));
    }
  }
  return values;
}
