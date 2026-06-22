# Influence Refactor Queue

Generated: 2026-06-21
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
- `blocked`: real, but needs a prerequisite first.
- `future`: coherent, but should not be in the active queue unless the pain becomes visible.
- `closed`: already implemented, superseded, or not a coherent current ask.

## Ready Backlog

### R1. API-backed local run harness replacing standalone simulation

- Status: `ready`
- Consolidates: plans C7, brainstorms B1.
- Sources: `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:100-101`, `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:474-482`, `docs/plans/2026-06-19-001-feat-production-game-mcp-http-oauth-plan.md:311-315`, `docs/brainstorms/2026-06-11-canonical-game-event-spine-requirements.md:72-80`, `docs/brainstorms/2026-06-15-private-trace-writer-mcp-requirements.md:10-20`, `docs/brainstorms/2026-06-18-global-game-mcp-oauth-bridge-requirements.md:16-32`
- Signal: the old simulation CLI predates the API-backed game. Local model/gameplay evaluation should converge onto the real game path instead of preserving a separate execution model or building a simulation-import bridge.
- Concrete seam: simulation CLI, API game creation/start lifecycle, local API/DB bootstrap, watch URLs, durable-run traces, Games MCP/read-model inspection.
- Validation path: run a local API-backed game through the harness; verify normal durable game data, watch/replay URL, private traces/cognitive artifacts where configured, and Games MCP/read-model output.
- Suggested slice: add `simulate:api` or equivalent local run harness that creates and runs real API games and prints watch/MCP/debug pointers. Keep standalone JSONL simulation as legacy until parity is proven.

### R2. Phase-boundary resume proof

- Status: `ready`
- Consolidates: plans C1, brainstorms B2.
- Sources: `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:95-102`, `docs/plans/2026-06-14-002-feat-checkpoint-hydration-passport-plan.md:495-503`, `docs/plans/2026-06-14-003-feat-phase-boundary-runtime-snapshot-plan.md:277-285`, `docs/brainstorms/2026-06-11-canonical-game-event-spine-requirements.md:18-28`, `docs/brainstorms/2026-06-14-checkpoint-hydration-passport-requirements.md:220-241`, `docs/brainstorms/2026-06-14-phase-boundary-runtime-snapshot-requirements.md:220-274`
- Signal: durable events and watch state are inspectable, but active game execution is still not crash-safe. The useful target is a narrow phase-boundary resume proof, not a broad "crash honesty" project.
- Concrete seam: `GameRunner`, durable checkpoints, runtime snapshot/passport validators, phase-boundary checkpoint payloads, game lifecycle.
- Validation path: kill/restart smoke around a safe phase boundary, checkpoint fixture hydration tests, and durable inspection proving the resumed path starts from persisted state.
- Suggested slice: prove one happy-path phase-boundary checkpoint can be resumed in dev/test. Exclude mid-phase, in-flight model call, and arbitrary effect recovery.

### R3. Transcript and token cursor sealing for resume

- Status: `ready`
- Consolidates: plans C2, part of brainstorms B2.
- Sources: `docs/plans/2026-06-14-003-feat-phase-boundary-runtime-snapshot-plan.md:271-284`, `docs/plans/2026-06-14-002-feat-checkpoint-hydration-passport-plan.md:497-503`, `docs/brainstorms/2026-06-14-phase-boundary-runtime-snapshot-requirements.md:231-237`
- Signal: honest checkpoint hydration needs durable cursor evidence. Without token cursor and transcript boundary evidence, a checkpoint can look complete while still being unsafe to continue.
- Concrete seam: token tracker, transcript persistence/boundary watermark, runtime snapshot payload, hydration passport validator.
- Validation path: passport tests where missing cursor evidence blocks resumability; fixture tests proving cursor evidence survives checkpoint serialization.
- Suggested slice: seal and validate cursor evidence at phase boundaries. Do not implement full resume in this slice.

### R4. Games MCP revealed-facts expansion

- Status: `ready`
- Consolidates: plans C6, brainstorms B6.
- Sources: `docs/plans/2026-06-19-004-feat-games-mcp-round-facts-plan.md:324-332`, `docs/brainstorms/2026-06-11-canonical-game-event-spine-requirements.md:57-80`, `docs/brainstorms/2026-06-19-games-scope-mcp-oauth-hardening-requirements.md:13-32`, `docs/brainstorms/2026-06-19-user-cognitive-artifacts-mcp-web-access-requirements.md:96-124`
- Signal: Games MCP is a user-facing projection/read-model consumer. `read_round_facts` can become more useful by adding one public/player-safe revealed-facts family at a time, especially endgame/jury facts.
- Concrete seam: Games MCP read model, round facts builder, canonical event projection, user/producer auth profile split.
- Validation path: MCP tests for allowed facts, denied private trace/tool discovery, and wrong-subject access.
- Suggested slice: add endgame/jury revealed facts. Do not expose raw events or private source pointers.

