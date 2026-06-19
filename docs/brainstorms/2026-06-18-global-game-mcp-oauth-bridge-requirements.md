---
date: 2026-06-18
topic: global-game-mcp-oauth-bridge
---

# Global Game MCP OAuth Bridge Requirements

## Summary

Influence should add a V0 OAuth path for trusted Game MCP validation: the app/API acts as an OAuth token producer, a user with the `mcp` role can authorize `scope=mcp` through authorization code plus PKCE, and the resulting token can be used with a local bridge to the existing read-only Game MCP. The scope is intentionally global across the Game MCP corpus and does not introduce per-agent, per-game, or Trace MCP boundaries.

---

## Problem Frame

The local Game MCP is already the best query surface for simulation validation. It can list sessions and games, read projections, search logs, return timelines, expose linked records, and read artifact resources by URI.

The missing first step is not a complete public MCP authorization platform. It is a working, role-gated OAuth loop that proves a trusted maintainer can obtain an MCP-scoped token and use it against the existing Game MCP behavior without broadening the scope into private trace access or fine-grained user delegation.

That means the fullstack app must own the token-producer pieces, not just the local bridge consumer. V0 needs an app authorization entrypoint that can reuse the logged-in browser state, an API token exchange that mints an MCP access token, a static local MCP client policy, and enough token validation contract for the bridge to reject the wrong token before any Game MCP read happens.

---

## Key Decisions

- **Local bridge first.** The first completion target is a local token-gated bridge to the existing stdio Game MCP, not a protected production HTTP MCP endpoint.
- **App token producer is first-class.** The app/API must expose the V0 authorization and token exchange surfaces; the local bridge is the first consumer of the produced token.
- **Global MCP scope.** `scope=mcp` grants global read-only Game MCP access for V0; it is not scoped to an agent, game, session, player, or private content boundary.
- **Role-gated issuance.** Only a logged-in user with the `mcp` role can authorize `scope=mcp`.
- **Static local OAuth client.** V0 uses a configured first-party public client and allowlisted loopback redirect URI policy, not dynamic registration or external client onboarding.
- **OAuth loop over custom API key.** The slice must prove authorization code plus PKCE rather than solving this with an app-session claim or static token.
- **Game MCP only.** Trace MCP and private-content access remain separate future work.

---

## Actors

- A1. Maintainer with the `mcp` role who wants to validate games through MCP.
- A2. Logged-in user without the `mcp` role who must not be able to mint MCP access.
- A3. App OAuth authorization entrypoint that receives the browser authorization request, reuses the logged-in app state, and returns approval, denial, cancellation, or OAuth error through the configured redirect.
- A4. API OAuth issuer/token producer that validates client policy, app login, PKCE, authorization code state, and role-bound scope eligibility.
- A5. Local Game MCP bridge that validates the MCP token before forwarding requests.
- A6. Existing Game MCP server and read model over simulation artifacts.
- A7. Future protected HTTP MCP surface, deferred from this slice.

---

## Requirements

**Role and scope contract**

- R1. The system must define an `mcp` role that can be assigned through the existing RBAC role-assignment model.
- R2. The V0 OAuth scope set must support `mcp` as the only in-scope delegated scope.
- R3. The API must authorize `scope=mcp` only for a logged-in user whose current RBAC roles include `mcp`.
- R4. A request for unsupported scopes must fail rather than silently broadening or partially granting access.
- R5. A token with `scope=mcp` must represent global read-only access to the Game MCP corpus.
- R6. The `mcp` scope must not imply app admin permissions, normal API permissions, Trace MCP access, private-content access, or game mutation rights.

**OAuth token producer behavior**

