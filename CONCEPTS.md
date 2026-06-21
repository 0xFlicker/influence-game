# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## TranscriptEntry

The canonical record of everything that happened in a game for viewers, replays, and analysis. Every entry carries `round`, `phase`, `from`, `scope`, `text`, plus optional `thinking` (the agent's or House's internal note, hidden from players) and `reasoningContext` (raw native model output such as `reasoning_content` from local servers, or a clearly labeled provider-generated reasoning summary such as `OpenAI reasoning summary (auto): ...`). Current Mingle entries should use current Mingle phase/scope vocabulary; older records may still contain legacy Whisper values. Public player text never contains hidden reasoning.

Public websocket `message` events expose a selected `PublicWsTranscriptEntry` subset for live watchers rather than copying the full internal entry. Viewer-safe `thinking`, public room metadata (`rooms` and `excluded` only), anonymous rumor metadata (`anonymous` and `displayOrder`), sender, scope, text, phase, round, recipients, and timestamps may cross that boundary; `reasoningContext`, room allocation diagnostics, private trace pointers, raw prompts/responses, storage keys, source pointers, and decision logs may not.

## Mingle

The current private-room social phase for new Influence games. Agents move through rooms, rooms may be empty, solo, or crowded, and messages are private to current room occupants. Mingle is not a display rename for Whisper; new game state, events, transcript rows, prompts, simulator output, and current docs should treat it as the active phase.

## Post-vote Mingle

The normal standard-round Mingle window after Vote resolves and before Power fallout closes. The vote is locked, the empowered player is known, and agents can respond to pressure through private-room social play without reopening the vote. Post-vote Mingle is not a separate Power Lobby and is not the RUMOR phase.

## Post-vote pressure projection

The pressure-only round state shown to agents, House, viewer framing, and validation after Vote resolves. It identifies the empowered player, current at-risk players, the acting agent's status, and who may become at risk if a shield is granted. It is interpreted alongside the revealed vote ledger; private producer evidence remains out of normal player-visible context.

## Exposure bench

The eligible set of non-empowered live players who received expose votes after Vote resolves. The bench is used to resolve the Council candidate pair before Power: expose votes lock candidates when they can, and the empowered player resolves only leftover ambiguity such as too few eligible exposed receivers, tied exposed tiers, or shield replacement fallout.

## Revealed vote ledger

The public player-known record of named standard-round votes after Vote resolves. It lists each voter, their empower target, their expose target, and any empower re-vote target when a tie forces a re-vote. Agents receive this ledger in later game cards so Mingle and strategy reflections can use votes as social receipts rather than relying on hidden memory or Strategy Thread summaries.

## Revealed game facts

A sanitized player-visible read model of authoritative gameplay facts derived from canonical game events and projections, such as resolved vote ledgers, empowered players, power outcomes, Council candidates, Council votes, and eliminations. Production Games MCP exposes these through `read_round_facts`. Revealed game facts are not raw canonical event envelopes, source pointers, decision logs, cognitive artifacts, private traces, or producer reasoning.

## Mingle intent

A hidden pre-room-assignment decision an agent forms at the start of Mingle. It captures whom the agent wants to seek or avoid, preferred room size, purpose, provisional target, opening ask, and the evidence lens behind that posture. Mingle intent guides House room assignment and early room speech, is inspectable in producer/debug artifacts, and is not delivered to other players as dialogue.

## House Mingle room assignment

The producer-side placement of alive agents into initial Mingle rooms using the full set of hidden Mingle intents. The House can propose interesting strategic groupings, but deterministic validation owns final placement and repair diagnostics; later movement belongs to agents through room actions, not hidden reshuffling.

## Strategy signal

A private-room behavior during Mingle that reveals or advances game posture, such as naming a target or ally, asking for a commitment, trading information, offering protection, planting doubt, coordinating a public story, testing trust through social questions, or moving rooms for a stated purpose. Strategy signals are producer/debug evidence that Mingle made game talk available; they are not a mandatory action every agent must perform on every turn.

## Strategic lens

The private evidence frame an agent selects for a decision, such as vote math, room traffic, coalition shape, promise debt, information control, or broad read. Strategic lenses make the agent's reasoning style searchable and comparable across Mingle intent, rumors, reflections, and Strategy Thread packets without forcing the public message to explain itself.

## Agent turn record

A producer/debug record of one agent decision, message, or hidden assessment. Agent turn records preserve structured response fields, hidden thinking, native reasoning context or labeled provider summaries when available, visibility, actor, phase, and action so simulations and MCP queries can analyze behavior without treating every private decision as public dialogue or canonical game state.

## Strategic reflection record

A structured producer/debug artifact for an agent's hidden strategic assessment after a decision phase. It should expose the agent's current certainties, suspicions, allies, threats, and plan, plus hidden reasoning metadata when available, so simulations and the game MCP can validate whether Mingle changed broader strategy. It is not player-visible dialogue.