### R5. Private trace retention and purge workflow

- Status: `ready`
- Consolidates: plans C8, brainstorms B7.
- Sources: `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:474-482`, `docs/plans/2026-06-15-001-feat-private-trace-writer-mcp-plan.md:278-288`, `docs/brainstorms/2026-06-15-private-trace-writer-mcp-requirements.md:10-20`, `docs/brainstorms/2026-06-15-private-trace-writer-mcp-requirements.md:57-70`, `docs/brainstorms/2026-06-15-private-trace-writer-mcp-requirements.md:162-193`
- Signal: private trace capture and local inspection exist as a debugging lane, but retention duration, purge/redaction behavior, and credential/storage hygiene are still deferred.
- Concrete seam: private trace writer/read model, storage keys/manifests, evidence read audit, local producer MCP.
- Validation path: purge/redaction tests, expired object behavior, bounded read/search behavior after purge, and non-dereferenceable private content.
- Suggested slice: implement an explicit purge/redaction workflow for private trace content. Avoid broad storage redesign.

### R6. Public upload presigner type cleanup

- Status: `ready`
- Consolidates: ideation comment/TODO scan.
- Sources: `docs/ideation/2026-06-21-refactoring-session-comments-todos-research-ideation.html:426-431`, `packages/api/src/lib/storage.ts:139-140`
- Signal: the API storage code suppresses `@typescript-eslint/no-explicit-any` and casts the S3 client to `any` at the public-upload presigner seam, while repo lint/docs treat `as any` as a quality gate violation.
- Concrete seam: `packages/api/src/lib/storage.ts`, AWS S3 client/command typing around `getSignedUrl`.
- Validation path: API lint/typecheck plus existing local/S3 upload tests or a focused presigner unit test that preserves public/local upload behavior.
- Suggested slice: introduce a small typed presigner helper or correct the AWS client/command type seam. Do not change storage behavior.

## Blocked Backlog

### D1. Owner reclaim and restart orchestration

- Status: `blocked`
- Consolidates: plans C3, part of brainstorms B2.
- Sources: `docs/plans/2026-06-14-003-feat-phase-boundary-runtime-snapshot-plan.md:277-285`, `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:474-482`
- Signal: after restart, a process eventually needs to reacquire interrupted work and decide whether continuation is allowed.
- Concrete seam: game owner rows, heartbeat/lease handling, startup orphan logic, durable-run inspection, lifecycle start/continue code.
- Validation path: owner-expiry tests, startup orphan tests, and restart-orchestrator tests.
- Blocker: needs R2/R3 or equivalent hydration target first. Owner reclaim alone is not valuable without a safe continuation boundary.

### D2. Strategy Thread and House packet checkpoint continuity

- Status: `blocked`
- Consolidates: plans C4, brainstorms B5.
- Sources: `docs/plans/2026-06-12-002-feat-strategy-thread-packet-plan.md:315-320`, `docs/plans/2026-06-13-001-feat-house-strategy-bible-packet-plan.md:419-425`, `docs/brainstorms/2026-06-12-strategy-thread-carry-forward-packet-requirements.md:16-30`, `docs/brainstorms/2026-06-12-strategy-thread-carry-forward-packet-requirements.md:75-77`, `docs/brainstorms/2026-06-13-house-strategy-bible-packet-requirements.md:18-31`, `docs/brainstorms/2026-06-13-house-strategy-bible-packet-requirements.md:207-209`
- Signal: strategy packets and House packets are important continuity artifacts, but they are not public transcript, canonical board truth, or standalone resume authority.
- Concrete seam: agent strategy packet state, House interviewer packet state, continuity capsules, checkpoint serialization.
- Validation path: prompt continuity tests before/after checkpoint hydration, simulation artifacts, and private trace checks.
- Blocker: depends on R2/R3 defining what checkpoint hydration actually needs.

## Future / Watchlist

### W1. GameWatchState summary repair scheduling

- Status: `future`
- Consolidates: plans C5, brainstorms B4, updated after code inspection.
- Sources: `docs/plans/2026-06-20-003-feat-game-watch-state-summaries-plan.md:292-327`, `docs/brainstorms/2026-06-20-game-watch-state-summary-read-model-requirements.md:10-26`, `packages/api/src/services/game-watch-state-summary.ts:50-115`, `packages/api/src/services/game-watch-state-summary.ts:155-220`, `packages/api/src/routes/games.ts:202-232`
- Signal: the durable summary table, refresh service, route batch read, lifecycle refresh, and backfill command already exist. The original list-performance problem is not a ready backlog item anymore.
- Remaining possible gap: if lifecycle refresh fails, list reads fall back to missing/schema-stale detection and do not independently detect current-schema rows that are behind the durable event head. The backfill command can repair that, but no background scheduler appears to run it automatically.
- Promotion trigger: stale game-list rows become visible in real use, or production operations need automatic summary repair beyond the explicit backfill command.
- Suggested slice if promoted: scheduled or deploy-time repair for summaries behind event head, plus tests that preserve "list route is not a replay worker."

