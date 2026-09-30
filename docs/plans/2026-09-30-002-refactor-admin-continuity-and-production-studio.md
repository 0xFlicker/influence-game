---
title: Fix admin continuity and integrate Werewolf into House
type: refactor
status: implemented-local-validation
date: 2026-09-30
pillar: A1
---

# Fix admin continuity and integrate Werewolf into House

## Scope and authority

Implement pillar A1 of [House admin and production experience](../ideation/2026-09-30-house-admin-and-production.md). This document replaces the earlier broad roadmap at this same path with an implementation plan for the first pillar. A2–A4 now belong to the ideation task map.

The result is one House admin shell, a Werewolf workspace that stays readable during navigation, a restrained wheel transition with a clean reduced-motion alternative, and usable cost evidence. Production tools retain their existing behavior and private audience.

Work in `/Users/user/.codex/worktrees/werewolf/influence-game`, branch `codex/werewolf`. Preserve prior gameplay/admin changes and the primary checkout. The planning pass was documentation-only; the implementation and local validation record follows below. The user has shut down this worktree's servers; implementation validation must use separate free ports and isolated browser-test databases, without disturbing their main-repo servers.

Planning checkpoint: `a4ba9143` (documentation only). Implementation tasks: [A1 task specifications](2026-09-30-003-admin-continuity-tasks.md). Adversarial findings and dispositions: [plan review](../reviews/2026-09-30-admin-continuity-plan-review.md). The existing uncommitted Werewolf implementation is a prerequisite; the checkpoint alone is not an independently runnable implementation baseline.

## Findings

- `werewolf/workspace.tsx` mounts Nav, AdminGate, main and game content from every leaf page. Its uncached `useRead` starts with no data on mount. The game detail gates Costs/Production, which then fetch their own resources.
- `[id]/page.tsx` and `[id]/[section]/page.tsx` have Suspense boundaries without visible fallbacks. There is no persistent admin/game route layout.
- `admin-page-shell.tsx` is a component rebuilt by individual routes; `admin-tabs.tsx` mixes navigation and all section bodies. Adding a layout without removing existing wrappers would duplicate navigation.
- `werewolf-admin.ts` returns a complete omniscient projection, including activity entries, for every game detail request. Removing activity from the header payload reduces transferred data; it does not by itself eliminate canonical replay CPU work.
- React Query already has a root provider in `app/providers.tsx`; Motion is already installed. Use those dependencies rather than adding another cache or animation library.
- `ReplayVisualProductionPanel` retains request IDs and uncertain outcomes in component refs/state. Merely preserving GET data would not preserve a pending or uncertain mutation when the panel unmounts.
- Werewolf API reads allow `view_admin` or producer/sysop; mutations have narrower capabilities. Existing web gating and section-link filtering are not one uniform policy.
- The existing `/admin/reviews` body is `AdminOwnerLearningReviews`: learning review belongs with People. Production asset review stays with the existing production tools.
- Existing `admin-cost-view.tsx` has useful metrics/tables but couples its complete panel to modal/fetch behavior. Extract presentation only.

These findings are from source inspection. Network timings, remount counts and transition comfort are unmeasured; establish a browser baseline before application edits. Do not assume authentication refetching or database projection is the dominant latency source.

## Product and layout decisions

Keep House navigation and game identity stationary. Use the current House black surfaces, shared type scale, borders, spacing and focus treatment; remove Werewolf's olive/gold page theme. Game kind is a label, not a different admin design system.

Desktop hierarchy:

```text
House navigation
Games       Production       Operations       People
Games / Werewolf / game-name                     Status · Refresh
Overview    Production       Costs            Activity
┌───────────────────────────────────────────────────────────────┐
│ Persistent content viewport: loaded section / local status     │
└───────────────────────────────────────────────────────────────┘
```

Mobile keeps game identity and a compact section selector above a single content column. Top-level navigation must remain reachable without eleven pills or horizontal overflow. Dense costs use selected columns and expandable receipts rather than unreadably shrinking text.

