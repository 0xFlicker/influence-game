---
title: Separate Canonical Format IDs from Provider and MCP Vocabulary
date: 2026-08-27
category: architecture-patterns
module: engine format vocabulary
problem_type: architecture_pattern
component: provider-and-mcp-boundaries
severity: high
applies_when:
  - renaming a format or action for model-provider safety
  - exposing persisted games through current product or MCP vocabulary
  - preserving raw producer evidence while derived reads evolve
tags: [formats, provider-prompts, mcp, canonical-events, historical-games, raw-evidence]
related_components: [agent, house, game-mcp, postgame-analysis, simulation]
---

# Separate Canonical Format IDs from Provider and MCP Vocabulary

## Problem

Provider-safe and product-friendly names can change without changing the rules of a format. Rewriting canonical event IDs would make old and new games speak different event dialects, while exposing old names to providers or ordinary MCP consumers defeats the rename.

## Pattern

Keep persisted game authority canonical and translate only at explicit boundaries:

- Canonical events, projections used for replay, accepted decisions, checkpoints, and reducer actions retain `save_or_eliminate`, `vote_bomb`, `majority_elimination`, and `eliminate`.
- Provider prompts and exact tool schemas use `save_or_exit`, `short_list`, `highest_count`, and `exit`. Decode those values back to canonical IDs before validation or acceptance.
- Product views and derived MCP reads translate canonical format fields to the current names. This makes historical games read like current games without a migration or event-version branch.
- Raw event resources, trace artifacts, transcripts, and authored prose remain byte-faithful evidence. Translation is field-aware and never searches prose.

Use one exhaustive canonical-to-surface map for format IDs. Keep narrower field mappings for encoded structured values such as ballot polarity, format resolution methods, generated postgame fact types, and derivation-method identifiers. Structured `formatId` fields stay canonical inside the engine so the boundary can translate them; display labels belong only in presentation text. Do not add aliases to canonical validators or accept old provider values as a compatibility fallback.

## Verification

Cover each boundary independently:

- capture provider requests and reject refusal-sensitive legacy terms in engine-owned messages, schemas, and tool names;
- prove each provider alias decodes to the unchanged canonical accepted value;
- replay canonical accepted values without dispatching another provider call;
- read an old canonical game through derived MCP tools and observe current format IDs;
- read the raw event resource and observe the original canonical bytes;
- assert authored transcript text is unchanged even when it contains an old name;
- validate every bumped MCP response version against its advertised output schema.

## Why This Matters

This boundary lets presentation vocabulary evolve without creating a second game format, weakening replay, or hiding producer evidence. It also keeps model-safety work honest: provider requests change, but the engine's authoritative state machine does not.
