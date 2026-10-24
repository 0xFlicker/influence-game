# Reasoning & Transcript Observability

Werewolf v10 solo night turns (Doctor, Seer and one surviving wolf) request `targetId`, one spoken `text` explanation and nullable `cue`, with no separate required `thinking`. Multi-wolf discussion keeps private thinking. Preserve raw responses and available native reasoning in private evidence; do not invent a missing explanation. Omniscient replay and exports show each Doctor/Seer explanation before its role result, in a distinct room. Mystery and contestant observations never receive these asides. New games freeze v10 and its output policy at creation; existing games keep their saved version. `bun run simulate:werewolf:api` and `bun run simulate:models --game werewolf` use that same API contract. No `as any`; House calls remain direct.


Retrospectives remain speech-only. The prompt distinguishes beliefs and information available during play from facts revealed after the game, and invites one or two concrete moments rather than a mandatory success/failure recap. Werewolf speakers receive a named canonical reference for their own ballots and night choices, starting role/faction, known pack members, and investigations available before elimination. Death-night checks remain in the revealed account but are excluded from usable in-game knowledge. Fallback actions are marked unavailable; dialogue and earlier final statements cannot establish facts or motives. No private thinking, rationale, or event-reference output is requested. Existing frozen game accounts and accepted speeches are unchanged. The retrospective also receives a named postgame summary of winners, survivors, actual night/day eliminations, and vote tallies/abstentions. It checks earlier final statements against these canonical facts. Winners can include dead teammates. Knowledge differences remain explicit without supplying stock before-and-after phrases; the output remains speech-only.

Werewolf decision prompts name the acting player, identify elimination targets and previous ballots by both ID and name, and distinguish an elimination vote from endorsement. Strategic coaching is selected by assigned role: village roles receive village objectives plus their role advice; wolves receive pack objectives and deception guidance. Shared vote instructions contain mechanics, not faction-specific strategic examples. Public dialogue discloses whatever it says: claiming a personal investigation implies a Seer claim, even without naming the role. Useful contributions can interpret existing arguments or change a vote without adding new facts. Gameplay decisions allow 8,192 completion tokens for native reasoning plus the structured response; the 320-byte speech and existing private-thinking limits remain separate. Replay omits technical discussion-byte readouts; no replacement progress display is introduced.

Always retain simulation evidence: structured `thinking`, every sanitized provider request/response, available native reasoning or reasoning summaries, opaque encrypted reasoning, usage, retries, failures and pending attempts. Native reasoning that the provider does not expose cannot be reconstructed; record its absence rather than inventing it. API provider journals now persist successful and rate-limited raw evidence through the same private bucket/outbox path as failures, in addition to the accepted value used for recovery. Local journals retain complete attempts and stop on evidence-write failure. Never discard earlier run artifacts or overwrite a simulation directory. Private evidence must not enter contestant observations; removing `thinking` from the public gameplay decision is intentional, dropping its private copy is not.

House summary author calls reserve 8,192 completion tokens for reasoning and the exact JSON response. Ordinary/milestone public prose limits remain 180/360 UTF-16 code units, with a 1,200-unit private notebook. Track reasoning and completion usage separately: a short or absent public summary can still exhaust a shared output allowance. This changes capacity, not the configured reasoning effort or the summary's one-attempt/deadline policy.

Run paid Werewolf simulations **through the localhost API** (`simulate:werewolf:api`) so replay, Studio, MCP and private evidence all refer to the actual durable game. File-only runs are suitable for provider-free fixtures. Discussion prompts first assess whether speech adds something consequential, permit listening even after a direct handoff, and treat the byte budget as a ceiling rather than a target. The existing `thinking` field explains the value of speaking or listening; there is no separate should-speak call or forced pass quota.

Contestant privacy: Werewolf model observations expose roster IDs, names, and alive status only; archetypes and image metadata remain spectator-only. Each agent retains its own personality, backstory, and strategy instructions. Influence likewise projects roster identity/status without character metadata. Private reasoning and spectator exports are diagnostics, not contestant context.

The [retrospective contract](game-retrospective-contract.md) introduces exact final speech without a private-thinking field. Canonical postgame records bind actor, ordinal, frozen input and prior speeches; the private dossier and provider receipt are not spectator DTOs. [RT-03](game-retrospective-invocation.md) invokes speech through the existing provider journal, with full frozen context, exact priors and no strategy mutation. Native reasoning tokens remain usage evidence; they are not requested as a speech field. Accepted replay has no provider transport or repeated token usage. [RT-04](game-retrospective-runtime.md) connects Influence runner calls to the epilogue, and RT-05 connects the Werewolf runner. Simulation artifacts and reports retain the complete epilogue. Preserve no `as any`, separate cognition from speech, and direct House calls when adding orchestration.

Werewolf freezes the effective game-specific strategy at game start: owner notes when present, otherwise a Werewolf archetype default. CLI House characters use those same defaults. Inspect the private starting event when comparing strategy behavior; changing an archetype or saved notes later does not change a running game. The AI editor writes independent Influence and Werewolf blocks without reusing Influence tactics as a fallback.

The shared `/games/new` creator supports 6–8 Werewolf seats, 1–2 wolves, and optional Seer/Doctor roles. The initial event freezes this setup; agents see those public role counts and only receive actions for their actual assigned role. Archetype pool/fill settings apply to House-filled seats. Visual Mode generates spectator scenes through the existing image renderer; it does not add player reasoning or change original speech. CLI presets remain six/eight seats; `--game ID_OR_SLUG` can report a custom UI-created game without inference.

## Playback evidence boundaries

Both games reuse the House watch shell and scheduler. Werewolf Thinking requests are opt-in, Omniscient-only and bound to the consumed audience cursor and selected player. Prefetched entries and the live head cannot supply current thinking or cast state. Discussion passes have no playback cues, scrub stops, thinking shots or speech holds, even when Thinking is enabled. Their saved thinking remains available through the debugging API/MCP. Audience switches clear pending reads and restart paused.

Contestant observations exclude silent discussion entries and scheduler bookkeeping, including order, offer counts, silent/unavailable IDs, previous/next scheduled actors and end reasons. Their history cursor and contribution references count only visible speech; provider schemas use those references and validated decisions map back to canonical IDs before journaling. Current-turn redirection instructions and the shared byte allowance remain available. Public ballot order and abstentions remain visible. Canonical pass events, raw provider responses and private thinking are unchanged and remain accessible for debugging through API/MCP.

Influence watch intelligence and alliance reads accept `throughEventSequence` and `throughTranscriptSequence`. The player sends its active authoritative boundaries, including presentation-stage cutoffs. Same-phase later thoughts and amended alliance terms must not appear on rewind; unanchored evidence is excluded from exact-position reads. Alliance state is rebuilt from the canonical prefix, and Diary uses the active transcript prefix. Full-game consumers can still make unbounded reads. These changes add no reasoning capture and do not expose native provider reasoning. Keep exact contracts, no `as any`, and future House calls direct.

## Werewolf decisions

The API CLI separates the final competitive result from retrospective progress and completion. Paused epilogues include their saved reason and a permission-checked `--resume-retrospective --game ID` command; read-only reporting cannot restart them. An open circuit cannot produce gameplay fallback commitments, including a partially successful sealed ballot batch. Previously accepted decisions stay in the provider journal for replay. LM Studio retains concurrent dispatch with a configurable one-hour request timeout, including server-side queueing. These changes do not expose new private thinking: the API report still shows accepted speech, roles in Omniscient, and optional production notes; use the viewer's Show thinking/Decisions controls for captured thinking. Keep no `as any` and direct House calls.

Historical v7/v8 sealed checkpoints dispatched ballots concurrently and revealed choices together. That timing remains in version-pinned replay; it does not describe current v9 play. V9 progress is public only as each accepted ballot is committed, and spectator progress must never expose a future choice or enter contestant observations.


The Aggressor's default strategy preserves confrontational style and permits overcommitment while separating faction tactics from temperament. Inspect the private starting strategy to confirm that a new game uses this revision: owner-written notes replace it, and existing games retain their frozen text. A character being eliminated is not by itself evidence that its strategy prompt failed. No decision schema, information boundary or role-coaching change accompanies this wording revision.

Current Werewolf v9 uses one byte-bounded open conversation, followed by one sequential public ballot. The discussion allowance and per-message limit are shown in contestant context; accepted UTF-8 speech alone consumes the shared allowance. A recipient gets the next turn for at most three handoffs; the last handoff must redirect or pass. Discussion closes below a full message allowance or after a complete silent sweep, without guaranteeing every player a speaking opportunity.

Conversation prompts explicitly say an offered turn, including a named handoff, does not require speech. Mere agreement, an unchanged suspicion or promise, and repeated statements that evidence is missing should become null-text passes. New information, substantive answers, corrections, changed commitments and useful unanswered questions still justify speaking. Evaluate this through accepted passes and whole-game dialogue; schema support alone is not evidence that models choose silence.

Every living player then votes once in seeded order. The voter sees all committed earlier ballots and messages, current totals, the strict-majority threshold, and the voters remaining. Each ballot is public before the next decision, and includes an optional short speech. Only a strict majority of all living players eliminates; abstentions do not lower the threshold. Everyone receives a ballot even after a majority is mathematically reached. No plurality, runoff, or further discussion follows. The canonical resolution still owns the final result; the preceding typed ballot entries own the visible sequence.

Rules v9 also combines a wolf's short pack speech and explicit attack target in one structured proposal. Wolves take up to three back-and-forth exchanges and stop when current proposals agree. This permits up to six decisions with two wolves but does not force all six. Omniscient and wolf observations can see proposal history; Mystery cannot. Captured thinking remains private to Omniscient replay and the actor's authorized decision view. Public projection does not contain private reasoning.

`werewolf/agent.ts` enforces exact native payloads for conversation, public ballot, and pack proposal. Structured target choices are separate from speech; the engine validates recipients, contribution coordinates, targets, byte limits, and each canonical transition. Oversize-message retries carry the rejected draft and exact measured/allowed size; retries do not enter public history or consume the accepted-text allowance. Provider-unavailable actions remain typed and visible as such. Never parse prose to recover votes, recipients, reply links, state, or scheduling.

Replay, reports, Studio, API and MCP use the same audience-local canonical projection. A v9 final result does not replay ballots a second time. The watch cursor advances over the committed sequence; Mystery excludes wolf proposals and role labels, while Omniscient can see them. Retrospective reading remains separate from the competitive outcome. Rules v7/v8 games retain their historic ordered threads, checkpoints, sealed reveal timing, and result semantics. See [current and versioned rules](werewolf.md).

Historical v7/v8 notes: the earlier rules used ordered opener-led threads and sealed checkpoint ballots; those ballots were hidden until resolution, and the final v8 checkpoint used plurality. Their saved trials and observability guidance do not describe v9.

Two Names restart checks must preserve distinct semantic coordinates for initial and final Mingle, including alliance proposal/version IDs and huddle schedule/session IDs. Those IDs derive from canonical boundaries so accepted provider results replay without new dispatch or collapsing the two windows. Inspect `--chatty` output together with canonical events and provider-journal evidence; prose alone is not restart proof. Keep direct House calls and typed contracts, with no `as any`. For gateway/worker drain and the existing Doppler dev database checklist, see [game worker operations](deployment/game-worker-operations.md).

These rules and patterns apply to the game engine (`packages/engine`) for surfacing agent internal reasoning during simulations, particularly for Mingle workflows and decision phases.

New default simulations and games use `openai:gpt-6-luna`; their sealed manifest and attempt metadata remain the source of model provenance. Existing games and explicit evaluation models are unchanged. Use the same `--chatty` inspection flow and direct House calls with typed contracts; no `as any`.

## Purpose

Lobby, every Mingle turn, and private alliance huddles use one final `# CONSTITUTION.md` dialogue driver across all models: one short paragraph, usually 1–3 sentences, under 100 tokens, with every word serving gameplay or the audience. The driver follows dynamic context and any visual/performance instructions. Private prompt/request traces include the same final text sent to the provider. It stays outside the stable system prefix without changing cache keys; providers do not expose a per-line guarantee against caching. This is speech guidance, not truncation, a schema constraint, or a smaller completion budget. Thinking, strategy, typed facts, legal silence, introductions, and formal speeches retain their existing contracts. Judge actual brevity and watchability from fresh outputs; prompt tests prove placement, not model compliance.

[Visual Mode](visual-mode.md) introduces a separate observable-performance contract. A close group image carries explicit visible IDs alongside the full canonical room roster; missing or off-camera characters remain room participants. Producer speech pointers never become identity evidence. Published corrections affect only future matching image context, leaving accepted provider traces unchanged.

Final 4 pleas use the lobby scene with exactly the remaining four players. Viewer endgame ballots come from sanitized `endgame.elimination_resolved` and `jury.winner_determined` tallies; eliminations change cast status at `player.eliminated`. Narration and image membership never establish who is still competing, and jurors can appear in Finals imagery while remaining OUT.

