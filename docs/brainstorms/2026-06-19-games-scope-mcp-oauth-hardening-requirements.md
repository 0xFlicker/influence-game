---
date: 2026-06-19
topic: games-scope-mcp-oauth-hardening
---

# Games Scope MCP OAuth Hardening Requirements

## Summary

Influence should split the deployed MCP OAuth trust boundary so `/mcp` becomes the user-facing MCP resource for `scope=games`, while the existing global developer surface moves to `/mcp/producer` with the current `scope=mcp` meaning. A `games` token should grant only the authenticated subject's allowed game, player, and agent resources, and it must not expose private trace data or trace metadata.

---

## Problem Frame

The production Game MCP OAuth V0 intentionally made `scope=mcp` a privileged developer boundary. A user with the `mcp` role can authorize a resource-bound bearer token that grants global access to the wired Production Game MCP tools, including producer evidence and private trace tooling.

The next product slice needs a user-facing MCP scope described as "access your games via MCP" without reinterpreting the existing `mcp` scope. The current code is still shaped around a singleton `mcp` scope, and the MCP server/read model does not receive auth context after bearer validation. That makes a clean trust-boundary split the safest first chunk before adding broader user or agent-facing MCP surfaces.

---

## Key Decisions

- **Route by trust boundary.** `/mcp` is the user-facing MCP resource, and `/mcp/producer` is the privileged producer resource.
- **Preserve `scope=mcp`.** `mcp` remains a global developer/maintainer boundary and does not become user-scoped.
- **Define `scope=games` as resource-based access.** `games` covers subject-attributable games, player records, and agent records rather than public-only game reads.
- **Resolve claims live.** Access should reflect games the subject created or joined and agent/player ownership without stuffing resource IDs into token rows.
- **Keep traces producer-only.** `games` exposes no private trace content, trace manifests, reasoning search, or trace metadata in this phase.
- **Ship as one cutover.** The endpoint/scope/resource split should go out atomically with final-state authorization matrix tests, not as a staged rollout.

---

## Actors

- A1. Player or user who authorizes a third-party MCP client to access their Influence games.
- A2. Maintainer with the `mcp` role who needs global producer inspection through MCP.
- A3. MCP client such as Codex, Claude Code, or a ChatGPT-style connector.
- A4. Influence OAuth authorization server that issues resource-bound MCP bearer tokens.
- A5. Influence MCP resource server that validates bearer tokens before JSON-RPC dispatch.
- A6. API read models that provide canonical game, player, agent, and producer evidence data.
- A7. User without access to a game who must not receive that game's data through MCP.

---

## Requirements

**Scope and Resource Contract**

- R1. `/mcp` must be the canonical user-facing MCP protected resource for `scope=games`.
- R2. `/mcp/producer` must be the canonical privileged MCP protected resource for `scope=mcp`.
- R3. A `games` token must require an authenticated app subject, but must not require the `mcp` role or grant producer/global corpus access.
- R4. An `mcp` token must keep today's developer meaning: `mcp` role plus `scope=mcp` plus valid resource-bound bearer token grants global access to wired producer MCP tools.
- R5. OAuth metadata, protected-resource metadata, authorization challenges, authorization codes, access tokens, and resource-server validation must accept only exact issued scope/resource pairings: `/mcp` with `games`, and `/mcp/producer` with `mcp`.
- R6. Dynamic client registration and authorization requests may carry supported scope sets such as `games mcp` for client compatibility, but unsupported scopes or scope sets that omit the requested resource profile's scope must be rejected. Authorization codes and access tokens must never persist mixed scope sets.
- R7. Missing, invalid, expired, revoked, wrong-resource, wrong-scope, wrong-purpose, or wrong-client bearer tokens must fail before any read model or MCP tool runs.
- R8. MCP bearer tokens must not authenticate normal app/API routes, and app session tokens must not authenticate MCP resource requests.

**Games Resource Claims**

- R9. `games` game-level access must include games the subject created and games the subject joined.
- R10. `games` player access must include player records owned by the subject.
- R11. `games` agent access must include player records using an agent profile owned by the subject.
- R12. `games` resource claims must be resolved from live application state at request or tool-call time rather than snapshotted into the access token.
- R13. `games` tools must filter every list, read, projection, timeline, and event response to the subject's allowed game, player, and agent resources.

**MCP Tools and Read Models**