- R7. The app must expose a first-party OAuth authorization entrypoint that can reuse the existing logged-in app state before the user can authorize `scope=mcp`.
- R8. The authorization entrypoint must accept only a registered V0 public client, exact allowlisted redirect URI, `response_type=code`, required `state`, `scope=mcp`, and PKCE S256 challenge.
- R9. The authorization entrypoint must reject unregistered clients, redirect mismatches, missing `state`, unsupported scopes, unsupported PKCE methods, and requests without an existing logged-in app session.
- R10. The authorization step must present a minimal approve, deny, or cancel decision that names global Game MCP access.
- R11. On approval, the issuer must create a short-lived, single-use authorization code bound to the user, `scope=mcp`, `client_id`, `redirect_uri`, PKCE challenge, and current `mcp` role eligibility.
- R12. Authorization denial, cancellation, missing session, invalid request, or failed role check must return an OAuth error through the configured redirect when safe to do so, preserve `state` when supplied, and issue no code or token.
- R13. The token endpoint must exchange only `grant_type=authorization_code` requests and must re-check `client_id`, `redirect_uri`, authorization-code expiry, single-use status, PKCE verifier, scope, and current `mcp` role eligibility.
- R14. Token exchange must fail when the authorization code is expired, reused, mismatched with its verifier, mismatched with its redirect or client, or no longer associated with an `mcp`-role user.
- R15. Successful token exchange must return a bearer token response with `access_token`, `token_type`, `expires_in`, and `scope`; it must not issue a refresh token.
- R16. MCP access tokens must be distinct from app session tokens so an MCP token cannot be used as a normal app login session and a normal app session token cannot satisfy MCP bridge authorization.
- R17. The MCP token contract must expose, either as signed claims or introspection fields, a dedicated issuer, audience such as `game-mcp`, subject, `client_id`, scope, token purpose/type, and expiry.
- R18. V0 must define active-token containment before implementation: role removal must block new authorization and token exchange, and existing bearer tokens must be contained by either live revocation/introspection or a strict maximum short TTL with documented emergency invalidation behavior.
- R19. V0 must not include refresh tokens, dynamic client registration, DPoP, external client policy, or multi-scope consent.

**Local bridge behavior**

- R20. The local bridge must reject every MCP request that lacks a valid token with `scope=mcp`.
- R21. The local bridge must validate the token issuer, audience, token purpose/type, expiry, subject, `client_id`, scope, and verification result before invoking the Game MCP read model.
- R22. After token validation, the local bridge must preserve the existing Game MCP capabilities and read semantics.
- R23. The local bridge must support the existing Game MCP resource flow, including resource listing and artifact reads by MCP resource URI.
- R24. The local bridge must support the existing Game MCP tool flow, including session listing, game listing, projection reads, event filtering, player timelines, log search, and linked records.
- R25. The local bridge must remain local developer tooling for V0 and must not claim production readiness, public packaging, or a hosted MCP endpoint.
- R26. OAuth and bridge audit logs must record user, `client_id`, scope, result, denial reason, and correlation ID, while never logging access tokens, authorization codes, PKCE verifiers, Authorization headers, redirect query secrets, local token handoff files, or artifact contents.

**Validation and documentation**

- R27. A producer smoke path must prove the app authorization entrypoint and token endpoint can issue a valid MCP bearer token response before the bridge consumes it.
- R28. A maintainer end-to-end smoke path must prove role assignment, OAuth authorization, token exchange, bridge access, and at least one successful Game MCP read.
- R29. A negative authorization smoke path must prove that a logged-in user without the `mcp` role cannot authorize `scope=mcp`.
- R30. Producer negative tests must cover missing app session, unsupported scope, unregistered client, redirect mismatch, missing state, denial/cancellation, expired code, reused code, PKCE mismatch, redirect/client mismatch during token exchange, and role removal before token exchange.
- R31. A negative bridge path must prove that missing, invalid, expired, wrong-audience, wrong-purpose, wrong-scope, app-session, or normal API tokens cannot read Game MCP data.
- R32. A normal app/API auth path must reject MCP access tokens as app session credentials.
- R33. Documentation must label `scope=mcp` as global Game MCP access and name the deferred fine-grained boundaries.

---

## Key Flows

- F1. Maintainer authorizes global Game MCP access
  - **Trigger:** A maintainer wants to use a local MCP client against Influence simulation artifacts.
  - **Actors:** A1, A3, A4
  - **Steps:** The maintainer signs into the app, starts a PKCE authorization request for the static local MCP client, approves global Game MCP access, and receives an authorization code through the allowlisted redirect with `state` preserved.
  - **Outcome:** The maintainer receives an authorization code that can be exchanged only by the matching client, redirect, and PKCE verifier.
  - **Covered by:** R1-R12

