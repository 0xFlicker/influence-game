---
title: Fix admin continuity and integrate Werewolf into House
type: refactor
status: planned
date: 2026-09-30
pillar: A1
---

# Fix admin continuity and integrate Werewolf into House

## Scope and authority

Implement pillar A1 of [House admin and production experience](../ideation/2026-09-30-house-admin-and-production.md). This document replaces the earlier broad roadmap at this same path with an implementation plan for the first pillar. A2–A4 now belong to the ideation task map.

The result is one House admin shell, a Werewolf workspace that stays readable during navigation, a restrained wheel transition with a clean reduced-motion alternative, and usable cost evidence. Production tools retain their existing behavior and private audience.

Work in `/Users/user/.codex/worktrees/werewolf/influence-game`, branch `codex/werewolf`. Preserve prior gameplay/admin changes and the primary checkout. This planning pass changes documentation only. The user has shut down this worktree's servers; implementation validation must use separate free ports and isolated browser-test databases, without disturbing their main-repo servers.

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

The shared layout owns chrome, not a blanket `isAdmin` gate. Section bodies retain their correct access checks. Use current permissions/roles for navigation and safe group landing links; show a top area only when at least one child is accessible. Producers must be able to discover their permitted Werewolf and production paths without being linked to denied Influence/admin screens. Preserve `manage_roles` restrictions. Audit `isAdmin`'s backend meaning against `view_admin` before centralizing predicates; do not assume they are interchangeable. APIs continue checking live grants.

Existing create-game and visual-editor routes also move under the shell; remove their duplicated Nav/main wrappers without changing form or editor behavior. Auth loading/denial occupies the content region. Revoked access immediately removes restricted content, even if a previous response remains in memory.

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
- Cancel and remove the admin query namespace on logout/account change and confirmed access loss. Do not clear unrelated wallet/application queries. Honor 401/403 by closing restricted panels immediately; a network error alone may retain already-authorized last-good data with a stale indicator.
- Fetch compact detail and the requested section concurrently when authorized and identifiable. If a route contains a slug that first needs resolution, canonicalize to an ID once; do not seed a second game's query with old data.
- Warm sections render from cache while freshness is checked. Prefetch small read-only resources on focus/hover; never preload generation or every image in every scene.
- Poll only relevant active views; preserve data during refetch. Keep production's existing necessary job refresh cadence. Completed history can be refreshed explicitly; active-game summary continues to update.
- Stop/hide/restore invalidate the affected summary/list queries and recheck capabilities. Production mutations invalidate inventory and production cost evidence.
- Move pending/uncertain production request identity and lock state above section unmounting. Include both `ReplayVisualProductionPanel` and nested `SceneRepairPanel` actions in the audit. Keep existing idempotency keys and reconciliation behavior: navigation cannot clear uncertainty or authorize a duplicate request. Inspect current recovery behavior for reload separately; do not claim route persistence solves reload recovery.
- Store lightweight section selection/filter/scroll state in the game owner where appropriate. Define explicit handling for unsaved editor drafts; do not silently discard them or keep every heavy page mounted forever.

Backend contract change: make `/api/admin/werewolf/:id` a compact typed summary with metadata, cast, phase/day, outcome and capabilities. Move activity to `/api/admin/werewolf/:id/activity`, returning an authorized canonical projection sufficient for the existing report renderer. Audit and update all detail consumers/tests together; remove the old embedded-activity contract rather than support both. Do not reconstruct facts from formatted strings.

A1 removes activity from unrelated requests; it does not require new persistence, engine rules or pagination. Measure the isolated activity endpoint on a long game. Pagination/windowing can follow if needed; preserve canonical ordering and stable snapshot identity when designing that extension. Do not attach a guessed event sequence by parsing report text.

### 3. Establish a navigation state contract

| Situation | Expected behavior |
| --- | --- |
| First/direct visit | Shell remains visible; local correctly sized loading state, then content or retryable error |
| Warm section change | Prepare destination from cache and transition without empty content |
| Uncached destination | Keep current section readable; indicate requested destination is loading; replace when ready |
| Destination failure | Keep current content clearly labeled; show destination error and Retry/Cancel; direct visits show local error |
| Background refresh | Keep data, focus and scroll; small updating/stale indicator; no entrance motion |
| Rapid navigation | Latest requested route wins; abort/disregard obsolete reads; do not queue animations |
| Back/forward | Follow URL intent and restore the correct section state; no extra history entry on retry |
| Different game | Reinitialize game state; never show the previous game's roles/activity under the new header |
| Access revoked | Remove restricted content and cancel transitions/requests; show denial/sign-in state |

Track requested route separately from displayed section while loading. The visible section title/active marker must describe what is actually on screen, with a separate pending indicator on the requested destination. On successful commit update focus appropriately, restore section scroll and announce the section. Do not expose two interactive/accessibility copies of the same screen during animation. Navigation should remain available during read delays; generation action safety is a separate concern.

### 4. Add the wheel motion and shared styling

Use a bounded content stage, with a transform origin beyond the visible panel suggesting a large wheel. Prototype a shallow arc over roughly 200–260 ms, small rotation/translation and restrained opacity; tune against actual dense content. Direction follows Overview → Production → Costs → Activity. Header/nav remain still.

Start only when the destination is ready. Do not use exit-then-wait behavior that hides content before fetching completes. Keep the background covered throughout; avoid large spinning paragraphs, animated blur, flashing highlights or animation on polling. Interrupt rapid changes rather than queuing them. Clip animated movement without clipping focused controls or menus at rest.

Reduced motion: immediate prepared content swap, no spatial transform, scale or fade through black. Honor runtime preference changes. Cold entry needs no decorative entrance. Keep the viewport from collapsing as content swaps; restore natural height afterward without animating a long document's full height or moving the user's scroll unexpectedly.

The first implementation should compare this treatment with a simple prepared swap during browser validation. Retain the arc only if it improves orientation and remains comfortable; eliminating flashing is the acceptance requirement, not maximizing motion.

### 5. Replace the Werewolf cost JSON wall

Extract small display components from `admin-cost-view.tsx`, leaving its existing modal/fetch owner intact for Influence consumers. Give the Werewolf page the same readable presentation through its own query.

- Summary: calls, failures, retries, reported charges, estimates, unpriced calls, and production charges.
- Model/purpose tables: meaningful labels, tabular numbers, explicit pricing basis and compact token breakdown.
- Call receipts: expand status, model/provider, attempt, duration/time where recorded, token counts and cost evidence. Use fields actually present in the API; label any subset (such as expensive calls) honestly rather than implying a complete ledger.
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

No product question currently blocks this plan. Navigation grouping and the small wheel treatment are proposed defaults grounded in the current screens. The technical proof point is the first persistent two-section transition; validate that before spreading the pattern.

## References

- [Implemented Werewolf workspace](2026-09-30-001-feat-werewolf-admin-production-workspace.md).
- [Separate Werewolf authority](../solutions/architecture-patterns/separate-werewolf-game-authority.md).
- [Transport and staged presentation](../solutions/architecture-patterns/separate-transport-visibility-from-staged-presentation.md).
- [Next layouts](https://nextjs.org/docs/app/api-reference/file-conventions/layout): use stable layout/segment APIs available in installed Next 16.1; no upgrade or optional cache feature is required.
- [Query prefetching](https://tanstack.com/query/v5/docs/framework/react/guides/prefetching): target installed v5 types and existing application QueryClient.
- [Motion reduced motion](https://motion.dev/docs/react-use-reduced-motion): respond to preference changes, including while mounted.
