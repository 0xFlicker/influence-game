---
date: 2026-08-16
topic: ci-test-discovery
---

# CI Test Discovery Requirements

## Summary

Replace hand-maintained test allowlists with default discovery for provider-free tests. Required pull-request checks will cover normal tests, PostgreSQL-backed tests, and deterministic browser stories, while live-provider tests remain an explicit manual lane.

---

## Problem Frame

The required CI job currently provisions PostgreSQL but runs `bun run test`, whose package-level `test:mock` scripts select test files manually. That leaves the database suite and other valid tests outside the pull-request gate. A stale format-catalog expectation already reached `main` because its test file was not in the curated list.

The repository also contains several end-to-end lanes with different operational properties. Some Playwright stories are deterministic and self-contained, while staging smoke, real Clerk, and full-game model tests depend on deployed services or live providers. Treating all of them as one category either misses valuable coverage or risks adding external failures and provider spend to every pull request.

---

## Key Decisions

- **Default discovery for normal tests.** Bun discovers ordinary provider-free tests by convention. Exceptional suites use clear paths or names instead of a central allowlist that must be updated for every new test.
- **PostgreSQL is a required pull-request lane.** Database-backed tests run in their own required job, in parallel with other checks, against the PostgreSQL service CI already provisions.
- **Deterministic browser stories are required.** Public identity and deterministic layered authentication run on every pull request. The format-aware viewer joins that lane after its fixture and service setup become self-contained.
- **Deterministic failures stay visible.** Required deterministic tests do not retry, and failed browser jobs upload diagnostics while successful jobs do not create artifact noise.
- **External and paid tests stay explicit.** Staging smoke remains a post-deployment gate. Real Clerk and live-model tests remain manual and cannot spend provider credits during normal CI.
- **Manual provider runs remain flexible.** A manually triggered provider workflow runs all five live-model cases by default and accepts an optional safe test path or test-name filter rather than arbitrary shell input.

---

## Requirements

**Provider-free discovery**

- R1. Required pull-request CI must discover and run every ordinary provider-free test without maintaining a file-by-file allowlist.
- R2. Exceptional suites must be classified through clear repository conventions so a contributor can tell which lane owns a test from its location or name.
- R3. Adding an ordinary provider-free test must place it in required CI automatically.
- R4. Required provider-free lanes must not receive live-provider credentials or make paid model calls.
- R5. The full provider-free gate must run on pull requests and rerun against the exact commit merged to `main`.

**Database coverage**

- R6. PostgreSQL-backed tests must run in a separate required pull-request job and block merging when they fail.
- R7. The database job must use the repository's shared-test-database setup and preserve its sequential mutation rules.
- R8. Database failures must be reported separately from type, lint, unit, and browser failures.

**Browser coverage**

- R9. The public-player-identity Playwright story must run on every pull request because it protects public privacy boundaries, onboarding and recovery behavior, and desktop and touch interactions.
- R10. The deterministic layered-authentication Playwright story must run on every pull request because it protects consent, account creation and linking, identity collisions, wallet and email recovery, OAuth, and provider-outage behavior.
- R11. The format-aware-game-viewer Playwright story must become self-contained before it becomes required on every pull request.
- R12. Self-contained format-viewer coverage must retain its replay, reconnect, malformed-history, spoiler-safety, ballot-reveal, reduced-motion, and canonical format-presentation assertions.
- R13. Required browser tests must use local deterministic adapters and fixtures and must not call real identity or model providers.
- R14. Deterministic required tests must run with zero retries so flaky behavior remains visible and is repaired rather than masked.
- R15. Required browser jobs must upload Playwright traces, screenshots, and relevant logs only when a test fails.

**External and provider lanes**

- R16. Staging Playwright smoke must remain a post-deployment release gate rather than being folded into pre-merge CI and may retain its existing retry policy.
- R17. The real-Clerk Playwright story must remain an explicit manual external-provider run.
- R18. Full-game and agent-profile tests that can call live models must not run automatically on pull requests, pushes, or schedules.
- R19. A manual GitHub workflow must run all five live-model cases by default and may narrow the run with an optional validated Bun path or test-name filter.
- R20. Manual filter input must be treated as data and must not permit arbitrary command execution.

---

## Acceptance Examples

- AE1. **Covers R1-R5.** Given a contributor adds a normal provider-free `*.test.*` file in a conventional test location, when pull-request CI runs, then Bun discovers and executes it without a workflow or manifest edit; after merge, the same gate verifies the exact `main` commit.
- AE2. **Covers R6-R8.** Given a database-backed regression, when the PostgreSQL lane runs, then that required job fails with database-specific output and the pull request cannot merge.
- AE3. **Covers R9-R15.** Given a pull request with no provider credentials, when deterministic browser CI runs, then public identity, layered authentication, and the self-contained format viewer execute once against isolated local services and fixtures; a failure is reported without retry and uploads its diagnostics, while a successful run uploads no browser artifact bundle.
- AE4. **Covers R16-R18.** Given ordinary pull-request CI, when all required lanes run, then staging, real Clerk, and live-model tests are not invoked.
- AE5. **Covers R19-R20.** Given a maintainer manually starts the provider workflow without a filter, then all five live-model cases run; given a valid path or test-name filter, only the matching cases run without interpreting the input as a shell command.

---

## Success Criteria

- Every normal provider-free unit, integration, database, and deterministic browser test is covered by a required pull-request lane.
- New ordinary tests cannot be silently omitted because a curated file list was not updated.
- Pull-request CI incurs no live-model or real-identity-provider spend.
- Failures identify whether the problem is static analysis, provider-free tests, PostgreSQL behavior, or deterministic browser behavior.
- Staging and external-provider validation keep their existing operational purpose and do not become prerequisites for local deterministic coverage.

---

## Scope Boundaries

- This work changes test discovery, classification, and CI execution; it does not change product behavior.
- It does not add a meta-test that parses GitHub Actions workflows or attempts to prove lane coverage from workflow command text.
- It does not replace the existing staging deployment smoke gate.
- It does not make real Clerk or live-model tests required, scheduled, or automatic.
- It does not add arbitrary command inputs to GitHub workflows.
- It does not require one job per package when fewer clearly named lanes provide equivalent coverage.

---

## Dependencies and Assumptions

- Local and CI database tests continue to use `setupTestDB()` and its advisory lock rather than concurrent mutation of the shared test database.
- The public identity and deterministic layered-authentication Playwright harnesses remain isolated from live providers.
- The format-aware viewer fixture can be made self-contained without weakening its current assertions.
- Repository branch protection can require the new PostgreSQL and deterministic browser jobs.

---

## Outstanding Questions

### Deferred to Planning

- What exact directory and filename conventions distinguish normal, database, deterministic browser, external-provider, and live-model tests.
- Whether deterministic Playwright stories share one job or split for clearer failure reporting and runtime.
- Which dependency and browser caches keep the required lanes fast without weakening isolation.
- How the format-viewer fixture database and local services are created and torn down hermetically.

---

## Sources

- `.github/workflows/ci.yml`
- `.github/workflows/e2e-staging.yml`
- `package.json`
- `playwright.config.ts`
- `e2e/public-player-identity.spec.ts`
- `e2e/layered-authentication.spec.ts`
- `e2e/format-aware-game-viewer.spec.ts`
- `e2e/smoke.spec.ts`
- `scripts/e2e-test.ts`
- `AGENTS.md`
