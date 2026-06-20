---
date: 2026-06-20
topic: match-watch-shell-route-owner
---

# MatchWatchShell Shell-Only V0 Requirements

## Summary

`MatchWatchShell` should become the new watch surface for live in-progress games and completed replays, starting with a shell-only V0. This first pass uses existing route data, messages, scenes, websocket state, replay state, and phase renderers. Richer watch facts, durable receipts, checkpoint summaries, relationship edges, and audience-omniscient inspector content are a separate data-load slice.

---

## Problem Frame

Influence needs a viewing experience that feels like a persistent match room rather than a cinematic replay player with transient controls. The current dramatic viewer already carries valuable machinery: scene grouping, live catch-up, playback controls, phase-aware renderers, and Mingle room rendering. The fastest useful prototype should wrap and reorganize that machinery instead of adding a new backend contract.

The larger product direction still includes strategic legibility, audience-omniscient context, durable receipts, and checkpoint-shaped summaries. Those belong in the next data-load track. V0 should prove the route, layout, and interaction shell can replace the old watch/admin shape without asking one implementation unit to solve data availability at the same time.

---

## Key Decisions

- **Existing data only for V0.** The first pass consumes the data the game route and dramatic viewer already load. It does not add a new API route, projection read, checkpoint read, cognitive-artifact read, or relationship loader.
- **New view before new truth.** `MatchWatchShell` establishes the persistent watch hierarchy and stable state surfaces, while the richer watch-facts load remains a later unit.
- **Reuse current theaters.** The center stage keeps the current chat, Mingle, diary, vote/reveal, council, jury, and endgame renderers.
- **Thin local adapter seam.** The shell may use a small local adapter over existing props so the later data-load slice can replace internals without redesigning the view.
- **No fake omniscience.** V0 must omit, mute, or mark unavailable any panel that would require checkpoint summaries, cognitive artifacts, relationship edges, or durable receipts.
- **No crash-safety claim.** The shell may show live state, but it must not imply active game execution is crash-safe or resumable.

---

## Actors

- A1. Live watcher who needs to monitor an active game without the old admin view.
- A2. Replay watcher who wants a completed game to be watchable through the new shell.
- A3. MatchWatchShell, the persistent UI frame around current watch data and phase theaters.
- A4. Existing phase theater renderer that presents the current scene or phase content.
- A5. V0 local watch adapter that derives shell state from existing route data.

---

## Requirements

**Route Ownership and Modes**

- R1. The default game watch route must render `MatchWatchShell` for live in-progress games using the existing live data path.
- R2. The default game watch route must render `MatchWatchShell` for completed games when replay transcript data is available.
- R3. Waiting, joining, and not-yet-watchable states must remain outside `MatchWatchShell`.
- R4. Live and replay modes must share the same shell hierarchy where the current data supports it.
- R5. Normal product navigation must not present the old classic/admin view as an equivalent fallback once V0 preserves current watch behavior.
- R6. V0 must not require a new backend loader, database schema, canonical projection endpoint, checkpoint endpoint, or cognitive-artifact endpoint.

**Persistent Shell**

- R7. The shell must keep match identity, watch mode, connection or replay status, current round, current phase, and alive/out count visible when those values are available from existing data.
- R8. The cast rail must show players with selection state and the best available alive/out/status signal from existing data.
- R9. The phase timeline must orient the watcher to current round and phase in live mode.
- R10. Completed replay mode must preserve existing play, pause, speed, scene position, and replay navigation behavior.
- R11. Selecting a player must show a V0 inspector panel with basic available identity and status, not rich relationship or strategy context.
- R12. The shell must preserve selected player and watcher orientation across routine live updates when the selected player still exists in the current data.
- R13. The shell must remain usable on desktop and mobile viewports without overlapping controls, unreadable text, or hidden primary state.

**Center Phase Theater**

- R14. The center stage must continue to render existing public chat, Mingle rooms, diary rooms, vote/reveal, council, jury, and endgame content.
- R15. Adding shell chrome must not reduce the readability of existing private-room, diary, vote reveal, or jury views.
- R16. Mingle must appear as Mingle in viewer-facing labels even when compatibility code still uses legacy Whisper names.
- R17. Broadcast styling must support scanability and state recognition rather than becoming a decorative frame.

**Data Boundary**

- R18. V0 shell state must derive from existing game detail, players, transcript or live messages, replay scenes, websocket events, and existing client-side parsing.
- R19. A V0 surface that needs unavailable data must omit the surface or show a restrained unavailable state.
- R20. V0 must not invent strategic summaries, relationship edges, promise receipts, or durable vote facts that the current data does not already support.
- R21. The shell should keep a clear seam for a later watch-facts loader so the new data-load slice can add durable facts without rewriting the shell.
- R22. V0 must not expose raw `thinking`, `reasoningContext`, producer private traces, or checkpoint continuity payloads.

---

## Key Flows

- F1. Live game opens in the shell
  - **Trigger:** A watcher opens an in-progress game through normal navigation.
  - **Actors:** A1, A3, A4, A5
  - **Steps:** The route renders `MatchWatchShell`; the shell shows current match state, cast rail, timeline, and existing center theater using the current live data path.
  - **Outcome:** The watcher can monitor the live game through the new view without a new backend data load.
  - **Covered by:** R1, R4, R6-R9, R14-R18

