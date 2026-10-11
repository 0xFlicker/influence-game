---
title: Game retrospectives implementation tasks
type: feat
status: in_progress
date: 2026-10-10
parent: 2026-10-10-003-feat-game-retrospectives.md
research: ../research/2026-10-10-game-retrospectives-research.md
---

# Game retrospectives implementation tasks

The agreed design makes retrospective completion the final boundary of the existing game execution. This document turns the [high-level plan](2026-10-10-003-feat-game-retrospectives.md) and [source research](../research/2026-10-10-game-retrospectives-research.md) into ordered implementation tasks. Implementation is authorized on `codex/game-retrospectives`, through RT-03. Its contracts and proof are recorded in the [contract document](../game-retrospective-contract.md), [context compiler guide](../game-retrospective-context.md) and [invocation guide](../game-retrospective-invocation.md). Live provider trials, historical generation and deployment remain outside this work.

## Locked direction and planning defaults

- The existing engine runners and game-worker execute the feature. There is no additional worker, queue, or deployment.
- Outcome facts become immutable before the retrospective. Operational `games.status` remains `in_progress` until the retrospective finishes, then ordinary terminal settlement changes it to `completed`. A stalled run may be `suspended` while retaining an established outcome.
- Results are available from validated canonical outcome evidence before final settlement. Retrospective speech never decides winners, placements, factions, or game eligibility.
- Every original contestant gets complete chronological postgame context. Influence speaks in exit order, with nonwinning finalists next and winner last. Werewolf speaks in death order, followed by a survivor permutation frozen once.
- Each statement commits before the next request. Influence receives all earlier accepted speeches verbatim. Use the same behavior for Werewolf as the proposed default from the high-level plan.
- Use an exact dedicated speech contract and the same game-effective provider manifest. Reuse introduction visuals, not the gameplay introduction prompt.
- Completion settlement, ratings/rewards, learning entitlements, final cost capture, transcript sealing, full-export readiness, and automatic downstream postgame work occur after the epilogue. This deliberately avoids a second settlement system. Exhausted speech failure suspends that completion until explicit recovery.
- First delivery covers fresh game runs. Historical backfill and replacement of accepted statements are excluded. Read paths never generate content.

Implementation uses the chat's existing clean worktree at `/Users/user/.codex/worktrees/b44a/influence-game`, on `codex/game-retrospectives` based on the Studio branch's committed revision. The active development checkout and its uncommitted Studio work remain untouched.

## Task ledger and dependencies

| Task | Deliverable | Depends on | Status |
| --- | --- | --- | --- |
| RT-01 | Final boundary, event, input-storage and provider contracts | Research | Done |
| RT-02 | Complete frozen context and speaker order | RT-01 | Done |
| RT-03 | Strict final-statement invocation and deterministic fixtures | RT-01, RT-02 | Done |
| RT-04 | Influence durable retrospective turns | RT-01–03 | Todo |
| RT-05 | Werewolf validated retrospective stage | RT-01–03 | Todo |
| RT-06 | Existing runtime and settlement final boundary | RT-04, RT-05 | Todo |
| RT-07 | Early canonical results and continued delivery | RT-04–06 | Todo |
| RT-08 | Recovery, failure, drain and cost accounting | RT-04–07 | Todo |
| RT-09 | Shared API/MCP inspection and producer recovery | RT-07, RT-08 | Todo |
| RT-10 | Introduction-style replay epilogue for both games | RT-07, RT-09 | Todo |
| RT-11 | Studio provenance and ordinary speech selection | RT-06, RT-10 | Todo |
| RT-12 | Frozen export, recordings and renderer parity | RT-11 | Todo |
| RT-13 | Local/API simulations and local MCP artifacts | RT-04–08 | Todo |
| RT-14 | Integrated regression proof and documentation | RT-09–13 | Todo |
| RT-15 | Review, model-quality and deployment acceptance | RT-14 | Todo |

Build and prove an Influence vertical path through outcome → statements → terminal using fixtures first, then bring Werewolf to the same boundary with its own authority. Complete both before release. Do not deploy intermediate code that closes ownership at the outcome while later tasks assume it remains active.

