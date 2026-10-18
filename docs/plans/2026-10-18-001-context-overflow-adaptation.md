---
title: Context-overflow adaptation without losing game continuity
type: refactor
date: 2026-10-18
status: implemented-local-validation
---

# Context-overflow adaptation

## Outcome

A large valid game context must receive context adaptation rather than being rejected by an application size gate or exhausted through unchanged oversized retries. If actual provider execution still exhausts after adaptation, reuse the engine’s existing typed failure and recovery behavior; this refactor does not guarantee provider success. Preserve the same logical decision, authorization scope, canonical boundary and accepted-result replay. Context summaries are disposable model inputs, never game state.

Implementation record (2026-10-18): see [runtime contract and invocation inventory](../context-adaptation.md). The implementation reuses accepted summary child calls to persist derived context rather than adding a parallel revision-document store. Local validation passed: 2,664 provider-free tests (5 skipped), 2,074 PostgreSQL tests, and repository typecheck/lint. A final focused journal/recovery run passed 41 tests. An [initial synthetic real-provider evaluation](../evaluations/2026-10-18-context-compaction.md) now covers Luna/Muse and records GLM unavailability. Broader quality evaluation, observed summary task leakage and deployment remain pending. The following sections retain the design rationale and acceptance requirements. Builders implement the context contract as explicit literal spans of their own rendered values; no adapter parses prompt headings. Provenance is enforced by source and child-call hashes, not model-authored reference IDs. The summary schema validates bounded text only. Each summary receives actor identity, character context and the pending action contract/instructions with historical spans replaced by markers; House calls retain House identity and authorized subject/audience scope. Character context participates in source identity. The implementation rebuilds each revision from the original marked spans and reuses accepted chunk calls on restart; cross-revision incremental summaries are not introduced.

## Pre-implementation source evidence

| Surface | Current behavior | Remaining work |
| --- | --- | --- |
| `packages/engine/src/provider-execution.ts` | No dedicated context-overflow failure kind; unmatched HTTP 4xx becomes nonretryable `request_error`. Manifest traversal can dispatch the same semantic context to another model. | Recognize evidenced overflow, request adaptation, and prohibit repeating a known-rejected request unchanged on the same model. |
| `packages/engine/src/provider-adapters.ts` | Compiles a semantic invocation separately for each runtime/attempt. `ModelInvocation.messages` contains already-rendered strings. | Supply a revisioned context source before compilation; never infer safe-to-remove sections from prompt prose. |
| `packages/engine/src/context-recall-plan.ts` | Existing Influence recall protects board facts, compact strategy, huddle outcomes and current receipts. Protected and active-room lanes can exceed the nominal character envelope; historical recall alone is budgeted. | Reuse these typed lanes; measure protected growth and add explicit policies for compressible history. Do not replace selective recall with generic summarization. |
| `packages/engine/src/werewolf/observation.ts`, `werewolf/agent.ts` | Actor observations and strict action contracts are separate from spectator views. | Adapt actor-authorized history while keeping role knowledge, current board, scheduling and legal decisions exact. |
| `packages/engine/src/retrospective-invocation.ts` | Serializes the full validated frozen account and prior statements. Old size admission is disabled with advisory unbounded budgets. | Build a derived speaker-scoped presentation of the frozen account, preserving its original hash and complete source availability. |
| `packages/api/src/services/provider-call-journal.ts` | Owns attempt reservation, accepted-result fences and per-model retrospective exhaustion across restarts. | Persist context revisions and adaptation progress; an exhausted original context must not bar an adapted request forever. |

The removed 256 KiB retrospective guard must stay removed. The cognitive-artifact writer still has a 256 KiB diagnostic capture limit; Owner Learning and House Cuts have their own editorial/work budgets. Those are distinct from gameplay admission and are not removed wholesale by this work. Upload limits, strict output limits, inspection pagination and corruption checks remain intact.

Prior guidance: [provider authority](../solutions/architecture-patterns/coordinate-provider-attempts-with-durable-fallback-authority.md), [size-suspension incident](../solutions/runtime-errors/retrospective-input-size-suspension.md), and [selective recall design](2026-07-26-003-feat-selective-context-recall-plan.md). The older recall plan is context, not permission to restore obsolete strategy or huddle mechanisms; current typed projections govern implementation.

## Decisions

