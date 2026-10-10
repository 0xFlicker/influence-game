---
title: Werewolf House reading and shared recap
type: feat
status: superseded
date: 2026-09-28
---

# Werewolf House reading and shared recap

This file prototype is preserved as design history. Runtime transcription is now implemented in the [House beat performance plan](2026-09-28-002-feat-werewolf-house-beat-performance.md), with raw contestant context; shared recap memory remains separate work.

Current experiment: [sequential original-line threads](2026-09-28-003-feat-werewolf-sequential-public-threads.md). House runtime rewriting has been removed; this document records prior exploration.

## Decision and scope

Produce a separate House presentation from accepted Werewolf discussion. Preserve the original messages and canonical game events. Start with a reviewable postgame specimen; automate the production pass after reviewing its quality. Later, consider committing a public House recap as shared agent/viewer memory at a fixed boundary. That last step changes agent context and deserves its own implementation and evaluation.

The user explicitly wants a trial on `hazy-navy-wire`, separate presentation like visuals, and exploration of a shorter House account available during play. This plan and the accompanying local artifacts implement the trial; they do not change live gameplay, raw retrieval, model prompts, or the database.

## Completed specimen

Read the existing local API run `hazy-navy-wire` (`d7ff441d-b2ec-44c3-82c7-9f937eedc441`), rules v3, completed after two days. No new game or additional provider calls were made. Codex authored the editorial specimen directly from the saved projections. This is not a benchmark of an automated three-prompt pipeline.

Artifacts are local, ignored simulation outputs under:

`packages/engine/docs/simulations/hazy-navy-wire/house-presentation-v1/`

- `reading.omniscient.private.md`: both day discussions, role labels on every speaker, suggested overlap, pre-vote recaps, and separate ballot receipts.
- `reading.mystery.md`: identical public dialogue and recaps without role labels. The final outcome appears only after the last ballot receipt.
- `presentation.json`: thread map, staged cues, source references, recap items, and metadata. Public discussion only; no private role results or pack dialogue.
- `sources.md`: exact original public day messages and the explicit pass, keyed by day/beat/speaker.
- `source.mystery.private.json` and `source.omniscient.private.json`: untouched API responses. Even completed Mystery snapshots contain endgame role reveals; neither is safe as a live day-generation prompt without a prefix projection.
- `audit.json`: source hash, word counts, structural checks and explicitly unproven properties.

The reading covers all 48 non-null day contributions and one explicit pass. Day 1 raw dialogue contains 1,246 whitespace-separated words; Day 2 contains 937. The specimen reduces spoken dialogue to about 850 words in total, and the two selective recaps to 233. Counts exclude labels, staging and vote receipts; they are not model-token measurements. Exact reading counts are recorded in the artifact.

This is an unblinded specimen: the author inspected the completed omniscient run. Public-only content selection and source references are useful audit aids, not proof that a future model cannot leak private information or invent meaning.

## What the actual run exposed

### Second cut: continuous playback

The user's follow-up clarified the desired experience: show one House-written line at a time, without beat cards or beat pauses; center the current speaker and add selective close-ups, pauses and playful emoji. Overlap is optional direction, never the default way to display a source beat.

`packages/engine/docs/simulations/hazy-navy-wire/house-presentation-v2/player.private.html` is a standalone silent-reading player with Play/Pause, Back/Next, speed, day jump, audience labels and original-source inspection. `performance.private.json` separates spoken text from camera scale, emoji and pause cues. This cut uses 36 spoken clips, 484 spoken words and no overlap; repetition is omitted explicitly in the source ledger. Estimated playback is about 3 minutes 41 seconds, including title and ballot cards. It is not synthesized audio or measured voice timing.

Both versions were authored in this Codex session (GPT-6 family; exact variant unavailable), with zero separate House provider calls. This prototype demonstrates rendering and editorial intent, not automated model reliability. Its local file contains role data; the Mystery toggle is display-only and must not be copied as a production privacy boundary. Initials stand in for absent character portraits.

