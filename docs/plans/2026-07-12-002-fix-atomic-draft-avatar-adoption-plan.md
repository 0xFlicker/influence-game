---
title: Atomic Draft Avatar Adoption
date: 2026-07-12
type: fix
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
origin: docs/refactor-queue.md
---

# Atomic Draft Avatar Adoption

## Goal Capsule

- **Objective:** Make saving an agent with a completed draft portrait one atomic database outcome so a failed save never consumes the portrait without creating the intended agent and avatar lineage.
- **Authority:** R9 in `docs/refactor-queue.md`, then the existing `Avatar completion`, `Avatar change ledger`, and analytical revision contracts in `CONCEPTS.md`, then current API behavior and tests.
- **Execution profile:** One API-only fix with DB-backed regression coverage; preserve existing HTTP responses and non-draft creation paths.
- **Stop conditions:** Stop rather than add compensating unconsume logic, a background repair workflow, schema redesign, or changes to draft-generation ownership and polling.
- **Tail ownership:** Required API tests and repository checks must pass before shipping through a reviewable pull request.

---

## Product Contract

### Summary

Agent creation currently consumes a completed draft avatar before validating and persisting the profile. Profile creation and initial revision insertion are transactional, but the avatar change ledger is written afterward. A failure at any later step can leave the request permanently consumed without a usable agent. The fix makes draft consumption, profile insertion, initial analytical revision, and avatar lineage one committed outcome.

### Problem Frame

A generated portrait is user-owned work with a durable request record. Treating its consumption as an earlier independent mutation launders a partial failure into an `already_consumed` retry error. The database already supplies the correct boundary; the work is to stop cutting across it.

### Requirements

- R1. Invalid agent input must not consume or otherwise mutate a completed draft avatar request.
- R2. A draft avatar may be adopted only when it belongs to the authenticated owner, matches the submitted profile fingerprint, is terminal, and has not already been consumed.
- R3. For a completed draft with an avatar URL, conditional draft consumption, agent profile insertion, initial analytical revision insertion, and generated-avatar ledger insertion must commit or roll back together. A skipped completion keeps its existing avatar-free response and creates no generated-avatar lineage.
- R4. An adoption attempt that fails before commit must leave the same draft request retryable, and a successful retry must create exactly one agent with the intended portrait and one matching avatar change event. Commit-unknown network failures remain governed by the existing `already_consumed` response and are outside this slice's idempotency contract.
- R5. Concurrent adoption attempts for the same draft must allow at most one successful consumer without duplicate profiles or lineage rows.
- R6. Existing error semantics for missing, pending, changed, and previously consumed drafts must remain legible at the HTTP boundary.
- R7. Explicit uploads, agent creation without a draft, skipped draft completions, MCP creation, and later profile updates must retain their current behavior.

### Scope Boundaries

- No server-owned recovery for abandoned queued or processing avatar requests; that remains R8.
- No polling, degraded-status, or create-without-waiting UX changes; those remain R10 and R11.
- No database schema migration unless implementation proves the existing compare-and-set metadata contract cannot safely participate in the transaction.
- No out-of-band unconsume or repair command.

### Acceptance Examples

- AE1. Given a completed matching draft, when agent creation succeeds, then the profile, initial revision, consumed timestamp, and generated-avatar ledger row all exist.
- AE2. Given invalid submitted profile data, when creation is rejected, then the draft has no consumed timestamp and can be retried after correction.
- AE3. Given an injected failure while inserting the profile, revision, or avatar ledger row, when the transaction is confirmed rolled back, then no profile or lineage remains and the draft is still unconsumed.
- AE4. Given two concurrent requests adopting the same draft, when both finish, then one succeeds and the other receives the existing consumed/conflict result without duplicate durable rows.
- AE5. Given an explicit uploaded avatar and an unrelated draft request ID, when the agent is created, then the upload remains authoritative and the draft is untouched.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Put orchestration in the service layer. The route should parse transport input and translate typed domain failures; it should not own multi-write consistency.
- KTD2. Validate and normalize the profile before opening the adoption transaction. Validation failures require no database mutation and should retain current management errors.
- KTD3. Reuse one Drizzle transaction executor across the conditional draft claim, profile insert, revision insert, and `recordAvatarChange`. Do not nest `db.transaction` calls.
- KTD4. Preserve the current `consumedAt` compare-and-set predicate as the single-consumer guard. A losing concurrent request should receive `already_consumed` after the winning transaction commits. Add `consumedAt` without discarding unrelated metadata fields from the terminal request snapshot.
- KTD5. Keep `createOwnedAgentProfile` usable by existing non-draft callers. Extract a transaction-aware internal creation primitive or add a narrowly named draft-adoption entry point rather than forcing unrelated callers through draft semantics.
- KTD6. Test rollback at real PostgreSQL transaction boundaries. Use controlled database failure injection in the DB-backed route/service tests rather than production test hooks or mocked transactions.

### Existing Patterns

