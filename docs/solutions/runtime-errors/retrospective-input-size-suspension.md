---
title: Retrospective input size must not suspend a completed competition
module: Retrospective initialization and storage
problem_type: runtime_error
date: 2026-10-16
tags: [retrospective, storage, recovery, context-size, postgres]
---

# Retrospective input size must not suspend a completed competition

Production `mild-amber-node` retained a valid winner and event head but suspended with `invalid_context` before any retrospective statement. Reconstructing the facts-only account from producer events exceeded the 256 KiB application/database ceiling even before dialogue. Production retained only the typed code, so this established a reproducible blocker rather than the exact first thrown validation message.

The byte cap was application policy, not an evidenced database or provider limit. Tests checked rejection instead of showing that full supported games could finish. Both the compact-JSON guard and PostgreSQL's formatted-JSON guard blocked valid input. Removing only one would leave the other failure path intact.

The immediate operator-authorized repair removes both guards and the SQL CHECK through additive migration `0118_retrospective_input_size`. It also changes advisory model-size preflight into observability only. Exact shape, source, roster, hash and immutable-input validation remain. Existing inputs, failure identities and outcomes are unchanged; the normal explicit recovery operation can restart initialization after deployment.

Regression coverage includes large Unicode/escaped JSON through the production writer, existing-row preservation during the migration, small advisory budgets with complete Influence/Werewolf input, and an initialization-suspended Influence game resuming to a complete mocked retrospective with a large saved account and unchanged outcome. These are local deterministic proofs, not paid-provider or production execution evidence.

This is explicitly not the final storage architecture. The first two entries in `docs/refactor-queue.md` require migration of all existing retrospective documents to private buckets, then all other database binaries/documents, plus removal of all context-size-only game failures and provider overflow adaptation. Large bodies belong in storage with relational references and integrity metadata. Do not reintroduce an invented cap or silently truncate accepted history. Keep exact types without `as any`; call House methods directly.