The global Production area is the cross-game destination; a game's Production section remains in that game's context under Games. A selected game should not jump between global navigation areas merely because its section changes.

### Route ownership and permissions

Retain existing URLs; no URL migration or legacy redirect layer is required. Centralize route-to-area mapping and navigation labels in a small explicit registry:

| Top area | Existing paths / local entries |
| --- | --- |
| Games | `/admin/games`, its new-game route, `/admin/werewolf` and descendants, `/admin/seasons`, `/admin/import` |
| Production | `/admin/production`, existing `/admin/games/[id]/visual` production editor |
| Operations | `/admin/inference`, `/admin/providers`, `/admin/free-queue` |
| People | `/admin/agents`, `/admin/reviews` labeled Learning reviews, `/admin/users`, `/admin/invites` |

Use specific descendant matches before broad game-route matches. Provide Influence/Werewolf choices within Games; keep their existing lists and API contracts separate. Do not add a combined list backend in A1.

The shared layout owns chrome, not a blanket `isAdmin` gate. Section bodies retain their correct access checks. Use current permissions/roles for navigation and safe group landing links; show a top area only when at least one child is accessible. Producers must be able to discover their permitted Werewolf and production paths without being linked to denied Influence/admin screens. Preserve `manage_roles` restrictions. `isAdmin` currently means sysop role, admin role, or `view_admin` in both `/auth/me` and web normalization; Werewolf reads actually require `view_admin` or producer/sysop. Use endpoint-matched capability predicates rather than this broader convenience flag. The existing Influence visual editor separately requires `view_admin` to read and `start_game` for actions; global replay production requires producer/sysop. Group membership must not widen any of these grants. APIs continue checking live grants.

Existing create-game and visual-editor routes also move under the shell; remove their duplicated Nav/main wrappers without changing form or editor behavior. Auth loading/denial occupies the content region. Once access loss is observed through the auth lifecycle or an authorized read, remove the affected restricted content even if a previous response remains in memory. There is no push-based grant-revocation guarantee: keep the visible workspace summary/access check on its existing ten-second cadence, including completed games, and revalidate on focus. A section-level denial must not erase unrelated authorized sections.

## Implementation sequence

### 1. Capture baseline and introduce the persistent shell

1. Record cold and warm navigation on a representative completed Werewolf game, plus a longer history. Capture request waterfall, mount counts, payload sizes and a short screen recording. Use a production-like local build to distinguish compilation from navigation latency.
2. Add `/admin/layout.tsx` and shared admin chrome. Split navigation from the bodies currently owned by `AdminTabs`; keep existing panels and direct routes functional.
3. Add the area/local-navigation registry and permission-aware selection. Preserve relevant list filters in URL navigation.
4. Add `werewolf/[id]/layout.tsx` with a persistent game workspace controller. Leaf routes validate known sections; the controller renders the selected section using supported pathname/segment APIs, without copying or freezing Next router internals.

Prove shell persistence and two-section navigation before broad styling. Retaining a layout does not automatically retain leaf state: section readiness and render ownership explicitly belong to the game controller.

### 2. Give data and pending actions the right owner

Introduce typed Werewolf admin query options/hooks, using the existing QueryClient and API client. Separate keys for list, compact game detail, activity, costs and production inventory. Keys include identity/access scope, game kind and game ID; list keys include filters when filtering moves server-side. Avoid persisting private query data to browser storage.

