---
title: Preserve local budgets across admission rejection and worker contention
date: 2026-10-25
module: local task budget
problem_type: integration_issue
component: service_object
severity: high
tags: [local-budget, provider-journal, concurrency, recovery, accounting]
---

# Preserve local budgets across admission rejection and worker contention

The local budget hook reserved an upper-bound charge before the provider journal checked health and fallback caps. A rejected admission never dispatched, but its full hold remained forever. Separately, an exclusive file open serialized only uncontended processes: ordinary gateway/game-worker overlap threw `EEXIST`.

Keep reservation admission before dispatch. When the underlying `onReserve` rejects, mark only the hold newly created by that invocation `not_dispatched`, preserve its original reserved amount, and set its charge to zero. Never refund a pre-existing attempt hold: it can describe an uncertain prior dispatch. Reject reuse of a `not_dispatched` attempt ID. Terminal evidence failures and incomplete usage retain their conservative charges.

Use `proper-lockfile` for process-shared ledger updates, with heartbeat, bounded retry, stale-owner recovery, and fail-closed compromised-lock handling. Atomic ledger replacement still occurs while the lock is held. Recovering a crashed lock never edits charge entries. Upgrade local workers together; remove an abandoned legacy lock file only after establishing that no old writer remains. Do not delete or reduce the ledger to recover access.

Behavioral tests launch five independent Bun processes against one allowance and prove no lost entries or overspend. Another test kills a lock owner, expires only its lock timestamp, and proves recovery preserves an uncertain audio charge. Admission tests cover circuit, fallback-budget, and journal-limit rejection plus duplicate uncertain holds. All tests use temporary ledgers and provider-free fixtures; they do not qualify live spending or change retained evaluation evidence.