## RT-01 — Define the final boundary and exact contracts

**Owns:** engine phase/cursor/event contracts, shared retrospective types, API storage contract and completion proof shape.

Define a small shared retrospective definition and statement request: original outcome source, complete contestant order, context hash/version, actor and ordinal, exact earlier-statement references/hash, and bounded speech result. Canonical start/accepted/completed records live in each game's existing event vocabulary. Their projections own progress; there is no independent mutable statement queue.

Choose the exact Influence cursor and machine transition into the epilogue. Define Werewolf's explicit post-result stage so its reducer can validate those events while continuing to forbid gameplay actions after an outcome. Treat its existing result marker as outcome evidence; it no longer closes the API execution. The final retrospective record must prove every original contestant has exactly one accepted statement in the frozen order.

Finalize one immutable private input row per game for the bounded dossier and coverage, keyed to the original outcome boundary/hash. Keep actor order and accepted text authoritative in canonical history. Store request slots/progress through the existing turn/execution mechanisms. Add only the SQL constraints/indexes needed for this contract; select a migration slot after inspecting the current Drizzle ledger. Determine required contract/schema version changes before changing writers; no permissive decoder or prose reconstruction.

**Done when:** fixtures reject duplicate/missing/foreign actors, changed input/order hashes, statements before outcome or after completion, skipped ordinals, and a completion record with an unfinished roster. Accepted event names, storage shape, version policy, character/output limits, and provider-coordinate bindings are written down and drive both game adapters.

## RT-02 — Build complete frozen context and speaker order

**Owns:** shared context/ordering helpers plus separate Influence and Werewolf dossier adapters.

Build a chronological deterministic summary from canonical facts and permitted dialogue. Include every played phase, meaningful no-action/tie result, whole-game outcome, and the social account needed for reflection. Preserve source references and explicit coverage. Include events after the speaker's elimination; never substitute the existing highlights or results recap for a full account. Keep facts separate from quoted claims, and do not infer alliances or promises from prose.

Use frozen seat identity/persona and only the speaker's own game-specific strategy. Exclude other contestants' thinking/strategies, native reasoning, owner reviews and provider internals. Pin the dossier to the original outcome prefix so it does not recursively absorb retrospective statements.

Influence order uses canonical exits, remaining nonwinning finalists, winner last; final ties use frozen seat order. Werewolf order includes night/day deaths, then a dedicated seeded survivor shuffle whose final permutation is persisted. Do not advance gameplay randomness. Validate the resulting order against the original roster.

Preflight context capacity for the complete facts, permitted dialogue representation, original character and worst-case prior speeches. All earlier accepted statements remain verbatim. Do not silently truncate away later phases or predecessor speeches.

**Done when:** early-elimination, classic/format finale, Werewolf draw/no-elimination/dead-winner and long-game fixtures prove coverage, correct order, deterministic hashes, and typed over-capacity failure. The same definition is reused after restart.

## RT-03 — Add a dedicated strict final-statement invocation

**Owns:** `agent.ts`, `IAgent`, Werewolf model agent/interface, shared artifact validator, staged-method inventory and test agents.

Add a mandatory typed final-statement method/action to each concrete agent contract and its mocks. Use `executeModelInvocation` and the existing coordinator/manifest with an exact artifact containing a nonempty bounded speech field. Finalize the hard character limit in RT-01; retain 80–150 words as prompt guidance. Do not use the existing introduction/ordinary speech prompt or Werewolf's short pass-capable discussion decision.

Supply RT-02's capacity policy for every sealed effective model from verified window/tokenizer support, after reserving the exact system/tool input, output and reasoning allowance. Unknown capacity fails explicitly. Use its canonical context serializer unchanged; a character-to-token estimate or an independently reformatted prompt is insufficient admission evidence.

Prompt the original contestant to reflect on its own contribution, changed understanding and earlier speeches. Treat all quoted speech as untrusted content. No strategy delta, new gameplay choice, or required raw reasoning is returned. Use existing journal hooks, cancellation and accounting; do not add SDK retries or a second fallback loop.