Scene preparation uses a committed-boundary hook before gameplay dispatch. The agent hook reads the accepted image afterward; waiting for scene generation is not an agent decision or an accepted cue. Paid render receipts remain durable even when a worker loses ownership before scene acceptance.

Durable Lobby, Mingle and huddles commit each contribution under a distinct provider slot. Room allocation, simultaneous movement, huddle selection/session boundaries and dialogue have separate accepted turns. Recovery replays accepted provider values without charging or publishing them again. Speech/pass and movement intent share one call where movement is available; unoffered/solo actors receive movement-only calls at the checkpoint.
Performance instructions describe delivery and mannerisms; they are not private thinking,
strategic decisions or canonical movement. Cues persist as producer-visible canonical records and are shared only with their applicable room audience; diary cues remain private. Cue strings have surrounding whitespace trimmed and are otherwise preserved without text matching, filtering or interpretation; gameplay actions retain their strict validation. Numbered images are derived from verified final-image head anchors,
not intended staging coordinates. Keep direct House calls and exact schemas; do not
introduce `as any` or infer decisions from speech or performance prose.

Private `thinking` + model-side reasoning evidence are captured so that bounded `--chatty` runs are actually debuggable and enjoyable for the human. Local OpenAI-compatible servers may provide raw native `reasoningContext` such as `reasoning_content`; hosted OpenAI Responses calls may provide provider-generated reasoning summaries that are labeled as OpenAI summaries. Agents' rationale and compact strategy operations for Mingle turns, named-alliance actions, alliance huddle turns, empower votes, empower revotes, format picks, format ballots, Safety Bounce pointers, format tiebreaks, diary answers, direct endgame votes, and jury votes must be visible in local debug artifacts when useful and persisted in structured simulation artifacts. Legacy classic candidate-selection, Power, and Council reasoning remains observable when that lane is deliberately exercised, but it is not the expected default standard-round path. Initial Format Mingle room assignment is one House-authored decision from the living roster and locked rule sheet; live rounds do not request per-player Mingle intent. Each alliance-action window also records one private House `alliance-proposer-selection` decision for `ceil(alive / 4)` access seats, including underrepresentation rationale and engine repair notes. This is producer observability rather than canonical alliance truth. The House also emits private huddle scheduling/outcome artifacts and authored phase-cadence MC summaries by default. Rich producer simulations add private House long-form narration using the same single narrative notebook; they do not add Strategy Bible or per-player producer-brief calls.

This observability layer exists because "master wants to see reasoning for voting as well" and equivalent signals for format decisions. Public player messages stay clean. Player-private cognitive lanes may store the agent's own reasoning and compact strategy state under the same established strategic-thinking visibility scope. Producer-private trace lanes additionally store provider profile, model/catalog IDs, requested reasoning effort, reasoning policy, full prompt request, raw provider response, observed provider reasoning metadata, usage counts, and router billing fields when available. Provider wrappers, prompts, responses, storage keys, source pointers, and private trace manifests stay in producer/debug surfaces. Thinking, reasoning context, strategy operations, and model provenance explain an attempted decision; they are never canonical board facts. Accepted events and replayable projections remain authoritative for what happened.

Canonical events and their projections are the only authority for accepted decisions, tallies, phase transitions, results, and replay choreography. Transcript prose remains displayable dialogue and observability; it must never be parsed back into a board fact or used to repair an event gap. For format ballots, **sealed means hidden from the in-game agents' context**. Once a ballot is durably appended, every authorized viewer and MCP game reader receives the complete sanitized voter → target → polarity ledger. That viewer fact excludes cognition, decision IDs, source pointers, traces, prompts, and raw envelopes; it does not feed the ledger back into an in-game agent.

For `--flex` simulations, the batch summary also aggregates the effective OpenAI service tier returned by every successful provider response. That producer/debug metadata supports tier-aware run-cost estimates, visibly separates auto/default fallback from Flex, and produces a Flex-normalized comparison across the selectable hosted OpenAI models. Resource-unavailable 429 attempts do not create usage entries.

## Architecture / Data Flow

`callTool<T>(...)` (in `agent.ts`) is the single source of truth:

- It always augments the returned object with `reasoningContext` via clean intersection:
  ```ts
  const args = JSON.parse(...) as T & { reasoningContext?: string };
  args.reasoningContext = reasoningContext;
  // (same pattern for parsedContent, jsonFallback, and mismatch paths)
  ```
- Never use `as any`.
- Hosted OpenAI calls with `openAIReasoningSummary` enabled use the Responses API with JSON Schema output. The returned simulation/debug object gets a labeled `OpenAI reasoning summary (...)` display string when the provider supplies one; private traces keep the structured `providerReasoningSummary` payload separate from raw `reasoningContext`.
- Every player and House provider request starts with the same concise game-context contract: Influence is a fictional, text-only social-strategy competition among AI characters, and targeting, elimination, survival, and format names refer only to voting and removal from the competition. Persona copy should express game risk and social consequences directly instead of using physical-harm metaphors. This context is truthful request framing, not a retry or bypass mechanism; a provider `invalid_prompt` rejection remains a failed request.

Decision methods on `IAgent` / `InfluenceAgent` return the extra fields (typed on the interface and implementation). Eligible living-player surfaces extend `StrategicDecisionMetadata`: ordinary actions may return nullable `strategyDelta`, while `reconciliation_required` / `repair_required` boundaries request full `strategy`. A delta is exceptional: emit one only for a material, actionable change to targets, alliance posture, commitments, threat assessment, priorities, or contingencies. Do not summarize the current action, repeat the baseline, narrate unchanged intent, or emit filler to prove strategy was considered. Strict structured schemas use a required nullable key, so JSON `null` is the expected no-change value; compatible non-strict outputs may omit it. The exact string `"null"` is normalized to the same no-change outcome. At a required full-strategy boundary, JSON null, the exact string `"null"`, omission, and whitespace remain missing values and follow the existing rejection/repair path. Tool-specific mechanics remain unchanged and strategy validation is independent of the gameplay action.

- `getMingleIntent(...)` → intent fields + `thinking`, optional `reasoningContext`, and boundary-appropriate strategy metadata when this historical/isolated lane is exercised.
- `takeMingleTurn(...)` → `{ thinking?: string; message?: string | null; noReply?: boolean; gotoRoomId?: number | null; gotoPlayerName?: string | null; reasoningContext?: string; strategyDelta?: string | null }`
- `getAllianceAction(context, opportunity)` → `{ action: "propose" | "accept" | "decline" | "counter" | "defer" | "trial" | "amend" | "pass"; ...; thinking?: string; reasoningContext?: string; strategyDelta?: string | null }`. Only the engine-finalized House access set receives proposer opportunities; invited response opportunities remain demand-driven and do not require proposer selection. Response schemas expose only legal actions for that proposal state and never ask the model to reproduce lineage/version UUIDs. Amendment schemas use request-local handles (`A1`, `A2`, ...) that the agent maps back to canonical active-alliance IDs before returning the action.
- `getAllianceHuddleTurn(...)` and public/private message actions return their message fields, `thinking`, optional `reasoningContext`, and boundary-appropriate strategy metadata.
- `getVotes(...)` / `getEmpowerRevote(...)` return their canonical target fields, `thinking`, optional `reasoningContext`, and boundary-appropriate strategy metadata.
- Empower revote rules are frozen at creation as `empowerRevoteVersion` and included in `game.roster_initialized`. Version 2 counts the current round’s new revote ballots; version 1 counts active ballots including uncleared initial votes to tied candidates. Missing historical versions mean version 1. Recovery and presentation use that frozen version, never the winner or a per-result marker. Initial votes remain separate social receipts, and historical outcomes are not rewritten.
- `pickRoundFormat(...)` returns its selected format, `thinking`, optional `reasoningContext`, strategy metadata, and deterministic source/fallback provenance.
- `getSaveOrEliminateBallot(...)` keeps canonical engine polarity `{ polarity: "save" | "eliminate"; targetId: UUID; ...format provenance }`; its provider tool uses `save_or_exit_ballot` and returns `"save" | "exit"` before boundary decoding.
- `getVoteBombBallot(...)` keeps the canonical engine method name; its provider tool is `short_list_ballot` and returns `{ targetId: UUID; ...format provenance }`.
- `getMajorityEliminationBallot(...)` keeps the canonical engine method name; its provider tool is `highest_count_ballot` and returns `{ targetId: UUID; ...format provenance }`.
- `getBouncePointer(...)` → `{ targetId: UUID; ...format provenance }`
- `getSafetyBounceVote(...)` → `{ targetId: UUID; ...format provenance }`
- `breakFormatEliminationTie(...)` → `{ targetId: UUID; ...format provenance }`
- Legacy/classic `getCandidateSelection(...)`, `getPowerAction(...)`, and `getCouncilVote(...)` retain the same thinking/reasoning contract when that non-default lane is exercised.
- The first living-player diary answer after an eviction returns visible `message`, private `thinking`, and required full `strategy`; an optional follow-up returns the same nullable `strategyDelta` as an ordinary action unless it is repairing a failed replacement.
- `getEndgameEliminationVote(...)` / `getJuryVote(...)` return their target and reasoning fields; living-player surfaces carry strategy metadata, while jurors are excluded from survivor reconciliation.

(Similar treatment for public messages, `getPowerLobbyMessage`, diary entries, accusations, jury questions, etc.)

Phase runners receive the rich result, record only the narrow game-state value when required, then forward the reasoning fields:

- `phases/vote.ts`: `logger.logSystem(..., votes.thinking, votes.reasoningContext)`
- `formats/agent-surface.ts`: owns exact validate → tool call → deterministic repair → provenance paths for catalog decisions. Shared sealed formats use catalog descriptors; Two Names uses dedicated strict initial-pair, Override, replacement, finalist-ballot, and tiebreak contracts because its legal sets and participation differ. Optional plea exhaustion records canonical absence rather than fake speech. Add another format through the capability-owned surface; do not make a side-channel model or House call.
- `phases/format-kernel.ts`: emits `format-pick` for `pickRoundFormat` when a two-card menu exists, `format-ballot` for Save-or-Exit, The Short List, Highest Count, Even Votes, Restricted History, and the final Safety Bounce vote, `bounce-pointer` for each public Safety Bounce pointer, and `format-tiebreak` when the empowered player resolves a tie. A round with one available format emits the authoritative `format.selected` state without `format.menu_offered` or a fake `format-pick` turn. Each normalized response includes `decisionSource` and nullable `fallbackReason`. **Sealed is an in-game-agent-context boundary:** operator/sim `format-ballot` turn `text` and House rollup lines include the actual ballot (e.g. `Atlas sealed ballot: EXIT → Echo`) so `--chatty` and turns JSONL remain legible; the viewer/MCP ledger is separately projected from the durable canonical event. Safety Bounce pointer prompts state the acting player's computed status and its exact opposite-status consequence: a SAFE actor makes the target VULNERABLE, while a VULNERABLE actor makes the target SAFE. Treat any `thinking` or `reasoningContext` that contradicts the recorded `response.classification` as a reasoning-quality failure; the accepted response and canonical board remain authoritative.
- `phases/two-names.ts`: records initial names, the canonical draw, Override, conditional replacement, two plea outcomes, eligible finalist ballots, and a conditional Empowered tiebreak. Each action retains its own durable provider coordinate; Override use and Empowered replacement commit atomically; new Override draws exclude Empowered. Plea exhaustion records typed absence and continues.
- `phases/elimination.ts`: commits `player.eliminated` before calling the eliminated agent's dedicated `elimination_message` tool, then emits one public `elimination-message` turn and `player.elimination_message_recorded` event. Public-vote disclosure may include voter names. Format elimination-message prose may summarize counts, but it is not the ballot ledger and must not be parsed into one.
- Legacy/classic `phases/vote.ts` candidate selection, `phases/power.ts` power actions, and `phases/council.ts` votes remain observable for historical or explicit classic runs.
- `phases/mingle.ts`: live standard rounds record the House-authored private `mingle-room-assignment` turns with assignment source/repair notes, then private Mingle turn responses with movement and compact-strategy results. Historical and isolated fixtures may still contain `mingle-intent`; live rounds do not purchase one intent call per player. **Operator `text` on these turns is required for follow-along:** room assignment includes room + roommates + source; Mingle turns include room, talk/no_reply, and next movement. Sealed/private means player-facing, not operator-redacted. Mingle room numbers remain stable within a Mingle phase; `beat`/turn carries the temporal distinction.
- `phases/alliances.ts`: emits exactly one private `alliance-proposer-selection` House turn after post-pick Format Mingle rooms. It records the ceiling budget, finalized access set, House/per-player rationale, and deterministic eligibility/underrepresentation repair notes; it emits no canonical alliance event. The House selects access only and cannot author members or terms, activate, rewrite, dissolve, or enforce alliances. Only finalized players receive proposer `alliance-action` turns, while invited proposal responses/counters remain demand-driven through the unchanged lineage/version consent transaction. Each alliance-action provider request places the selected opportunity under a closed `decision` union so non-term actions cannot carry replacement terms; after name/handle resolution, durable accepted values retain the existing flat ID-based shape. The phase binds each response after the model call, generates new counter versions itself, omits counter when the two-counter cap is exhausted, and resolves consented amendments through the same transaction loop. Private `alliance-huddle-schedule` turns carry House grant/skip rationale, and private `alliance-huddle-turn` turns carry authoritative member target/action/commitment/contingency/confidence/dissent facts. `alliance-huddle-outcome` carries those facts forward with a compact House summary; each outcome uses its durable schedule ID as the provider semantic coordinate. House prose must not invent a target or consensus. Huddle transcript entries use `scope: "huddle"` and must stay hidden from public/player-safe transcript surfaces by default.
- `diary-room.ts`: after canonical eviction, the first living-player answer commits a full compact-strategy replacement or leaves `repair_required`; optional follow-ups reuse the shared delta envelope or repair with full `strategy`. It emits no reflection-only or strategy-packet turn.
- The House follow-up-or-close decision uses a strict provider-native `{ decision, text }` schema. Invalid or semantically incomplete responses retain the retryable `malformed_house_followup` outcome instead of being accepted as diary choreography.
- `diary-room.ts`: builds the interviewer prompt from the subject player's `PhaseContext` and that player's prior diary Q&A. The prompt may include public state, conversations the subject participated in, the subject's own decisions, and their own diary history. It excludes the House notebook, House summaries, peer-only private conversations, other players' decisions, and other players' diary answers.
- `game-runner.ts`: schedules authored House beats after meaningful actor-coordinate boundaries across introductions, normal format and legacy phases, Reckoning, Tribunal, and Judgment. One exact-schema provider call returns nullable `publicSummary` and `privateNarrativeNotebook`. Accepted public copy is emitted byte-for-byte after presentation validation; a non-null notebook atomically replaces the bounded private snapshot. The checkpoint containing both is durable before the viewer event is released. `house-mc-summary` records plus clean `dialogueKind: "house_summary"` system transcript text are on by default unless `enableHouseRoundSummaries` is `false`. The House may use omniscient producer context and deliberately reveal it to human viewers, but contestant prompts and Recall Plans receive neither House prose nor the notebook. Rich producer mode adds private `house-long-form-summary` observation output over the same context and notebook.
- Every phase runner that resolves an agent call also emits an `agent_turn` stream event via `logger.emitAgentTurn(...)` with the normalized response the game used.
- Decision agent turns can include the submitted strategy candidate plus its accepted/rejected/no-change result and resulting engine revision. No extra inference turn is created for that receipt.

