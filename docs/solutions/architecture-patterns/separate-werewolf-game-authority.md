---
title: Separate Werewolf authority from Influence defaults
date: 2026-09-26
module: engine games, API execution, character profiles, spectator projections
problem_type: architecture_pattern
category: architecture-patterns
tags: [werewolf, game-kind, strategy, event-authority, spectator-privacy, durable-execution]
---

# Separate Werewolf authority from Influence defaults

The House rebrand separated venue copy, but the existing game runtime still assumed Influence phases, jury membership, one winner, format ballots, and omniscient House narration. Adding Werewolf as a format would import those rules and leak role knowledge through existing viewer contracts.

Use `games.gameKind` for the closed Influence/Werewolf dispatch. Keep Influence's kernel and format catalog inside Influence. Werewolf owns a pure rules reducer, canonical event log, legal action requests, seat observations, faction results, and audience projections in `packages/engine/src/werewolf/`. Shared services provide account identity, provider execution, attempt journaling, spending, and renewable owner fencing. No generic game plugin framework is needed for these two implementations.

Before model dispatch, persist the exact legal request and seat-observation hash at the next canonical event sequence. The provider journal binds its stable semantic coordinate to that plan. Appending an action revalidates the committed prefix and owner in one transaction. An accepted provider result can replay after a crash before event commit without a second dispatch. Deterministic resolution events must equal the reducer's computed result; prose cannot repair or replace them.

Simultaneous discussion extends that same authority: reserve all pending action sequences for the beat and dispatch against its frozen public prefix. Commit each accepted result privately, preserving observation hashes for the still-pending seats after interruption. A single deterministic `werewolf.discussion_revealed` event publishes the batch and advances message budgets. Do not append individual public speech entries on acceptance: that would let provider latency alter another player's knowledge and expose partial beats to spectators. A batch is one public replay entry, so no cursor can land halfway through its reveal. Version 2 changes scheduling to six beats/four messages, with a second opportunity after a silent opening.

Serve an allowlisted spectator DTO, not a redacted state object. Mystery and Omniscient have different visible-entry timelines, so playback cursors are audience-local counts. Rebuild the requested prefix before exposing living status, roles, or outcomes. The client clears future facts when seeking backward and discards stale audience responses. Neither view exposes strategy or rationale. Influence endpoints, MCP match inspection, and automated postgame jobs exclude Werewolf.

One Agent Profile retains shared character/visual fields. Existing `strategyStyle` owns Influence; `werewolfStrategyStyle` owns Werewolf. Both participate in content revisions and moderation, but a Werewolf-only edit preserves Influence's analytical revision. Starting Werewolf freezes the owner's Werewolf notes or a Werewolf-specific archetype default; Influence notes are never a fallback. Extend the exact AI editor field enum, draft context, writer schema, primer, and client application together. Strategy-only edits preserve every other field, including blanks, and do not load the character's image. A profile writer that always loads a reference can fail before provider dispatch when a worktree lacks an older asset. Regression tests must cover missing images, malformed strategy output, and preservation of the other game's notes. Do not silently route faction results into single-winner ratings or jury-based learning.

Proof lives in the engine and API `__tests__/werewolf.test.ts` files and `packages/api/src/e2e/werewolf.e2e.test.ts`: deterministic prefix replay, hidden information, simultaneous night actions, dead faction winners, strict provider retry, accepted-result recovery, stale owners, corrupt-log isolation, and the browser strategy/create/watch journey. Use a dedicated test database if another checkout has already applied newer migrations; otherwise the migration runner may skip this checkout's earlier timestamp.

The first local startup exposed that exact migration collision: Werewolf initially
used the timestamp of the parallel visual-shots migration, and Drizzle selected
only entries newer than the database's highest timestamp. Passing fresh-database
tests did not prove startup against the shared development schema. Werewolf now
uses `0103_werewolf.sql`, after visual-shots and visual-review timestamps. Verify
the target database's journal before choosing a new migration slot; inspect both
the actual columns and exact hash after migration, then prove a second migration
pass is harmless. Do not hide this mismatch with `IF NOT EXISTS` or reset user data.

See [Werewolf rules and operations](../../werewolf.md) and the [research and implementation plan](../../plans/2026-09-26-001-feat-werewolf-game-mode-plan.md). Deterministic checks do not establish live-model game quality or balance.
