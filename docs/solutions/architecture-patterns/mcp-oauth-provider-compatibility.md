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
  - "handling provider OAuth requests that omit optional Resource Indicators while preserving canonical resource binding"
  - "separating provider-packaged MCP Apps from tool-first loopback clients"
  - "documenting production /mcp scope boundaries for provider installs"
tags: [mcp, oauth, mcp-apps, provider-compatibility, dynamic-client-registration, provider-callbacks, mcp-scopes, audit-logs]
related_components: [documentation, tooling, testing_framework, service_object]
---

# MCP OAuth Provider Compatibility Pattern

## Context

Influence MCP OAuth has two compatibility lanes:

- Tool-first clients such as Codex and Claude Code exercise Streamable HTTP MCP plus browser OAuth. They usually use loopback redirects, protected-resource metadata, authorization-server metadata, and resource-bound tokens.
- Provider-packaged MCP Apps such as ChatGPT, Claude custom connectors, and Grok connectors often use provider-owned hosted callbacks through dynamic client registration.

Production attempts failed at `mcp.oauth.register` with `invalid_redirect_uri` until each exact hosted callback was observed and added to checked-in provider compatibility config. The useful failure line was the DCR audit event; ordinary unauthenticated MCP requests were just challenge traffic. (session history)

The currently supported observed hosted callbacks live in code-owned config:

```ts
export const MCP_OAUTH_PROVIDER_REDIRECT_URIS = [
  {
    providerId: "chatgpt",
    redirectUri: "https://chatgpt.com/connector/oauth/_syG1DzKsjXV",
  },
  {
    providerId: "chatgpt",
    redirectUri: "https://chatgpt.com/connector/oauth/SvtDqU1r6I17",
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

Provider compatibility sits on top of the current single MCP resource:

```text
/mcp
  agents:read  -> owned agent reads
  agents:write -> owned agent writes and supported pre-match enrollment
  games:read   -> accessible game reads
  producer     -> producer/debug access, current producer role required
```

Provider App convenience should target user-facing scopes first. The `producer` scope remains privileged and must not become a default provider-app grant.

## Guidance

Diagnose provider callback failures from DCR audit events, not normal MCP discovery noise. A `missing_bearer_token` event on `/mcp` is the expected unauthenticated challenge path that teaches clients where OAuth metadata lives. The provider callback problem shows up earlier as `mcp.oauth.register` with `denialReason: "invalid_redirect_uri"`.

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

Treat `providerIdForRedirectUrl` as an audit classifier, not an allowlist. It may classify `chatgpt.com`, `claude.ai`, or `grok.com` hosts so logs are useful, but that does not make every path on that host safe. Do not accept generic provider callbacks such as `https://*.provider.com/*` or "anything on chatgpt.com" just because the provider ID is recognizable.

Keep provider-owned hosted callbacks in checked-in code-owned provider config. They are deployment-invariant compatibility facts, not per-environment settings. Domain or connector migrations can still cause a provider to issue a new hosted callback slug; add that exact observed URI from DCR audit output. `MCP_OAUTH_ALLOWED_REDIRECT_URIS` remains only a legacy exact escape hatch for non-provider callbacks, and broad dynamic HTTPS redirects should stay disabled outside deliberate diagnostics.

Preserve loopback handling separately for local and tool-first clients:

```text
loopback client redirect:
  http://127.0.0.1:<port>/oauth/callback
  http://localhost:<port>/oauth/callback

provider-hosted app redirect:
  exact checked-in https callback only
```

When a provider omits optional OAuth `resource`, tolerate omission only because `/mcp` is the single canonical resource. Do not loosen scope validation. Requested and selected scopes must still be a supported non-empty set, `agents:write` must include `agents:read`, and `producer` must be grantable only by current producer-role users.

When a provider-hosted dynamic client omits registration `scope`, register the full supported scope envelope for that exact provider callback. ChatGPT can request action-level OAuth scopes later, and a narrow generic default can otherwise reject the request before the consent screen has a chance to narrow it. Keep the grant defaults safe: non-producer scopes remain selected by default, while `producer` is only available to current producer-role users and must be explicitly selected.

Keep four scope states separate:

```text
registered envelope -> what this client may request
requested scopes    -> what this authorization attempt asks for
selected scopes     -> what the human approves
granted scopes      -> what the resulting token may invoke
```

A provider-hosted omitted registration scope may therefore store the broad supported envelope without auto-granting it. A generic omitted registration scope remains the safe read-only `agents:read games:read` envelope. Codex and similar tool-first clients continue to request their intended grant explicitly, including Codex's `mcp login ... --scopes` path.

Discovery adds one more separate decision: catalog eligibility. An `agents:read` bearer on a write-capable registered client can see the agent-write descriptors before it holds `agents:write`. A current producer-role subject on a producer-capable client can see producer descriptors before it holds `producer`. Invocation still requires the token's actual grant, current client envelope, current DB role, ownership, and domain authorization; descriptor visibility and host confirmation are not permission.

For a valid bearer missing an eligible tool scope, return HTTP `200` with an errored MCP `CallToolResult` carrying `_meta["mcp/www_authenticate"]`. Keep invalid bearer failures at HTTP `401` with `WWW-Authenticate`. Unknown, ineligible, and active-match tool calls remain generic and challenge-free, while an eligibility lookup failure returns JSON-RPC `-32603` with `Internal error`. Every descriptor must publish exact top-level OAuth `securitySchemes`, an identical `_meta.securitySchemes` mirror, and explicit `readOnlyHint`, `openWorldHint`, and `destructiveHint` annotations. Those fields and any host write confirmation are UX, not authorization.

Provider clients may register `refresh_token`, and the authorization server advertises `authorization_code` plus `refresh_token`. Producer-bearing grants may receive rotating refresh tokens, but the server must re-check the user's current DB producer role before every refresh and before honoring every producer access token.

The resource continues to negotiate MCP `2025-06-18`. A move to MCP `2025-11-25`, HTTP `403`, or Client ID Metadata Documents (CIMD) is separate work.

## Why This Matters

Provider App OAuth failures are easy to misread. The visible host UI may only say "OAuth failed", while the server also logs routine unauthenticated MCP probes. If the investigation follows challenge noise, the fix drifts toward metadata or bearer-token handling even though the real failure is DCR rejecting a hosted callback.

Exact callback config protects both compatibility and trust. Provider-owned callbacks are stable enough to live in code, but broad host wildcards would let untested paths on a major provider domain become valid OAuth redirects. That turns a provider hint into an authorization rule.

Separating local loopback, legacy exact env allowlists, exact provider config, and optional dynamic HTTPS diagnostics keeps each compatibility lane understandable. Future agents can add one observed provider callback, test it, and ship without weakening local tool clients or production OAuth boundaries.

The single-resource scope model keeps provider convenience from leaking into producer power. A provider registration may have a broad envelope while the selected token grant remains narrow. Normal users cannot invoke producer tools, and producer-role users still have to explicitly select `producer`; current role is revalidated rather than preserved by old descriptor or token metadata.

## When to Apply

Apply this guidance when a production MCP App or connector fails during dynamic client registration, OAuth start, callback/token exchange, refresh, or first tool call.

Use it when adding provider compatibility for Claude, ChatGPT, Grok, or another provider-packaged MCP App host. Wait for the exact observed callback from production logs or provider docs, add that exact string to code-owned config, and cover both acceptance and rejection of nearby unapproved callbacks.

Use it when a provider omits optional OAuth parameters. Tolerate omissions only after observed provider behavior proves they are necessary, and express the tolerance in terms of existing canonical resource and scope state rather than loosening the contract globally.

Use it when debugging OAuth logs. First separate:

```text
mcp.oauth.register + invalid_redirect_uri
  DCR callback allowlist/provider compatibility problem

mcp.http.request + missing_bearer_token
  expected MCP discovery/challenge before the client has a token

mcp.oauth.authorize or mcp.oauth.token failure
  authorization request, resource/scope, PKCE, code, or token-exchange problem
```

Do not apply it as a reason to accept generic provider domains, move provider callbacks into deployment env vars, refresh producer grants without a current-role check, reinterpret `producer` as user-scoped, or auto-grant write scopes without explicit consent.

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
      scope: "agents:read games:read",
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
    scope: "agents:read games:read",
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

