---
title: Share the watch clock without sharing game rules
module: House watch player
problem_type: integration_issue
date: 2026-10-01
tags: [werewolf, influence, replay, audience, cursor, playback]
---

# Share the watch clock without sharing game rules

Reusing visual framing alone left Werewolf with a separate player: different navigation, missing cast/inspector/fullscreen behavior, a second clock and per-position fetch replacement. Extract the existing House scheduler and presentational components, then keep Influence and Werewolf interpretation in explicit adapters. The shared scheduler owns time/readiness/commands; engines and server projections own accepted facts. The original Influence timing and House-bridge reconciliation remain an Influence policy.

A skipped Pass still occupies an audience-local source position. Store that position separately from the playable cue index. A silent frontier can have no active cue while retaining a consumed snapshot. Polling must not repopulate an empty director with older buffered speech. Distinguish initial waiting for the first contribution from a deliberate paused seek through silence; only the former prepares the first contribution automatically. Consume only contiguous loaded silent entries, and preserve the active anchor while evicting old windows.

Freeze game/audience/publication session identity. Reject stale seeks, remount on audience change, and never use prefetched snapshots as active cast or inspector state. Exact replay evidence needs authoritative event/transcript anchors: filtering only by round/phase allows later thoughts and amended alliance terms to leak on rewind. Timestamp equality is not an evidence boundary.

Keep browser DTOs in a dependency-free module. Importing the server Werewolf projector into the browser pulled rules/provider code into the client bundle; `werewolf/watch-contract.ts` separates DTOs and playable-entry classification from `werewolf/watch.ts`.

Use precise paths in browser network fixtures. A suffix-only Costs interceptor also caught Next.js production page-prefetch requests and lost the held API request. The resulting timeout looked like a stale navigation winning. Restrict interception to the exact API pathname before diagnosing a runtime race.

Evidence and actual module paths: [shared House player implementation](../../reviews/2026-10-01-shared-house-watch-player-implementation.md). Provider-free, PostgreSQL and browser proof do not establish live-model dialogue quality or deployment.

## Follow-up: manual fades and optional thinking

A readable text page and an animated speech exit need different clock samples. `getSpeechElapsedBaseMs()` intentionally freezes the visible page while dismissing it; using that value for bubble opacity freezes the fade too. Use `getElapsedBaseMs()` for presentation/opacity and the reading clock for measured text. Test several consecutive paused contributions, including cached published images and opening/reply/answer turns. Wait for completed fades in browser tests, rather than clicking again at 95% opacity while the director correctly rejects interrupted transitions.

Captured thinking is an optional segment on the same director clock. Adding/removing/reordering it must retain the source position, fence stale actor/cue responses, and notify render samplers when a missing capture releases the pending clock. Manual speech-first advancement must visit the thought before dismissing speech. The overlay never synthesizes missing thinking or borrows another actor's thought.

Player settings use the installed Floating UI portal/positioning primitives to escape clipped video containers. An omitted portal root uses the document body; explicit `null` waits for a root and renders nothing. Native and viewport-fallback fullscreen use the active player element as the portal root, captured from the settings trigger when it opens. Constrain and scroll the menu to available viewport height; do not hide its first settings behind the player header.

## Shared scene composition

The thinking evidence loader provides context without a layout box. Solo and published-scene renderers place thought and speech inside their existing backdrop; responsive geometry reserves text space within that canvas. Werewolf expands a committed day checkpoint into uniquely keyed ballot subcues at the same source cursor, then its result cue. The shared vote renderer owns portrait collection; the game adapter owns receipt meaning and ordering. Abstention and unavailable receipts stay distinct, and neither creates speech.

Thinking-first retains the thought through the entire spoken line and uses the speech fade-out boundaries, including manual dismissal. The thought position is independent of lazily measured speech height; portrait framing uses a stable text reservation while thinking is visible. This prevents the first speech measurement from moving the thought or headshot.

## Message-wide bubble fitting

Measure both speech and thinking before visibility changes, using the stage font and viewport budget. `fitBubbleText` chooses bounded type, then paginates at the readable minimum when necessary and fixes the bubble to its tallest page. `TimedSpeech` consumes these measured pages without a second sizing pass. Do not fit only the currently visible page: that would move the shape on every page change. Font-ready and viewport changes may refit; playback time cannot. Keep padding and borders in the measurement budget.

## Replay music

The shared player now owns optional music transport and device sound preferences; a game module selects its score from current audience-visible moments. See [shared replay music transport](shared-replay-music-transport.md) for the adapter contract, autoplay constraints, scrub semantics and new-game checklist. Influence remains silent until a score is selected. Mute and volume stay in the main control bar at all widths.


## Ballot stops and the deciding choice (2026-10-05)

A source cursor is not a scrub position: one Werewolf checkpoint contains several ballots. The audience-filtered watch projection now includes a compact `playback` index of source cursors and subcue counts. Every bounded window carries the same complete index. The slider addresses these presentation stops, while share links and scene navigation retain source cursors. The client maps a stop to its source window and subcue; arrow stepping and direct seeks use the same policy-owned readable landing time. Paused seeks stay paused and playing seeks resume.

Both adapters append a separate completed-tally cue after the final receipt. It never contributes a duplicate vote. The final ledger highlights the canonical rule-compatible pool, including eligible zero-vote candidates. Werewolf uses the recorded majority threshold or resolved plurality result. Influence uses the validated format resolution, with scoring metadata only for the explanatory label; it never reconstructs nominations from transcript prose.

Influence presents the recorded nominee pool before the deciding target. Existing fullbody art and portrait fallbacks supply the scene; the shared clock drives red selection, crossing-out and dimming. Direct seeking lands at a readable decided state; reduced motion shows the state without movement. Cast status stays on the preceding canonical frame until the elimination cue, avoiding an early OUT badge during the choice.

Scene Previous/Next intentionally skip the whole ballot group. Arrow keys and the slider visit individual ballots plus the completed tally. Ordinary dialogue retains its existing thought/speech reveal and dismissal steps; this change does not collapse those reading controls into chapter navigation.