- Query cache is private client memory; API responses remain `private, no-store`. Do not enable shared HTTP caching for roles, pack activity or provider evidence.
- Include the current auth/session generation in admin ownership. On logout/account replacement/401, cancel reads, remove old-session admin queries and drafts, and reject late read or mutation completions from that generation. Fence auth side effects at the API-client boundary too: the current `apiFetch` emits an unscoped `auth:expired` on 401 before the query owner can reject a stale result; a request from an old token/session must not expire a newer session. Do not clear unrelated wallet/application queries. On a Production 403, remove production evidence and disable its actions, then refresh capabilities; retain separately authorized Overview/Costs/Activity. A confirmed workspace-read denial removes that game workspace. Network/5xx errors alone can retain last-good readable data with a stale indicator; they do not prove grant loss.
- Fetch compact detail and the requested section concurrently when authorized and identifiable. If a route contains a slug that first needs resolution, canonicalize to an ID once; do not seed a second game's query with old data.
- Warm sections render from cache while freshness is checked. Empty results, no-calls costs, a non-completed game’s production explanation and a capability-denied panel are settled renderable states; they must not create an endless preparation spinner. Prefetch small read-only resources on focus/hover; never preload generation or every image in every scene.
- Poll only relevant active views; preserve data during refetch. Keep production's existing necessary job refresh cadence. Completed history can be refreshed explicitly; active-game summary continues to update.
- Stop/hide/restore invalidate the affected summary/list queries and recheck capabilities. Production mutations invalidate inventory and production cost evidence.
- Own production request records in the authenticated admin session, keyed by game, API family, scene/action and request ID, rather than in a game layout that dies when leaving the game. Preserve exact immutable request payloads, expected versions and preview hashes. Track each operation separately; do not use a shared boolean that one completion can clear while another is pending. Distinguish submitting, response unknown, definitive rejection and accepted receipt from subsequent inventory refresh failure. A known accepted POST must never become an unknown write merely because its GET refresh failed. Consume existing server receipts and reconciliation behavior. The records survive section/game/global-admin navigation in this browser session; they are not a new job scheduler. Old-session completions cannot restore protected UI. Also cover `ReconcileAttempt`: this endpoint accepts only note/cost and uses attempt identity, not a client request ID. Retain its attempt/payload/unknown status across navigation; after a lost response read the existing reconciliation receipt before offering another submission. The server rejects a second reconciliation, so do not invent a supported idempotency field or blindly replay it. Browser reload recovery remains server-journal-owned, not a promised client-store feature.
- Store section selection/filter/scroll by game and section. Preserve unsaved image-review edits in session memory keyed by game, scene, source identity, plan hash and expected revision; returning restores the draft and its base version. Changed source/revision requires an explicit review or discard before submission. Do not silently rebase anchors onto new imagery. Drafts contain geometry/selections, not copied image bytes or credentials; clear them on account/access loss. Do not keep every heavy editor mounted to preserve state.

Backend contract change: make `/api/admin/werewolf/:id` a compact typed summary with metadata, cast, phase/day, audience-local snapshot cursor, outcome and capabilities. Move activity to `/api/admin/werewolf/:id/activity`, returning the complete authorized `WerewolfView` projection for that response, sufficient for the existing report renderer. The compact summary uses an explicit allowlist of metadata, cast, phase/day, audience-local cursor, outcome and capabilities; neither response includes private strategy or reasoning. Render activity entries against the cast/day/outcome from that same activity snapshot, never against an independently polled summary. Use the existing audience-local cursor for snapshot identity; do not reinterpret it as an internal event sequence. The header is labeled current game status; when activity is an older snapshot, label its own day/cursor and offer refresh rather than silently implying synchronization or repeatedly waiting for two live reads to match. The report formatter currently consumes players/audience, not the header; keep those from the activity response. Record the extra replay cost on a cold activity load; reuse its summary fields to seed a missing header only within the same game/session and never replace a newer header snapshot. Audit and update all detail consumers/tests together; remove the old embedded-activity contract rather than support both. Do not reconstruct facts from formatted strings.

A1 removes activity from unrelated requests; it does not require new persistence, engine rules or pagination. Measure the isolated activity endpoint on a long game. Pagination/windowing can follow if needed; preserve canonical ordering and stable snapshot identity when designing that extension. Do not attach a guessed event sequence by parsing report text.

### 3. Establish a navigation state contract