### House-authored narrative and telemetry

House creative turns keep exact schemas for routing and typed failure, not for factual proof. The cadence schema contains exactly two required nullable fields: `publicSummary` and `privateNarrativeNotebook`. Long-form producer output has one authored `summary` plus optional presentation reasoning. These schemas contain no claims, aliases, receipts, source coordinates, or fact-read action.

The engine validates authored copy only as presentation: expected shape, non-empty strings, control characters, and the existing 180-character ordinary / 360-character milestone beat bounds. It does not grade, rewrite, fact-check, or render the prose. Provider refusal, malformed output, or exhaustion emits no fabricated summary and preserves the prior notebook. Pending delta still follows the bounded carry/drop cadence policy.

`HouseNarrativeContinuityV2` contains recent public beats, one private opaque notebook snapshot, actor-coordinate heads, and pending-delta state. Null notebook output preserves the snapshot; non-null output replaces the whole bounded snapshot. The accepted beat and matching notebook commit in the same durable logical turn before its viewer publication is released. Version-1 House continuity is not accepted as current authority; supported active pre-logical-turn games use the one-time exact checkpoint cutover, so an ordinary reload does not require a drain.

The omniscient producer context may include canonical events, projection state, private dialogue, sealed decisions, and diary Q&A. That is a producer/showrunner capability, not contestant knowledge. Diary and Judgment prompts are built from an actor-scoped projection and must not contain the House notebook, House summaries, operator traces, or information private to other players.

Every scheduled boundary records engine-generated `HouseSummaryPhaseTelemetry`: boundary, status, provider call count, returned usage, and pending-delta disposition. Simulation instrumentation reconciles those calls with `TokenTracker`. This telemetry contains no creative source attestations and costs no model tokens. Recall Plan and prompt-reuse structural telemetry remain separate and unchanged.

`AgentTurnEvent` (game-runner.types.ts) is the structured simulation-analysis shape:

```ts
export interface AgentTurnEvent {
  type: "agent_turn";
  round: number;
  phase: Phase;
  timestamp: number;
  action: string;
  actor: { id?: UUID; name: string; role?: "player" | "juror" | "house" };
  visibility: "public" | "private" | "anonymous" | "diary" | "system";
  response: Record<string, unknown>;
  thinking?: string;
  reasoningContext?: string;
  scope?: TranscriptEntry["scope"];
  text?: string;
  to?: string[];
  roomId?: number;
}
```

`TranscriptLogger` (all `log*` methods, especially `logSystem`):

```ts
logSystem(text: string, phase: Phase, thinking?: string, reasoningContext?: string): void {
  const entry: TranscriptEntry = {
    ...
    ...(thinking && { thinking }),
    ...(reasoningContext && { reasoningContext }),
  };
  ...
}
```

`TranscriptEntry` (game-runner.types.ts) remains the human-viewing dialogue shape; it is not canonical board state or replay authority:

```ts
export interface TranscriptEntry {
  ...
  /** Agent's internal thinking when producing this message (hidden from players, visible to viewers) */
  thinking?: string;
  /**
   * Model-side reasoning evidence. Local models may provide raw `reasoning_content`;
   * hosted OpenAI Responses calls may provide a labeled provider summary.
   * Captured separately from the agent's "thinking" field for richer simulation traces.
   */
  reasoningContext?: string;
  /**
   * Additive normalized product-dialogue context on modern capture (actor identity,
   * audience player IDs, dialogue kind, formal-speech correlation key). Diary/thinking
   * rows stay outside dialogue identity. Local simulation formatting continues to use
   * the human-facing fields above; production match-read DTOs serialize only the
   * allowlisted subset (authority, visibility, speaker, audience, safeContext, text).
   */
  ...
}
```

Current-capture product dialogue carries normalized actor/audience/context fields so
owner match-read MCP tools can page authorized speech without re-deriving membership
from free text. Inline `thinking` and `reasoningContext` remain local simulation /
debug lanes and **must not** appear on owner transcript DTOs (`contentTrust:
untrusted_game_authored` labels player/model prose; structural `nextReads` and filters
are never derived from that prose). Owned thinking/strategy for Production MCP live on
`read_owned_match_cognition`, not on transcript pages.

Public websocket `message` events do not publish the internal `TranscriptEntry`
object directly. `packages/api/src/services/ws-manager.ts` builds a
`PublicWsTranscriptEntry` by selecting the viewer-safe fields used by the web
client: round, phase, sender, scope, recipients, room identifiers, public room
metadata (`rooms` and `excluded` only), text, timestamp, and viewer-facing
`thinking`, plus viewer-safe anonymous rumor metadata (`anonymous` and
`displayOrder`). Hidden `reasoningContext`, room allocation diagnostics,
prompts, raw provider responses, storage keys, source pointers, decision logs,
private trace manifests, and producer-only evidence must stay out of that
websocket payload. This keeps live watch/replay useful without changing MCP or
cognitive-artifact authorization policy.
Accepted participant `huddle_speech` is projected into chronological public replay, live websocket dialogue, Studio and export with its saved structured thinking. Show thinking controls presentation just as for other speaking turns. Thinking can join a speech by its exact accepted decision ID; unmatched huddle cognition, private selection/pass/unavailable records, strategy and native reasoning never produce watch moments. The saved scene binding uses the exact participant set and does not change ordinary room occupancy. Production Game MCP owner transcript pages independently require an immutable session-time audience; public spectator visibility does not widen owner or contestant access.

Viewer decision transport is separate from transcript transport. After durable append,
the websocket emits the additive `viewer_decision_event` envelope; persisted replay
frames use schema v3 and carry the same allowlisted `viewerDecisionEvent` for the
same trusted canonical prefix. The contract includes classic empower/expose, Power,
and Council decisions plus format menu, selection, sanitized format ballots, Safety
Bounce starter/pointers, and resolution. Clients own animation timing; they never
derive a decision from transcript text. Late joiners or reconnecting clients fetch
the trusted replay/event prefix with `afterSequence` before consuming newer websocket
events.

For `--chatty` live viewing (`simulate.ts`):

```ts
function formatEntry(e: TranscriptEntry): string {
  ...
  if (e.thinking) {
    line += `\n    ${thinkingColor}thinking: ${e.thinking}${reset}`;
  }
  if (e.reasoningContext) {
    line += `\n    ${reasoningColor}reasoning: ${e.reasoningContext}${reset}`;
  }
  if (e.from === "House" || e.scope === "system") {
    line = `${yellow}${line}${reset}`;
  }
  return line;
}
```

Default non-chatty console mode prints an **operator action feed** (votes, format picks/ballots, room seating, alliances, House outcome lines) plus **`[House MC]`** between rounds — without thinking/reasoning. `--chatty` adds full transcript + reasoning. `--quiet` / `--no-operator-feed` collapses to phase progress only; `--no-house-summaries` suppresses the MC block. House is omniscient: `house-mc-summary` `response.roundFacts.formatResolution` carries every sealed ballot, scoreboard, bounce chain, and elimination summary. In-game agent context remains sealed; the authorized viewer/MCP ledger is a separate canonical-event projection:

```bash
bun run simulate -- --variant mingle --max-rounds 2
bun run simulate -- --variant mingle --chatty   # full traces
bun run simulate -- --variant mingle --quiet    # phase progress only
```

House MC summaries (`house-interviewer.ts` + direct calls in `game-runner.ts`) are accepted as typed House audience artifacts and projected into `house-mc-summary` agent-turn records plus the same `logSystem` path. The human-viewer system transcript receives only engine-rendered text and viewer-safe `house_summary` metadata; it does not receive claim internals, private source values, or provider traces. The artifact is House/producer/viewer facing, not contestant-agent knowledge. Format **board facts** remain durable canonical events and MCP round-facts (not narration or private-trace-only):

| Fact | Canonical event | Visibility | MCP surface |
|---|---|---|---|
| Offered menu | `format.menu_offered` | public | `filter_events`, `read_projection.summary.formatMenu`, `read_round_facts.format` |
| Selected/locked format | `format.selected` | public | same; projection `formatMenu.selectedFormatId` |
| Safety Bounce starter/pointers | `format.safety_bounce_started`, `format.safety_bounce_pointer` | public | `filter_events`, `read_round_facts.format.safetyBounce` |
| Resolution aggregates | `format.resolved` | public | `filter_events`, `read_round_facts.format` (nets/totals/pools) |
| Accepted ballots | `format.ballot_cast` | public sanitized projection | `filter_events` (`eventShape: "viewer_decision"`), immediate `read_round_facts.format.acceptedBallots`; resolution-gated `ballotPresentation.rollCall` for viewer pacing |

Canonical payload versions are event-specific. Historical `format.resolved` version 1 is readable only for the original trio and carries its exclusive `saveOrEliminate`, `voteBomb`, or `safetyBounce` bag. New resolution writes use version 2 capability aggregates: `sealed_polarity`, `sealed_elim`, or `public_chain`. Every other canonical event remains version 1. Readers reject unsupported event/version pairs and capability mismatches; they do not relabel, rewrite, or reconstruct historical events from prose.

Private decision rationale (`thinking`, `reasoningContext`, compact strategy prose, model metadata) still comes only from dedicated transcript/turn/private-trace records and must never appear in public or owner round facts. Participating-agent context is the restricted lane: before resolution, a player may receive only the ballot knowledge the format rules allow, never the operator ledger. Direct accepted actions may now carry a producer-private decision source pointer, but player-safe event envelopes remove it before serialization. Operator-facing sanitized mappings are transport-readable immediately after durable acceptance; the browser buffers their named display for Tally → Roll Call pacing and does not redefine canonical visibility.

```ts
// Public format proof without private traces:
filter_events({ gameIdOrSlug, eventType: "format.selected" })
read_projection({ gameIdOrSlug }) // formatMenu.offeredFormatIds + selectedFormatId
read_round_facts({ gameIdOrSlug, round }) // acceptedBallots now; ballotPresentation.rollCall after resolution

// Producer raw envelope/provenance (separate from the shared sanitized ledger):
filter_events({ gameIdOrSlug, eventType: "format.ballot_cast", visibilityMode: "producer" })
```

House MC still uses omniscient `response.roundFacts` / `formatResolution` for narration; decision rationale still comes from the dedicated transcript/turn records:

