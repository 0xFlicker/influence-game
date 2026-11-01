---
title: Buffer complete Influence phases before live playback
type: fix
date: 2026-10-31
status: implementation
---

# Complete phases for live Influence playback

The live and replay format viewer now use the same server projection. Holding
unfinished phases is intentional: showing every accepted ballot, speech, result,
and empowered tie-break matters more than displaying each event immediately.
This covers Influence format-kernel opening, social, resolution and endgame
phases. Classic Influence and Werewolf keep their existing playback policy.

## Incident evidence and uncertainty

Reported replay: <https://thehouse.game/games/open-tan-ghost/replay>, round 2.
Game ID: `d83cd4c1-bee6-41c5-8d72-172864dabc66`.

- The user saw Mingle → tie-break → farewell, missing ballots/results and the
  deciding choice. They subsequently confirmed that reload works.
- Production canonical reads showed nine `format.ballot_cast` receipts at
  sequences 501–509 and `format.resolved` at 511. The resolution records seven
  players tied at net zero, Claude Sonnet empowered, and Grok 4.6 eliminated.
- Sequence 512 records elimination, 513 the farewell, and 514 the round result.
  Resolution 511 has an accepted decision source pointer requiring tie-break speech.
- A fresh browser load showed the ballot ledger and spoken ballot explanations,
  the Saves/Exits/Net aggregate, Sonnet's saved tie-break speech, the shared nominee
  selection stage, and Grok highlighted as chosen before farewell. Approximate
  observed positions were 38:20 for a ballot, 39:05 totals, 39:08 speech, and 39:14
  selected exit. These are observations, not stable seek coordinates.
- Ballots do include spoken explanations to the House under the current contract;
  these are sealed from contestants. They are not absent speeches to invent later.
- The game was suspended for visual repair during inspection. That does not prove
  suspension caused this incident.

**Leading hypothesis:** independently delivered data creates an incomplete
presentation timeline; later cues are inserted behind the active position and
never played. A sequence-only hydration watermark may also exclude additional
cues sharing a previously observed event sequence. Neither mechanism has yet been
reproduced with this incident's original network arrival order. Do not claim a
confirmed root cause until a deterministic regression demonstrates it.

An MCP `read_game` attempt failed output-schema validation during investigation;
the incident facts above came from `filter_events` and the browser instead. That
separate tool issue is not evidence of the viewer failure.


## Delivery contract

`GET /api/games/:id/presentation?afterSequence=N` returns canonical replay frames,
saved viewer-safe dialogue, and viewer state from one repeatable-read snapshot.
`throughSequence` is the sole resume cursor. Database transcript IDs are stable
across initial load, incremental reads, reload and completed replay. Visibility
checks use the existing viewer policy; private huddle rows remain filtered.

A canonical `game.phase_entered` closes the preceding phase occurrence. Repeated
phase names are separate occurrences. Neither elapsed time, transcript prose,
format resolution alone nor a farewell closes a phase. Final completion flushes
the remaining phase; an entered but unfinished retrospective stays withheld.

Before release, the service verifies the audio frontier and contiguous due
publication prefix. Dialogue has its own durable event coordinate and publication
dependency. A turn can publish events before its dialogue, so observing the next
phase's publication is insufficient by itself. If a committed turn spans a phase
boundary, the service waits for a later closed boundary containing its dialogue.
No incomplete phase is supplied to the format compiler.

Historical completed games without a publication ledger are delivered whole
through this same projection, preserving saved transcript content. Active games
require the ledger. Historical dialogue without durable event coordinates also
requires a complete recording, so live playback cannot omit speech that would
appear on reload. Existing canonical history and private evidence are never
rewritten or regenerated. Required accepted speech is validated by the existing
presentation contract; missing speech is not invented or recovered from prose.

## Viewer behavior

The format viewer loads and polls the normalized endpoint and does not subscribe
to the independent WebSocket dialogue/event lanes. Live polling and network
recovery request only a suffix after the last server cursor. Frames, dialogue and
state enter React together. Pause, seek and music remain owned by the existing
presentation director. Live join and Go Live begin at the first cue of the latest
released phase, rather than jumping directly to its last result.

The same shared tie viewer renders every supported empowered tie-break. Save and
Exit already has saved ballot explanations, totals, tie speech and selected-target
choreography; this fix supplies their complete inputs before playback begins.

Suspension retains released scenes and continues observing for resume. Audio
readiness may delay phase release further. A completed database status does not
stop polling while final presentation data remains held.

## Validation

- Engine boundary tests cover repeated phases and unfinished retrospectives.
- PostgreSQL tests exercise withheld dialogue, open resolution, ballots and tie
  speech, suffix/reload equality, audio gating, suspension, terminal flush,
  historical recordings and hidden games.
- Browser fixtures consume the normalized endpoint; reconnect and delayed-read
  stories cover mounted playback and reload behavior. Desktop and mobile Save and
  Exit stories require ballots, totals, saved tie speech and the selected target
  before elimination. Classic dialogue retains its original frame endpoint.
- Required repository baselines are `bun run test`, `bun run test:postgres`, and
  `bun run check`, followed by the PR's CI and deterministic browser checks.

The production incident's original network interleaving was not captured. Local
regressions prove the new delivery contract; they do not claim a production
rollout. Deployment remains separate from these PRs.
