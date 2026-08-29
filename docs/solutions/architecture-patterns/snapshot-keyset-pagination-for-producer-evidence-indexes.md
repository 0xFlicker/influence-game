---
title: Snapshot Keyset Pagination for Producer Evidence Indexes
date: 2026-08-19
category: architecture-patterns
module: api producer cognition and private trace read models
problem_type: architecture_pattern
component: tooling
symptoms:
  - "Producer cognition reads stopped after 50 to 100 rows"
  - "Private trace manifest reads stopped after 500 rows"
  - "Producer game analysis embedded a newest-only slice without saying how much evidence remained"
root_cause: incomplete_read_contract
resolution_type: code_fix
severity: medium
tags: [production-game-mcp, cognitive-artifacts, private-traces, pagination, cursors, privacy]
related_components: [game-mcp, trace-mcp, producer-analysis]
---

# Snapshot Keyset Pagination for Producer Evidence Indexes

## Problem

Producer cognition and trace-manifest indexes were bounded lists, but their limits were terminal. The producer game-analysis response embedded only the newest rows and did not distinguish the returned slice from the durable total. Increasing the caps would only postpone the same completeness failure and make responses larger.

## Solution

Page the two private indexes by the existing deterministic `(createdAt DESC, id DESC)` order. The first request captures a PostgreSQL visibility snapshot, pins the newest matching row as a read-through boundary, and records the authorized total. Subsequent pages apply the visibility snapshot, read-through boundary, and last emitted row as a keyset. New writes record their immutable insertion XID, allowing `pg_visible_in_snapshot` to exclude rows inserted after page one even when their timestamp is equal and their random UUID would sort inside the remaining keyspace. Historical rows keep a null insertion XID and remain included; the migration deliberately does not backfill cognition or traces.

Return three explicit page fields:

- `pageSize`: the number of rows actually emitted on this page.
- `totalCount`: the authorized row count in the pinned durable snapshot.
- `nextCursor`: an opaque continuation token, or `null` on the terminal page.

Seal the database snapshot and cursor claims with authenticated encryption. Bind each cursor to its index kind, game, caller/surface authorization fingerprint, and normalized filters. Keep page size outside the sealed claims so clients can tune response size without changing the snapshot. Treat malformed, expired, tampered, cross-game, cross-caller, cross-surface, and filter-mismatched tokens as the same `cursor_invalid_or_stale` result.

Private trace continuation cursors also seal the first page's linkage summary. The first trace page reads manifest membership and the trusted canonical prefix in one read-only, repeatable-read transaction, so a later accepted event cannot corrupt the sealed linkage counts. Later pages can then return snapshot-consistent diagnostics without repeatedly scanning every manifest and replaying the full prefix. Existing game-leading indexes bound each private corpus before its page sort; the additive migration deliberately avoids transactional index builds that could extend table locks, and pagination correctness does not depend on a particular planner strategy.

`read_producer_game_analysis` should embed the same honest first-page contract. Clients continue with the dedicated list tool rather than requesting an ever-growing aggregate response.

## Boundaries

- Authorization and subject/producer isolation run before evidence is returned; a cursor never grants access.
- Cognitive and trace metadata remain non-canonical evidence. Pagination does not promote them into game truth.
- Do not derive or backfill missing cognition from raw private traces.
- Do not put raw trace content or storage locations in the cursor.
- Keep manifest-ID raw trace reads and their ranged byte limits unchanged.
- Preserve the existing per-page caps as response-size limits, not corpus limits.

## Verification

Database-backed tests should insert more rows than one page, force identical timestamps, vary page sizes between requests, insert another equal-timestamp row after page one, and prove that every row in the sealed snapshot appears exactly once while the late row stays out. The terminal emitted count must equal the first page's durable `totalCount`. Repeat with active filters, then prove tampered and foreign cursors fail without weakening authorization. Migration tests should prove historical rows remain present with null insertion XIDs and new rows receive the default without a backfill.

Schema tests should also assert that MCP tool inputs accept `cursor`, tool outputs advertise `pageSize`, `totalCount`, and `nextCursor`, and producer game analysis exposes the same metadata on both embedded indexes.