- R14. The MCP route/server boundary must pass a discriminated auth profile into JSON-RPC handling.
- R15. User-facing MCP handling must not fall back to producer visibility defaults when running under `scope=games`.
- R16. Tool discovery under `scope=games` must expose only user-facing game/player/agent tools and descriptions.
- R17. Tool discovery under `scope=games` must not list producer evidence tools, private trace tools, or developer/global inspection wording.
- R18. User-supplied arguments must not let a `games` token opt into producer visibility or cross-subject game access.
- R19. `/mcp/producer` must preserve the existing producer inspection surface, including private trace tools behind `scope=mcp`.

**Trace Boundary**

- R20. `scope=games` must expose no private trace content, trace manifests, reasoning search, raw prompts, internal keys, or trace metadata.
- R21. The existing producer/private trace read path must remain accessible through `scope=mcp` on `/mcp/producer`.
- R22. Evidence accessor upgrades for user policy subjects must be deferred unless a later user-facing trace or derived-thinking resource requires them.
- R23. User-facing trace/thinking representation decisions must be deferred to a later product-policy and data-shaping slice.

**Consent, Copy, and Audit**

- R24. User-facing consent copy must describe `games` as "access your games via MCP" and explain that it covers games the user created or joined plus their player/agent records.
- R25. User-facing consent copy must state that `games` does not grant maintainer access, developer evidence access, or private trace access.
- R26. `games` authorization denial messages must not say that the user needs the `mcp` role.
- R27. Resource-selected auth and MCP audit logs must include subject, client, resource, issued scope, auth profile, tool name, outcome, denial reason, and correlation ID while redacting secrets and response bodies. Dynamic client registration audit records the requested scope set without a selected auth profile.

**Atomic Cutover and Tests**

- R28. The change must not leave a compatibility alias that keeps privileged producer access at old `/mcp`.
- R29. The app and database changes required to accept both scope/resource pairings must deploy as one coherent cutover.
- R30. Tests must cover the final authorization matrix for `/mcp` plus `games`, `/mcp/producer` plus `mcp`, and every wrong endpoint/scope/resource combination.
- R31. Tests must prove that `games` cannot discover, list, read, or search private trace data.
- R32. Tests must prove that `mcp` behavior remains producer-only and trace-capable on `/mcp/producer`.

---

## Key Flows

- F1. User authorizes game access
  - **Trigger:** A player connects an MCP client to the user-facing MCP resource.
  - **Actors:** A1, A3, A4, A5
  - **Steps:** The client discovers `/mcp`, requests `scope=games`, the user approves access, and the authorization server issues a resource-bound bearer token.
  - **Outcome:** The client can call user-facing tools for the subject's allowed game, player, and agent resources.
  - **Covered by:** R1, R3, R5, R9-R18, R24-R27

- F2. Maintainer uses producer MCP
  - **Trigger:** A maintainer connects an MCP client to the producer MCP resource.
  - **Actors:** A2, A3, A4, A5, A6
  - **Steps:** The client discovers `/mcp/producer`, requests `scope=mcp`, the maintainer authorizes with the `mcp` role, and the resource server dispatches producer tools after token validation.
  - **Outcome:** The maintainer keeps global read-only producer inspection, including private trace tools.
  - **Covered by:** R2, R4, R5, R19, R21, R32

- F3. Wrong boundary fails closed
  - **Trigger:** A request presents a valid token to the wrong MCP resource or with the wrong scope.
  - **Actors:** A3, A5, A7
  - **Steps:** The resource server validates the token's scope/resource pairing before JSON-RPC dispatch.
  - **Outcome:** No MCP tool or read model runs.
  - **Covered by:** R5-R8, R28-R30

- F4. Games client asks for trace data
  - **Trigger:** A `games` client tries to discover or call trace-related capabilities.
  - **Actors:** A1, A3, A5, A6
  - **Steps:** Tool discovery omits trace tools, direct trace tool calls are rejected, and trace metadata is not returned in user-facing resources.
  - **Outcome:** Private trace data remains producer-only.
  - **Covered by:** R16-R23, R31

---

## Acceptance Examples

- AE1. **Covers R1, R3, R5, R9-R13.**
  - **Given:** a user created one game, joined a second game, and has no relationship to a third game.
  - **When:** the user authorizes `scope=games` for `/mcp` and calls a game listing tool.
  - **Then:** the response includes only the created and joined games.