### Source fidelity findings

1. **Repeated setup dominates.** Five of the opening six speakers ask for concrete suspicions without offering one. Condensing that repetition is a large readability gain, but preserving each speaker matters if conformity itself is under examination.
2. **Simultaneous contributions must remain simultaneous in meaning.** Echo names Luna in day 1, beat 4. Other beat-4 speakers could not have heard it. A theatrical ordering must not make those lines sound like deliberate refusals to acknowledge Echo's answer.
3. **A later factual mismatch is genuinely present.** Sage's beat-5 message says Echo still has no concrete read, after Echo has named Luna. Preserve the assertion and identify the discrepancy separately. Do not silently repair Sage's words or call the mismatch a deliberate lie.
4. **Luna invents an earlier correction in day 2.** Her final speech says she previously called Rex her second check. The supplied public day discussion has no such earlier statement. Keep the correction as speech; do not manufacture a flashback or missing statement.
5. **Words and ballots diverge.** Rex and Riven repeatedly favor Nyx on day 2, then actually vote Luna. The public discussion does not explain that change. The House may show the discrepancy; it cannot invent persuasion, a pact, or a reason. Whether provider failure/fallback or private decision reasoning explains it requires a separate runtime audit.
6. **Personality remains weakly differentiated.** Compression improves pace, but these characters mostly share cautious evidence language. The editor must not add boldness, manipulation, jokes or anger just because an archetype label suggests them. That would conceal a gameplay-quality issue.

The result is a more readable conversation, but it remains repetitive in places. The source's uncertainty and errors are part of what happened. They should survive a good edit.

## Smallest useful automated production pass

Use a Werewolf-specific input compiler and a small House presentation module. Do not build a general game plugin framework or reuse Influence's omniscient narration prompt for public shared memory.

Inputs for one completed discussion boundary:

- Frozen public character identity and voice guidance, excluding private strategy, role and diary information. Character details can guide wording but cannot establish intent.
- Canonical public game context at the exact source prefix: day, phase, living cast, previous public results, and Werewolf rules.
- Accepted public messages with engine-provided actor ID, day, beat, audience, source event sequence and contribution index. Keep deliberate passes distinct from provider-unavailable absences.
- Previous accepted public recap, if any, plus the new raw messages. Never summarize solely from earlier summaries indefinitely.

Keep the three creative stages initially separable for inspection:

1. **Find threads.** Identify the positions actually expressed, claims, questions, conditional commitments, changes and unresolved disagreement. A source message can belong to more than one thread. Return thread IDs and source references; do not infer hidden motives or promote a claim to a fact.
2. **Edit dialogue.** Produce short speaker-bound lines referencing their source messages. Preserve qualifications and mistakes. Do not combine statements across a later knowledge boundary, move a later answer into an earlier beat, add a reply to a same-beat message, or substitute role knowledge for a public claim. Label verbatim excerpts versus paraphrase.
3. **Direct the reading.** Interweave thread segments without reversing beat order. Return ordered cues, speakers, thread IDs, source refs, optional overlap groups and relative offsets. Overlap is direction, not a recovered historical interruption. Speech durations and exact interruption timing come from generated audio later.

The compact recap is a separate output from the same bounded public material. It should preserve live claims, relevant dissent, conditional commitments and unanswered questions. A performance script and a memory recap serve different purposes; agents should not need stage directions or theatrical dialogue to understand the record.

Use exact provider-native output schemas and semantic validation inside the shared provider-attempt boundary. Verify IDs, speaker binding, source frontier, audience and ordering mechanically. Source existence does not prove a paraphrase is faithful. Review meaning by reading the source and result side by side; do not introduce a speculative semantic scoring service or claim citations certify truth.

