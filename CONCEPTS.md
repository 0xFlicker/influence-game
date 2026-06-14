# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## TranscriptEntry

The canonical record of everything that happened in a game for viewers, replays, and analysis. Every entry carries `round`, `phase`, `from`, `scope`, `text`, plus optional `thinking` (the agent's or House's internal note, hidden from players) and `reasoningContext` (raw native model output such as `reasoning_content` from local servers). Current Mingle entries should use current Mingle phase/scope vocabulary; older records may still contain legacy Whisper values. Public player text never contains hidden reasoning.

## Mingle

The current private-room social phase for new Influence games. Agents move through rooms, rooms may be empty, solo, or crowded, and messages are private to current room occupants. Mingle is not a display rename for Whisper; new game state, events, transcript rows, prompts, simulator output, and current docs should treat it as the active phase.

## Mingle intent

A hidden pre-room-assignment decision an agent forms at the start of Mingle. It captures whom the agent wants to seek or avoid, preferred room size, purpose, provisional target, opening ask, and the evidence lens behind that posture. Mingle intent guides House room assignment and early room speech, is inspectable in producer/debug artifacts, and is not delivered to other players as dialogue.

## House Mingle room assignment

The producer-side placement of alive agents into initial Mingle rooms using the full set of hidden Mingle intents. The House can propose interesting strategic groupings, but deterministic validation owns final placement and repair diagnostics; later movement belongs to agents through room actions, not hidden reshuffling.

## Strategy signal

A private-room behavior during Mingle that reveals or advances game posture, such as naming a target or ally, asking for a commitment, trading information, offering protection, planting doubt, coordinating a public story, testing trust through social questions, or moving rooms for a stated purpose. Strategy signals are producer/debug evidence that Mingle made game talk available; they are not a mandatory action every agent must perform on every turn.

## Strategic lens

The private evidence frame an agent selects for a decision, such as vote math, room traffic, coalition shape, promise debt, information control, or broad read. Strategic lenses make the agent's reasoning style searchable and comparable across Mingle intent, rumors, reflections, and Strategy Thread packets without forcing the public message to explain itself.

## Agent turn record

A producer/debug record of one agent decision, message, or hidden assessment. Agent turn records preserve structured response fields, hidden thinking, native reasoning context when available, visibility, actor, phase, and action so simulations and MCP queries can analyze behavior without treating every private decision as public dialogue or canonical game state.

## Strategic reflection record

A structured producer/debug artifact for an agent's hidden strategic assessment after a decision phase. It should expose the agent's current certainties, suspicions, allies, threats, and plan, plus hidden reasoning metadata when available, so simulations and the game MCP can validate whether Mingle changed broader strategy. It is not player-visible dialogue.

## Strategy Thread / Carry-Forward Packet

A compact private strategy state an agent carries across rounds inside a live game run. It summarizes the agent's current objective, target posture, coalition posture, next intended social probe, important uncertainty, abandon-or-revise trigger, and revision metadata so later prompts can show continuity without forcing target naming or overt game talk. It is live-agent producer/debug state, not player-visible dialogue, canonical board state, or crash-safe `MemoryStore` data.

## Strategy packet-use marker

A private producer/debug marker on later agent decision records that says how the current decision used the live Strategy Thread revision: `followed`, `revised`, `ignored`, or `deferred`. It is self-reported linkage evidence for simulation and MCP validation, not a scoring system and not a requirement that agents obey the packet.

## Whisper

Legacy vocabulary for the old private-message/private-room phase and for historical records created before the Mingle cutover. Whisper may remain in old specs, fixtures, exports, or persisted rows, but it is not the current game-state concept.

## reasoningContext

The raw, model-provided reasoning trace (e.g. `reasoning_content` from LM Studio) captured alongside an agent's structured decision or message. Distinct from the synthesized `thinking` field. Attached by `callTool` via typed intersection and written through `logSystem` / `logPublic` etc. onto `TranscriptEntry`. Visible only in `--chatty` output, full transcripts, and debug surfaces — never to other players.

## chatty mode

The `--chatty` (or `--verbose` / `-v`) flag to the simulation runner that prints a live, color-formatted transcript to the terminal as the game runs. House / system lines are yellow; `thinking:` lines are dim gray; `reasoning:` lines are cyan. Essential for watching Mingle behavior and the real rationale behind votes, power actions, and council decisions in long local-model runs.

