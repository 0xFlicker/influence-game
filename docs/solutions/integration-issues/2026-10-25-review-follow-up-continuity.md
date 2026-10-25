---
module: integration-continuity
problem_type: integration_issue
status: validated-locally
tags: [durable-execution, retrospective, audio, cutouts, studio, local-budget]
---

# Preserve execution and frozen media across integration boundaries

An independent review of `3e2eb45f` found six gaps beyond the earlier twelve-fix
report. The failures crossed otherwise passing unit boundaries:

- Diary interviews still used fail-fast parallel batches inside a durable turn.
  Both living-player and jury batches now drain before propagating failure.
  A follow-up review found that draining a whole interview could start new calls
  after a sibling's fatal journal failure. Each session now latches fatal errors
  and fences subsequent House/agent calls and provider attempt admissions while
  retaining in-flight draining. Retry, fallback and context calls inherit the
  session fence. Attempts already inside reservation finish normally, and the
  first fatal error is preserved after every interview settles.
  Regression tests cover all four question/answer boundaries for living players
  and jurors, legal provider absence, and a fresh session after failure.
- The editorial retake CLI omitted the optional local task-budget hook. Its
  existing file journal now participates in that guard when explicitly configured;
  no default spending ceiling was added.
- Solo-night targets were omitted from Werewolf retrospective action facts, and
  private explanations were labeled public. New accounts retain targets and
  actor-only provenance. Already-frozen accounts recover only through a complete
  matching definition, including their original speaker-context projection.
- Cutout generation configuration also gated existing derivative reads. Disabled
  generation now stops new demand/worker activity while authorized reads preserve
  completed images and publication cutoffs.
- Source-thinking navigation deleted an MCP review parameter used as a React key.
  Preview preferences now preserve the review identity and selected-cut state.
- Studio audio used public visibility and byte URLs. Producer-authorized audio
  reads now support hidden games, with browser media loaded through the existing
  authenticated session and verified against its stored hash. Public hiding and
  audience, game, recipe and version boundaries remain enforced.

Regression coverage includes delayed diary siblings, frozen pre-fix retrospective
hashes, disallowed/exhausted local retakes, generation-disabled character bytes,
an actual Studio component navigation, and hidden-game audio authorization.
Validation uses provider-free tests and disposable PostgreSQL databases. No
historical games, profiles, selections, renders or stored evidence are rewritten.
No deployment or paid generation is part of this repair.

Local validation on 2026-10-25:

- `bun run test`: 3,029 passed, 5 skipped, zero failures.
- `bun run test:postgres --shard=N/4` for all four shards: 2,252 passed,
  zero failures across 201 files. Each shard used its own disposable database
  and one sequential Bun test process; all four databases were dropped afterward.
- `bun run check`: all workspace typechecks and lint checks passed.
- Focused PostgreSQL regressions: 31 audio/Studio tests and 19 cutout tests passed.
- The existing hard-smoke-rune selection retained SHA-256
  `8a8a127f0c0a5958f68eafa03958682a71f0c72bf940909a502ea2f1b0a8c019`.

These checks do not establish a completed end-to-end MP4 export or production
deployment. Existing selections and rendered artifacts were preserved.

The diary admission-fence follow-up passed `bun run test` (3,042 passed,
5 skipped), all four isolated `bun run test:postgres --shard=N/4` shards
(2,252 passed), and `bun run check`. Independent focused review passed 35 tests,
including the original follow-up and internal-retry reproductions. An earlier
superseded run timed out during render-proof database teardown; the final full
run passed that cleanup and every test with zero failures. All disposable
databases were removed. Final logs are `/tmp/diary-fence-final-provider-free.log`,
`/tmp/diary-fence-final-check.log`, and `/tmp/diary-fence-final-postgres-{1,2,3,4}.log`.