```ts
const summary = await this.houseInterviewer.generateHouseSummary(summaryContext);
this.emitHouseSummaryTurn("house-mc-summary", resolvedPhase, summary, "system", evidence.roundFacts);
this.logger.logSystem(summary.summary, resolvedPhase);
```

The legacy/classic `PowerAction` interface itself (`types.ts`) stays narrow:

```ts
export interface PowerAction {
  action: PowerActionType;
  target: UUID;
}
```

The extras live only on the agent return value, `TranscriptEntry`, and `AgentTurnEvent`. Game state and tally logic never see them.

## API-Backed Private Traces

Simulation runs persist per-turn reasoning in local JSONL artifacts. API-backed owner runs can also persist a deeper private trace for model-call inspection:

- `PrivateDecisionTrace` is emitted at the model-call boundary where prompt messages, the prompt request envelope, raw provider response, tool arguments or parsed JSON output, emitted `thinking`, native `reasoningContext`, hosted OpenAI `providerReasoningSummary` payloads, provider profile, model/catalog IDs, requested reasoning effort, usage counts, and router billing metadata still exist.
- Each trace can include a producer-only `promptReuse` structural receipt: pseudonymous lane, block class/volatility, hashes, character/token estimates, and first structural break. It deliberately excludes prompt text, names, tool arguments/schemas, responses, credentials, and provider request IDs. This is provider-neutral continuity measurement—not a cache, billing, savings, or dollar claim.
- `InfluenceAgent` and `LLMHouseInterviewer` receive an optional `privateTraceSink`; without a sink, engine behavior and simulation artifacts are unchanged.
- `game-lifecycle.ts` supplies the sink only for owner-backed API runs. The sink calls the API private trace writer, which stores raw JSON content in private S3-compatible content storage and creates a `game_evidence_manifests` row with producer-private counts/facets such as model identity, requested reasoning policy, token usage, and router billing when present. The manifest must not contain raw prompt, response, or reasoning text.
- The same owner-backed trace boundary feeds the provider spend ledger for admin cost accounting. Ledger rows store safe operational facts such as actor/action/model identifiers, usage counters, provider-native billing facts, cost confidence, and pricing provenance. They must not store raw prompts, raw responses, thinking, reasoning context, tool arguments, storage pointers, presigned URLs, raw provider exports, or manifest/object storage details in admin API responses.
- OpenAI Responses estimates use the effective `service_tier` returned by the provider, not only the requested tier. GPT-5.6 Luna pricing follows the July 30, 2026 rate card, including distinct cached-read and cache-write input buckets; Flex uses the published 50%-discounted rates. These remain `static_estimate` rows rather than provider-actual charges.
- Katana `usage.imgnai` billing fields such as provider USD cost and credits are treated as producer-private router billing evidence. Backfill reruns may reprice already-captured trace rows from those actuals, or from a known model rate card when actual router billing is absent. Static `grok-4-3` estimates must honor Katana's high-context tier for requests above 200k total tokens.
- Historical private trace manifests may contain only aggregate usage totals instead of prompt/completion token buckets. Backfill may price those rows as conservative static estimates from aggregate usage and must keep them labeled as estimates, not provider-actual spend.
- `game_results.tokenUsage` is public-result compatibility data. It may carry public-safe token counts and legacy estimate fields already exposed by completed-game APIs, but new provider spend ledger facts, cost-source confidence, provider-native charges, pricing provenance, trace references, and breakdowns belong only in the shared producer/admin Admin Cost Detail read contract (`GET /api/admin/games/:idOrSlug/costs` and producer-only MCP `read_producer_game_cost_detail`).
- Local validation must use a real S3-compatible private content endpoint, not the profile-picture filesystem fallback. Run `bun run s3:bootstrap`, source `.env.private-trace.local`, and use `bun run trace:local:smoke` to verify the local writer/read/search path.
- Trace write failures degrade trace diagnostics but must not throw into canonical gameplay, accepted events, transcript logging, or checkpoint persistence.
- The local Trace MCP (`cd packages/api && bun run mcp:trace`) is the local producer inspection path for API durable runs. Use `list_manifests` for metadata, `read_content` for explicit raw content reads, and `search_reasoning_traces` for bounded run-scoped search.
- The deployed HTTP MCP surface is one `/mcp` resource with scope-filtered tools. User-facing grants use `agents:read`, `agents:write`, and `games:read` for rules, owned agents, supported pre-match enrollment, accessible game/season inspection, receipt-derived standings, owner exports, and authorized cognitive artifact reads; they do not expose private trace metadata, raw trace content, provider cost detail, hidden competition ratings, opponent evidence, or revision magnitude. The `producer` scope plus the current `producer` role exposes explicit private trace tools, `read_producer_game_cost_detail`, and `read_producer_season_diagnostics` for developer/global inspection.
- Agent revision snapshots now fingerprint the same owner-authored personality, backstory, strategy instructions, resolved model/provider/catalog, reasoning policy and temperature passed into `InfluenceAgent`. Avatar-only and other presentation edits remain outside that analytical boundary. When validating prompt observability, compare the stored effective revision with the actual system-prompt sections and call configuration rather than treating the mutable profile row as historical truth.

### Provider attempt failures and legal continuation

Decision traces and provider attempts are separate evidence types. Every logical player or House call runs through the shared attempt coordinator. Every terminal attempt preserves its exact sanitized prepared request and provider response, including successful decisions and native reasoning. Rate limits retain their aggregate counts and terminal reason as well as individual raw evidence. API evidence upload may degrade without failing gameplay because the durable private-payload outbox retains the body for recovery; it must not discard that body. The durable attempt reservation is required before dispatch. Local evidence-write failure stops the simulation instead of silently continuing to spend.

Optional speech exhaustion emits no transcript row and no synthetic `[No response]` prose. Required decisions fall back only through phase-owned deterministic legality and commit with engine-fallback provenance, so the action affects tallies/history without pretending a model supplied rationale, thinking, or strategy. A crash may repeat an indeterminate billable remote request; durable owner, attempt, budget, and accepted-result fences still permit only one canonical gameplay effect.

Admin game history shows a Provider failures action whenever evidence exists, including recovered calls. Admin/sysop reads revalidate current role on every request. Producer MCP uses `list_trace_manifests` and `read_trace_content` with `evidenceType: "provider_attempt_failure"`; it requires producer OAuth scope plus current producer role. Raw reads are bounded, continuable, audited, no-store, escaped in web UI, and marked as untrusted data in MCP. Public, player, owner-only, transcript, watch, and ordinary `games:read` surfaces receive none of it.

### Owner Learning failure evidence

Owner Learning failures use their own review-scoped diagnostic, manifest, audited-read, and durable-outbox tables. They do not reuse game evidence manifests because a review may cover several games and has no single game owner epoch. The worker records `selection`, `evidence_projection`, `materialization`, `call_reservation`, `provider_invocation`, `output_validation`, `checkpoint_persistence`, or `finalization` before entering each boundary.

`invalid_structured_output` requires a typed validation error during `output_validation`, an observed provider response receipt, and staged raw response evidence. Unexpected application/database failures are `internal_error`. Each `review_failed` event carries only a compact diagnostic summary, while the private envelope keeps the exact credential-scrubbed request, schema and parameters, raw HTTP/provider response or error envelope, decoded value, validation failure or complete exception/cause chain, provider/transport identifiers, usage/cost, checkpoint, protocol fingerprints, and redaction report. Strategy, dialogue, cognition, and generated output are retained because they are authorized debugging evidence; only credentials and configured secret values are redacted.

The complete envelope is transactionally inserted into the database outbox with the diagnostic. Reconciliation writes `content/owner-learning-reviews/<reviewId>/failures/<diagnosticId>.json`, verifies hash and byte length, links the immutable manifest, then deletes only the outbox body. Storage outages leave the body pending/degraded for indefinite retry. That prefix has no expiry lifecycle rule and there is no deletion endpoint. If diagnostic persistence fails, the review does not commit a terminal failure state.

Admin review list/detail exposes the safe phase/code/fingerprint, attempt lineage, accounting, diagnostic ID, and evidence state. Exact content requires a fresh current `admin` or `sysop` role on every bounded read and records allowed, denied, unavailable, integrity, and storage outcomes. Responses are `private, no-store`; the UI renders only escaped inert text. Owner review routes and Production Game MCP expose neither raw content nor diagnostic metadata. Legacy failures whose old worker discarded evidence are marked `legacy_unavailable`.

### Accepted-action correlation

A fresh receipt from the exact model call may link a trace to the direct canonical event that accepted its value. Eligible actions are official alliance mutations, initial and empower-revote ballots, format selection and sealed ballots, Safety Bounce pointers, empowered format tiebreaks, Power actions, Council votes, endgame elimination votes and Tribunal jury tiebreaks, and jury winner votes. Intentional aggregate events may carry several decision pointers; derived tallies, eliminations, and round summaries are not extra citations.

Speech, reflection, intent-only calls, passes, rejections, timeouts, unavailable methods, House-selected fallbacks, materially repaired choices, and legacy rows remain intentionally unlinked. Accepted-action writers use the receipt returned by the current call; this correlation path does not use mutable `getLastPrivateDecisionId()` state. A normalization may retain the receipt only when the phase acceptance check proves that the model's substantive choice did not change.

The API reconciles relational sidecars only after the canonical append assigns the final sequence. Reconciliation is forward-only, current-owner scoped, idempotent, conflict-aware, retryable on later flush/finalization, and non-fatal to an already valid action. Raw trace objects and hashes remain immutable, and historical rows are not inferred or backfilled.

Authority stays split:

- Canonical events and projections establish what happened.
- Owner narrative may attach only `{seq,type}` citations to already-authorized owned cognition; public dialogue alone cannot unlock a citation.
- Producer narrative and trace manifests may expose exact decision/sequence linkage. Manifest `linkageSummary` separates fully linked accepted decisions, degraded accepted decisions, intentionally unlinked traces, and rows that cannot be classified behind an invalid canonical tail.
- Public, player, transcript, watch, results, and ordinary `games:read` event responses never expose decision IDs or source pointers, and player actor filters never match through private pointers.

Prompt-reuse correlation changes attribution, not the aggregate calculation. A rollup watermark is the highest accepted canonical sequence represented by linked prompt-reuse sources. `coverage: "partial"` remains correct when a run also contains expected unlinked calls; a nonzero watermark does not mean every trace should map to an action.

For producer diagnosis, inspect indexes before content:

1. Call `inspect_durable_run` and confirm the trusted event prefix plus prompt-reuse `coverage`, per-owner watermark, request/comparable counts, reusable-token estimate, and first-break counts.
2. Call `list_trace_manifests`; inspect `linkageSummary`, then choose a linked manifest by `decisionId` and `eventSequence`.
3. Use `read_producer_match_narrative` to confirm the same cognition group carries the minimal `{seq,type}` action citation.
4. Use producer `filter_events` at that exact sequence/type to verify the canonical envelope and decision source pointer.
5. Only then call `read_trace_content` for that explicit manifest, with a bounded `maxBytes`. Raw content explains the choice; it never repairs missing board history.

Private trace content is not public transcript, not canonical board truth, and not logical-turn execution authority. It is the API durable-run sibling of `game-N-turns.jsonl`: useful for debugging one weird run, not a product/admin content portal. Reload reconstructs from the typed cursor, committed canonical/transcript rows, continuity, and accepted provider journal values—never from trace prose.

## Owner Learning Review Evidence

The Owner Learning Loop is an owner product surface over completed Daily Free play, not a new game-state or producer-trace authority. Its deterministic layer snapshots accepted actions, counterplay, outcomes, placement, and stable source coordinates from canonical postgame projections. Its contextual layer may include authorized surrounding dialogue and cognition for the reviewed owned Agent Profile. Transcript prose and cognition can support a strategic interpretation, but they cannot establish a vote, tally, elimination, or outcome and cannot repair missing canonical evidence.

The review harness sends a complete, versioned request through the Responses API with `store: false`, Luna, low reasoning effort, a 32,000 estimated-input-token admission ceiling, and at most 8,000 total output tokens inclusive of hidden reasoning plus visible output. A review has at most four logical model calls and three evidence dives. Each logical call starts on Flex; after three total Flex 429 responses, one byte-identical request may use standard `auto` capacity. The next logical call starts on Flex again. SDK retries stay disabled so durable call and transport receipts remain the replay boundary.

The persisted checkpoint stores only the bounded local investigation state and validated findings needed to continue. Generated diagnosis, recommendations, and the optional exact `strategyStyle` proposal are strict, length-bounded structured output. Server validation enforces the result shape and server-minted evidence refs; it does not pretend that syntax validation proves a free-form interpretation. Proof fields belong only to Strategy Health Check recommendations; unified provider-schema proof metadata is discarded on evidence-rich results. Strategy Health Check recommendations must separate observed evidence, strategic interpretation, proposed guidance, and an exact guidance target, and must frame repeated early exits as a pattern rather than a cause.

