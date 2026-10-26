# Integration review fixes — 2026-10-25

Branch: `codex/overnight-local-integration`. Fixes follow the 12-finding review of
`9eaa3483`. Validation is local and provider-free; no deployments, paid generation,
or development game/profile mutations were performed.

| Finding | Resolution | Regression evidence |
|---|---|---|
| 1. Read-only MCP routing mutation | Separate optional `producer:routing` consent, client envelope, handler gate, and existing current-role/waiting-game checks. Migration 0139 preserves existing grants. | `model-routing-mcp.test.ts`, OAuth/server tests |
| 2. Historical Influence ballots rejected | New games freeze contract v2. Unversioned accepted values validate against the exact original or integration speech shape, without provider redispatch. | `influence-decision-replay.test.ts`, agent structured-output tests |
| 3. Parallel calls outlive owner | Drain all dispatched provider calls before propagating failure; retain roster-order commits. | Influence decision-speech and phase/provider tests |
| 4. Historical Werewolf export hashes change | Explicit new projection version; finite historical catalog/reference contracts identified by full original hash. | Literal origin/main fixture, Werewolf source and presentation tests |
| 5. Successors invalidate frozen audio | Resolve exact versions through original game-scoped track, recipe and publication frontier; validate frozen source text and audience. | Audio recovery, retake, House audio and export tests |
| 6. Durable Influence tags lost | Join accepted attempt identity to transcript/cognitive decision provenance, exclude uncommitted turns, retain historical source hashes. | `influence-audio-annotations.test.ts` |
| 7. Nonreasoning models receive invalid options | Gate reasoning summaries and Flex on frozen capabilities. | LLM client/provider adapter tests |
| 8. Rejected admission consumes local budget | Preserve zero-charge `not_dispatched` receipts only for newly reserved attempts proven not dispatched; retain uncertain holds. | Local budget admission tests |
| 9. Cross-process budget lock fails on contention | Heartbeat locks serialize writers, retry bounded contention, recover abandoned owners. | Five-process contention and killed-owner tests |
| 10. Source view changes cut recordings | Prepare media for preview and selected cut independently of preview thinking preference. | Generated-audio export schedule parity |
| 11. Speech overage retries lack feedback | Supply clean draft, UTF-8 measurements and overage to retry policy. | Agent structured-output length repair tests |
| 12. Storage inventory uses TS property name | Use SQL `response_audio`; validate all registry entries against real migrated schema. | Storage payload migration tests |

Historical evidence is never regenerated or rewritten to make a descriptor pass.
Old descriptors cannot reconstruct external appearance maps or rendering compiler
inputs that were never retained; source integrity remains strict. Current and new
playback still skip discussion passes. Exact legacy export reconstruction is
restricted to saved hashes and IDs.

Validation:

- `bun run test`: 3,019 passed, 5 skipped, 0 failed (3,024 tests, 321 files).
- `bun run check`: all workspace typechecks and lint passed.
- Focused real-journal historical replay: 2 passed; real HTTP routing consent: 2
  passed; expanded source/Studio/audio PostgreSQL checks: 32 passed, followed by
  10 final source checks. All used isolated disposable databases.
- Final PostgreSQL gate: 2,241 passed, 0 failed across all four fresh
  `bun run test:postgres --shard=N/4` processes (603 / 483 / 566 / 589 tests),
  each sequential within its own isolated database; all four exited 0. The initial full
  run overlapped the last visual-refresh edit and loaded the older module before
  its new test, so that mixed-source run is not the final validation result.
- `git diff --check`: passed. Temporary databases were removed after validation.

Logs are retained locally at `/tmp/influence-fixes-provider-free-final.log`,
`/tmp/influence-fixes-check-complete.log`, and
`/tmp/influence-fixes-postgres-final-{1,2,3,4}.log`.
