# Influence Refactor Queue

Generated: 2026-06-21

Last audited against `main`: 2026-07-24

Last format-kernel review follow-ups added: 2026-07-25

Last continuity audit added: 2026-07-26

Last watch-shell accessibility audit added: 2026-07-26

Last live recovery regression added: 2026-08-04

Last startup-listener recovery hardening added: 2026-08-19

Last simulator variant cleanup added: 2026-08-14

Last House summary cost architecture added: 2026-08-15

Last CI test-discovery gap added: 2026-08-14

Last production compact-strategy and producer-tooling audit added: 2026-08-19

Last failed-provider evidence storage gap added: 2026-08-21

Last synthetic no-response output gap added: 2026-08-21

Last game provider-waterfall gap added: 2026-08-22

Last producer narrative response-contract gap added: 2026-08-25

Last model-output structure audit added: 2026-08-26

Last Agent editor recovery and status work completed: 2026-08-28

Inputs:

- `docs/plans/**/*.md`
- `docs/brainstorms/**/*.md`
- `docs/ideation/**/*.html`
- `docs/statefulness-plan.md`
- `docs/solutions/**/*.md`

Method: merge duplicate candidates across plans, brainstorms, ideation, statefulness notes, and solution docs; preserve concrete source evidence; remove already-landed/product-feature/process-only items; rank the remaining work by current product value.

Five-question gate:

1. Is this still true?
2. Is there a concrete code seam?
3. Is there a validation path?
4. Is it product-relevant now?
5. Is it smaller than "rewrite the system"?

Status legend:

- `ready`: good candidate for near-term planning.
- `implementation_complete/runtime_proof_pending`: implementation and automated proof landed; one explicit live validation gate remains before `closed`.
- `implementation_complete/operator_rollout_pending`: implementation and automated proof landed; one explicit repository or operational configuration step remains before `closed`.
- `future`: coherent, but should not be in the active queue unless the pain becomes visible.
- `closed`: already implemented, superseded, or not a coherent current ask.

## Ready Backlog

Items are ordered by current priority.

### R33. Replace packed provider-call ordinals with structured coordinates

- Status: `ready`
- Priority: **high**
- Sources: staging game `punk-blue-silver`; `packages/engine/src/provider-execution.ts`, `packages/engine/src/diary-room.ts`, `packages/engine/src/house-interviewer.ts`, `packages/api/src/services/provider-call-journal.ts`, and `packages/api/src/db/schema.ts`.
- Signal: diary-room House calls currently encode `(canonical event boundary, player ordinal, exchange ordinal)` by applying Cantor pairing twice. That deterministic packing preserves replay identity, but it grows roughly with the fourth power of the event sequence: staging game `punk-blue-silver` produced logical-call ordinal `3619941329` during Round 5 and exceeded the journal's original PostgreSQL `integer` column. Widening the column to `bigint` repairs that immediate storage failure, but numeric magnitude remains an accidental property of coordinate encoding rather than a domain requirement.
- Required direction: make the logical call's typed, structured coordinate authoritative. Give each call site a stable discriminant and explicit bounded components, serialize the coordinate canonically, and derive the existing deterministic logical-call ID from that serialized value. Persist enough structured identity to verify hash matches and diagnose replay conflicts. Do not combine coordinate dimensions into one numeric ordinal, allocate identity from process-local call order, parse an ID back into gameplay facts, or maintain parallel numeric and structured authorities.
- Durability boundary: the same semantic coordinate must derive the same logical-call ID before and after restart, while different players, exchanges, phases, rounds, and durable-turn subcall slots remain distinct. Accepted-result replay, immutable reservation identity, provider attempt ordering, game-turn bindings, producer evidence, and canonical commit behavior must remain unchanged.
- Validation path: deterministic unit cases prove canonical serialization and ID stability across key order and restart; adjacent coordinate components never collide; large event sequences do not create packed-number growth or lose identity; and malformed, unknown-version, or hash-mismatched coordinates fail clearly. DB-backed recovery tests interrupt before reservation, after reservation, after accepted provider output, and after canonical commit, then prove exactly one semantic call and one accepted result survive adoption without redispatch.
- Suggested slice: replace the nested diary-room pairing path first with a versioned structured coordinate carried through the provider execution boundary and journal, then remove `pairProviderLogicalCallOrdinals` after its remaining callers use explicit coordinates. Keep the existing deterministic stable-JSON hashing seam; change the identity payload, not the provider retry or game-turn protocols.

### R32. Remove prose-parsing escape hatches from structured model turns

- Status: `closed`
- Priority: **high**
- Sources: production `malformed_output: malformed_house_followup` investigation and the 2026-08-26 audit of `packages/engine/src/agent.ts`, `packages/engine/src/house-interviewer.ts`, `packages/engine/src/context-builder.ts`, `packages/engine/src/accepted-formal-speech.ts`, and `packages/engine/src/simulate.ts`.
- Signal: the House follow-up fix exposed the same architectural leak in several nearby paths: provider-native structure is requested at the turn boundary, but permissive validation or downstream prose parsing can still accept malformed content, manufacture default-filled success, or reconstruct typed facts from display strings. This makes provider failures look like valid agent output and lets presentation conventions quietly become data contracts.
- Implemented direction: player and House control-flow turns use exact provider-native tools or strict JSON schemas with semantic decoding inside the provider-attempt boundary. Malformed structured output cannot downgrade into accepted dialogue, update continuity, or mutate strategy. Judgment history and simulation result classification derive from canonical events rather than display wrappers or House text.
- House narrative decision: House creative prose is allowed to describe, interpret, and connect game facts. One material cadence call returns nullable `publicSummary` and `privateNarrativeNotebook`; accepted public bytes are displayed unchanged, and a non-null notebook atomically replaces one bounded private showrunner snapshot. The creative lane contains no model-authored claims, aliases, receipts, fact-read action, semantic grading, or deterministic renderer. Long-form copy uses the same notebook and omniscient context; Strategy Bible and producer-brief calls are removed.
- Information firewall: the omniscient House may see and narratively reveal diary answers, sealed decisions, and private conversations to human viewers. AI contestant diary and Judgment prompts use only actor-scoped public/participated/owned context plus that player's prior diary Q&A. They never receive House summaries, the House notebook, operator traces, or other players' private material.
- Durability and recovery: `HouseNarrativeContinuityV2` commits recent public beats and the private notebook in the same durable logical turn as their dialogue and viewer-publication references. Provider refusal or exhaustion emits no fabricated summary and preserves the previous notebook under the bounded pending-delta policy. Normal process reload adopts the committed turn frontier; it does not require a deployment drain or a phase-coordinate allowlist.
- Validation: `bun run test`, `bun run test:postgres`, and `bun run check` pass. The authorized current-provider comparison accepted all six authored summary samples in one call each and showed materially stronger promise/consequence continuity. The bounded full game carried a coherent multi-round House arc; refusals and timeouts emitted no fabricated prose. The local report at `.local-uploads/r32-provider-surfaces/house-narrative-comparison.md` records visible examples, calls, tokens, known cost, latency, failures, and the two narrow follow-up fixes without semantic hashes, source attestations, or automatic factual grades.

### R21. Agentic, selective-fact House summaries at phase cadence

