---
module: API provider journal
problem_type: runtime_error
tags: [postgresql, deadlock, werewolf, ownership, championship]
---

# Provider journaling must lock game before execution owner

A real eight-agent scheduled championship fixture suspended twice. The first attempt committed 68 canonical events; the replacement stopped after seven. Accepted provider replies and private evidence remained intact, but several logical calls never reached provider dispatch. This was not an inference/scoring policy decision or a scheduling rejection.

PostgreSQL's server log established the cause: the provider journal held a `game_run_owners` lock before inserting a logical call or provider attempt. That insertion acquired a foreign-key key-share lock on `games`. A concurrent worker ownership check already held the game's update lock and was waiting for its execution owner. The lock order was inverted, including against a healthy already-running game.

`assertActiveOwner` now locks the game first, before either the execution owner or an episode-copy lease. All journal operations entering that boundary follow the same order as admission/adoption. No lease validation, canonical acceptance or stale-writer fencing is weakened; provider network calls remain outside these short transactions.

The deterministic PostgreSQL regression holds the game lock in an adoption-shaped transaction, starts journal allocation, waits for an actual `pg_stat_activity` lock wait, and then requests the owner lock. The original code deadlocks and rejects; the corrected code completes both transactions and inserts exactly one logical call. The test uses the disposable fixture database and requires no provider call.

Werewolf failure release now retains a small sanitized root-cause message/code in execution-owner diagnostics. It omits SQL parameters and large error bodies; it does not rewrite earlier failures or canonical events. Previously the useful exception existed only in the running server's console.

Actual localhost evidence is retained in `artifacts/championship/scheduler-live/` and `/tmp/champ-scheduler-deadlock-before.log`. The original failed attempt remains preserved and hidden by the existing explicit Retry game flow. See the scheduling validation report for the subsequent real run and exact final test results.
