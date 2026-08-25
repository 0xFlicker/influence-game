---
title: Keep One Game Provider Manifest Authority
date: 2026-08-03
last_updated: 2026-08-23
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

`games.config.providerManifest` is the sole runtime authority for the game's ordered provider/model execution. It seals the primary, bounded fallbacks, compatible reasoning settings, and fallback-call caps at creation. Catalog and Daily-default changes must never rewrite a running or recoverable game.

The additive migration projects legacy `modelSelection` records into one-entry manifests. During the bounded blue/green restoration window, new writes retain a legacy-primary `modelSelection` projection only so the old image can resume them; the new runtime reads the manifest. Remove that projection after the old image leaves the restoration set. OpenAI `serviceTier` is unrelated to game model selection.
