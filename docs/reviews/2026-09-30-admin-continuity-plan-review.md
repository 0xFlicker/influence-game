---
title: Adversarial review of the admin continuity plan
type: review
status: addressed-in-plan
date: 2026-09-30
---

# Adversarial review of the admin continuity plan

Target: [A1 plan](../plans/2026-09-30-002-refactor-admin-continuity-and-production-studio.md). Implementation: [task specifications](../plans/2026-09-30-003-admin-continuity-tasks.md).

## Method and evidence boundary

Committed the original four-pillar document and A1 plan as `a4ba9143` before review. Reviewed current source in the existing Werewolf worktree, including its uncommitted prerequisite implementation. The documentation checkpoint is not a runnable snapshot of that implementation.

Performed a local failure-scenario audit plus an independent Grok Build review. Grok received a fixed packet containing the committed plan and relevant source excerpts; tools, web search and subagents were disabled. It completed successfully and returned eleven findings. Inspected additional auth, activity formatting and reconciliation service code locally to verify and refine its recommendations. This is plan review, not an implementation approval or browser performance result.

The reviewed plan and task specs address the findings below. No application code, database, live provider or runtime tests were changed/run for this review. The revised plan has not had a second independent Grok pass; final consistency and source checks were performed locally.

## Findings and dispositions

| ID / severity | Failure scenario and evidence | Disposition / task |
| --- | --- | --- |
| R1 / High | Slug deep link enables costs using the raw slug, but only detail resolves ID-or-slug. `routes/werewolf-admin.ts` reads costs/visibility by ID; `workspace.tsx` currently waits for `data.id`. | Resolve canonical ID once; other resources/mutations use that identity. UUID paths may fetch independently. Preserve accepted lookup semantics and test both. A1-01/03/04. |
| R2 / High | Splitting reads allows header and activity to represent different moments. `WerewolfView` supplies its own cursor and cast; `werewolfReportEntry` actually consumes players/audience. | Activity returns its entire projection snapshot; format against that snapshot. Label a differing activity cursor beneath the live-status header. Do not require equality via an endless refetch loop. A1-03/04/06. |
| R3 / High | Reusing the full projector for summary accidentally ships entries; two endpoints also cause two replays on a cold activity visit. | Explicit summary allowlist and payload tests; separate payload gain from CPU cost. Measure duplicate work; same-snapshot activity data may seed a missing header without overwriting newer state. No new event persistence/cache layer required. A1-03/09. |
| R4 / Blocker | Missing-render and media requests live in component refs; a section or game-layout unmount loses the original request key/unknown state. A new click can lose safe recovery even where backend fences prevent duplication. | Session-scoped records outlive section and game routes; preserve exact request payloads and per-operation locks. Test lost response and accepted-write/failed-refresh separately. Never claim client continuity replaces backend fences. A1-05/06. |
| R5 / High | `ReconcileAttempt` is a separate mutable form without a request ID; navigation loses its busy/error state. `reconcileVisualAttempt` locks the operation and rejects already-reconciled attempts. | Include this third operation channel. After response loss read the canonical reconciliation receipt; do not blindly replay or add unsupported idempotency fields. Show authoritative conflicting evidence. A1-05. |
| R6 / High | `isAdmin` includes admin role alone, but Werewolf API does not; producer-only users can read Werewolf while `/admin` defaults to Influence. Existing Influence visual and replay-production grants differ too. | Route-specific predicates and first-permitted landing. Parent layout owns chrome without widening grants. Producer-only, admin-role-without-grant and action permissions get fixtures. A1-01/02. |
| R7 / High | URL changes before data, Cancel/Retry create duplicate history, two interactive panels coexist, and stale intent can win after rapid clicks. | Ordinary clicks prepare then push once; failure/cancel leaves URL intact. Popstate settles to its destination or local error, with old content explicitly marked/inert only while loading. Latest intent wins; route leaves must not duplicate the controller. A1-06/07. |
| R8 / High | Identity/grant changes leave private data or late responses in the root QueryClient. Treating every Production 403 as full account revocation wrongly removes an authorized Overview. | Session-generation scope, cancellation plus completion fence, namespace cleanup, and access-loss scope. A Production denial triggers capabilities refresh; a workspace denial removes that workspace. Revocation is removed on observation/bounded refresh, not instantaneous server push. A1-04. |
| R9 / High | Local follow-up found `apiFetch` emits `auth:expired` for any captured-token 401; `use-auth` expires the current coordinator session without checking which request caused it. A stale A response can log out new account B before query fencing runs. | Fence the global expiry event at the API wrapper using existing request/session identity. Test old-session 401 and current-session 401. This is a minimal lifecycle correction needed for A1, not an auth redesign. A1-04/09. |
| R10 / Medium | Stop uses a separate endpoint; production and reconciliation affect inventory/costs. A generic query conversion can leave stale buttons or spend. | Explicit invalidation map for stop, visibility and all production receipts; refresh errors preserve accepted state. A1-04/05. |
| R11 / Medium | `expensiveCalls` is a subset with no IDs, duration or timestamps. Model breakdown lacks per-model retries/token buckets. Coarse cost state can hide partial coverage. | Use only supported fields, label the subset, separate actual/estimate/unknown, and never add retry spend twice. No full ledger API in A1. A1-08. |
| R12 / Medium | Filters, review geometry and modal state disappear on unmount; preserving all panels creates duplicate queries/focus traps and high memory use. | Lightweight keyed UI/draft state; source/revision conflict handling; unmount heavy views safely; only one live section owner. A1-05/06/07. |