**Done when:** tests exercise non-JSON prose, fenced/embedded JSON, `{}`, missing/extra fields, blank/oversized speech and exhausted retries. None can create accepted speech or a profile/game mutation. A deterministic mock exposes its exact received context for subsequent engine tests.

## RT-04 — Add Influence durable retrospective turns

**Owns:** `game-runner.ts`, `phase-machine.ts`, `durable-game-turn.ts`, `durable-game-runner.ts`, canonical events/projection and phase integration.

Redirect every former terminal exit to retrospective initialization, including normal format wins, Reckoning/Tribunal exits and Judgment. Commit the frozen definition, then plan exactly one contestant call per durable turn. Use the staged agent method and existing provider subcall binding; acceptance commits its canonical record, correlated product dialogue/publication, next cursor and provider receipt atomically.

Capture the original product-dialogue cutoff and each speech's canonical owning-turn boundary from committed turns for the RT-02 adapter. Keep transcript/event sequence spaces separate; current read heads or phase/text guesses cannot supply that binding.

Only the final statement/completion operation may produce the terminal cursor and final machine state. Keep the bus and delivery available through the epilogue. Restore all original contestants for request construction without making eliminated players eligible for gameplay again.

**Done when:** a provider-free durable game reaches an immutable outcome, commits every statement in order and then terminates. Speaker N receives the exact committed prefix; restoring at each slot does not repeat prior turns, change the order or emit an early completion publication.

## RT-05 — Add Werewolf's validated retrospective stage

**Owns:** Werewolf types/rules/runner/agent observation and event/turn validation.

Replace the immediate stop-on-outcome with the explicit epilogue from RT-01. Preserve Werewolf's outcome, roles, alive set, seeded opening cursor and gameplay history. Only legal retrospective initialization, next statement acceptance and completion can follow the result. The statement contract is separate from ordinary speech and target decisions.

Prepare each exact request/context hash before dispatch. Extend `assertWerewolfProviderTurn` to validate its frozen postgame slot rather than bypassing current journaling checks. Preserve one canonical accept per slot and let the public history traversal expose accepted speeches after the result.

**Done when:** village/wolf wins, dead winners, draws and no-elimination cases traverse the frozen order. The reducer rejects renewed hunts/votes, altered outcomes/order, foreign actors and out-of-order speeches. Accepted-response recovery works at the first and final slots without a second provider dispatch.

## RT-06 — Move existing runtime completion and settlement

**Owns:** `game-lifecycle.ts`, `durable-game-terminal.ts`, completion settlement, Werewolf store/runtime, canonical-head publication and downstream completion hooks.

Keep the catalog active, owner heartbeat and original runtime through the epilogue. In Werewolf, replace store completion/closure on `next.outcome` with the new finished-execution predicate and make outcome-with-unfinished-retrospective adoptable. In Influence, retain API settlement after the runner's new terminal return.

Final settlement must validate the retrospective completion proof and final event/head hashes, while deriving the competitive result from its original outcome. Seal the complete product dialogue and provider cost once. Move Werewolf queueing of Cuts/media and audit all other completion-triggered work so it executes at the new final boundary. Do not create an early results row that conflicts with existing settlement checks.

**Done when:** outcome alone cannot settle or close an owner; the final epilogue commit/settlement does. Duplicate final handling cannot duplicate rewards, ratings, learning entitlement, final rows or postgame jobs. PostgreSQL proofs cover commit-before-settlement restart and transient settlement retry against the new final head.

## RT-07 — Expose canonical results before execution finishes

**Owns:** completed/shared results services/routes, watch-state/summary/projection, House inspection, publication DTOs, result links and lifecycle action copy.

Replace status-only result availability with validated canonical outcome availability. Return both the outcome source and explicit execution/retrospective status; preserve the historical prefix chosen by a replay reader. Update Influence's settlement-safe projection hold so an accepted outcome can be shown before the epilogue, without treating incomplete votes or an invalid event log as final.

Keep the `completion` publication and `game_over` at final settlement. Result rendering and transport completion become distinct. A viewer at the outcome can continue or wait for committed statements; reconnect and polling must remain active.

