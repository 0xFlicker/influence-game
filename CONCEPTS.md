# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## TranscriptEntry

The canonical record of everything that happened in a game for viewers, replays, and analysis. Every entry carries `round`, `phase`, `from`, `scope`, `text`, plus optional `thinking` (the agent's or House's internal note, hidden from players) and `reasoningContext` (raw native model output such as `reasoning_content` from local servers). Current Mingle entries should use current Mingle phase/scope vocabulary; older records may still contain legacy Whisper values. Public player text never contains hidden reasoning.

## Mingle

The current private-room social phase for new Influence games. Agents move through rooms, rooms may be empty, solo, or crowded, and messages are private to current room occupants. Mingle is not a display rename for Whisper; new game state, events, transcript rows, prompts, simulator output, and current docs should treat it as the active phase.

## Whisper

Legacy vocabulary for the old private-message/private-room phase and for historical records created before the Mingle cutover. Whisper may remain in old specs, fixtures, exports, or persisted rows, but it is not the current game-state concept.

## reasoningContext

The raw, model-provided reasoning trace (e.g. `reasoning_content` from LM Studio) captured alongside an agent's structured decision or message. Distinct from the synthesized `thinking` field. Attached by `callTool` via typed intersection and written through `logSystem` / `logPublic` etc. onto `TranscriptEntry`. Visible only in `--chatty` output, full transcripts, and debug surfaces — never to other players.

## chatty mode

The `--chatty` (or `--verbose` / `-v`) flag to the simulation runner that prints a live, color-formatted transcript to the terminal as the game runs. House / system lines are yellow; `thinking:` lines are dim gray; `reasoning:` lines are cyan. Essential for watching Mingle behavior and the real rationale behind votes, power actions, and council decisions in long local-model runs.

## House MC

The direct (non-guarded) call to `houseInterviewer.generateGameplaySummary` that produces a post-phase or post-elimination narrative summary from recent transcript entries. The result is logged as a `[House MC]` system entry so it appears in chatty output and persisted transcripts alongside the raw agent reasoning.

## callTool reasoning augmentation

The single choke-point in `InfluenceAgent.callTool<T>` that guarantees every structured decision return and every JSON-fallback path carries the native `reasoningContext` (via `as T & { reasoningContext?: string }` intersections only — never `as any`). Tool schemas for observable decisions (cast_votes, use_power, council_vote, etc.) include a `thinking` field; the engine threads both values out to the phase loggers and `TranscriptEntry`.
