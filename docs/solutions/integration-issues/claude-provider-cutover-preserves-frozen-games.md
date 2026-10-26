---
module: Model Routing
date: 2026-10-25
problem_type: integration_issue
tags: [anthropic, model-routing, migration, durable-games]
---

# Native Claude selection cutover

Adding native Anthropic catalog entries did not change existing Katana choices.
Provider-qualified IDs are explicit routing authority; catalog order cannot
prefer a cheaper provider over an existing selection.

Migration `0140_native_claude_selections` upgrades Haiku/Sonnet/Opus to native
5.5 and Fable to native 5.1 in character preferences and unsealed waiting games.
It covers both games' enrollment snapshots, legacy selection/manifest fields,
House and contestant routes, overrides, and exclusions. Duplicate routes keep
the first entry without increasing fallback budgets. Explicit selections win
when version upgrades create an exclusion conflict.

Current-selection validation and inventory filtering prevent newly selecting
superseded routes. They do not alter catalog lookup, accepted decisions, frozen
runtime recovery, historical seats, or provider accounting. Running, suspended,
completed, and already-sealed games continue to use their actual provider IDs.

The PostgreSQL regression checks the cutover twice, validates the resulting
policy at game start, and compares untouched historical records. Engine/API
tests cover rejected old selections, current native choices, picker inventory,
and reading frozen routes after the policy change.

The normal coordinated release must supply `ANTHROPIC_API_KEY` to gateway and
worker before cutover and drain old writers. This change does not qualify
Sonnet, Opus, or Fable gameplay; the earlier paid evaluation covered Haiku
Werewolf only. No additional paid calls are part of this review.

See [native provider integration](native-model-provider-integration.md) for the
broader SDK, execution, accounting and qualification lessons from this work.