- F2. Completed replay opens in the shell
  - **Trigger:** A watcher opens a completed game with transcript data.
  - **Actors:** A2, A3, A4, A5
  - **Steps:** The shell uses the existing scene/replay model, preserves playback controls, and renders the current phase theater inside the persistent frame.
  - **Outcome:** Completed games use the new watch surface while retaining current replay behavior.
  - **Covered by:** R2, R4, R6, R10, R14-R18

- F3. Watcher selects a player
  - **Trigger:** A watcher selects a player from the cast rail or available theater affordance.
  - **Actors:** A1, A2, A3, A5
  - **Steps:** The shell marks the player as selected and shows a V0 inspector with basic identity and available status.
  - **Outcome:** The shell establishes the selected-agent interaction without promising future relationship or strategy data.
  - **Covered by:** R8, R11, R12, R19-R22

- F4. Rich data is unavailable
  - **Trigger:** A shell region would need durable receipts, relationship edges, checkpoint summaries, or cognitive artifacts.
  - **Actors:** A3, A5
  - **Steps:** The shell omits the region or shows a restrained unavailable state.
  - **Outcome:** V0 stays honest about current data and does not fake the future data-load slice.
  - **Covered by:** R18-R22

---

## Acceptance Examples

- AE1. Covers R1, R4, R6-R9, R14-R18.
  - **Given:** a game is in progress.
  - **When:** a watcher opens the game route.
  - **Then:** `MatchWatchShell` renders using existing live data, shows persistent shell state, and keeps the current phase theater visible.

- AE2. Covers R2, R10, R14, R15, R18.
  - **Given:** a completed game has replay transcript data.
  - **When:** a watcher opens the game route.
  - **Then:** replay mode uses the new shell while preserving existing playback and scene navigation behavior.

- AE3. Covers R8, R11, R12, R19-R22.
  - **Given:** a watcher selects a player.
  - **When:** the shell opens the V0 inspector.
  - **Then:** the inspector shows only basic available identity/status and does not show relationship edges, checkpoint summaries, or cognitive artifacts.

- AE4. Covers R3.
  - **Given:** a game is waiting for players.
  - **When:** a user opens the game route.
  - **Then:** the waiting or join flow remains available instead of forcing the watch shell.

- AE5. Covers R13, R15, R17.
  - **Given:** the shell is viewed on desktop and mobile widths.
  - **When:** the watcher navigates live and replay states.
  - **Then:** primary state remains readable, controls do not overlap, and existing theater content remains usable.

---

## Success Criteria

- The new shell can replace the current watch/admin view for basic live monitoring and completed replay watching.
- Existing phase content remains as readable as it is today.
- V0 requires no new backend data-load work.
- The selected-player interaction exists without over-promising inspector content.
- Missing rich data is handled as an honest V0 limitation.
- The follow-up data-load slice is easy to identify and plan separately.

---

## Scope Boundaries

In scope:

- New watch shell route ownership for live in-progress games and completed replays.
- Persistent header, cast rail, phase timeline, center theater frame, replay controls, and V0 selected-player panel.
- Local derivation from existing route data and current replay/live viewer state.
- Desktop and mobile layout verification for non-overlap and text fit.

Out of scope for V0:

- New watch-facts API or backend read model.
- Durable projection, checkpoint, round-facts, or cognitive-artifact data loading.
- Relationship edges, audience-omniscient strategy summaries, thought summaries, or rich selected-agent dossier.
- Vote/power/council receipt matrix beyond what existing theater content already shows.
- Promise, deal, favor, or social receipt extraction.
- Stats-first finale redesign or House narrative summary.
- Public-only lens mode.
- Game logic, phase rules, checkpoint resume, or crash-safety work.

---

## Follow-On Data-Load Slice

The next major unit should define the new data load for durable watch facts. That slice can decide how the shell receives canonical facts, checkpoint summaries, cognitive artifacts, relationship edges, receipts, and finale stats. It should not be bundled into the V0 shell-only implementation.

---

## Dependencies and Assumptions

- Existing route data is sufficient to render a useful shell around current theaters.
- Existing `DramaticReplayViewer` state can be wrapped or split without rewriting every phase renderer.
- Mingle/open-room behavior on the active branch remains the current private-room direction.
- Rich strategic legibility still matters, but it is intentionally sequenced after the shell exists.

---

## Sources and Research

- `AGENTS.md`
- `STRATEGY.md`
- `CONCEPTS.md`
- `docs/ideation/2026-06-20-persistent-watch-shell-prototype-ideation.html`
- `docs/replay-experience-spec.md`
- `docs/visual-design-language.md`
- `packages/web/src/app/games/[slug]/game-viewer.tsx`
- `packages/web/src/app/games/[slug]/components/dramatic-replay-viewer.tsx`
- `packages/web/src/app/games/[slug]/components/spectacle-viewer.tsx`
- `packages/web/src/app/games/[slug]/components/whisper-phase.tsx`
- `packages/web/src/app/games/[slug]/components/message-parsing.ts`
- `packages/web/src/lib/api.ts`
