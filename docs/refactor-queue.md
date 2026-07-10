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

### R2. Remaining phase-boundary resume coverage

- Status: `completed in current branch`
- Consolidates: plans C1, brainstorms B2.
- Sources: `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:95-102`, `docs/plans/2026-06-14-002-feat-checkpoint-hydration-passport-plan.md:495-503`, `docs/plans/2026-06-14-003-feat-phase-boundary-runtime-snapshot-plan.md:277-285`, `docs/brainstorms/2026-06-11-canonical-game-event-spine-requirements.md:18-28`, `docs/brainstorms/2026-06-14-checkpoint-hydration-passport-requirements.md:220-241`, `docs/brainstorms/2026-06-14-phase-boundary-runtime-snapshot-requirements.md:220-274`
- Signal: startup recovery now works for the original pre-round lobby checkpoint, persisted normal-round coordinates through `reveal`, `reckoning_lobby`, staged late-game coordinates through `tribunal_vote`, `tribunal_defense` through Accusation Capsule V1, and Judgment finale coordinates.
- Concrete seam: `GameRunner.hydratePhaseActorForResume`, `PHASE_BOUNDARY_RESUME_ACTOR_COORDINATES`, `game-recovery-support.ts`, checkpoint accumulator registry, and DB-backed recovery tests.
- Validation path: extend the recovery matrix with kill/restart tests for each newly supported coordinate; assert same game ID, contiguous post-restart events, completed results, and matching `resumeAvailable`.
- Result: `reckoning_plea`, `reckoning_vote`, `tribunal_lobby`, `tribunal_accusation`, `tribunal_defense`, `tribunal_vote`, `judgment_opening`, `judgment_jury_questions`, `judgment_closing`, and `judgment_jury_vote` are covered by DB-backed same-game recovery tests. Startup recovery now selects the newest resume-capable same-head checkpoint instead of failing just because a newer unsupported checkpoint exists.

### R3. Games MCP revealed-facts expansion

- Status: `ready`
- Consolidates: plans C6, brainstorms B6.
- Sources: `docs/plans/2026-06-19-004-feat-games-mcp-round-facts-plan.md:324-332`, `docs/brainstorms/2026-06-11-canonical-game-event-spine-requirements.md:57-80`, `docs/brainstorms/2026-06-19-games-scope-mcp-oauth-hardening-requirements.md:13-32`, `docs/brainstorms/2026-06-19-user-cognitive-artifacts-mcp-web-access-requirements.md:96-124`
- Signal: Games MCP is a user-facing projection/read-model consumer. `read_round_facts` can become more useful by adding one public/player-safe revealed-facts family at a time, especially endgame/jury facts.
- Concrete seam: Games MCP read model, round facts builder, canonical event projection, user/producer auth profile split.
- Validation path: MCP tests for allowed facts, denied private trace/tool discovery, and wrong-subject access.
- Suggested slice: add endgame/jury revealed facts. Do not expose raw events or private source pointers.

### R4. Private trace retention and purge workflow

- Status: `ready`
- Consolidates: plans C8, brainstorms B7.
- Sources: `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:474-482`, `docs/plans/2026-06-15-001-feat-private-trace-writer-mcp-plan.md:278-288`, `docs/brainstorms/2026-06-15-private-trace-writer-mcp-requirements.md:10-20`, `docs/brainstorms/2026-06-15-private-trace-writer-mcp-requirements.md:57-70`, `docs/brainstorms/2026-06-15-private-trace-writer-mcp-requirements.md:162-193`
- Signal: private trace capture and local inspection exist as a debugging lane, but retention duration, purge/redaction behavior, and credential/storage hygiene are still deferred.
- Concrete seam: private trace writer/read model, storage keys/manifests, evidence read audit, local producer MCP.
- Validation path: purge/redaction tests, expired object behavior, bounded read/search behavior after purge, and non-dereferenceable private content.
- Suggested slice: implement an explicit purge/redaction workflow for private trace content. Avoid broad storage redesign.

### R5. Admin-visible model fallback and repair diagnostics

