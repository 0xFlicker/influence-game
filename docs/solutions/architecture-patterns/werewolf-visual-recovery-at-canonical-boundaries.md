---
title: Werewolf visual recovery at canonical boundaries
category: architecture-patterns
module: Werewolf visual production
date: 2026-10-05
problem_type: architecture_pattern
component: service_object
tags: [werewolf, visual-mode, production, durable-execution, house-integration]
---

# Required visuals at a game-owned boundary

## Problem

Werewolf originally treated every visual failure as portrait fallback. Exposing the shared Require visuals choice needed durable suspension and producer recovery, including failures before a scene exists and a lone wolf's derivative. Borrowing Influence's recovery cursor would invent authority and risk repeating accepted gameplay.

## Implementation

- Share `visualFailurePolicy`, its UI labels, diagnostics, immutable publications and leased media worker. Dispatch recovery to a small game-specific adapter.
- Save the exact work descriptor and canonical event sequence under the current game-owner lock. Reconstruct and validate pending work from events whenever repairing or resuming. A visual pause expires the owner atomically; ordinary adoption excludes suspended games.
- Prepare conversations before accepting their next action. Prepare hunts after `night_resolved` is committed and before the completion path. Resume never writes a second night result.
- Include the pending descriptor in Production inventory, even without a scene row. Only the validated suspended frontier is repairable while gameplay is incomplete.
- Form-only jobs use the shared queue with `mode=forms` and a null scene ID, constrained in migration 0112. They reuse frozen character references and the normal variant verifier without creating a fake pack meeting or media version.
- Publishing and changing policy do not resume. Explicit resume validates the published scene or saved derivative, refuses active repair work, clears only the pause, and returns control to ordinary worker adoption. Matching published repairs are reused before the original failed render is considered.
- Pin the exact recovery publication into game configuration so an already-open live player can receive it despite its initial publication cutoff. Existing audience filtering still hides private night content from Mystery.
- Preserve failed/uncertain provider attempts. Optional harmonization image failures or rejected identities retain verified panels; cancellation, owner loss and programming errors propagate. New repair requests remain explicit and bounded by existing worker/journal rules.

## Validation

`werewolf-visual-policy.test.ts` covers null renders, failures before scene creation, form-only repair, policy changes, stale owners, authorization, saved nights, game-ending nights and immutable-event resume. `werewolf-visual-recovery.e2e.test.ts` exercises creation, public pause, common Production discovery, mobile repair/publication, blocked premature resume and live-session recovery in an isolated database with deterministic renderers. Shared renderer and media tests cover panel retention, journal uncertainty and Influence regression behavior.

## Next-game guidance

Add a game-owned boundary validator and recovery adapter. Reuse policy UI and production services; never fabricate another game's cursor or derive required cast from prose. Keep recovery imagery distinct from gameplay authority and from general editorial publication.
