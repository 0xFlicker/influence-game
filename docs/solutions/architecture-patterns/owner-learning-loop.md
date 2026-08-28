---
title: Owner Learning Loop
date: 2026-08-04
category: architecture-patterns
module: owner learning and agent profile revisions
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "bringing postgame strategic review to Agent owners in web and MCP"
  - "running bounded model analysis over canonical game facts and authorized narrative context"
  - "applying a generated Agent strategy update without creating a second mutation authority"
  - "accounting for model cost and recommendation acceptance without copying private content into telemetry"
tags:
  - owner-learning
  - daily-free
  - agent-revisions
  - postgame-analysis
  - mcp
  - durable-worker
  - cost-accounting
  - admin
related_components:
  - database
  - frontend
  - assistant
  - testing_framework
---

# Owner Learning Loop

## Context

Owners who use only the Influence web app need the same basic improvement loop that an experienced MCP user can already assemble: see what their Agent did, understand what the room did in response, inspect strategically important dialogue and owned cognition, and make a focused update. The feature is explicitly for Agent owners. Producers and administrators retain their established source-inspection tools, but they are not the target user and the loop does not become a global tuning harness.

The approved visual acceptance authority is [Owner Learning Loop Visual Acceptance Reference](../../ideation/2026-08-03-owner-learning-loop-design.md), including the entry, deliberately useful waiting state, and ready-state film-room frames. The live implementation may adapt to real data and responsive constraints, but it should preserve that editorial evidence-first hierarchy rather than become a chat window or generic progress card.

## Product and authority contract

V2 admits completed Daily Free games from the active strategy family. The pure `ownerLearningGameEligibilityPolicy` is the change seam for later widening; custom, experimental, imported, incomplete, and unrelated historical revisions do not enter by accident.

An owner has a maximum metered balance of one review credit. The published balance is actionable: `1` means a review can start now, while `0` carries `nextAvailableAt` when time is the only remaining condition. A qualifying Daily Free completion can earn an empty credit, several completions cannot stack it, and the owner may spend it on any owned Agent Profile with selectable games. Persisted sysops receive explicit unlimited mode with no numeric balance and do not consume credit. One review selects one to three distinct games from that Profile's current strategy family: the active analytical revision or a game-effective `runtime_policy_change` revision derived directly from it. Reusing a previously analyzed game is allowed and labeled. Starting metered analysis reprojects under the locked transaction, requires the analysis track and ordered source hash/capture identity to match the read-only preflight, then atomically consumes the credit through the latest then-visible qualifying completion, materializes that verified live projection, establishes the next purchase time, and creates the owner-wide singleton plus evidence joins. Model-free preflight, deterministic facts, awaiting-evidence, generation-disabled results, rejected admission, and a source mismatch during admission never commit materialized evidence.

Deterministic game-evidence rows are versioned by source capture version and source hash, so a later authorized source snapshot coexists with the earlier immutable row. The worker reprojects before model work. If the source changed after admission but no logical call or checkpoint progress exists, it atomically rebinds the review-game joins to the newly materialized version under the active lease. If the purchased analysis track changed, or any logical-call work already exists, it fails the review closed and non-retryably with `evidence_unavailable` before another provider call instead of combining checkpoints produced from different source snapshots. Any reclaimed reserved or safely resumable dispatched call is terminalized in that same failure transaction; already succeeded receipts remain immutable.

Canonical events and postgame projections answer what happened. The evidence snapshot includes accepted actions by and against the reviewed Agent, outcomes, placement, stable moment coordinates, availability diagnostics, and source hashes. Authorized dialogue and the reviewed owned Agent's cognition add strategic context. They remain untrusted prose and never become board-state authority. Another owned Agent's cognition and every opponent's cognition stay outside the owner-learning subject lane.

One or two thin round-one/two eliminations return awaiting evidence with no paid review. Exactly three selected games that all end in round one or two enter Strategy Health Check. Every recommendation on that track must use an observed cross-game pattern, an exact prompt-guidance defect with a named rubric category, or both; separate observation, interpretation, guidance, and exact target; and avoid causal elimination claims.

## Durable review lifecycle

One owner may have at most one unresolved review, regardless of Agent Profile or whether web or MCP started it. The review has a stable ID and canonical web URL. Web and MCP list/read the same persisted DTO, so closing one client never strands the work.

The web waiting state loads the full owner-authorized evidence DTO once, then polls a lean owner-authorized lifecycle status. Unchanged heartbeats retain the existing React state, while terminal status triggers one full refetch for the validated result. This keeps the deterministic facts visible while avoiding repeated evidence reads and transfers during model work.