| Situation | Expected behavior |
| --- | --- |
| First/direct visit | Shell remains visible; local correctly sized loading state, then content or retryable error |
| Warm section change | Prepare destination from cache and transition without empty content |
| Uncached destination | Keep current section and URL; indicate requested destination is loading; push the destination once ready |
| Destination failure | Normal clicks retain current URL/content with Retry/Cancel. Direct visits and failed Back/Forward show a destination-local error; never silently claim old content belongs to the new URL |
| Background refresh | Keep data, focus and scroll; small updating/stale indicator; no entrance motion |
| Rapid navigation | Latest requested route wins; abort/disregard obsolete reads; do not queue animations |
| Back/forward | URL is already changed: retain old content only while loading, visibly labeled with its old section; settle to the destination or local error. Retry adds no history entry |
| Different game | Reinitialize game state; never show the previous game's roles/activity under the new header |
| Access revoked | Remove restricted content and cancel transitions/requests; show denial/sign-in state |

Use supported links/router APIs. Intercept only unmodified same-game section clicks: prepare data/module, then push exactly one URL when ready. Cancel leaves the current URL unchanged. Modified clicks and direct links retain normal browser behavior. Browser Back/Forward changes the URL first; label any temporarily retained content explicitly and make it read-only until the destination settles. Keep route-current semantics separate from the visible content heading and pending label. Invalid sections render the normal not-found state, not a retained last-good workspace.

Track monotonically increasing navigation intent so late completions cannot replace a newer target. The game controller renders section views directly; leaf route children validate the route and must remain available for not-found/error handling, not render a second workspace. Rendering the departing panel for motion must not mount another query owner, modal, polling timer or mutation handler. On successful commitment restore the target scroll position, then focus its heading with `preventScroll` and announce the section. Initial visits and background refreshes do not steal focus. Navigation stays usable during read delays; destructive/generation actions in a temporarily retained departing panel are inert.

### 4. Add the wheel motion and shared styling

Use a bounded content stage, with a transform origin beyond the visible panel suggesting a large wheel. Prototype a shallow arc over roughly 200–260 ms, small rotation/translation and restrained opacity; tune against actual dense content. Direction follows Overview → Production → Costs → Activity. Header/nav remain still.

Start only when the destination is ready. Do not use exit-then-wait behavior that hides content before fetching completes. Keep the background covered throughout; avoid large spinning paragraphs, animated blur, flashing highlights or animation on polling. Interrupt rapid changes rather than queuing them. Clip animated movement without clipping focused controls or menus at rest.

Reduced motion: immediate prepared content swap, no spatial transform, scale or fade through black. Honor runtime preference changes. Cold entry needs no decorative entrance. Keep the viewport from collapsing as content swaps; restore natural height afterward without animating a long document's full height or moving the user's scroll unexpectedly.

The first implementation should compare this treatment with a simple prepared swap during browser validation. Retain the arc only if it improves orientation and remains comfortable; eliminating flashing is the acceptance requirement, not maximizing motion.

### 5. Replace the Werewolf cost JSON wall

Extract small display components from `admin-cost-view.tsx`, leaving its existing modal/fetch owner intact for Influence consumers. Give the Werewolf page the same readable presentation through its own query.

- Summary: calls, failures, retries, reported charges, estimates, unpriced calls, and production charges.
- Model/purpose tables: meaningful labels, tabular numbers, explicit pricing basis and compact token breakdown.
- Call evidence: label the existing subset “Most expensive recorded calls”; display actor/role, action, phase/round, provider/model, call status, total tokens, cost source and available charge/estimate. This DTO does not include stable call IDs, attempt numbers, timestamps or duration; do not fabricate them, link to a nonexistent call record, or promise a complete searchable ledger. Per-model breakdowns provide calls/costs/total tokens; retry/failure and detailed token counts are summary-level only. A full call-ledger API is outside A1.
- Keep actual and estimated coverage separate; a partially reported actual total is not a complete game price. Unknown is not zero. Retry costs must not be added again to totals already including attempts.
- Raw authorized JSON is secondary technical detail, not the main model/call display. No new generic metadata framework or model-based translation in A1.

## Expected file changes

