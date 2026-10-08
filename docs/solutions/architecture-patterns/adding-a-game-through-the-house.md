---
title: Adding a game through The House — lessons from Werewolf
date: 2026-10-07
category: architecture-patterns
module: House game integration
problem_type: architecture_pattern
component: game_integration
severity: high
applies_when:
  - adding a game alongside Influence and Werewolf
  - deciding whether a feature belongs to The House or a game module
  - auditing a game that runs correctly but is missing product journeys
tags: [werewolf, house, game-kind, canonical-events, audience-privacy, owner-learning, mcp, integration]
---

# Adding a game through The House — lessons from Werewolf

## Context and evidence

Werewolf needed its own rules and execution, but a working match was only the beginning. Players also needed casting, shared game URLs, replay, results, inspection, strategy review, interesting moments, trailers, music, visual repair, episode names and history. Early separate Werewolf pages and partial adapters made those omissions easy to miss.

This synthesis describes application commit `f3f0f81bac3d345f0e485f6bfc04357f7590338f`, including [PR 163](https://github.com/0xFlicker/influence-game/pull/163), [PR 164](https://github.com/0xFlicker/influence-game/pull/164) and [PR 165](https://github.com/0xFlicker/influence-game/pull/165). Research checked committed source, focused plans, review findings and current release evidence. The production host receipt records that exact candidate as terminally accepted, and public health matched it. This does not prove every gameplay outcome, generated asset or device combination was exercised in production.

The detailed slice solutions already exist. This document connects them into a third-game implementation guide; [shared delivery failures](house-delivery-boundary-failures.md) records the bugs and operational lessons.

## Share the product journey; keep game meaning explicit

Influence assumptions appeared in places that looked generic: a single winner, jury membership, analytical revision IDs, scoring writes, discovery queries and endpoints behind an Influence kind guard. Making Werewolf satisfy those assumptions would create false facts or hide legitimate records.

The working boundary is:

| Concern | The House owns | Each game owns |
| --- | --- | --- |
| Identity and admission | Accounts, characters, moderation, ownership, shared entry URLs | Valid roster/configuration and the strategy selected for this game |
| Execution | Provider attempts, spending, durable storage, worker ownership/fencing | Legal requests, state transitions, accepted events, resolution and completion |
| Knowledge | Transport authorization, bounded reads, shared inspection vocabulary | Actor observations and audience-specific projections |
| Viewing | Player shell, director, controls, preferences, fullscreen, media lifecycle | Cue construction, source coordinates, scenes, eligibility and music selection |
| Completed games | Results entry, galleries, sharing, job/publication infrastructure | Outcome facts, evidence adapters, spoiler policy and story inputs |
| Learning | Funding, durable review workflow, diagnostics, proposals and owner application | Strategy identity, actor-time evidence and what counts as good play |
| Operations | Job receipts, version review, publication, costs and operator controls | Canonical boundaries where failure can pause and repair can resume |
| History | Shared chronological participation | Faction/individual outcome and any game-specific rating system |

This is a small set of explicit boundaries, not a generic game plugin framework. `games.gameKind` selects concrete implementations. Influence's format kernel remains inside Influence; Werewolf does not invent a format, jury or rating revision to use House services.

Source seams: [game links](../../../packages/engine/src/game-links.ts), [entry route](../../../packages/api/src/routes/game-entries.ts), [entry component](../../../packages/web/src/components/games/house-game-entry.tsx), [Werewolf engine](../../../packages/engine/src/werewolf/rules.ts), and [watch director](../../../packages/web/src/components/watch/watch-director.ts).

## Establish accepted facts before building derivative experiences

Werewolf owns a pure reducer, legal action requests, canonical events, seat observations and faction outcomes. Before a model call, execution freezes the legal request and observation at an exact event coordinate. Provider replay reuses an accepted result at that coordinate; committing the action rechecks ownership and the accepted prefix. Deterministic resolution must agree with the reducer.

Dialogue can be deceptive. “I am the Seer,” an accusation, a production cue, or a narrator's description cannot establish a role, target, tally or phase transition. Results, viewer eligibility, owner review and editorial facts all derive from accepted structured events. The historical Influence prose parser is not a template for a new game.

The observation and presentation projections deliberately differ. A hunt can stage the pre-resolution cast while the post-resolution rail marks someone eliminated. Owner review needs what the actor knew before a decision, plus separately labelled later outcomes. A replay cursor must not expose future living status merely because a later window is cached.

See [game authority](separate-werewolf-game-authority.md), [results](house-results-across-game-kinds.md), and the current [Werewolf operating contract](../../werewolf.md). Earlier authority notes contain initial-slice restrictions; use the current contract and the correction inventory in the companion synthesis when they differ.

## Preserve the gameplay decisions that made the experience work

These are Werewolf decisions, not defaults for every House game. The shipped contract is rules v7; earlier experiments remain design history and are explicitly rejected on read/resume rather than silently translated.

- **Conversation is sequential and observable.** Seeded, rotating openers choose up to three ordered recipients; other respondents follow a seeded order. Each respondent speaks or passes once, and the opener may answer a spoken reply. Each accepted line is available before the next call. This replaced simultaneous discussion that did not reliably behave like a conversation. Addressing someone in prose does not change the queue.
- **Votes are fresh sealed checkpoints.** Earlier daytime checkpoints require a strict majority of all living players. The final checkpoint requires a target and uses unique-highest plurality; a highest tie means no elimination. Votes never carry between checkpoints. An unavailable provider's abstention is distinct from a model deliberately choosing to wait.
- **Pack agreement is a real decision.** Up to three proposal/ballot attempts require unanimity. Failure to agree can produce no attack. A lone wolf skips negotiation but still chooses a target.
- **Night choices share a boundary.** Doctor and Seer choices resolve with the attack from the same starting roster. A Doctor save is an explicit outcome, not a story inferred from “nobody died.” The Doctor may self-protect but cannot protect the same player on consecutive nights.
- **Faction success differs from survival.** A dead player can win with their faction and can have played well. Do not transplant Influence's early-elimination coaching or single-winner scoring into Werewolf.

Creation was simplified separately: inactive Speed-run/Timing controls were removed, while game-length limits remained. The UI defaults Doctor and Seer on and selects two wolves at eight players. That is an explicit UI setup; it does not mean every lower-level historical preset includes Doctor.

Exact rules and strict output contracts belong in [rules.ts](../../../packages/engine/src/werewolf/rules.ts), [agent.ts](../../../packages/engine/src/werewolf/agent.ts), and their tests. Deterministic correctness is not evidence of balanced or consistently entertaining model play.

## Integrate in complete, reviewable layers

### 1. Entry, visibility and completed facts

Both games enter through `/games/:slug`. A small routing-identity endpoint selects the game module; an Influence 409 or a network error is not game discovery. Detail, watch, image and inspection endpoints still guard their own access because clients can call them directly.

Public and Unlisted are the supported visibility choices. Both are anonymously readable by a known link; only Public appears in public discovery. Unlisted games can still appear in owner and producer collections. Private was removed after the operator confirmed there were no production Private games. Unlisted is not private, and neither option grants owner-review or producer privileges. Hidden records remain unavailable.

Results require validated terminal evidence. Cancellation, suspension, unavailable history and a draw must remain distinct states. Rare states were built as deterministic fixtures rather than waiting for enough paid games to encounter them.

References: [entry and replay moments](house-game-entry-and-replay-moments.md), [visibility plan](../../plans/2026-10-02-003-feat-house-game-visibility.md), [results plan](../../plans/2026-10-02-004-feat-werewolf-house-results.md).

### 2. Agent inspection and owner learning

MCP parity means shared capabilities backed by strict game-aware contracts. Werewolf defaults to Mystery. Cursors bind game, audience, lane and snapshot position; bounded responses preserve whole entries and matching state prefixes. An agent that knows an Unlisted slug may read it, but the public catalog must not enumerate it. Generated output schemas must evolve alongside the DTOs.

Thinking uses a separate authorized read. Mystery gets neither thinking nor private night decisions. Omniscient inspection can expose the permitted captured thinking and decisions without leaking strategy blocks or raw provider reasoning. In-game text remains untrusted content, even inside a valid structured response.

Owner learning reuses the House workflow but supplies Werewolf evidence and policy. It reconstructs the actor's observation at each accepted decision and separates hindsight from what was knowable. Honest no-change and insufficient-evidence results are valid. The first goal was a factual, usable owner workflow; broader coaching calibration remains distinct work.

A shared character retains one appearance/personality, with separately authored and match-frozen strategy blocks. Editing Werewolf strategy does not create an Influence analytical revision or require regenerating art. Learning proposals must target the correct game strategy, preserve ownership and moderation, and reject stale application.

References: [MCP across games](house-mcp-across-game-kinds.md), [owner learning across games](house-owner-learning-across-game-kinds.md), [inspection service](../../../packages/api/src/services/house-game-inspection.ts), [Werewolf review evidence](../../../packages/api/src/services/owner-learning-werewolf.ts).

### 3. Editorial, art and publication

A Doctor save exposed a limitation of dialogue-led highlight selection: an important story can be an action/outcome rather than a quotable exchange. Canonical night packets joined permitted pack discussion, ballots, resolution and morning context. Mystery and Omniscient source packets remain separate. Zero or two strong Cuts are preferable to filling a quota with weak material.

The human gate approves the editorial method and samples. After approval, completed-game jobs generate, select and publish automatically. W4 did not add mandatory per-Cut producer approval. Model cost/allowed evidence authorization is separate from both editorial quality approval and publication correctness.

Trailers reuse House rendering and publication with a Werewolf opening-only source policy. An otherwise Mystery-safe completed-game Cut can still spoil an opening teaser. The compiler therefore restricts eligible evidence to the opening, and a cast/premise teaser is valid when no Cut qualifies. Frozen episode copy must travel with the same media snapshot through finalization.

Art exploration selected rustic village locations, camera-facing seating, a round table and a darker pack location. Original full-body rectangles remained a deliberate constraint. Wolf forms are verified, reusable derivatives of frozen character art; they are not replacements for profile art. The form prompt preserves the source character's style, including nonrealistic styles.

PR164 refined the hunt: generated scenes are omitted when the Doctor protects the target. The save explanation still appears in permitted playback. Other hunts place the target foreground left and the wolves far behind on the right. Keep this later decision distinct from the original W6 experiment.

References: [editorial boundaries](house-cuts-editorial-source-boundaries.md), [trailers](werewolf-trailer-shared-renderer-and-spoiler-boundary.md), [derived art](werewolf-derived-art-and-producer-regeneration.md), [art exploration](../../brainstorms/2026-10-04-werewolf-art-lantern-village.md).

### 4. Recovery, packaging and history

Require visuals must own a durable pause at a canonical boundary. Repair, publication and gameplay resumption are separate steps; a producer's published image alone does not resume execution or authorize replaying a night result. Best effort retains a legible original-art experience.

Automatic naming queues transactionally with the frozen cast at game start. A fast game must not finish before a polling scan notices it. Only frozen names and bounded personalities go to naming, excluding roles, strategies, night actions and later outcomes. Reads do not generate copy; failed naming does not block gameplay. Leases/revisions prevent late generation from replacing an operator edit.

Existing games can immediately receive default card styling without per-game regeneration. Existing unnamed games require explicit naming backfill. Existing published media is not silently replaced when the title or default art changes.

Participation history mixes games chronologically, but ratings, seasons and score writes remain explicitly Influence-only. Historical names and participation come from frozen seats; ownership resolves through their profile IDs, never by matching mutable names. A Werewolf faction win remains a win even when that participant died.

References: [visual recovery](werewolf-visual-recovery-at-canonical-boundaries.md), [episode presentation](house-episode-presentation-across-game-kinds.md), [participation plan](../../plans/2026-10-06-001-feat-house-participation-history.md).

## Third-game checklist

For every row, record its canonical source, audience/permission rules, job/cost ownership, tests and unsupported states. A missing adapter is pending work, not automatically an intentional product difference.

| Delivery boundary | Required questions and proof |
| --- | --- |
| Rules and execution | What are legal actions, simultaneous boundaries and terminal outcomes? Can accepted calls recover without another dispatch? Do malformed outputs fail inside provider attempts? |
| Character and strategy | Which fields are shared, which are game-specific, and what freezes at start? Can strategy-only edits work without loading binary art? |
| Entry and access | Do shared links, direct reads, Public/Unlisted discovery and hidden denial agree? Does the outer router actually admit the game? |
| Replay | Are source coordinates distinct from presentation steps? Do arrows, dragging, final tallies, no-image scenes and live-tail behavior work? |
| Knowledge | Can changing audience, seeking backward, prefetched assets or music leak future/private facts? Are navigation labels and social cards also filtered? |
| Results and review | Can fixtures express draws, cancellation, corrupt history and rare outcomes? Does evaluation use this game's objectives and actor-time knowledge? |
| MCP | Are strict inputs/outputs, byte budgets, opaque cursors and capability advertisements complete? Can agents discover published media? |
| Editorial and media | Are evidence/prompt/schema versions frozen? Is the human quality gate clear? Are generation, upload, finalization and availability separately proved? |
| Operations | Can each operator role discover the game and its failure? Do repairs preserve good assets and uncertain paid receipts? Who explicitly resumes it? |
| Packaging and history | Do old/new cards, episode copy, social metadata and participation work without contaminating unrelated ratings? |
| Release | Do migration policy, database execution, accepted-image compatibility, staging and exact production receipts agree? |

## Open boundaries at the recorded release

- Admin-only Production discovery remains incomplete; producer/sysop cross-game discovery works. Do not broaden paid-generation permission merely to repair discovery.
- Decorative individual-reveal treatment, broader coaching/editorial calibration and physical-device coverage are not implied by the baseline's success.
- `harmonize` SQL support and its Drizzle check still need alignment. The broader watch transport/cache audit remains queued.
- The local replay exporter is unmerged work; adapting the browser scrubber to its duration-based presentation timeline remains queued. Dramatic thinking close-ups remain deferred. The shipped browser has a shared visual director and separately owned ambient music.
- Werewolf ratings, seasons and Daily Free scheduling are separate product decisions, not missing adapters to be enabled automatically.

See the [journey audit](../../audits/2026-10-05-house-journey-parity.md), [refactor queue](../../refactor-queue.md), and [companion delivery lessons](house-delivery-boundary-failures.md). Retain historical rule rationale, but update technical guidance when the shipped contract changes.