The Agent editor is presentation over that persisted result, not another evidence source. A review-linked edit starts from `proposal.after` and keeps a live diff against `proposal.before`; a custom save must differ from both values. Applying the exact proposal remains a review action. Only the final persisted Agent Profile Strategy enters later games or simulations, and the editor diff never becomes canonical game evidence.

Observability remains deliberately split:

- review call rows retain the credential-scrubbed exact request before dispatch, the credential-scrubbed raw response before parsing, numeric usage, requested/effective tier, capacity path, latency, safe failure state, and the price receipt that existed when the call completed; when an HTTP-successful response fails local output validation, the attempt retains the response receipt and exact validation code while the review keeps the broad owner-safe `invalid_structured_output` code; a rejected request with no provider usage receipt is shown as no usage receipt, not as spend;
- OpenAI request rejections emit one sanitized console diagnostic containing review/call identity, model/tier, HTTP status, provider request ID, error type/code/parameter, and a bounded single-line message; prompts, evidence, request/response bodies, headers, and credentials are never logged;
- application logs contain the complete credential-scrubbed exception and cause chain plus a diagnostic ID, phase, fingerprint, and manifest pointer, but never duplicate prompts or response bodies;
- every terminal failure transaction appends compact safe diagnostic metadata to `review_failed` and stages the complete credential-scrubbed evidence envelope in the review-scoped durable outbox; the envelope retains authorized strategy, evidence, dialogue, cognition, generated output, validation details, stack/cause chain, provider receipts, accounting, checkpoint, protocol fingerprints, and a redaction report;
- review events remain bounded: ordinary lifecycle events are content-free, while `review_failed` carries only the sanitized diagnostic message, first application frame, codes, coordinates, and manifest pointer—not the private evidence body;
- the owner-facing review reads validated diagnosis and recommendations and receives only generic failure copy plus retry availability; fresh `admin`/`sysop` reads may inspect or download the separately authorized, audited, inertly rendered private failure envelope.

Live generation is on by default when `OPENAI_API_KEY` is configured. Set `INFLUENCE_OWNER_LEARNING_GENERATION_DISABLED=true` to disable paid admission and worker startup. When disabled, input listing, credit derivation, deterministic facts, preflight, existing-review reads, resolutions, applications, and admin diagnostics remain available; new paid starts return a typed unavailable result without creating a review row or consuming credit.

## API-Backed Cognitive Artifacts

New API-created games set `games.cognitive_artifact_capture_version = 1` and fan out first-class cognitive artifact rows beside private trace writing. Old/imported/pre-capture games remain version `0` and return `not_captured_for_game` after authorization. The product path never reads producer private trace storage to reconstruct missing split artifacts.

- User-facing Production Game MCP pairs cognitive artifacts with `read_round_facts`, a sanitized canonical-event-derived facts tool. The default path is **format kernel** (empower + format resolution + endgame when present); classic Power/Council sections appear only on classic-kernel games. Use that tool when an artifact refers to votes, formats, or candidates; do not treat strategy prose, `thinking`, or `reasoningContext` as authoritative gameplay facts. If canonical events have not flushed yet, `read_round_facts` reports `not_yet_flushed`/`not_yet_resolved` availability instead of falling back to artifacts.
- Public web watching uses `GET /api/games/:idOrSlug/watch-intelligence` for the selected-agent cognitive inspector. The endpoint is public-by-URL, requires an `actorPlayerId` before returning cognitive cards, returns active `thinking` artifacts, whitelisted `strategy` fields, visible transcript `thinking`, and `buildRevealedRoundFacts(...)` receipts, and excludes `reasoning` artifacts, alliance-huddle transcript/thinking/strategy artifacts, plus raw payload/debug fields. Public web/replay alliance inspection uses `GET /api/games/:idOrSlug/alliances` as a separate game-level projection over official alliance proposals, records, huddle outcomes, and huddle speech. That route is public-by-URL for the viewer experience, omits hidden thinking and producer/debug internals, and does not change what agents know during the match.
- Completed-game review uses `GET /api/games/:idOrSlug/results` as the public-by-URL canonical result read. The result rollup is canonical-event-first: it replays persisted events, builds per-round revealed facts, and exposes elimination order, vote ledgers, endgame votes, jury votes, placements, source status, and degradation diagnostics. The compact postgame views (`GET /api/games/:id/postgame/brief`, `/postgame/jury`, `/postgame/players/:player/summary`, `/postgame/turning-points`, plus the Production Game MCP postgame tools) are denormalized DTOs over the same canonical facts. V2 postgame payloads begin with a maximum-five-item deterministic `executiveSummary`; expose short round `headline` values; rename ambiguous `majorEliminations` to rule-based `highlightedEliminations` while temporarily carrying the old alias; enrich `derivedVoteCohorts` with size, first/last observed round, shared votes, cohesion score, confidence, and a not-alliance note; split jury support into `winnerSupporters` and `runnerUpSupporters`; add deterministic `juryNarrative`, sparse `gameMomentum`, and conservative player `overallGameShape`. Derived confidence describes the derivation only. Player majority alignment is explicitly nullable: `true` or `false` requires participation in the corresponding canonical standard-vote or Council ledger, while `null` means the player did not participate or the round has no supported majority cohort; null rows stay visible in API/MCP payloads but are excluded from rates and strategic grades. These payloads can summarize round arcs, jury breakdowns, majority alignment, derived vote cohorts, momentum, and turning points, but they must not reconstruct missing facts from transcripts, `thinking`, `reasoningContext`, private traces, or prose summaries. Cognitive artifacts are optional context only; the endpoint may surface limited active `thinking` and whitelisted `strategy` snippets, but raw payloads, `reasoningContext`, provider wrappers, private trace manifests, storage keys, source pointers, and arbitrary debug fields stay out of player-safe responses and cannot define what happened.
- Local simulation summaries follow the same authority split. `endgameType` uses the latest canonical `endgame.stage_set` sequence, while stage totals, accepted jury questions, jury ballots, and endgame phase instrumentation count canonical events. House/system transcript banners remain useful presentation and observability, but changing, translating, duplicating, or removing them cannot change simulation results.
- `reasoning` artifacts come only from `PrivateDecisionTrace.reasoningContext` and/or `PrivateDecisionTrace.providerReasoningSummary.text` and are owner-only for user-facing access. User-facing payloads store provider summaries as text only; provider wrappers such as `parts` and `outputItemIds` remain private-trace evidence.
- `thinking` artifacts come only from `PrivateDecisionTrace.emittedThinking` and are readable by the owner plus same-game participants, except alliance-huddle actions, which are subject-owner-only unless the accessor has producer/admin access.
- `strategy` artifacts come only from normalized trace `strategyCandidate` fields. They use the same established strategy/thinking authorization scope; alliance-huddle actions remain subject-owner-only unless the accessor has producer/admin access.
- Producer/admin access may read all split artifacts directly, including degraded diagnostics. Raw prompts, raw responses, full request envelopes, model/provider IDs, requested reasoning effort, token usage, router billing, tool arguments, storage keys, source-pointer internals, and arbitrary `output` blobs are excluded from cognitive payload construction.
- Oversized cognitive payloads are stored as `capture_degraded` diagnostics with an empty user payload. Revisit object-storage manifests only if p95 artifact payload size exceeds 64 KiB, more than 1 percent of artifacts hit the 256 KiB cap, or typical captured games exceed 5-10 MiB of cognitive artifact payload.

## Selective Context Recall (Recall Plan)

Agent prompts no longer carry unbounded full public transcripts or complete historical game-event records. Before each call, ContextBuilder compiles a pure **Recall Plan** (`packages/engine/src/context-recall-plan.ts`) from:

- explicit **prompt class**: `ordinary_speech` (default) or `strategic_decision`
- actor id + current `PhaseContext` (board, alliance compact outcomes, active-room messages, required receipts)
- narrow **`RecallContinuitySnapshot`** containing compact strategy state
- full transcript used only as an eligibility source for historical candidates

### Lanes

| Lane | Contents | Budget |
|---|---|---|
| **Protected** | Board Contract, compact strategy state, historical authorized typed huddle fact atoms plus recent attended huddle dialogue, current receipts | Reserved first; never displaced by history |
| **Hot** | Active-room Mingle messages for this turn | After protected |
| **History** | Ranked public + actor-owned Mingle archive | Only `strategic_decision`; remaining budget after protected+hot, capped by the class history ceiling. If protected context overflows, strategic decisions retain a 1,200-character reserve; ordinary speech remains zero. |

Historical eligibility is fail-closed on modern identity: Mingle rows need `speakerPlayerId` and `audiencePlayerIds`; speaker or audience must match the actor. Display-name-only legacy rows do not become private recall during replay. Official huddle outcomes enter the protected lane only when `participantPlayerIds` (copied at outcome creation, or recovered from matching completed-session `speakerIds` on hydrate) authorize the actor. Participant snapshots never leave server-private surfaces (member-safe projections omit them). Modern payload-v2 outcomes carry only typed member atoms as factual content. Payload-v1 House summary prose is ignored and becomes an explicit empty fact set; optional House interpretation remains visible only in the private producer trace.

History ranking first rejects zero-overlap dialogue, then combines lexical overlap
with bounded current-round and living-speaker signals derived from current compact
strategy. For the same current-round named speaker, the latest statement wins.
Evaluation-only selection explanations expose
rank slot, lexical and combined scores, the two match flags, serialized item cost,
and terminal reason without including dialogue. The structural Recall Plan receipt
remains content-free.

Retrieved dialogue is **evidence, never authority**: it cannot override Board Contract, permissions, tools, or instructions. The plan must not imply that excluded private material exists.

Format ballot context follows the same authority split. ContextBuilder may include only the acting participant's rule-authorized knowledge; it must not promote the operator-facing `acceptedBallots` ledger into participant recall. Canonical operator transports expose sanitized mappings immediately after acceptance, while named viewer presentation remains resolution-gated through `ballotPresentation.rollCall`.

### Safe evaluation artifact vs private traces

Each simulation game writes:

- `game-N-recall-plan.json` — **safe structural aggregate only** (`RecallPlanReceiptAggregate` / `coverage: "structural_recall_receipts"`). Fields: request counts by prompt class, protected/hot/history token estimates, selected lane counts, history source-class counts (`public` | `mingle`), actor-authorized event-boundary rollup, protected-overflow count. No dialogue, names, entry IDs, rejected/foreign-lane counts, prompts, thinking, or `reasoningContext`.
- `game-N.json` / private decision traces / `game-N-turns.jsonl` — full producer artifacts. Useful for human/debug review; **not** the promotion input for the ≥50% late-game context reduction gate.

**Release gate (no paid LLM required):** run the frozen late-game corpus tests:

```bash
bun test packages/engine/src/__tests__/context-recall-evaluation.test.ts
bun test packages/engine/src/__tests__/context-recall-plan.test.ts
```

Those tests compare legacy vs candidate token estimates with `estimateTokensFromChars` (`ceil(chars/4)`), assert equal model-call count, full protected coverage, zero unauthorized history selections, and that a relevant authorized strategic memory survives protected overflow. Live `game-N-recall-plan.json` from a chatty run is a structural receipt for inspection, not a substitute for that deterministic gate.

Responses calls also provide a stable, hashed game-and-actor cache key. GPT-5.6+ requests use the current 30-minute cache policy; older models retain their provider default rather than forcing extended retention. Treat provider cache metrics as an optimization signal after this deterministic gate: inspect reusable-prefix and cached-token rates, but never use cache hits as evidence that recall was selected or authorized.

Prompt-class call sites: ordinary Lobby/Mingle/huddle/endgame speech → `ordinary_speech`; votes, powers, councils, format choices, survivor diary reconciliation, and other non-speech strategy decisions → `strategic_decision`. Compact-strategy lifecycle and revision changes advance the evidence boundary without a separate reflection call.

### Producer prompt scenario replay

`packages/engine/src/prompt-scenario-lab.ts` supports both one frozen decision snapshot and the accepted multi-step strategy chain through real public `InfluenceAgent` methods and a deterministic fake provider. The accepted durable fixture is Sage Round 2 from `calm-cyan-frost`: prior elimination, Lyra's canonical eviction, full diary replacement, optional follow-up delta, immediate next-round lobby, and the nine-choice empower vote. This exercises the production prompt/decoder path without another provider call.

The shareable runner report contains only structural counts, acceptance statuses, legal-choice counts, strategy lifecycle shape, and redacted request fingerprints. The separate producer-visible pack retains complete prompts, source provenance, dialogue, and strategy prose. `Producer-visible` is an Influence authorization classification, not repository confidentiality; the human-accepted fixture is intentionally committed. Run its deterministic suite with:

```bash
bun test packages/engine/src/__tests__/prompt-scenario-lab.test.ts
```

Use three evaluation levels without pretending they are interchangeable:

