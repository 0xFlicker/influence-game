# Influence Refactor Queue

Generated: 2026-06-21

Last audited against `main`: 2026-07-15

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
- `future`: coherent, but should not be in the active queue unless the pain becomes visible.
- `closed`: already implemented, superseded, or not a coherent current ask.

## Ready Backlog

Items are ordered by current priority.

### R5. Producer-visible decision fallback and repair ledger

- Status: `ready`
- Consolidates: local API-backed model evaluation finding from q-naifu-a3b testing.
- Sources: local runtime logs showing `[tool-fallback]` / `[vote-fallback]` repairs during API-backed Katana games; current canonical vote/revote events preserve repaired legal targets but do not expose whether fallback or target repair occurred.
- Signal: fallback-heavy model failures can currently be hidden behind valid-looking canonical game events. Producers may only notice the failure in local server warnings; provider accounting records spend, not repair provenance.
- Concrete seam: agent fallback paths, vote/revote target validation, cognitive artifact diagnostics, and producer-safe postgame analysis.
- Validation path: run a model that emits invalid/empty vote targets; verify the canonical game still advances, while the admin/producer surface clearly shows fallback count, repaired fields, original invalid value, fallback reason, and affected agent/action/round.
- Suggested slice: persist a bounded producer-only ledger containing action, actor, round, original invalid value, chosen repair, reason, and model. Summarize it through existing producer analysis instead of polluting player-facing canonical events or coupling it to cost accounting.

### R12. Player Strategy Thread checkpoint hydration

- Status: `ready`
- Consolidates: plans C4, brainstorms B5.
- Sources: `docs/plans/2026-06-12-002-feat-strategy-thread-packet-plan.md:315-320`, `docs/plans/2026-06-13-001-feat-house-strategy-bible-packet-plan.md:419-425`, `docs/brainstorms/2026-06-12-strategy-thread-carry-forward-packet-requirements.md:16-30`, `docs/brainstorms/2026-06-12-strategy-thread-carry-forward-packet-requirements.md:75-77`, `docs/brainstorms/2026-06-13-house-strategy-bible-packet-requirements.md:18-31`, `docs/brainstorms/2026-06-13-house-strategy-bible-packet-requirements.md:207-209`
- Signal: checkpoints now persist player and House continuity capsules, and supported resume paths hydrate the House packet. Player capsules are validated and persisted but are not passed into resumed agents, so their Strategy Thread state resets after recovery.
- Concrete seam: player continuity capsules, `GameRunner` resume input, agent strategy-packet hydration, and recovered prompt construction.
- Validation path: kill/restart at a supported coordinate after a strategy revision; verify the resumed agent prompt carries the same structured packet, eliminated-player scrubbing still applies, and no private packet content crosses public transcript or watch surfaces.
- Suggested slice: add an explicit agent hydration contract for the persisted player capsule. Do not infer strategy from transcript prose or make the packet canonical game truth.

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

- Status: `ready`
- Consolidates: Standing Daily Agent implementation review finding #9.
- Sources: `packages/web/src/components/avatar-generation-activity.tsx`, `packages/web/src/app/dashboard/agents/avatar-completion.ts`
- Signal: repeated status-read failures are currently rewritten into a terminal-looking `Portrait not generated` state even when the provider job may still be healthy and complete later. This confuses observability failure with generation failure and stops automatic status refresh.
- Concrete seam: avatar completion UI state, activity polling, retry affordances, and provider-versus-status error copy.
- Validation path: force three consecutive status API failures while the provider request remains pending, then recover the API; verify the UI reports status as temporarily unavailable, never claims generation failed, and eventually displays the completed portrait.
- Suggested slice: introduce a separate status-unavailable/degraded state with bounded backoff and manual refresh. Preserve the last known provider status instead of manufacturing a terminal failure.

### R11. Bounded draft-avatar polling and create recovery

- Status: `ready`
- Consolidates: Standing Daily Agent implementation review finding #10.
- Sources: `packages/web/src/app/dashboard/agents/agent-form.tsx`, `packages/web/src/app/dashboard/agents/avatar-completion.ts`, `packages/api/src/routes/agent-profiles.ts`
- Signal: draft status polling retries every five seconds without a limit while portrait-pending state disables agent creation. A sustained API or auth failure can therefore leave the form retrying forever; upload and cancel exist, but there is no bounded retry or create-without-draft action.
- Concrete seam: AgentForm draft polling, submit eligibility, retry controls, stale-draft handling, and post-create default portrait generation.
- Validation path: use fake timers and sustained 401/5xx responses; verify retry count and backoff are bounded, polling stops, the user receives a legible retry or create-without-waiting action, and no failed draft is accidentally consumed or attributed to the created agent.
- Suggested slice: cap polling retries with backoff and expose an explicit retry/status-refresh path. If creation proceeds without a confirmed completed draft, omit its request ID so normal post-create portrait completion owns recovery.

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
- Signal: the current named-alliance rules keep the full-drama route and rely on existing token-maxing rules. A dedicated short-mode huddle design should wait until real simulations show which huddles are expensive without adding strategy.
- Concrete seam: alliance round cadence, House huddle scheduling, simulation token accounting, local model evaluation summaries.
- Promotion trigger: named-alliance simulations show huddle windows dominate token spend or make large-cast games drag.
- Suggested slice if promoted: design a compressed alliance-huddle mode that preserves post-vote fallout and cuts optional private coordination first.

