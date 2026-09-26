---
title: "Game asset implementation tasks"
date: 2026-09-25
status: implemented-awaiting-operator-review
plan: docs/plans/2026-09-25-003-feat-game-assets-plan.md
origin: docs/brainstorms/2026-09-25-game-assets-brainstorm.md
---

# Game asset implementation tasks

Implementation authorized through operator review on 2026-09-26. Branch `codex/game-assets` starts at freshly fetched `origin/main` (`a80dc90a`) in `/Users/user/.codex/worktrees/game-assets/influence-game`; the original checkout is preserved. The implementation uses migration `0100_game_assets.sql`. The user subsequently authorized committing and integrating this work into PR #153 (`codex/completed-replay-image-backfill`). No parallel agents, deployed writes, or real account assignments were used. Checked items describe implemented behavior and completed local evidence; T9 remains a separate deployed proof boundary.

## T0 — Refresh the handoff boundary

- [x] Inspect current branch/status and current `AGENTS.md`; preserve every unrelated edit. If the checkout is still actively dirty, follow the repository's commit-first/continue-in-place instruction. Do not independently stage, commit, or isolate the other agent's work.
- [x] Re-read schema/journal, index route registration, browser auth/API wrapper, OAuth consent/scopes, and private-storage configuration. Another agent was editing several of these shared files during planning.
- [x] Confirm the existing MinIO bootstrap/settings and identify the intended ephemeral or staging validation target. Preserve shared private-content objects; defer writes until implementation testing.
- [x] Choose the next available migration number at execution time; do not assume `0099` is available.
- [x] Apply the user's access correction: `public`/`spoiler` are presentation metadata, with no asset privacy filters. Public-game images are anonymous-readable; producer/sysop controls writes only.

**Done:** The working boundary and fresh migration slot are known; the plan's assumptions are either retained explicitly or revised coherently in all three documents. No live role/storage changes have occurred.

## T1 — Role and scoped token authority

**Depends on:** T0. **Owns:** `db/rbac-seed.ts`, `services/mcp-scope-policy.ts`, `services/mcp-oauth.ts`, relevant scope constraints/migration, OAuth types/consent groups, `middleware/game-asset-auth.ts`, focused auth tests. **Requirements:** R2-R4, R8.

- [x] Seed `manage_game_assets` onto the existing `producer` role and sysop; update the producer description. Do not add a new asset role, grant writes to admin alone, or assign real addresses.
- [x] Add opt-in `assets:manage` and consent eligibility based on current permission; support it across scope unions, schema checks, issuer metadata, exchange, refresh, and introspection.
- [x] Add a narrow route auth adapter that preserves existing opaque-token checks and app-session behavior; never change global `requireAuth` to accept MCP tokens.
- [x] Re-check DB permission rather than cached JWT role claims; prove loss of `manage_game_assets` stops existing asset-bearing grants and refreshes. A remaining sysop permission continues to authorize assets after removal of a separate producer role.
- [x] Prove wrong-scope, expired/revoked, wrong-resource/audience/purpose, roleless, and grants containing only OAuth scope `producer` cannot manage assets. Prove producers can obtain/use `assets:manage`, sysop can do so without an additional producer role, and asset-only scope cannot inspect producer traces or unrelated app routes.

**Done:** A current producer/sysop with `manage_game_assets` can consent to the grant. Authentication is usable by the future routes and current endpoints retain their boundary. No new role, auth store, or deployed token has been created.

## T2 — Asset schema and private storage

**Depends on:** T1. **Owns:** `db/schema.ts`, next migration/journal, `services/game-asset-storage.ts`, `services/game-assets.ts`, storage/schema tests. **Requirements:** R1, R4-R6, R9.

- [x] Add asset metadata and mutation-operation/upload-intent rows with typed outcomes, request fingerprints, revisions, storage references, tombstones, and cleanup state.
- [x] Add FKs/checks, request uniqueness, query indexes, and live-banner uniqueness by game, across presentation classifications.
- [x] Reuse private-content configuration and the same AWS SDK S3 adapter for private immutable PNG objects on local MinIO and deployed Linode, retaining path-style requests. Use `bun run s3:bootstrap` and `.env.private-trace.local` locally. No filesystem backend or public upload helper/fallback.
- [x] Validate/normalize bounded passive images with existing Sharp and derive hash/dimensions/type from accepted bytes.
- [x] Record candidate keys before storage, fence concurrent same-request attempts, and publish asset/reference plus applied receipt together. Expose recoverable storage/DB failure states.
- [x] Test private object configuration, corrupt/animated/oversized images, candidate-key recovery, concurrent publication, and absence of game-event/scene mutation.