Audit suspended/cancelled copy and controls. An epilogue failure must not say no winner was declared. Post-outcome stop/repair operations cannot cancel or recompute the accepted competitive outcome; expose pause/recovery of the continuation explicitly.

**Done when:** API/web/MCP fixtures show the outcome during the retrospective and during a retrospective suspension; pending, corrupt or pre-outcome games cannot claim results. Earlier Mystery/Influence replay prefixes contain no future outcome or speech. Result publication cannot close live observation.

## RT-08 — Prove recovery, failures, drain and accounting

**Owns:** owner/adoption/recovery services, provider journal/failure read model, worker drain and cost reporting.

Reuse existing owner epochs and startup adoption. Retrospective cursors must remain normal recoverable active states. A planned request with accepted provider value replays that value; a stale owner cannot accept it. Exhausted required-statement failure checkpoints the failed slot, suspends/releases the run through a typed path, and never lets automatic restart repeatedly spend on the same exhausted call. Explicit authorized recovery resumes that slot with unchanged inputs and prefix.

Keep active ownership included in drain until final completion or checkpointed suspension; test interruption during the epilogue rather than adding another drain service. Account for one speech call per contestant plus policy retries and the accumulated context. Update existing creation/admission cost estimates and provider call-cap forecasts to include this work, rather than discovering an unbudgeted tail only after the winner is known. Preserve the sealed provider manifest and fallback reservations; use distinct retrospective actions in cost diagnostics and include them in final accounting.

**Done when:** crash/owner tests cover outcome-to-initialization, dispatch-to-journal uncertainty, accepted-result-to-event commit, next-slot preparation, final commit-to-settlement and provider circuit/spend exhaustion. The guarantees distinguish exactly-once accepted local effects from potentially duplicated remote billing.

## RT-09 — Add shared API/MCP reads and producer recovery

**Owns:** shared retrospective read service/route, House MCP contracts/types/generated schemas, authorization/follow-ups and admin recovery control.

Provide bounded `read_game_retrospective` inspection with frozen order, accepted prefix, completeness, safe contestant/result metadata and stable replay URLs. Add typed follow-ups from results/game inspection. Use consistent snapshot heads, cursor bindings, byte bounds and current visibility checks; no dossier or raw provider data escapes.

Update transcript/timeline readers that can represent postgame speeches with explicit phase/purpose. Fix House Werewolf's result-at-tail assertion using validated outcome plus execution-completion proof. Keep local and production game-kind dispatch explicit.

Admin and a producer MCP recovery command call one guarded resume service. A read grant does not permit generation. Define current role/scope plus mutation permission checks, expected failure/head identity and idempotency explicitly; current producer diagnostics are not evidence of a pre-existing mutation tool. No backfill/start workflow or replacement of accepted speeches is added.

**Done when:** actual authenticated MCP HTTP tests prove tools/list and tools/call, strict schemas, oversized/pinned pagination, hidden-game denial, wrong-kind errors, current-role revocation, read-versus-resume separation, and replay-link roundtrips for both games.

## RT-10 — Build the replay epilogue

**Owns:** Influence visual cues/presentation/director, Werewolf watch model/stage, shared transport, result views and stable link helpers.

Add a Retrospective chapter after the readable result cue. Each segment shows the original contestant portrait/name, canonical part/outcome label and accepted speech. Reuse introduction portrait/solo staging; do not replay the opening montage, revive the contestant on the board, or generate additional artwork. Support ordinary nonvisual playback too.

Use the existing clocks, reading pagination, reduced motion and audio transport. Influence links use the accepted event sequence; Werewolf links use its audience-local cursor. Update cue navigation, chapter labels, scrub indices and terminal holds so results are not the final playable stop.

**Done when:** browser proof covers autoplay from results, next/previous, share/reload, backward seek, audience switch, reconnect at a growing tail, preserved pause, full/narrow/fullscreen layouts and missing visuals. Mystery sees the public epilogue only after outcome, without exposing the dossier or earlier private night evidence.

