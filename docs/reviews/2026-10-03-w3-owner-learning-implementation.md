---
title: W3 owner learning implementation proof
date: 2026-10-03
status: local-validation
---

# W3 — local implementation and remaining acceptance

Implemented in `/Users/user/.codex/worktrees/werewolf/influence-game`, branch `codex/werewolf`, from `a1a3eda0`. [Approved plan](../plans/2026-10-03-001-feat-werewolf-owner-learning.md). No commit, push or deployment was requested.

## Delivered

- Both game kinds use the existing owner review service, credit balance, durable worker, cost receipts, retry/resolution, dashboard and MCP tools.
- Werewolf custom completions explicitly qualify. Selection remains one owned profile, one game kind, one current strategy family and one-to-three completed games. Multiple owned cast members do not multiply earned credit or mark each other's games as already analyzed.
- Werewolf evidence replays canonical decisions, checks planned request/observation hashes and verifies accepted thinking artifacts. Each decision retains the actor's exact prior knowledge. Final faction result and later public outcomes are separate; other actors' private thinking/night choices are excluded.
- Werewolf does not inherit Influence's death/early-exit health-check rule. Missing thinking remains missing; supported no-change is valid.
- Proposal scope is server-owned. Werewolf apply writes only `werewolfStrategyStyle`; Influence writes only `strategyStyle`. Shared behavioral changes invalidate Werewolf proposals, unrelated Influence strategy changes do not, and pending moderation prevents apply. Manual edits use the same locks and resolution rules.
- Results entry and review pages use the existing House workflow. Kind selection survives the entry URL. Decision disclosures provide facts, thinking, conversation and Omniscient source links; before/after identifies the correct strategy and distinguishes a default from a saved override.
- All new review requests and fingerprints use `gpt-6-luna`. Prompt/schema/provider-policy versions changed so historical checkpoints cannot silently resume under the new model policy.
- Migration 0107 follows branch migration 0106, adds explicit kind/raw-strategy fields, and detaches review identities from Influence rating-revision foreign keys. Existing rating/gameplay authority is unchanged.

## Validation

| Proof | Result |
| --- | --- |
| `bun run test` | 2,212 pass, 5 existing skips, 0 fail across 219 files. |
| `bun run test:postgres` with disposable `influence_w3_test` | 1,850 pass, 0 fail across 158 files. This full baseline preceded the final additional boundary cases; the focused suite below covers those additions and final owner-learning changes. |
| Final focused owner-learning and MCP suite | 136 pass, 0 fail across 16 files; includes the final model fingerprint, manual-update, cross-game and MCP cases. |
| `bun run check` | All workspace typechecks and lint pass on the final source state. |
| Focused web owner-review/editor suite | 53 pass, 0 fail. |
| `owner-learning-werewolf.e2e.test.ts` | 1 pass, 0 fail; real browser, local API/web and a per-process migrated database. Provider key absent. |
| Migration chain | Fresh isolated databases successfully apply the entire branch migration chain including 0107. A populated production migration rehearsal has not been run. |

The browser journey exercises completed-results entry, model-free preview without purchasing, owner-only villager evidence, replay URL, 390px overflow checks, a persisted synthetic proposal and actual REST apply. It verifies the saved Werewolf strategy and preserved Influence strategy. Screenshots were inspected locally at `/tmp/w3-preview-mobile.png`, `/tmp/w3-review-mobile.png` and `/tmp/w3-applied-desktop.png`; mobile capture waits for the entry animation to finish. The proposal is deliberately synthetic, not coaching-quality evidence.

The focused tests cover Seer/Doctor/pack observations, absence of another owned wolf's thinking, altered observation hashes, mixed kinds, wrong owner, shared credit, no-change through the durable worker, pending moderation, apply/idempotency, linked manual update and supersession. Existing Influence suites cover durable recovery, receipt/cost idempotency, malformed provider output, source-handle validation, credit concurrency and REST/MCP authorization. The new Werewolf MCP test verifies list/preflight/start/resume/read/apply and output schemas through the registered server. It is not real-host OAuth or ChatGPT connector acceptance.

