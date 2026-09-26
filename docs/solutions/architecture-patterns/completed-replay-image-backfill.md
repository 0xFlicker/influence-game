---
title: Completed replay image backfill without changing gameplay
date: 2026-09-26
category: architecture-patterns
module: api visual production
problem_type: architecture_pattern
component: production
severity: medium
tags: [visual-mode, replay, canonical-events, production, media-repair, authorization]
---

# Completed replay image backfill

## Problem

Games played without Visual Mode have no saved scene plans. Existing media repair requires a plan, while live scene preparation rejects historical out-of-order boundaries. The public visual endpoint also previously returned no scenes when the original game configuration disabled Visual Mode.

## Solution

Admin → Production discovers missing scenes from trusted canonical prefixes at committed dialogue turns. Room IDs, private audiences, surviving rosters and active jury membership come from stored metadata and canonical state. Transcript prose is never parsed into scene facts. Discovery performs no writes or provider calls.

Producer or Sysop opens **Replay images** on the existing completed game row, then selects one scene explicitly. The controls expand in that row; there is no separate game picker. Filters, closing and switching games are disabled while a request's response is uncertain, preserving its recovery controls. The server revalidates its preview hash, copies existing frozen character references, stores a historical plan and queues the existing independent media worker. An advisory lock serializes media controls and rejects another render for the same game while one is active. Request IDs recover receipts after lost responses; paid uncertainty still requires externally supported reconciliation.

Verified candidates remain private until explicit publication. Public viewer selection exposes published images even if the game was originally nonvisual, with exact roster matching so partial backfills cannot retain someone voted off in a later scene. Existing per-beat media pinning adopts changes between speech beats.

No schema migration, gameplay rerun, new background preparation batch, or accepted-history rewrite is needed. Existing plans, artifacts, jobs, versions, publications and attempt journals hold the result. Current database Producer/Sysop assignments authorize every new Production API endpoint, including reads and private evidence. JWT role claims alone cannot retain access after revocation.

## Verification

`visual-replay-production.test.ts` covers read-only discovery, canonical casts, one-job admission, idempotent requests, explicit publication, nonvisual viewers, partial casts and current-role authorization. `replay-visual-production.test.tsx` covers explicit selection, lost response recovery and review. `replay-visual-production.e2e.test.ts` uses an isolated database and deterministic image worker to exercise Producer access and desktop/mobile layouts without paid providers.
