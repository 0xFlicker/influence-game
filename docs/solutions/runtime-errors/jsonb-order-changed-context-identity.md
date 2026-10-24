---
title: JSONB field order changed a durable call's context identity
date: 2026-10-23
module: strategy state and durable provider calls
problem_type: runtime_error
tags: [jsonb, context-hash, recovery, strategy-state]
---

# JSONB field order changed a durable call's context identity

An interrupted Influence call repeatedly failed with `Context source changed under the same logical call`. The accepted turn frontier stayed unchanged while workers reacquired and relinquished ownership.

`compactionCharacter.currentStrategy` contained `JSON.stringify(getCompactStrategyState())`. Initial execution preserved insertion order; PostgreSQL JSONB recovery returned the same fields in a different order. A spread-based clone retained that order. Canonical hashing of the surrounding object could not normalize JSON already embedded in a string, so identical strategy values produced different source hashes.

Reconstruct compact strategy in an explicit field order, including nested prior-epoch state, before serializing it. Keep the context-integrity guard and saved hashes. Do not weaken the guard, replace historical hashes or regenerate frozen evidence. Genuine mismatches become a typed integrity error with expected/actual and component hashes; Influence marks execution `repair_required` under the current owner epoch to prevent repeated automatic adoption. This is unrelated to context size or token budgets.

Regression coverage must traverse actual JSONB, interrupt after journaling a failed fallback, recover with the same context hash, and replay acceptance without another dispatch. A real strategy-value change must still fail before transport. See [the incident and exact evidence](../../plans/2026-10-23-void-fawn-edge-fixes.md).