## House MC

The House's between-round narrative voice. `GameRunner` emits a `house-mc-summary` agent-turn artifact and a `[House MC]` system transcript entry after a normal round resolves, even outside `--chatty`, so local simulations have a watchable catch-up layer between raw phase output and structured producer/debug records.

## House Strategy Bible Packet

A private producer/debug strategy state The House carries across a live game run. It summarizes named alliance hypotheses, active tensions, broken or pending promises, vote blocs, Mingle discoveries, player trajectory reads, dramatic story arcs, dropped threads, and uncertainties so House MC summaries, House Long-Form Summaries, and diary-room producer briefs share continuous producer memory. It is House-owned analysis, not player-visible dialogue, agent prompt context, canonical board state, or crash-safe persistent memory.

## House Producer Brief

A private per-player diary-room setup derived from the House Strategy Bible Packet and current game context. It identifies the player's story role, pressure points, relevant alliance hypotheses, contradictions, and question angles so The House can ask sharper diary questions without revealing hidden producer analysis as player knowledge.

## House Long-Form Summary

A producer/audience catch-up summary The House emits in rich simulation runs between House Strategy Bible Packet updates. It explains teams forming or weakening, pressure changes, unresolved promises, and the House's open questions about likely next moves. It should be discoverable through simulation artifacts and the local game MCP, while preserving the separation between audience narration, private producer evidence, and player knowledge.

## House alliance hypothesis

A named producer-side read that a set of players may be aligned, fractured, indebted, or coordinating around a shared posture. A House alliance hypothesis should carry confidence and evidence because it is dramatic producer analysis, not canonical game truth.

## Canonical game event

A durable domain fact accepted by the game engine at the moment game state changes. Canonical game events are emitted by `GameState`, written to simulator `game-N-events.jsonl`, and distinct from transcript entries and `AgentTurnEvent` observability records: they are the replayable source for rebuilding board state, while transcripts and agent turns explain or display what happened.

## Game projection

A derived read model rebuilt from canonical game events, such as current board state, a vote ledger, player timeline, room conversation view, or MCP search index. Projections may be cached or indexed, but they must stay rebuildable from the canonical event log and must not infer XState phase transitions.

The local game MCP is a corpus-level projection host over simulation artifacts. It scans sessions under `packages/engine/docs/simulations/`, addresses games by `sessionId + gameNumber`, and stays read-only.

## Durable game-run kernel

The first durable API runtime layer for live game execution. It binds API game identity into canonical events, persists ordered accepted-domain facts, enforces single-writer ownership, and defines checkpoint/evidence boundaries. It is not itself a claim that stopped games can resume; resume depends on later checkpoint hydration.

## Durable truth read model

An API-side inspection model that reads persisted durable kernel rows, validates canonical event integrity, replays events into the canonical game projection, and reports checkpoint/evidence readiness. It explains what the durable log proves about a run, but it does not resume execution or expose private raw evidence.

## Checkpoint capsule

A persisted phase-boundary diagnostic artifact keyed to the latest canonical event sequence it covers. The first durable-kernel capsules store replay/projection data, transcript cursors, and explicit missing hydration inputs with `hydrateable=false`; future resume work must add XState snapshot data, phase accumulators, runner/agent continuity state, and token/cost cursors before a checkpoint can become a safe resume boundary.

## Owner epoch

The durable single-writer ownership marker for a live game run. An owner epoch lets one worker process and commit accepted game facts while rejecting stale writers; LLM calls may run in parallel inside the owner, but accepted `GameState` and XState mutations stay sequential.

## Private evidence manifest

A producer/debug metadata record that points to raw LLM evidence such as prompts, model responses, `thinking`, `reasoningContext`, and normalized agent-turn objects. The manifest may be stored in Postgres while raw content lives in private object storage; neither the manifest nor the raw evidence is player-visible dialogue or canonical board state.

## callTool reasoning augmentation

The single choke-point in `InfluenceAgent.callTool<T>` that guarantees every structured decision return and every JSON-fallback path carries the native `reasoningContext` (via `as T & { reasoningContext?: string }` intersections only — never `as any`). Tool schemas for observable decisions (cast_votes, use_power, council_vote, etc.) include a `thinking` field; the engine threads both values out to the phase loggers and `TranscriptEntry`.
