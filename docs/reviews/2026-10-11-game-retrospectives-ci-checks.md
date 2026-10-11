---
title: Game retrospectives PR 173 CI repair
date: 2026-10-11
status: local_verification_record
branch: codex/game-retrospectives
reviewed_head: 356203f3bf09eb256c25362f01a1bc874c615b91
pull_request: https://github.com/0xFlicker/influence-game/pull/173
---

# PR 173 failing checks

The first PR run failed three browser jobs. Typecheck/lint, provider-free tests, API/PostgreSQL tests, layered authentication and both PR image builds passed. Release/deployment jobs were skipped as expected for a PR. Diagnostics came from the Code Review check reader and, for the truncated API browser job, the GitHub connector's complete job log.

## Findings and fixes

| Failed job | Evidence | Repair |
| --- | --- | --- |
| [Public identity](https://github.com/0xFlicker/influence-game/actions/runs/38177467607/job/114582777870) | One failure stopped the serial suite: the old episode-production heading and batch controls no longer exist. | Mock the bounded Production Studio library and episode reader; assert the current naming review/queue flow, 25-item page limit and cleared selection after search. Exact preview/queue request assertions remain. |
| [Format viewer](https://github.com/0xFlicker/influence-game/actions/runs/38177467607/job/114582777722) | Eight failures: completed fixtures lacked canonical outcome/retrospective completion, two assertions expected obsolete suspended-game copy, and the mocked watch contract omitted mandatory retrospective progress. | Seed one complete canonical ending and its captured speech, use watch schema v6 with a checked DTO, and assert current paused-game copy. |
| [API browser stories](https://github.com/0xFlicker/influence-game/actions/runs/38177467607/job/114582777811) | Six failures, 54 passes and five optional proof skips: bare completed result fixtures blocked banner/season/House result surfaces; the admin journey expected Werewolf rules v7; a recovery story used a panel path unavailable when its partial game source fails closed. | Add canonical completion to completed game fixtures, keep unfinished Werewolf fixtures unfinished, assert rules v8, and open recovery through the independent Episode tools entry point. |

The shared Studio fixture now consumes the completed format seed once rather than appending a second ending. Its original thought/speech entries retain sequences 1–2; retrospective speech starts at 3. The existing PostgreSQL source tests verify canonical speech linkage, frozen selections and privacy boundaries with the updated fixture.

The repaired Werewolf admin story exposed a second issue locally: its thinking helper could accept the previous session's stage during audience navigation, skip checking for the new opening, then wait for recorded play while the opening continued. The helper now waits for the new opening and uses the existing explicit skip helper. Both callers are rerun.

All repairs are in test fixtures, browser assertions/helpers and this review record. Runtime completion checks and authorization remain unchanged.

## Local verification

| Check | Result |
| --- | --- |
| Full Format viewer browser suite | 49 passed, zero failures. |
| Full Public identity browser suite | 14 passed, zero failures. |
| Six affected API browser stories | All six passed: five in the initial focused run; Werewolf admin passed after the navigation helper repair. |
| Both thinking-helper callers | Werewolf admin and standalone desktop/mobile thinking stories passed on the final focused rerun. Seven distinct API browser stories passed across the two focused runs. |
| Studio, Influence source, Werewolf source and format fixture PostgreSQL tests | 34 passed, zero failures, 283 assertions across four files. |
| Workspace typecheck/lint | Passed after all test/helper edits. |
| Test classification and diff whitespace | Passed; all 471 test files classified. |

Transient evidence is in `/private/tmp/rt15-ci-*.log`. Browser harnesses own isolated databases and server cleanup; the disposable `influence_rt15_ci_20261011_b44a` PostgreSQL database was dropped after its successful run. Generated Next configuration is restored before committing.

Fresh remote CI remains required after pushing the repair. The [pre-PR review](2026-10-11-game-retrospectives-pre-pr-review.md) still governs the pending external source review, revised-prompt model qualification and staging acceptance. This repair does not run paid trials, merge main or deploy staging/production.

## Second CI run: `09d31f24`

Remote CI confirmed that Public identity, Format viewer, layered authentication, API/PostgreSQL, typecheck/lint and both PR builds passed. Two jobs still failed:

- [Provider-free tests](https://github.com/0xFlicker/influence-game/actions/runs/38179951681/job/114590202988): ten Werewolf API reporter tests exceeded the default five-second deadline while repeatedly building the same complete match. Their unfinished async work then tried writing reports after per-test cleanup, producing secondary `ENOENT` errors. The failed-pack fixture already had a longer deadline and passed in 9.9 seconds. Reporter tests now build the two deterministic canonical games once in a bounded 30-second `beforeAll`, then clone each readback for test isolation. The reporting assertions retain their original deadlines and coverage. The focused suite passes all 14 tests with 140 assertions; individual reporter tests complete in milliseconds after setup.
- [API browser stories](https://github.com/0xFlicker/influence-game/actions/runs/38179951687/job/114590202955): 59 passed, five optional proofs skipped, and Werewolf admin failed while expecting a sampled ballot-ledger count to decrease after rewind. Pausing and ledger rendering can commit after the sampling read. The helper now waits for the paused control, seeks the last canonical ballot, verifies all receipts, and rewinds to verify exactly one fewer receipt. It still exercises collection animation, abstention visibility, unchanged recorded cursor and silent abstention presentation.

The final full provider-free baseline passed: 2,580 tests, five existing skips, zero failures, 19,852 assertions across 268 files. The repaired Werewolf admin journey passed with 52 assertions; final workspace typecheck/lint and diff whitespace passed. Evidence uses `/private/tmp/rt15-ci-r2-*.log`. The initial sandboxed full baseline could not bind its local HTTP/proxy fixtures; the successful run used the required loopback access. A complete API browser rerun and the new remote CI run also verify the repair in full-suite context; their live results are separate from this commit-time local evidence.