- Status: `closed` (superseded by R32's House-authored narrative contract)
- Priority: **high**
- Sources: `packages/engine/src/house-summary-frontier.ts`, `packages/engine/src/house-interviewer.ts`, `packages/engine/src/game-runner.ts`, `packages/engine/src/scripts/evaluate-house-summary-cadence.ts`, and `docs/plans/2026-08-19-001-refactor-agentic-house-summary-cadence-plan.md`.
- Superseding decision: the selective-fact design prevented the House from authoring the connective narration the product needs while spending calls/tokens on model-generated attestations with no authoritative game consumer. R32 removed its aliases, fact store/read loop, claims, receipts, renderers, and separate producer memories. The cadence scheduler, bounded direct context, nonfatal failure policy, engine-owned provider telemetry, and canonical/projection authority remain.

### R23. Exceptional, actionable compact strategy diffs

- Status: `implementation_complete/runtime_proof_pending` (implementation merged 2026-08-21 in PR #113)
- Priority: **high**
- Sources: production game `used-lilac-ash`, `packages/engine/src/strategy-state.ts`, `packages/engine/src/agent.ts`, `docs/reasoning-transcript-observability.md`, and `docs/plans/2026-08-14-001-perf-compact-decision-envelope-plan.md`.
- Signal: the compact strategy lifecycle and mechanical validation behaved correctly in the reviewed game, but agents emitted strategy candidates across many ordinary Mingle, alliance-action, and huddle turns even when the text mostly restated the current posture. Frequent low-information deltas consume output tokens and make material changes harder for producers and future prompts to distinguish.
- Product decision: keep `strategyDelta` optional and make omission the expected result when the current strategy still applies. A delta should record a material, actionable change to targets, alliance posture, commitments, threat assessment, priorities, or contingencies; it should not summarize the action, repeat the baseline, narrate unchanged intent, or prove that the agent considered strategy.
- Authority boundary: strategy remains private, fallible cognition. Deltas never become canonical game facts, alliance obligations, or evidence that an agent must vote a particular way. Malformed or rejected strategy metadata must remain independent from acceptance of an otherwise legal gameplay action.
- Concrete seam: shared strategic-decision guidance, tool-field descriptions, compact-strategy application diagnostics, prompt scenario fixtures, and producer strategy-result reads.
- Validation path: focused scenario fixtures distinguish material changes from restatements and prove null/omitted deltas leave strategy unchanged. A current-meta API-backed game reports non-null, accepted, rejected, and no-change strategy candidates plus output tokens by action family; human review verifies retained deltas are materially useful without requiring alliance compliance or penalizing valid pivots.
- Implemented shape: PR #113 tightened shared strategy-delta guidance and schemas, added explicit private `no_change` diagnostics for omitted and exact literal-null deltas, preserved legal gameplay acceptance independently from rejected strategy metadata, and retained the existing state machine and character limits.
- Remaining proof: the reviewed production game predates literal-null normalization and the merged head. Keep R23 open until one authenticated current-meta API-backed game proves materially useful retained deltas and the exact no-change boundary without strategy leakage or provider retries.

### R31. Make producer match narrative satisfy its declared response schema

- Status: `ready`
- Priority: **high**
- Sources: authenticated production evaluation of completed current-meta game `dead-fawn-ice` on 2026-08-25; `packages/api/src/services/match-narrative-compact-v2.ts`, `packages/api/src/services/match-narrative-read-model.ts`, `packages/api/src/game-mcp/contracts.ts`, and the production Game MCP read-model/server tests.
- Signal: `read_producer_match_narrative` failed before returning the completed game's all-seat narrative with `match narrative result.limitations is required`. The read model computed an empty limitations collection, but the compact v2 encoder omitted the field while the exposed result contract required it. Lower-level producer traces and cognitive artifacts remained readable, but that workaround defeats the intended one-shot grouped narrative surface and blocks its accepted/rejected strategy review.
- Required direction: make the compact v2 encoder and the declared MCP result contract agree. Successful narrative pages must return an explicit `limitations: []` when there are no limitations and preserve the typed non-empty array when limitations exist. Do not weaken producer authorization, private-lane policy, cursor binding, content-trust labels, or board-authority disclaimers, and do not substitute a client-side merge of lower-level evidence.
- Validation path: add encoder coverage for empty and non-empty limitations; validate the encoded result against the actual MCP output schema; and exercise `read_producer_match_narrative` through the production MCP server for a completed current-meta producer game across terminal and paginated pages. Retain owner/producer isolation, schema v1 behavior, stable cursors, and existing strategy/thinking privacy coverage.
- Runtime proof: repeat the authenticated read against a completed current-meta game and receive an `ok: true` grouped all-seat narrative page with explicit limitations, rather than a server-side result-validation error. This is a read-only proof and requires no new provider-backed game.

### R27. Complete failed-provider request evidence for producer debugging

- Status: `ready`
- Priority: **high**
- Sources: the failed local `gpt-5.6-luna` simulation batch from 2026-08-21, `packages/engine/src/agent.ts`, simulation artifact writing, API-backed private decision evidence, and producer game-debugging reads.
- Signal: an OpenAI Responses request was rejected with HTTP 400 after Round 1, but the saved simulation contained neither the rejected request nor its provider request ID or complete error response. The same gap prevents a producer from inspecting an equivalent failure after API-backed gameplay. Aggregate token, prompt-reuse, and recall receipts cannot explain why a specific provider request failed.
- Required evidence contract: preserve the complete failed request exactly as submitted, including system and user prompts, strategy context, dialogue context, reasoning settings, schemas and tools, provider/model configuration, and request parameters. Preserve the complete provider error response and headers exactly as received, including the provider request ID. Attach game, round, phase, action, actor, attempt, and timestamps. Do not replace the request or error with a hash, summary, sanitized receipt, reduced field set, or redacted producer view.
- Storage and access: local simulations write the complete evidence into their batch artifacts. API-backed games store the complete evidence through the existing private gameplay-evidence authority and make it retrievable by the producer. Public/player events, transcripts, and viewer APIs remain separate from producer evidence.
- Validation path: deterministic failed Responses and Chat Completions requests round-trip every request field, error field, header, and request ID byte-for-byte; simulation artifacts retain the evidence after a failed or recovered call; API-backed tests prove producer retrieval for the correct game and reject non-producer access; successful requests and canonical gameplay remain unchanged.
- Suggested slice: first persist and retrieve one failed ordinary-speech Responses request end to end in both a local batch and an API-backed game, using the same complete evidence schema. Then cover structured tool calls, retry attempts, and other providers without weakening the evidence contract.

### R28. Eliminate synthetic `[No response]` gameplay outputs

- Status: `ready`
- Priority: **high**
- Sources: every provider adapter, agent decision method, House narration path, phase runner, retry path, and transcript/publication seam that constructs, returns, accepts, or publishes the literal `[No response]` after a provider failure, timeout, empty result, or malformed result.
- Signal: `[No response]` is fabricated prose. When it is returned through a normal player or House response type, downstream code can mistake an absent or failed model result for dialogue that the agent actually produced. Retrying a request, skipping optional speech, failing a required decision, and applying a legal deterministic decision fallback are materially different outcomes and must not collapse into the same synthetic text.
- Required direction: inventory and remove every synthetic `[No response]` path. Represent provider rejection, timeout/network failure, auth or configuration failure, successful-but-empty output, malformed or undecodable structured output, and cancellation as explicit typed outcomes with their original failure provenance. The phase policy—not the provider adapter—decides whether a given outcome retries, skips optional speech, or aborts the action/game. No synthetic placeholder may be published as player speech, House narration, transcript dialogue, or an accepted decision.
- Decision integrity: optional speech may be absent without inventing dialogue. Required structured decisions must either succeed or use an explicit, deterministic, rules-legal fallback whose provenance is recorded as a fallback rather than model output. Failed or absent calls must not create or update strategy, commitments, diary content, or other agent-authored state.
- Runtime parity: apply the same semantics to local simulations and API-backed gameplay, including Responses, Chat Completions, local OpenAI-compatible providers, House calls, tool/structured-output calls, and retry exhaustion. Keep this item separate from R27: R27 preserves complete producer-debugging evidence; R28 defines gameplay behavior after a call does not yield usable model output.
- Validation path: deterministic coverage enumerates every former constructor and consumer of `[No response]`; asserts the literal never appears in turns, transcript rows, House events, public events, decisions, strategy state, or simulation text; and proves the intended retry, optional-speech skip, required-decision fallback, cancellation, and fatal-failure semantics in both simulation and API-backed execution.
- Suggested slice: begin with ordinary player speech across Responses and Chat Completions, replacing string fallback with a typed absent/failed result through the real phase runner and proving that the phase continues without publishing fake dialogue. Then migrate structured decisions, House narration, local-provider retries, and remaining literal consumers until a repository-wide assertion shows no synthetic gameplay output remains.

### R29. Game-sealed provider fallback manifest

- Status: `ready`
- Priority: **high**
- Sources: repeated hosted OpenAI `invalid_prompt` rejections during local `gpt-5.6-luna` games; the existing model catalog and provider profiles in `packages/engine/src/model-catalog.ts`; provider construction in `packages/engine/src/llm-client.ts` and `packages/api/src/services/game-lifecycle.ts`; simulation launch/configuration; R27 failed-request evidence; and R28 typed provider-failure outcomes.
- Signal: a game currently seals one model/provider selection. A nonretryable provider refusal during required gameplay can therefore fail or suspend an otherwise healthy game even when another configured, game-ready provider could execute the same logical call. In the observed evening sample, two of four local games ended on OpenAI HTTP 400 `invalid_prompt` responses after substantial prior paid gameplay, while equivalent failures appear uncommon but possible across the larger live-game history.
- Required direction: replace the single game model selection with an ordered, bounded provider manifest sealed into the game before it starts. The unattended Daily default is `openai:gpt-5.6-luna` followed by `katana:glm-5-2` and `katana:grok-4-5`; exact entries must retain Influence speech, structured-decision, and tool compatibility, with current price—not response speed—governing the fallback choice. Validate every entry's provider credentials and compatibility before admitting the game. Local simulation and API-backed gameplay must execute the same manifest.
- Failover semantics: one logical gameplay call starts at the primary manifest entry. A typed, nonretryable provider refusal such as OpenAI `invalid_prompt` must not resend the unchanged request to that provider; it advances once to the next compatible manifest entry. Existing bounded same-provider handling for genuinely retryable capacity or transport failures completes before provider failover. Successful primary calls never contact a fallback. Exhausting the manifest returns one explicit typed call failure to the phase policy defined by R28.
- Gameplay integrity: failover preserves the actor, action, canonical boundary, player memory, strategy state, authorized evidence, semantic prompt content, output contract, and acceptance rules. Provider adapters may translate only the transport/schema envelope required by the selected model's declared capabilities. They must not replay already accepted actions, restart the phase, weaken validation, fabricate dialogue, or parse transcript prose into authority. Exactly one accepted result may commit for the logical call.
- Durability and observability: persist the sealed manifest and current logical-call attempt chain through the provider journal and durable logical turns. Record every provider attempt, fallback reason, request/response identity, usage, service tier, latency, and actual or estimated cost as producer evidence, using R27's complete failure evidence rather than a parallel reduced receipt. Public dialogue may identify the producing agent but must not expose provider credentials or private failure evidence.
- Validation path: deterministic Responses-to-Katana and Chat-Completions-to-Katana tests prove an OpenAI `invalid_prompt` receives no unchanged OpenAI retry, the next provider receives exactly one semantically equivalent request, and one result commits once. Additional cases prove primary success makes zero fallback calls; retryable 429/transport handling remains bounded; incompatible or unavailable manifest entries fail admission before paid gameplay; all-provider failure stays typed and non-synthetic; recovery resumes the same manifest/attempt boundary without duplicate effects; and per-provider/per-game accounting reconciles every attempted call.
- Suggested slice: first validate and catalog `katana:grok-4-5` and `katana:glm-5-2`, then support the sealed three-entry manifest `openai:gpt-5.6-luna` → `katana:glm-5-2` → `katana:grok-4-5` for ordinary player speech in both the simulator and API lifecycle. Drive an exact captured OpenAI `invalid_prompt` into one Katana request, publish only the validated fallback speech, preserve every provider evidence record, and prove the primary-success zero-fallback path. Expand to structured decisions and House calls only after that end-to-end slice is green.

### R15. Format-kernel phase-boundary startup recovery

- Status: `closed`
- Priority: **high** (reopened 2026-08-04 after a live local failure; resolved 2026-08-19)
- Sources: local game `free-blue-wire`; historical checkpoint selector `packages/api/src/services/game-recovery-support.ts`; current `packages/engine/src/game-runner.ts`, `packages/engine/src/durable-game-runner.ts`, `packages/api/src/services/game-turn-commit.ts`, and `packages/api/src/__tests__/game-durable-run.test.ts`; plan `docs/plans/2026-07-26-001-fix-format-phase-boundary-recovery-plan.md`.
- Finding: durable inspection showed that one healthy owner appended events 63-78 after the event-62 `FORMAT_RESOLVE` checkpoint and sealed the event-78 `LOBBY` checkpoint. A competing API launch then ran startup orphan classification before its `Bun.serve` call discovered `EADDRINUSE`, so it fenced that still-live owner as `startup_orphaned`. The event-78 post-round lobby is intentionally not a supported resume boundary, and the older event-62 checkpoint was no longer at the event head, leaving the game correctly fail-closed after the erroneous suspension.
- Superseding resolution: current games no longer recover from selected format phase checkpoints. Every format phase runs as one or more atomic logical turns with a committed XState snapshot, typed cursor, deterministic seed, canonical/dialogue effects, continuity, provider-call bindings, and viewer publications. Startup adopts that frontier directly, so interruption before a turn commit repeats the same planned work and interruption after commit advances from the committed result. Listener-first activation still prevents a private validation candidate from claiming live game ownership.
- Automated proof: engine tests stop before and after Format Mingle/Resolve commits and reproduce the exact Safety Bounce draft from the persisted seed. The DB-backed lifecycle test interrupts a current game, adopts the same ID under a new owner, preserves one roster initialization and contiguous committed turns, and reaches normal completion. Listener-first startup still prevents a losing process from mutating live ownership.
- Runtime proof boundary: the historical `free-blue-wire` rows establish the causal durable shape; the closure proof is deterministic DB/API lifecycle automation, not a new provider-backed live game or an operating-system two-process rehearsal.

### R20. Complete CI test discovery without paid or external side effects

- Status: `implementation_complete/operator_rollout_pending` (implementation merged 2026-08-20 in PR #117)
- Priority: **high**
- Sources: `docs/brainstorms/2026-08-16-ci-test-discovery-requirements.md`, `docs/plans/2026-08-16-001-test-complete-ci-discovery-plan.md`, root and workspace `package.json` test scripts, `.github/workflows/ci.yml`, and the missed `format-presentation-metadata.test.ts` assertion found after PR #88 merged.
- Historical signal: required CI ran hand-maintained `test:mock` file lists rather than all provider-free tests. PR #88 passed required checks even though a deterministic engine test was already red because that file was absent from the list. Adding individual files repaired known gaps but did not prove the lists were complete.
- Concrete seam: workspace test layout, provider/DB/browser dependency classification, `test:mock` scripts, and CI test jobs.
- Implemented shape: PR #117 made ordinary provider-free and API/PostgreSQL tests use Bun discovery; exceptional suites use structural suffixes; `scripts/check-test-classification.ts` fails closed for unowned tests; deterministic browser coverage is isolated and visible but non-required; live-provider, external, real-Clerk, and staging execution remain opt-in. The exact implementation head passed `check`, `Provider-free tests`, `API / PostgreSQL tests`, and all four Browser Coverage jobs.
- Remaining operator step: as verified on 2026-08-25, the active `main` ruleset still requires only `check`. Add `Provider-free tests` and `API / PostgreSQL tests` after observing them on the exact protected `main` commit; keep Browser Coverage visible but non-required. Until that ruleset update lands, the plan remains `active` and R20 is not `closed`.

### R12. Player Strategy Thread durable continuity

- Status: `closed`
- Priority: **high** (resolved 2026-07-26)
- Consolidates: plans C4, brainstorms B5, continuity audit on 2026-07-26, and the superseding logical-turn runtime.
- Sources: `packages/engine/src/agent.ts`, `packages/engine/src/player-continuity.ts`, `packages/engine/src/game-runner.ts`, `packages/engine/src/durable-game-runner.ts`, and `packages/api/src/services/game-turn-commit.ts`.
- Resolution: every logical turn executes against staged player continuity and atomically commits the next versioned capsule with canonical/dialogue effects and the typed cursor. Reload restores the committed capsules into fresh agents and scrubs eliminated players; `PgMemoryStore` remains non-authoritative operational storage and is never merged into execution authority. Transcript prose and public/MCP reads remain outside continuity authority.

### R16. Atomic House narrative continuity

- Status: `closed`
- Priority: **high** (resolved 2026-07-26)
- Sources: `packages/engine/src/game-runner.ts`, `packages/engine/src/house-summary-frontier.ts`, `packages/api/src/services/game-turn-commit.ts`, and `packages/api/src/services/game-publications.ts`.
- Resolution: House cadence now runs inside phase scratch execution. Accepted public copy, its transcript row, recent beat history, and the opaque private notebook commit in one logical turn before viewer release. `null` notebook output preserves the prior snapshot; failed output mutates neither. Startup loads the committed `HouseNarrativeContinuityV2` directly, while player prompts remain behind the information firewall.

### R5. Producer-visible decision fallback and repair ledger

- Status: `ready`
- Consolidates: local API-backed model evaluation finding from q-naifu-a3b testing.
- Sources: local runtime logs showing `[tool-fallback]` / `[vote-fallback]` repairs during API-backed Katana games; current canonical vote/revote events preserve repaired legal targets but do not expose whether fallback or target repair occurred.
- Signal: fallback-heavy model failures can currently be hidden behind valid-looking canonical game events. Producers may only notice the failure in local server warnings; provider accounting records spend, not repair provenance.
- Concrete seam: agent fallback paths, vote/revote target validation, cognitive artifact diagnostics, and producer-safe postgame analysis.
- Validation path: run a model that emits invalid/empty vote targets; verify the canonical game still advances, while the admin/producer surface clearly shows fallback count, repaired fields, original invalid value, fallback reason, and affected agent/action/round.
- Suggested slice: persist a bounded producer-only ledger containing action, actor, round, original invalid value, chosen repair, reason, and model. Summarize it through existing producer analysis instead of polluting player-facing canonical events or coupling it to cost accounting.

### R13. Accepted-action trace-to-event correlation

- Status: `closed`
- Consolidates: match-narrative token-efficiency plan U5 and live local-game evidence from `jade-black-mist`.
- Sources: `docs/plans/2026-07-25-001-fix-accepted-action-trace-correlation-plan.md`, the accepted-action registry, API reconciliation/read models, and DB-backed privacy/correlation tests.
- Implemented: fresh per-call receipts cover the direct accepted-action inventory without consulting `getLastPrivateDecisionId()`; post-append reconciliation stamps manifest, cognition, and prompt-reuse rows; producer manifests/narrative expose exact navigation; non-producer event/transcript/watch/results lanes remove private pointers. Reconciliation is forward-only, idempotent, retryable, conflict-aware, and non-fatal. Historical backfill remains deliberately absent.
- Automated proof: exhaustive registry coverage plus DB-backed exact-sequence, retry/degradation, prompt-reuse watermark, producer navigation, owner citation, sealed-ballot, actor-filter, API, results, transcript, and WebSocket privacy tests.
- Resolution: deployed API game `mad-slate-apple` (completed 2026-07-29) provides the live format-kernel proof: its trusted 562-event prefix has 249 eligible accepted decisions, all 249 linked, with zero unresolved/missing/conflicting captures. Trace manifests carry both `decisionId` and final `eventSequence` (through 559); prompt-reuse coverage remains honestly `partial` for 1,405 intentionally unlinked non-action traces, while its accepted-action watermark advances to 559. The game does not exercise classic Power/Council actions, but those remain covered by the engine and DB-backed integration suite; no further R13 work is warranted.
- Deferred: historical inference/backfill and a dedicated cache/linkage dashboard remain separate product decisions, not R13 exit work.

### R17. Watch-shell accessibility baseline

- Status: `ready`
- Priority: **medium**
- Sources: `packages/web/src/app/games/[slug]/components/match-watch-shell.tsx`, `packages/web/src/app/games/[slug]/components/dramatic-replay-viewer.tsx`, `packages/web/src/app/games/[slug]/components/replay-controls.tsx`, and the format-aware game-viewer planning review on 2026-07-26.
- Signal: the watch shell has useful structural accessibility—semantic regions, real buttons and links, focus-visible styles, cast-selection labels, pressed states, and inspector tab roles—but no coherent accessibility contract for changing theater content. It has no game-event live region or watch-specific status surface; replay navigation uses unlabeled icon-only buttons; and inspector tabs declare tab semantics without standard keyboard navigation.
- Concrete seam: watch-shell landmarks and status regions, replay controls, inspector tabs, dynamic phase/result announcements, focus behavior, and shared component accessibility tests.
- Validation path: keyboard-only navigation, screen-reader-oriented role/name/state assertions, one live-event announcement story, replay-control accessible-name coverage, tab arrow-key behavior, and focus retention through responsive reflow.
- Suggested slice: audit and repair the shared watch shell as one accessibility pass before adding format-specific announcements. Establish accessible control names, correct tab keyboard behavior, a single canonical event/status announcement policy, and focused component/browser coverage without changing game authority or presentation pacing.

### R19. Extract a lightweight simulation package above the engine

- Status: `ready`
- Priority: **medium**
- Sources: `packages/engine/package.json`, `packages/engine/src/index.ts`, `packages/engine/src/simulate.ts`, `packages/engine/src/api-simulate.ts`, `packages/engine/src/simulation-instrumentation.ts`, `packages/engine/src/game-mcp/`, `packages/engine/src/agent.ts`, `packages/engine/src/house-interviewer.ts`, and the format-aware game-viewer planning review on 2026-07-26.
- Signal: `@influence/engine` has one broad source entry and no explicit exports map. Its public barrel combines pure domain events/projections with the filesystem-backed local simulation MCP, simulation runners, artifact writers, OpenAI-coupled agents, provider configuration, and Node-only utilities. The simulator is a major source of package-boundary pollution, although it is not the only one: crypto and provider dependencies also remain in core-adjacent agent, House, state, hashing, and prompt-reuse modules.
- Concrete seam: a new lightweight `@influence/simulation` workspace package above the engine; simulator CLI/configuration, artifact writers, local corpus MCP, Node filesystem/process utilities, and simulation-only dependencies; explicit engine exports for pure domain, runtime/provider adapters, and browser-safe leaves.
- Validation path: preserve existing root simulation commands and artifact formats through the new package; keep deterministic engine and API tests passing; prove browser-safe engine subpaths with a production Next.js build; add an import-boundary test that rejects Node/provider/simulation dependencies from designated pure/browser entries.
- Suggested slice: first move `simulate.ts`, `api-simulate.ts`, simulation instrumentation, local artifact writing, and the filesystem-backed simulation MCP into `@influence/simulation` without redesigning gameplay. Then inventory the remaining Node/OpenAI coupling and lift it behind injected runtime/provider/UUID/hash ports in bounded follow-ups. Do not claim the engine is environment-agnostic until those remaining imports are removed from its designated core boundary.

### R30. Remove stale simulator variant aliases

- Status: `ready`
- Priority: **low**
- Sources: `packages/engine/src/simulate.ts`, `packages/engine/src/__tests__/simulate-config.test.ts`, `docs/local-model-evaluation.md`, and the compact-decision-envelope one-game validation review on 2026-08-14.
- Signal: simulator variants still describe Mingle as an experiment even though both `baseline` and `mingle` now resolve to the same current configuration: one Lobby message per player, three Mingle beats, and no post-vote Power Lobby. Selecting `mingle` changes the recorded label but not gameplay, while the remaining string matrix mixes that obsolete alias with still-distinct Power Lobby experiments. This makes production-like run recipes look more experimental and less reviewable than they are.
- Concrete seam: `SimArgs.variant`, `INFLUENCE_SIM_VARIANT`, CLI parsing, `MINGLE_VARIANTS`, `POWER_LOBBY_VARIANTS`, `buildSimulationConfig()`, run metadata, simulator examples, and focused configuration tests.
- Validation path: prove the normal simulator configuration remains byte-for-byte equivalent after cleanup; prove any retained Power Lobby experiment is selected through an explicit option; verify current runbooks no longer require `--variant mingle`; preserve historical batch metadata as historical evidence rather than a compatibility input.
- Suggested slice: remove the semantically duplicate `mingle` alias and replace the combined variant-name matrix with explicit simulator options for any experiment that still has an owner. Keep the default path equal to current normal gameplay and do not introduce a feature flag into production game configuration.

### R4. Private trace purge execution

- Status: `ready`
- Consolidates: plans C8, brainstorms B7.
- Sources: `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:474-482`, `docs/plans/2026-06-15-001-feat-private-trace-writer-mcp-plan.md:278-288`, `docs/brainstorms/2026-06-15-private-trace-writer-mcp-requirements.md:10-20`, `docs/brainstorms/2026-06-15-private-trace-writer-mcp-requirements.md:57-70`, `docs/brainstorms/2026-06-15-private-trace-writer-mcp-requirements.md:162-193`
- Signal: manifests already carry retention, expiry, and redaction state, and reads fail closed for expired or redacted evidence. No executor marks content purged and deletes or otherwise makes the stored object non-dereferenceable.
- Concrete seam: private trace manifests, storage object deletion, evidence read audit, and local producer operations.
- Validation path: purge/redaction tests for manifest state, object deletion, expired-object behavior, bounded reads after purge, and non-dereferenceable private content.
- Suggested slice: implement one audited purge operation over the existing manifest and storage contracts. Avoid broad storage redesign, legal-hold machinery, or a general records system.

### R8. Durable draft-avatar recovery ownership

- Status: `ready`
- Consolidates: Standing Daily Agent implementation review finding #7.
- Sources: `packages/api/src/services/avatar-generation.ts`, `packages/api/src/routes/agent-profiles.ts`, `packages/web/src/app/dashboard/agents/agent-form.tsx`, `docs/solutions/runtime-errors/api-startup-recovery-resumes-interrupted-games.md`, `docs/solutions/architecture-patterns/house-highlights-postgame-media-pipeline.md`
- Signal: pre-profile avatar requests are persisted, but accepted work is initially executed by an in-process fire-and-forget promise. Browser polling can resume a known request, but a server restart followed by a form reload loses the draft request ID and can leave queued or stale-processing work without an owner.
- Concrete seam: avatar generation request claiming, API startup recovery, stale-processing detection, draft request discovery, and provider request idempotency.
- Validation path: interrupt the API after a draft is queued and after provider submission; restart without the originating form; verify the same request is reclaimed, completes once, stores one image, and does not create duplicate provider jobs.
- Suggested slice: add a server-owned startup or periodic reconciler that claims queued and stale avatar requests. Keep browser polling as progress UI, not execution ownership.

### R10. Honest avatar-generation status degradation

- Status: `closed`
- Consolidates: Standing Daily Agent implementation review finding #9.
- Sources: `packages/web/src/components/avatar-generation-activity.tsx`, `packages/web/src/app/dashboard/agents/avatar-completion.ts`
- Resolution: repeated status-read failures preserve the last provider status and surface a distinct `Portrait status unavailable` state with manual refresh. They no longer manufacture a terminal generation failure.
- Concrete seam: avatar completion UI state, activity polling, retry affordances, and provider-versus-status error copy.
- Validation path: force three consecutive status API failures while the provider request remains pending, then recover the API; verify the UI reports status as temporarily unavailable, never claims generation failed, and eventually displays the completed portrait.
- Suggested slice: introduce a separate status-unavailable/degraded state with bounded backoff and manual refresh. Preserve the last known provider status instead of manufacturing a terminal failure.

### R11. Bounded draft-avatar polling and create recovery

- Status: `closed`
- Consolidates: Standing Daily Agent implementation review finding #10.
- Sources: `packages/web/src/app/dashboard/agents/agent-form.tsx`, `packages/web/src/app/dashboard/agents/avatar-completion.ts`, `packages/api/src/routes/agent-profiles.ts`
- Resolution: draft polling uses bounded backoff and a manual status refresh, and portrait generation no longer disables Agent creation or update. A pending draft request attaches to the saved profile transactionally and completes against that profile in the background.
- Concrete seam: AgentForm draft polling, submit eligibility, retry controls, stale-draft handling, and post-create default portrait generation.
- Validation path: use fake timers and sustained 401/5xx responses; verify retry count and backoff are bounded, polling stops, the user receives a legible retry or create-without-waiting action, and no failed draft is accidentally consumed or attributed to the created agent.
- Implemented slice: the editor persists its request ID with the local draft, save attaches that request without waiting, explicit uploads retain precedence, and creation retries reuse a per-owner idempotency key.

## Future / Watchlist

### D1. Multi-process execution ownership and observer delivery

- Status: `future`
- Consolidates: plans C3, part of brainstorms B2, and former W5 horizontal scaling locks/pub/sub.
- Sources: `docs/plans/2026-06-14-003-feat-phase-boundary-runtime-snapshot-plan.md:277-285`, `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:474-482`, `docs/statefulness-plan.md:173-235`
- Signal: single-process startup recovery and owner heartbeats now protect accepted commits, but active execution and Bun websocket publish/subscribe remain process-local.
- Concrete seam: game owner rows, lease freshness, graceful shutdown, lifecycle execution locks, and cross-instance observer delivery.
- Validation path: graceful shutdown, owner-expiry, multi-worker claim contention, restart-orchestrator, and cross-instance observer-delivery tests.
- Promotion trigger: multiple API/worker processes become real or deploys need graceful drain and observer routing beyond one process.
- Suggested slice if promoted: establish Postgres-backed single-owner execution before adding distributed websocket delivery. Add Redis or another pub/sub layer only when multi-instance observers require it.

### W1. GameWatchState summary repair scheduling

- Status: `future`
- Consolidates: plans C5, brainstorms B4, updated after code inspection.
- Sources: `docs/plans/2026-06-20-003-feat-game-watch-state-summaries-plan.md:292-327`, `docs/brainstorms/2026-06-20-game-watch-state-summary-read-model-requirements.md:10-26`, `packages/api/src/services/game-watch-state-summary.ts:50-115`, `packages/api/src/services/game-watch-state-summary.ts:155-220`, `packages/api/src/routes/games.ts:202-232`
- Signal: the durable summary table, refresh service, route batch read, lifecycle refresh, and backfill command already exist. The original list-performance problem is not a ready backlog item anymore.
- Remaining possible gap: if lifecycle refresh fails, list reads detect missing/schema-stale rows but not current-schema rows behind the durable event head. The explicit operator-run backfill detects and repairs that drift; no background scheduler runs it automatically.
- Promotion trigger: stale game-list rows become visible in real use, or production operations need automatic summary repair beyond the explicit backfill command.
- Suggested slice if promoted: scheduled or deploy-time repair for summaries behind event head, plus tests that preserve "list route is not a replay worker."

### W3. Interrupted-game public replay materialization

- Status: `future`
- Consolidates: `docs/statefulness-plan.md` Phase 1.4.
- Sources: `docs/statefulness-plan.md:159-171`, `docs/statefulness-plan.md:246-252`
- Signal: supported checkpoints now persist a sanitized transcript replay and durable watermark, and resume seeds the in-memory transcript from that replay. Public transcript rows still materialize only at terminal completion or on the legacy non-owner failure path, so an unrecoverable interrupted game can lack a public partial replay.
- Concrete seam: checkpoint transcript replay, transcript insertion, supported-resume completion, and suspended/unrecoverable game reads.
- Promotion trigger: users need public replay access for suspended or unrecoverable games rather than only for resumed-to-completion games.
- Suggested slice if promoted: materialize checkpoint-backed public transcript rows for explicitly terminal interrupted states. Do not duplicate rows during successful resume or market partial replay as game recovery.

### W4. Shared auth-session event adapter

- Status: `future`
- Consolidates: ideation comment/TODO scan.
- Sources: `docs/ideation/2026-06-21-refactoring-session-comments-todos-research-ideation.html:452-458`, `packages/web/src/lib/api.ts:38-84`, `packages/web/src/hooks/use-permissions.ts:118-119`
- Signal: the old ESLint TODO is gone, but dashboard, profile, agent, queue, avatar, permissions, and game-viewer surfaces still duplicate `auth:session-ready` / `auth:expired` listener setup.
- Concrete seam: shared auth/session hook or derived state helper, plus dashboard/profile/agent/game watcher listeners.
- Promotion trigger: auth-state flashes, duplicated listener bugs, or active work in those web surfaces.
- Suggested slice if promoted: centralize readiness/expiry subscription and derived session state behind one hook or adapter. Keep it UX-driven, not lint-churn-driven.

### W6. Alliance huddle short-mode compression

- Status: `future`
- Consolidates: named-alliance brainstorm deferred short-mode rule.
- Sources: `docs/ideation/2026-07-02-named-alliances-ideation.html:406-413`
- Decision (2026-08-19): preserve House-scheduled huddles as the floor that lets an alliance coordinate. Reduce alliance formation/action volume through R22 before cutting huddle turns.
- Signal: the current named-alliance rules keep the full-drama route and rely on existing token-maxing rules. The reviewed production game made `alliance-action`, not `alliance-huddle-turn`, the largest alliance-related cost family. A dedicated short-mode huddle design should wait until proposer gating lands and later games show which remaining huddles are expensive without adding strategy.
- Concrete seam: alliance round cadence, House huddle scheduling, simulation token accounting, local model evaluation summaries.
- Promotion trigger: after R22, named-alliance simulations show huddle windows themselves dominate token spend or make large-cast games drag.
- Suggested slice if promoted: design a compressed alliance-huddle mode that preserves post-vote fallout and cuts optional private coordination first.

### W7. Cross-alliance membership and appearance guardrails

- Status: `future`
- Consolidates: named-alliance brainstorm deferred membership-cap rule.
- Sources: `docs/ideation/2026-07-02-named-alliances-ideation.html:406`, `docs/ideation/2026-07-02-named-alliances-ideation.html:447-459`
- Decision (2026-08-19): do not add House deletion, alliance-compliance rules, or hard membership caps. First use R22 to make proposer access scarce and continue using House huddle selection as the soft attention filter.
- Signal: each alliance is already limited to two huddle sessions and each live member receives one turn per session. Overlapping alliances remain intentionally uncapped across the whole window, so repeated appearances could still crowd out other alliances after proposer gating reduces formation volume.
- Concrete seam: alliance roster context, House huddle scheduling, huddle-seat budgets, prompt context budgeting, simulation diagnostics for multi-alliance agents.
- Promotion trigger: after R22, agents still join too many alliances to reason coherently, repeat huddle appearances crowd out other scheduled alliances, or large overlapping alliances multiply speaking turns beyond the intended token budget.
- Suggested slice if promoted: evaluate soft caps first, such as House fatigue penalties, per-window speaking appearance limits, huddle-seat budgets, or warning-only diagnostics before hard membership caps.

### W8. Universal-alliance resolution phase

- Status: `future`
- Consolidates: named-alliance brainstorm universal-alliance alternative.
- Sources: `docs/ideation/2026-07-02-named-alliances-ideation.html:501-513`
- Signal: v1 closes any alliance containing all alive players before huddle eligibility and lets agents handle the fallout inside Mingle I. A special resolution phase is heavier ceremony and should earn its keep.
- Concrete seam: alliance lifecycle rules, Mingle I setup, House huddle scheduling, closed-alliance context.
- Promotion trigger: automatic closure feels too abrupt in simulation transcripts, or agents repeatedly fail to convert universal alliances into smaller playable coalitions.
- Suggested slice if promoted: add a bounded universal-alliance resolution moment with a max round count, then force close, fracture, or disband before the vote-facing Mingle I starts.

### W9. Alliance-aware private vote reveal

- Status: `future`
- Consolidates: named-alliance vote-visibility question.
- Sources: `docs/ideation/2026-07-02-named-alliances-ideation.html:406`, `docs/ideation/2026-07-02-named-alliances-ideation.html:537-545`
- Signal: current rules keep votes public. Private votes or specialized alliance vote reveal phases could add deception, but they also risk hiding the post-vote social pressure that currently powers Mingle fallout.
- Concrete seam: vote visibility rules, post-vote Mingle context, alliance receipts, public watch/replay surfaces.
- Promotion trigger: public vote visibility makes alliances too deterministic or makes betrayal/fallout less dramatic than expected.
- Suggested slice if promoted: design an alliance-aware vote reveal phase that preserves public spectacle while controlling when hidden coordination becomes known.

### W10. Post-vote alliance fracture and reaffirmation window

- Status: `future`
- Consolidates: named-alliance document-review finding about stale alliance status before Council.
- Sources: `docs/plans/2026-07-02-002-feat-named-alliances-rules-plan.md`
- Signal: v1 keeps alliance mutation inside Mingle I. Post-vote Mingle and pre-Council huddles can surface betrayal, repair, and dissent as social evidence, but they do not formally change alliance status before Council.
- Concrete seam: post-vote Mingle, pre-Council huddle outcomes, alliance lifecycle states, huddle eligibility.
- Promotion trigger: simulations show Council huddles repeatedly operating on stale active alliances after obvious public betrayals, making coordination less legible or less strategic.
- Suggested slice if promoted: add a narrow existing-alliance-only consequence window where members may formally renounce, reaffirm, fracture, close, or dissolve without allowing new alliance formation.

### W12. Structured trial-alliance expiry

- Status: `future`
- Consolidates: named-alliance implementation review finding about trial timebox enforcement.
- Sources: `docs/rules-page-content.md`, `docs/plans/2026-07-03-001-feat-named-alliances-implementation-plan.md`
- Signal: v1 can activate a trial alliance when all required members consent, but the timebox is still social/textual. The engine should not guess expiry from arbitrary prose.
- Concrete seam: alliance action schema, alliance proposal version terms, phase-boundary lifecycle refresh, huddle eligibility, rules copy.
- Promotion trigger: simulations show trial alliances persisting past their stated boundary or agents using vague timeboxes that make active status misleading.
- Suggested slice if promoted: replace free-form trial expiry with a structured boundary enum and archive trial alliances automatically at the named phase or round boundary.

### W13. Postgame media scale-out and runtime portability

- Status: `future`
- Consolidates: former W13 queue infrastructure and W16 render-worker portability.
- Signal: the first production trailer worker deliberately uses API polling and database leases from one Docker Compose worker on Linode. The manifest and lease protocol are portable, but the deployment is intentionally single-host and single-replica.
- Promotion trigger: multiple render hosts, autoscaling, managed-job execution, materially higher completion volume, or evidence that polling and lease recovery are no longer sufficient.
- Suggested slice if promoted: adapt the existing immutable manifest and claim/heartbeat/finalize protocol to the chosen queue/runtime. Do not move rendering into API or web request containers.

### W14. Postgame media version retention

- Status: `future`
- Signal: public trailer objects are immutable and do not expire; failed-attempt scratch files are deleted immediately, but old successfully published versions remain stored.
- Promotion trigger: storage cost or producer confusion from retained prior versions becomes measurable.
- Suggested slice if promoted: add an audited retention policy that preserves the current version and a bounded diagnostic history before deleting old immutable objects.

### W15. Trailer chapters and transcript panels

- Status: `future`
- Signal: cue metadata and VTT captions exist, while the public player intentionally uses native playback and captions only.
- Promotion trigger: viewers need chapter navigation or a visible transcript to understand longer trailers.
- Suggested slice if promoted: derive viewer-safe chapters from the existing cue contract without exposing internal cue IDs, worker diagnostics, or music filenames.

### W16. Stateful application-intention URLs

- Status: `future`
- Consolidates: layered identity authentication scope boundary.
- Sources: `docs/plans/2026-07-18-001-feat-layered-identity-authentication-plan.md`
- Signal: ordinary authentication entry uses the application's existing redirect behavior. The MCP OAuth authorization page preserves its already-parsed request by keeping the page mounted and rendering authentication inline, but other interrupted application actions are not encoded into durable URLs and are not replayed after sign-in.
- Concrete seam: route-owned return destinations, validated intention identifiers, authentication cancellation, and post-auth navigation.
- Promotion trigger: users measurably abandon important actions because signing in returns them to a page without enough state to resume, or a new flow cannot preserve its request safely by remaining mounted.
- Suggested slice if promoted: define a small allowlisted return/intention contract with expiry and tamper protection. Do not serialize arbitrary application state, OAuth secrets, provider tokens, or mutation payloads into URLs.

### W17. Extract format decision surfaces from InfluenceAgent

- Status: `future`
- Consolidates: format-kernel code review finding #16 (manual class).
- Decision (2026-07-25): **do with the next launch format** — not a standalone refactor while the launch trio is stable. Extract shared helpers as part of adding the fourth format so tool wiring lands once.
- Sources: `packages/engine/src/agent.ts` (format pick / SoE / Vote Bomb / bounce / tiebreak tools and methods), `packages/engine/src/phases/format-kernel.ts`, ce-code-review on `feat/sequester-format-kernel`.
- Signal: five format decision surfaces copy the same validate → tool-call → fallback → `decisionSource`/`fallbackReason` pattern into a very large `agent.ts`, raising merge conflict cost and making a fourth launch format multi-site edits.
- Concrete seam: new module (e.g. `agent-format-decisions.ts` or `formats/agent-surface.ts`) for tool schemas + shared decision runner; thin `InfluenceAgent` delegates; MockAgent and structured-output tests unchanged for tool IDs.
- Promotion trigger: **adding a new launch format** (or a product decision that forces large format-tool rewrites). Do not promote solely for file-size aesthetics.
- Suggested slice if promoted: extract helpers in the same change set as the new format’s tool/legality path, without renaming existing tools or changing product prompts/MockAgent contracts unless the new format requires it. Keep runner legality predicates as injected params per format.

### W18. Single-pass revealed round facts for postgame / completed results

- Status: `future`
- Consolidates: format-kernel code review finding #21 (manual class).
- Decision (2026-07-25): **leave future** — no measured postgame/MCP pain yet; LLM wall-clock dominates operator proof. Promote only with a latency/profile signal.
- Sources: `packages/engine/src/completed-game-results.ts` (`buildRounds`), `packages/engine/src/revealed-round-facts.ts` (`buildRevealedRoundFacts`), format-kernel multi-round postgame/MCP consumers.
- Signal: completed-results / postgame rebuilds round facts with full event-log replay per round (and sometimes double replay inside the builder). Format-kernel games with more standard rounds amplify wall-clock and CPU for operator proof and MCP briefs.
- Concrete seam: one-pass `buildAllRevealedRoundFacts` (or equivalent) reusing a single projection/kernel; thin single-round wrapper kept for live `read_round_facts`.
- Promotion trigger: measurable postgame or MCP latency on multi-round format games, or profiling shows O(rounds × events) dominating completed-results.
- Suggested slice if promoted: preserve dual-shape omit rules (`power`/`council` absent on format kernel) and sealed-ballot access scoping; add a multi-round format fixture as a cost/regression guard.

## Closed / Removed

- R22 House-selected alliance proposer opportunities: implemented by PR #116. One compact House selection now grants exact `ceil(alive / 4)` proposer access with deterministic repair, selected-only proposer calls, private producer rationale, and an unchanged agent-authored alliance transaction. Its current-meta comparison reduced normalized alliance-opportunity calls by 52.9%, tokens by 62.9%, and estimated spend by about 62% while retaining canonical alliance and huddle usefulness evidence.
- R24 producer cognition/trace cursor pagination: implemented by PR #114 with opaque snapshot-bound cursors, honest producer-analysis page metadata, tamper/game/subject isolation, equal-timestamp and concurrent-append stability, and terminal count proof. Ranged trace-content reads and raw storage remain unchanged.
- R25 producer MCP Admin Cost Detail read: implemented by PR #110 through the shared Admin Cost Detail composition service, with route/MCP parity across prompt reuse and every cost state plus subject-scope denial. It added no new metrics, persistence, accounting logic, mutation, backfill controls, or UI.
- R26 participation-aware postgame strategic alignment: implemented by PR #111. Canonical evidence now gates scored participation, non-participation is nullable and excluded from rates/grades, genuine minority participation remains `false`, and API/MCP schemas preserve the scored-round contract.
- R14 House format resolution from events only: the canonical-event authority remains, while R32 removed the obsolete House-specific deterministic fact renderer. `format.ballot_cast`, `format.ballot_forfeited`, `format.safety_bounce_pointer`, and `format.resolved` preserve sealed mechanics and replay identically without a parallel House facts object.
- W19 Domain projection cache during format resolve ballots: implemented on the format-kernel branch. `GameState.getDomainProjection()` memoizes by last canonical sequence and clears on append / event hydration; unit coverage in `canonical-event-replay.test.ts`. Sealed-ballot parallelization remains a separate product follow-up.

- R1 API-backed local run harness: implemented by `b4dcee91`. `bun run simulate:api` now authenticates, creates, fills, and starts real API games, waits for durable advancement, and prints the game URL. Evidence includes launcher argument/config tests, API lifecycle integration and component coverage, and local-model documentation; there is not a standalone end-to-end launcher test.
- R2 phase-boundary resume coverage: superseded by atomic logical turns. Normal, format, Reckoning, Tribunal, and Judgment execution persist the native XState snapshot plus a typed cursor and are adopted without a coordinate allowlist.
- R3 Games MCP revealed-facts expansion: superseded by the existing `read_round_facts` plus dedicated `read_game_brief`, `read_jury_breakdown`, `read_player_game_summary`, and `read_game_turning_points` surfaces with subject/producer isolation tests.
- R6 server-side web data loading boundary: implemented by `packages/web/src/lib/server-api.ts` and the server-loaded Highlights/metadata routes, with auth-free public fetch, timeout, initial-render, and social metadata tests.
- R7 retryable terminal game settlement: implemented and later absorbed into durable terminal adoption. The final logical turn seals canonical completion authority plus a held viewer publication; one atomic, idempotent settlement writes results, competition awards, ratings, profile/account counters, transcript, postgame initialization, owner closure, and publication release. A normal reload adopts terminal execution under a fresh owner and automatically completes a transiently interrupted settlement without replaying gameplay. Deterministic evidence conflicts become `repair_required`; authenticated audited admin redrive remains an exceptional operator path rather than the normal reload mechanism. DB-backed tests cover failure capture, exact-once concurrency, rollback/repair, authorization, audit outcomes, safe producer reads, crash-after-capture adoption, and zero-event startup.
- R9 atomic draft-avatar adoption: implemented by `652934ae` with DB-backed invalid-profile, cross-owner, concurrent-adoption, and rollback coverage across profile, revision, and avatar-lineage writes.
- W2 viewer-safe watch stream split: implemented. Websocket connect resolves slug/UUID, sends persisted `GameWatchState`, uses an explicit viewer-safe payload, filters private huddles, and leaves fill/admin mutation on HTTP routes.
- W11 delayed huddle outcome reveal: superseded by the later decision to use immediate public alliance inspection plus completed-game Alliance Arcs; a separate delayed-reveal system was deliberately not adopted.
- W17 legacy Agent Profile and House-name cleanup: implemented by `528d2858`. The repair migration resolves normalized/House-name conflicts, preserves frozen historical seats, updates only unfrozen waiting-seat snapshots, and installs database uniqueness/reserved-name authority.
- W5 horizontal scaling locks/pub-sub: consolidated into D1 multi-process execution ownership and observer delivery.
- W16 render-worker portability: consolidated into W13 postgame media scale-out and runtime portability.
- Transcript and token recovery: current transcript rows and provider accounting commit independently of historical checkpoint cursors; startup loads the logical-turn transcript frontier and terminal settlement reconstructs usage from durable provider attempts.
- Cognitive artifact policy module: already implemented as `packages/api/src/services/cognitive-artifact-policy.ts` with writer/read-model/API/MCP tests.
- Production Game MCP raw trace ranged reads: already implemented with ranged private-storage reads, `maxBytes` response caps, truncation metadata, tests, and docs.
- Historical Whisper compatibility/backfill cleanup: not a coherent current ask.
- Local simulation import into deployed durable data: superseded by R1. The right direction is API-backed local execution, not import.
- Broad projection cache infrastructure: too broad without performance evidence or another concrete consumer.
- MCP OAuth platform hardening: future platform work, not current refactor debt.
- Global local bridge OAuth V0: superseded by production HTTP MCP/OAuth and current `/mcp` plus `/mcp/producer` boundaries.
- Dashboard mission control, MCP setup cards, and post-game improvement loop: product/UI work, not refactor backlog.
- Relationship edges, promises, deals, receipt graphs, and rich selected-agent dossiers: needs product requirements and game-design decisions first.
- Indexed/search dashboards over strategy artifacts: needs repeated search or review pain first.
- Historical/old-game cognitive artifact backfill: old games should return clear no-capture results instead of reconstructing artifacts from producer traces.
- Accusation Capsule V1 / full accumulator resume slice: implemented in the current branch. `tribunal_defense` now recovers from a structured `currentAccusations` accumulator payload sealed to the checkpoint boundary, with DB-backed recovery coverage.
- Public upload presigner type cleanup: implemented in the current branch. `@influence/api` owns aligned AWS S3 SDK dependencies, and `packages/api/src/lib/storage.ts` calls `getSignedUrl` without `as any` or lint suppression.
- Broad public DTO package: unnecessary right now; use targeted public-surface builders and sentinel tests.
- Dashboard redesign, MCP install pages, MatchWatchShell chrome, post-vote Mingle drama, exposed-candidate rule changes, and purely presentational House narration upgrades: product/UX/gameplay work, not refactor backlog unless a fresh implementation bug appears. The selective-fact/cost architecture required for phase-cadence House summaries is tracked separately as R21.

`Crash-Honesty Extraction` does not survive as a standalone backlog item. Its completed coverage is recorded under R2; its remaining public-replay and multi-process concerns are W3 and D1.
