# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## TranscriptEntry

The canonical record of everything that happened in a game for viewers, replays, and analysis. Every entry carries `round`, `phase`, `from`, `scope`, `text`, plus optional `thinking` (the agent's or House's internal note, hidden from players) and `reasoningContext` (raw native model output such as `reasoning_content` from local servers, or a clearly labeled provider-generated reasoning summary such as `OpenAI reasoning summary (auto): ...`). Current Mingle entries should use current Mingle phase/scope vocabulary; older records may still contain legacy Whisper values. Public player text never contains hidden reasoning.

Public websocket `message` events expose a selected `PublicWsTranscriptEntry` subset for live watchers rather than copying the full internal entry. Viewer-safe `thinking`, public room metadata (`rooms` and `excluded` only), anonymous rumor metadata (`anonymous` and `displayOrder`), sender, scope, text, phase, round, recipients, and timestamps may cross that boundary; `reasoningContext`, room allocation diagnostics, private trace pointers, raw prompts/responses, storage keys, source pointers, and decision logs may not. Entries with `scope: "huddle"` are hidden alliance-room evidence and are not published to generic public websocket watchers or public transcript export by default. The public web/replay alliance projection is a separate audience surface that may show huddle speech while omitting thinking and producer/debug internals.

## Mingle I

The pre-vote Mingle window in a normal pre-endgame round. It starts with private-room conversation and movement, then closes with the official named-alliance action window. Players may propose, accept, decline, counter, defer, or agree to trial alliances during that action window; official alliance records cannot be formed or mutated outside Mingle I in v1.

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

The debug-display lane for model-side reasoning evidence captured alongside an agent's structured decision or message. For local OpenAI-compatible servers this is raw native model output such as LM Studio `reasoning_content`. For hosted OpenAI Responses calls with summaries enabled, this can be a clearly labeled provider-generated summary such as `OpenAI reasoning summary (auto): ...`. It is distinct from the synthesized `thinking` field, written through `logSystem` / `logPublic` etc. onto `TranscriptEntry`, and visible in `--chatty` output, full transcripts, debug surfaces, and owner-scoped reasoning artifacts when the artifact access policy permits it. It is never public transcript speech or visible to other players as dialogue.

## OpenAI reasoning summary

A provider-generated summary from hosted OpenAI's Responses API reasoning summary feature. Influence may request `auto`, `concise`, or `detailed` summaries for hosted OpenAI agent calls; the default is `auto`. These summaries are not raw hidden reasoning. In simulations they are shown in the reasoning display lane with an `OpenAI reasoning summary (...)` prefix. API private traces keep the structured `providerReasoningSummary` provider object for producer correlation; user-facing cognitive artifacts store only the summary text.

## Cognitive artifact

A first-class product read-model record for an agent's reasoning, thinking, or strategy in new games. Cognitive artifacts are captured at decision time from structured trace inputs but are not sanitized views over producer private traces, canonical game truth, or checkpoint resume state. Reasoning artifacts may contain raw native `reasoningContext` or provider-generated summary text as `reasoningSummary`; provider debug wrappers such as `parts` and `outputItemIds` stay out of user-facing payloads. User-facing access is artifact-specific: reasoning is owner-only, ordinary thinking and strategy are available to the owner plus same-game participants, alliance-huddle thinking and strategy are subject-owner-only unless the accessor has producer/admin access, and producer/admin surfaces may read all split artifacts directly.

## Player-private reasoning lane

The owner-accessible product lane for an agent's private reasoning and strategy, including reasoning artifacts and strategy reflections exposed through authorized game/MCP contexts for the user's own agents. Player-private reasoning can include the agent's `thinking`, `reasoningContext`, reasoning summaries, and strategic reflection content when artifact policy allows it. It must not include producer-only wrappers such as full prompt requests, raw provider responses, provider profile metadata, model IDs, requested reasoning effort, token or usage counts, router billing fields, private trace storage keys, or provider debug envelopes unless a later product decision explicitly creates a sanitized player-facing form.

## chatty mode

The `--chatty` (or `--verbose` / `-v`) flag to the simulation runner that prints a live, color-formatted transcript to the terminal as the game runs. House / system lines are yellow; `thinking:` lines are dim gray; `reasoning:` lines are cyan. Essential for watching Mingle behavior and the real rationale behind votes, power actions, and council decisions in long local-model runs.

## The House venue

The top-level product and domain frame for `thehouse.game`: a venue that can present social deduction games over time. In the current rebrand pass, The House presents Influence as the only playable game, and future games should not appear selectable until they exist. This venue meaning is separate from The House as Influence's in-game moderator, narrator, or producer voice.

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

