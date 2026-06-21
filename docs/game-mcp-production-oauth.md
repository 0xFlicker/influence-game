# Production Game MCP OAuth

This is the deployed HTTP Game MCP OAuth surface for Codex/Claude/ChatGPT-style clients.

There are two MCP resource profiles:

- User-facing Game MCP: `/mcp` + OAuth `scope=games`. Described to users as "access your games via MCP." This token is constrained to the authenticated subject's created or joined games and owned player/agent records.
- Producer MCP: `/mcp/producer` + OAuth `scope=mcp` + current `mcp` role. This preserves the privileged developer/global boundary and keeps developer evidence/private trace tooling.

Do not reinterpret `scope=mcp` as user-scoped. Do not expose private trace content or trace metadata through `scope=games`; trace remains producer-only. User-facing reasoning/thinking/strategy access uses first-class cognitive artifact rows captured for new games, never reads or reconstructs from producer private traces.

## Server Surface

- User MCP endpoint: `POST /mcp`
- Producer MCP endpoint: `POST /mcp/producer`
- Optional MCP GET stream: not supported; authenticated GET returns `405 Method Not Allowed`
- Default protected resource metadata: `GET /.well-known/oauth-protected-resource` for `/mcp`
- User protected resource metadata: `GET /.well-known/oauth-protected-resource/mcp`
- Producer protected resource metadata: `GET /.well-known/oauth-protected-resource/mcp/producer`
- Authorization server metadata: `GET /.well-known/oauth-authorization-server`
- Dynamic public client registration: `POST /api/oauth/mcp/register`
- Authorization endpoint: web `/oauth/mcp/authorize`
- Token endpoint: API `/api/oauth/mcp/token`

Both MCP endpoints require `Authorization: Bearer <mcp-token>` on every request, reject bearer tokens in query strings, validate `Origin` when present, accept one JSON-RPC message per POST, return JSON for normal requests, and return `202 Accepted` for accepted notifications/responses.

## Environment

Set these per deployed environment:

```bash
MCP_OAUTH_GAMES_RESOURCE_URI=https://<api-host>/mcp
MCP_OAUTH_PRODUCER_RESOURCE_URI=https://<api-host>/mcp/producer
WEB_BASE_URL=https://<web-host>
MCP_ALLOWED_ORIGINS=https://<api-host>
```

The authorization server metadata derives its public issuer, token endpoint, and registration endpoint from the `MCP_OAUTH_GAMES_RESOURCE_URI` origin. The browser authorization endpoint derives from `WEB_BASE_URL`.

Optional settings:

```bash
MCP_OAUTH_ALLOWED_REDIRECT_URIS=https://<client-callback>
MCP_OAUTH_LOOPBACK_REDIRECT_PATH=/oauth/callback
# Optional; unset behaves as false.
MCP_OAUTH_ALLOW_DYNAMIC_HTTPS_REDIRECTS=false
```

Dynamic client registration is enabled for public MCP clients. A registered client may store a supported scope set such as `games mcp`, because some MCP clients register every scope advertised by the authorization server. If the client omits scope, registration defaults to `games`.

Authorization still issues exactly one grant scope. The requested `resource` selects the profile: `/mcp` grants `games`, and `/mcp/producer` grants `mcp`. The request is rejected if the registered/requested scope set includes unsupported scopes or does not include the selected resource profile's scope. Authorization codes and access tokens persist only `games` or `mcp`, never a mixed scope set.

Private trace tools require the same private content storage env used by API durable runs:

```bash
LINODE_PRIVATE_CONTENT_ENDPOINT=...
LINODE_PRIVATE_CONTENT_ACCESS_KEY=...
LINODE_PRIVATE_CONTENT_SECRET_KEY=...
LINODE_PRIVATE_CONTENT_BUCKET=...
```

`INFLUENCE_MCP_INTROSPECTION_SECRET` remains for the local stdio bridge/introspection endpoint. Deployed MCP resources validate opaque tokens directly against DB-backed OAuth token rows and do not expose the introspection secret to clients.

## Tools

User-facing Game MCP exposes read-only user tools:

- `list_games`: games the subject created or joined, with event-log/projection status.
- `read_projection`: replay persisted canonical events into the projection summary for one accessible game.
- `read_round_facts`: read sanitized revealed vote, power, Council, and player-status facts for one accessible game round. Facts come from persisted canonical events/projections only; decision logs, cognitive artifacts, private traces, and raw producer event envelopes are not used as fallback sources.
- `filter_events`: filter player-visible canonical events in an accessible game by type, phase, actor, sequence, and limit.
- `player_timeline`: player-visible canonical event timeline for a player ID or name in an accessible game.
- `list_cognitive_artifacts`: list authorized split cognitive artifact metadata for one game the subject participated in.
- `read_cognitive_artifact`: read one authorized split cognitive artifact payload. Under `scope=games`, callers provide the game, artifact ID, artifact type, and actor player ID so authorization can run before row-existence checks. Reasoning is owner-only; thinking and strategy are participant-visible.

Producer MCP exposes the same read-only game and cognitive artifact tools with producer visibility plus producer-only tools:

- `inspect_durable_run`: durable-run inspection summary and evidence counts.
- `list_trace_manifests`: private trace metadata for one game.
- `read_trace_content`: explicit raw private trace read by manifest ID.
- `search_reasoning_traces`: bounded private reasoning search previews inside one game.

