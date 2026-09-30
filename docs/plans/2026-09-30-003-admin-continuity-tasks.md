---
title: Admin continuity — implementation task specifications
type: tasks
status: ready
date: 2026-09-30
pillar: A1
---

# Admin continuity — implementation task specifications

Parent: [A1 implementation plan](2026-09-30-002-refactor-admin-continuity-and-production-studio.md). Product map: [four pillars](../ideation/2026-09-30-house-admin-and-production.md). Review: [findings and dispositions](../reviews/2026-09-30-admin-continuity-plan-review.md).

All tasks below are unimplemented. Each task owns a concrete deliverable and acceptance proof; do not mark a task complete merely because its files exist. Use the existing Werewolf worktree and preserve unrelated dirty work. No paid generation, server deployment or public viewer change is required.

## Order and gates

| Task | Deliverable | Requires |
| --- | --- | --- |
| A1-00 | Reproducible source/browser baseline | — |
| A1-01 | Capability, route and data contracts | 00 |
| A1-02 | Persistent House admin shell and navigation | 01 |
| A1-03 | Compact Werewolf summary and separate activity read | 01 |
| A1-04 | Session-safe query ownership and refresh policy | 02, 03 |
| A1-05 | Production request and draft continuity | 02, 04 |
| A1-06 | Prepared section navigation controller | 04, 05 |
| A1-07 | House visual integration and accessible wheel motion | 06 |
| A1-08 | Readable costs and call evidence | 04 |
| A1-09 | Browser failure/race/role acceptance | 07, 08 |
| A1-10 | Full validation and documentation closeout | 09 |

**Gate 1:** A1-01 resolves access and data semantics before reorganizing screens. **Gate 2:** A1-04–06 prove stale-response isolation, write identity and a working two-section transition before animation. **Gate 3:** A1-09 proves continuity in browser recordings, including reduced motion, before release readiness.

A1-02 and A1-03 have independent deliverables; A1-08 can follow query work while motion remains unfinished. Shared files still require coordination; this table is not an instruction to spawn agents.

## A1-00 — record the actual baseline

**Owns:** source inventory, task-owned local services, baseline evidence; no product behavior change.

- [ ] Record branch, HEAD (`a4ba9143` is the planning checkpoint), working-tree status and fingerprints of relevant uncommitted modules. The earlier Werewolf workspace/API files are not all committed; do not assume a fresh checkout of the planning commit contains them.
- [ ] Locate existing browser harness setup/cleanup and use its per-process database. Choose free ports and task-owned output directories; do not stop the user's primary-checkout services.
- [ ] Reproduce cold and warm section navigation with a short and long canonical fixture, no provider calls. Record request sequence/count/size, timings, header/controller mount counts and video at desktop and narrow-mobile widths.
- [ ] Capture a production-like build run as well as dev behavior; label compilation stalls separately.

**Accept:** another implementer can reproduce the same source and fixture; baseline demonstrates the observed blanking/waterfall or records what could not be reproduced. Store evidence paths and commands in the parent plan. No server/test database is left ownerless.

## A1-01 — freeze route, permission and DTO semantics

**Owns:** `admin-sections.ts`, auth/route policy inventory, Werewolf admin DTO definitions and focused contract fixtures.

- [ ] Map every existing admin path, including `/admin` entry, Games/new and Games/id/visual, to a top area and local entry. Match the visual editor before generic Games. `/admin` opens the first permitted Games destination, then another permitted area if no Games entry exists; no redirect loop or inaccessible default.
- [ ] Define endpoint-matched capabilities. Werewolf workspace reads: `view_admin` or producer/sysop. Replay production: producer/sysop. Existing Influence visual reads: `view_admin`; writes: `start_game`. Preserve narrower controls (`hide_game`, `stop_game`, `manage_roles`). Inventory remaining entries against their API owners instead of guessing from group labels.
- [ ] Account for `isAdmin` being broader than Werewolf's read policy (admin role alone is not that endpoint's contract). Do not modify server grants merely to simplify navigation.
- [ ] Define summary shape explicitly: ID/slug, status/hidden, timestamps, rules version, day/phase, audience-local snapshot cursor, cast with allowed roles, outcome, capabilities. Activity returns the authorized `WerewolfView` projection from one canonical snapshot. Public DTOs stay untouched.
- [ ] Confirm all `/api/admin/werewolf/:id` consumers with a repository search before removing `view.entries`; distinguish game detail consumers from costs/activity routes.