### W2. Viewer-safe watch stream and non-watch websocket split

- Status: `future`
- Consolidates: brainstorms B3 and the closed public-boundary item.
- Sources: `docs/brainstorms/2026-06-20-game-watch-state-requirements.md:27-32`, `docs/brainstorms/2026-06-20-game-watch-state-requirements.md:60-64`, `docs/brainstorms/2026-06-20-game-watch-state-requirements.md:253-258`, `docs/brainstorms/2026-06-20-match-watch-shell-route-owner-requirements.md:175-180`
- Signal: `origin/main` already contains explicit public websocket transcript payload construction. The broader transport split should only be carried if normal watch routing still depends on mixed admin/runtime socket behavior after merging main.
- Promotion trigger: a concrete leftover mixed-boundary socket path is found after the branch absorbs `origin/main`.
- Suggested slice if promoted: route normal watching through persisted `GameWatchState` catch-up and move fill/admin diagnostics to a separate path.

### W3. Incremental transcript persistence

- Status: `future`
- Consolidates: `docs/statefulness-plan.md` Phase 1.4.
- Sources: `docs/statefulness-plan.md:159-171`, `docs/statefulness-plan.md:246-252`
- Signal: transcripts are still described as completion/error-time persistence in the statefulness plan. Incremental transcript flushes would make interrupted games more replayable even before full runner resume exists.
- Concrete seam: transcript insertion path in game lifecycle, phase-boundary hooks, checkpoint/event cursor boundaries.
- Promotion trigger: users lose meaningful watch/replay history from interrupted games, or resume work needs transcript/outbox cursor evidence beyond the current checkpoint watermark.
- Suggested slice if promoted: phase-boundary transcript flushes tied to cursor evidence. Do not market this as game resume.

### W4. Auth session hook and lint TODO cleanup

- Status: `future`
- Consolidates: ideation comment/TODO scan.
- Sources: `docs/ideation/2026-06-21-refactoring-session-comments-todos-research-ideation.html:452-458`, `packages/web/eslint.config.mjs:9-12`, `packages/web/src/lib/api.ts:38-84`, `packages/web/src/hooks/use-permissions.ts:118-119`
- Signal: several web surfaces listen to `auth:session-ready` / `auth:expired`, and the web ESLint config carries a TODO around `react-hooks/set-state-in-effect`.
- Concrete seam: shared auth/session hook or derived state helper, plus dashboard/profile/agent/game watcher listeners.
- Promotion trigger: auth-state flashes, duplicated listener bugs, or active work in those web surfaces.
- Suggested slice if promoted: centralize the auth session readiness/expiry listener pattern and narrow the lint warning. Keep it UX-driven, not lint-churn-driven.

### W5. Horizontal scaling locks and pub/sub

- Status: `future`
- Consolidates: `docs/statefulness-plan.md` Phase 2.
- Sources: `docs/statefulness-plan.md:173-235`, `docs/statefulness-plan.md:252-257`
- Signal: `activeGames` and Bun websocket pub/sub remain process-local. Owner epochs guard accepted commits, but horizontal scaling still needs distributed publish/subscribe and single-owner execution locks.
- Concrete seam: `game-lifecycle.ts` active runner ownership, `ws-manager.ts` publish/subscribe, Postgres advisory locks or Redis pub/sub.
- Promotion trigger: multiple API instances become a real deployment goal, or observer routing across instances becomes painful.
- Suggested slice if promoted: Postgres advisory lock around game execution before adding Redis. Redis pub/sub only when multi-instance websocket delivery is required.

## Closed / Removed

- Public websocket transcript boundary hardening: already landed on local `origin/main` via `1bc1277a` / PR #37. This branch needs to merge or rebase main, not queue new work.
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
- Broad public DTO package: unnecessary right now; use targeted public-surface builders and sentinel tests.
- Dashboard redesign, MCP install pages, MatchWatchShell chrome, post-vote Mingle drama, exposed-candidate rule changes, and House narration upgrades: product/UX/gameplay work, not refactor backlog unless a fresh implementation bug appears.

## Current Priority Order

1. R1 API-backed local run harness
2. R2 Phase-boundary resume proof
3. R3 Transcript and token cursor sealing
4. R4 Games MCP revealed-facts expansion
5. R5 Private trace retention and purge workflow
6. R6 Public upload presigner type cleanup

`Crash-Honesty Extraction` does not survive as a standalone backlog item. Its useful content is captured by R2, R3, and later D1.
