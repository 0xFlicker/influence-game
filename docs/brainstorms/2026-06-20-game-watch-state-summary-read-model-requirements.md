---
date: 2026-06-20
topic: game-watch-state-summary-read-model
---

# GameWatchState Summary Read Model Requirements

## Summary

Influence should add a compact `game_watch_state_summaries` read model for game-list rows. `GET /api/games` should batch-read those summaries instead of rebuilding full `GameWatchState` for every visible game, while detail reads and websocket catch-up keep full replay/validation semantics.

---

## Problem Frame

Commit `857c197` made game watch views truthful by deriving `GameWatchState` from persisted canonical events and canonical projection. The remaining review finding is that the game list now pays the detail-page cost for every visible row: it calls `buildGameWatchState`, which loads players and terminal results, validates the full event log, hashes events, replays projection, builds players, and only then drops player detail for list summaries.

That behavior makes the list O(all visible game events) instead of O(visible games). The fix should preserve the correctness gain from `GameWatchState` without making list discovery replay every canonical log.

---

## Key Decisions

- **Materialize the list summary, not the full detail state.** The summary row should be compact and viewer-safe; full `GameWatchState` remains the detail/watch authority.
- **Write-side refresh beats list-time repair.** Lifecycle seams should keep summaries current so the list route does not become a hidden replay/backfill worker.
- **Event-head provenance is part of the summary.** Summary rows should carry enough cursor/source/status metadata to detect missing or stale summaries without exposing canonical envelopes or producer evidence.
- **Public watching stays unchanged.** This work changes how list data is read, not who may watch a game by URL.
- **Private evidence stays out.** Summary rows and list responses must not include raw events, source pointers, owner epochs, checkpoints, private traces, `thinking`, or `reasoningContext`.

---

## Actors

- A1. **Game list viewer** loads public game discovery rows.
- A2. **Game list route** returns compact game cards with current public watch facts.
- A3. **GameWatchState summary read model** stores compact viewer-safe state for list reads.
- A4. **Lifecycle writer** appends durable events, updates game status/results, and refreshes summaries.
- A5. **Detail/watch reader** still builds or validates full `GameWatchState` for game detail and websocket catch-up.
- A6. **Planner/reviewer** needs tests that prove list performance was fixed without weakening detail correctness.

---

## Requirements

**Summary Contract**

- R1. The system must persist one compact `GameWatchState` summary per game for list reads.
- R2. The summary must include list-needed public facts: game identity, status/source, current round, current phase, max rounds, alive/eliminated/unknown counts, winner/final state, event cursor, projection availability, projection status, event counts, valid-prefix metadata, and viewer-safe diagnostics.
- R3. The summary must exclude full player rows and all private or producer evidence fields.
- R4. The summary contract must be versioned so future shape changes can be detected and repaired.

**Write-Side Refresh**

- R5. New or changed games must receive an initial or refreshed summary when visible list facts can change.
- R6. Durable canonical event appends must refresh the summary after accepted events are persisted.
- R7. Terminal completion and terminal fallback state must refresh the summary after result/status data is committed.
- R8. Cancellation, suspension, join/fill roster changes, and creation/waiting-state changes must refresh or initialize summaries when their list-facing facts change.
- R9. Summary refresh failures must not rewrite canonical truth, but they must be observable enough for repair.

**List Route Behavior**

- R10. `GET /api/games` must batch-read summaries for returned game IDs instead of calling `buildGameWatchState` per visible game.
- R11. `GET /api/games` must preserve the current response shape for existing list consumers unless planning identifies a necessary compatible addition.
- R12. Status filtering, hidden-game exclusion, game-number assignment, kernel-health merge, configured seat count behavior, public access, and winner/count/cursor fields must keep their current semantics.
- R13. A missing summary must not cause the normal list path to replay every visible event log.

**Detail and Watch Correctness**

- R14. `GET /api/games/:id` may continue to build full `GameWatchState` from durable events and projection.
- R15. Websocket catch-up may continue to send full persisted watch state.
- R16. The summary read path must not cap correctness for detail/watch state by truncating or replacing full event replay.
- R17. Degraded or invalid durable logs must remain visible as degraded in full detail/watch reads, even when an older summary row exists.

**Migration and Compatibility**

- R18. Existing games must be backfilled or otherwise initialized so deployment does not make the list route cold-replay every historical log.
- R19. The test database cleanup path must include the new summary table.
- R20. Older completed games without durable events must continue to return best-available terminal summary state with source labels.
- R21. The implementation must not introduce watch auth or a new watch permission layer.

---

## Key Flows

- F1. Summary refresh after durable append
  - **Trigger:** A running game accepts and persists new canonical events.
  - **Actors:** A3, A4
  - **Steps:** The lifecycle writer refreshes the compact summary from the persisted event head after append succeeds.
  - **Outcome:** The next list request can show current round, phase, counts, source, and cursor without replaying the game log.
  - **Covered by:** R1-R9

