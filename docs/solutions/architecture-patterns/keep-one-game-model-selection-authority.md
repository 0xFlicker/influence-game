---
title: Keep One Game Model Selection Authority
date: 2026-08-03
category: architecture-patterns
module: game model selection migration
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - migrating legacy game model tiers
  - deploying game model selection changes
tags: [model-selection, game-config, migration, deployment, roll-forward]
related_components: [api, database, model-catalog, documentation]
---

# Keep One Game Model Selection Authority

`games.config.modelSelection` is the sole game model authority. The one startup migration maps legacy `budget` / `standard` / `premium` to `openai:gpt-5-nano` / `openai:gpt-5-mini` / `openai:gpt-5.4-mini` with `action-policy`, then removes `modelTier`.

Keep old API writers stopped while that migration runs. Rollback is roll-forward. OpenAI `serviceTier` is unrelated to game model selection.