1. **Application-owned, typed adaptation.** Builders separate the mechanical decision contract from adaptable context before rendering. They do not classify historical facts as universally required or irrelevant. Provider adapters own error decoding and native request compilation; they do not slice strings or decide game relevance.
2. **React to real overflow first.** Keep normal-size calls unchanged. Estimates may prepare a smaller context early but never reject a game. Account for instructions, tool schemas, reserved output and reasoning overhead, not only dialogue characters. Unknown capacity is not a zero budget.
3. **Keep mechanics exact; treat memory quality as empirical.** The current request, legal choices, actor identity, visibility and current board/outcome come directly from typed engine state. These are concrete fields needed to interpret and validate this action, not a claim to know every strategically important fact. Historical facts, dialogue and strategy context can matter in ways we cannot predict. Compaction is lossy; evaluate its quality rather than claiming semantic completeness. Existing protected recall lanes are current policy to review explicitly, not proof that their entire contents must remain verbatim forever.
4. **Compact contextual memory, not the action contract.** Historical events, dialogue and strategy context are candidates, subject to an explicit review of existing retention policy. Preserve source metadata outside the summary and require summary references to resolve within the authorized source set. Evaluate whether the prose preserves attribution and chronology; metadata alone cannot prove it. Prioritize recent exchanges. Keep a source quote exact only where the current action explicitly requires that quote.
5. **Adapt inside the original logical call.** Context revision is attempt metadata, not a new gameplay decision identity. Accepted results replay first, without token counting, adaptation or provider dispatch.
6. **Use only sealed runtime choices.** A fitting permitted model may receive the exact context. Do not silently add a provider, expand the privacy boundary or rewrite a running game's manifest.
7. **Reuse existing exhaustion handling.** Recognized context overflow gets adaptation before terminal handling. If the adapted execution still exhausts its policy, return the typed provider failure to the existing owning phase. Keep its established legal fallback, absence or suspension/recovery behavior. Do not fabricate speech, add a second recovery system or repeatedly send the same oversized request.

## Context contract

Add a small engine-owned `context-adaptation` module, consumed by the existing invocation path. Define a closed policy per supported call family, rather than an arbitrary callback that can rewrite any prompt.

A context source identifies game, actor/House authority, action, canonical boundary, original source hash, builder/policy version, typed mechanical decision fields and authorized contextual blocks. Each historical block carries stable source references. The renderer produces a normal `ModelInvocation`; exact output artifacts and semantic validators remain unchanged across revisions.

Start with these policies:

| Family | Exact mechanical contract | Context whose retention/compaction needs evaluation |
| --- | --- | --- |
| Influence player decisions, speech and reflection | Rules/current Board Contract, legal options, actor identity and active request | Actor strategy, huddle receipts, historical facts and eligible dialogue; review existing protected-lane policy explicitly and prioritize recent exchanges |
| Werewolf actions | Actor role/private knowledge, living roster, legal targets, current vote mode, opening/reply schedule, current request and required quoted contribution | Older actor-visible discussion; never omniscient/watch history substituted for actor observations |
| Retrospective, both games | Frozen input identity/hash, final outcome, roster, speaker identity, predecessor statement identities/order | Speaker strategy, historical events and full-game dialogue; prior statements may be summarized with attribution and their immutable references retained |
| House decisions/narration/interviews | Current scheduling/eligibility/control-flow facts and action-specific exact output contract | Only historical material within that House call's existing authority |

Before implementation, inventory every `executeModelInvocation` caller and any direct coordinator path. Record its policy or an evidenced exclusion in a table beside this plan. Editorial image generation and Owner Learning/House Cuts are separate work unless their failure can directly suspend gameplay. No game-critical caller may remain on an opaque unadaptable string path at closure.

## Adaptation flow

1. Read and validate an already accepted result first.
2. Restore the source manifest and latest accepted context revision for the logical call. Validate hashes, ownership and canonical boundary before dispatch.
3. Compile and reserve the actual request. Journal the request fingerprint, context revision, model and normal attempt accounting.
4. On confirmed context overflow, journal a call-scoped `context_overflow` outcome. Do not open a systemic provider-health circuit or retry that same request on that model.
5. Choose a changed candidate: exact-preserving serialization/deduplication, an exact request on a fitting sealed runtime, or a smaller derived history representation. Record why it changed and which source records were supplied to the compaction operation. A schema/output-limit error is not an input overflow.
6. For model summarization, partition original authorized history at typed record boundaries; split an oversized text record explicitly with linked fragments. Request strict structured summaries of bounded chunks, then bounded merges if needed. Protect exact lanes outside that operation. Record each chunk’s source range in application-owned metadata; validate that model-returned references belong to that range. Processing every source chunk establishes processing coverage, not preservation of every fact in the summary. Chunk overflows reduce the chunk target, not recursively invoke an unbounded adaptation loop.
7. Persist the derived revision before dispatching the action. Recompile native requests from it, including a revision-sensitive prompt-cache key. Keep the original schema, legal choices and semantic acceptance boundary.
8. If the next action still overflows, lower the adaptation target with a recorded monotonic revision or move to another fitting sealed runtime. Within a logical call, do not repeat an identical known-overflowing model/request pair under unchanged capacity settings, including after restart. Unrelated transient-failure retries retain their existing policy.

