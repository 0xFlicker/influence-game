---
title: Game retrospectives main integration and pre-PR review
date: 2026-10-11
status: draft_pr_quality_and_staging_pending
branch: codex/game-retrospectives
integration_head: b85daaef
main_revision: f303df40
---

# Main integration and pre-PR review

This record describes the original combined branch. Delivery has since been split: [Studio PR #174](https://github.com/0xFlicker/influence-game/pull/174) targets main, and #173 is stacked on `codex/production-studio`. Its inherited Studio/Werewolf changes are reviewed in #174. Earlier head-specific proof below remains historical; new split validation is reported in the PR descriptions.

`codex/game-retrospectives` merges `origin/main` at `f303df40`. The merge preserves main’s on-demand renderer-wake contract and Werewolf village/pack portrait rooms, plus the branch’s required retrospective final boundary, solo epilogue presentation and Studio/export behavior. The branch includes its committed Production Studio and Werewolf-flow prerequisites; the PR against main contains those changes too.

## Resolved integration findings

- Both branches added migration 0113. Main’s `0113_render_wake_outbox` stays unchanged. The three unreleased branch migrations become `0114_production_moment_annotations`, `0115_game_retrospective_inputs` and `0116_retrospective_recovery_scope`, with journal timestamps after main’s 0113. SQL contents stay unchanged. The journal preserves the complete main prefix, unique indices/tags, ascending timestamps and existing files. Release policy accepts all three additions, and fresh PostgreSQL fixtures apply the entire chain.
- Main’s portrait-room contract uses presentation participants rather than full gameplay-player DTOs. Export thinking rooms now reuse that exact participant type. Rules-v8 test fixtures and the new browser fixture supply the required retrospective methods.
- Portrait readiness keeps main’s cached/load behavior and the branch’s hidden-speech presentation support. Retrospectives remain solo even with a published scene and an eliminated actor. The regression checks that actor’s portrait, accepted speech, revealed role and canonical exit/outcome label.
- The first Werewolf encoded check failed after producing its movie because the test helper signaled an already-exited process group. Successful render/verification commands own browser teardown; both proof helpers now reserve group cleanup for failure. The affected Werewolf proof passed on rerun. Failure cleanup remains explicit.
- The candid prompt revision in `f70ae7cc` is preserved. Current guidance targets 40–75 words and requests at most 1,000 code points; the strict artifact ceiling remains 2,000. Current docs distinguish those limits and state that earlier paid trials do not qualify the revised prompt.

## Validation after integration

| Check | Result and scope |
| --- | --- |
| `bun run test` | 2,579 passed, five existing skips, zero failures across 268 files. Full provider-free baseline before the new eliminated-player regression; affected tests rerun below. |
| `bun run test:postgres` | 2,019 passed, zero failures across 178 files. Fresh disposable database with the complete migration chain; shared database untouched. |
| `bun run check` | Final workspace typecheck and lint passed after all integration/helper edits and restoration of generated Next configuration. |
| Focused replay/export/portrait-room tests | 74 passed, zero failures across 11 files, including the new regression. The redirect fixture needs loopback access; its sandbox-only bind failure disappeared with the required access. |
| Five deterministic browser journeys | All passed: Werewolf desktop/mobile portrait rooms; anonymous/shared source links; Werewolf faction/draw results and Mystery isolation; Influence MCP replay link; paused retrospective growth and reconnect. |
| Actual Studio to encoded movie | Influence and Werewolf retrospective cuts passed, including frozen selection/source identity, Studio/movie pixel comparisons and offline reverse/random/range/fresh-browser proof. The initial Werewolf cleanup failure and successful rerun are recorded above. Visual inspection of both encoded midpoints confirms readable solo portraits, speech and canonical exit/outcome labels. |
| Migration policy and whitespace | All three branch migrations accepted; journal invariants, no conflict markers and diff whitespace checked. |

Transient local evidence lives under `/private/tmp/rt15-main-review/`: `provider-free.log`, `postgres.log`, `check-final.log`, `export-unit-elevated.log`, `browser.log`, `encoded.log`, `encoded-werewolf-retry.log` and `migration-final.log`. The review database was dropped; browser harnesses cleaned their databases and children. Generated Next configuration was restored.

## Source review

Primary review covers merge resolutions, migration authority/order, prompt and strict-artifact limits, both engine final boundaries, frozen source/prior identity, owner fencing, explicit recovery authorization, result-versus-completion behavior and Studio/export presentation. The confirmed integration findings above are resolved and verified. This pass established no additional actionable defect; it is not an exhaustive audit of every prerequisite change. The earlier integrated [source audit](2026-10-11-game-retrospectives-local-acceptance.md) remains scoped to its recorded head.

Two fresh Grok sessions read numbered runtime/recovery and presentation/export source bundles. The initial inspection and bounded final-report attempts did not produce a final review report and were interrupted after roughly 20 minutes of combined wall time. A lower-reasoning final-summary attempt also remained unconcluded. These are **incomplete external reviews**, not clean review results. They performed no edits, game generation, tests or deployment. Their source-bundle read activity was inspected; no additional repository investigation is claimed.

Raw attempt logs are `grok-runtime.log`, `grok-presentation.log`, their `*-final.log` continuations and `*-conclusion.log` attempts under `/private/tmp/rt15-main-review/`. A concluded fresh external source review remains pending before marking the PR ready. The larger Studio/Werewolf prerequisite scope and the supplied-source limits remain visible.

## Remaining acceptance

This is suitable for a draft PR, with fresh external review, model-quality and staging acceptance still pending. The [paid trials](2026-10-11-game-retrospectives-model-quality.md) found four factual mistakes and weak voice/prior engagement despite mechanical delivery of all 20 statements. They precede the shorter candid prompt. No fresh paid game trial, staging/production deployment or main merge occurred during this review. Fresh paid qualification needs a separately authorized spending cap. Staging must prove deployed continuation/adoption, recovery/drain, current web/MCP delivery and export for both games before release acceptance.
