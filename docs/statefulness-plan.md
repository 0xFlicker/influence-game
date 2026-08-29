# Durable Game Execution

> **Status**: Implemented for current-contract API games
> **Updated**: 2026-08-28
> **Scope**: Engine logical turns, API ownership, PostgreSQL commit authority, viewer publications

## Operating contract

Influence runs each API game as a sequence of atomic durable logical turns. A normal API process reload does not suspend the game, select a checkpoint, or ask whether a phase coordinate can resume. The replacement process adopts the last committed cursor under a fresh owner epoch and continues the same game ID.

One logical turn owns:

- an immutable intent and deterministic seed;
- the native persisted XState snapshot and the next typed execution cursor;
- canonical events and transcript rows produced in scratch state;
- player continuity and `HouseNarrativeContinuityV2`;
- links to accepted provider calls when the call was explicitly planned in the turn;
- ordered viewer publications and their pacing head.

The commit is one PostgreSQL transaction. A crash before it commits leaves none of those effects visible. A crash after it commits reloads all of them together.

Canonical events and projections remain the only authority for game facts. The cursor decides what work executes next. Transcript, House summaries, private traces, and other prose are never parsed into decisions, tallies, eligibility, phase state, or results.

## Lifecycle

### New game

1. The start route seals the roster/config and acquires a single active owner epoch.
2. `GameRunner.prepareDurableExecution()` creates the execution row and commits the explicit roster-bootstrap turn before the route returns success.
3. Background execution starts only after that durable frontier exists.

The API keeps both starting and active games in its local single-flight guard, so startup reconciliation cannot race the initial durable prepare.

### Logical turn

1. Load the committed execution heads, XState snapshot, cursor, transcript, canonical events, and continuity.
2. Reserve the exact next turn intent before any planned provider dispatch.
3. Rebuild scratch `GameState`, `TranscriptLogger`, phase context, XState actor, player continuity, House notebook, and deterministic RNG.
4. Execute the phase work. Accepted provider values use stable logical-call coordinates and can replay after owner adoption without another accepted game effect.
5. Atomically commit the next snapshot, cursor, effects, continuity, provider links, and publications.
6. Install and publish only the committed result.

House cadence executes inside the same scratch turn as its phase boundary. Public House copy and the private narrative notebook therefore commit together before the viewer publication can be released. Player diary and Judgment prompts continue to use player-scoped context; they never receive the House notebook.

### Process reload

After the API listener is successfully claimed, startup scans `in_progress` games:

- A current execution row in `ready`, `waiting_retry`, or `terminal` state is adopted under a new owner epoch and started from its committed cursor.
- A game in the narrow owner-claim-to-initialization gap may be adopted only when execution, canonical events, durable dialogue, completion, and transcript heads are all empty.
- An active pre-logical-turn game with a supported phase-boundary runtime snapshot may be cut over once when the checkpoint exactly matches the canonical head, projection, owner head, transcript watermark, token cursor, and continuity. The cutover installs one synthetic committed turn without changing the existing canonical log.
- `repair_required` is not gameplay work and is not adopted.
- Other historical gameplay with events but no current logical-turn authority is left untouched. Startup does not invent a cursor or parse old prose to manufacture one.

An ordinary runner interruption relinquishes its owner and leaves the game `in_progress`. It does not mark the game suspended or cancel it. The next local startup adopts it automatically.

### Terminal settlement

The final gameplay turn commits a terminal cursor plus one held completion publication. Settlement reconstructs the ending from committed canonical events, durable transcript rows, provider accounting, and the sealed game config. It atomically writes the completed game/result and competitive side effects, closes the owner, and releases the held completion publication.

A reload between the terminal turn and settlement simply adopts terminal execution and runs the same idempotent settlement. Contradictory durable authority becomes `repair_required`; ordinary transient settlement interruption is not sent back through gameplay.

## Durable tables

| Table | Authority |
|---|---|
| `game_execution_states` | Current committed XState snapshot, typed cursor, heads, continuity, retry state, and pacing head |
| `game_turns` | Immutable planned intent and its optional atomic commit result |
| `game_events` | Canonical accepted-domain facts |
| `game_transcript_entries` / transcript state | Durable dialogue and private transcript capture |
| `provider_logical_calls` / `provider_call_attempts` | Stable logical calls, accepted values, attempts, usage, and failure evidence |
| `game_publications` | Contiguous viewer feed, including the held terminal completion |
| `game_run_owners` | Single-writer owner epochs and adoption fence |

Phase-boundary checkpoint capsules and hydration passports remain historical/forensic inspection artifacts. Current runtime execution does not select them.

## Failure semantics

| Failure point | Result |
|---|---|
| Before turn planning | The committed cursor is unchanged; startup plans the same next work. |
| After planning, before provider acceptance | The adopted owner continues the same immutable intent. A transport attempt that lost its terminal record may be marked indeterminate and retried, but cannot commit duplicate game effects. |
| After provider acceptance, before turn commit | The stable logical call replays its validated accepted value into fresh scratch state. |
| During turn commit | PostgreSQL commits every effect or none. Ambiguous client responses reread the already committed turn. |
| After turn commit, before viewer delivery | Startup reloads the committed publication feed and clients catch up by sequence. |
| After terminal commit, before settlement | Startup adopts terminal execution and performs idempotent settlement. |
| Corrupt or contradictory durable rows | Execution becomes or remains `repair_required`; no prose-based repair or fabricated result is attempted. |

## Deployment and local development

No active-game drain is required. Current logical-turn games adopt their committed frontier, and supported active pre-logical-turn games perform the exact one-time cutover described above. A process may stop between turns or during scratch execution. Schema migrations must still be applied before the replacement runtime starts.

This guarantee is intentionally bounded to normal single-owner process reloads, current-contract rows, and the exact supported active-game cutover. It is not a claim that arbitrary historical suspended games are migrated, that two workers may execute one game concurrently, or that corrupted database authority repairs itself.

For local development, restart the API normally. Do not cancel or manually rewind the game. If the game remains `in_progress`, startup adoption should continue it automatically.

## Viewer delivery

Viewer presentation is a durable sequenced feed. Each publication carries a game-local sequence and becomes eligible at its persisted `availableAt` time. WebSocket connect/reconnect sends catch-up from the client cursor; the web client buffers out-of-order envelopes and deduplicates repeats. Accepted diary entries are viewer-facing publications. Private huddles, thinking, House notebook, and producer-trace material are never publication payloads.

## Verification

Required proof includes:

- engine restart before commit, ambiguous commit response, mid-Lobby, format, Reckoning, Tribunal, and Judgment reconstruction tests;
- byte-exact House summary plus private notebook atomicity and no notebook leakage;
- provider-journal accepted-value replay and owner fencing;
- PostgreSQL startup adoption from an interrupted `in_progress` game through completion under the same game ID;
- terminal reconstruction, exact-once settlement, and held-publication release;
- websocket catch-up, ordering, deduplication, and reconnect coverage;
- `bun run test`, `bun run test:postgres`, and `bun run check`.

## Remaining work

- Multi-process execution and cross-instance observer fan-out still require a distributed scheduler/pub-sub design. The owner-epoch fence prevents stale commits but does not schedule two live workers.
- Historical runs without logical-turn authority remain forensic; there is no compatibility migration or prose-derived cursor.
- Provider requests interrupted before a terminal attempt record can be proven may spend twice on retry. Stable accepted values prevent duplicate accepted gameplay, not every possible duplicate remote charge.
