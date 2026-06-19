---
date: 2026-06-19
topic: production-game-mcp-oauth-v0
---

# Production Game MCP OAuth V0 Requirements

## Summary

Influence should expose a production Game MCP V0 that a fresh Codex client can install as a remote Streamable HTTP MCP server, authenticate through OAuth, and use to inspect deployed game data. The V0 is a connection-surface slice protected by the existing dev-scoped `scope=mcp` global MCP boundary.

---

## Problem Frame

The previous Game MCP OAuth slice proved the token-producer loop for trusted validation: the app/API can issue short-lived MCP bearer tokens to logged-in users with the `mcp` role, and a local stdio bridge can gate the existing filesystem-backed Game MCP.

That is not enough for a fresh Codex, Claude Code, or ChatGPT-style client to connect to deployed Influence. Those clients expect a remote MCP server, OAuth discovery metadata, protected-resource challenges, and a deployed data source. The next slice should productionize the exact validation use case without changing the access model into fine-grained delegation.

The production risk to handle in this slice is connection safety: only valid `scope=mcp` tokens from `mcp`-role users should reach the deployed MCP endpoint, and fresh clients should discover and complete OAuth without manual token handling. This slice should not introduce resource scoping, row-level filtering, or a new redaction boundary; private reasoning remains developer-scoped behind the global MCP gate until a later iteration designs finer resource boundaries.

---

## Key Decisions

- **Codex is the V0 release gate.** V0 is ready when a fresh Codex client can install the deployed MCP server, complete OAuth, store/use the token, and make useful read-only tool calls.
- **Claude Code and ChatGPT are compatibility checks.** Their install/auth behavior should be understood and documented, but neither blocks the first production V0.
- **The deployed surface proves connection against useful inspection tools.** V0 exposes enough deployed game inspection to prove the remote MCP connection works, without turning this slice into a resource-scoping or private-reasoning-redaction project.
- **`scope=mcp` remains the authorization boundary.** A valid token with `scope=mcp` grants global access to wired V0 MCP surfaces; V0 does not add per-user, per-agent, private-agent, or per-game filtering.
- **OAuth discovery comes before registration certainty.** V0 must publish the metadata and challenges MCP clients expect, then choose the smallest client identity path proven by a Codex compatibility spike.
- **The production resource server owns bearer validation.** Deployed clients present only the MCP access token; they do not need the local bridge introspection secret.
- **Tool-first is sufficient for V0.** Resources may exist later, but V0 success is measured by MCP tools that prove remote client install, OAuth, and deployed game inspection.

---

## Actors

- A1. Maintainer with the `mcp` role who wants Codex to inspect deployed Influence game data.
- A2. Fresh Codex client configured with the remote Influence Game MCP endpoint.
- A3. Influence MCP resource server that handles Streamable HTTP MCP requests.
- A4. Influence OAuth authorization server that issues `scope=mcp` bearer tokens.
- A5. API durable game read models that provide deployed game facts and developer inspection data.
- A6. User without the `mcp` role who must not obtain or use MCP access.
- A7. Claude Code and ChatGPT developer-mode clients used for compatibility checks.

---

## Requirements

**Access Boundary and OAuth Contract**

- R1. The V0 access contract must remain `mcp` role plus OAuth `scope=mcp` plus valid bearer token equals global access to wired V0 MCP surfaces.
- R2. The MCP resource server must reject missing, invalid, expired, revoked, wrong-audience, wrong-resource, wrong-purpose, wrong-client, or wrong-scope bearer tokens before invoking any game read model.
- R3. The authorization and token exchange flow must accept and preserve the MCP `resource` parameter so tokens are audience-bound to the canonical production MCP resource.
- R4. The token producer must continue to require PKCE S256 and must advertise PKCE support in OAuth metadata.
- R5. Role removal must prevent new authorization, prevent token exchange, and make existing tokens fail validation within the current opaque-token containment model.
- R6. MCP access tokens must not authenticate normal app/API routes, and app session tokens must not authenticate MCP resource requests.
- R7. OAuth redirects must remain exact allowlist matches, with loopback redirects allowed only for supported native-client OAuth flows.