- F2. Game list load
  - **Trigger:** A viewer requests the game list with or without a status filter.
  - **Actors:** A1, A2, A3
  - **Steps:** The route loads visible game rows, batch-loads summary rows for those IDs, merges kernel health and config fields, and returns the existing list shape.
  - **Outcome:** List cost scales with visible games and compact summary rows, not total events across visible games.
  - **Covered by:** R10-R13

- F3. Detail page load
  - **Trigger:** A viewer opens a game detail/watch URL.
  - **Actors:** A5
  - **Steps:** The route builds full `GameWatchState` through the existing replay/validation path.
  - **Outcome:** Detail correctness still reflects the trusted event prefix and degradation state.
  - **Covered by:** R14-R17

- F4. Existing-game migration
  - **Trigger:** The summary table is introduced into an environment with existing games.
  - **Actors:** A3, A4, A6
  - **Steps:** Existing rows are initialized through an explicit backfill or deploy-time repair path.
  - **Outcome:** The first normal list request after deploy does not replay every historical event log.
  - **Covered by:** R18-R20

---

## Acceptance Examples

- AE1. Covers R6, R10-R12.
  - **Given:** an in-progress game has a current summary at event cursor 20.
  - **When:** `GET /api/games?status=in_progress` returns that game.
  - **Then:** the response includes the summary's round, phase, counts, source, projection status, and cursor without invoking full watch-state replay for that row.

- AE2. Covers R14-R17.
  - **Given:** a game has a persisted event-log corruption after a previously stored summary.
  - **When:** `GET /api/games/:id` loads the game.
  - **Then:** the detail response uses full replay/validation and reports degraded state rather than trusting the stale summary.

- AE3. Covers R7, R20.
  - **Given:** an older completed game has no durable events but does have a terminal result.
  - **When:** summaries are initialized.
  - **Then:** the stored summary reports best-available terminal result source, final state, winner, and unavailable durable projection.

- AE4. Covers R3, R21.
  - **Given:** canonical event rows include source pointers and private trace references.
  - **When:** a summary is stored and returned through `GET /api/games`.
  - **Then:** the response contains no source pointers, raw envelopes, owner epochs, private trace content, `thinking`, or `reasoningContext`, and it remains public.

- AE5. Covers R8, R10, R13.
  - **Given:** a waiting game has players added through join or fill.
  - **When:** the game list loads.
  - **Then:** configured seat count and joined-player-derived counts stay correct from summary/config data without replaying durable event logs.

- AE6. Covers R18, R19.
  - **Given:** the database contains existing games before the summary table exists.
  - **When:** migrations and test setup run.
  - **Then:** the new table exists, test cleanup truncates it, and production/staging have a path to initialize summaries before relying on the list route.

---

## Success Criteria

- `GET /api/games` no longer calls `buildGameWatchState` once summaries exist for returned rows.
- The list route still returns correct round, phase, counts, winner, source, projection status, and cursor fields.
- Full game detail and websocket catch-up still use replay-validated `GameWatchState`.
- Public watch/list access boundaries do not change.
- Summary rows and responses remain viewer-safe.
- Tests fail if the list route replays every visible event log.

---

## Scope Boundaries

In scope:

- Compact persisted summaries for list reads.
- Write-side summary refresh from lifecycle seams that change list-facing watch facts.
- Batch summary reads in `GET /api/games`.
- Backfill/initialization behavior for existing games.
- Tests for list performance shape, correctness, privacy, and full-detail fallback.

Out of scope:

- Visual `MatchWatchShell` work.
- New watch auth or permission layers.
- Full projection-cache infrastructure for all consumers.
- Truncating event replay for detail/watch state.
- Public raw canonical event browsing.
- Private trace, cognitive artifact, checkpoint, or producer-evidence access changes.

---

## Dependencies and Assumptions

- Existing `GameWatchState` remains the public watch-state contract.
- Existing canonical event and projection readers remain the source for full detail correctness.
- The first implementation may refresh summaries by building full watch state on write-side transitions.
- Planning will decide the exact migration/backfill command and transaction placement.
- Bun remains the only package/test runner.

---

## Sources / Research

- `docs/ideation/2026-06-20-game-watch-state-summary-read-model-ideation.html`
- `docs/brainstorms/2026-06-20-game-watch-state-requirements.md`
- `CONCEPTS.md`
- `packages/api/src/routes/games.ts`
- `packages/api/src/services/game-watch-state.ts`
- `packages/api/src/services/game-events.ts`
- `packages/api/src/services/game-lifecycle.ts`
- `packages/api/src/db/schema.ts`
- `packages/api/src/__tests__/games-api.test.ts`
- `packages/api/src/__tests__/game-watch-state.test.ts`
- `packages/api/src/__tests__/test-utils.ts`