`read_round_facts` reports per-section availability so clients can tell resolved facts from `not_yet_resolved`, `not_yet_flushed`, or `unavailable` canonical facts. Artifacts may arrive before canonical events flush at a durable boundary; the facts tool reports that state instead of reconstructing gameplay from artifacts.

`scope=games` cannot discover or invoke producer trace tools and cannot request producer event visibility. Cognitive artifact reads under `scope=games` authorize before returning no-capture or row-existence information. Old games and pre-capture games return `not_captured_for_game` only after the caller is authorized for that game/actor context. `scope=mcp` on `/mcp/producer` preserves the existing global developer access contract and may read split cognitive artifacts directly without using raw trace content as a substitute.

`read_trace_content` defaults to an 8 MiB raw trace read limit and clamps tool-supplied `maxBytes` at 64 MiB. `search_reasoning_traces` exposes `limit` for result count and `maxBytes` for the per-object scan prefix. Both use ranged private-storage reads, so byte caps limit object-store bandwidth and returned content rather than rejecting larger trace objects. These are response-content bounds, separate from the MCP request body limit.

## Client Paths

### User Game MCP

Player-facing setup lives at `/get-mcp`. Send players there for the current environment's `/mcp` URL, Codex commands, Claude Code commands, sign-in guidance, and browser OAuth explanation.

Do not send players directly to `/mcp`; it is the Streamable HTTP MCP resource endpoint, not a human setup page.

The protected-resource metadata for `/mcp` advertises `scopes_supported: ["games"]`. Ready means a fresh client can initialize, complete OAuth in the browser, store/use a `games` token, call `list_games`, and call at least one accessible game-specific tool such as `read_projection` or `filter_events`.

### Producer MCP

Configure producer access separately:

```toml
[mcp_servers.influence_game_producer]
url = "https://<api-host>/mcp/producer"
tool_timeout_sec = 60
```

The producer protected-resource metadata advertises `scopes_supported: ["mcp"]`. Authorization requires the logged-in subject to currently hold the `mcp` role, and token validation re-checks that role before dispatch.

### Claude Code

Player-facing Claude Code setup is on `/get-mcp`. Internal producer validation should use the HTTP transport against the producer resource:

```bash
claude mcp add --transport http influence-game-producer https://<api-host>/mcp/producer
```

Use Claude Code's MCP authentication flow when it reports OAuth is needed. Claude Code checks protected resource metadata first, then authorization server metadata, can use dynamic client registration for public clients, and can override metadata discovery with `authServerMetadataUrl` if a deployment proxy blocks standard well-known paths.

### ChatGPT Developer Mode / Apps SDK

ChatGPT/App SDK compatibility depends on:

- HTTPS well-known protected resource metadata for the exact resource path.
- `WWW-Authenticate` challenges that point at the matching protected-resource metadata and exact scope.
- Authorization server metadata with authorization endpoint, token endpoint, PKCE S256, dynamic registration, and `scopes_supported`.
- Tool descriptors carrying OAuth security schemes for the active scope.

Public app submission, app UI components, per-tool linking policy, and broad tester rollout remain out of scope.

## Operational Checks

Before calling the slice ready on staging:

1. `GET https://<api-host>/.well-known/oauth-protected-resource` returns `resource: https://<api-host>/mcp` and `scopes_supported: ["games"]`.
2. `GET https://<api-host>/.well-known/oauth-protected-resource/mcp/producer` returns `resource: https://<api-host>/mcp/producer` and `scopes_supported: ["mcp"]`.
3. `GET https://<api-host>/.well-known/oauth-authorization-server` returns authorization/token/registration endpoints, `scopes_supported: ["games", "mcp"]`, and `code_challenge_methods_supported: ["S256"]`.
4. Unauthenticated `POST /mcp` returns a `401` challenge for `scope=games`; unauthenticated `POST /mcp/producer` returns a `401` challenge for `scope=mcp`.
5. Wrong resource, wrong scope, expired, revoked, or app-session tokens fail before any read model runs.
6. A valid `games` token can initialize, list only accessible games, read an accessible projection, read revealed round facts, filter player-visible events, list/read authorized cognitive artifacts, and cannot discover or call trace tools.
7. A valid producer `mcp` token can initialize `/mcp/producer`, list producer tools, list/read split cognitive artifacts, and read/search private trace content when storage is configured.
8. Resource-selected OAuth events and MCP request events include correlation ID, method/tool, user/client/resource, issued scope, auth profile, result, status, and denial reason. Dynamic client registration audit records the requested scope set but has no selected auth profile until authorization chooses a resource. Audits never include raw tokens, auth headers, authorization codes, PKCE verifiers, raw prompts, raw responses, reasoning bodies, or storage credentials.

## Out Of Scope

- User-facing private trace representation, trace-derived summaries, or trace-backed fallback reads.
- Polished cognitive artifact UX; this slice exposes raw authorized split artifacts and minimal API/client types only.
- App-side rate limiting. Put rate limiting behind a real gateway in a later durable deploy hardening pass.
- Refresh tokens.
- Confidential-client management, client secrets, and a general third-party OAuth app platform.
- Mutation tools or game lifecycle controls.
- Public ChatGPT app submission and app UI widgets.

## References

- MCP Streamable HTTP transport: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- MCP authorization and resource indicators: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- Codex MCP configuration: https://developers.openai.com/codex/mcp
- OpenAI Apps SDK authentication: https://developers.openai.com/apps-sdk/build/auth
- Claude Code MCP reference: https://docs.anthropic.com/en/docs/claude-code/mcp