- F2. Token producer exchanges code for MCP token
  - **Trigger:** The local OAuth client receives the authorization code.
  - **Actors:** A1, A4
  - **Steps:** The client submits the code, verifier, `client_id`, redirect URI, and authorization-code grant to the token endpoint.
  - **Outcome:** The producer returns a short-lived bearer token response for the `game-mcp` audience and `scope=mcp`.
  - **Covered by:** R13-R19

- F3. Local bridge gates existing Game MCP behavior
  - **Trigger:** A local MCP client sends a request through the bridge.
  - **Actors:** A1, A5, A6
  - **Steps:** The bridge validates the bearer token contract for the `game-mcp` audience and `scope=mcp`, then forwards or delegates the request to the existing Game MCP behavior.
  - **Outcome:** The client can use the current Game MCP tools and resources without new query semantics.
  - **Covered by:** R20-R26

- F4. Non-role or invalid OAuth request is denied
  - **Trigger:** A logged-in user without the `mcp` role requests `scope=mcp`.
  - **Actors:** A2, A3, A4
  - **Steps:** The app/API checks session, client, redirect, state, PKCE, scope, and role eligibility during authorization and token exchange.
  - **Outcome:** No authorization code or MCP access token is issued.
  - **Covered by:** R3, R4, R8-R14, R18, R29-R30

- F5. Invalid bridge request is denied before data access
  - **Trigger:** A bridge request arrives without a valid `scope=mcp` token.
  - **Actors:** A5, A6
  - **Steps:** The bridge validates the token before invoking the Game MCP read model.
  - **Outcome:** Invalid requests fail without listing sessions, games, tools, resources, or artifact content.
  - **Covered by:** R20-R21, R31-R32

---

## Acceptance Examples

- AE1. Covers R1-R12.
  - **Given:** A logged-in maintainer has the `mcp` role.
  - **When:** they request `scope=mcp` through authorization code plus PKCE.
  - **Then:** the app authorization entrypoint approves global Game MCP access and redirects with an authorization code plus preserved `state`.

- AE2. Covers R13-R19, R27, R32.
  - **Given:** the maintainer has a valid authorization code and matching PKCE verifier.
  - **When:** the local client exchanges the code at the token endpoint.
  - **Then:** the producer returns a bearer response with `access_token`, `token_type`, `expires_in`, and `scope`, and the token cannot be used as an app session credential.

- AE3. Covers R3, R4, R29.
  - **Given:** a logged-in user does not have the `mcp` role.
  - **When:** they request `scope=mcp`.
  - **Then:** authorization fails and no code or token is issued.

- AE4. Covers R8-R14, R30.
  - **Given:** an OAuth request has a missing app session, unsupported scope, unregistered client, redirect mismatch, missing state, denial/cancellation, expired code, reused code, PKCE mismatch, token-exchange redirect/client mismatch, or role removal before exchange.
  - **When:** the authorization or token endpoint handles the request.
  - **Then:** the producer returns an OAuth error where appropriate and issues no usable MCP token.

- AE5. Covers R5, R20-R24.
  - **Given:** a local MCP client presents a valid token with `scope=mcp`.
  - **When:** it calls the bridge to initialize, list sessions, list games, read a projection, search logs, or read a resource URI.
  - **Then:** the bridge permits the request and preserves the existing Game MCP response semantics.

- AE6. Covers R6, R19, R25.
  - **Given:** the V0 bridge exists.
  - **When:** a user expects Trace MCP access, private-content reads, refresh-token renewal, hosted public MCP, or per-game grants.
  - **Then:** those capabilities are absent and documented as out of scope.

- AE7. Covers R20-R21, R31.
  - **Given:** a bridge request has no token, an invalid token, an expired token, a wrong-audience token, a wrong-purpose token, an app session token, or a token without `scope=mcp`.
  - **When:** it asks for any Game MCP tool or resource.
  - **Then:** the request fails before the existing Game MCP read model is invoked.