**Accept:** a table/fixture covers anonymous, ordinary account, view-admin-only, producer-only, sysop, admin-role-without-view-admin, and users missing each action permission. Every allowed nav entry has a reachable route; visible controls correspond to their API authority. Summary/activity field lists are explicit and testable.

## A1-02 — persistent House shell and navigation

**Owns:** new `app/admin/layout.tsx`, `admin-page-shell.tsx`, `admin-tabs.tsx`, registry/nav components and all admin page wrappers.

- [ ] Split global/local navigation from section bodies. Add Games, Production, Operations and People. Put Learning reviews under People and Werewolf/Influence choices under Games.
- [ ] Keep a single Nav and main landmark; remove duplicated wrappers from Werewolf, create-game and visual-editor routes. Preserve their editors/forms/actions and page-specific content widths.
- [ ] Keep the parent shell accessible to authorized producers; protect section content with its actual capability. Top links select a permitted child, not a fixed denied default.
- [ ] Preserve current paths, list filters and deep links. Mobile navigation remains reachable without horizontal overflow.
- [ ] Add authenticated-session ownership for admin-only state; use the current root QueryClient rather than another client.

**Accept:** shell DOM identity survives navigation; no duplicate landmarks; producer can discover Werewolf and Production; disallowed direct routes show local denial; existing Influence/create/visual routes work. Navigation unit tests assert destinations, not a brittle exact JSX tree.

## A1-03 — separate lightweight summary from activity

**Owns:** `packages/api/src/routes/werewolf-admin.ts`, typed web API helpers, `packages/api/src/__tests__/werewolf-admin.test.ts`.

- [ ] Replace embedded full activity in detail with A1-01's explicit summary. Add `/api/admin/werewolf/:id/activity` using the existing canonical replay/projection and live-grant middleware.
- [ ] Keep authorization, `private, no-store`, hidden-game operator access, wrong-game 404 and unsupported-version errors consistent. Preserve currently accepted ID/slug detail lookup semantics or update every affected consumer explicitly; don't introduce an accidental costs-by-slug request.
- [ ] Return activity context and entries together. Never combine entries from one response with players/audience from a newer summary. When the current-status header and activity have different cursors, label the activity snapshot explicitly instead of claiming they are synchronized. Avoid a refetch loop demanding equality during an advancing live game; measure the duplicate replay cost on cold entry. No prose parsing, engine rule change, database migration or compatibility dual payload.
- [ ] Update existing tests and all consumer types atomically. Verify summary contains no activity/strategy/reasoning and activity contains only the existing authorized projection.

**Accept:** PostgreSQL tests prove old and new activity projection equivalence for the same snapshot, valid role disclosure, no private reasoning, revoked grant rejection and correct errors. Summary payload is independent of transcript length (apart from its fixed roster/metadata); report replay CPU separately rather than claiming it disappeared.

## A1-04 — safe queries, readiness and auth lifecycle

**Owns:** typed Werewolf admin query helpers, minimal auth-generation bridge, admin query lifecycle and section data inputs.

- [ ] Use keys scoped to session generation, account identity, game kind/ID and resource; include parameters where relevant. Subscribe to the existing auth lifecycle instead of inventing another login state machine.
- [ ] On logout/account replacement/401, cancel queries and remove old admin data/drafts. Fence late completions by generation even if transport cancellation loses a race. Leave unrelated QueryClient data alone. Add a minimal session/token-generation check to the API wrapper before dispatching global `auth:expired`: a late 401 from session A must not expire session B before query cleanup can intervene. Keep current-session 401 handling intact and use the existing coordinator signal rather than replacing the auth system.
- [ ] On production 403, drop production evidence and disable its actions, refresh capabilities, and preserve other authorized sections. Workspace-read 403 denies the workspace. Network/5xx errors retain last-good data with an error/stale label. Cached images and dialogs must obey the same access removal.
- [ ] Resolve UUID versus slug ownership once, then run independent summary and selected-section requests concurrently when safe. Do not launch prohibited or completed-only production work before its capability/eligibility is known; a real dependency is allowed and measured.
- [ ] Define ready states: data, empty data, no calls, unavailable-by-lifecycle, denied and terminal error. Only loading can remain pending. Do not mistake an empty array for an unresolved result.
- [ ] Reuse cached reads on return. Keep the visible workspace summary/access check on the current ten-second cadence and revalidate on focus; heavy completed history need not poll. Poll active jobs using the existing cadence while observed. Avoid focus/poll duplicates and racey older-result overwrites.
- [ ] Invalidate list/summary after stop/visibility; production inventory and costs after production receipts. Refresh errors do not clear accepted data. Prefetch only small GET resources on intent, never generation or all scene images.