Starting buys the review. Owners cannot cancel, and a provider failure does not refund the original metered credit or rolling interval. Each unresolved failed review has exactly one owner recovery that consumes no additional credit. Recovery preserves the checkpoint, prior successful logical turns, every attempt and accounting receipt, and the original failure diagnostic. Every successful logical-call attempt atomically stores the fully validated checkpoint that consumed its receipt. A failed logical turn is retried at the same ordinal as attempt 2, so turn 4 never becomes logical call 5. A complete checkpoint includes the exact final result and proposal fingerprint, so recovery after the fourth response replays finalization locally without another provider transmission. A ready owner may:

- apply only the exact persisted `strategyStyle` proposal and proposal fingerprint;
- open the ordinary editor with a same-Profile `sourceReviewId`, producing a normal Agent mutation and the `manual_update` resolution without accepting the generated proposal;
- keep the current strategy, producing `declined`;
- accept an automatic `no_change` result without an Agent mutation.

A failed review may be retried once when its classification and checkpoint are recoverable and the reviewed revision is still current, or closed as `failed`. Malformed output, output-budget exhaustion, retryable provider failure, worker interruption, and recoverable internal failures qualify. Evidence/revision drift, tier mismatch, logical-call exhaustion, and nonretryable provider failures do not. Retry, close, and Profile-update races serialize under the review lock. Duplicate retry requests while queued or running return the same review without consuming the one recovery again. An unrelated effective-input update to the same Profile creates the normal analytical revision and resolves the old review as `superseded`; presentation-only edits do not. Terminal resolution unblocks the singleton. The unique application row is the sole authority for `applied` and accepted recommendation IDs.

## Bounded review harness

The worker uses `openai:gpt-5.6-luna`, low reasoning effort, `store: false`, a deterministic 32,000 estimated-input-token limit over the complete serialized request plus schema/envelope allowance, and at most 8,000 total output tokens inclusive of reasoning and visible output. One review has at most four logical calls and three moment dives. Every request includes the reviewed current strategy and remaining logical-call budget. The fourth call also carries the complete bounded review evidence and uses a non-null final-result schema so a stateless final dive can judge the current guidance and finish the review.

The provider protocol is intentionally smaller than the durable evidence model. Each selected game receives a short alias and each game summary or retained moment receives a deterministic provider-only handle. The model sees those handles inline with bounded canonical facts and retained narrative excerpts; it never receives the duplicated full candidate-ID and evidence-ref inventories. The server retains the complete handle catalog, validates that returned handles were visible in that call, and hydrates them back to stable moment IDs and full evidence refs before checkpoint or result persistence. Web, REST, and MCP continue to expose only the authoritative full refs.

The final provider proposal contains only `{ after }`. The model never supplies the fixed field name or duplicates the reviewed `before` value. After strict validation, the server constructs `{ field: "strategyStyle", before: reviewedRevision.strategyInstructions, after }`, rejects a non-change, then mints recommendation IDs and the proposal fingerprint from that server-authored value. Provider-turn protocol versions live on each append-only attempt; historical review policy/version fields are not rewritten during recovery.

The canonical action core is kernel-aware. Classic games carry empower/expose, Power, and Council actions; format-kernel games additionally carry each accepted format ballot with round, format, target, and Save-or-Eliminate polarity. The web review and model provider context consume that same ledger, so a format action never has to be recovered from strategy prose or represented as a missing classic expose target.

Persisted reviews remain frozen. The v2 evidence contract applies to newly created reviews; older v1 reviews are not backfilled and omit unavailable format-ballot subtext instead of fabricating it.

Every valid one-to-three-game selection fits by construction under the unchanged 32,000-token ceiling. The builder always retains every game and its bounded canonical core, preserves minimum available authority-lane and opening/middle/endgame coverage, then fills remaining space by priority with deterministic game-and-round-bucket balancing. If even the mandatory core is unusually large, it degrades moment bodies to typed metadata and canonical facts to summaries before dropping any selected game. Variable narrative fields are bounded and omission/truncation counts are explicit. Request size is therefore an internal invariant rather than a user-selectable failure mode.

Later turns retain all accumulated validated findings that can exist within the four-call harness, rather than only the first call's findings. A moment dive carries round-focused canonical facts and its small surrounding narrative window; the full multi-game evidence is included separately only when the turn requires it. This keeps targeted dives useful without paying again for unrelated canonical rounds.

Recommendation proof is a Strategy Health Check contract, not an evidence-rich contract. The unified strict provider schema carries a nullable proof slot, but evidence-rich result normalization discards any non-null proof metadata before persistence. Strategy Health Check results continue to require and validate proof kind, rubric when applicable, and cross-game support for observed-pattern claims.

