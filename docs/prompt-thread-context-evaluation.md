# Prompt Thread Context Evaluation

The real-thread evaluator is a producer-operated, local experiment for comparing two context-builder revisions against the same materialized game situation. It is deliberately separate from `packages/engine/src/prompt-scenario-lab.ts`: the existing scenario lab remains the fast, fake-provider structural check, while this workflow adds real source fidelity, threaded continuation, revision isolation, provider accounting, and blind human review.

The first case is the four-turn Finn → Lyra → Finn → Lyra Mingle thread from `vast-azure-surge`. Canonical events remain game-state authority. Checkpoint data, typed transcript and continuity artifacts, and complete decision traces reconstruct the model-facing situation. The evaluator never resumes or mutates the source game.

The tooling is implemented through terminal blind review and report generation. `materialize`, `verify-source`, manual evidence drafting, manifest construction, status, rendering, and report assembly are provider-free. `curate` and `panel-run` are the only provider-capable commands, and each requires its own immutable approval.

## Choose the right evaluation level

| Level | Use it for | It can prove | It cannot prove |
|---|---|---|---|
| Structural fixtures | Fast context-policy and renderer regressions | Deterministic budgets, authority lanes, stable prompt structure, replay mechanics | Real-source fidelity, provider cache reuse, or conversation quality |
| Targeted real-thread experiment | A concrete context-builder decision on one replayable situation | Source fidelity, branch continuity, selection reasons, provider usage/cache evidence, and blind preference for this case | Universal quality, full-game strategy, or a rollout threshold |
| Full-game simulation | Integration and watchability across the game arc | Cross-phase behavior, long-running strategy, fallbacks, pacing, and endgame coherence | Controlled causal attribution to one context change |

Start with fixtures. Use this real-thread workflow when one product decision remains unresolved and a replayable case can reject it. Run a bounded full game only when the remaining question is integration or season-level behavior.

## Proof and spending lanes

There are three separate operator lanes:

| Lane | What it may do | Approval |
|---|---|---|
| Free source validation | Materialize authorized source data, validate hashes, replay recorded outputs, inspect policy deltas, and build manifests | No provider approval and no provider call |
| Curator-paid | Send the complete actor-authorized starting-history catalog to the configured frontier curator and receive a cited card proposal | A curator-specific manifest and interactive approval bound to its exact hash |
| Panel-paid | Run the approved production/candidate panel and cache control through the measured broker | A different run manifest and interactive paid approval bound to its exact hash |

Curator approval never authorizes panel calls, and panel approval never retroactively approves curator work. Tests, builds, type checks, server startup, ordinary status, automatic recovery, and retries must perform zero curator or panel calls. Paid execution is manifest state, not a `--force` or convenience flag.

The evidence card is human-owned. A curator proposal or manual draft remains non-authoritative until the producer reviews, corrects, and freezes it. Blind quality decisions likewise remain human-owned; the evaluator can render the packet and record a confirmed choice, but it cannot infer preference.

## Versioned protocol

`@influence/prompt-lab-protocol` is the dependency-neutral Node/Bun contract shared by the API orchestrator and revision-isolated engine workers. It has no engine or API dependency. Its narrow exports contain:

- discriminated runtime schemas for cases, source receipts, evidence-card drafts and approvals, curator and run manifests and approvals, worker handshakes, prepared requests, provider results, cell transitions, continuation checkpoints, blind packets and keys, decisions, and final reports;
- separate content-free structural summary schemas for ordinary CLI output;
- byte-preserving canonical JSON and SHA-256 helpers;
- frozen golden canonicalizer vectors and a schema hash.

Every process handshake reports the protocol version, schema hash, canonicalizer identifier and version, sorted capability set, non-variant harness digest, recall compiler-policy digest, and action-schema hash. Unknown protocol majors, schema or canonicalizer drift, missing or changed capabilities, harness mismatch, unapproved compiler policy, and action-schema drift fail before source data or broker access crosses the revision boundary.

The baseline and candidate must be clean, immutable experimental checkouts that contain the same evaluator harness. They are not arbitrary `main` and feature checkouts: each needs the worker/protocol surface, while the recall policy under test is the intended variant. Run this from each checkout root:

```bash
bun packages/engine/src/prompt-thread-worker.ts handshake
```

The two handshakes must have the same `harnessDigest` and `actionSchemaHash`. Their `compilerPolicyDigest` values identify the baseline and candidate policies and may differ. The panel `runtimeHash` must equal the attested shared `harnessDigest`; it is not a free-form label. Manifest preflight also resolves each checkout's actual Git SHA and rejects dirty or mismatched revisions. Execution repeats those checks before and during the run.

Canonical hashing sorts object keys but does not rewrite strings or invent defaults. Non-finite numbers, `undefined`, `bigint`, sparse arrays, class instances, and cycles are rejected. Approval receipts bind the complete canonical manifest hash plus the displayed call and spend caps. Changing a case, card, revision, runtime policy, cache lineage, control, rate mapping, execution order, call cap, or spend cap makes the old approval stale.

## Local workspace boundary

