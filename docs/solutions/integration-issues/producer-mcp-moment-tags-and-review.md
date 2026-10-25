---
title: Producer MCP tags use Studio authority and review fingerprints
date: 2026-10-25
module: Production Studio
problem_type: integration_issue
tags: [mcp, producer, studio, annotations, oauth, concurrency]
---

# Producer MCP tags and operator review

## Problem

Producer diagnostics exposed game evidence but no editable Studio moment identities. An agent could suggest interesting thinking but could not save a reviewable cut. A generic Studio link would also reset the recipe instead of opening the proposed selection.

## Solution

`production-editorial-source.ts` resolves the existing game-specific source snapshots; `production-editorial.ts` reads their exact catalog, patches the existing annotation owner and previews the shared selector. Accepted text binds through `production-moment-content.ts`, also reused by the audio source, without parsing prose or importing browser rendering code.

The read and preview tools require producer scope. The patch additionally requires explicit producer:edit consent and a current Producer/Sysop role. Four persisted OAuth scope constraints accept the new scope without upgrading old grants. Patch writes run in repeatable-read transactions, compare the supplied annotation revision and preserve unmentioned keys. No-op writes keep their revision; stale writes and serialization races return the current annotation instead of rebasing silently.

Pages contain whole entries with typed snapshot-bound continuations. History is pinned; annotation metadata remains live. Preview continuation fingerprints prevent mixed selections when tags change between pages. The review URL holds only bounded recipe/audience/music settings and a hash. Studio recomputes that hash through the same service and requires renewed review on drift. The existing freeze/export flow still owns exact media binding.

Reviewing the actual Werewolf game exposed thinking attached to silent discussion passes. The shared source builder now rejects non-playable entries before emitting editable moments, while retaining canonical and diagnostic evidence. This keeps MCP, Studio and exports aligned with playback policy.

## Verification

Focused PostgreSQL tests cover authorization, both game kinds, complete paging, byte limits, conflicts, no-ops, concurrent writes, privacy and existing voice coverage. The isolated browser proof tags via HTTP MCP, opens the returned recipe, verifies membership and music, freezes exact recording bindings, then changes a tag and verifies drift blocks export. Provider-free tests cover review decoding and silent/unavailable discussion exclusion. Real localhost curation saves receipts separately from canonical game evidence; it does not render or publish an export.