The shared local test database had unrelated migration history, so testing used a disposable branch database. The browser harness creates and destroys its own databases and servers. No paid provider runs or simulations were performed.

## Self-review resolutions

- Found a stale `gpt-5.6-luna` in worker request hashing after correcting provider construction; replaced it with the shared model constant.
- Kept raw editable strategy freshness separate from the resolved default fingerprint. Null/default transitions and pending drafts cannot accidentally authorize an old proposal.
- Audited manual update and automatic supersession, not only the apply endpoint. Incorrect game-field edits roll back and produce the existing public conflict code.
- Collapsed detailed decision lists so the review result and proposal remain reachable on mobile. Removed opaque Werewolf fingerprint fragments from user-facing revision labels.
- Added typed Werewolf strategy targets to both API and MCP proposal contracts. MCP prose remains untrusted and mutation requires the existing exact-proposal approval instructions.
- Kept final public outcomes separate from actor observations; no completed Omniscient state is injected into earlier knowledge.

## Remaining before declaring W3 complete

WR-04 is intentionally pending: operator-selected real games and budget, paid `gpt-6-luna` calibration, review of accepted and rejected advice, and explicit qualitative approval. No claim of improved strategy or win rate is supported by these deterministic tests. Missing real-game examples are recorded when selecting that packet.

A deployed acceptance pass, populated migration rehearsal and real MCP-host owner flow remain release/operator checks. Long-game snapshot sizes and eligibility latency should be measured during calibration; the current implementation preserves exact observations and bounds model context, not arbitrary-length owner read payloads.

Reusable integration knowledge and the next-game checklist are in [House owner learning across game kinds](../solutions/architecture-patterns/house-owner-learning-across-game-kinds.md). House Cuts, trailers, music/art exploration and production-studio refactoring remain separate roadmap work.

## Follow-up — admin review ledger integration

A completed Werewolf review exposed a missed admin read-path join: requiring an Influence analytical revision excluded Werewolf reviews entirely. Changed that join to an optional Influence-only lookup, carried game kind through list/detail DTOs, and labeled the Werewolf strategy identity without a revision ordinal. Existing reviews appear without data repair or another provider call.

Verification: the corrected service read the operator's exact completed review from the local development database, including all four calls, and found it in the ledger list. The four focused PostgreSQL admin tests pass, including new running/no-change Werewolf list/detail/accounting coverage and existing Influence/authorization checks. Provider-free baseline: 2,213 pass, 5 skips, 0 failures. Full PostgreSQL baseline on disposable `influence_w3_ledger_test`: 1,853 pass, 0 failures across 158 files. The disposable database was removed after validation. Typecheck and lint pass. The browser session was signed out, so authenticated browser acceptance is not claimed. No paid calls or development-data mutations were performed.

The architecture learning and next-game checklist now explicitly include operator read models, identity joins, diagnostic receipts and aggregate accounting.

## Follow-up — final assessment contract

A review with one selected investigation reached final drafting on logical call three. The harness required a final result locally but still sent `finalResultRequired: false` and the nullable provider schema; both the initial attempt and owner retry returned intermediate findings with no final assessment. Final drafting now always selects the existing strict final-result schema and sets the requirement flag, regardless of unused call budget. Tests exercise drafting on calls two and three, valid no-change results, and rejection of a missing final result. The existing fourth-call requirement is preserved.

Validation: 12 focused harness tests, 2,216 provider-free tests (5 skips), and 1,855 PostgreSQL tests pass; typecheck/lint and diff whitespace checks pass. API tests used a disposable database, removed afterward. The reported failed review was inspected read-only and retains its two completed steps and exhausted retry history. No paid rerun, fabricated result, retry reset or development-data repair was performed.
