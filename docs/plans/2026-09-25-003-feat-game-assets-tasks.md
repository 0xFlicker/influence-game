---
title: "Game asset implementation tasks"
date: 2026-09-25
status: ready-after-current-repo-work
plan: docs/plans/2026-09-25-003-feat-game-assets-plan.md
origin: docs/brainstorms/2026-09-25-game-assets-brainstorm.md
---

# Game asset implementation tasks

Planning handoff only. All implementation boxes remain unchecked. Execute sequentially in this checkout after the current application work is accounted for and execution is authorized. These tasks are ownership boundaries, not authorization to launch parallel agents or another chat. Re-read the linked plan for exact privacy, auth, API, and failure contracts.

## T0 — Refresh the handoff boundary

- [ ] Inspect current branch/status and current `AGENTS.md`; preserve every unrelated edit. If the checkout is still actively dirty, follow the repository's commit-first/continue-in-place instruction. Do not independently stage, commit, or isolate the other agent's work.
- [ ] Re-read schema/journal, index route registration, browser auth/API wrapper, OAuth consent/scopes, and private-storage configuration. Another agent was editing several of these shared files during planning.
- [ ] Confirm the existing MinIO bootstrap/settings and identify the intended ephemeral or staging validation target. Preserve shared private-content objects; defer writes until implementation testing.
- [ ] Choose the next available migration number at execution time; do not assume `0099` is available.
- [ ] Carry forward the plan's explicit reader default: authenticated plus existing game audience, with global producer/sysop asset inspection through current `manage_game_assets`. Incorporate any later user correction before policy code.

**Done:** The working boundary and fresh migration slot are known; the plan's assumptions are either retained explicitly or revised coherently in all three documents. No live role/storage changes have occurred.

## T1 — Role and scoped token authority

**Depends on:** T0. **Owns:** `db/rbac-seed.ts`, `services/mcp-scope-policy.ts`, `services/mcp-oauth.ts`, relevant scope constraints/migration, OAuth types/consent groups, `middleware/game-asset-auth.ts`, focused auth tests. **Requirements:** R2-R4, R8.

- [ ] Seed `manage_game_assets` onto the existing `producer` role and sysop; update the producer description. Do not add a new asset role, grant writes to admin alone, or assign real addresses.
- [ ] Add opt-in `assets:manage` and consent eligibility based on current permission; support it across scope unions, schema checks, issuer metadata, exchange, refresh, and introspection.
- [ ] Add a narrow route auth adapter that preserves existing opaque-token checks and app-session behavior; never change global `requireAuth` to accept MCP tokens.
- [ ] Re-check DB permission rather than cached JWT role claims; prove loss of `manage_game_assets` stops existing asset-bearing grants and refreshes. A remaining sysop permission continues to authorize assets after removal of a separate producer role.
- [ ] Prove wrong-scope, expired/revoked, wrong-resource/audience/purpose, roleless, and grants containing only OAuth scope `producer` cannot manage assets. Prove producers can obtain/use `assets:manage`, sysop can do so without an additional producer role, and asset-only scope cannot inspect producer traces or unrelated app routes.

**Done:** A current producer/sysop with `manage_game_assets` can consent to the grant. Authentication is usable by the future routes and current endpoints retain their boundary. No new role, auth store, or deployed token has been created.

## T2 — Asset schema and private storage

**Depends on:** T1. **Owns:** `db/schema.ts`, next migration/journal, `services/game-asset-storage.ts`, `services/game-assets.ts`, storage/schema tests. **Requirements:** R1, R4-R6, R9.

- [ ] Add asset metadata and mutation-operation/upload-intent rows with typed outcomes, request fingerprints, revisions, storage references, tombstones, and cleanup state.
- [ ] Add FKs/checks, request uniqueness, query indexes, and live-banner uniqueness by game/visibility.
- [ ] Reuse private-content configuration and the same AWS SDK S3 adapter for private immutable PNG objects on local MinIO and deployed Linode, retaining path-style requests. Use `bun run s3:bootstrap` and `.env.private-trace.local` locally. No filesystem backend or public upload helper/fallback.
- [ ] Validate/normalize bounded passive images with existing Sharp and derive hash/dimensions/type from accepted bytes.
- [ ] Record candidate keys before storage, fence concurrent same-request attempts, and publish asset/reference plus applied receipt together. Expose recoverable storage/DB failure states.
- [ ] Test private object configuration, corrupt/animated/oversized images, candidate-key recovery, concurrent publication, and absence of game-event/scene mutation.

**Done:** A service-level create/read operation stores private bytes and publishes bounded metadata; failures cannot publish partial assets. Production configuration failure is explicit.

## T3 — Upload and authorized reads end to end