- `packages/api/src/services/agent-revisions.ts` exposes a transaction-aware helper and a public transaction wrapper; follow that split.
- `packages/api/src/services/avatar-generation.ts` already accepts transaction-capable executors for avatar writes and uses compare-and-set updates.
- `packages/api/src/services/competition-completion.ts` keeps idempotent multi-write work inside one explicit transaction boundary.
- `packages/api/src/__tests__/agent-profiles.test.ts` already proves successful draft attachment, duplicate rejection, and explicit-upload precedence; extend this suite rather than creating a parallel harness.

### Sequencing

1. Introduce transaction-aware service primitives and a single draft-adoption orchestration entry point.
2. Route completed draft creation through the orchestration while preserving non-draft paths and response mapping.
3. Add DB-backed rollback, retry, and concurrency coverage, then run focused and repository-wide verification.

### Risks and Mitigations

- **Nested transaction drift:** Keep the transaction opened by one top-level service only and pass its executor downward.
- **Error-contract regression:** Preserve the four current draft failure categories and assert their route status/copy behavior.
- **Audit omission:** Treat the avatar change ledger as part of success, not best-effort observability.
- **False concurrency confidence:** Exercise two real database requests rather than only checking the update predicate in isolation.

---

## Implementation Units

### U1. Transaction-aware draft adoption service

- **Goal:** Provide one service-owned transaction that validates and conditionally consumes a completed portrait draft, inserts the agent profile and initial revision, and records generated-avatar lineage while preserving skipped completion behavior.
- **Requirements:** R1, R2, R3, R4, R5, R7
- **Files:** `packages/api/src/services/agent-profile-management.ts`, `packages/api/src/services/avatar-generation.ts`
- **Approach:** Extract or expose transaction-aware primitives where needed, preserve the existing compare-and-set claim, and return typed draft-adoption outcomes suitable for route translation. Keep the generic profile-creation entry point behavior-compatible for existing API, MCP, queue, season, and test callers.
- **Test scenarios:** Successful adoption commits all four durable effects; invalid input causes no request mutation; a different owner receives the existing not-found result while the draft remains untouched and no profile, revision, or ledger row is created; failures at profile, revision, and avatar-ledger insertion roll back all effects; retry after rollback succeeds; two concurrent attempts produce one winner.

### U2. Thin route integration and regression coverage

- **Goal:** Route web draft-avatar creation through the atomic service without changing unrelated creation behavior or public responses.
- **Requirements:** R4, R5, R6, R7
- **Files:** `packages/api/src/routes/agent-profiles.ts`, `packages/api/src/__tests__/agent-profiles.test.ts`
- **Approach:** Remove route-level early consumption, call the atomic adoption entry point only when no explicit upload is supplied, and keep existing response mapping for pending, changed, missing, and consumed drafts. Extend the existing DB-backed suite with rollback/retry and concurrency assertions while retaining successful attachment and upload-precedence cases.
- **Test scenarios:** Existing successful and duplicate cases remain green; each failure category retains its HTTP result; cross-owner adoption is non-enumerating and mutation-free; explicit upload ignores the draft; skipped completion behavior remains intact; transaction failure leaves the draft reusable; concurrent HTTP requests create one agent and one ledger row.

### U3. Queue closeout and durable documentation

- **Goal:** Mark R9 complete with evidence once the implementation and required checks pass.
- **Requirements:** R1-R7
- **Files:** `docs/refactor-queue.md`
- **Approach:** Change R9 from ready to completed and summarize the landed transaction boundary and verification. Do not reorder or close adjacent R8/R10/R11 items.
- **Test scenarios:** Documentation names the actual implemented boundary and does not claim broader avatar recovery or UX work.

---

## Verification Contract

| Gate | Command | Covers | Done signal |
|---|---|---|---|
| Focused DB-backed regression | `bun test packages/api/src/__tests__/agent-profiles.test.ts` | U1, U2 | Draft adoption, rollback, retry, concurrency, and existing route cases pass against local PostgreSQL. |
| API package tests | `bun run --cwd packages/api test` | U1, U2 | API deterministic test suite passes. |
| Repository test baseline | `bun run test` | U1-U3 | Workspace tests pass with no regressions. |
| Static baseline | `bun run check` | U1-U3 | Typecheck and lint pass. |
| Diff hygiene | `git diff --check` | U1-U3 | No whitespace errors or malformed patch content. |

If the focused DB-backed command reports `ECONNREFUSED 127.0.0.1:54320` in the sandbox, rerun it with real local database visibility before diagnosing PostgreSQL as unavailable.

---

## Definition of Done

- U1 is complete when completed-portrait draft consumption, profile creation, initial revision creation, and generated-avatar ledger insertion share one database transaction and retain a single-consumer guard, while skipped completions remain avatar-free and produce no generated-avatar ledger row.
- U2 is complete when the route no longer consumes drafts ahead of profile validation/creation, rollback and concurrency regressions are covered, and existing non-draft behavior remains green.
- U3 is complete when R9 is recorded as completed without broadening claims to R8, R10, or R11.
- All Verification Contract gates pass with real results.
- The branch is reviewed, pushed, and represented by a reviewable pull request with CI decided.