Several items were already mentioned aspirationally in the original plan. The review converts them into chosen behavior, ownership and executable acceptance cases rather than treating every finding as a new scope addition.

## Recommendations refined rather than copied

- Grok recommended a game-scoped record in QueryClient or module memory. The plan chooses authenticated-admin-session ownership, keyed by game/operation, with server records still authoritative. It is not a generic job center.
- Grok suggested matching header/activity snapshot IDs exactly. A live game can move between independent reads, so the plan instead returns a self-contained activity snapshot and visibly distinguishes it from current header state. No prose inference or starvation loop.
- Grok suggested push then replace on cancel. The plan chooses prepare-before-push for ordinary clicks, eliminating failed-navigation history entries. Back/Forward has its own explicit contract because its URL already changed.
- Grok grouped all 403s with whole-cache clearing. Actual grants permit partial producer-access loss while retaining admin access; the plan scopes denial to the protected resource and refreshes capabilities.
- Grok proposed adding idempotency or blocking reconciliation resubmit. Source inspection shows the server already prevents a second reconciliation; A1 uses that authoritative receipt to resolve unknown results without inventing an endpoint field.
- Grok's suggestion to display coarse `state` is insufficient as a coverage guarantee: accounting chooses `actual` if any positive actual spend exists. The plan uses separate sums and source/unpriced coverage and labels unsupported fields honestly.

## Remaining implementation proof

The document now has eleven dependency-ordered tasks and three gates: capability/DTO semantics; identity/request/navigation correctness; browser continuity and accessibility. Implementation has since landed in the worktree; the record below replaces that earlier proof status.

Need actual browser traces for latency/remount attribution, a supported App Router two-section prototype, fake-receipt race tests, and normal/reduced-motion recordings. Model review does not establish that the wheel animation is comfortable, the cache is safe, or navigation is fast. Required implementation checks remain `bun run test`, `bun run test:postgres`, `bun run check` and focused browser journeys.


## Implementation disposition — 2026-09-30

R1–R12 informed the implemented A1 changes; source ownership, commands and results are in the [parent plan implementation record](../plans/2026-09-30-002-refactor-admin-continuity-and-production-studio.md#implementation-and-local-validation--2026-09-30). Deterministic tests cover scoped grants, exact unknown request recovery, reconciliation receipt reads, draft conflicts, access fences, old-session 401 and cost coverage. Browser fixtures cover stable shell/section ownership, delayed/failed/rapid/history navigation, runtime reduced motion, partial/full revocation and review/publication. A browser-observed stale-version publish race was fixed by retaining the accepted operation lock until inventory acknowledges its receipt.

This is an implementation evidence update, not a second external model-review endorsement. The attempted Grok implementation review stalled without results. Equivalent pre-change performance measurements and the complete pending-account/browser-role matrix remain unproven; the task checklist and parent plan state those limits. Public viewer integration, studio jobs/timeline and generic JSON metadata remain outside A1.