1. Structural fixtures prove deterministic budgets, authority lanes, renderer structure, and replay mechanics.
2. The local [real-thread context evaluator](prompt-thread-context-evaluation.md) materializes one authorized durable thread and attests two isolated policy revisions. Its `strategic-probe` makes zero provider calls and proves only selection direction for the two real Mingle-intent contexts, not whether a model uses that evidence or changes behavior. The probe records content-free rank, score, match-flag, serialized-cost, and terminal-reason diagnostics for approved citations; the separately approved panel measures provider/cache evidence and ends in blind human review. Every verdict is case-specific.
3. A bounded full-game simulation validates cross-phase integration, long-running strategy, pacing, and watchability. It does not isolate one context-policy cause.

Keep real-source ingestion, approval, and paid-run authority outside the engine fixture runner. Ordered same-agent replay is required before interpreting cache reuse. No provider dispatch is allowed during source validation, tests, builds, status, or report assembly.

### Replay / hydration contract

- Modern transcript rows that keep `entrySequence`, `speakerPlayerId`, and `audiencePlayerIds` through serialize→hydrate must recompile the same normalized plan and budget ledger for the same actor/prompt class/continuity.
- Legacy Mingle rows that only have display names must not upgrade into private historical recall.
- Historical payload-v1 huddle outcomes recover a participant snapshot only from matching completed-session speakers and always contribute `facts: []`; without that snapshot they are unavailable for protected recall (no current-membership fallback).

See `CONCEPTS.md` (Recall Plan), `docs/local-model-evaluation.md` (evaluation path), and `packages/engine/src/simulate.ts` JSDoc for artifact names.

## Core Style & Safety Rules

1. No `as any` anywhere in agent return paths, House calls, or reasoning threading. Use intersections or proper widening of return types. "`as any` scares master."

2. House calls must be direct (`await this.houseInterviewer.generateHouseSummary(...)`, `await this.houseInterviewer.updateStrategyBible(...)`, etc.) — no `if (typeof ... === 'function')` guards or `as any`.

3. Every structured decision that should be observable by viewers (votes, format picks/ballots/pointers/tiebreaks, Mingle turns, legacy classic actions, and Endgame choices) must solicit `"thinking"` in its tool schema and return it plus the attached `reasoningContext` or labeled provider summary display when present.

4. Public player-visible output (`message` in `AgentResponse` and Mingle room text) must never contain the hidden thinking; it is stripped or kept in a separate field.

5. Compact strategy is private cognition, not canonical truth. It lives on the agent during a run, changes only after an accepted gameplay/message boundary, and is never reconstructed from transcripts or `MemoryStore`. Canonical current-board facts override stale or mistaken strategy prose. Ordinary deltas are exceptional actionable changes; null or omission preserves the current epoch and is preferable to restatement.

6. Compact strategy is decision context, not a replacement for per-turn traces. Transcript entries and private `agent_turn` records may both carry `thinking` / `reasoningContext` in simulation artifacts; live `--chatty` output should avoid printing the same trace twice.

7. Checkpoint continuity capsules are the private snapshot lane for supported resume hydration of live agent and House behavior. Player capsule v2 carries compact-strategy lifecycle, baseline, ordered deltas, prior reconciliation epoch when required, revision, notes, relationships, round history, and power-action memory. Older player capsule versions fail closed. House capsules retain their separate sealed checkpoint-time requirement (`disabled` / `awaiting_first_valid_update` / `required`). Capsules are not canonical projection truth, not player-visible transcript, and not websocket-visible UI state. The admin durable-run hydration passport may expose only readiness stamps such as `playerContinuity`, `houseContinuity`, `runtimeSnapshot`, `boundaryCertificate`, `transcriptCursor`, `tokenCursor`, `ownerEpoch`, and `privacy`; it must not expose raw capsule bodies, `thinking`, `reasoningContext`, prompts, responses, storage keys, or source pointers. House absence is non-blocking when the sealed requirement permits intentional absence; required missing or malformed House continuity blocks readiness. A passing Runtime Snapshot v1 passport requires sealed token cursor boundary, expected active-player continuity coverage, and drained or proven-empty accumulators; accumulator capture labels are not a v1 evidence contract.

8. Terminal UX for `--chatty` (and persisted `game-*.txt` / `.json`) is a first-class human output. `game-*-turns.jsonl` is the per-agent-turn machine-analysis output and `game-*-events.jsonl` is the accepted-domain-event replay output; both must stay clean JSON without ANSI formatting.

9. When backing out experiments (e.g. the old `mingle-loop` variant that caused phase pollution / extra INTRODUCTION/LOBBY entries), prefer clean removal over more guards. The state machine must remain understandable.

10. Fallbacks in agent methods must still return the shape with `thinking` / `reasoningContext` (even if the thinking is a short "fallback..." note).

11. API private traces and cognitive artifacts must keep the engine/API boundary clean. Engine code emits typed trace envelopes only; API code owns storage, first-class cognitive artifact rows, read authorization, and MCP/API access. Do not import API storage or database code into `packages/engine`.

12. Missing cognitive artifacts are not reconstructed from private traces. User-facing access must return authorized no-capture/degraded states rather than falling back to producer evidence.

13. Huddle existence, speech, and House scheduling rationale are private contestant knowledge, authorized by immutable attendance. Spectator websocket, transcript, replay, Studio, and export projections may show accepted participant huddle speech without thinking. This deliberate spectator path does not widen contestant context, owner MCP authorization, or cognitive reads. Omit private passes, House scheduling rationale, House interpretation, prompts, raw canonical envelopes, source pointers, and producer/debug fields from spectator delivery.

## Local Model Specifics

See `docs/local-model-evaluation.md` for the full provider table. Key points that interact with reasoning capture:

- Every new game decision uses native JSON Schema: Responses `text.format` for OpenAI/Muse and Chat Completions `response_format` for Katana/local providers. LM Studio remains best effort; there is no tool-choice setting.
- `extractReasoningContext` (with a deprecated `extractNativeThinking` wrapper) pulls only the raw `reasoning_content` / hidden channel and attaches it exclusively as `reasoningContext`. It never falls back to the agent's emitted "thinking".
- Game and Owner Learning provider-native structured payloads normalize exact literal `"null"` to JSON `null` only at explicitly nullable schema positions, before full schema and semantic acceptance. Case/whitespace variants and `"undefined"` are unchanged; required strings, ordinary prose, missing fields, and malformed JSON are not repaired. Nested object/array and unambiguous union positions use the same policy across providers. Raw response evidence stays unchanged; accepted values contain the normalized value, and durable replay does not re-normalize stored values. Existing historical literal-null strategy no-change semantics remain intact. Owner Learning applies the same normalizer after persisting the raw response and before exact schema/harness validation; recovery of staged raw responses uses that same acceptance path. The Prompt Thread experiment broker remains a raw transport and does not normalize responses.
- Public player speech is accepted only from the exact schema-backed `AgentResponse` value for that invocation. Plain provider prose, broken or ambiguous wrapped JSON, schema wrapper objects, extra or missing fields, and blank messages fail inside the provider-attempt boundary; they emit no accepted transcript entry, strategy mutation, or private accepted-turn trace. Durable replay revalidates the stored typed value without redispatching or emitting a second trace.
- Decisions require one complete top-level JSON document matching the exact schema and domain rules. The shared decoder may unwrap one complete JSON container from Markdown or surrounding text before validation, without repairing syntax or selecting among candidates. Native reasoning is evidence only. All sanitized requests, raw responses, structured thinking, available native reasoning, failures, retries, and usage remain saved. Length repairs retain the rejected message, exact size and allowed size. Historical trace keys such as `toolName`/`toolArguments` and artifact IDs remain readable as evidence metadata; new provider requests contain no tools. Completed-game replay and Studio do not reinterpret historical decisions.
- House room assignment, alliance proposer selection, huddle scheduling, and diary follow-up calls decode their exact semantic value before the attempt can succeed. Incomplete coverage or partitions, over-budget or unknown identities, invalid enums, and a fifth follow-up question retry as malformed output and emit no accepted trace. Provider payloads and accepted values have separate exact validators where normalization changes their shape: required provider `thinking: null` becomes an omitted accepted-domain field, while explicit null or any other noncanonical accepted value fails replay. Durable replay revalidates the accepted domain value and does not emit another provider trace. New huddles make no House outcome call.
- `REASONING_TOKEN_OVERHEAD`, `REASONING_OVERHEAD_HIGH/LOW`, the global 8192-token structured floor, and the global 4096-token public-message floor give reasoning models room before the visible/structured payload.
- House Mingle room assignment and House alliance proposer selection are direct House calls, not contestant decisions. Both use strict JSON Schema output and the global structured token floor before deterministic fallback/repair; proposer repair prefers the lowest active-alliance count with stable living-roster ties.
- Local paths no longer omit the `thinking` field from decision schemas. Agents are still expected to emit their internal reasoning (the "thinking" the prompts and schemas solicit). The raw hidden server channel (if present) is captured *separately* into `reasoningContext` only and never overwrites the emitted `thinking`. This gives high-contrast bright-white `thinking:` + bright-cyan `reasoning:` in --chatty for local models.
- `--chatty` + long timeouts (`--game-timeout-sec`, `--llm-timeout-sec`) are the recommended way to watch Mingle hardening and decision quality in real time.

## Hosted OpenAI Reasoning Summaries

Hosted OpenAI reasoning summaries are an official Responses API summary path, not raw chain-of-thought. Influence requests them only for hosted OpenAI agent calls when a summary mode is configured:

- `INFLUENCE_OPENAI_REASONING_SUMMARY=auto|concise|detailed|off` controls API/server-created games. `INFLUENCE_LLM_REASONING_SUMMARY` is accepted as a compatibility alias.
- Hosted OpenAI defaults to `auto`. OpenAI-compatible base URLs default to off and ignore summary modes because local servers do not implement the hosted Responses summary contract.
- Simulations can override with `--reasoning-summary auto|concise|detailed|off` or disable with `--no-reasoning-summary`.
- When enabled, common agent message and structured decision prompts use Responses API JSON Schema output instead of Chat Completions tool forcing. The model-call trace stores `providerReasoningSummary: { provider: "openai_responses", mode, text, parts, outputItemIds? }`; the simulation-facing return object gets a labeled `OpenAI reasoning summary (${mode}): ...` value in the reasoning display lane.
- Private trace manifests store summary byte counts only. User-facing cognitive artifact payloads may include the summary text as owner-only `reasoning` artifacts, but they do not include provider wrappers, parts, output item IDs, manifests, or public game content.

## Testing & Mock Discipline

- `MockAgent` (and test doubles such as `GoodbyeProbeAgent`) must implement the widened return shapes (see `packages/engine/src/__tests__/mock-agent.ts`).
- Structured-output tests (`agent-structured-output.test.ts`) and phase tests (`goodbye-message.test.ts`, full-game, etc.) must assert (or tolerate via `toMatchObject` / `expect.any(String)`) the presence of `thinking` / `reasoningContext` on the relevant returns.
- When a test stub supplies tool arguments containing `thinking`, the object returned from the agent method must surface it (and the attached `reasoningContext`).

## Recommended Patterns

**Legacy/classic threading from callTool through a decision method (`getCouncilVote` example):**

```ts
const result = await this.callTool<{ thinking?: string; eliminate: string; reasoningContext?: string }>(...);
...
return { target, thinking: result.thinking, reasoningContext: result.reasoningContext };
```

**Logging a legacy/classic observable action (Power phase):**

```ts
const powerActionResult = await empoweredAgent.getPowerAction(phaseCtx, prelim);
const powerAction: PowerAction = { action: powerActionResult.action, target: powerActionResult.target };
gameState.setPowerAction(powerAction);
logger.logSystem(
  `${name} power action: ${powerAction.action} -> ${targetName}`,
  Phase.POWER,
  powerActionResult.thinking,
  powerActionResult.reasoningContext,
);
```

**Chatty formatting (already in simulate.ts):**

See `formatEntry` above. Yellow House lines + indented bright-white thinking + bright-cyan reasoning.

**Direct House-authored viewer projection (after exact-schema acceptance):**

```ts
const result = await this.houseInterviewer.generateHouseSummary(summaryContext);
if (result.status === "emitted") {
  const publicSummary = result.beat?.publicSummary;
  if (!publicSummary) return;
  this.logger.emitAgentTurn({
    action: "house-mc-summary",
    visibility: "system",
    response: { summary: publicSummary },
    text: publicSummary,
  });
  this.logger.logSystem(
    publicSummary,
    resolvedPhase,
    undefined,
    undefined,
    "house_summary",
  );
}
```

## What To Record / Usage

In simulation batches under `packages/engine/docs/simulations/`, each game writes:

- `game-N.txt`: human-readable formatted transcript; includes ANSI colors for `--chatty`.
- `game-N.json`: full transcript JSON plus result metadata (producer artifact; may include private dialogue identity and is **not** a player-safe Recall Plan evaluation input).
- `game-N-progress.jsonl`: lightweight progress events for monitoring a running game.
- `game-N-turns.jsonl`: one clean structured JSON record per agent turn, including the normalized response the game used plus `thinking` and `reasoningContext` / labeled provider summaries when available.
- `game-N-events.jsonl`: one clean canonical domain event record per accepted game-state fact. Replay this through `replayCanonicalEvents(...)` to rebuild the game projection; do not parse transcript prose as board state. API-backed games persist the same canonical envelope in Postgres for live runs, while CLI simulations remain local JSONL artifacts unless a future import path explicitly loads them.
- `game-N-prompt-reuse.json`: structural prompt-prefix reuse rollup (hashes/counts only).
- `game-N-recall-plan.json`: **safe structural Recall Plan receipt aggregate** for selective-context-recall evaluation. Prompt-class counts, budget token estimates, lane/source-class counts, and actor-authorized event boundaries only — never recalled dialogue or raw prompts. Use this (or the frozen corpus tests) for the promotion gate; do not use full private-trace JSON.

`game-N-turns.jsonl` includes one House `mingle-room-assignment` record per assigned player, all derived from one House request, followed by Mingle turns. Live standard rounds do not include `mingle-intent`; historical traces and isolated evaluator fixtures may. Each alliance-action window includes one private House `alliance-proposer-selection` record plus only the finalized proposer `alliance-action` calls and any demand-driven response/counter calls. Inspect the selection record's `budget`, `selected`, `rationale`, and `repairNotes`; it is producer evidence, not canonical alliance state. The file also includes private `alliance-huddle-schedule`, `alliance-huddle-turn`, and `alliance-huddle-outcome` records for named-alliance validation. For alliance actions, inspect `requestedAction`, `result`, and `repairNotes`; opaque proposal/version identity is engine-owned and is not a model transcription quality metric. Format-kernel runs include `format-pick` when a two-card choice occurs, `format-ballot`, `bounce-pointer`, exercised `format-tiebreak`, and one post-commit `elimination-message` record per exited player. The Short List, Highest Count, Even Votes, and Restricted History use `format-ballot` when a legal target exists, while canonical `response.formatId` and accepted-action source/trace labels preserve distinct identity; Restricted History may instead record a canonical ballot forfeiture when no legal target remains. Format decision records carry the game-used response plus `thinking`, optional `reasoningContext`, `decisionSource`, and nullable `fallbackReason`; farewell messages carry the controlled public-or-sealed disclosure used for that one call. A fallback is a deterministic continuity result and diagnostic signal, not successful proof of model-authored play. Legacy/classic candidate-selection, Power, and Council records remain readable when that lane is deliberately run. These records are producer/debug artifacts only; they are not player-visible speech or canonical facts.

Operator-only bounded invocation for Mingle + format visibility work (implementation agents document this but do not run it):

```bash
INFLUENCE_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
  bun run simulate:local -- --games 1 --players 8 --model <lm-studio-model-id> \
    --variant mingle --chatty --max-rounds 2 --llm-timeout-sec 300
```

Use `--diary` when validating survivor post-eviction replacement and optional follow-up refinement. For House carry-forward validation, use `--rich-producer`; this enables diary surfaces plus private House long-form summaries over the same single narrative notebook. There is no Strategy Bible, per-player producer brief, strategic-reflection flag, or reflection-only agent cadence.

Format-kernel API and simulator runs use bounded diary sessions after `FORMAT_RESOLVE`. Simulator `--diary` / `--rich-producer` also retains the post-Council boundary for legacy/classic lanes. Diary answers carry the strategy replacement/delta on the same paid call; closing the diary buys no summary or reflection call.

The "Progress: R1 VOTE | alive=..." lines + the following House action lines are the primary place humans see per-agent rationale in real time. After the run, use `game-N-turns.jsonl` for structured agent-decision analysis and `game-N-events.jsonl` for replay/projection queries instead of parsing colored terminal output.

For MCP-backed analysis, run `bun run mcp:game -- docs/simulations` from `packages/engine`. The MCP scans the whole local simulation corpus, including old batches and currently-writing batches, and every game query is addressed by `sessionId + gameNumber`. Tool responses include `resourceUri` values such as `influence-game://sessions/<sessionId>/games/<gameNumber>/turns`; use `resources/read` with those URIs to retrieve full event logs, turn logs, progress logs, transcripts, or full game JSON through MCP. `sourcePath` is only a local diagnostic path and may be relative to the MCP corpus process, not the repo root.

Useful validation queries:

- `search_logs` over `sources: ["turns"]` for `mingle-intent`
- `search_logs` over `sources: ["turns"]` for `repairNotes`, `seekPlayers`, `avoidPlayers`, or `provisionalTarget`
- `search_logs` over `sources: ["turns"]` for `alliance-proposer-selection`, `alliance-action`, `alliance-huddle-schedule`, `alliance-huddle-turn`, or `alliance-huddle-outcome`
- `filter_events` for `alliance.proposed`, `alliance.activated`, `alliance.closed`, `alliance.huddle_scheduled`, `alliance.huddle_completed`, or `alliance.huddle_outcome_recorded`
- `search_logs` over `sources: ["turns"]` for `strategyCandidate`, `strategyResult`, `strategyDelta`, or `strategy`
- `search_logs` over `sources: ["turns"]` for `gotoPlayerName` or `gotoStatus` (historical runs may also contain `coordinationReceipt`)
- `search_logs` over `sources: ["turns"]` for `format-pick`, `format-ballot`, `bounce-pointer`, `format-tiebreak`, `decisionSource`, or `fallbackReason`
- For a legacy/classic batch only, `search_logs` over `sources: ["turns"]` for `candidate-selection`, `power-action`, `shieldPullUp`, or `selectedCandidates`
- `search_logs` over `sources: ["turns", "transcript"]` for `house-mc-summary` or legacy `[House MC]`
- `search_logs` over `sources: ["turns"]` for `house-long-form-summary` or a House alliance name

Update simulation batch notes (the dated `.md` next to `results.json` etc.) with observations about the quality of the surfaced reasoning, not just win rates or token counts. When writing scripts, read `game-N-turns.jsonl` for per-turn decisions, `game-N-events.jsonl` for accepted domain facts, and `game-N.json` for full transcript context.

## Review Checklist

- Did we thread both thinking and reasoning evidence all the way from the LLM response through the agent method, the phase log call, TranscriptEntry, AgentTurnEvent, and formatEntry?
- Is there any `as any` left in the changed paths?
- Are House calls still direct?
- Do player prompts render the Current Board Contract before decisions, including negative facts such as no current empowerment before a normal vote and no active shields/empowerment in endgame?
- Do phase-specific rules keep format choices and legal actions separate from legacy Power/Council and Endgame choices, and do typed recent decisions show only the player's current legal path?
- Does live Format Mingle omit per-player intent calls while House receives only the living roster and locked rule sheet for its single assignment request?
- Does each alliance-action window contain exactly one private House proposer-selection record at `ceil(alive / 4)`, with underrepresentation-first repair, selected-only proposer calls, and unchanged invitee response/consent/activation behavior?
- Do named-alliance records preserve versioned consent, post-pick action-window-only mutation, universal-alliance closure, hidden huddle transcript scope, and typed member atoms as forward huddle memory rather than dialogue or House interpretation?
- Do agent prompts use Recall Plan sections (Board Contract, compact strategy, compact huddle outcomes, hot room, optional strategic history) rather than unbounded full public transcript / complete game-event record?
- Is historical Mingle eligibility fail-closed on `speakerPlayerId`/`audiencePlayerIds`, and are structural receipts free of dialogue/names/entry IDs?
- Is `game-N-recall-plan.json` treated as the safe evaluation aggregate, separate from full `game-N.json` / private traces?
- When evaluating the two Mingle-intent contexts, is `strategic-probe` treated as zero-provider selection evidence rather than proof of model use or behavior?
- When the legacy/classic lane is exercised, do Council diary prompts use the interviewee's actual role without inventing a vote?
- Do Judgment juror question prompts receive questions-only history while finalist answer, closing, and jury-vote prompts can still use full Q&A history?
- Do House MC summaries lead with consequence, leverage, debt, heat, and next tension, while canonical events alone determine the accepted game facts?
- Does the Strategic Play Menu stay hidden in system prompt context and avoid leaking into public player-visible messages?
- Do ordinary schemas and prompts make null/omitted `strategyDelta` the expected result for an unchanged plan, and reserve non-null deltas for actionable changes rather than action summaries or baseline restatements?
- If compact strategy changed, can the private turn/trace show the submitted operation, accepted/rejected/no-change result, and resulting revision without a separate model call?
- If House producer carry-forward changed, can MCP `search_logs` find `house-mc-summary` and `house-long-form-summary`, while notebook canaries remain absent from contestant prompts and viewer payload fields?
- Are compact strategy prose and diagnostics absent from websocket-visible events and canonical board state?
- Do API durable events, simulator JSONL records, and replay/projection tests still use the same `CanonicalGameEvent` envelope?
- Do mocks and tests compile and pass with the new shapes?
- If checkpoint continuity or hydration-passport fields changed, does an admin durable-run route or service test prove the response exposes stamp/status facts without raw private continuity, and does at least one real `GameRunner` checkpoint prove drained transcript-buffer and sealed token-boundary evidence?
- Are the ANSI color rules, terminal output expectations, clean `game-*-turns.jsonl`, and clean `game-*-events.jsonl` artifacts documented?
- Did we update the cross-referenced usage docs and AGENTS.md where the contract changed?
- Can a future reader understand why this observability layer exists (Mingle debugging + "master wants to see reasoning for voting as well")?

## Related

- `docs/local-model-evaluation.md` — primary reference for local provider setup and what makes a useful `--chatty` run.
- `packages/engine/src/simulate.ts` — chatty entry point, `formatEntry`, and JSONL artifact writers.
- `packages/engine/src/canonical-events.ts`, `canonical-event-log.ts`, `game-projection.ts` — accepted-domain-event envelope, append log, and replay reducer.
- `packages/engine/src/game-mcp/` — local read-only MCP/query server over simulation event logs.
- `packages/engine/src/agent.ts` — `callTool` and the decision methods.
- `packages/engine/src/transcript-logger.ts` and `game-runner.types.ts` — the transcript and agent-turn data models.
- `CONCEPTS.md` — project vocabulary for `TranscriptEntry`, `Recall Plan`, `reasoningContext`, `chatty` mode, House-authored narrative beats, the private narrative notebook, long-form summaries, and the `callTool` reasoning augmentation.
- `packages/engine/src/context-recall-plan.ts`, `prompt-reuse.ts` (`RecallPlanReceiptAggregate`) — pure compiler, structural receipts, and safe simulation aggregate.
- `feat/inf-228-mingle-hardening` branch context: this observability work was driven by the need to debug and enjoy the new Mingle room system + the full decision loop down to 4 players.

### Shared diary format rules

All seven formats expose their existing rule sheet, public name, and active-or-resolved status through `buildDiaryFormatContext`. Contestant answers and House questions/follow-ups use the same block. An active locked format supplies live rules; the current round's canonical resolution supplies completed-round rules after active pressure is cleared. Completed rounds are explicitly retrospective. No block is emitted before selection or in endgame, and canonical resolved context does not carry into a new round. Actor-scoped knowledge boundaries are unchanged; no transcript prose supplies format identity. Outgoing-prompt tests cover every format in both states and preserve The Short List's separate strategic guidance. Continue using direct House calls and typed contracts, with no `as any`.

### The Short List coordination guidance

The catalog owns one shared guidance text about decisive ballots, negotiated voter-to-target placements, intended totals, and broken commitments. All players receive both parts in active-format social prompts (Mingle, alliance discussions, huddles, and diaries) and in the sealed ballot prompt. No transcript parsing or spoken-target classification selects the advice. After resolution clears active format pressure, diary context uses only the current round's canonical `format.resolved` event to identify The Short List and labels the guidance as reflection on a completed vote. This diary context ends at the next round or endgame. Provider-free outgoing-prompt tests prove delivery, equal wording, and timing; they do not prove wider vote distributions. Keep direct House calls and typed contracts, with no `as any`.

### Two Names board context

New Override draws exclude Empowered and include every other living contestant, including both nominees. Inspect the canonical setup event to verify the accepted holder; previously recorded games retain their original holder and are never re-drawn during replay or recovery.

While Override is pending and its holder is nominated, shared prompts add separate strategic context: other players are told the holder will most likely save themselves; the holder gets neutral self-removal and replacement-nominee guidance. This is advice, not an accepted decision. It disappears during a pending replacement and after either use or decline.

Every agent call after initial nominations and before resolution receives the current round's canonical Two Names board: initial and current nominees, Empowered, Override holder and decision, pair finality, and ordinary-voter eligibility. The active board is removed after resolution and in endgame. Mingle and alliance prompts share this board; transcript prose does not establish nominations. Only the Empowered initial nomination request may say no pair is selected. The replacement request labels the pending removal explicitly until Override and replacement commit together. Provider-free outgoing-prompt regressions exercise this contract; old game dialogue cannot prove updated prompt behavior. Continue using direct House calls and no `as any` in simulation integrations.

