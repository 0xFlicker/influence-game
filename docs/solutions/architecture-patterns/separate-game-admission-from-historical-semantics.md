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
- Historical four-player games are not invalid solely because they predate that admission policy; existing read and recovery paths continue to interpret their persisted contract.
- The Reckoning begins when the live field reaches exactly four agents, independent of the original roster size.

Enforce current bounds at true creation surfaces. Do not retrofit them onto historical reads, checkpoint restoration, or the phase machine.

## Verification

Cover each boundary separately: reject newly created rosters outside 6–12, preserve a historical four-player read/recovery case, and prove a larger game enters The Reckoning only after four agents remain.