The operator must supply an explicit absolute local evaluation root. The root must resolve outside every Git worktree reported by `git worktree list`; a path inside a checkout is rejected. Workspace and artifact paths are realpath-checked, traversal is rejected, and no artifact path may cross a symlink below the evaluation root.

Directories use owner-only mode `0700`; artifact, journal, and lock files use `0600`. Reads reject permissive modes, symlinks, partial JSON, unknown schema versions, and schema-invalid artifacts. JSON writes use a same-directory temporary file, file `fsync`, atomic rename, and directory `fsync`. Atomic rename prevents partial files; it is not the concurrency lock.

Materialization writes into a local temporary directory. Only a fully validated source artifact tree is promoted to `cases/<sha256>` by atomic rename. Validation failure removes the temporary tree. Frozen case directories are immutable and addressed by the canonical content hash.

Raw prompts, room-scoped dialogue, reasoning, provider output, source identifiers, blind mappings, and approval receipts are sensitive evaluation artifacts. Ordinary JSON status and logs may emit only lifecycle state, paths, hashes, aggregate counts, reserved and settled spend, and next actions. An explicit local inspection action is the only place raw content may be rendered.

## Kernel-backed mutation lock

Every run mutation occurs while one local kernel-backed exclusive lock is held. macOS uses `/usr/bin/lockf`; Linux uses `flock` from a fixed system path. Startup fails closed if the platform has no sanctioned adapter.

The lock holder stays alive for the complete mutation callback. A competing process fails instead of proceeding, and the kernel releases the advisory lock if the holder dies. A sentinel file or atomic rename is never treated as lock ownership. Multi-host execution and distributed takeover are unsupported.

Only the orchestrator mutates the workspace. Revision workers return protocol artifacts to the orchestrator; they do not write the journal, claim cells, reserve spend, or invoke the provider directly.

## Durable cell lifecycle

The append-only, `fsync`ed transition journal is authoritative for orchestration state. Per-cell `state.json` files are rebuildable views. A cell advances monotonically:

```text
planned
  -> started
  -> response_recorded
  -> applied
  -> checkpoint_committed
  -> completed
```

`started` is persisted before a request may leave the broker process and is the no-retry boundary. A complete provider result is written and hashed before `response_recorded`. The worker then applies that saved result deterministically. The continuation checkpoint—agent continuity, inbox, transcript, branch board, output, and branch-local prompt/cache state—is written and hashed before `checkpoint_committed`. Only `completed` unlocks a dependent turn.

Recovery actions are determined only from the last durable stage:

| Last stage | Recovery action |
|---|---|
| `planned` | May dispatch once after all manifest and approval hashes are revalidated |
| `started` | Invalidate the entire experiment; never retry this cell |
| `response_recorded` | Reapply the saved response without provider access |
| `applied` | Commit the continuation checkpoint without provider access |
| `checkpoint_committed` | Mark the cell complete |
| `completed` | No action |

Journal sequence gaps, illegal transitions, truncated records, changed saved artifacts, and a started cell without a complete response fail closed. Resume may dispatch only planned cells and only while case, evidence card, revisions, runtime, model, cache lineages, caps, and approval hashes still match.

## Interruptions, invalidation, and cleanup

A clean first Ctrl-C between calls stops with planned cells resumable. During a call it requests stop-after-current: the complete response must first be saved, applied, and checkpointed. A second interrupt, hard process death, timeout, network ambiguity, provider-declared failure, missing response, first-call cache contamination, or fatal branch error invalidates the entire experiment.

Failed, invalidated, and operator-aborted runs:

1. stop dispatch;
2. emit a content-free reason and aggregate spend summary outside the local run directory;
3. remove the entire local run directory while the OS mutation lock is held;
4. produce no blind packet, unblinding action, or partial report.

Starting again requires a new run identity, fresh cache lineages, a new manifest, and a new approval. Completed valuable runs remain local until the producer explicitly purges them; purge is allowed only after every cell is terminal.

## Operator checklist

Before any curator or panel command can dispatch:

- source and protocol fingerprints match;
- the human-approved evidence card hash is current;
- both revision handshakes agree on protocol, canonicalizer, capabilities, non-variant harness, and action schema, while each attests its approved compiler policy;
- case, schedule, policy, action surface, runtime, model snapshot, rate mapping, cache lineages, and caps match the manifest;
- the correct interactive approval matches the exact manifest;
- maximum calls and spend remain available;
- one OS mutation lock is held and no more than one request can be in flight.

If any item differs, stop before provider access. There is no automatic retry, provider fallback, approval reuse, partial result, or “close enough” replay mode.

## Strategic history probe

The two recorded `mingle-intent` prerequisites are real `strategic_decision` calls. A provider-free probe recompiles those two contexts in clean baseline and candidate checkouts, verifies the shared worker harness and action schema, and compares their history selections against the frozen evidence card.

The probe maps each actor to that actor's first scheduled Mingle turn for evidence-card applicability: Finn's intent uses turn 1 labels and Lyra's intent uses turn 2 labels. This keeps the existing human-reviewed citation contract while evaluating the common pre-thread decision boundary.

