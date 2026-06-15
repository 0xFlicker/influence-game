---
date: 2026-06-15
topic: private-trace-writer-mcp
---

# Private Trace Writer and Local Trace MCP Requirements

## Summary

API-backed Influence games should gain a first shipping slice for private trace capture and local producer inspection. The API records private trace content for agent decision calls, stores only manifest pointers and sanitized counts in Postgres/read models, and exposes a local-dev Trace MCP for inspecting one durable run at a time.

---

## Problem Frame

Influence agent quality depends on understanding why agents made watchable or confusing social decisions. The repo already treats hidden `thinking`, native `reasoningContext`, prompts, model responses, and agent-turn records as private producer evidence rather than public dialogue or canonical game truth.

The durable kernel and read model now have private evidence manifest tables, summary-only durable-run output, and access checks, but they do not yet write raw trace content to private storage. The current MCP is useful for local simulation artifacts, but it does not inspect API/Postgres durable runs or private trace content.

This slice should make one weird API-backed game inspectable in local development without pretending there is a production-ready MCP auth flow, packaged MCP distribution, or web admin surface.

---

## Key Decisions

- **Decision-call capture first.** V1 captures agent decision calls, not every model call, so the trace corpus starts with high-signal decisions instead of helper-call noise.
- **Local-dev Trace MCP first.** The MCP is a local producer/debug tool until the project commits to MCP auth login, packaging, and a product/admin API surface.
- **Run-scoped inspection first.** The first useful workflow is inspecting one durable run, listing its manifests, reading trace content, and searching traces inside that run.
- **Manifest/content split.** Manifests are the DB index; `read_content` returns the raw JSON/JSONL trace payload for a selected manifest.
- **Strategy packets are linked evidence.** Decision traces may reference strategy packets used by the agent, but strategy packets are not public transcript, canonical board truth, or resume authority.

---

## Actors

- A1. Producer or developer debugging one local durable run.
- A2. API game runner emitting agent decision calls.
- A3. Private trace writer storing raw trace content and manifest metadata.
- A4. Local Trace MCP exposing read-only producer tools.
- A5. Durable-run read model exposing public-safe summaries.
- A6. Future product/admin MCP or web UI, deferred from this slice.

---

## Requirements

**Private Trace Capture**

- R1. The API must capture private trace content for agent decision calls that explain player, House, or producer decisions.
- R2. A decision trace must include the full prompt, raw model response, emitted `thinking`, native `reasoningContext`, tool arguments, action name, actor, phase, round, owner epoch, and canonical event boundary when those values exist.
- R3. A decision trace that uses a strategy packet must include a reference or compact usage summary for that packet without turning the strategy packet into public dialogue or canonical game truth.
- R4. Raw trace content must be written to the configured private trace storage as bounded JSON or JSONL content.
- R5. Postgres and durable read models must store only manifest metadata, private storage pointers, integrity/count metadata, source pointers, and searchable facets.
- R6. Public/player-visible surfaces and durable-run summaries must not expose raw prompts, raw model responses, `thinking`, `reasoningContext`, tool arguments, private storage keys, or private source-pointer internals.
- R7. Trace capture failures must surface as diagnostics or degraded evidence state without corrupting canonical game progress.

**Local Trace MCP**

- R8. The v1 Trace MCP must be local-dev-only and must not claim production MCP auth, product/admin API readiness, or packaged distribution.
- R9. The Trace MCP must let a producer inspect one durable run, list its manifests, read trace content for a selected manifest, and search reasoning traces within that run.
- R10. `list_manifests` must present the manifest index for one run with enough actor, action, phase, round, boundary, count, and timing information to choose relevant content.
- R11. `read_content` must return the raw JSON/JSONL trace payload for a selected manifest through the same producer-only access assumptions as manifest reads.
- R12. `search_reasoning_traces` must use manifest metadata to find relevant trace files and return matching trace records with manifest identity and content position.
- R13. Trace MCP output must stay bounded enough for local debugging sessions and model context, even when the underlying trace content is large.

**Boundaries and Compatibility**

- R14. Durable viewer catch-up, public observable cursors, and websocket client changes are deferred from this slice.
- R15. Phase-boundary packets, XState/runtime snapshots, and checkpoint hydration inputs are deferred unless planning proves the trace writer needs a minimal index packet.
- R16. The existing local simulation MCP should remain usable while the local Trace MCP adds API durable-run inspection.
- R17. Local development must provide a local S3-compatible private evidence endpoint for trace validation, while staging/prod use Linode Object Storage through the same env-shaped writer/read path; v1 needs a small local writer/read smoke, not a broad local/staging/prod parity harness.

---

## Key Flows

- F1. Agent decision trace is captured
  - **Trigger:** An API-backed game receives an agent or House decision response.
  - **Actors:** A2, A3
  - **Steps:** The runner hands the decision evidence to the private trace writer; the writer stores bounded trace content and records a manifest with pointer/count/boundary metadata.
  - **Outcome:** The private decision trace is available for producer inspection without entering public transcript or canonical game truth.
  - **Covered by:** R1-R7

- F2. Producer inspects one durable run locally
  - **Trigger:** A local producer wants to debug a weird or promising game.
  - **Actors:** A1, A4, A5
  - **Steps:** The producer lists durable runs, inspects one run, lists manifests, and selects a trace to read.
  - **Outcome:** The producer can inspect the raw trace content behind that run's decisions.
  - **Covered by:** R8-R11, R13