Scope-selection coverage should prove broad app requests become explicit user consent:

```ts
const preview = await authorize({
  response_type: "code",
  client_id: dynamicClientId,
  redirect_uri: "https://grok.com/connectors-oauth-exchange-code/",
  scope: "agents:read agents:write games:read producer",
  state: "grok-no-resource-state",
  code_challenge: pkceS256(codeVerifier),
  code_challenge_method: "S256",
  decision: "inspect",
});

expect(await jsonObject(preview)).toMatchObject({
  resource: RESOURCE_URI,
  defaultSelectedScopes: ["agents:read", "agents:write", "games:read"],
  blockedScopes: [expect.objectContaining({ scope: "producer" })],
});
```

Producer refresh-token coverage should prove successful rotation while the role is current and denial after role removal:

```ts
const tokenJson = await jsonObject(producerTokenExchange);
expect(tokenJson).toMatchObject({
  token_type: "Bearer",
  scope: "producer",
  resource: RESOURCE_URI,
});
expect(typeof tokenJson.refresh_token).toBe("string");

const refreshed = await refreshAccess(String(tokenJson.refresh_token));
expect(refreshed.status).toBe(200);

await revokeRole(db, producerAddress, "producer");
const denied = await refreshAccess(String((await jsonObject(refreshed)).refresh_token));
expect(denied.status).toBe(400);
expect(await jsonObject(denied)).toMatchObject({
  error: "invalid_grant",
  error_description: "Producer role is no longer active for this user",
});
```

Operational checklist for the next provider:

```text
1. Capture the provider, date, stage, host-visible error, and correlation ID.
2. Find the mcp.oauth.register event if DCR failed.
3. Read registrationRedirectUris[0].host/path/hasQuery/uriHash/matchSource.
4. Add only the exact observed callback to MCP_OAUTH_PROVIDER_REDIRECT_URIS.
5. Add provider-profile tests for exact accept and nearby reject.
6. After the ordinary deployment, reconnect or refresh the provider connection, rescan descriptors, and use a fresh conversation if the host retains an older catalog.
7. Re-run provider install through discovery, incremental OAuth, host confirmation, callback/token, refresh if exercised, granted retry, app resource fetch, iframe boot, and first list_games.
8. Treat hosted ChatGPT results as acceptance evidence, not a separate preflight or rollout gate.
9. Update docs/game-mcp-production-oauth.md with the exact callback and any tested provider-specific tolerance.
```

## Related

- `docs/game-mcp-production-oauth.md` is the canonical production OAuth, provider callback, refresh-token, and MCP scope contract.
- `docs/solutions/architecture-patterns/production-mcp-role-resource-split.md` documents the broader production MCP scope boundary.
- `docs/solutions/runtime-errors/production-game-mcp-raw-trace-read-limit.md` covers adjacent producer trace response sizing, not provider OAuth compatibility.
- `packages/api/src/game-mcp/oauth-provider-compat.ts` owns exact provider-hosted callback config, provider host classification for audit, and redirect URI hashing.
- `packages/api/src/services/mcp-oauth.ts` owns DCR validation, loopback/provider/legacy redirect separation, resource omission tolerance, authorization-code exchange, refresh-token issuance, and refresh-token constraints.
- `packages/api/src/routes/mcp-oauth.ts` emits `mcp.oauth.register`, authorize, token, revoke, and introspection audit events with provider hints and redacted registration diagnostics.
- `packages/api/src/routes/mcp.ts` emits expected MCP resource challenge failures such as `missing_bearer_token`; do not confuse those with DCR callback rejection.
- `packages/api/src/__tests__/mcp-oauth-routes.test.ts` covers exact Claude, ChatGPT, and Grok hosted callbacks, redacted rejected-callback audits, Grok resource omission, refresh-token rotation, current-role enforcement for producer refreshes, and editable consent behavior.
- `packages/api/src/__tests__/mcp-provider-profiles.test.ts` covers bounded provider IDs, exact provider callback config, redacted audit detail shape, and nearby rejected provider-hosted callbacks.
- `docs/plans/2026-07-17-001-fix-chatgpt-mcp-tool-discovery-plan.md` records the catalog-eligibility correction and hosted acceptance contract.