Audit House Cuts/highlight discovery as part of this source boundary: a pre-result Mystery discovery window must exclude postgame speech and cannot use it to label earlier strategy. Omniscient or deliberately ending-spoiler selections retain exact retrospective provenance. Do not automatically append an epilogue to the existing trailer.

## RT-11 — Add Studio provenance and speech selection

**Owns:** game-owned production source services/assemblers, moment catalog and Studio labels/recipes/preview.

Represent retrospective entries as ordinary speech moments with explicit semantic purpose/chapter and canonical actor/source identity. Reuse current speech labels and per-type recipes. Source order places them after result; individual selection and retrospective-only cuts work without implicit result inclusion. No new label store or generic editorial type framework.

Pin accepted history and media in the existing source snapshot. Keep the current completed-game export requirement; a running/failed epilogue is available through watch/inspection/recovery, not a newly introduced incomplete-export mode. Audit source hashing and phase ordering for a valid tail after END/result.

**Done when:** both-game catalogs contain each accepted speech once, ordinary label rules select it, thought/speech independence holds, and snapshots/privacy/provenance reject foreign or future references. Current unfinished Studio work is accommodated without reverting it.

## RT-12 — Freeze and export the complete epilogue

**Owns:** replay-export source/compiler/manifest/cues/audio/recordings, shared sampled frame and CLI verification.

New full exports render gameplay → result → all retrospective statements. Reuse the Studio compiler and portrait treatment, existing timings/music/ducking and optional local recordings. Selected cuts contain only explicit source-ordered IDs; result inclusion remains independent. Export itself performs no model or media generation.

Pin exact text, IDs, source heads, portraits, media versions and recording hashes in the current descriptor/bundle. Ensure any contract update fails clearly for obsolete data rather than adding a fallback decoder. Later labels or published artwork cannot silently alter an already reviewed selection. Existing completed games lacking captured statements report that absence; no retroactive generation or implicit source expansion occurs.

**Done when:** verify full and retrospective-only outputs, result-to-epilogue ranges, captions/readability, selected timing, recording identity/alignment, offline bundles and arbitrary-frame parity for both games. No epilogue result padding is inserted between every player, and a frozen export cannot grow with later source changes.

## RT-13 — Extend simulations and local inspection

**Owns:** Influence/Werewolf local and API simulators, reports, fixtures and local game MCP discovery/read adapters.

Run the same engine stage in local simulations and API-backed runs. Persist the definition, accepted records, provider/cost diagnostics and final boundary in the owning game artifact format. Chatty output makes context coverage, actor/ordinal and accepted final speech inspectable without publishing private reasoning.

The local MCP reader currently assumes Influence canonical event/projection artifacts. Add explicit Werewolf artifact identity and a concrete read adapter as needed; never run Werewolf events through that reducer or infer game kind from dialogue. Give both games stable source references and bounded retrospective inspection.

**Done when:** deterministic local/API fixtures produce the same order and speech semantics, failures remain typed, existing result metrics retain their meaning, and simulation/local MCP traversal includes the complete epilogue. Any real LM Studio/provider quality run remains a separately authorized validation action.

## RT-14 — Complete integrated proof and docs

**Owns:** cross-layer fixtures, API/browser/export acceptance evidence and current product/operations docs.

Exercise one classic Influence, one format Influence, and Werewolf faction/draw fixtures through canonical outcome, full statement sequence, settlement, public/API/MCP read, replay, Studio selection and encoded export. Test a failure in the middle of the sequence, its recovery and repeated final handling. Keep exact expected speeches so context and renderer assertions do not depend on paid models.

Update `CONCEPTS.md`, Werewolf/House watch/results docs, Production Studio/export guide, MCP OAuth/tool docs and operational recovery/accounting guidance. Changes to prompts/transcripts/simulation formatting update reasoning observability, local-model examples, relevant README/DEVELOPMENT examples and `simulate.ts` JSDoc. Keep no `as any` and direct House calls explicit. Record new solutions only from actual implementation findings.