| Area | Existing modules | Planned addition/change |
| --- | --- | --- |
| Shared chrome | `packages/web/src/app/admin/admin-page-shell.tsx`, `admin-tabs.tsx`, `admin-sections.ts` | Persistent `admin/layout.tsx`, shared navigation/body split, explicit area ownership |
| Route integration | Admin root, `[tab]`, Games/new/visual and Werewolf page files | Remove duplicate shells, preserve gates/route validation |
| Workspace | `admin/werewolf/workspace.tsx`, `workspace.module.css` | Game layout/controller, section components, House tokens, bounded transition |
| Data/auth | `app/providers.tsx`, `hooks/use-permissions.ts`, `hooks/use-auth.ts`, `lib/api.ts` | Typed admin query helpers and scoped access-lifecycle cleanup; avoid unrelated auth refactor |
| Production continuity | `admin/replay-visual-production-panel.tsx`, `admin/games/[id]/visual/scene-repair-panel.tsx` | Lift request/uncertainty ownership while preserving action contracts |
| Costs | `admin/admin-cost-view.tsx`, Werewolf costs section | Extract reusable display components and honest receipt tables |
| API | `packages/api/src/routes/werewolf-admin.ts` | Compact summary/activity split, same authorization/redaction rules |
| Verification | `admin-sections.test.ts`, `replay-visual-production.test.tsx`, API `werewolf-admin.test.ts`, `e2e/werewolf.e2e.test.ts` | Navigation, data ownership, permissions, cost evidence and browser continuity coverage |
| Documentation | `docs/werewolf.md`, this plan and parent ideation | Updated admin navigation/behavior and actual validation evidence |

Paths in abbreviated web rows are relative to `packages/web/src/app` unless fully qualified. Final component filenames may follow nearby conventions; ownership boundaries above are the required design.

## Validation and completion criteria

Provider-free tests cover navigation-area membership (including visual-editor specificity), accessible links for each role, request keys/cache removal, latest-navigation-wins, reduced motion, local refresh failures and cost meaning. Use fixtures for reported/estimated/mixed/unpriced/retried evidence.

PostgreSQL tests cover the summary/activity split, canonical projection fidelity, hidden-game admin access, live-grant enforcement, forbidden reads and unchanged mutation capabilities. Use `setupTestDB()` and sequential execution.

Browser journeys cover:

1. Cold deep links and warm Overview → Production → Costs → Activity → Back, with stable header/nav and no blank interval.
2. Delayed/failed section responses, delayed refresh, rapid repeated switching and back/forward. Assert both displayed-content identity and final route.
3. Producer-only, admin without production rights, unauthorized, account-switch and revoked-access cases.
4. Pending and uncertain production requests across navigation: the request ID survives and no duplicate generation is dispatched. Use fake provider receipts, not paid calls.
5. Filter/scroll restoration, keyboard navigation, focus after section commitment, narrow mobile and long cost/activity data.
6. Reduced motion, runtime preference changes and interruption of an in-progress transition. Record normal/reduced-motion video and inspect for blank frames; screenshots alone are insufficient.
7. Existing Influence admin, create-game and visual-editor routes still render once and preserve their actions after shell extraction.

Measure request count, request waterfall and navigation-to-content timing before/after. Require no detail→section waterfall when requests are independent, no full activity payload on Costs/Production/header refresh, and no empty content frame during a prepared same-game switch. Motion duration is a prototype choice, not a performance guarantee.

Run `bun run test`, `bun run test:postgres`, `bun run check`, and focused browser tests after implementation. Clean up only task-owned servers/databases. Document any live/browser proof not performed; paid generation is unnecessary for acceptance.

## Non-goals and handoff

No studio browser/timeline rebuild, job-center implementation, broad metadata framework, combined game-list backend, Influence workspace conversion, gameplay changes, public viewer replacement, new feature flags, model calls or database cleanup. Those belong to later pillars or separate authorization.

No product question currently blocks this plan. Source review resolved the ownership, permissions and cost-contract gaps; the task specs define the implementation gates. The original document review did not run application tests or establish browser performance; the implementation record below supersedes that proof status. Navigation grouping and the small wheel treatment are proposed defaults grounded in the current screens. The technical proof point is the first persistent two-section transition; validate that before spreading the pattern.

## References

