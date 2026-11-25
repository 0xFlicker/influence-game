---
title: "Game asset implementation tasks"
date: 2026-09-25
status: implemented-banner-use-confirmed
plan: docs/plans/2026-09-25-003-feat-game-assets-plan.md
origin: docs/brainstorms/2026-09-25-game-assets-brainstorm.md
---

# Game asset implementation tasks

Reconciled November 25, 2026 against [merged PR #153](https://github.com/0xFlicker/influence-game/pull/153) and the [operator validation record](../deployment/game-assets-operator-review.md). The [original checklist](https://github.com/0xFlicker/influence-game/blob/3d50e591ba3236fc73ce19bc3cfc1e0bed46f43d/docs/plans/2026-09-25-003-feat-game-assets-tasks.md) preserves the planning assumptions and detailed test cases.

## Completed implementation and local checks

- [x] **T0–T1.** Migration `0100_game_assets` and the scoped OAuth routes shipped. Producer and Sysop manage images through `manage_game_assets` and explicit `assets:manage` consent.
- [x] **T2–T3.** Immutable normalized PNGs, revisioned metadata, upload receipts, bounded reads and the CRUD API shipped. The delivered reader policy follows game access. Public-game images are readable signed out, including images labeled `spoiler`.
- [x] **T4–T5.** The Bun CLI supports scoped login, upload, inspection and download. One banner per game appears on results. The browser checks covered anonymous access, navigation and late discovery.
- [x] **T6.** Replacement, revision-fenced metadata edits and deletion, operation lookup and interrupted-object cleanup shipped.
- [x] **T7.** The [asset guide](../game-assets.md) and [repository skill](../../.agents/skills/manage-game-assets/SKILL.md) document the delivered commands and visibility contract.
- [x] **T8 local validation.** PR #153 recorded 2,028 provider-free and 1,758 PostgreSQL tests passing, successful typecheck/lint, browser coverage and a real local MinIO/CLI round trip.

## Deployed use

- [x] **Banner upload and display.** On November 25 the operator confirmed repeated successful uploads and display on game results. This closes the banner activation question.

Local tests cover deletion and cleanup. Future changes to OAuth, ingress or storage can use the [ephemeral or staging procedure](../deployment/game-assets-operator-review.md#ephemeral-or-staging-acceptance) with disposable data.
