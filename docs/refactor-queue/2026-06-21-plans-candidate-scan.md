# Influence docs/plans Refactor Candidate Scan

Generated: 2026-06-21
Scope: `docs/plans/**/*.md` only
Method: harvest deferred/out-of-scope/risk/rejected-alternative signals, deduplicate into candidate themes, then ask the five queue questions.

Five questions:

1. Is this still true?
2. Is there a concrete code seam?
3. Is there a validation path?
4. Is it product-relevant now?
5. Is it smaller than "rewrite the system"?

Status legend:

- `ready`: good queue candidate now.
- `blocked`: real, but needs another prerequisite first.

## Candidates

### C1. Phase-boundary resume spike

- Sources: `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:95-102`, `docs/plans/2026-06-14-002-feat-checkpoint-hydration-passport-plan.md:495-503`, `docs/plans/2026-06-14-003-feat-phase-boundary-runtime-snapshot-plan.md:277-285`
- Signal: `GameRunner.fromCheckpoint()`, owner reclaim, restart orchestration, and production resume controls are deferred; current evidence is inspectable, not resumable.
- Q1 still true? Yes. Active game execution is still not crash-safe.
- Q2 concrete seam? Yes: `GameRunner`, durable checkpoints, runtime snapshot/passport validators, owner epochs, game lifecycle.
- Q3 validation path? Yes: kill/restart smoke around a phase boundary, plus checkpoint fixture hydration tests.
- Q4 product-relevant now? High. User pain is games dying on restart.
- Q5 smaller than rewrite? Yes only if scoped as a spike/happy path from a safe boundary; no if it attempts full mid-phase or in-flight LLM-call resume.
- Queue status: `ready`.
- Suggested slice: phase-boundary-only spike, behind explicit test/dev affordance.

### C2. Transcript/token cursor sealing for resume

- Sources: `docs/plans/2026-06-14-003-feat-phase-boundary-runtime-snapshot-plan.md:271-284`, `docs/plans/2026-06-14-002-feat-checkpoint-hydration-passport-plan.md:497-503`
- Signal: token cursor, transcript watermark, and transcript persistence remain prerequisites for honest checkpoint hydration.
- Q1 still true? Likely yes. Plans identify these as resume blockers.
- Q2 concrete seam? Yes: token tracker, transcript persistence, runtime snapshot payload, checkpoint validator.
- Q3 validation path? Yes: checkpoint passport tests where missing cursor evidence blocks candidacy, plus live durable inspection smoke.
- Q4 product-relevant now? High as a prerequisite to restart survival.
- Q5 smaller than rewrite? Yes if split into cursor-evidence sealing rather than whole resume.
- Queue status: `ready`.
- Suggested slice: prove a phase-boundary checkpoint has transcript/token cursor evidence, not resume.

### C3. Owner reclaim and restart orchestration

- Sources: `docs/plans/2026-06-14-003-feat-phase-boundary-runtime-snapshot-plan.md:277-285`, `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:474-482`
- Signal: a future process must reacquire an interrupted run and decide whether continuation is allowed.
- Q1 still true? Yes.
- Q2 concrete seam? Yes: game owner rows, heartbeat/lease handling, startup orphan logic, durable-run inspection, lifecycle start/continue code.
- Q3 validation path? Yes: owner-expiry tests, startup orphan tests, and later restart-orchestrator tests.
- Q4 product-relevant now? High, but only after a minimal hydration target exists.
- Q5 smaller than rewrite? Medium. Owner reclaim alone is not useful unless paired with a continuation boundary.
- Queue status: `blocked`.
- Blocker: needs C1 or an equivalent checkpoint hydration target.

### C4. Strategy Thread and House packet persistence/hydration

- Sources: `docs/plans/2026-06-12-002-feat-strategy-thread-packet-plan.md:315-320`, `docs/plans/2026-06-13-001-feat-house-strategy-bible-packet-plan.md:419-425`
- Signal: live-run strategy packets and House packets are not persisted/hydrated across process reset.
- Q1 still true? Likely yes.
- Q2 concrete seam? Yes: agent memory/strategy packet state, House interviewer packet state, MemoryStore/checkpoint continuity capsules.
- Q3 validation path? Yes: prompt continuity tests before/after checkpoint hydration, simulation artifacts, and private trace checks.
- Q4 product-relevant now? Medium-high if pursuing resume; medium otherwise.
- Q5 smaller than rewrite? Yes if handled as structured continuity capsules for checkpoint boundaries.
- Queue status: `blocked`.
- Blocker: depends on C1/C2 resume/checkpoint direction.

### C5. Watch summary incremental refresh and repair scheduling

- Sources: `docs/plans/2026-06-20-003-feat-game-watch-state-summaries-plan.md:292-327`, `docs/plans/2026-06-20-002-feat-game-watch-state-plan.md:367-375`
- Signal: summary table exists as list optimization; incremental updates and background stale repair are deferred.
- Q1 still true? Likely yes unless later code already added scheduling.
- Q2 concrete seam? Yes: game watch-state summary service, lifecycle refresh points, backfill/repair command, `GET /api/games`.
- Q3 validation path? Yes: stale-summary tests, idempotent repair tests, route fallback tests.
- Q4 product-relevant now? Medium-high if list performance/staleness is visible; lower if current route is fine.
- Q5 smaller than rewrite? Yes.
- Queue status: `ready`.
- Suggested slice: background repair or incremental refresh, not broad projection cache.