**Depends on:** T1-T2. **Owns:** `routes/game-assets.ts`, route registration in `index.ts`, reader-policy helpers, API route tests. **Requirements:** R1, R4-R6, R9.

- [ ] Implement `GET /api/game-assets/capabilities`, multipart create, paginated list, inspect, and authorized byte GET under the plan's endpoint family.
- [ ] Apply streaming/body limits before multipart allocation; authorize writes before reading request bodies.
- [ ] Resolve game slug/ID once and constrain every asset lookup to it. Apply outer game visibility/hidden policy and inner asset visibility independently.
- [ ] Omit private metadata/counts/operational fields from ordinary read DTOs and return not-found for unauthorized direct IDs.
- [ ] Apply no-store/Vary/nosniff headers to metadata and bytes; do not return storage keys or direct storage URLs.
- [ ] Exercise real file parsing plus an isolated in-process storage double with sequential PostgreSQL fixtures. Real MinIO writes belong to the explicit local smoke in T8; ordinary tests use no deployed credentials.

**Done:** An authenticated asset upload is retrievable by its permitted audience and denied to everyone else, including guessed IDs and cross-game reads.

## T4 — Login and first CLI workflow

**Depends on:** T3. **Owns:** `scripts/game-assets.ts`, root `package.json`, narrowly parameterized shared PKCE/token-file helpers, provider-free CLI tests. **Requirements:** R3, R6, R8-R9.

- [ ] Add explicit API/web target selection, `login`, `logout`, `whoami`, `upload`, `list`, `show`, and `download` using native Bun fetch/FormData.
- [ ] Parameterize the requested login scope without changing existing producer-login callers. Retain PKCE/state validation, loopback-only callback, timeout, and callback-server cleanup.
- [ ] Keep origin/resource-bound token files separate per environment, directories 0700/files 0600, and tokens off stdout/logs. Reject HTTPS violations, credential URLs, and authenticated redirects. `whoami` checks the server; `logout` revokes remotely before removing the file or explicitly reports local-only removal with unconfirmed revocation.
- [ ] Send private upload visibility by default and explicit request IDs; expose meaningful JSON success/error outcomes. Download preserves exact normalized bytes and requires explicit overwrite intent.
- [ ] Test through a fake HTTP server, temp files, token expiry/origin mismatch, scope selection, argument failures, redirect attempts, and lost upload response/retry.

**Done:** One local CLI login/upload/read/download flow works without DB/S3 secrets in the client. The same CLI accepts deployed URLs without server-specific code.

## T5 — Private results banner placement and late discovery

**Depends on:** T3-T4. **Owns:** `web/src/components/game-banner.tsx`, `app/games/[slug]/results/page.tsx`, narrow web API/types, deterministic browser fixtures. **Requirements:** R4, R7-R9.

- [ ] Mount the banner exclusively on `/games/[slug]/results`, below its heading and above `GameViewer`. Keep it out of the shared viewer and other routes. Load ready banner metadata lazily on results entry, auth/game changes, and window focus while mounted; prefer authorized private over public banners.
- [ ] Fetch content with session authorization, create/revoke object URLs, abort stale work, and fence auth/game-generation completions.
- [ ] Render a responsive full-width image preserving its aspect ratio and embedded teaser content. No asset leaves the current results page intact; errors offer a small retry action without blocking results content.
- [ ] Test anonymous/private denial, signed-in results access under the chosen policy, private-game audience, logout/route cleanup, and late upload discovered on focus. Assert no banner rendering or banner requests on the landing, replay, highlights, or library, including navigation away from results for the same game.
- [ ] Keep private assets out of existing covers/cards/OG metadata and existing gameplay scenes; results-only placement adds no spoiler/phase predicate or image generation on read.

**Done:** First usable slice: a privately uploaded banner appears exclusively on `/games/[slug]/results` for an old/new game and authorized viewers, and results content continues to work. Document this checkpoint before adding remaining CRUD.

## T6 — Complete mutation and recovery workflows

**Depends on:** T2-T5. **Owns:** asset service/routes/CLI mutation commands and focused concurrency/recovery tests. **Requirements:** R6, R8-R9.

- [ ] Add closed-schema metadata PATCH, immutable image replacement, revision-fenced deletion, operation receipt lookup, and explicit unreferenced-object cleanup.
- [ ] Add CLI `update`, `replace`, `delete`, `receipt`, and `cleanup`; require caller-visible revisions and preserve request IDs across retries.
- [ ] Prove stale revisions/duplicate conflicting IDs return 409; competing banner creates cannot produce two live banners; retries cannot overwrite a newer writer.
- [ ] Prove a failed replacement preserves prior pixels, deletion immediately denies reads, cleanup failure remains visible/retryable, and cleanup cannot remove a currently referenced object. Race cleanup against an in-flight upload: shared operation fencing must stop a cleaned candidate from later being published.
- [ ] Prove a public-to-private metadata change cannot bypass authorization through listing, content routes, cursors, browser state, or shared response caching.