---

## Success Criteria

- A maintainer with the `mcp` role can complete the app-hosted authorization flow, exchange the code with the API token producer, and use the resulting token through the local bridge.
- A user without the `mcp` role cannot authorize `scope=mcp`.
- OAuth producer failures return errors without issuing usable codes or tokens.
- Missing, invalid, expired, wrong-audience, wrong-purpose, app-session, and wrong-scope bridge requests cannot read Game MCP data.
- Existing Game MCP tools and resource URI reads behave the same through the bridge once a token is accepted.
- Producer and bridge validation agree on issuer, audience, subject, client, scope, token purpose/type, expiry, and verification method.
- The requirements and docs clearly state that V0 `scope=mcp` is global Game MCP access for trusted validation.

---

## Scope Boundaries

In scope:

- New `mcp` role and `scope=mcp` authorization eligibility.
- App authorization entrypoint, API token endpoint, and authorization code plus PKCE for issuing short-lived MCP access tokens.
- Static local MCP client policy, allowlisted loopback redirect policy, OAuth error handling, and bearer token response shape.
- Token validation contract and active-token containment policy for Game MCP bearer tokens.
- Local bridge that gates the existing stdio Game MCP behavior.
- Redacted OAuth and bridge audit logging.
- Positive and negative smoke validation for role-gated issuance, token production, normal-app-token separation, and bridge access.
- Documentation that names the global nature of the scope.

Out of scope:

- Protected production HTTP MCP server.
- Trace MCP and private-content access.
- Per-agent, per-game, per-session, per-player, or row-level scopes.
- Refresh tokens, DPoP, dynamic client registration, and external client onboarding.
- Hosted/public packaging, product admin UI, and broad consent dashboards.
- Game mutation tools or any expansion of Game MCP beyond its current read-only behavior.

---

## Dependencies and Assumptions

- Existing Privy-backed app login remains the human-auth prerequisite for authorizing the MCP scope.
- Existing RBAC role assignment remains the source of truth for whether a user can authorize `scope=mcp`.
- The authorization entrypoint may need to be an app route/page that forwards the existing logged-in state to the API issuer if the API cannot see the browser login during a plain OAuth redirect.
- The static V0 OAuth client and allowlisted redirect URI values are configuration, not a dynamic registration feature.
- The local bridge can be developer tooling for V0 while the OAuth issuer runs through the API-side auth path.
- The token can be opaque with introspection or self-contained with local verification as long as the producer and bridge share the explicit token contract.
- The existing Game MCP remains read-only and corpus-level over simulation artifacts.
- Planning may choose exact URI values, token lifetime, bridge command shape, and local token handoff within the constraints above.

---

## Outstanding Questions

Resolve before planning:

- Whether MCP tokens are opaque with server-side introspection/revocation or signed self-contained bearer tokens with bridge-local verification.
- Whether active-token containment is live revocation/introspection after role removal or expiry-only with a strict short TTL, plus the emergency invalidation behavior for leaked bearer tokens.
- Whether the first authorization entrypoint is an app page that forwards the existing bearer session to the API issuer or an auth/session model visible directly to an API redirect endpoint.
- Where the local bridge receives or stores the MCP token and what cleanup behavior is required.

Deferred to planning:

- Exact local bridge command and client invocation shape.
- Exact token lifetime and storage handoff for local development after the containment policy is chosen.
- Exact redirect URI value and static client ID value for the PKCE flow.
- Whether the first smoke should use a fixed fixture batch or the newest event-backed simulation batch.

---

## Sources

- `docs/ideation/2026-06-18-oauth-agent-game-delegation-ideation.html`
- `README.md`
- `DEVELOPMENT.md`
- `CONCEPTS.md`
- `packages/api/src/routes/auth.ts`
- `packages/api/src/middleware/auth.ts`
- `packages/api/src/db/schema.ts`
- `packages/api/src/db/rbac-seed.ts`
- `packages/api/package.json`
- `packages/engine/src/game-mcp/server.ts`
