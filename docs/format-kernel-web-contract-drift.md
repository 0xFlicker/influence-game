# Format-kernel web contract drift

**Date:** 2026-07-26
**Branch:** `feat/sequester-format-kernel`
**Status:** Low-level web contracts are updated; the full format presentation remains intentionally deferred.

## Summary

Format-kernel rounds use an **empower-only** standard vote. Elimination is owned by Save-or-Eliminate, Vote Bomb, or Safety Bounce rather than Power → Council. The web transport now accepts the engine-owned dual-kernel facts, replay v3 viewer decision events, and live viewer decision-event messages without manufacturing an expose target.

## Contract completed in this pass

| Surface | Current contract |
|------------|-------------|
| Canonical facts | Web imports the engine-owned revealed-round and completed-results shapes. Format rounds include `format`, omit `power`/`council`, and may omit every `exposeTarget`. |
| Completed-results matrix | An empower column is emitted for accepted standard votes; an expose column appears only if at least one ledger row actually has an expose target. |
| Live/replay transport | Web accepts `viewer_decision_event` websocket messages and replay-frame schema v3 carrying the same viewer-safe event union. |
| Phases | The transport recognizes `FORMAT_MENU` → `FORMAT_PICK` → `FORMAT_MINGLE` → `FORMAT_RESOLVE`. |
| Legacy prose | `message-parsing.ts` remains the exact frozen classic presentation exception; format facts must never enter it. |

## Presentation deferred

- Safety Bounce bench, center picker, safe/vulnerable pools, and arrow choreography.
- Save-or-Eliminate and Vote Bomb result presentation.
- A completed-results visual redesign that displays the format-specific ledger and resolution.
- Format-specific audio, pacing, reveal, and animation design.

## Authority boundary

1. Canonical events and canonical-event-derived projections own decisions, tallies, phases, replay state, and completed results.
2. Transcript prose may be rendered as dialogue, but cannot supply format state or repair missing facts.
3. Historical classic replays retain their dual-ballot expose presentation through the frozen parser island.
4. New format work must consume `ViewerDecisionEvent`, `RevealedRoundFacts`, and completed results directly.

## MCP judgment (already applied)

- `read_round_facts` and public watch expose the same sanitized format ballot facts; the sealed mapping remains hidden only in in-game agent context.
- Active-match MCP still does not expose in-match vote tools.
