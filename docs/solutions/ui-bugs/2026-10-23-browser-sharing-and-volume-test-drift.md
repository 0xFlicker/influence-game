---
title: Keep browser journeys aligned with sharing and mobile controls
date: 2026-10-23
module: Browser coverage
tags: [testing, sharing, replay, mobile, ci]
problem_type: integration_issue
---

Browser Coverage remains non-blocking for merges and releases. Its failures still
need investigation; a green core CI run is not evidence that these journeys pass.

The short-link and compact-transport changes left older browser tests exercising
removed UI. Share is an icon that opens a preparation dialog, followed by a fresh
Share or Copy gesture. The clipboard contains a short URL, not the old canonical
replay path. Assert the prepared dialog and feedback, resolve the short link, and
check the saved game, audience, cursor/cue and playback settings. Scope status
assertions to the share dialog after preparation completes. Synthetic viewer
fixtures mock link creation/resolution; the API browser journeys verify real
short-link persistence and resolution.

Below 400px of transport width, Music volume lives in Player settings. Mobile
tests must open that panel, check the slider's bounds and saved value, and close
it before exercising the transport. Desktop tests still exercise inline volume.

Embed restoration tests must pause before unrelated metadata assertions consume
time at the restored playback speed. Click diagnostics proved Next's development
badge intercepted a native Pause click (`nextjs-portal` was the event target).
Disable `devIndicators` for the existing E2E harness environment, and assert the
player actually paused rather than treating a completed click as success.
Explicitly foreground the player when
returning from app/crawler tabs, and verify paused state before a native Home-key
seek to frame zero. Keep the existing cue, settings and timing assertions; do not
turn a delayed automation click into a larger allowed restoration error.

The first PR #218 CI run still exceeded the restoration tolerance on a slow
runner: the Werewolf mini-app had played 2.275 seconds before the native Pause
click. Use Playwright's controlled clock for this API browser journey. Install
the clock before navigation, freeze it before restoring the saved link, advance
startup timers until the transport is ready, and pause with a native click.
Resume normal time after verifying paused state. This preserves the real
short-link API, saved cue/settings assertions, and original timing tolerance
without making restoration depend on automation latency. Metadata elements need
`state: "attached"` when waiting with Playwright because they are never visible.

Cancelled browser jobs are eligible to upload available failure artifacts. A
forced runner termination can still prevent upload or service-log flushing.
Dependency installation consuming a job's time budget is separate from an
assertion failure; inspect step timings before changing test deadlines.

In [PR #218's first run](https://github.com/0xFlicker/influence-game/actions/runs/39979803884),
the identity job spent 11 minutes 27 seconds downloading browser dependencies
from Ubuntu's Azure mirror, leaving less than three minutes for its 18 tests.
The entire identity suite passed locally in 2.5 minutes. Browser jobs now use the
official Playwright image with browser system packages already installed. Keep
its version aligned with `bun.lock`; container jobs reach the PostgreSQL service
at `postgres:5432`. Only the small `unzip` prerequisite for Bun setup needs apt;
Puppeteer jobs still install their own matching Chrome binary. Job deadlines and
non-blocking merge policy remain unchanged.

Focused validation commands:

```sh
PLAYWRIGHT_FORMAT_VIEWER=1 bunx playwright test e2e/format-aware-game-viewer.spec.ts --grep 'Influence opening|shared Influence moment' --retries=0
cd packages/api
DRIZZLE_MIGRATIONS_DIR=./drizzle bun test --config=../../bunfig.browser.toml ./src/e2e/player-card.e2e.test.ts --max-concurrency 1
DRIZZLE_MIGRATIONS_DIR=./drizzle bun test --config=../../bunfig.browser.toml ./src/e2e/werewolf.e2e.test.ts --test-name-pattern 'House entry is anonymous|House replay music follows' --max-concurrency 1
```

Run browser harnesses serially within one checkout: their databases are isolated,
but their Next development output directory is shared. Use a fresh task-owned
database for the PostgreSQL baseline if the shared database's migration history
belongs to another checkout; do not repair that history incidentally.

The merged-main run [39973906908](https://github.com/0xFlicker/influence-game/actions/runs/39973906908)
also timed out opening the Sysop scene-production dialog. That journey passed in
isolation during this investigation; its intermittent CI failure is not established
as fixed by the sharing/volume changes. Keep it distinct from the confirmed drift
and the observed development-overlay interception.

Local validation on October 23: all 55 format-viewer stories, all six player-card
stories, both focused Werewolf journeys, and the isolated Sysop recovery journey
passed. The provider-free baseline passed 2,777 tests (five skips); the PostgreSQL
baseline passed 2,148 tests in a fresh database, which was dropped afterward.
Repository typecheck/lint and diff whitespace checks passed. This is local proof,
not a claim that the entire Browser Coverage workflow is now reliably green on CI.

Follow-up validation after the first PR run: all 18 identity tests passed in
2.5 minutes and all six player-card tests passed with controlled restoration
time. Typecheck/lint, test classification and actionlint passed; the pinned
browser image and its Bun setup prerequisite were also checked locally.