- Status: `ready`
- Consolidates: local API-backed model evaluation finding from q-naifu-a3b testing.
- Sources: local runtime logs showing `[tool-fallback]` / `[vote-fallback]` repairs during API-backed Katana games; current canonical vote/revote events preserve repaired legal targets but do not expose whether fallback or target repair occurred.
- Signal: fallback-heavy model failures can currently be hidden behind valid-looking canonical game events. Admins may only notice the failure by watching local server logs, which is not acceptable for model evaluation, production operations, or postgame trust.
- Concrete seam: agent fallback paths, vote/revote target validation, cognitive artifact diagnostics, provider spend/cost detail, admin game detail/cost views, and any producer-safe read model used for local/API simulation inspection.
- Validation path: run a model that emits invalid/empty vote targets; verify the canonical game still advances, while the admin/producer surface clearly shows fallback count, repaired fields, original invalid value, fallback reason, and affected agent/action/round.
- Suggested slice: record fallback/repair metadata at decision time and surface it in an admin-visible diagnostics panel or cost detail section. Keep player-facing game events clean, but do not let admin tooling launder fallback decisions into invisible success.

### R6. Server-side web data loading boundary

- Status: `ready`
- Consolidates: House Highlights staging failure follow-up.
- Sources: `packages/web/src/lib/api.ts`, `packages/web/src/app/games/[slug]/highlights/page.tsx`, `packages/api/src/services/postgame-highlights.ts`
- Signal: web server routes currently lean on the browser-oriented API client in places where real server-side data loading is needed. The Highlights page exposed the issue because a public share page needs route-owned metadata, future OG cards, and cacheable HTML, but the current small fix restores client-side loading only.
- Concrete seam: Next server components/pages that need shareable metadata or cacheable read models, API service/read-model boundaries, and deployment env ownership for server-side reads.
- Validation path: server-render a Highlights route with route-specific metadata from the same public projection as the browser page, without relying on client hydration or self-fetching through a public API URL; verify staging and local Docker/dev envs.
- Suggested slice: design a deliberate server-side read pattern for public web projections, then migrate Highlights first. Do not invent per-page DB imports or duplicate projection logic in web.

## Blocked Backlog

### D1. Owner reclaim and restart orchestration

- Status: `future`
- Consolidates: plans C3, part of brainstorms B2.
- Sources: `docs/plans/2026-06-14-003-feat-phase-boundary-runtime-snapshot-plan.md:277-285`, `docs/plans/2026-06-13-002-feat-durable-game-run-kernel-plan.md:474-482`
- Signal: single-process startup recovery now reacquires interrupted work and decides whether continuation is allowed. Remaining orchestration work is about graceful shutdown, lease freshness, multi-worker coordination, and spot/serverless worker fleets.
- Concrete seam: game owner rows, heartbeat/lease handling, startup orphan logic, durable-run inspection, lifecycle start/continue code.
- Validation path: graceful shutdown tests, owner-expiry tests, multi-worker claim contention tests, and restart-orchestrator tests.
- Promotion trigger: multiple API/worker processes become real, or deploy/restart behavior needs graceful drain semantics beyond the current startup recovery path.

### D2. Strategy Thread and House packet checkpoint continuity

- Status: `blocked`
- Consolidates: plans C4, brainstorms B5.
- Sources: `docs/plans/2026-06-12-002-feat-strategy-thread-packet-plan.md:315-320`, `docs/plans/2026-06-13-001-feat-house-strategy-bible-packet-plan.md:419-425`, `docs/brainstorms/2026-06-12-strategy-thread-carry-forward-packet-requirements.md:16-30`, `docs/brainstorms/2026-06-12-strategy-thread-carry-forward-packet-requirements.md:75-77`, `docs/brainstorms/2026-06-13-house-strategy-bible-packet-requirements.md:18-31`, `docs/brainstorms/2026-06-13-house-strategy-bible-packet-requirements.md:207-209`
- Signal: strategy packets and House packets are important continuity artifacts, but they are not public transcript, canonical board truth, or standalone resume authority.
- Concrete seam: agent strategy packet state, House interviewer packet state, continuity capsules, checkpoint serialization.
- Validation path: prompt continuity tests before/after checkpoint hydration, simulation artifacts, and private trace checks.
- Blocker: depends on W3 or another concrete checkpoint-continuity slice defining what strategy/House state hydration actually needs beyond the currently supported resume inputs.

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

### W6. Alliance huddle short-mode compression

