# Watch-player frame timeline

Influence and Werewolf use a 30 fps presentation-time scrubber. The range value is a zero-based frame, not an event number or cue ordinal. Keyboard arrows on the focused range move one frame. Selecting a position seeks within speech, thinking, openings, transformations and ballot/tally holds. Previous/Next still navigate meaningful scene/cue boundaries. Shared links still identify canonical source positions, not elapsed time.

`watch-timeline.ts` uses the same `compileTiming` function as Studio/export. Absolute boundaries are rounded once, preventing drift from rounding each cue separately. The shared presentation director remains the playback clock; frame sampling does not create a second scheduler. Playback speed changes wall-clock pace, not frame coordinates. A seek preserves play/pause intent. Dragging previews the thumb locally and commits the selected frame on release, avoiding a network request for every pointer movement.

Werewolf watch responses include compact per-step keys and base durations for the full audience-visible history. They cover every ballot and tally, permitted night action and verified wolf transformation. The browser retains bounded scene windows and loads the window containing the selected frame. Duration calculations share the engine's shot timing constants with the renderer. Mystery receives neither private action steps nor private thinking metadata. Openings and the completed retrospective's result reprise are included in the browser timeline.

Live history extends the available range without moving a paused source position. Missing future history has no estimated duration. Go live explicitly selects the latest available moment and follows playback. A stale window request cannot replace a newer seek.

Optional thinking retains the existing on-demand authorized fetch. Its duration enters the timeline when loaded and is cached for that mounted game/audience session; the displayed total can therefore grow as previously unseen thinking is fetched. Switching the thinking preference rebuilds the timeline around the active source position. A late thought does not reset a selected speech offset. This is not an eager full-game thinking download or a fixed-duration movie.

Ambient music keeps its existing seek policy. This change does not add recorded speech or claim that ambient music is synchronized to Studio's rendered audio track. Opening media continues to use the opening clock. The watch renderer also retains its immediate-cut camera policy for explicit seeks; this change shares timeline precision, not Studio's entire rendering pipeline.

## Player sampling and Safari

The stage and transport sample the director independently at up to 30 fps. Sampling stops while paused or waiting for readiness; director notifications wake it and are coalesced until the current mutation is complete. The full viewer, cast, and inspector do not subscribe to frame ticks. Audio readiness changes notify subscribers so buffering recovery restarts the samplers.

Recorded timing is compiled once per cue/text/recording combination. Known durations survive Werewolf window eviction as compact timing inputs, without retaining game snapshots. Transport-only changes do not rebuild the timeline. Voice clips are indexed by canonical coordinates and still pass the exact identity matcher; this does not widen audience visibility or transcript matching.

Pointer dragging is explicit because WebKit track clicks do not consistently initiate native range dragging. Keyboard range input remains native. The selected destination and preview release commit together to avoid flashing a stale sampled frame after a seek.

See [Safari player validation](testing/player-safari.md) for WebKit automation, real-device profiling, audio gestures and fullscreen limitations.

Validation covers absolute frame rounding, unequal cue durations, thinking insertion, cached thinking, paused append, distant-window seek offsets, and complete timing-index parity with the Werewolf renderer for both audiences. Browser tests exercise ballot/tally and night-action seeks plus live-window races and opening navigation.

## Local validation — 2026-10-18

- `bun run check`: typecheck and lint passed.
- `bun run test:postgres`: 2,070 passed; final focused watch/admin/Studio source checks: 18 passed.
- Final `bun run test` after rebasing onto `origin/main`, outside the network sandbox: 2,644 passed, 5 skipped, zero failures. The unrelated privacy-date failure belonged to the removed PostHog branch commits.
- Six deterministic browser cases passed: Werewolf live-window races, openings, ballots/tally, private night-action steps; Influence individual frames/native drag and thinking seeks. Focused director, timing-index parity, cache and readiness tests also passed after the final changes.

Final typecheck, lint and provider-free tests passed on the rebased branch. PostgreSQL and browser results above were obtained before removing two unrelated inherited PostHog commits; the scrubber implementation rebased without conflicts. No staging or production deployment was performed.
