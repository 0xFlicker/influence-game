---
title: Keep One Game Provider Manifest Authority
date: 2026-08-03
last_updated: 2026-10-23
category: architecture-patterns
module: game provider manifest migration
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - migrating legacy game model tiers
  - deploying game model selection changes
tags: [provider-manifest, model-selection, fallback, game-config, migration, deployment, roll-forward]
related_components: [api, database, model-catalog, documentation]
---

# Keep One Game Provider Manifest Authority

`games.config.modelRouting` is the sole runtime authority for new games. It freezes contestant assignments, an independent House route, compatible reasoning settings and bounded fallbacks at atomic start. Enrollment preferences and admin overrides are inputs to that freeze, not competing runtime authorities. Catalog and Daily-default changes must never rewrite a running or recoverable game. See [current policy](../../model-routing.md) and [cutover mapping](../../deployment/game-model-routing-cutover.md).

Historical running/recoverable games retain their sealed `providerManifest` through the bounded restoration reader. Waiting legacy games cross to `modelRouting` at first start; new writes do not duplicate `modelSelection`, `providerManifest`, or per-seat `agentConfig.model`. Remove the reader only after environment inventory proves no recoverable game needs it. Completed evidence stays immutable. New Luna routes enforce Flex independently of any legacy service-tier setting.

Fallback allowance belongs to the game policy and responsibility, not simply the model ID: contestants share one route allowance and the House has another. A model serving one contestant as a primary must not consume another contestant's fallback allowance. Reserve before dispatch, retain indeterminate reservations, and replay accepted results without reserving again.

Episode-copy work can precede game start. Keep its existing revision/lease as authority when using the provider journal; do not manufacture a game owner epoch merely to satisfy a foreign key. Preserve game-owner constraints for actual gameplay and retain episode evidence through the same object-storage pipeline.