Every logical call is reserved before provider I/O. It begins on Flex and may make at most three total Flex transmissions when each terminal response is HTTP 429. Only then may the identical request make one `auto` transmission. A later logical call begins on Flex again. The SDK has no automatic retry. Dispatch intent, each terminal transport outcome, tier transition, backoff, usage, and safe failure state are durable so restart recovery never guesses whether an unmatched dispatch spent money. When the latest call is safely resumable, the worker reconstructs the harness from the completed-call counters so it reproduces that reserved ordinal, request schema, and input-policy hash rather than consuming another slot. If a deployment changed that identity, recovery fails the persisted call before provider transmission; an explicit retry may use the next lifetime slot when one remains.

`invalid_structured_output` is legal only in `output_validation` after a provider response receipt and byte-complete sanitized response evidence have been durably staged. The call row stages the exact credential-scrubbed request before provider dispatch, appends raw HTTP envelopes at the transport boundary before SDK parsing, and stages the decoded provider result before worker validation. A reclaimed lease revalidates a staged result locally instead of issuing a duplicate paid request. Hydration and validation failures keep their usage/cost receipt, provider IDs, raw response, decoded value when available, typed validation code/path, and exact error chain. Unexpected selection, projection, materialization, reservation, checkpoint, finalization, or database exceptions are `internal_error`, never model-output failures.

The worker records its exact execution phase and appends a compact `review_failed` diagnostic with one correlation ID, safe/internal code, bounded message, first application frame, fingerprint, attempt coordinates, provider IDs, and review-scoped manifest state. In the same transaction it stages the complete credential-scrubbed diagnostic envelope in a durable outbox. Only credentials, authorization headers, cookies, secret URL components, and configured secret values are redacted; owner-authorized strategy, evidence, dialogue, cognition, provider output, transport receipts, usage/cost, checkpoint, and protocol values remain intact with a redaction report. Object storage reconciliation is indefinite and deletes the outbox body only after the deterministic private object and manifest are linked. A diagnostic persistence failure rolls back terminalization rather than committing a misleading failed review.

Application logs carry the same diagnostic ID and manifest pointer plus the sanitized exception/cause chain. Database parameter bodies are replaced in logs because they may duplicate prompts, checkpoints, or responses; their complete sanitized values remain in the private envelope.

Call cost is captured once from its effective tier as actual, estimated, or unavailable. Admin totals sum those immutable receipts and never reprice history. Cached input, input, total output, reasoning, and derived visible output remain separate. An ambiguous or missing receipt remains unknown rather than becoming a zero-cost call.

## MCP parity

There are eight Owner Learning tools on the production `/mcp` resource:

1. `list_learning_review_inputs`
2. `list_open_learning_reviews`
3. `preflight_learning_review`
4. `start_or_resume_learning_review`
5. `read_learning_review`
6. `retry_learning_review`
7. `apply_learning_review`
8. `resolve_learning_review`

Reads require `agents:read` plus `games:read`. The exact-selection preflight is read-only, does not materialize evidence or write any owner-learning table, and returns the same model-free evidence preview as web before purchase. Paid/mutating tools additionally require `agents:write`; their catalog baseline remains the two reads so clients can perform a narrow step-up. A producer role alone grants none of these owner-subject tools. Generated strings are marked `untrusted_model_generated`, and executable follow-ups come only from validated server-minted refs. MCP does not need a web URL: review IDs and the shared singleton model provide continuity in either direction.

Exact apply and review-linked custom `update_agent` both require the assistant to present the exact before/after change and obtain a fresh affirmative user message immediately before mutation. The server enforces ownership, fingerprint, Profile identity, and revision freshness; it does not accept a client boolean pretending to prove conversational consent.

## Analytics and admin contract

Owning transactions emit narrow typed events for prompt impressions/dismissals, start/track/credit, persisted stages, capacity fallback, failure/retry, recommendation view, manual-editor handoff, MCP offer/connection, apply, supersede, and resolution. Event payloads are closed and bounded. Ordinary lifecycle events are content-free; `review_failed` contains only credential-scrubbed diagnostic metadata and a private manifest pointer. No event contains dialogue, cognition, prompts, provider responses, recommendation prose, or arbitrary exception bodies.

The existing `view_admin` area exposes a Reviews ledger with filters for date, track, diagnosis, status, model, resolution, and acceptance. List/detail responses use an explicit column allowlist. They include owner/Profile/revision identity, policies, lifecycle phase, retry lineage, append-only logical-call attempts, immutable usage/cost receipts, failure code/fingerprint, diagnostic ID, and evidence state.