**Done when:** `bun run test`, `bun run test:postgres`, `bun run check`, classified deterministic browser lanes and targeted encoded-export verification pass with recorded results. Shared DB tests call `setupTestDB()` and remain sequential; browser DBs/children are isolated and cleaned. Browser harnesses sharing `.next/e2e` run sequentially. No required CI lane receives provider or external-write credentials.

## RT-15 — Review and accept the delivered feature

**Owns:** final code review, operator experience acceptance, separately scoped model-quality/staging evidence and release notes.

Review final-boundary integrity, strict output handling, disclosure, API/MCP contracts and frozen exports. Use available Grok review when applicable; Claude Code is not authenticated. Treat network restrictions as a transport issue and follow the repository's authorized private-egress review instructions if needed. Resolve actionable findings before claiming readiness.

With separate authorization, inspect real model statements for whole-game accuracy, character voice, reactions to priors, repetition and episode length. Deterministic correctness alone does not prove watchability. Staging then verifies real game-worker continuation/recovery/drain, web/MCP delivery and export preparation for both games. Production keeps its manual deployment approval; do not treat local proof as live acceptance.

**Done when:** acceptance evidence distinguishes local deterministic, model/provider, staging and production states. All unfinished implementation/review items remain visible, and the delivered behavior matches the agreed final boundary.

## Planning review and completion record

The planning pass checked the following failure scenarios against the tasks:

| Scenario | Required protection |
| --- | --- |
| Winner event commits, process exits before first statement | RT-04–08: initialization frontier is recoverable, with no early owner closure or result-side-effect replay. |
| Werewolf reload has an outcome but the tail is unfinished | RT-05–08: valid adoptable epilogue, no “corrupt active catalog” rejection. |
| Provider response is accepted, event commit fails | RT-03–08: replay the accepted value and fence local acceptance. |
| Second contestant speaks before the first commits | RT-04/05: strict ordinal and prior-prefix hash; no concurrent dispatch. |
| MCP reads a completed Werewolf with speeches after the result | RT-09: completed-history validation no longer assumes result-at-tail. |
| A paused epilogue loses its winner in the UI | RT-07/10: canonical outcome availability separate from operational status. |
| An epilogue leaks into an earlier Mystery frame or cut | RT-07/09–12: prefix projection and explicit postgame disclosure. |
| Final accounting omits statement costs or credits twice | RT-06/08: one final capture/settlement and existing journals. |
| A cut silently acquires another speech or new media | RT-11/12: exact source heads, selected IDs and pinned media. |

Research and task planning are complete. RT-01 now makes the event/storage/version decisions concrete; no remaining task requires an additional worker design.

RT-01 is implemented on 2026-10-10. The [contract document](../game-retrospective-contract.md) defines the exact records, cursor, input/storage, speech bounds, provider bindings and version policy. Both game adapters validate a complete epilogue without changing outcome facts; the runtime still stops at the existing result boundary. RT-02 and RT-03 add context/order and invocation layers below; runtime wiring remains subsequent work.

Local verification:

- `bun run test`: 2,483 passed, 5 existing skips, 0 failures across 260 files.
- `bun run test:postgres`: 1,984 passed, 0 failures across 172 files, using a fresh task-specific local database because the shared database has a pre-existing migration/table mismatch.
- Final durable API adoption/commit checks: 28 passed, 0 failures across 3 files.
- Final immutable-input migration/storage checks: 2 passed, 0 failures, including explicit rejection of JSON-null game kinds. The complete migration chain applied from scratch.
- `bun run check`: typecheck and lint passed. Release migration policy accepted migration 0114; whitespace and relative documentation links passed.

A read-only single-turn Grok review was attempted with editing, web search and subagents disabled. It returned no review findings within five minutes and was stopped; this is incomplete external review, not a clean review result. Final integrated review remains RT-15.

These checks are deterministic local evidence. They do not establish live model quality, staging behavior, MCP delivery, replay or export acceptance.

## RT-02 completion record

