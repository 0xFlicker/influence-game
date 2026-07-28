# Prompt Thread Context Evaluation

The real-thread evaluator is a producer-operated, private experiment for comparing two context-builder revisions against the same materialized game situation. It is deliberately separate from `packages/engine/src/prompt-scenario-lab.ts`: the existing scenario lab remains the fast, fake-provider structural check, while this workflow adds real source fidelity, threaded continuation, revision isolation, provider accounting, and blind human review.

The first case is the four-turn Finn → Lyra → Finn → Lyra Mingle thread from `vast-azure-surge`. Canonical events remain game-state authority. Checkpoint data, typed transcript and continuity artifacts, and complete private traces reconstruct the model-facing situation. The evaluator never resumes or mutates the source game.

This document establishes the safety and lifecycle contract. The U1 tooling does not dispatch a provider request. Provider-capable commands must preserve every gate below when they are added.

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

Every process handshake reports the protocol version, schema hash, canonicalizer identifier and version, sorted capability set, and non-variant harness digest. Unknown protocol majors, schema or canonicalizer drift, missing or changed capabilities, and harness mismatch fail before private data or broker access crosses the revision boundary.

Canonical hashing sorts object keys but does not rewrite strings or invent defaults. Non-finite numbers, `undefined`, `bigint`, sparse arrays, class instances, and cycles are rejected. Approval receipts bind the complete canonical manifest hash plus the displayed call and spend caps. Changing a case, card, revision, runtime policy, cache lineage, control, rate mapping, execution order, call cap, or spend cap makes the old approval stale.

## Private workspace boundary

The operator must supply an explicit absolute private root. The root must resolve outside every Git worktree reported by `git worktree list`; a path inside a checkout is rejected. Workspace and artifact paths are realpath-checked, traversal is rejected, and no artifact path may cross a symlink below the private root.

Directories use owner-only mode `0700`; artifact, journal, and lock files use `0600`. Reads reject permissive modes, symlinks, partial JSON, unknown schema versions, and schema-invalid artifacts. JSON writes use a same-directory temporary file, file `fsync`, atomic rename, and directory `fsync`. Atomic rename prevents partial files; it is not the concurrency lock.

Materialization writes into a private temporary directory. Only a fully validated source artifact tree is promoted to `cases/<sha256>` by atomic rename. Validation failure removes the temporary tree. Frozen case directories are immutable and addressed by the canonical content hash.

Raw prompts, private dialogue, reasoning, provider output, source identifiers, blind mappings, and approval receipts are private artifact data. Ordinary JSON status and logs may emit only lifecycle state, paths, hashes, aggregate counts, reserved and settled spend, and next actions. An explicit local inspection action is the only place raw private content may be rendered.

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
2. emit a content-free reason and aggregate spend summary outside the private run directory;
3. remove the entire private run directory while the OS mutation lock is held;
4. produce no blind packet, unblinding action, or partial report.

Starting again requires a new run identity, fresh cache lineages, a new manifest, and a new approval. Completed valuable runs remain private until the producer explicitly purges them; purge is allowed only after every cell is terminal.

## Operator checklist

Before any future curator or panel command can dispatch:

- source and protocol fingerprints match;
- the human-approved evidence card hash is current;
- both revision handshakes agree on protocol, canonicalizer, capabilities, and non-variant harness;
- case, schedule, policy, action surface, runtime, model snapshot, rate mapping, cache lineages, and caps match the manifest;
- the correct interactive approval matches the exact manifest;
- maximum calls and spend remain available;
- one OS mutation lock is held and no more than one request can be in flight.

If any item differs, stop before provider access. There is no automatic retry, provider fallback, approval reuse, partial result, or “close enough” replay mode.
