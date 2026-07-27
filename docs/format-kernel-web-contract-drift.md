# Format-kernel web contract drift

**Date:** 2026-07-27
**Branch lineage:** `feat/selective-context-recall` → format-aware viewer
**Status:** Implemented; persisted-game browser and fresh live reconnect proof are the shipping gates.

## Current contract

Format-kernel games now use one event-authoritative presentation path across live
watch, completed replay, completed results, and suspended/cancelled snapshots.
The stored game kernel wins routing. A null legacy kernel may infer format only
from positive trusted `format.*` evidence; absent evidence remains classic, and
contradictions retain the stored route with an incomplete diagnostic.

| Surface | Current behavior |
| --- | --- |
| Standard vote | Format rounds show Empowered totals and receipts only. Classic expose, Power, and Council remain classic-only. |
| Format offer | The two immutable House cards remain stable until the selected card becomes legible and expands into its concise fixed rules. |
| Safety Bounce | Typed starter/pointer facts drive the center actor, bench, Safe/Vulnerable lanes, deterministic presentation-only cycling, and canonical landing. |
| Phase-end ballot | The aggregate appears first, then the existing ballots reveal in trusted roster order. Save-or-Eliminate preserves Save/Eliminate polarity. |
| Completed results | Per-round recaps include offer/selection, format scoring, elimination, ledger, and Safety Bounce chain/pools without deleting classic vote columns. |
| Terminal games | Suspended/cancelled format games compile the last valid typed prefix and render it read-only beneath the existing terminal banner. |
| Reduced motion | The same cue sequence and DOM render with animation interpolation disabled; no semantic beat is skipped. |
| Audio | No format audio assets, playback behavior, autoplay contract, or audio controls were added. |

## Disclosure boundary

“Sealed” is an agent-knowledge and staged-presentation state, not an operator
transport privacy promise.

- `format.ballot_cast` remains the single persisted voter-to-target fact.
- Anonymous/operator watch frames, public API/event filters, ordinary
  `games:read` MCP, and producer sanitized reads may carry accepted named
  ballots immediately.
- Producer raw visibility may additionally expose canonical envelopes,
  provenance, and source pointers.
- Before `format.resolved`, a participating agent receives only its own accepted
  receipt and no peer identities or live partial tally.
- At resolution, the trusted projection orders those same ballots by roster and
  changes presentation lifecycle to `revealed`. Sole-vulnerable Safety Bounce
  is `not_applicable`; contradictory evidence is `unavailable`.

There is no `ballotReveal` payload, duplicate ledger, database migration,
historical rewrite, or transcript-derived repair.

## Authority and compatibility

Canonical events and canonical-event-derived projections own decisions,
eligibility, tallies, phase changes, outcomes, replay cues, and results.
Transcript prose remains dialogue/observability only. The frozen classic parser
in `message-parsing.ts` remains the sole compatibility exception and has not
gained format patterns.

The deterministic fixture family in
`packages/engine/src/fixtures/format-kernel-viewer.ts` covers all launch formats,
clear and tied resolution, normal and sole-vulnerable Safety Bounce, terminal
prefixes, and malformed selection/ballot/bounce histories. `edge-smoke-dusk` remains the classic
characterization authority.

## Verification status

Automated model/component coverage proves:

- deterministic cue compilation and one presentation director;
- aggregate-first roster-ordered roll call;
- operator/MCP sanitized visibility, producer raw provenance, and agent-only
  sealed redaction;
- completed format recaps and classic results stability;
- menu, selection, classification, sealed, resolved, and malformed terminal
  prefixes;
- classic parser quarantine and no format audio implementation.

The dedicated Playwright story uses browser-routed live/reconnect/terminal
fixtures plus the persisted completed fixtures. It exercises `page.clock`,
desktop/mobile widths, reduced-motion emulation, pause/play, manual advance,
speed change, resize, canonical pointer geometry, aggregate-before-ledger
assertions, reload from a local mid-roll-call position, settled screenshots,
completed results, malformed-prefix fail-closed behavior, and classic lifecycle
characterization.

The remaining runtime-only gate is one fresh controlled format game for
end-to-end API/WebSocket progression, current-state entry, and reconnect at
representative prefixes. It must use deterministic/local agents or approved
mocks unless paid provider execution is explicitly authorized.