- F3. Producer searches within one run
  - **Trigger:** A producer wants to find reasoning about an actor, action, phase, round, or decision.
  - **Actors:** A1, A4
  - **Steps:** The Trace MCP narrows by manifest metadata, reads matching trace content, and returns matching records with manifest identity and content position.
  - **Outcome:** The producer finds relevant trace records without a cross-run search system.
  - **Covered by:** R9, R10, R12, R13

- F4. Public-safe surfaces stay private-safe
  - **Trigger:** A viewer, durable-run summary, or public-ish read model is requested.
  - **Actors:** A5
  - **Steps:** The read path returns public-safe transcript/projection/evidence summaries and excludes raw trace content and private reasoning fields.
  - **Outcome:** Producer trace capture does not leak hidden reasoning to viewers or canonical state consumers.
  - **Covered by:** R5, R6, R14

---

## Acceptance Examples

- AE1. Covers R1-R6.
  - **Given:** An agent decision call produces a prompt, raw response, `thinking`, `reasoningContext`, tool arguments, and action metadata.
  - **When:** the private trace writer records the decision.
  - **Then:** raw trace content is stored privately and the durable read model exposes only manifest/count metadata.

- AE2. Covers R3.
  - **Given:** A decision was made using a strategy packet.
  - **When:** the decision trace is read through the local Trace MCP.
  - **Then:** the trace identifies the strategy packet reference or usage summary without treating the packet as public transcript or canonical truth.

- AE3. Covers R8-R11.
  - **Given:** A local durable run has private trace manifests.
  - **When:** a producer uses the local Trace MCP to inspect that run.
  - **Then:** the producer can list manifests and read raw content for a selected manifest.

- AE4. Covers R12, R13.
  - **Given:** A run has many decision traces.
  - **When:** a producer searches reasoning traces for one actor or action.
  - **Then:** the MCP returns bounded matching trace records with manifest identity and content position.

- AE5. Covers R6, R14.
  - **Given:** a public viewer or durable-run summary reads game state.
  - **When:** private traces exist for that game.
  - **Then:** the response excludes raw prompts, raw responses, `thinking`, `reasoningContext`, tool arguments, private storage keys, and private source-pointer internals.

- AE6. Covers R7, R17.
  - **Given:** the configured private storage path fails during local smoke verification.
  - **When:** a decision trace write is attempted.
  - **Then:** the run reports degraded evidence diagnostics rather than treating trace storage as canonical game failure.

---

## Success Criteria

- A producer can inspect one local durable run and read the private trace content behind agent decisions.
- Agent decision traces include enough prompt, response, reasoning, action, actor, phase, round, and boundary context to debug social strategy quality.
- Durable-run summaries and public surfaces continue to expose only sanitized evidence counts or public-safe state.
- The local Trace MCP improves local model and game-quality debugging without implying production MCP auth or web-admin readiness.
- The v1 slice remains small enough that durable viewer catch-up and broad model-call observability can be planned separately.

---

## Scope Boundaries

In scope:

- Private trace capture for agent decision calls.
- Manifest metadata and sanitized counts in Postgres/read models.
- Private JSON/JSONL trace content in configured private storage.
- Strategy packet references or compact usage summaries inside decision traces.
- Local-dev Trace MCP tools for one-run inspection, manifest listing, content reads, and run-scoped trace search.
- Small smoke/auth/audit checks that support the writer and local MCP.

Out of scope:

- Capturing every model call.
- Cross-run trace search.
- Durable viewer catch-up cursor and websocket client catch-up changes.
- Product/admin web UI.
- MCP auth login and releasable MCP packaging.
- Phase-boundary packets unless planning proves a minimal index packet is necessary.
- XState/runtime snapshots, checkpoint hydration, or resume behavior.
- Enterprise-style storage parity or chain-of-custody programs.

---

## Dependencies and Assumptions

- The durable game-run kernel and durable-run read model remain the API-side foundation for run identity and summaries.
- Existing manifest and evidence-access concepts remain the right policy boundary for private producer evidence.
- The first MCP can rely on local admin/producer development assumptions rather than production authentication.
- Local private storage configuration can be exercised without introducing a full environment parity test suite.

---

## Outstanding Questions

Resolve before planning:

- None.

Deferred to planning:

- Exact trace envelope versioning and content segmentation.
- Exact local Trace MCP command/package shape.
- Whether the first writer needs a minimal phase-boundary index packet for navigation.
- Exact bounded-output defaults for `read_content` and `search_reasoning_traces`.

---

## Sources

- `AGENTS.md`
- `CONCEPTS.md`
- `docs/ideation/2026-06-15-private-evidence-mcp-catchup-ideation.html`
- `docs/brainstorms/2026-06-13-durable-game-run-kernel-requirements.md`
- `docs/brainstorms/2026-06-14-durable-event-read-model-requirements.md`
- `packages/api/src/db/schema.ts`
- `packages/api/src/services/game-evidence.ts`
- `packages/api/src/services/evidence-access.ts`
- `packages/api/src/services/game-durable-run.ts`
- `packages/api/src/services/ws-manager.ts`
- `packages/api/src/services/game-lifecycle.ts`
- `packages/api/src/routes/games.ts`
- `packages/engine/src/game-mcp/server.ts`
