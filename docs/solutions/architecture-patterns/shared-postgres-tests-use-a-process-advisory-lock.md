---
title: Shared PostgreSQL Tests Use a Process Advisory Lock
date: 2026-07-25
category: architecture-patterns
module: api test harness
problem_type: test_isolation
component: test-database
severity: high
applies_when:
  - running DB-backed Bun tests against the shared local PostgreSQL database
  - launching focused DB test files from multiple agent processes
  - adding a DB-backed test that truncates shared tables
tags: [testing, postgresql, advisory-lock, concurrency, bun]
related_components: [setupTestDB, test-db, CI]
---

# Shared PostgreSQL Tests Use a Process Advisory Lock

## Problem

DB-backed API tests share one `TEST_DATABASE_URL`, and `setupTestDB()` truncates all Influence tables before each test. Separate Bun processes could therefore overlap: one process could truncate the database while another process was still asserting against it. Telling agents to run files sequentially reduced the risk but did not enforce anything.

## Pattern

`setupTestDB()` acquires a PostgreSQL session advisory lock on a dedicated reserved connection before running migrations or truncating tables. The connection and lock live for the Bun process:

- a second Bun process blocks in `setupTestDB()` until the first process exits;
- PostgreSQL releases the lock automatically if the owning process crashes and its session disconnects;
- migrations and every later truncate in that process occur while the lease is held;
- the application database pool remains separate from the lock connection.

The regression test launches two real Bun processes. The first acquires the database and holds its process window; the second must not finish setup until the first exits.

## Boundary

The lease serializes processes, not tests scheduled concurrently inside one process. DB-backed tests that share this database must not use `test.concurrent` or `describe.concurrent`. New shared-DB tests must call `setupTestDB()` before mutation; code that bypasses the helper also bypasses the lease.

## Verification

Run:

```bash
cd packages/api
bun test src/__tests__/test-db-process-lock.test.ts
```

The test must prove that the second process remains blocked during the first process's hold window and proceeds after the first exits.
