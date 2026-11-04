---
module: Seasons
problem_type: ux_improvement
tags: [seasons, championship, enrollment, stale-intent]
---

# Adaptive Seasons

`/seasons` is the public season hub. `/games/free?season=…` remains a working alias; `/events/:slug` and `/games/season/:slug` remain direct destinations. Navigation and footer call the hub Seasons.

The prominent season selector governs the entire page. Explicit URL selection wins. Otherwise select active, then closing, then a season with a recorded finalization, then the remaining historical entries. This avoids an unfinalized local fixture displacing the genuine finalized season without inventing a fixture-name filter. The current season schema has no draft/private visibility flag; the selector preserves the existing public list. Championship links come only from the public ledger's published-event projection, never producer APIs. Multiple published events receive a small event selector; only one viewer is mounted at a time.

Accepting seasons show entry and the season ledger. The backend supplies the accepting season ID and next **draw** time (distinct from game start). A future admission window is Opening soon. Closing/final seasons do not show an actionable global queue. A published championship is embedded directly, retaining its existing viewer, role/result spoilers, lineup and schedule. The source season ledger remains separately labeled below it; its points are never presented as championship points.

An authenticated player's recommendation uses their owned agents intersected with the selected season's public standings, ordered by points, then creation time. With no positive points, the newest agent is recommended. Lifetime wins and modification time are not proxies. Existing entry wins over the recommendation, and manual selection is preserved during polling. This is a suggestion, not automatic enrollment. One explicit Join button enters; queued players can switch, leave or open the existing editor. Existing admission/moderation checks remain authoritative.

Join/switch sends `expectedSeasonId`; leave sends it as a query parameter. Both compare the accepting season while holding the existing season/draw transaction locks, before changing the queue. A mismatch returns HTTP 409 and leaves the entry untouched. Legacy API/MCP callers retain their prior optional contract. No season-scoped queue schema or mixed/two-queue policy is introduced.

Client refreshes keep the mounted championship viewer and user choices. Request generations reject stale responses after season changes; slow refreshes can finish initial loading. Source links and browser history preserve the chosen season. Missing/broken entrance portraits use a question-mark placeholder. Championship lineup images prefer frozen transparent body, then existing headshot, then legacy opaque body/initial. No source assets or frozen competition inputs are changed.

## One-click visual update: actual remaining capability gap

The editor identifies missing presentation as absent `visualDesign`, `performanceInstructions`, or `fullBodyReferenceUrl`. This is not an enrollment eligibility gate. Its `update_visuals` assistant command generates a draft, including a full-body reference and portrait crop; the editor then confirms head placement and saves it through the normal profile/revision workflow. `/api/agent-profiles/visual-reference` has request-ID-based recovery, but returns draft assets rather than completing a saved-agent update. That workflow is not a durable saved-agent update operation.

`POST /api/agent-profiles/:id/avatar/generate` and `GET …/avatar/generation` have persistent request/status support, but only for a missing portrait. They do not provide a full visual upgrade or fill the missing presentation fields. The Seasons page therefore retains an honestly named editor link, not a simulated one-click updater or an invented progress percentage.

Smallest sound follow-up: an owner-authorized, idempotent visual-preparation job keyed to agent and starting revision. Preserve populated identity, personality, strategies and existing source art; fill only the requested missing presentation inputs/assets. Persist stage, output references, retry state and result revision; expose status on reload. Apply through the existing moderation/revision service using expected revision semantics so concurrent owner edits cannot be overwritten. A single Update button supplies explicit intent; status says preparing/generating/saving, supports reconnect and retry, and never claims completion before durable asset storage and profile publication. No fake stage percentages or forced editing flow. This job has not been implemented in this change.

## Verification

- Focused PostgreSQL queue/REST tests: 52 passed, including stale join/switch/leave with preserved rows and exact draw-time contract.
- Final provider-free baseline: 3,331 passed, 5 skipped, 0 failed; 40,507 assertions across 354 files. Focused frontend checks: 25 passed, 149 assertions.
- Real running localhost: Season 0 championship default, replay controls, 1440px desktop and 390px mobile without horizontal overflow, selector and browser Back, legacy Intake bookmark. A real paused replay, focus and scroll survive the 15-second background refresh; no browser errors.
- Intercepted browser fixture (no application writes): active-season recommendation, explicit Join/Switch/Leave payloads with selected season ID, newest-agent fallback, responsive entry view. This does not claim a real active-season game or enrollment on the finalized local database.
- Final typechecking/lint passed. Full isolated PostgreSQL regression: 2,421 passed, 0 failed, 34,377 assertions across 226 files (1,300 seconds). No normal development or production database reset.
- Presentation parity scope: host-page/navigation/lineup only. Shared movie scenes, Studio and export rendering are unchanged; the existing embedded viewer is reused.