RT-02 is implemented on 2026-10-10. The [context compiler guide](../game-retrospective-context.md) records the separate Influence/Werewolf canonical accounts, exact untrusted dialogue sources, frozen original characters, game-specific speaker order and complete verbatim predecessor context. Early exits receive the full original outcome prefix; private cognition and other contestants' strategies stay out of the dossier. Committed definitions are reused on restart, and source/order drift fails clearly.

Capacity admission covers every original speaker and effective primary/fallback model, including worst-case earlier speeches, without truncation. RT-03 must supply verified provider-derived input ceilings after system/tool/output/reasoning reservations. RT-04 must supply Influence's original product-dialogue cutoff and canonical owning-turn anchors from committed turn boundaries. These are explicit integration requirements, not guessed windows or reconstructed transcript facts.

Local verification:

- `bun run test`: 2,496 passed, 5 existing skips, 0 failures across 261 files.
- Final focused retrospective contract/context checks: 20 passed, 0 failures across 2 files, including exact formal-speech correlation drift rejection.
- `bun run test:postgres`: 1,985 passed, 0 failures across 172 files, using a fresh task-specific local database. The shared database's pre-existing migration/table mismatch was left untouched.
- Final immutable-input storage checks: 3 passed, 0 failures, including an exact compiled-context JSONB roundtrip with Unicode/whitespace, source references and no cognition.
- `bun run check`: typecheck and lint passed. Whitespace and relative documentation links passed.

A read-only single-turn Grok review was attempted with editing, web search and subagents disabled. It returned no review within seven minutes and was stopped; external review remains incomplete. This is not a clean review result. Final integrated review remains RT-15.

At RT-02 completion, runners, simulations and settlement still ended at the existing result boundary. RT-03 adds invocation below; these deterministic local checks do not establish provider quality, runtime continuation, staging, MCP, replay or export acceptance.

## RT-03 completion record

RT-03 is implemented on 2026-10-10. It adds mandatory typed final-statement methods to both concrete agent contracts and their deterministic agents. The [invocation guide](../game-retrospective-invocation.md) records the dedicated postgame prompt, exact `{speech}` native artifact, unchanged canonical context, verified capacity policy and existing provider journal/retry/cancellation/accounting path. Accepted replay validates the context and speech without counting or generating remotely. Staged Influence speech retains its planned durable subcall and bypasses scene generation. No strategy, gameplay or profile mutation occurs.

Capacity policy covers every sealed primary/fallback catalog ID. The six hosted OpenAI models use documented exact input/context limits, native fixed-prefix token counting and a conservative UTF-8 byte bound, with output/reasoning reserved. Unverified model/profile routes fail explicitly. RT-04/05 must supply this policy to RT-02's whole-roster initialization preflight, then call the new methods; these drivers remain unimplemented.

Focused deterministic proof covers non-JSON, fenced/embedded JSON, empty/missing/extra fields, blank/null/oversized Unicode speech, bounded retry exhaustion, fallback admission, cancellation, context drift, exact frozen self/prior text, no mutation, accepted replay without transport, usage and planned staging. Custom endpoints cannot borrow hosted OpenAI limits. Caller cancellation retains its reason; an internal native-count deadline produces typed capacity failure.

Local verification:

- `bun run test`: 2,529 passed, 5 existing skips, 0 failures across 262 files. The initial sandbox run could not bind loopback fixture servers; rerunning with local network access passed.
- Final focused retrospective contract/context/invocation, provider adapter/execution and visual-boundary checks: 117 passed, 0 failures across 6 files, including all 34 retrospective invocation tests and the final internal-deadline proof.
- `bun run test:postgres`: 1,985 passed, 0 failures across 172 files, on a fresh disposable local database. The shared database was left untouched; the disposable database was removed after the suite exited.
- `bun run check`: typecheck and lint passed. Whitespace and relative documentation links passed.

A read-only single-turn Grok review was attempted outside the sandbox with tools, web search and subagents disabled. It returned no review after more than three minutes and was stopped. This is incomplete external review, not a clean review result; final integrated review remains RT-15.

Current runners, simulations and settlement still end at the competitive result. RT-04 onward remains unimplemented. These checks are deterministic local evidence, not live provider quality, deployed runtime, MCP, replay or export acceptance.