**Done:** A service-level create/read operation stores private bytes and publishes bounded metadata; failures cannot publish partial assets. Production configuration failure is explicit.

## T3 — Upload and authorized reads end to end

**Depends on:** T1-T2. **Owns:** `routes/game-assets.ts`, route registration in `index.ts`, reader-policy helpers, API route tests. **Requirements:** R1, R4-R6, R9.

- [x] Implement `GET /api/game-assets/capabilities`, multipart create, paginated list, inspect, and authorized byte GET under the plan's endpoint family.
- [x] Apply streaming/body limits before multipart allocation; authorize writes before reading request bodies.
- [x] Resolve game slug/ID once and constrain every asset lookup to it. Keep existing game access/hidden policy and never use asset presentation metadata for authorization.
- [x] Return identical live source/actor metadata to all game viewers; omit storage keys and pending/tombstoned assets. Return not-found for inaccessible games or cross-game IDs.
- [x] Apply no-store/Vary/nosniff headers to metadata and bytes; do not return storage keys or direct storage URLs.
- [x] Exercise real file parsing plus an isolated in-process storage double with sequential PostgreSQL fixtures. Real MinIO writes belong to the explicit local smoke in T8; ordinary tests use no deployed credentials.

**Done:** An authenticated asset upload is retrievable by its permitted audience and denied to everyone else, including guessed IDs and cross-game reads.

## T4 — Login and first CLI workflow

**Depends on:** T3. **Owns:** `scripts/game-assets.ts`, root `package.json`, narrowly parameterized shared PKCE/token-file helpers, provider-free CLI tests. **Requirements:** R3, R6, R8-R9.

- [x] Add explicit API/web target selection, `login`, `logout`, `whoami`, `upload`, `list`, `show`, and `download` using native Bun fetch/FormData.
- [x] Parameterize the requested login scope without changing existing producer-login callers. Retain PKCE/state validation, loopback-only callback, timeout, and callback-server cleanup.
- [x] Keep origin/resource-bound token files separate per environment, directories 0700/files 0600, and tokens off stdout/logs. Reject HTTPS violations, credential URLs, and authenticated redirects. `whoami` checks the server; `logout` revokes remotely before removing the file or explicitly reports local-only removal with unconfirmed revocation.
- [x] Send `spoiler` presentation classification by default and explicit request IDs; expose meaningful JSON success/error outcomes. Download preserves exact normalized bytes and requires explicit overwrite intent.
- [x] Test through a fake HTTP server, temp files, token expiry/origin mismatch, scope selection, argument failures, redirect attempts, and lost upload response/retry.

**Done:** One local CLI login/upload/read/download flow works without DB/S3 secrets in the client. The same CLI accepts deployed URLs without server-specific code.

## T5 — Spoiler results banner placement and late discovery

**Depends on:** T3-T4. **Owns:** `web/src/components/game-banner.tsx`, `app/games/[slug]/results/page.tsx`, narrow web API/types, deterministic browser fixtures. **Requirements:** R4, R7-R9.

- [x] Mount the banner exclusively on `/games/[slug]/results`, below its heading and above `GameViewer`. Keep it out of the shared viewer and other routes. Load ready banner metadata lazily on results entry, auth/game changes, and window focus while mounted; render the single banner independent of presentation classification.
- [x] Fetch content anonymously on public games, using a session when needed for existing game access, create/revoke object URLs, abort stale work, and fence auth/game-generation completions.
- [x] Render a responsive full-width image preserving its aspect ratio and embedded teaser content. With no asset, the current results page stays intact; errors offer a small retry action without blocking results content.
- [x] Test anonymous public-game spoiler reads, existing private-game audience, public banner reload after logout, route cleanup, and late upload discovered on focus. Assert no banner rendering or banner requests on the landing, replay, highlights, or library, including navigation away from results for the same game.
- [x] Keep these banners out of existing covers/cards/OG metadata and existing gameplay scenes; results-only placement adds no spoiler/phase predicate or image generation on read.