**MCP Streamable HTTP and Discovery**

- R8. V0 must expose one canonical HTTPS MCP endpoint, expected at `/mcp`, that supports the required Streamable HTTP POST and GET methods for MCP JSON-RPC.
- R9. Every MCP HTTP request must require `Authorization: Bearer <token>` and must never accept access tokens in query strings.
- R10. Unauthenticated MCP requests must return a `WWW-Authenticate` challenge that points clients to protected-resource metadata and names `scope=mcp`.
- R11. The MCP server must publish OAuth protected-resource metadata with its canonical resource URI, authorization server, and `scopes_supported: ["mcp"]`.
- R12. The authorization server must publish OAuth metadata with authorization endpoint, token endpoint, supported PKCE methods, supported scopes, and token endpoint auth methods.
- R13. V0 must support the smallest client identity mechanism proven to make `codex mcp login` work, without requiring manual bearer-token configuration.
- R14. The MCP endpoint must validate request origin where applicable and fail closed on unsupported content types, malformed JSON-RPC, and unsupported MCP methods.
- R15. Server instructions returned during MCP initialization must describe the deployed inspection surface and warn that returned data is for trusted validation, not player-facing copy.

**Deployed Game Inspector Surface**

- R16. V0 must provide a way to list deployed games that are eligible for MCP inspection, including enough identity and status data for Codex to choose a game.
- R17. V0 must provide canonical projection reads for a selected deployed game, rebuilt from persisted canonical events.
- R18. V0 must provide canonical event filtering for a selected deployed game, including sequence cursor, event type, phase, actor, visibility mode, and result limit where the deployed read model supports them.
- R19. V0 must provide player timeline inspection from deployed canonical events and projection state.
- R20. V0 must provide durable-run inspection output that includes game identity, event-log integrity, projection status, checkpoint readiness, evidence counts, diagnostics, and any developer-scoped inspection fields that the existing read models intentionally expose.
- R21. V0 must preserve read-only behavior and must not add game mutation tools.
- R22. V0 must not depend on local filesystem paths, simulation batch directories, or local artifact URIs as the production data source.
- R23. Tool responses must distinguish canonical game facts from diagnostics, evidence summaries, producer inspection metadata, and private reasoning surfaces when present.

**Client Install and Auth Paths**

- R24. The primary install path must document a fresh Codex remote MCP configuration using the deployed endpoint URL.
- R25. The primary auth path must prove Codex can initiate OAuth, request `scope=mcp`, complete browser login/approval, store the token, initialize the MCP server, list tools, and call at least one deployed game-inspection tool.
- R26. Claude Code compatibility must be checked with remote HTTP MCP OAuth and documented with any required callback, scope, or client identity configuration.
- R27. ChatGPT developer-mode or API Playground compatibility must be checked far enough to understand protected-resource metadata, OAuth linking, tool discovery, and first tool-call behavior.
- R28. ChatGPT app runway metadata must not require iframe UI, public app submission, or final app listing material in V0.

**Security and Operations**

- R29. V0 must log auth and MCP access audit events with user or subject, client identity, resource, scope, tool name, result, denial reason, and correlation ID while redacting bearer tokens, authorization codes, PKCE verifiers, Authorization headers, and MCP response bodies.
- R30. V0 must not add bespoke app-side rate limiting for this small-scale developer-only slice; gateway-level rate limiting and broader abuse controls are deferred to a later durable deploy hardening pass.
- R31. V0 must have an emergency token containment path that works with the current opaque token store and role checks.
- R32. V0 must have staging environment checks for canonical resource URI, OAuth issuer metadata, callback redirect policy, token validation, and MCP endpoint reachability.
- R33. V0 documentation must make the global `scope=mcp` boundary visible and must state that finer resource scoping is deferred rather than silently implemented.