**Done:** The full CRUD loop is usable and partial outcomes have reliable receipts/recovery. No cleanup requires direct bucket credentials in the client.

## T7 — Skill and operating documentation

**Depends on:** T4-T6. **Owns:** `.agents/skills/manage-game-assets/SKILL.md`, `docs/game-assets.md`, related OAuth/development/concept/solution documentation. **Requirements:** R1-R9.

- [ ] Write a concise discoverable repository skill for environment selection, login, CRUD, banner/private conventions, receipt recovery, and cleanup. Use actual final CLI options, not unimplemented examples from this plan.
- [ ] Route substantial API/storage detail to `docs/game-assets.md`; document private bucket env, existing local MinIO bootstrap/settings, ephemeral/staging validation, one-hour login expiry, token separation, and expected request/revision conflicts.
- [ ] Document the intentional `assets:manage` REST extension of the existing protected OAuth service and unchanged unrelated app/MCP boundaries.
- [ ] Update `DEVELOPMENT.md`, `CONCEPTS.md`, `docs/game-mcp-production-oauth.md`, and a frontmatter-bearing `docs/solutions/` learning as appropriate.
- [ ] Validate skill frontmatter/naming using `/Users/user/.codex/skills/.system/skill-creator/scripts/quick_validate.py`; verify every advertised CLI command with help or fixture-backed execution.

**Done:** A new agent can perform authorized local/deployed asset operations from the skill without rediscovering auth, privacy, or recovery semantics.

## T8 — Required checks and review

**Depends on:** T1-T7. **Owns:** final validation and fixes within the implementation's files. **Requirements:** R10.

- [ ] Run `bun run test`, `bun run test:postgres` with elevated local-Postgres access, and `bun run check`; preserve/report unrelated dirty work and pre-existing failures.
- [ ] Run targeted deterministic banner/auth browser journeys. API browser harnesses own/drop per-process DBs and terminate children; root Playwright specs need explicit classification if added.
- [ ] Add and run a separately invoked `*.external-smoke.test.ts` journey against local MinIO using the real S3 adapter. Verify upload/read/download/update/replace/delete, receipts/cleanup, and anonymous direct-object denial with disposable fixtures and local credentials. Remove only the run's assets/objects; preserve the bucket and trace content.
- [ ] Run a read-only Grok review of the actual scoped diff if available under repo preferences; address confirmed auth/storage/concurrency/API-contract problems. Do not send unrelated dirty changes for review.
- [ ] Check diff, migrations, docs/examples, no `as any`, no swallowed errors, no public private-content URL, no live-provider/external-write credentials in ordinary tests.
- [ ] Report actual local test results, outstanding proof limits, and affected artifacts. Do not commit/push/deploy unless authorized.

**Done:** The implementation is locally verified and reviewable, including a real MinIO CRUD round trip; deployment proof remains explicitly tracked in T9.

## T9 — Ephemeral or staging deployment proof

**Depends on:** T8 and a runnable ephemeral or staging deployment. **Owns:** non-production end-to-end validation and its evidence. **Requirements:** R10. The user selected these test environments; carry out this acceptance task during implementation, not the current planning-only turn.

- [ ] Resolve the exact ephemeral or staging API/web origins, release, test identity, and disposable game before the run. Keep its credentials separate from local CLI tokens and ordinary CI.
- [ ] Complete real browser OAuth as a producer/sysop with `manage_game_assets`; exercise upload/read/download/update/replace/delete and operation recovery with the CLI.
- [ ] Prove the private Linode object is anonymously unreadable, the authorized API/browser can render it, and the deployed ingress accepts the documented bounded request size.
- [ ] Prove the private banner appears only on `/games/[slug]/results`, clears on logout/navigation, and discovers a later upload on focus.
- [ ] Prove role removal/token revocation denies later operations and unauthorized private metadata/byte reads; restore any deliberately changed role only within the authorized test procedure.
- [ ] Record environment/release, operation IDs, cleanup result, and browser/storage/auth evidence without tokens or secrets. Local tests must not be described as deployed proof.

**Done:** The feature is verified on an ephemeral deployment or staging, and disposable asset/role changes have been cleaned up. Report any remaining deployed boundary precisely.

## Readiness checklist for the implementer

The brainstorm, plan, and tasks are the current handoff. No application feature exists yet. Begin at T0; the next migration ID and shared-file state must be refreshed. The privacy-reader interpretation is explicitly proposed rather than a user-confirmed audience change. Changes to that interpretation must update the policy table, route/browser tests, CLI/skill examples, and documentation together.
