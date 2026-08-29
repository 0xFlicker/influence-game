## Linked Issue

- Issue: <!-- e.g. [INF-172](https://...) -->

## What Changed

- 

## Start-of-Work Sync

- [ ] Before editing, I checked branch/worktree status, fetched `origin`, updated local `main`, and started or reconciled this branch against latest `main`.

## Verification

- [ ] `bun install --frozen-lockfile`
- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun run test`

## Not Run / Why

- 

## Risk / Follow-ups

- 

## Production Release Impact

- [ ] No database migration, or every migration follows expand-contract while the current production API remains a rollback target.
- [ ] No startup/background-worker behavior changed, or passive validation and activation behavior are covered by tests.
- [ ] Public and player-facing pages remain unchanged, or the affected routes and browser evidence are listed above.
- [ ] The release-control protocol remains compatible with the accepted production baseline.
- [ ] A successful staging E2E run may create a native pending production candidate; approval is still a separate protected-environment action.
- [ ] Break-glass restart is not required. If it is required, explain why and link the reviewed operator reason.

## Review Closeout

- Code-backed work is complete when this PR is reviewable and linked in the final delivery summary.
- Draft PRs support `in_progress` / `in_review` handoff, not final closeout.