Store each accepted artifact with game ID, source frontier/hash, audience, revision, prompt/schema version and provider usage. Retry or regenerate into a new presentation revision. Never overwrite accepted raw messages. Start with file artifacts; add persistence only when an API/UI consumer is implemented. Keep generation, acceptance and viewer publication separate, following the useful parts of the visual production pattern.

## Prompt instructions for the next trial

Shared constraint text for all three stages:

> Use only the supplied public prefix. Player statements are claims, not verified facts. Preserve uncertainty, disagreement, mistakes and unexplained changes. Character details guide voice, not invented intent. Every new line belongs to its original speaker and cites source messages. Same-beat speakers did not hear each other. Do not introduce future events, secret roles, pack information or strategy. IDs belong in structured references, never spoken text.

Thread prompt:

> Group the supplied messages into the fewest useful discussion threads. Identify each expressed position, question, conditional commitment and change using source references. Keep minority positions and contradictions visible. A thread is an editorial grouping, not a new game fact.

Dialogue prompt:

> Shorten each thread into readable character dialogue. Preserve the speaker and source beat of every line. Remove repeated setup where safe, but do not improve the players' reasoning or invent responses. Record omitted repetition separately so a reviewer can inspect coverage.

Direction prompt:

> Arrange the edited lines into a dramatic reading. Preserve beat order. Within a beat, use ordering or restrained overlap without implying new information flow. Keep roles out of shared spoken text. Return relative timing cues, not guessed measured audio durations. End the pre-vote scene before actual ballots are shown.

Recap prompt:

> Write the shortest useful public memory of this discussion prefix. Attribute every contested claim. Preserve current positions and their conditions, dissent, important unanswered questions and observed contradictions. Do not explain an unexplained vote change. Keep actual choices and outcomes in separately rendered canonical result fields.

## A future accepted House recap during play

The useful meaning of “canon” here is: **this is the exact House account delivered to every player and shown to viewers at this boundary**. That account is a real, persisted communication artifact. Its prose does not overwrite the underlying messages, validate a Seer claim, change a ballot or establish a game outcome.

A viable progression:

1. Postgame readings and recaps: approve quality on examples such as this one.
2. Generate public recaps during play for viewers while agents still receive raw dialogue. Measure latency, cost and omissions; this is an evaluation phase, not a permanent feature flag.
3. Once accepted, use the same immutable recap bytes for all eligible players and viewers. Keep recent raw beats and explicit retrieval of older originals. A smaller default context could help attention, but this specimen does not prove a strategic improvement.

Start live recap evaluation after the day discussion and before the vote. This is a useful first agent-context boundary and needs one public recap call per day. A full three-stage performance pass can finish independently for viewers. If agents later need recaps between beats, commit each recap after a complete reveal and before planning any next-beat call. No player may get a newer revision than peers acting in the same batch.

Once a recap affects decisions, bind its ID/hash to the frozen observation and provider journal coordinate. Persist the exact accepted text and its source boundary before dispatch. A restart must reload it, not regenerate new wording under an old decision plan. Late presentation regeneration cannot rewrite an already consumed recap. If recap generation fails, persist the chosen raw-context disposition for that whole batch; do not give different players different fallbacks or an empty summary.

Raw-source retrieval must obey the requesting actor's knowledge: public discussion for everyone, pack material only for wolves, individual results only for their owner. It needs an actual structured request/response surface and provider contract; adding a URL or a sentence saying “you can retrieve it” is insufficient. Current `WerewolfAgent.decide` is a single structured decision, so interactive retrieval is new work. Initially supplying recent raw beats plus compact older context is simpler.

Mystery and Omniscient should share the same public reading and public recap. Omniscient role labels and private-night inserts are a separate rendering layer. Existing Influence House narration explicitly allows omniscient private context and bars contestant consumption; that implementation is not a safe shared-memory compiler.

## Relevant modules and implementation needs