**Accept:** deterministic tests show old-session and older-request responses cannot repopulate active state or expire a newer login, partial role loss does not blank authorized sections, empty/non-completed states settle, and a warm switch does not refetch the full activity payload. Revocation proof is upon detection/bounded visible refresh, not an unsupported instantaneous push guarantee.

## A1-05 — preserve production operations and review drafts

**Owns:** a small session-scoped operation/draft owner; `replay-visual-production-panel.tsx`, `scene-repair-panel.tsx`, `image-review-editor.tsx` consumers. No new worker/job backend.

- [ ] Store exact original request body and endpoint identity before dispatch: game, API family, scene/action, request ID, preview hash and expected revision/version. Retain submitting/unknown/accepted/rejected state outside game/section component lifetime.
- [ ] Aggregate locks from operation records; one completion must not release another request's lock. Keep the existing server one-at-a-time rules authoritative.
- [ ] Known accepted POST followed by failed inventory GET remains accepted, with a separate refresh error. Lost POST response remains unknown; its explicit check/retry uses the identical payload and key. Definitive rejection is not treated as an accepted job or silently regenerated request.
- [ ] Cover the separate reconciliation form as well: preserve attempt ID, note/cost payload and submitting/unknown state. On lost response re-read the server attempt/reconciliation receipt before resubmission; the API does not accept a requestId and the service rejects already-reconciled attempts. Do not add unsupported fields or promise replay-idempotency. Show another operator’s recorded reconciliation as authoritative, with any conflict visible.
- [ ] Navigate away to another game or global admin and back: preserve the operation record and settle its result to the right owner. Late completions after logout cannot repopulate private UI or authorize a retry under another identity. Server receipts remain authoritative after a browser reload; this task does not promise a new client reload protocol.
- [ ] Preserve draft selections/anchors/mode by game/scene/source identity/plan hash/revision in memory. Restore on return; do not store image bytes. Changed source/revision requires explicit conflict handling before save; never apply coordinates to different imagery. Clear drafts on access/account loss.
- [ ] Closing a modal or navigating must remove its focus trap while preserving allowed draft state. Cleanup cannot itself submit/cancel a server operation.

**Accept:** provider-free fake-receipt tests cover lost render/media/reconciliation response, accepted-then-refresh-failed, stale version, two interleaved operation completions, route unmount/remount, leaving/reentering the game, account replacement and draft/source conflict. Existing Influence production uses the same safe primitives without changing its grants or publication semantics.

## A1-06 — prepared section navigation

**Owns:** persistent `werewolf/[id]/layout.tsx` controller, route validation leaves, section rendering, intent/scroll/focus state. Initially prove Overview ↔ Costs, then Production/Activity.

- [ ] Intercept only ordinary same-game section clicks. Keep a real href for modified clicks/new tabs. Prepare the target module and reads while current content/URL remain; on readiness push exactly one route and commit the target. No artificial loading delay.
- [ ] Failed click preparation keeps the old URL/content with Retry/Cancel. Cancel creates no history entry. Empty/denied/lifecycle explanations count as prepared views, not loading.
- [ ] Back/Forward changes URL first: a temporary old view is explicitly labeled/read-only; settle to target or target-local error. Retry adds no history. Unknown paths go through not-found. Direct cold loads never show another game/section's data.
- [ ] Use increasing intent IDs; latest selection wins when responses resolve out of order. Preserve per-section scroll and light UI state. On commitment restore scroll, focus the heading with `preventScroll`, and announce it; polling does not move focus.
- [ ] The controller owns direct section rendering and query subscriptions. Leaf children remain available for Next validation/error boundaries; do not freeze/copy router internals or render duplicate query owners to obtain exit animations.
- [ ] Generation/destructive controls in an outgoing retained view are inert; section navigation remains available. Known active route, pending destination and visible content identity are unambiguous.

**Accept:** integration tests and a real App Router journey prove cold/warm/failed/rapid/history/direct/invalid navigation, one history entry per committed click, one section owner, no duplicate polling, stable header/nav and correct visible game identity. Do not proceed to A1-07 until this works without animation.

## A1-07 — House surfaces and the wheel transition

**Owns:** shared admin tokens/layout styles, `werewolf/workspace.module.css`, bounded transition component.

