---
title: Match Intake to the weekly Denver scheduler
date: 2026-10-21
category: ui-bugs
module: Intake
problem_type: integration_issue
component: full_stack
severity: medium
tags: [intake, weekly, scheduling, timezone, countdown, visual-mode]
---

# Match Intake to the weekly Denver scheduler

Intake advertised Friday 00:00 UTC and counted down to that instant, while
`linode-iac/terraform/lambda-crons.tf` scheduled Friday 17:00 draws and 18:00
starts in `America/Denver`. The application was a day early during daylight
saving time and also missed the winter UTC offset.

`packages/api/src/services/free-game-schedule.ts` now calculates the next
Friday in Denver and resolves the offset on that target date. Draw and start
remain one hour apart. The start is Saturday 00:00 UTC during daylight saving
time or Saturday 01:00 UTC during standard time. Intake and About copy follow
that schedule; the countdown splits total hours into days and remaining hours.

New weekly draws persist `visualMode: false` for the 12-player game. Existing
games retain their frozen configuration. The infrastructure cron is unchanged.

Regression coverage includes both DST transitions, UTC midnight before a
winter start, exact draw/start boundaries, year rollover, countdown day
rollover, and the persisted draw configuration. Repository schedule inspection
does not prove the live AWS schedule: live verification needs valid AWS credentials.