Strict schemas validate shape; application-owned hashes bind source identity. They cannot prove correct attribution, factual truth, resistance to quoted instructions, or semantic coverage. Evaluate those properties on representative cases and report observed regressions. Preserve originals for reconstruction. Incremental summaries may reuse prior summaries to control cost; record that lineage and rebuild from source when evaluation or detected drift warrants it. Do not require rereading an ever-growing original history on every adaptation.

### Capacity and exhaustion boundary

Do not require an oracle for “all required facts.” We can enumerate the small mechanical contract from the action schema and engine state; we cannot enumerate everything a capable agent might find strategically useful. Measure that contract separately from the growing contextual history. A malformed or unsupported action contract is an engineering defect, not a reason to block compaction behind a hypothetical irreducible history core.

The practical policy is to compact context to fit, retain the original authorized source, and retry the same decision. A smaller context necessarily risks losing nuance. Source references and schema checks prove provenance and structure, not preservation of all useful meaning. Quality evaluation should expose that tradeoff and guide retention priorities; it cannot certify lossless understanding. Larger-model routing is an available option within the sealed manifest, not a prerequisite for solving every theoretical history size.

Adaptation needs bounded spend and monotonic progress, but finite budgets cannot guarantee a successful model response. A provider can remain unavailable, reject even the smaller request, or repeatedly produce invalid summaries. Tests demonstrate supported scenarios; they cannot establish eventual success for every input/provider combination.

Choose concrete revision/chunk and spend limits from the measured corpus, persist them, and test restart enforcement. All paid calls count toward authorized spend. Do not bypass sealed fallback budgets or reset counters to manufacture continuation.

**Terminal behavior already exists.** Reuse it. `retrospective-failure.ts` converts exhausted provider execution into `RetrospectiveExecutionError`; `game-retrospective-recovery.ts` persists the suspended slot and supports explicit recovery. Other phases own their existing legal fallback or typed absence behavior. Adaptation failures enter that same provider-execution path with accurate cause and attempt history. Do not introduce an independent adaptation suspension/recovery workflow.

The implementation task is to fit adaptation attempts into the existing durable budgets and journal so a known-overflowing request can change before terminal handling. Test exhaustion after genuinely attempted adaptation as well as successful continuation. The operator clarified on 2026-10-18 that existing engine exhaustion/suspension remains the terminal policy; the prohibition on size gates is not a promise of unlimited retries or guaranteed inference success.

## Durability and storage

- Add context revision metadata to the existing logical-call/attempt authority, plus a closed semantic coordinate for summary child calls. Child identity includes parent call, source hash, policy version, chunk/range and revision. Summary results never occupy the parent's accepted decision slot.
- Store original/derived context documents and summary bodies through existing private bucket writers with verified hash/length. PostgreSQL stores references, small progress state, policy version, predecessor and request fingerprints. Use `payloadColumn` and extend storage inventory where appropriate.
- Upload and verify before committing a revision reference; enforce the active owner epoch and expected predecessor transactionally. Reconcile orphan uploads using existing storage patterns.
- Resume committed chunk summaries and the latest revision after restart. An uncommitted upload is not authority; a stale owner cannot publish a revision or accept an action.
- Scope retrospective attempt exhaustion to the intended retry/adaptation policy instead of treating the first exhausted context as permanent entry exhaustion. Keep a total durable budget across revisions so restart cannot reset spend.
- Reconstruct an original source from existing frozen inputs/planned observations for an unaccepted call; never change accepted historical values or regenerate canonical history. A change in source hash under the same frozen identity is an integrity error.
- Add `context_overflow` to engine unions, SQL checks, journal/read-model contracts and producer diagnostics together. Do not rewrite applied migrations. Raw prompts and summaries remain private; structural counters alone may be aggregated.

## Delivery sequence

### 1. Measure and settle the contract

- Inventory all gameplay/House/retrospective invocation paths and existing size/attempt gates.
- Use existing prompt-scenario/thread evaluation tooling and deterministic fixtures to measure full context, mechanical-contract and candidate compacted sizes. Include Unicode/escaped JSON, full roster, long active threads, many protected receipts and late retrospective speakers.
- Write the per-family mechanical invariants and memory-quality evaluation criteria; choose target sizing, revision/chunk limits and spend policy. Map adaptation accounting into existing budgets and terminal handlers.
- Exit: each supported family has a concrete context contract, measured request sizes, quality criteria and a mapping to existing terminal behavior. No paid calls or private-data exports are needed for this stage.