Visual context is prepared through the optional `GameRunnerOptions.prepareVisualTurn` hook before a staged agent call. It requires durable turn authority and receives the committed heads and cursor separately from the scratch phase context. Under Best effort, image failures use supported text-only context and do not prevent gameplay dispatch. Require visuals pauses for admin repair when verified agent imagery is unavailable. The API reader verifies the active owner, exact committed boundary, frozen character references and scene occupants. It never generates images, and portrait/ballot methods do not fetch room artifacts. Producer visual exports include cues, frozen performance profiles, scenes, anchors and costs.

### Visual operational evidence

`visual_operation_events` retains attempt dispatch/completion, typed failure evidence, retries, presentation decisions, policy changes, pauses, resumes and accounting reconciliation. Attempt events join the reservation/receipt transaction. This journal remains readable when gameplay is paused. The next committed turn promotes unrecorded entries as producer-only `visual.operation_recorded` events; stable diagnostic IDs prevent duplicate canonical promotion. Operational records never become agent strategy/context or public dialogue.

The admin visual-production page groups scenes, receipts and evidence, exposes private rejected images, shows request latency percentiles and costs, and provides explicit repair/resume controls. The `read_producer_visual_production` tool exports the same evidence. Cues remain free-form `string | null`; only surrounding whitespace is trimmed.

### Character preparation evidence

Character authoring uses `full-body:<requestId>` and `portrait-head:<localizationVersion>:<requestId>` operations owned by the authenticated user. Provider attempts preserve request hashes, response receipts, uncertainty and cost in the existing visual journal. A missing or uncertain head observation returns a manual-crop status; it never turns into an accepted guessed portrait. These are draft-authoring artifacts, not game decisions or transcript events. Final submission still records the selected text, image hashes and crop metadata atomically for future moderation.

### Shared player thinking and entry modes

Influence Production Studio anchors captured empowered tie-break thinking to the canonical `format.resolved` decision’s `format_tiebreak` presentation. When selected, it plays immediately before that scene, after the regular ballots and aggregate. A regular ballot by the same empowered player cannot move this later thinking into voting. Preview and export use the shared production source catalog.

The live/replay player uses the tie-break cue’s empowered actor and exact `format-tiebreak` or `format-two-names-tiebreak` action. Other voting cues exclude those actions, and the deciding-vote cue does not repeat the thought. The shared director holds the unselected nominee scene while the captured thought plays, then continues to the choice without a model call.

Werewolf viewing mode is selected before playback (`?audience=mystery` or `?audience=omniscient`); it stays fixed for the session. Omniscient can toggle captured thinking without navigation. The House player settings beside fullscreen provide readable shortcuts and **Thinking first / Speech first** timing for both Influence and Werewolf. The overlay uses the shared director clock, exact speaker/contribution evidence, and no model calls. Uncaptured turns stay without a thought bubble; Mystery cannot load thinking. Influence retains its Strategy Lens. Werewolf uses a Decisions inspector: resolved public ballots for Mystery; resolved ballots, night choices and expandable captured decision thinking for Omniscient. The inspector does not depend on the stage thinking toggle. Reads are bounded to the selected player and current audience-local cursor; Mystery never receives thinking or night decisions, including at completion. It reads existing accepted evidence without generating analysis or exposing provider-native reasoning.

The shared watch thought bubble is rendered within the scene canvas, above speech, with secondary text and a circle tail toward the actor. In Thinking first mode, it stays anchored when speech is measured and remains visible until both bubbles share the speech exit, including manual dismissal. It does not change raw transcripts or generate new words. Werewolf day-vote abstentions animate silently into the Hear more ledger bucket; unavailable ballots remain distinct.

Shared watch bubbles measure the entire message independently of playback time. Font size and the tallest page establish one stable frame; short contributions use larger type and shorter bubbles, and very short replies can narrow. The text is preserved verbatim, including across pages. Padding is a layout constraint rather than a per-page adjustment.

House replay links from the Werewolf API simulator now use `/games/:slug/replay?audience=mystery|omniscient`. Player settings offer **Share this moment**, binding the audience and canonical visible-entry cursor. Sharing/presentation makes no model call and does not alter accepted dialogue, captured thinking or game state. See [House entry integration](solutions/architecture-patterns/house-game-entry-and-replay-moments.md).

### Game creation and playback pacing

Creation-time Speed-run/Live and phase timing presets have been removed. API simulations no longer accept `--viewer-mode` or `--timing-preset`; use `--max-rounds` for the Influence game-length limit. Werewolf retains its maximum-day limit. Playback speed, thinking visibility and thinking order belong to the existing House player settings. These preferences do not change model reasoning or execution speed.


House game discovery uses Public/Unlisted for both games. The API launchers expose `--visibility public|unlisted`; this never changes transcript scope, Mystery/Omniscient, captured thinking, or producer-only raw reasoning access. Private decision traces remain private evidence even though Private game visibility has been removed. No model-output or canonical event contract changed.


RT-02 adds provider-free frozen retrospective context compilers (see [context and order](game-retrospective-context.md)). Canonical facts and untrusted dialogue keep distinct source references; all earlier accepted speeches remain verbatim. Model context contains only the next speaker’s original character/strategy and excludes opponents’ thinking, native reasoning, diary entries, authorization snapshots and provider internals. Capacity receipts identify model/actor and byte bounds without publishing private inputs. At RT-02 completion, simulators still ended at the result; RT-04 now extends Influence runner execution, with artifact/report integration still pending. Future invocations retain direct House calls and exact types without `as any`.

## Retrospective artifacts and final statements

The accepted competitive outcome precedes the epilogue; execution completes only after every original contestant has one accepted final speech. Each request contains the whole canonical game account, the original contestant's own frozen character/strategy and exact earlier statements. Opponents' private cognition and strategy are excluded. Public speech remains presentation; its claims cannot alter facts, scheduling or outcomes.

Current prompt guidance asks for candid 40–75 word statements addressing the other contestants and the speaker's own performance, including open discussion of mechanics. Its requested 1,000-code-point maximum is distinct from the exact artifact's 2,000-code-point ceiling. The earlier paid quality report used the previous prompt; this revision has no new paid qualification. Native reasoning remains usage evidence, never a requested speech field.

Influence `--chatty` prints the retrospective source/input hash, actor/ordinal, exact speech and completion count. Werewolf prints coverage counts and prior count beside the accepted original speech; both local and API reports mark `[Retrospective N]`. Provider-attempt artifacts include compact action/attempt/usage/cost receipts separately from sanitized failure evidence. These are private local producer artifacts. The public bounded retrospective reader returns accepted text and canonical references, never the dossier or raw provider evidence.

Fresh local sessions have a closed `session.json` identity (`house.simulation-session`, version 1, explicit `gameKind`). Werewolf `--out` is a dedicated directory holding `game-1.json`, `game-1-events.jsonl`, provider receipts and stats. Its event envelopes use `werewolfEvent`; Influence uses `canonicalEvent`. Local MCP dispatches by that identity and each owning reducer. `read_game_retrospective` supports both games; `read_werewolf_history` requires an explicit Mystery/Omniscient audience. A missing or invalid identity cannot enter a canonical adapter. Existing artifacts are not rewritten. Local raw resources remain trusted producer inspection.

The API reporter continues polling through result-to-epilogue growth and stops at operational completion, not the first outcome. Readback generates nothing. Keep exact types without `as any` and direct House calls. See [runtime/recovery](game-retrospective-runtime.md) for operator suspension and journal retry rules.

Ordinary Mingle turns contain conversation, optional movement, and private reasoning/strategy updates; agents no longer author `coordinationFact` or `noProposal`. Evaluate their negotiation from dialogue and subsequent canonical decisions. Formal alliance huddles retain structured facts and participant memory. Historical Mingle receipts remain readable in stored events, turn exports, producer reviews, and MCP artifacts; they are not deleted or reinterpreted.


## Context-overflow adaptation

Recognized provider context overflow now triggers bounded, strict structured context summaries before retrying the same decision. API summaries are separately journaled private child calls; they never become agent speech, thinking or canonical facts. Influence/House traces show the adapted request, and local token reports include newly generated `context-summary` calls. See [policy, caller inventory and recovery](context-adaptation.md). `--chatty` remains a way to inspect accepted decisions, not proof of summary fidelity; compare original and adapted private evidence in an opt-in evaluation. Keep exact types without `as any` and call House methods directly.

Compaction request evidence includes actor/task orientation and the acting character context. It is private: Werewolf knowledge stays actor-scoped, retrospective character data comes from the frozen self, and House receives only the subject/audience context already present in its invocation. Historical spans are marked rather than repeated in every chunk request.

The opt-in `evaluate:context-compaction` harness saves actual summary/action messages, outputs, latency and accounting in private run evidence, with a synthetic-only review export. Explicit probe scores are fixture checks, not factual grades for arbitrary games. The [first report](evaluations/2026-10-18-context-compaction.md) records task leakage into otherwise successful summaries.


### Open conversation evidence

New Lobby, Mingle and huddle turns return the strict `conversation_turn` contract: speech/pass, optional addressee and actor-local reply reference, private thinking and strategy, plus movement fields only when a checkpoint follows. Defaults allow 320 UTF-8 speech bytes and 400 bytes per participant. Rejected oversized speech receives its exact text, measured size and allowed size for a bounded shortening retry; every attempt remains saved. New facts are not required: clarification, humor, negotiation and useful restatement can be contributions.

Passes are private and always skipped by playback even with Show thinking. They remain in accepted decision/provider evidence. Spoken huddles include saved structured thinking under the normal Show thinking toggle. Recent attended huddle dialogue is included before the next decision; older attended speech can enter relevant recall. Authorization precedes selection, counts and caching. Recall references use actor-local spoken indices; canonical coordinates remain in the immutable source journal. Foreign sessions must not alter the contestant's prompt or recall receipt.

The shared local evaluation guard accepts `INFLUENCE_EVALUATION_BUDGET_USD` and `INFLUENCE_EVALUATION_BUDGET_LEDGER` for API games. It reserves conservatively before every player/House provider dispatch; thinking, native reasoning and retries remain separate from the spoken-output allowance. Do not enable paid providers in required CI. Keep direct House calls and exact types; no `as any`.

### Agent shadow-screening evidence

OpenAI moderation and Luna assess immutable profile revisions outside game execution. `agent_screening_attempts` stores private bucket references for each sanitized request and raw response, including available native reasoning, usage and failed attempts. Validated recommendations remain separate from human decisions and never enter contestant prompts, gameplay transcripts or public exports. Evidence persistence failure stops screening; it does not block a save or become clearance. The existing moderator panel and read MCP show findings, category scores/flags, operation tags, attempt numbers, HTTP statuses and structured refusal codes under current reviewer authority. A refused safety operation is retained separately from the text-only `luna_collusion` fallback; its partial result never clears the original refusal or changes publication. See [shadow screening and backfill](agent-shadow-screening.md).

## Per-character model routing

A character preference is snapshotted on enrollment and resolved at atomic start. Private execution records distinguish the requested/frozen route from each attempt's actual provider/model. Accepted replay does not count as another decision or dispatch. Shared contestant fallback reservations and independent House reservations live in the existing provider journal; uncertain dispatches retain their allowance. Each attempt snapshots its provider-qualified rate card; unknown rates remain unknown, while usage and failed attempts remain visible.

`GET /api/model-routing/games/:id` (admin/sysop) and `read_game_model_routing` expose routing diagnostics. `simulate:models --report GAME_ID` saves these locally. Preferred-route share is accepted non-compaction decisions on the primary divided by accepted non-compaction decisions; a zero denominator says **No accepted model decisions**. Failed attempts and their spend are separate. Do not infer an unavailable canonical decision from a missing provider result; inspect owning-phase canonical outcomes.

Failure summaries include captured HTTP status, sanitized structured error code, retry delay and Cloudflare ray ID when present, alongside existing request correlation and private evidence. A provider's `(no body)` SDK summary is replaced when captured evidence supplies a structured error code. Retry-After cooldowns apply to the affected model across actors/restarts; skipped routes are not accepted model decisions. Explicit preferences recover through the game default before later fallbacks, using its shared configured allowance.

Compact strategy uses deterministic field order before becoming context text, including prior-epoch state. JSONB key reordering must not change a logical call's source hash. A genuine source conflict logs expected/actual hashes and component hashes, preserves committed play and marks Influence execution `repair_required` so automatic reacquisition cannot loop. This is an integrity guard, never a context-size limit; it does not publish private prompts.

House title/description generation now uses its own revision/lease-fenced journal call; summaries, room/huddle assignment and interviews use the injected House runtime. Contestant retrospectives remain contestant work. Native reasoning, strict structured thinking, sanitized successful and failed requests/responses, privacy boundaries and object-storage evidence remain unchanged. Never route a House call directly to a provider or use `as any` to bypass structured contracts.