### C6. Games MCP revealed facts expansion

- Sources: `docs/plans/2026-06-19-004-feat-games-mcp-round-facts-plan.md:324-332`
- Signal: `read_round_facts` currently covers standard vote/power/Council; deferred expansion includes endgame/jury revealed facts and possible replay/UI rendering from the same facts payload.
- Q1 still true? Likely yes.
- Q2 concrete seam? Yes: Games MCP read model, round facts builder, canonical event projection, web replay/watch rendering.
- Q3 validation path? Yes: MCP tool tests for public/player-safe facts and absent private source pointers.
- Q4 product-relevant now? Medium-high if AI app compatibility and post-game agent improvement remain active tracks.
- Q5 smaller than rewrite? Yes if one facts family is added at a time.
- Queue status: `ready`.
- Suggested slice: endgame/jury revealed facts or replay UI rendering, not raw event exposure.

### C7. API-backed local run harness replacing standalone simulation/import

- Sources: `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:100-101`, `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:474-482`, `docs/plans/2026-06-19-001-feat-production-game-mcp-http-oauth-plan.md:311-315`
- Signal: older plans imagined importing CLI simulation artifacts into durable API game data. Updated product direction: standalone simulation predates the game and should converge onto the real API-backed execution path instead of preserving a second execution model plus import bridge.
- Q1 still true? Partly. It is still true that standalone simulation and API-backed games are separate worlds, but the desired fix is no longer import.
- Q2 concrete seam? Yes: existing simulation CLI, API game creation/start lifecycle, local API/DB bootstrap, MCP/read-model/watch inspection surfaces, local-model evaluation docs.
- Q3 validation path? Yes: run a local API-backed game through the harness, verify it produces normal durable game data, watch/replay URLs, cognitive artifacts/private traces where configured, and Games MCP/read-model output. Compare against current local simulation workflow before deprecating it.
- Q4 product-relevant now? High if local model/gameplay evaluation should exercise the real product path.
- Q5 smaller than rewrite? Yes if the first slice is a thin harness that drives existing API commands and leaves the old CLI as legacy until parity is proven.
- Queue status: `ready`.
- Suggested slice: add `simulate:api` / local run harness that creates and runs real API games, prints watch/MCP/debug pointers, and treats standalone JSONL simulation as legacy rather than a primary artifact.

### C8. Private evidence retention, purge, and credential rotation

- Sources: `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:474-482`, `docs/plans/2026-06-15-001-feat-private-trace-writer-mcp-plan.md:278-288`
- Signal: exact retention durations, purge automation, raw evidence object storage policy, and credential rotation are deferred.
- Q1 still true? Likely yes.
- Q2 concrete seam? Yes: private trace storage, evidence manifests, storage config, producer/admin access paths.
- Q3 validation path? Yes: purge/redaction tests, non-dereferenceable expired objects, bucket separation tests.
- Q4 product-relevant now? Medium. Important before serious production trace accumulation.
- Q5 smaller than rewrite? Yes if one retention class/purge command is added first.
- Queue status: `ready`.
- Suggested slice: explicit purge/redaction workflow for private trace content, no broad storage redesign.

## Removed During Triage

- Public websocket transcript boundary hardening: already landed on `origin/main` via PR #37.
- Cognitive artifact policy module: already implemented as `packages/api/src/services/cognitive-artifact-policy.ts`.
- Historical Whisper compatibility/backfill cleanup: impossible or low-value unless a fresh current-facing Whisper bug appears.
- Broad projection cache infrastructure: too broad without performance evidence or a second concrete consumer.
- MCP OAuth platform hardening: future platform work, not a refactor queue item right now.
- Indexed search over simulation/private strategy artifacts: needs repeated search failures or slow-archeology evidence first.
- Dashboard post-game improvement loop: product feature direction, not refactor debt.
- Relationship/deal/promise receipt model: needs product requirements first; not yet a refactor candidate.

## Ready Shortlist

1. C1 Phase-boundary resume spike
2. C2 Transcript/token cursor sealing for resume
3. C5 Watch summary incremental refresh and repair scheduling
4. C6 Games MCP revealed facts expansion
5. C7 API-backed local run harness replacing standalone simulation/import
6. C8 Private evidence retention/purge workflow

## Notes

- `Crash-Honesty Extraction` did not survive this triage as a standalone ready candidate. The underlying interruption/resume concerns are better represented by C1, C2, and C3.
- C7 changed meaning after product review: avoid a simulation-import bridge; converge local simulation onto API-backed local game execution instead.
- The remaining entries have concrete seams and tests already named in prior plans. The queue should preserve those source links so future planning does not redo archaeology.
