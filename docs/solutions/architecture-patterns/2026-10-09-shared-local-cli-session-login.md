---
title: Share checked browser sessions across local API CLIs
module: Local API simulation and replay export
problem_type: integration_issue
date: 2026-10-09
tags: [authentication, cli, browser, permissions, export, simulation]
---

# Shared local CLI session login

API simulation and replay export use one ordinary app-session helper. A valid private cache is reused only after a fresh read of the exact configured API's `/api/auth/me`. A missing, expired or HTTP 401 session opens `/auth/cli` in the existing House web app. The operator signs in through the normal authentication owner and explicitly authorizes the waiting terminal. No new token issuer or OAuth grant is introduced.

Do not substitute the Producer MCP OAuth grant for this session. Its scope is narrower than the existing Studio Producer/Sysop contract. Export requires one of those current roles; simulation requires its existing game-operation permissions. The same cached account can satisfy either operation, but each CLI checks its own requirements. Permission revocation and network/server failures fail clearly instead of opening repeated login windows.

Bind cached credentials to the API origin. Web origins can change independently, especially with isolated local review hosts; reuse across a changed web origin is safe only after validation at the same API. Cache files live in a private 0700 directory as regular 0600 files, have bounded size, and are atomically replaced. JWT expiry is a freshness hint, never the authentication authority. Explicit `INFLUENCE_API_SESSION_TOKEN` credentials bypass browser/cache handling and are never persisted. Offline bundle rendering remains network and authentication free.

The browser handoff contains no credential in its URL. Its random state, exact API origin, exact loopback target, expected browser Origin and JSON body are checked before API validation and cache writes. The web page allows only the configured API origins. Session/account changes fence late browser requests. Closing or cancelling the terminal must also terminate incomplete callback requests; graceful server shutdown alone can leave an unfinished body alive after the helper has rejected. Successful handoff keeps its acknowledgement readable by the browser.

Proof is local and deterministic: temporary fake API/callback tests exercise cache freshness, role changes, cancellation and request rejection; the canonical browser fixture exercises both Producer and Sysop authorization and checked cache reuse against a real local API. These tests do not establish real Clerk sign-in, deployed CORS/network behavior or operator acceptance.

Configured internal backend origins and externally requested CLI origins have different trust boundaries. Docker config uses `API_BACKEND_URL=http://api:3001`; parsing that trusted server configuration through the external HTTPS/loopback rule made public web sign-in fail before origin comparison. Normalize the configured backend for allowlist comparison with `new URL(...).origin`, while continuing to require HTTPS or loopback HTTP for every requested CLI target. Do not allow a CLI to request Docker's internal HTTP origin. Focused target tests cover public same-origin login with the Docker backend, rejected internal HTTP targets and unrelated public origins.