- Status: `future`
- Consolidates: named-alliance brainstorm deferred short-mode rule.
- Sources: `docs/ideation/2026-07-02-named-alliances-ideation.html:406-413`
- Signal: the current named-alliance rules keep the full-drama route and rely on existing token-maxing rules. A dedicated short-mode huddle design should wait until real simulations show which huddles are expensive without adding strategy.
- Concrete seam: alliance round cadence, House huddle scheduling, simulation token accounting, local model evaluation summaries.
- Promotion trigger: named-alliance simulations show huddle windows dominate token spend or make large-cast games drag.
- Suggested slice if promoted: design a compressed alliance-huddle mode that preserves post-vote fallout and cuts optional private coordination first.

### W7. Alliance membership and speaking caps

- Status: `future`
- Consolidates: named-alliance brainstorm deferred membership-cap rule.
- Sources: `docs/ideation/2026-07-02-named-alliances-ideation.html:406`, `docs/ideation/2026-07-02-named-alliances-ideation.html:447-459`
- Signal: overlapping alliances are expected to create interesting strategy, so the current rules intentionally do not cap how many alliances a player may join. Caps should be evidence-driven, not preemptive tidiness.
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

### W11. Delayed huddle outcome reveal and recap rules

- Status: `future`
- Consolidates: named-alliance document-review finding about hidden huddles lacking audience payoff.
- Sources: `docs/plans/2026-07-02-002-feat-named-alliances-rules-plan.md`
- Signal: v1 keeps hidden alliance membership, terms, and huddle outcomes out of public live play unless players reveal them. That protects secrecy, but viewer/replay/postgame surfaces may eventually need a delayed reveal or recap contract.
- Concrete seam: public watch/replay surfaces, postgame summaries, huddle outcomes, producer-safe versus player-safe visibility.
- Promotion trigger: viewers cannot understand major vote or Council moves because causal huddle outcomes remain invisible after the relevant strategic window closes.
- Suggested slice if promoted: define when huddle outcomes become recap-eligible after vote, Council, elimination, or postgame boundaries, while preserving live-match secrecy.

### W12. Structured trial-alliance expiry

- Status: `future`
- Consolidates: named-alliance implementation review finding about trial timebox enforcement.
- Sources: `docs/rules-page-content.md`, `docs/plans/2026-07-03-001-feat-named-alliances-implementation-plan.md`
- Signal: v1 can activate a trial alliance when all required members consent, but the timebox is still social/textual. The engine should not guess expiry from arbitrary prose.
- Concrete seam: alliance action schema, alliance proposal version terms, phase-boundary lifecycle refresh, huddle eligibility, rules copy.
- Promotion trigger: simulations show trial alliances persisting past their stated boundary or agents using vague timeboxes that make active status misleading.
- Suggested slice if promoted: replace free-form trial expiry with a structured boundary enum and archive trial alliances automatically at the named phase or round boundary.

### W13. Postgame media queue infrastructure

- Status: `future`
- Signal: the first production trailer worker deliberately uses API polling and database leases on one Linode host.
- Promotion trigger: multiple render hosts, materially higher completion volume, or operational evidence that polling and lease recovery are no longer sufficient.
- Suggested slice if promoted: move the existing claim/heartbeat/finalize contract behind a durable queue without changing the manifest or renderer boundary.

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

### W16. Render-worker portability

- Status: `future`
- Signal: the image and API lease boundary are portable, but the first deployment is one Docker Compose worker on Linode.
- Promotion trigger: AWS, multiple regions, autoscaling, or managed-job execution becomes an actual deployment goal.
- Suggested slice if promoted: adapt the existing immutable manifest and worker protocol to the target queue/runtime rather than moving render logic into API or web request containers.

## Closed / Removed

- Public websocket transcript boundary hardening: already landed on local `origin/main` via `1bc1277a` / PR #37. This branch needs to merge or rebase main, not queue new work.
- Transcript and token cursor sealing for supported resume: landed for checkpoint resume support. Remaining transcript durability work is tracked as W3 incremental transcript persistence, not as a standalone proof slice.
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

## Current Priority Order

1. R1 API-backed local run harness
2. R3 Games MCP revealed-facts expansion
3. R4 Private trace retention and purge workflow

`Crash-Honesty Extraction` does not survive as a standalone backlog item. Its useful content is captured by R2, W3, and later D1.
