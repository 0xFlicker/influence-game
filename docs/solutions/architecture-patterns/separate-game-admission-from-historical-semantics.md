---
title: Separate Game Admission from Historical Semantics
date: 2026-08-07
category: architecture-patterns
module: game lifecycle
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - changing the allowed roster size for newly created games
  - changing the allowed round limit for newly created games
  - validating persisted games for reads or recovery
  - changing endgame phase transitions
tags: [game-admission, historical-games, recovery, endgame, reckoning]
related_components: [game-creation, simulator, game-recovery, phase-machine]
---

# Separate Game Admission from Historical Semantics

## Problem

A current creation limit can look like a universal player-count invariant. Applying it to persisted state would reject valid historical games, while applying it to phase progression would silently change the endgame.

## Pattern

Keep the three contracts independent:

- New-game admission accepts 6–12 agents.
- New Influence API games accept `auto` or an explicit integer round limit from 1–16. The creation form offers 5–16. Normal API execution still raises a low requested limit to the player-scaled completion floor.
- Historical four-player games are not invalid solely because they predate that admission policy; existing read and recovery paths continue to interpret their persisted contract.
- Existing games retain their frozen round limit; new admission rules do not rewrite waiting, running, or completed records.
- The Reckoning begins when the live field reaches exactly four agents, independent of the original roster size.

Enforce current bounds at true creation surfaces. Do not retrofit them onto historical reads, checkpoint restoration, or the phase machine.

## Verification

Cover each boundary separately: reject newly created rosters outside 6–12 and malformed or out-of-range round limits before insert; preserve historical reads and recovery; prove a larger game enters The Reckoning only after four agents remain; and prove a valid admitted round limit reaches the phase-machine cutoff.