## Strategy Thread / Carry-Forward Packet

A compact private strategy state an agent carries across rounds inside a live game run. It summarizes the agent's current objective, target posture, coalition posture, next intended social probe, important uncertainty, abandon-or-revise trigger, and revision metadata so later prompts can show continuity without forcing target naming or overt game talk. It is live-agent producer/debug state, not player-visible dialogue, canonical board state, or crash-safe `MemoryStore` data.

## Decision log

A compact private receipt attached to a strategic agent action. It records what the action meant strategically so later prompts and strategic reflection can understand when and why the agent changed course. Decision logs are producer/debug context for the same agent and maintainers; they are not player-visible dialogue, canonical board state, raw thinking, or native reasoning context.

## Whisper

Legacy vocabulary for the old private-message/private-room phase and for historical records created before the Mingle cutover. Whisper may remain in old specs, fixtures, exports, or persisted rows, but it is not the current game-state concept.

## reasoningContext

The debug-display lane for model-side reasoning evidence captured alongside an agent's structured decision or message. For local OpenAI-compatible servers this is raw native model output such as LM Studio `reasoning_content`. For hosted OpenAI Responses calls with summaries enabled, this can be a clearly labeled provider-generated summary such as `OpenAI reasoning summary (auto): ...`. It is distinct from the synthesized `thinking` field, written through `logSystem` / `logPublic` etc. onto `TranscriptEntry`, and visible only in `--chatty` output, full transcripts, and debug surfaces — never to other players.

## OpenAI reasoning summary

A provider-generated summary from hosted OpenAI's Responses API reasoning summary feature. Influence may request `auto`, `concise`, or `detailed` summaries for hosted OpenAI agent calls; the default is `auto`. These summaries are not raw hidden reasoning. In simulations they are shown in the reasoning display lane with an `OpenAI reasoning summary (...)` prefix. API private traces keep the structured `providerReasoningSummary` provider object for producer correlation; user-facing cognitive artifacts store only the summary text.

## Cognitive artifact

A first-class product read-model record for an agent's reasoning, thinking, or strategy in new games. Cognitive artifacts are captured at decision time from structured trace inputs but are not sanitized views over producer private traces, canonical game truth, or checkpoint resume state. Reasoning artifacts may contain raw native `reasoningContext` or provider-generated summary text as `reasoningSummary`; provider debug wrappers such as `parts` and `outputItemIds` stay out of user-facing payloads. User-facing access is artifact-specific: reasoning is owner-only, thinking and strategy are available to the owner plus same-game participants, and producer/admin surfaces may read all split artifacts directly.

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

## GameWatchState

A viewer-safe web read model for live and completed games, derived from persisted canonical events and canonical projection. It supplies shell-level facts such as round, phase, alive/out status, shield state when known, winner/final state, event head, and projection availability. GameWatchState replaces runtime `GameStateSnapshot` websocket payloads as the product watch authority; it is not raw canonical event envelopes, checkpoint payload, transcript prose, private reasoning, producer evidence, or a claim of crash-safe resume.

## GameWatchState summary

A compact persisted viewer-safe summary of `GameWatchState` for game list reads. It carries list-level facts such as source, round, phase, counts, winner/final state, event cursor, and projection availability so discovery pages do not replay every visible game's full canonical event log. It is not the detail/watch authority and must not contain full player rows, raw canonical events, source pointers, private traces, or producer evidence.

## MatchWatchShell

The default web watch surface for live in-progress games and completed replays. It should consume GameWatchState for authoritative shell-level match facts while reusing phase theaters and replay controls for display. Richer audience-omniscient context, durable receipts, relationship edges, and checkpoint-shaped thought/strategy summaries belong to later data-load slices. It is a viewer product surface, not a claim that active game execution is crash-safe or resumable.

## MCP role / MCP scope

The privileged authorization boundary for trusted MCP validation. A user with the `mcp` role may authorize the OAuth `mcp` scope, and a token with that scope grants global access to the producer MCP surfaces wired behind that scope. It is not user-scoped and should not be reused for ordinary player game-history access.

## Games MCP scope

The user-facing OAuth scope for MCP clients that should be described as "access your games via MCP." A `games` token is resource-scoped to the authenticated subject's created or joined games and owned player/agent records. It can list/read authorized first-class cognitive artifacts for games the subject participated in, but it does not grant producer/global corpus access, developer evidence access, private trace content, or private trace metadata.

## Producer MCP

The privileged deployed MCP resource at `/mcp/producer` for maintainer/developer inspection. Producer MCP keeps the existing `mcp` role / `scope=mcp` global access contract and carries producer evidence/private trace tooling.

## Game MCP OAuth token producer

The app/API-side OAuth surface that turns an existing logged-in app session into a short-lived MCP bearer token for the `game-mcp` audience. It issues user-facing `games` tokens for `/mcp` without the `mcp` role, and producer `mcp` tokens for `/mcp/producer` only when the subject currently has the `mcp` role. It is not a normal app session token or a general third-party OAuth app platform.