Raw failure evidence is available only from `GET /api/admin/owner-learning-reviews/:reviewId/diagnostics/:diagnosticId/content`. Every read refreshes the caller's current database roles and requires `admin` or `sysop`; a stale token cannot preserve revoked access. Allowed, denied, unavailable, integrity, and storage outcomes are audited. Responses are `private, no-store`, bounded to one MiB per range, include exact hash/length metadata and canonical base64 range bytes, and distinguish pending, degraded, stored, and honest `legacy_unavailable` evidence. The base64 representation keeps multibyte content byte-exact across chunk boundaries; the admin UI decodes the full byte stream for copy/download and renders only escaped inert text for previews. Owner REST, web DTOs, and production MCP never receive diagnostic metadata or raw evidence.

`manual_update` means review-driven action but not generated-proposal acceptance. `declined`, `failed`, and `superseded` are not accepted. `no_change` is not applicable. Only a unique application row marks the exact proposal and its immutable recommendation IDs accepted.

Later performance is observational. Competition receipts stamp the exact `agentRevisionId` that played; the admin query joins only Daily Free receipts on that executed revision after the review/application boundary. Labels say correlation, not causal proof, and manual-update/supersede cases show no later-result attribution when no trustworthy resulting revision was persisted.

## Deployment and operations runbook

Live model generation is on by default when the deployment configures:

```text
OPENAI_API_KEY=<configured secret>
```

When OpenAI rejects a review request or local processing fails, the worker emits a credential-scrubbed correlated exception record with diagnostic ID, phase, fingerprint, and manifest pointer. Prompts and request/response bodies are not duplicated into application logs; the complete sanitized request, raw HTTP/provider response or error envelope, decoded output, validation details, receipts, checkpoint, protocol, stack, and cause chain are retained in the review-scoped private envelope. Provider-controlled values are data and are never interpreted as log directives, HTML, Markdown, or links.

The provider credential is required for paid admission and worker startup. Set `INFLUENCE_OWNER_LEARNING_GENERATION_DISABLED=true` to disable live generation. There is no per-review live operator allowance, staged operator approval, or intermediate production deployment. Before deploying with live generation available, run the complete automated/browser/cross-surface gates and one explicitly approved frozen paid quality case. Evaluate evidence faithfulness, recommendation usefulness and restraint, non-causal framing, latency, token/cache behavior, capacity path, and sourced cost. Do not run a paid case without explicit approval.

Predeployment integrity checks should prove:

- no owner has more than one unresolved review or two paid starts inside 24 hours;
- review game joins contain one to three distinct completed Daily Free games owned by the review owner, on the reviewed revision;
- entitlement completion watermarks are monotonic;
- lifetime call/dive counters match their durable rows and do not exceed four/three;
- at most one unexpired worker lease exists globally;
- review cost totals equal immutable call receipts, with unavailable calls still unavailable;
- every `invalid_structured_output` failure links one observed provider response receipt and one pending/stored/degraded review-scoped manifest;
- attempts are unique by review/logical ordinal/attempt ordinal, at most one attempt per logical ordinal succeeded, and owner retry count is zero or one;
- pending failure-evidence outbox rows retain their exact body indefinitely, and the `content/owner-learning-reviews/` object prefix has no expiry lifecycle rule;
- every application matches its review, proposal fingerprint, accepted recommendation IDs, and prior/resulting revisions;
- review events and cost rows contain only their safe typed/numeric fields.

Operational diagnosis order:

1. Confirm the disable flag and provider credential; disabled generation should leave deterministic input/evidence reads healthy and reject new paid admission before row creation.
2. Inspect the admin review lifecycle phase, safe/internal code, diagnostic fingerprint, manifest state, append-only attempt lineage, tier path, provider IDs, token receipt, and cost provenance.
3. Open the bounded diagnostic content only as a current admin/sysop. If evidence is pending or degraded, inspect the durable outbox and reconciliation error; never delete the outbox or original attempt.
4. Retry only when the owner DTO reports one recovery remaining. Never delete ambiguous calls, reset counters, replace attempt 1, or consume a second credit to force a replay.
5. For content quality, compare the retained provider response with the reviewed server-owned strategy value and server-minted evidence refs. Treat every retained provider byte as untrusted data.
6. During an incident, redeploy with `INFLUENCE_OWNER_LEARNING_GENERATION_DISABLED=true`. Keep deterministic reads, existing review reads, applications, resolutions, and admin diagnosis available. Do not down-migrate populated review tables or delete purchased reviews.

The worker is globally single-concurrency across enabled replicas. A resolved running review retains its exact lease as a lane fence while the owning worker unwinds; other replicas count that unexpired fence as active. Each worker polls authoritative lease state during provider work and aborts its local request/backoff controller when superseded or when its lease is lost. The exact worker clears its fence in `finally`; a crashed worker releases the global lane through normal lease expiry. Shutdown first stops accepting requests and new claims, then waits for the active worker and graceful server close together. A repeated signal or the 10-second deadline force-closes remaining connections.