---

## Key Flows

- F1. Codex installs the production Game MCP
  - **Trigger:** A maintainer starts from a fresh Codex session.
  - **Actors:** A1, A2, A3
  - **Steps:** The maintainer adds the deployed MCP endpoint to Codex, Codex discovers the protected resource, and Codex prepares an OAuth login request for `scope=mcp`.
  - **Outcome:** Codex recognizes the server as a remote MCP server that requires OAuth.
  - **Covered by:** R8-R13, R24

- F2. Maintainer authorizes global MCP access
  - **Trigger:** Codex starts OAuth login for the deployed MCP server.
  - **Actors:** A1, A2, A4
  - **Steps:** The maintainer completes browser login, approves global Game MCP access, and the authorization server issues a resource-bound bearer token through authorization code plus PKCE.
  - **Outcome:** Codex stores a valid `scope=mcp` token for the deployed MCP resource.
  - **Covered by:** R1-R7, R25

- F3. Codex inspects a deployed game
  - **Trigger:** Codex has a valid MCP token and calls an inspection tool.
  - **Actors:** A2, A3, A5
  - **Steps:** The resource server validates the bearer token, dispatches the read-only tool, queries deployed durable read models, and returns developer-scoped inspection output.
  - **Outcome:** Codex can answer deployed game-status and game-history questions without local filesystem access.
  - **Covered by:** R16-R23, R25

- F4. Invalid auth fails before data access
  - **Trigger:** A request arrives without a valid `scope=mcp` token.
  - **Actors:** A3, A4, A6
  - **Steps:** The MCP resource server validates the token contract and rejects the request before calling the game read model.
  - **Outcome:** No deployed game data is returned.
  - **Covered by:** R1-R3, R5-R7, R9-R11

- F5. Compatibility clients are checked
  - **Trigger:** Codex V0 passes the release gate.
  - **Actors:** A7, A3, A4
  - **Steps:** Claude Code and ChatGPT developer-mode/API Playground are connected against the same endpoint and OAuth metadata.
  - **Outcome:** Their compatibility status, required configuration, and blockers are documented without changing the V0 release gate.
  - **Covered by:** R26-R28

---

## Acceptance Examples

- AE1. **Covers R1-R7, R24-R25.**
  - **Given:** a fresh Codex client and a maintainer with the `mcp` role.
  - **When:** the maintainer installs the deployed MCP endpoint and runs the OAuth login flow.
  - **Then:** Codex completes OAuth, stores a `scope=mcp` token, initializes the MCP server, lists tools, and calls a deployed game-inspection tool.

- AE2. **Covers R8-R15.**
  - **Given:** an unauthenticated MCP request reaches the deployed endpoint.
  - **When:** the server rejects the request.
  - **Then:** the response gives the client enough protected-resource metadata to start OAuth for `scope=mcp`.

- AE3. **Covers R3-R4, R11-R13.**
  - **Given:** Codex includes a resource indicator during authorization and token exchange.
  - **When:** the authorization server issues a token.
  - **Then:** the MCP resource server accepts the token only for the canonical production MCP resource.

- AE4. **Covers R16-R23.**
  - **Given:** a valid token and a deployed game with persisted canonical events.
  - **When:** Codex asks for projection, events, player timeline, or durable-run summary.
  - **Then:** the response comes from deployed canonical/durable read models and does not depend on local filesystem artifacts.

- AE5. **Covers R1-R2, R5-R7, R29-R31.**
  - **Given:** a request uses no token, an app session token, an expired token, a revoked token, a token for another resource, or a token from a user whose `mcp` role was removed.
  - **When:** it calls any MCP tool.
  - **Then:** the server rejects it before data access and logs a redacted audit event.

- AE6. **Covers R26-R28.**
  - **Given:** the Codex release gate has passed.
  - **When:** Claude Code and ChatGPT developer-mode/API Playground are tested.
  - **Then:** the repo docs record whether each client can discover auth, complete OAuth, discover tools, and make a first tool call.