## Game MCP OAuth bridge

A local developer bridge that validates a token with `scope=mcp` before delegating to the existing stdio Game MCP behavior. The bridge proves the OAuth authorization-code plus PKCE loop for trusted MCP validation without packaging a production HTTP MCP endpoint.

## Production Game MCP

A deployed Streamable HTTP MCP resource server for trusted validation against API-backed Influence game data. `/mcp` is the user-facing `scope=games` resource constrained by subject claims, while `/mcp/producer` is the privileged `scope=mcp` resource for global producer inspection and private trace tooling.

## Durable game-run kernel

The first durable API runtime layer for live game execution. It binds API game identity into canonical events, persists ordered accepted-domain facts, enforces single-writer ownership, and defines checkpoint/evidence boundaries. It is not itself a claim that stopped games can resume; resume depends on later checkpoint hydration.

## Durable truth read model

An API-side inspection model that reads persisted durable kernel rows, validates canonical event integrity, replays events into the canonical game projection, and reports checkpoint/evidence readiness. It explains what the durable log proves about a run, but it does not resume execution or expose private raw evidence.

## Checkpoint capsule

A persisted phase-boundary diagnostic artifact keyed to the latest canonical event sequence it covers. Durable-kernel capsules store replay/projection data, transcript cursors, Runtime Snapshot evidence, and private continuity references; the hydration passport derives whether a checkpoint is a future hydration candidate. Future resume work must add runner reconstruction before any checkpoint can become a safe resume boundary.

## Phase-Boundary Runtime Snapshot

A v1 checkpoint payload that proves hydration readiness at a completed phase boundary without resuming execution. It attaches minimal runtime evidence to the checkpoint capsule: an API-sealed boundary receipt, XState actor witness, accumulator registry, transcript boundary watermark, token cursor, and structured player/House continuity capsules. It is Postgres-resident resume input; bulky raw prompts, hidden reasoning, and debug evidence may live elsewhere but do not define hydration candidacy.

## Hydration passport

A validator-derived readiness record for a checkpoint capsule. It reports stamp-level status for event/projection truth, boundary safety, Runtime Snapshot evidence, transcript and token cursors, agent continuity, House continuity, privacy boundaries, and the overall verdict such as forensic-only, blocked, or `hydration_candidate`. A hydration passport is not a resume action.

## Boundary certificate

The hydration-passport stamp that proves a checkpoint was taken at a safe boundary. It verifies that canonical events through that boundary are durably accepted, no pre-boundary LLM call or effect can still commit after the checkpoint, and non-repeatable phase entry or exit effects will not be skipped or duplicated.

## Snapshot manifest

The checkpoint packing list that names which runtime subsystems are represented and how each is judged. It separates replayable canonical projection truth from XState actor state, phase accumulators, agent and House continuity, transcript cursors, token/cost cursors, owner epoch, and intentionally missing or blocked inputs.

## Continuity capsule

Structured private runtime state needed for future resume to preserve strategic behavior. Agent continuity capsules are scoped per player and carry subjective strategy/memory state; the House continuity capsule is scoped per game and carries privileged producer context. Raw prompts, hidden reasoning, and private evidence can link to a capsule but are not themselves continuity state.

## Owner epoch

The durable single-writer ownership marker for a live game run. An owner epoch lets one worker process and commit accepted game facts while rejecting stale writers; LLM calls may run in parallel inside the owner, but accepted `GameState` and XState mutations stay sequential.

## Private evidence manifest

A producer/debug metadata record that points to raw LLM evidence such as prompts, model responses, `thinking`, `reasoningContext`, provider reasoning summaries, and normalized agent-turn objects. The manifest may be stored in Postgres while raw content lives in private object storage; neither the manifest nor the raw evidence is player-visible dialogue or canonical board state.

## Private trace content

The raw JSON/JSONL producer evidence addressed by a private evidence manifest, such as decision-call prompts, model responses, `thinking`, `reasoningContext`, provider reasoning summaries, tool arguments, action names, actor context, phase, round, and canonical event boundary. Private trace content is for local producer/debug inspection and must not become public transcript, canonical board truth, or checkpoint resume authority.

## Local Trace MCP

A local-development producer MCP that inspects API-backed durable runs through private trace manifests and private trace content. It is not a product/admin MCP surface until MCP auth login, web/admin affordances, and releasable packaging are intentionally designed.

## callTool reasoning augmentation

The single choke-point in `InfluenceAgent.callTool<T>` that guarantees every structured decision return and every JSON-fallback path carries model-side reasoning evidence when available (via `as T & { reasoningContext?: string }` intersections only — never `as any`). For local models this is native `reasoningContext`; for hosted OpenAI Responses calls it can be a labeled provider summary display. Tool schemas for observable decisions (cast_votes, use_power, council_vote, etc.) include a `thinking` field; the engine threads both values out to the phase loggers and `TranscriptEntry`.
