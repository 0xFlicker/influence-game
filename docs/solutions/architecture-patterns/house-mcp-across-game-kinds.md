---
title: Share House MCP inspection without sharing game authority
date: 2026-10-03
module: House MCP, game inspection, spectator access
problem_type: architecture_pattern
category: architecture-patterns
tags: [house, mcp, werewolf, influence, permissions, pagination, contracts]
---

# House MCP across game kinds

W2 gives both games one discovery and spectator inspection workflow. The shared layer owns access, tool contracts, response bounds and House links. Each adapter owns source traversal, audience disclosure, positions and outcomes. Keep explicit dispatch over the closed game-kind union; a plugin framework is unnecessary.

## What a third game must supply

1. A typed identity and visibility path in the existing game catalog. Public discovery and known-Unlisted reads are separate operations. A valid link does not grant private evidence access.
2. Canonical history validation and an audience-safe snapshot/entry projection. Never infer game facts from dialogue or spread storage/media DTOs into a public response.
3. A stable source coordinate and its House replay link. Silent source entries may count even when no animation plays. Cursor identity must not depend on presentation timing or speech pagination.
4. An explicit result projection and, only if captured, a separately authorized thinking read. Reuse the same eligibility used by the viewer; never substitute private cognition or rationale for thinking.
5. Fixtures through domain, authenticated MCP transport and browser links, plus explicit rejection from incompatible specialized tools.

## Boundaries learned here

- Catalog identity is spoiler-safe; current read and results are deliberate disclosures. Historical snapshots must come from the delivered prefix. Do not attach final roster/outcomes to an early Mystery page.
- Influence has independent canonical-event and transcript sequences. Return separate lanes and bounds instead of inventing a merged clock. Preserve source provenance for legacy unsequenced dialogue; exact links require exact authority.
- Public replay-frame helpers may internally traverse private bookkeeping. Allowlist eligible entries as well as fields. Keep the existing sanitized viewer-decision projection where it intentionally makes a decision public; do not expose raw producer payloads or hidden-row counts.
- Read identity, visibility and source heads in one read-only repeatable-read transaction. Drain a pinned head before explicit polling. Tokens bind game, kind, audience, lane, actor filter and evidence cutoff; tokens are not credentials. Reauthorize every request.
- Private owner evidence and producer evidence need their own gates even when the game is publicly watchable. Audit direct dispatch paths as well as central resolvers. Wrong-kind errors must not disclose inaccessible games.
- Whole-entry UTF-8 limits are different from item limits. Reserve room for typed follow-ups and validate the final response too. Large results need their own budget. Never truncate an accepted ballot or silently skip oversized dialogue.
- Derive follow-ups from typed results and validate them against the registered input schema. Treat names, speech and thinking as untrusted content. No summaries or other model calls belong in this read path.

## Verification and scaling

Disposable PostgreSQL databases keep browser and HTTP harnesses away from operator games. Shared API tests use `setupTestDB()` and its process lock. Real bearer HTTP tests prove registry, grant checks and runtime schemas together; a service test alone cannot. Open each game adapter's emitted replay URL in the real browser to catch route/coordinate mismatches.

A bounded output can still require a full-history replay. The 20-day Werewolf thinking fixture took about four seconds locally. Measure before optimizing; reuse validated work rather than bypass integrity checks. Catalog queries likewise currently filter before limiting in memory. These are scaling follow-ups, not reasons to add a cache/framework ahead of evidence.

[Implementation proof and contract generation](../../reviews/2026-10-03-w2-house-mcp-implementation.md) records test boundaries and the pinned schema generator. No deployed-host or provider acceptance is implied by local tests.