### 2. Ship one complete retrospective path locally

- Implement typed overflow classification with adapter-specific observed error fixtures; unknown HTTP 400 remains `request_error`.
- Implement the revisioned coordinator path, private storage and journal recovery hooks, then wire the shared retrospective builder for both games.
- Update the retrospective prompt's claim of receiving the “complete frozen account” to accurately distinguish original account authority from derived context representation. Preserve the original input hash and final outcome.
- Remove obsolete retrospective capacity-admission types/sentinel budgets where no longer needed; retain useful size observability under an honest name.
- Exit: injected overflow → durable adaptation → valid statement → next speaker, including restart and growing prior statements, without suspension or changed game outcome.

### 3. Cover live gameplay and House calls

- Wire Influence recall lanes, Werewolf actor observations, then the enumerated House call families.
- Preserve existing game-specific legal fallback policy for genuine non-size provider failures. Prove recognized overflow first takes the adaptation path and that exhausted adapted execution reaches the existing handler with accurate provenance.
- Exit: every game-critical call has a tested policy; full durable turns continue after injected overflow without duplicate canonical effects.

### 4. Evaluate quality and roll out

- Run required local checks and the deterministic corpus. Evaluate summary fidelity before replacing full context in deployed calls.
- Opt-in provider evaluation uses a small frozen, authorized corpus with scenario-specific facts, commitments and contradictions selected as evaluation probes before comparison; these are test expectations, not a universal classifier of relevance. Compare adapted versus full-context output for meaning and strategic usefulness; token reduction alone is insufficient. No paid/provider evaluation is authorized by this planning request.
- Deploy through normal staging then production approval, with no new feature flag. Verify a staging overflow/recovery exercise and private producer receipts before closure.
- Update the queue, context/recovery docs, storage inventory, model-evaluation examples and reasoning observability docs; update `simulate.ts` JSDoc if its decision/trace surface changes.

## Required tests

- **Classification:** each supported adapter's actual overflow envelope; unrelated 400, rate limit, auth, output truncation and malformed schema remain distinct; overflow never poisons provider health.
- **Request progress:** same rejected model/request fingerprint cannot redispatch; new context revision really reaches transport; output schema and target set unchanged; prompt cache cannot reuse an incompatible revision.
- **Meaning/privacy:** exact mechanical fields preserved; existing protected-lane policy changes evaluated explicitly; evaluated claim versus fact distinction and chronology; source-processing coverage distinguished from semantic retention; late-game commitments and contradictions; actor/House scope isolation; retrospective all-game visibility without other players' strategies; quoted material never grants application permissions; evaluate model behavior under prompt-injection fixtures without claiming immunity.
- **Large valid contexts:** both games, Unicode/escaping, large roster, long threads, protected-overflow recall, prior retrospective statements and oversized individual historical blocks. Successful continuation is the assertion, not size rejection.
- **Summarizer failures:** strict malformed-output matrix, out-of-scope source references, unprocessed source chunks, zero reduction, chunk overflow, output truncation and transport failure. No invalid summary accepted or unbounded recursive retry.
- **Recovery:** crash after failed attempt, after chunk acceptance, after upload/before reference commit, after revision commit/before dispatch, after remote action/before acceptance, and after acceptance/before canonical commit. At most one canonical effect per logical call, and one in successful recovery fixtures; duplicate remote execution/billing remains possible after an indeterminate dispatch. Stable source identity; reuse accepted summaries; stale owners rejected.
- **Accounting:** retrospective exhausted original revision can adapt; total limits survive restart; concurrent workers cannot spend the last unit twice; compatibility/circuit skips cannot create adaptation cycles.
- **Storage:** object integrity, authorized reads, missing/corrupt object handling, orphan reconciliation; no context bodies introduced into SQL payload columns.
- **Regression commands:** `bun run test`, `bun run test:postgres`, `bun run check`; targeted deterministic API recovery tests. Browser tests only for changed producer UI behavior. Live-provider tests remain opt-in.

## Completion criteria

Close the queue entry only after all game-critical callers are covered, representative real and injected overflows adapt successfully, mechanical invariants and agreed quality evaluations pass, existing terminal exhaustion/recovery behavior is tested after adaptation, recovery does not replay oversized requests or duplicate decisions, and staging/production rollout evidence is recorded. A new failure enum, removed byte cap, larger fallback model, or retrospective-only implementation is not closure of the whole item.