**Done:** First usable slice: an uploaded spoiler banner appears exclusively on `/games/[slug]/results` for an old/new game and authorized viewers, and results content continues to work. Document this checkpoint before adding remaining CRUD.

## T6 — Complete mutation and recovery workflows

**Depends on:** T2-T5. **Owns:** asset service/routes/CLI mutation commands and focused concurrency/recovery tests. **Requirements:** R6, R8-R9.

- [x] Add closed-schema metadata PATCH, immutable image replacement, revision-fenced deletion, operation receipt lookup, and explicit unreferenced-object cleanup.
- [x] Add CLI `update`, `replace`, `delete`, `receipt`, and `cleanup`; require caller-visible revisions and preserve request IDs across retries.
- [x] Prove stale revisions/duplicate conflicting IDs return 409; competing banner creates cannot produce two live banners; retries cannot overwrite a newer writer.
- [x] Prove a failed replacement preserves prior pixels, deletion immediately denies reads, cleanup failure remains visible/retryable, and cleanup cannot remove a currently referenced object. Race cleanup against an in-flight upload: shared operation fencing must stop a cleaned candidate from later being published.
- [x] Prove changing `public`/`spoiler` metadata leaves anonymous access intact; writer role removal blocks edits without restricting reads. Keep cursors shared across game viewers and bind explicit filters.

**Done:** The full CRUD loop is usable and partial outcomes have reliable receipts/recovery. No cleanup requires direct bucket credentials in the client.

## T7 — Skill and operating documentation

**Depends on:** T4-T6. **Owns:** `.agents/skills/manage-game-assets/SKILL.md`, `docs/game-assets.md`, related OAuth/development/concept/solution documentation. **Requirements:** R1-R9.

- [x] Write a concise discoverable repository skill for environment selection, login, CRUD, banner/spoiler conventions, receipt recovery, and cleanup. Use actual final CLI options, not unimplemented examples from this plan.
- [x] Route substantial API/storage detail to `docs/game-assets.md`; document private bucket env, existing local MinIO bootstrap/settings, ephemeral/staging validation, one-hour login expiry, token separation, and expected request/revision conflicts.
- [x] Document the intentional `assets:manage` REST extension of the existing protected OAuth service and unchanged unrelated app/MCP boundaries.
- [x] Update `DEVELOPMENT.md`, `CONCEPTS.md`, `docs/game-mcp-production-oauth.md`, and a frontmatter-bearing `docs/solutions/` learning as appropriate.
- [x] Validate skill frontmatter/naming using `/Users/user/.codex/skills/.system/skill-creator/scripts/quick_validate.py`; verify every advertised CLI command with help or fixture-backed execution.

**Done:** A new agent can perform authorized local/deployed asset operations from the skill without rediscovering management authority, spoiler labels, or recovery semantics.

## T8 — Required checks and review

**Depends on:** T1-T7. **Owns:** final validation and fixes within the implementation's files. **Requirements:** R10.

- [x] Run `bun run test`, `bun run test:postgres` with elevated local-Postgres access, and `bun run check`; preserve/report unrelated dirty work and pre-existing failures.
- [x] Run targeted deterministic banner/auth browser journeys. API browser harnesses own/drop per-process DBs and terminate children; root Playwright specs need explicit classification if added.
- [x] Add and run a separately invoked `*.external-smoke.test.ts` journey against local MinIO using the real S3 adapter. Verify upload/read/download/update/replace/delete, receipts/cleanup, and anonymous direct-object denial with disposable fixtures and local credentials. Remove only the run's assets/objects; preserve the bucket and trace content.
- [ ] Run a read-only Grok review of the actual scoped diff if available under repo preferences; address confirmed auth/storage/concurrency/API-contract problems. Do not send unrelated dirty changes for review.
- [x] Check diff, migrations, docs/examples, no `as any`, no swallowed errors, no public private-content URL, no live-provider/external-write credentials in ordinary tests.
- [x] Report actual local test results, outstanding proof limits, and affected artifacts. Do not commit/push/deploy unless authorized.

**Done:** The implementation is locally verified and reviewable, including a real MinIO CRUD round trip; deployment proof remains explicitly tracked in T9.

## T9 — Ephemeral or staging deployment proof

**Depends on:** T8 and a runnable ephemeral or staging deployment. **Owns:** non-production end-to-end validation and its evidence. **Requirements:** R10. The user selected these test environments. This handoff stops at operator review; carry out acceptance after the branch has a runnable release and the operator selects the exact non-production target/test identity.