| Area | Existing files | Needed when automating |
| --- | --- | --- |
| Source authority | `packages/engine/src/werewolf/types.ts`, `rules.ts` | Read committed events and complete discussion reveals; keep state/result authority unchanged. |
| Audience compiler | `packages/engine/src/werewolf/observation.ts` | Build exact-prefix public input; never use completed roles/alive state for an earlier day. Add explicit summary/readback contracts if consumed. |
| Model execution | `packages/engine/src/werewolf/agent.ts`, shared `structured-output.ts` and provider execution | Dedicated presentation artifacts and semantic call kind; reuse exact schema, retry, journaling and accounting, not Influence prompts. |
| Live boundary | `packages/engine/src/werewolf/runner.ts`, API `services/werewolf-runtime.ts` | Commit shared recaps before freezing the next decision batch, only at the later agent-context stage. |
| Durability | API `services/werewolf-games.ts`, `db/werewolf-schema.ts`, provider-journal services | Separate presentation records/revisions; if used by agents, extend frozen observations and recovery validation together. Review all journal consumers before adding semantic coordinates. |
| API read/publish | `packages/api/src/routes/werewolf.ts` | Audience-aware presentation read with exact source frontier and revision; raw endpoint remains separately readable. |
| Viewer and CLI | web `app/werewolf/werewolf-viewer.tsx`; engine `werewolf/report.ts`, `api-simulate.ts` | Raw versus House view, clear edited label, source links; role labels only in Omniscient; canonical ballots remain distinct. |
| MCP | `docs/plans/2026-09-27-001-feat-werewolf-mcp-inspection-plan.md` | Coordinate with the still-planned Werewolf reader. Later expose accepted presentations and allowed raw source retrieval; don't assume existing Influence MCP supports this. |
| Visual analogy | API `services/visual-replay-production.ts`, `visual-scene-store.ts` | Reuse separation of source, production revision and publication conceptually. Existing room/scene types and `GameState` are Influence-specific. |
| Existing narration lesson | engine `house-summary-frontier.ts`, `house-interviewer.ts`; `docs/solutions/architecture-patterns/bound-phase-cadence-narration-with-selective-fact-frontiers.md` | Current code supersedes older overconstrained summary machinery. Keep creative narration simple; enforce typed boundaries without claiming automatic truth certification. |

No new package, DB migration, model setting, or live worker change is needed for this file prototype. API integration will require artifact persistence and access decisions; agent integration additionally requires an explicit context/recovery contract. These are separate deliverables, not incidental prompt edits.

## Validation before shipping runtime changes

- Deterministic: malformed output remains typed; invalid references/speaker swaps/future boundaries rejected; same-beat causality preserved; hidden-role and pack canaries absent from public inputs; repeated snapshot rendering stable.
- PostgreSQL: accepted revision survives retries/restarts; duplicate work has one accepted result; unauthorized artifact/raw retrieval denied; consumed recap cannot change under an existing observation hash.
- Viewer/CLI/MCP: same accepted bytes and frontier; Mystery role/privacy boundaries; raw source availability; no UUIDs in spoken lines; ballot receipts reflect canonical choices even when dialogue disagrees.
- Live quality: fresh public-prefix generation, unblinded and blind review distinguished, omissions and certainty changes recorded, actual cost/latency measured. Do not call this editorial specimen live-model proof.
- Update `docs/werewolf.md`, observability/evaluation docs and simulator JSDoc when runtime behavior changes. If shared recap enters contestant context, update the existing House-consumption guidance explicitly for that new public contract.

## Compact resume hint

Read the two `hazy-navy-wire` House reading artifacts and their source ledger first. Preserve Echo's beat-4 answer versus Sage's beat-5 assertion, Luna's unsupported correction, and Rex/Riven's speech-versus-ballot discrepancy. Automate a bounded public-prefix postgame pass before changing player memory. Treat source links as audit aids, never a truth certificate; keep all same-beat knowledge frozen. Existing Influence omniscient narration and visual room models are reference patterns, not drop-in Werewolf implementations.