- [Implemented Werewolf workspace](2026-09-30-001-feat-werewolf-admin-production-workspace.md).
- [Separate Werewolf authority](../solutions/architecture-patterns/separate-werewolf-game-authority.md).
- [Transport and staged presentation](../solutions/architecture-patterns/separate-transport-visibility-from-staged-presentation.md).
- [Next layouts](https://nextjs.org/docs/app/api-reference/file-conventions/layout): use stable layout/segment APIs available in installed Next 16.1; no upgrade or optional cache feature is required.
- [Query prefetching](https://tanstack.com/query/v5/docs/framework/react/guides/prefetching): target installed v5 types and existing application QueryClient.
- [Motion reduced motion](https://motion.dev/docs/react-use-reduced-motion): respond to preference changes, including while mounted.


## Implementation and local validation — 2026-09-30

### Source and migration boundary

Implementation began from clean `codex/werewolf` at `86433de7`, after the user committed the preceding Werewolf work. Fetched `origin/main` at `2c0a62ba` and merged it as `f9d32d6f`. Main owns `0103_account_roles`; the unchanged Werewolf migration is now `0104_werewolf`, with the next journal timestamp. Werewolf admin authorization and fixtures now use account grants. Fresh isolated databases successfully applied the merged chain. Existing development databases that already applied the former worktree `0103_werewolf` need their journal reconciled; this task did not modify that database or replay its DDL. The primary checkout and its servers were not changed. No push or deployment occurred.

### Delivered decisions

- A persistent House shell owns role-filtered Games, Production, Operations and People navigation. Producers can discover Werewolf; admin role alone does not grant Werewolf access. Inference/Providers retain their actual admin-or-sysop API policy. Create-game and Influence visual routes no longer duplicate the shell.
- `AdminSession` uses the existing QueryClient, account/auth generation, resource-family access fences and exact operation identities. Drafts and unknown operations survive consumer unmount; session/access loss clears private state. Old-token 401 responses cannot expire a newer login.
- Werewolf detail has an allowlisted compact snapshot; `/activity` provides one complete authorized replay projection. No compatibility dual payload. Replay CPU remains on both endpoints. UUID entry can begin independent reads concurrently; slug lookup and completed-production eligibility remain real dependencies.
- A persistent game layout directly owns its section. Ordinary clicks prepare reads before native history commitment; Back/Forward, failed preparation, cancellation and rapid intents have explicit behavior. The supported App Router history integration preserves genuine links without duplicate React section owners.
- The 220 ms shallow arc uses an opaque clipped wipe, not overlapping translucent paragraph text. A temporary inert DOM exit image has no React effects or handlers. A live media-query subscription cancels motion when reduced motion is enabled; installed Motion's hook did not update during the browser runtime-toggle test.
- Shared production controls retain request identity and review drafts. Accepted receipts lock dependent actions until refreshed inventory contains the new job/version/publication; this fixed a browser-observed review → publish race. Non-idempotent reconciliation reads its receipt before enabling explicit resubmission.
- Werewolf costs show coverage-aware totals, token buckets, model/action breakdowns and expandable recorded-call evidence. Existing Influence cost rendering reuses extracted display primitives without changing its fetch owner. Studio, generic metadata rendering and Influence workspace redesign remain A2–A4.

### Checks and reproducible evidence

All provider/media behavior in browser fixtures is deterministic. No paid model or image calls were made. Browser harnesses use disposable databases and free task-owned ports, then clean up their children and databases.

| Check | Result | Local evidence |
| --- | --- | --- |
| `bun run test` | 2,147 passed, 5 skipped, 0 failed; 206 files | `/tmp/house-a1/provider-free-final.log` |
| `bun run test:postgres` through isolated database wrapper | 1,810 passed, 0 failed; 152 files | `/tmp/house-a1/postgres.log`; wrapper `/tmp/house-a1/postgres.ts` |
| Added Werewolf admin contract fixtures | 8 passed, 90 assertions | `/tmp/house-a1/api-focused.log`; wrapper `/tmp/house-a1/api-focused.ts` |
| Focused session, production, draft and cost tests | 21 passed, 153 assertions | `/tmp/house-a1/focused.log` |
| `bun run check` | Type checks and lint passed | `/tmp/house-a1/check-final.log` |
| Werewolf production-build browser journey | Passed, including access loss and private production review/publication | `/tmp/house-a1/final-browser.log` |
| Shared Influence production browser journey | 2 passed, 0 failed; 28 assertions (dev server) | `/tmp/house-a1/influence-browser.log` |

Run the Werewolf browser journey from `packages/api` with `INFLUENCE_E2E_WEB_MODE=production DRIZZLE_MIGRATIONS_DIR=./drizzle bun test --config=../../bunfig.browser.toml src/e2e/werewolf.e2e.test.ts --max-concurrency 1`. The existing Influence regression uses `src/e2e/replay-visual-production.e2e.test.ts` and its dev server. Root provider-free and check commands run from the worktree root. Isolated PostgreSQL wrappers set the disposable database URL before invoking the normal test command; ordinary test files continue to use `setupTestDB()`.

Set `INFLUENCE_E2E_RECORD_DIR=/tmp/house-a1/final-recordings` to record the continuity journey. Final recording: `/tmp/house-a1/final-recordings/admin-continuity.webm`; request/sample log: `admin-continuity.json`; reduced-motion mobile screenshot: `reduced-motion-mobile.png` in that directory. The sampled journey observed **618 frames, zero blank stages, zero replaced headers and zero duplicate section owners**. It covers delayed Costs, rapid Activity intent, warm reuse, failed refresh/retry, history, scroll/focus, mobile and runtime reduced motion. These are sampled DOM invariants, not a perceptual comfort score. Source fixture and recorder live in `packages/api/src/e2e/werewolf.e2e.test.ts` and `admin-continuity-browser.ts`.

### Evidence limits and remaining acceptance work

- The original dev smoke passed before implementation, but no equivalent pre-change production video/request-size/CPU baseline was captured. No quantitative before/after speed or CPU claim is made. Request logs include transport requests and are not a standalone network benchmark.
- The browser covers partial producer loss, full workspace access loss, ID/slug/deep links, invalid paths, create-game and shared Influence production. Pending account replacement, late successful responses, interleaved operations and source conflicts have deterministic unit/component proof; the full cross-account/pending-write matrix has not also been recorded in a browser.
- The compact DTO is independent of transcript length, but large-history replay CPU and payload scaling were not benchmarked. No claim of instant revocation, complete call-ledger coverage, or client draft survival after reload.
- An attempted independent Grok implementation review produced no findings before it stalled and was stopped. This is not an external review pass. Source review and the checks above are the actual evidence.
- Task checkboxes retain these unproven acceptance items rather than treating source existence as proof. A2–A4 remain separately scoped future work.


### Local migration reconciliation follow-up

After the handoff, the user's normal gateway startup exposed the old Werewolf journal timestamp: it applied account roles and then attempted the unchanged Werewolf SQL again; the transaction rolled back on `games.game_kind`. This was caused by moving the existing Werewolf migration after the new main migration, not by replaying data during the git merge.

On 2026-09-30, inspected the actual Doppler-dev target and restricted the repair to `127.0.0.1:54320/influence_dev`. Verified the exact Werewolf SQL hash and schema, existing `0101`/`0102` hashes, and absent account-role schema. Saved a full custom-format backup at `/tmp/house-a1/dev-db-repair-1790801305576/before.dump` (3,024,794,880 bytes), plus the original journal. In one transaction, applied the unchanged `0103_account_roles.sql`, recorded its hash/timestamp, and moved the existing Werewolf journal row to `1790726400001`. Did not rerun Werewolf DDL or edit earlier historical journal rows. The database retained 84 games, 379 Werewolf events and 314 turns; account-role backfill copied four grants with no eligible grants missing. The normal application migrator succeeded twice after repair. A temporary gateway then started on port 53024 and returned healthy/active from `/api/health`; that task-owned process was stopped cleanly. This follow-up supersedes the earlier statement that this specific local database still needs reconciliation; other previously migrated databases need their own verified reconciliation.