- [ ] Match current House dark surfaces and control styles, preserving functional dense layouts. Remove the separate olive/gold theme. Keep mobile touch targets and visible keyboard focus.
- [ ] Animate only a shallow content arc around an offscreen origin, initially about 200–260 ms. Header/nav stay stationary; direction follows section order. Avoid animated blur and large paragraph rotation.
- [ ] Keep the stage covered while transitioning ready content. Do not animate out and wait for a fetch. Rapid input interrupts motion; polling does not replay it.
- [ ] Departing visual content is inert and hidden from assistive technology, with no new effects/modals/handlers. Clip motion, not resting menus/focus outlines. Reserve transition height without permanently leaving a long empty page after switching to shorter content.
- [ ] Reduced motion performs a prepared swap without spatial transforms or fade through black, including when the preference changes mid-animation.

**Accept:** normal and reduced-motion video demonstrate no blank interval or scroll collapse. Keyboard traversal sees only the active view. Check desktop/narrow-mobile and a long Activity → short Overview switch. Compare with a plain prepared swap; simplify the arc if it harms comfort, without compromising continuity.

## A1-08 — readable cost evidence

**Owns:** extracted presentation components from `admin-cost-view.tsx`, Werewolf costs view, focused display tests. Existing Influence modal/fetch lifecycle remains intact.

- [ ] Display separate reported and estimated amounts, unpriced counts, failures/retries, summary token buckets and production charges. Do not sum retry totals into spend again or label a partial actual amount as complete.
- [ ] Model/action rows use available calls/costs/total-token fields. Do not invent per-model retry counts, per-call timings, attempt IDs or token subtotals unavailable in that DTO.
- [ ] Label the returned subset “Most expensive recorded calls.” Expand available actor, role, phase/round, action, provider/model, status, total tokens and pricing evidence. Do not imply full ledger coverage or create nonexistent call-detail links.
- [ ] Render zero, missing, no calls, estimated-only, reported-only, mixed and uncertain production charges distinctly. Source counts and pricing metadata explain coverage; a coarse `state: actual` alone does not prove it is fully priced.
- [ ] Keep raw authorized JSON secondary. Use dense desktop tables and mobile summaries with accessible expanded details.

**Accept:** fixture tests prove truthful labels/counts/zero handling and no double counting; both Werewolf and existing Influence cost surfaces still render. A full call ledger and generalized metadata engine remain outside this task.

## A1-09 — browser adversarial acceptance

**Owns:** existing isolated browser harness and focused Werewolf/admin browser tests; evidence recording.

- [ ] Intercept/delay/fail reads and reorder their completion. Inspect route, content identity, nav state and request count together, not merely final text.
- [ ] Exercise logout/login as another user while reads/writes are pending; partial producer-role loss with view_admin retained; full workspace-read loss; a late successful response after cache cleanup.
- [ ] Simulate unknown generation response, navigation across games and return, then reconciliation with the same request body. No live provider calls. Verify a refresh error after a successful write does not reissue the write.
- [ ] Exercise stale review drafts, existing Influence visual editor, create-game and global admin entry for each role.
- [ ] Record warm/cold/slow/failure/rapid navigation at desktop/mobile, reduced motion and mid-transition preference change; cover scroll/focus/history and empty/ineligible states.
- [ ] Compare A1-00 measurements in equivalent builds/fixtures. Report real serial dependencies honestly. Verify unrelated sections no longer download full activity and an active render does not multiply query subscriptions.

**Accept:** no blank content interval in prepared same-game transitions, no stale/wrong-game content, no duplicated writes, no silent draft loss, correct route/access behavior. Store video/screenshots/request measurements and their fixture/build identity in the parent plan. Browser results are distinct from unit/API proof.

## A1-10 — required validation and closeout

**Owns:** verification record and documentation, not new features.

- [ ] Run `bun run test`, `bun run test:postgres` and `bun run check`; run the focused browser acceptance journeys. Shared PostgreSQL tests use `setupTestDB()` and remain sequential. Rerun sandbox-blocked local DB checks with appropriate local access before diagnosing database availability.
- [ ] Review the final diff against task boundaries; no hidden expansion into A2/A3/A4, gameplay, public publication, external writes or database cleanup. Stage only intended changes if a subsequent commit is requested.
- [ ] Update `docs/werewolf.md` and the parent plan with delivered routes, access behavior, pending-request limitations and actual commands/results/evidence. Mark completed task checkboxes only with proof.
- [ ] Clean up only task-owned servers and per-process test databases. Preserve unrelated dirty work and the user's active main-repo processes.

**Accept:** all required checks and browser evidence are reported with limitations; documentation describes the implemented behavior and remaining later-pillar work. No deploy/push is implied by completion.