### W7. Cross-alliance membership and appearance guardrails

- Status: `future`
- Consolidates: named-alliance brainstorm deferred membership-cap rule.
- Sources: `docs/ideation/2026-07-02-named-alliances-ideation.html:406`, `docs/ideation/2026-07-02-named-alliances-ideation.html:447-459`
- Signal: each alliance is already limited to two huddle sessions and each live member receives one turn per session. Overlapping alliances remain intentionally uncapped across the whole window, so repeated appearances can still crowd out other alliances or inflate prompt cost.
- Concrete seam: alliance roster context, House huddle scheduling, huddle-seat budgets, prompt context budgeting, simulation diagnostics for multi-alliance agents.
- Promotion trigger: agents join too many alliances to reason coherently, repeat huddle appearances crowd out other scheduled alliances, or large overlapping alliances multiply speaking turns beyond the intended token budget.
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

## Closed / Removed

- R1 API-backed local run harness: implemented by `b4dcee91`. `bun run simulate:api` now authenticates, creates, fills, and starts real API games, waits for durable advancement, and prints the game URL. Evidence includes launcher argument/config tests, API lifecycle integration and component coverage, and local-model documentation; there is not a standalone end-to-end launcher test.
- R2 remaining phase-boundary resume coverage: implemented. `PHASE_BOUNDARY_RESUME_ACTOR_COORDINATES` and the DB-backed recovery matrix cover the supported normal, Reckoning, Tribunal, and Judgment coordinates, including newer unsupported same-head checkpoint fallback.
- R3 Games MCP revealed-facts expansion: superseded by the existing `read_round_facts` plus dedicated `read_game_brief`, `read_jury_breakdown`, `read_player_game_summary`, and `read_game_turning_points` surfaces with subject/producer isolation tests.
- R6 server-side web data loading boundary: implemented by `packages/web/src/lib/server-api.ts` and the server-loaded Highlights/metadata routes, with auth-free public fetch, timeout, initial-render, and social metadata tests.
- R7 retryable terminal game settlement: implemented. The final canonical event and a strict private terminal envelope are sealed before settlement; one atomic, idempotent transaction writes results, competition awards, ratings, profile/account counters, transcript, postgame initialization, and owner closure. Transient failures remain visibly pending and can be retried only through an authenticated, permission-gated, reasoned, audited admin action after the exact originating owner is expired. Deterministic evidence conflicts become `repair_required`; startup and MCP never replay gameplay or automatically redrive settlement. DB-backed tests cover failure capture, exact-once concurrency, rollback/repair, authorization, audit outcomes, safe producer reads, and zero-event restart classification.
- R9 atomic draft-avatar adoption: implemented by `652934ae` with DB-backed invalid-profile, cross-owner, concurrent-adoption, and rollback coverage across profile, revision, and avatar-lineage writes.
- W2 viewer-safe watch stream split: implemented. Websocket connect resolves slug/UUID, sends persisted `GameWatchState`, uses an explicit viewer-safe payload, filters private huddles, and leaves fill/admin mutation on HTTP routes.
- W11 delayed huddle outcome reveal: superseded by the later decision to use immediate public alliance inspection plus completed-game Alliance Arcs; a separate delayed-reveal system was deliberately not adopted.
- W17 legacy Agent Profile and House-name cleanup: implemented by `528d2858`. The repair migration resolves normalized/House-name conflicts, preserves frozen historical seats, updates only unfrozen waiting-seat snapshots, and installs database uniqueness/reserved-name authority.
- W5 horizontal scaling locks/pub-sub: consolidated into D1 multi-process execution ownership and observer delivery.
- W16 render-worker portability: consolidated into W13 postgame media scale-out and runtime portability.
- Transcript and token cursor sealing for supported resume: landed for checkpoint resume support. Remaining interrupted-game replay materialization is tracked as W3, not as a standalone proof slice.
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
- Dashboard redesign, MCP install pages, MatchWatchShell chrome, post-vote Mingle drama, exposed-candidate rule changes, and House narration upgrades: product/UX/gameplay work, not refactor backlog unless a fresh implementation bug appears.

`Crash-Honesty Extraction` does not survive as a standalone backlog item. Its completed coverage is recorded under R2; its remaining public-replay and multi-process concerns are W3 and D1.