- AE2. **Covers R14-R18, R31.**
  - **Given:** a valid `games` token for `/mcp`.
  - **When:** the client lists tools or attempts to request producer visibility.
  - **Then:** producer/private trace tools are absent or rejected, and no producer-visibility data is returned.

- AE3. **Covers R2, R4, R19, R21, R32.**
  - **Given:** a maintainer with the `mcp` role has a valid `scope=mcp` token for `/mcp/producer`.
  - **When:** the maintainer lists tools.
  - **Then:** the existing producer inspection tools remain available, including explicit private trace tools.

- AE4. **Covers R5-R8, R28-R30.**
  - **Given:** a `games` token is sent to `/mcp/producer` or an `mcp` token is sent to `/mcp`.
  - **When:** the request reaches the MCP resource server.
  - **Then:** the request fails before JSON-RPC dispatch and the denial is audited without leaking secrets.

- AE5. **Covers R20-R23, R31.**
  - **Given:** private trace manifests exist for a game the user can otherwise access through `games`.
  - **When:** the user calls user-facing MCP tools for that game.
  - **Then:** no private trace content, manifest metadata, reasoning search result, raw prompt, or internal key is returned.

---

## Success Criteria

- A fresh MCP client can authorize `scope=games` against `/mcp` and read only the authenticated subject's allowed game/player/agent resources.
- A maintainer can authorize `scope=mcp` against `/mcp/producer` and keep the existing producer inspection surface.
- Wrong scope/resource/endpoint combinations fail before MCP dispatch.
- `games` tool discovery and responses contain no private trace access or trace metadata.
- Consent copy is understandable to a non-maintainer and does not mention the `mcp` role as a requirement for `games`.
- The authorization matrix is covered by automated tests that would fail if producer defaults leaked into `/mcp`.

---

## Scope Boundaries

In scope:

- User-facing MCP OAuth scope `games`.
- Trust-boundary endpoint split between `/mcp` and `/mcp/producer`.
- Resource-based authorization for created/joined games and owned player/agent records.
- Auth-context propagation into MCP server/read-model behavior.
- User-facing tool/resource partitioning.
- Final-state authorization matrix tests for the atomic cutover.

Out of scope:

- User-facing private trace, private reasoning, thinking, strategy packet, summary, or redacted derived-resource access.
- Evidence accessor migration for user policy subjects.
- Mutation tools or game lifecycle control through MCP.
- Refresh tokens, long-lived sessions, DPoP, machine-to-machine grants, or a general third-party OAuth app platform.
- Compatibility aliases or deprecation ceremony for privileged producer access at old `/mcp`.
- Reinterpreting existing `scope=mcp` tokens as user-scoped.

---

## Dependencies and Assumptions

- The production OAuth V0 with `scope=mcp` is already deployed or otherwise treated as the existing contract.
- The current database ownership seams are sufficient for the first `games` claim resolver: created games, joined game players, and user-owned agent profiles.
- User-facing MCP reads can be served from canonical game/player/agent read models without private trace reads.
- Existing producer/private trace storage and tools can move behind `/mcp/producer` without changing their data representation.
- MCP clients will respect protected-resource metadata and scope challenges well enough for the route split to be discoverable.

---

## Sources / Research

- Current ideation: `docs/ideation/2026-06-19-games-scope-mcp-oauth-hardening-ideation.html`
- Existing production OAuth requirements: `docs/brainstorms/2026-06-19-production-game-mcp-oauth-v0-requirements.md`
- Existing production OAuth docs: `docs/game-mcp-production-oauth.md`
- Existing production OAuth plan: `docs/plans/2026-06-19-001-feat-production-game-mcp-http-oauth-plan.md`
- OAuth service and metadata: `packages/api/src/services/mcp-oauth.ts`, `packages/api/src/routes/mcp-oauth.ts`
- MCP resource route and auth: `packages/api/src/routes/mcp.ts`, `packages/api/src/game-mcp/auth.ts`
- MCP server and read model: `packages/api/src/game-mcp/server.ts`, `packages/api/src/game-mcp/read-model.ts`
- Private trace and evidence access: `packages/api/src/services/private-trace-read-model.ts`, `packages/api/src/services/evidence-access.ts`
- Ownership/resource schema seams: `packages/api/src/db/schema.ts`, `packages/api/src/routes/games.ts`
- OAuth authorize UI and client helpers: `packages/web/src/app/oauth/mcp/authorize/authorize-client.tsx`, `packages/web/src/lib/mcp-oauth.ts`