## Named alliance

A player-confirmed, non-binding consent artifact that a set of players explicitly proposed, accepted, declined, countered, or closed during a game. A named alliance records social agreement and promise debt, not true loyalty; later votes, leaks, and betrayals are gameplay evidence rather than violations of the artifact.

## Alliance record

The gameplay-level record of a named alliance's official facts: current members, agreed terms, status, huddle outcomes, and failed or closed proposal history relevant to its members. The alliance record is a rules term, not a storage, API, prompt, or UI prescription.

## Alliance facts projection

A member-scoped read model that summarizes the proposal history, alliance records, huddles, and huddle outcomes a selected player or agent is authorized to know. Compact forms omit raw huddle messages and hidden thinking so they can appear in broader summaries; full forms belong in dedicated alliance reads for inspection.

## Alliance sidecar

A possible product or interface surface for inspecting alliance records and huddle history in a member-safe or producer-safe way. The sidecar is not the v1 gameplay rules authority and should not imply always-on alliance chat by default.

## Alliance huddle

A House-scheduled coordination scene for an active named alliance before a vote, before Council, or another explicit decision window. A huddle session gives each live member one chance to speak and produces an official huddle outcome for the alliance record.

## Alliance huddle outcome

The compact official memory artifact produced after a scheduled alliance huddle. It records ask, plan, promises, dissent, confidence, posture, and leak or betrayal claims where present. It carries alliance context forward for members. Raw huddle transcript remains outside generic public transcript/watch-intelligence surfaces, but the public web/replay alliance projection may show huddle speech as audience evidence without exposing hidden thinking or producer/debug internals.

## Universal alliance

A named alliance whose living membership equals all alive players. Before a vote-facing Mingle I, a universal alliance is unstable and should close so agents can react during normal Mingle and form smaller playable coalitions.

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

## Completed game results review

The public-by-URL postgame review surface for completed games. Its authoritative facts come from persisted canonical game events replayed into projections, then rolled up per round into revealed facts, elimination order, vote history, endgame eliminations, jury votes, and final placement. Older completed games may degrade to the terminal `game_results` row when no canonical event log is available. Cognitive artifact snippets may add public agent context, but raw payloads, private traces, source pointers, and producer reasoning are not result truth.

## Postgame analysis projection

A compact LLM-facing read model for completed-game analysis. It composes completed-results facts, revealed round facts, player rows, jury ledger, vote-pattern hints, diagnostics, and optional producer evidence into token-efficient MCP/API payloads. Its player-safe form is rebuilt from canonical facts and must not include raw events, source pointers, private traces, prompts, private reasoning, or hidden strategy artifacts. V2 postgame payloads start with a deterministic `executiveSummary` of at most five derived text facts, then expose round summaries, highlighted eliminations, derived vote cohorts, game momentum, jury narrative, player summaries, turning points, and diagnostics. Every derived object carries derivation confidence; confidence describes the derivation, not the canonical fact.

## Highlighted elimination

A deterministic postgame elimination highlight selected by documented rules: first elimination, final pre-jury elimination, first jury member, endgame elimination, winner's final opponent, top empowered player, or top exposed player. `highlightedEliminations` replaces the ambiguous `majorEliminations` name; old payloads may keep `majorEliminations` as a temporary compatibility alias. A highlighted elimination is not a strategic claim about why the player was targeted.

## Derived vote cohort

A public postgame signal built from repeated shared majority-vote outcomes. Current v2 cohorts start from repeated visible majority-vote pairings, then consolidate them into the largest public shared-vote groups for the same observed rounds. They expose `size`, first/last observed round, `sharedVotes`, `cohesionScore`, confidence, and the explicit note that this is not confirmed alliance membership. Cohorts never imply hidden knowledge, private coordination, or producer-only alliance hypotheses.

## Game momentum segment

A sparse postgame flow marker derived from objective visible indicators such as repeated empowerment, repeated majority-vote pairing, and the final jury result. Momentum segments explain where visible control or outcome state changed; they are not strategy speculation.

## Player overall game shape

A conservative deterministic label on a postgame player summary, such as `power player`, `social survivor`, `under the radar`, `swing voter`, `consensus target`, or `jury favorite`. Each label is threshold-based from visible counts such as empowered rounds, risk moments, expose/Council votes received, nominations, majority alignment, and jury votes. If same-confidence labels collide, the value is `null` with a diagnostic instead of choosing a story.

## Compact round summary

