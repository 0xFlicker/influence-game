---
title: Canonical Ballot Forfeiture for History Restrictions
date: 2026-08-13
category: architecture-patterns
module: restricted-history-format
problem_type: architecture_pattern
component: format-kernel
severity: high
applies_when:
  - "a ballot format can legally leave a voter with no target"
  - "recovery must distinguish completed participation from a missing write"
tags: [canonical-events, sealed-ballots, recovery, replay, format-catalog]
related_components: [format-kernel, format-viewer, canonical-events]
---

# Canonical Ballot Forfeiture for History Restrictions

## Context

Restricted History excludes every living player a voter targeted with an
elimination-direction format ballot in an earlier round. SAVE ballots do not
consume history. Eventually a voter may have no legal non-self target.

## Guidance

Derive legal targets from canonical ballot events and the current living roster.
When the set is empty, do not call the agent and do not manufacture a sentinel or
self-target. Write a dedicated `format.ballot_forfeited` event and count that event
as the voter's completed participation. The scorer accepts forfeiture only for a
catalog registration that permits it and only when the supplied legal-target set
is empty.

Round availability is a catalog admission rule. Filter the frozen manifest before
menu construction, auto-selection, replay validation, and checkpoint recovery.
This keeps Restricted History out of rounds 1–2 without weakening the manifest as
the durable per-game format set.

## Verification

Cover elimination ballots, SAVE ballots, same-round exclusions, exhausted voters,
forged forfeitures, rounds 1–2 menu exclusion, round-3 admission, aggregate
recomputation, roster-ordered viewer roll call, and recovery from a round-specific
available set.
