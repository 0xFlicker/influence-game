---
title: MCP OAuth Provider Compatibility Pattern
date: 2026-06-30
category: architecture-patterns
module: api MCP OAuth provider compatibility
problem_type: architecture_pattern
component: authentication
severity: high
applies_when:
  - "adding hosted MCP App providers that use provider-owned OAuth callbacks"
  - "debugging dynamic client registration, authorization, token exchange, or refresh-token failures from ChatGPT, Claude, Grok, or similar providers"
  - "handling provider OAuth requests that omit optional Resource Indicators while preserving unambiguous scope/resource binding"
  - "separating provider-packaged MCP Apps from tool-first loopback clients"
  - "documenting production /mcp games versus /mcp/producer mcp boundaries for provider installs"
tags: [mcp, oauth, mcp-apps, provider-compatibility, dynamic-client-registration, provider-callbacks, scope-games, audit-logs]
related_components: [documentation, tooling, testing_framework, service_object]
---

# MCP OAuth Provider Compatibility Pattern

## Context

Recent Influence MCP OAuth work found a sharp compatibility split between tool-first MCP clients and provider-packaged MCP Apps.

Tool-first clients such as Codex and Claude Code mostly exercise Streamable HTTP MCP plus browser OAuth. They can use loopback redirects, protected-resource metadata, authorization-server metadata, and resource-bound tokens without proving anything about a provider's hosted app runtime.

Provider-packaged clients behave differently. Claude custom connectors, ChatGPT connectors / Apps SDK, and Grok connectors register provider-owned hosted callbacks through dynamic client registration. Production attempts failed at `mcp.oauth.register` with `invalid_redirect_uri` until each exact hosted callback was observed and added to checked-in provider compatibility config. Session-history evidence reinforced the same lesson: the useful failure line was the DCR audit event, while ordinary unauthenticated MCP requests were just challenge traffic. (session history)

The currently supported observed hosted callbacks live in code-owned config:

```ts
export const MCP_OAUTH_PROVIDER_REDIRECT_URIS = [
  {
    providerId: "chatgpt",
    redirectUri: "https://chatgpt.com/connector/oauth/_syG1DzKsjXV",
  },
  {
    providerId: "claude",
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
  },
  {
    providerId: "grok",
    redirectUri: "https://grok.com/connectors-oauth-exchange-code/",
  },
];
```

This compatibility lane sits beside the production resource split:

```text
/mcp           -> scope=games, user-facing app/tool access
/mcp/producer  -> scope=mcp, current mcp role, producer/global access
```

`/mcp` is the provider App target. `/mcp/producer` remains the privileged developer surface and should not inherit provider-App convenience changes unless a later production test proves a provider needs them.

## Guidance

Diagnose provider callback failures from DCR audit events, not normal MCP discovery noise. A `missing_bearer_token` event on `/mcp` or `/mcp/producer` is the expected unauthenticated challenge path that teaches clients where OAuth metadata lives. The provider callback problem shows up earlier as `mcp.oauth.register` with `denialReason: "invalid_redirect_uri"`.

Keep DCR diagnostics safe. Log redacted URI structure and correlation data, never raw callback URLs, tokens, authorization codes, refresh tokens, PKCE verifiers, authorization headers, or OAuth secrets:

```ts
export function createRedirectAuditDetail(
  redirectUri: string,
  matchSource: McpOAuthRedirectMatchSource,
) {
  const url = new URL(redirectUri);
  return {
    protocol: url.protocol.replace(/:$/, ""),
    host: url.hostname,
    path: url.pathname,
    hasQuery: url.search.length > 0,
    uriHash: hashRedirectUri(redirectUri),
    providerId: providerIdForRedirectUrl(url),
    matchSource,
  };
}
```

The audit payload should be enough to add the next exact callback without leaking the full URL:

```json
{
  "event": "mcp.oauth.register",
  "result": "failure",
  "status": 400,
  "denialReason": "invalid_redirect_uri",
  "registrationRedirectUris": [
    {
      "protocol": "https",
      "host": "chatgpt.com",
      "path": "/mcp/oauth/callback",
      "hasQuery": false,
      "providerId": "chatgpt",
      "matchSource": "rejected",
      "uriHash": "sha256:..."
    }
  ]
}
```

Treat `providerIdForRedirectUrl` as an audit classifier, not an allowlist. It may classify `chatgpt.com`, `claude.ai`, or `grok.com` hosts so logs are useful, but that does not make every path on that host safe. Do not accept generic provider callbacks such as `https://*.provider.com/*` or "anything on chatgpt.com" just because the provider ID is recognizable. The authorization decision must stay exact-match:

```ts
function isAllowedRegisteredRedirectUri(redirectUri: string): boolean {
  const url = new URL(redirectUri);
  if (!isValidRedirectUrl(url)) return false;
  if (isLoopbackUrl(url)) return url.protocol === "http:" || url.protocol === "https:";
  if (url.protocol !== "https:") return false;

  return providerRedirectRuleForUri(redirectUri) !== undefined ||
    allowedRedirectUris().includes(redirectUri) ||
    process.env.MCP_OAUTH_ALLOW_DYNAMIC_HTTPS_REDIRECTS === "true";
}
```

Keep provider-owned hosted callbacks in checked-in code-owned provider config. They are deployment-invariant compatibility facts, not per-environment settings. `MCP_OAUTH_ALLOWED_REDIRECT_URIS` remains only a legacy exact escape hatch for non-provider callbacks, and broad dynamic HTTPS redirects should stay disabled outside deliberate diagnostics.

Preserve loopback handling separately for local and tool-first clients:

```text
loopback client redirect:
  http://127.0.0.1:<port>/oauth/callback
  http://localhost:<port>/oauth/callback

provider-hosted app redirect:
  exact checked-in https callback only
```

When a provider omits optional OAuth `resource`, add tolerance only at the tested boundary and keep scope/resource constraints intact. Grok was observed omitting `resource`, so the compatible behavior is: infer a canonical resource only when the request has exactly one supported scope; reject mixed `games mcp` requests without `resource`; and let token exchange omit `resource` only because the authorization code is already bound to a canonical resource.

```ts
function resourceProfileForAuthorizeRequest(
  resourceUri: string | null,
  requestedScopes: Set<McpOAuthScope>,
) {
  if (resourceUri) return profileForMcpResourceUri(resourceUri);
  if (requestedScopes.size !== 1) return null;
  const [scope] = Array.from(requestedScopes);
  return scope ? profileForMcpScope(scope) : null;
}
```

Refresh tokens are games-only. Provider clients may register `refresh_token`, and the authorization server may advertise `authorization_code` plus `refresh_token`, but issuance stays bound to the user-facing `/mcp` profile. Producer `/mcp/producer` stays authorization-code plus short-lived access-token only.

```ts
const shouldIssueRefreshToken =
  codeProfile.scope === MCP_OAUTH_GAMES_SCOPE &&
  await clientAllowsMcpRefreshTokens(db, codeRow.clientId);

if (!profile || profile.scope !== MCP_OAUTH_GAMES_SCOPE) {
  return invalidGrant("Refresh token is not valid for games access", audit);
}
```

## Why This Matters

Provider App OAuth failures are easy to misread. The visible host UI may only say "OAuth failed", while the server also logs routine unauthenticated MCP probes. If the investigation follows `missing_bearer_token` challenge noise, the fix drifts toward metadata or bearer-token handling even though the real failure is DCR rejecting a hosted callback. The `mcp.oauth.register` event is the signal.

Exact callback config protects both compatibility and trust. Provider-owned callbacks are stable enough to live in code, but broad host wildcards would let untested paths on a major provider domain become valid OAuth redirects. That turns a provider hint into an authorization rule.

Separating local loopback, legacy exact env allowlists, exact provider config, and optional dynamic HTTPS diagnostics keeps each compatibility lane understandable. Future agents can add one observed provider callback, test it, and ship without weakening local tool clients or production OAuth boundaries.

The `/mcp` and `/mcp/producer` split also keeps provider convenience from leaking into producer power. Hosted MCP Apps should get `scope=games` access to user-facing game, agent-management, and supported pre-match tools. Producer trace inspection, private evidence, and global reads remain under `scope=mcp` plus the current `mcp` role.

## When to Apply

Apply this guidance when a production MCP App or connector fails during dynamic client registration, OAuth start, callback/token exchange, refresh, or first tool call.

Use it when adding provider compatibility for Claude, ChatGPT, Grok, or another provider-packaged MCP App host. Wait for the exact observed callback from production logs or provider docs, add that exact string to code-owned config, and cover both acceptance and rejection of nearby unapproved callbacks.

Use it when a provider omits optional OAuth parameters. Tolerate omissions only after observed provider behavior proves they are necessary, and express the tolerance in terms of existing canonical scope/resource state rather than loosening the contract globally.

Use it when debugging OAuth logs. First separate:

```text
mcp.oauth.register + invalid_redirect_uri
  DCR callback allowlist/provider compatibility problem

mcp.http.request + missing_bearer_token
  expected MCP discovery/challenge before the client has a token

mcp.oauth.authorize or mcp.oauth.token failure
  authorization request, resource/scope, PKCE, code, or token-exchange problem
```

Do not apply it as a reason to accept generic provider domains, move provider callbacks into deployment env vars, issue producer refresh tokens, reinterpret `scope=mcp` as user-scoped, or let provider App `/mcp` behavior bleed into `/mcp/producer`.

## Examples

Acceptance coverage for a provider-hosted callback should prove the exact URI is configured and that audit records are redacted:

```ts
test("accepts code-owned ChatGPT OAuth callback during dynamic registration", async () => {
  const registration = await app.request("/api/oauth/mcp/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "ChatGPT connector",
      redirect_uris: ["https://chatgpt.com/connector/oauth/_syG1DzKsjXV"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: MCP_OAUTH_GAMES_SCOPE,
      token_endpoint_auth_method: "none",
    }),
  });

  expect(registration.status).toBe(201);
  expect(auditEvents.at(-1)?.registrationRedirectUris?.[0]).toMatchObject({
    host: "chatgpt.com",
    path: "/connector/oauth/_syG1DzKsjXV",
    providerId: "chatgpt",
    matchSource: "provider_config",
  });
  expect(JSON.stringify(auditEvents)).not.toContain(
    "https://chatgpt.com/connector/oauth/_syG1DzKsjXV",
  );
});
```

Rejection coverage should prove provider host recognition is not enough:

```ts
test("audits rejected hosted redirect URIs without logging the full callback", async () => {
  const redirectUri = "https://chatgpt.com/mcp/oauth/callback";
  const registration = await register({
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: MCP_OAUTH_GAMES_SCOPE,
  });

  expect(registration.status).toBe(400);
  expect(await jsonObject(registration)).toMatchObject({
    error: "invalid_redirect_uri",
  });
  expect(auditEvents.at(-1)?.registrationRedirectUris?.[0]).toMatchObject({
    host: "chatgpt.com",
    path: "/mcp/oauth/callback",
    providerId: "chatgpt",
    matchSource: "rejected",
  });
  expect(JSON.stringify(auditEvents)).not.toContain(redirectUri);
});
```

Resource-omission coverage should prove the omission is still resource-bound:

```ts
const authorizationRequest = {
  response_type: "code",
  client_id: dynamicClientId,
  redirect_uri: "https://grok.com/connectors-oauth-exchange-code/",
  scope: MCP_OAUTH_GAMES_SCOPE,
  state: "grok-no-resource-state",
  code_challenge: pkceS256(codeVerifier),
  code_challenge_method: "S256",
};

const preview = await authorize({ ...authorizationRequest, decision: "inspect" });
expect(await jsonObject(preview)).toMatchObject({
  resource: RESOURCE_URI,
  scope: MCP_OAUTH_GAMES_SCOPE,
  authProfile: "games_subject",
});
```

Producer refresh-token coverage should keep the negative assertion:

```ts
const tokenJson = await jsonObject(producerTokenExchange);
expect(tokenJson).toMatchObject({
  token_type: "Bearer",
  scope: "mcp",
  resource: PRODUCER_RESOURCE_URI,
});
expect(tokenJson).not.toHaveProperty("refresh_token");
```

Operational checklist for the next provider:

```text
1. Capture the provider, date, stage, host-visible error, and correlation ID.
2. Find the mcp.oauth.register event if DCR failed.
3. Read registrationRedirectUris[0].host/path/hasQuery/uriHash/matchSource.
4. Add only the exact observed callback to MCP_OAUTH_PROVIDER_REDIRECT_URIS.
5. Add provider-profile tests for exact accept and nearby reject.
6. Re-run provider install through discovery, OAuth, callback/token, refresh if exercised, app resource fetch, iframe boot, and first list_games.
7. Update docs/game-mcp-production-oauth.md with the exact callback and any tested provider-specific tolerance.
```

## Related

- `docs/game-mcp-production-oauth.md` is the canonical production OAuth, provider callback, refresh-token, and `/mcp` vs `/mcp/producer` resource split doc.
- `docs/solutions/architecture-patterns/production-mcp-role-resource-split.md` documents the broader production boundary: `/mcp` is `scope=games`; `/mcp/producer` is `scope=mcp` plus the current `mcp` role.
- `docs/solutions/runtime-errors/production-game-mcp-raw-trace-read-limit.md` covers adjacent producer trace response sizing, not provider OAuth compatibility.
- `packages/api/src/game-mcp/oauth-provider-compat.ts` owns exact provider-hosted callback config, provider host classification for audit, and redirect URI hashing.
- `packages/api/src/services/mcp-oauth.ts` owns DCR validation, loopback/provider/legacy redirect separation, resource omission tolerance, authorization-code exchange, refresh-token issuance, and refresh-token constraints.
- `packages/api/src/routes/mcp-oauth.ts` emits `mcp.oauth.register`, authorize, token, revoke, and introspection audit events with provider hints and redacted registration diagnostics.
- `packages/api/src/routes/mcp.ts` emits expected MCP resource challenge failures such as `missing_bearer_token`; do not confuse those with DCR callback rejection.
- `packages/api/src/__tests__/mcp-oauth-routes.test.ts` covers exact Claude, ChatGPT, and Grok hosted callbacks, redacted rejected-callback audits, Grok resource omission, games refresh tokens, and producer no-refresh behavior.
- `packages/api/src/__tests__/mcp-provider-profiles.test.ts` covers bounded provider IDs, exact provider callback config, redacted audit detail shape, and nearby rejected provider-hosted callbacks.