The round-level row inside the postgame analysis projection. It summarizes the headline, empowered player, vote outcome, expose pressure, power action, Council candidates, eliminated player, majority-alignment signal, risk moments, and diagnostics for one round without returning raw event envelopes. The headline is a short deterministic sentence from round facts, not narrator prose.

## MCP scopes

The OAuth scopes for the deployed `/mcp` resource are `agents:read`, `agents:write`, `games:read`, and `producer`. `agents:write` requires `agents:read`. `producer` is privileged developer access and is meaningful only when the logged-in subject currently has the `producer` role.

## Games MCP read scope

The user-facing `games:read` OAuth scope for MCP clients that should be described as "read your Influence games." A token with `games:read` can inspect accessible games, visible events, projections, timelines, rules, and authorized first-class cognitive artifacts. It does not grant producer/global corpus access, developer evidence access, private trace content, private trace metadata, owned-agent writes, or active-match action authority.

## Management-only MCP

The user-facing product boundary for MCP clients that may help a player prepare agents and enroll them before a match starts, but may not participate inside an active match. Management-only MCP can expose rules discovery, owned-agent roster reads, agent create/update, and pre-match queue enrollment; it must not expose voting, empower/expose, council, Mingle, lobby, diary-room, ready-check, timer, phase, moderator, or other active-match actions.

## Avatar completion

The product behavior that fills in a missing player-agent avatar PFP after agent creation, usually by generating a one-shot portrait and copying it into Influence-owned profile-picture storage. Avatar completion is not a general image-generation tool: web users opt in when leaving an agent avatarless, and Management-only MCP can trigger automatic completion for newly created agents that omit `avatarUrl`.

## Avatar change ledger

The audit trail for player-agent avatar mutations across uploads, generated avatar completion, MCP-provided avatar URLs, replacements, removals, failed generation, and skipped generation. It records enough source, actor, previous/new avatar, status, and safe provider/spend context to support debugging and a later moderation review queue, while keeping provider prompts, raw debug details, and enforcement actions out of normal public profile payloads.

## Producer MCP

The privileged developer/debug capability on `/mcp`. Producer MCP requires OAuth scope `producer` plus the current `producer` role and carries producer evidence/private trace tooling.

## Game MCP OAuth token producer

The app/API-side OAuth surface that turns an existing logged-in app session into an MCP bearer token for the `game-mcp` audience. It issues selected scope sets for `/mcp`, hides ungrantable `producer` access from non-producer users, and lets users remove optional scopes before approval. Refresh tokens are issued only for grants that do not include `producer`. It is not a normal app session token or a general third-party OAuth app platform.

## Game MCP OAuth bridge

A local developer bridge that validates a producer-capable token before delegating to the existing stdio Game MCP behavior. The bridge proves the OAuth authorization-code plus PKCE loop for trusted MCP validation without packaging a production HTTP MCP endpoint.

## Production Game MCP

A deployed Streamable HTTP MCP resource server for trusted validation against API-backed Influence game data. `/mcp` is the single deployed resource; scopes split owned-agent reads, owned-agent writes, accessible game reads, and producer inspection/private trace tooling.

## Influence MCP App

The host-rendered app layer above Production Game MCP for end-user AI app surfaces such as ChatGPT, Claude, and Grok. An Influence MCP App proves app discovery, OAuth authorization, app-resource or iframe boot, and at least one real `games:read` call before it tries to become a polished game browser. It is not a general third-party OAuth app platform or evidence that producer private traces are user-visible.

Provider-packaged MCP Apps can have host-owned OAuth callbacks and host-specific request quirks that differ from tool-first loopback clients. Influence treats those quirks as exact provider compatibility facts captured through code-owned configuration, redacted dynamic-client-registration diagnostics, and targeted tests, not as generic trust in an entire provider domain or as per-deployment redirect configuration.

## Durable game-run kernel

The first durable API runtime layer for live game execution. It binds API game identity into canonical events, persists ordered accepted-domain facts, enforces single-writer ownership, and defines checkpoint/evidence boundaries. It is not itself a claim that stopped games can resume; resume depends on later checkpoint hydration.

## Durable truth read model

An API-side inspection model that reads persisted durable kernel rows, validates canonical event integrity, replays events into the canonical game projection, and reports checkpoint/evidence readiness. It explains what the durable log proves about a run, but it does not resume execution or expose private raw evidence.

## Checkpoint capsule

A persisted phase-boundary diagnostic artifact keyed to the latest canonical event sequence it covers. Durable-kernel capsules store replay/projection data, transcript cursors, Runtime Snapshot evidence, and private continuity references; the hydration passport derives whether a checkpoint has enough evidence for recovery consideration. A checkpoint becomes a safe resume boundary only when runner reconstruction exists for that exact actor coordinate.