- [ ] Resolve the exact ephemeral or staging API/web origins, release, test identity, and disposable game before the run. Keep its credentials separate from local CLI tokens and ordinary CI.
- [ ] Complete real browser OAuth as a producer/sysop with `manage_game_assets`; exercise upload/read/download/update/replace/delete and operation recovery with the CLI.
- [ ] Prove the private Linode object is anonymously unreadable, the public-game API/browser can render it anonymously, and the deployed ingress accepts the documented bounded request size.
- [ ] Prove the spoiler banner appears only on `/games/[slug]/results`, reloads anonymously on public-game logout and clears on navigation, and discovers a later upload on focus.
- [ ] Prove role removal/token revocation denies management operations while public-game image reads stay available; restore any deliberately changed role only within the authorized test procedure.
- [ ] Record environment/release, operation IDs, cleanup result, and browser/storage/auth evidence without tokens or secrets. Local tests must not be described as deployed proof.

**Done:** The feature is verified on an ephemeral deployment or staging, and disposable asset/role changes have been cleaned up. Report any remaining deployed boundary precisely.

## Readiness checklist for the implementer

The feature is implemented locally. Review [the operating guide](../game-assets.md) and [the operator handoff](../deployment/game-assets-operator-review.md), then resolve T9 against a runnable ephemeral/staging release. Asset classification is presentation only: public-game images are anonymous-readable, existing private/hidden game access remains intact, and roles control writes. No production proof is claimed. Changes to this default must update policy, route/browser tests, CLI/skill examples, and documentation together.


## Initial local execution evidence — 2026-09-26

- `bun run test`: 2,022 passed, 5 skipped, 0 failed across 191 files.
- `bun run test:postgres`: 1,743 passed, 0 failed across 147 files; 19,989 assertions. Shared test fixtures used the process-lifetime advisory lock.
- Final `bun run check`: every workspace typecheck and lint passed.
- Focused API regressions: 13 passed, 97 assertions. `spoiler`/`public` metadata never changes anonymous public-game access; role removal blocks edits while reads stay available. Existing private/hidden game rules, strict obsolete-value rejection, shared cursors, body/image bounds, revision conflicts, and cleanup/publication races are covered.
- Focused CLI/banner tests: 13 passed, 58 assertions. Public reads need no saved token; metadata edits preserve request/revision inputs, and stale blob/fetch cleanup remains fenced.
- Real MinIO smoke: 1 passed, 16 assertions using the existing local content settings, genuine opaque OAuth, CLI CRUD, default `spoiler`, exact anonymous API bytes, immutable conditional storage writes, receipts, remote logout, and disposable-object cleanup.
- Deterministic browser journey: 1 passed, 13 assertions with real API/Next/Chrome, an isolated DB, and a storage fixture. A late spoiler banner appears anonymously only on results, reloads after sign-out, follows existing protected-game access, and triggers no requests on other routes. The screenshot was visually inspected.
- Skill validator: valid. Upload/update/list help exposes `--visibility`; the operating guide and skill document `public`/`spoiler` as presentation only.
- Release migration policy accepted `0100_game_assets.sql`; final diff checks passed. The draft migration was refreshed only in the locked local shared test database, with no compatibility migration or deployed change.
- Task-owned temporary API/web/browser/callback processes stopped; existing Docker Postgres/MinIO and unrelated work remain. Harness-generated web configuration changes were removed. Deployed OAuth, Linode, ingress, and T9 remain unproven until non-production acceptance.

Read-only Grok attempts on the earlier scoped implementation returned no finding report; independent review remains pending. All task-owned review/helper processes were stopped. No clean external review is claimed.

## PR #153 integration evidence — 2026-09-26

The combined replay-production and editorial-assets changes pass 2,028 provider-free tests (5 skipped), 1,758 PostgreSQL tests, 26 API browser tests, and 13 public-identity browser tests. The replay browser journey verifies publication through the remaining-scene count, persisted publication, published version, and viewer API. The public-identity journey covers both desktop and mobile creation with inactive editor controls hidden natively. Browser output paths use the platform temporary directory; standing-agent teardown has an explicit cleanup bound. The current validation summary is maintained in [the operator handoff](../deployment/game-assets-operator-review.md). T9 remains unperformed.