---

## Success Criteria

- A fresh Codex setup can install the deployed Game MCP endpoint and complete OAuth without manual bearer-token configuration.
- Codex can call enough tools to list deployed games, read a projection, filter canonical events, inspect a player timeline, and read durable-run inspection output.
- The deployed MCP server rejects invalid tokens before any game read model runs.
- OAuth metadata, protected-resource metadata, resource parameter handling, PKCE S256, and bearer-token validation pass protocol-focused tests.
- Claude Code and ChatGPT developer-mode/API Playground outcomes are documented, including known blockers and any required configuration.
- Documentation states that `scope=mcp` grants global access to wired MCP surfaces and that resource scoping is deferred.

---

## Scope Boundaries

In scope:

- Production remote Game MCP over Streamable HTTP.
- OAuth protected-resource metadata, authorization server metadata, resource binding, and Codex-compatible client login.
- API-backed deployed game inspection using canonical events, projections, player timelines, durable-run inspection output, and developer-scoped reasoning surfaces that the selected read models expose.
- Global `scope=mcp` authorization over the wired V0 MCP surface.
- Codex release-gate docs and compatibility notes for Claude Code and ChatGPT developer mode/API Playground.
- Redacted audit logs, operational checks, and connection-surface security for a deployed read-only MCP resource server.

Out of scope:

- Per-user, per-agent, private-agent, per-game, per-session, per-player, row-level, or private-content authorization after `scope=mcp`.
- New resource scoping, private-reasoning removal, redaction remodeling, or a policy decision about which private evidence surfaces should exist long term.
- Local filesystem simulation corpus parity, local batch artifact URIs, and local stdio bridge packaging as the production endpoint.
- Game mutation tools or any write action through MCP.
- Refresh tokens, DPoP, long-lived sessions, broad external client platform policy, and public ChatGPT app submission.
- Making Claude Code or ChatGPT developer-mode success block V0 readiness.

---

## Dependencies and Assumptions

- The existing `mcp` RBAC role and opaque MCP token producer remain the basis for authorization.
- The deployed API has enough persisted canonical game/event data for useful inspection on staging.
- The durable game/event/projection read models remain the source of truth for deployed game facts, while developer-private reasoning surfaces remain governed by the global `mcp` gate for this slice.
- The exact OAuth client identity mechanism can be chosen after a Codex compatibility spike, as long as it stays compatible with MCP OAuth discovery and avoids manual bearer-token setup.
- The canonical MCP resource URI and deployed authorization server issuer are stable per environment.
- A later iteration may add finer resource scoping for private reasoning or raw evidence, but this V0 should not preempt that work by removing developer inspection data.

---

## Sources / Research

- MCP Streamable HTTP transport: <https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>
- MCP authorization and resource indicators: <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>
- OpenAI Codex MCP configuration and OAuth behavior: <https://developers.openai.com/codex/mcp>
- OpenAI Apps SDK authentication requirements: <https://developers.openai.com/apps-sdk/build/auth>
- Claude Code remote MCP OAuth behavior: <https://code.claude.com/docs/en/mcp>
- Prior local bridge requirements: `docs/brainstorms/2026-06-18-global-game-mcp-oauth-bridge-requirements.md`
- Prior OAuth token-producer plan: `docs/plans/2026-06-18-001-feat-game-mcp-oauth-token-producer-plan.md`
- Current OAuth producer and bridge grounding: `packages/api/src/routes/mcp-oauth.ts`, `packages/api/src/services/mcp-oauth.ts`, `packages/engine/src/game-mcp/oauth-bridge.ts`
- Current Game MCP and deployed read-model grounding: `packages/engine/src/game-mcp/server.ts`, `packages/engine/src/game-mcp/read-model.ts`, `packages/api/src/services/game-event-read-model.ts`, `packages/api/src/services/game-projection-read-model.ts`, `packages/api/src/services/game-durable-run.ts`