```bash
bun run prompt-thread:lab -- strategic-probe \
  --workspace "$EVAL_ROOT" \
  --case "$CASE_PATH" \
  --draft evidence/manual-draft.json \
  --evidence-approval evidence/evidence-card-approval.json \
  --baseline-checkout "$BASELINE_CHECKOUT" \
  --baseline-sha "$BASELINE_SHA" \
  --baseline-policy-digest "$BASELINE_POLICY_DIGEST" \
  --candidate-checkout "$CANDIDATE_CHECKOUT" \
  --candidate-sha "$CANDIDATE_SHA" \
  --candidate-policy-digest "$CANDIDATE_POLICY_DIGEST" \
  --harness-digest "$SHARED_HARNESS_DIGEST" \
  --action-schema-hash "$SHARED_ACTION_SCHEMA_HASH"
```

The command writes `probes/strategic-intent-comparison.json` and Markdown. It makes zero provider calls. Its verdict is:

- `improved` when required/useful selection increases without increased distractor selection;
- `regressed` when required/useful selection falls or distractor selection increases;
- `mixed` when scored selection is unchanged;
- `not_exercised` when both policies allocate no history;
- `inconclusive` when the evidence card contains no scored applicable items.

For every approved citation, the probe also records the rank slot, lexical
relevance score, bounded combined ranking score, explicit-target-speaker match,
current-round match, serialized item cost, and terminal reason. These
diagnostics contain stable source IDs and numbers, not dialogue. Use them to
distinguish ranking misses from items that simply cannot fit the approved
reserve.

This proves selection direction for the two real strategic contexts. It does not prove that a model uses the selected evidence well; that requires a separately approved generated-intent or threaded behavior experiment.

## Terminal workflow

All commands run from the repository root:

```bash
bun run prompt-thread:lab -- <command> --workspace /absolute/local/evaluation/root ...
```

The evaluation root must be outside every Git worktree. The typical sequence is:

1. `materialize`, then `verify-source --case cases/<hash>/case.json`. Materialization reads the configured durable DB and trace storage; verification writes `source/source-fidelity.json` without provider access. `panel-manifest` accepts this receipt only by local-workspace path, validates the complete versioned lane/exclusion contract, and binds both the receipt and its canonical hash into the approval target.
2. Create evidence with `manual-draft --case ... --items '<json>'`, or create and separately approve a curator manifest. Only `curate` can dispatch the curator. Review the resulting draft rather than rubber-stamping it.
3. Run `freeze --case ... --draft ... --reviewer ... --confirm` to bind the human-owned evidence card.
4. Run `strategic-probe` to evaluate deterministic history selection for the two real Mingle intents. This step is provider-free and stays separate from the speech panel.
5. Run `panel-manifest` with the source-fidelity path, frozen evidence paths, both checkout paths and SHAs, both compiler-policy digests, the shared harness/runtime digest, action-schema hash, exact model snapshot, Flex service tier assumptions, actor IDs, token ceilings, and maximum spend. The broker injects the approved Flex tier and `store: false`, then rejects a final transformed request whose estimated input or `max_output_tokens` exceeds the approved per-call ceilings.
6. Run `panel-approve --manifest ... --reviewer ... --confirm`, then `panel-init`. Approval does not dispatch. `panel-status` is always provider-free.
7. Run `panel-run` once. After a clean stop between calls, use `panel-resume`; never rerun `panel-run` against a started journal. These are the only panel commands with provider access.
8. Run `blind-init`, `render-blind-packet`, and one confirmed `record-blind-decision` for each opaque pair token. `unblind --confirm` is unavailable until all three decisions are locked.
9. Run `report` for the terminal four-verdict report. Retain valuable completed runs until an explicit confirmed `purge`.

Use verdict scope `cache_quality_only` when the replayed action class has no historical archive lane. A `full` verdict requires history to be enabled and the baseline/candidate compiler policies to differ. If those preconditions are absent, report history as `not_exercised`; do not promote a cache result into a recall-quality claim.

## Provider-free acceptance evidence

On 2026-07-28, the implemented CLI materialized and source-verified the authorized four-turn case against the configured local API database and trace storage. No curator, panel, hosted model, or provider request ran.

- materialized lifecycle: `materialized`
- source manifests: `6`
- source verification lifecycle: `source_verified`
- matched turns: `4`
- source mutation: `false`
- case ID: `sha256:5cc1bc00da94ff15a44e9a09190b257a7f9146ea0ee211b9326200bdeff806d9`
- source receipt hash: `sha256:3e5b1b6e1c63209eb7fed8c14147c46645b5f007c6e7477b09ac1b7ba126a08d`
- canonicalizer: `influence-canonical-json` version `1`
- compared lanes: `9`
- excluded source field: transport-only request metadata

The raw case and source-fidelity artifacts remain in a local directory outside the worktree and are not committed. This proves source fidelity and provider-free orchestration for this case. It does not prove model quality, provider cache reuse, or a rollout decision; those require a separately approved panel and human blind review.