## Phase-Boundary Runtime Snapshot

A v1 checkpoint payload that proves hydration readiness at a completed phase boundary without resuming execution. It attaches minimal runtime evidence to the checkpoint capsule: an API-sealed boundary receipt, XState actor witness, accumulator registry, transcript boundary watermark, token cursor, and structured player/House continuity capsules. It is Postgres-resident resume input; bulky raw prompts, hidden reasoning, and debug evidence may live elsewhere but do not define hydration candidacy.

## Hydration passport

A validator-derived readiness record for a checkpoint capsule. It reports stamp-level status for event/projection truth, boundary safety, Runtime Snapshot evidence, transcript and token cursors, agent continuity, House continuity, privacy boundaries, and the overall verdict such as forensic-only, blocked, or `hydration_candidate`. A hydration passport is not a resume action.

## Phase-boundary startup resume

The supported API recovery behavior for interrupted live games at implemented completed phase boundaries. A suspended game whose newest phase-boundary checkpoint is at the durable event head and has a supported actor coordinate can be claimed by a fresh owner on API startup, hydrated into a new runner from canonical events plus checkpoint payload, append post-restart canonical events, and complete under the same game ID. Current support covers the original pre-round lobby boundary, persisted normal-round coordinates through reveal, and the first supported endgame-entry coordinate; it is not a promise of mid-phase recovery, in-flight LLM recovery, later endgame boundary recovery, arbitrary old-game repair, or automatic serverless orchestration.

## Boundary certificate

The hydration-passport stamp that proves a checkpoint was taken at a safe boundary. It verifies that canonical events through that boundary are durably accepted, no pre-boundary LLM call or effect can still commit after the checkpoint, and non-repeatable phase entry or exit effects will not be skipped or duplicated.

## Snapshot manifest

The checkpoint packing list that names which runtime subsystems are represented and how each is judged. It separates replayable canonical projection truth from XState actor state, phase accumulators, agent and House continuity, transcript cursors, token/cost cursors, owner epoch, and intentionally missing or blocked inputs.

## Continuity capsule

Structured private runtime state used by supported resume paths or future resume work to preserve strategic behavior. Agent continuity capsules are scoped per player and carry subjective strategy/memory state; the House continuity capsule is scoped per game and carries privileged producer context. Raw prompts, hidden reasoning, and private evidence can link to a capsule but are not themselves continuity state.

## Owner epoch

The durable single-writer ownership marker for a live game run. An owner epoch lets one worker process and commit accepted game facts while rejecting stale writers; LLM calls may run in parallel inside the owner, but accepted `GameState` and XState mutations stay sequential.

## Private evidence manifest

A producer/debug metadata record that points to raw LLM evidence such as prompts, model responses, `thinking`, `reasoningContext`, provider reasoning summaries, and normalized agent-turn objects. The manifest may be stored in Postgres while raw content lives in private object storage; neither the manifest nor the raw evidence is player-visible dialogue or canonical board state.

## Producer private trace data

The maintainer/debug evidence lane that can include full prompt requests, raw model responses, tool calls, provider profile, model ID, requested reasoning effort, observed reasoning metadata, token or usage counts, router billing fields, storage pointers, and normalized decision records. Producer private trace data may contain the same reasoning and strategy material that later feeds player-private reasoning artifacts, but it also contains operational and provider evidence that is not part of the player-private product lane.

## Private trace content

The raw JSON/JSONL producer evidence addressed by a private evidence manifest, such as full prompt requests, model responses, `thinking`, `reasoningContext`, provider reasoning summaries, tool arguments, action names, actor context, phase, round, provider metadata, usage or billing metadata, and canonical event boundary. Private trace content is producer private trace data for local producer/debug inspection and must not become public transcript, canonical board truth, checkpoint resume authority, or unsanitized player-private product data.

## Local Trace MCP

A local-development producer MCP that inspects API-backed durable runs through private trace manifests and private trace content. It is not a product/admin MCP surface until MCP auth login, web/admin affordances, and releasable packaging are intentionally designed.

## callTool reasoning augmentation

The single choke-point in `InfluenceAgent.callTool<T>` that guarantees every structured decision return and every JSON-fallback path carries model-side reasoning evidence when available (via `as T & { reasoningContext?: string }` intersections only — never `as any`). For local models this is native `reasoningContext`; for hosted OpenAI Responses calls it can be a labeled provider summary display. Tool schemas for observable decisions (cast_votes, use_power, council_vote, etc.) include a `thinking` field; the engine threads both values out to the phase loggers and `TranscriptEntry`.
