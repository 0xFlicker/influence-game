# House follow pre-PR review

Reviewed the complete `codex/plan-livegame-followalong` range against `origin/main` at `7f2f3e43`, including all three feature commits through `61bd4c51`. The scope includes the operator-only player, canonical context API, audience visibility, buffered commentary handoff, announcement/completion boundaries, theater mode, master mute and music taper. House Studio's implementation is in the separate `house-host` repository.

## Resolution

Nested malformed playback coordinates could throw from the production-key validator and become HTTP 500 responses. The follow API now maps those validation errors to `invalid_input` HTTP 400 before database access. Regression cases cover null/empty parts and sources, invalid night actions, incomplete ballots, invalid event sequences and malformed bridges. Catalog membership and Producer/Sysop authorization remain separate checks.

Expanded the canonical Influence fixture test from the first ballot to every format roll call. Each position must include exactly its reached voters and withhold the aggregate resolution. Reviewed the live route's status-based playback selection, stale-request cancellation, public-page isolation and the separation between a winner reveal and completed retrospective playback. No additional confirmed issue remained from those checks.

## Validation

- `bun run test`: 3,138 passed, five existing skips, zero failures across 331 files.
- `bun run test:postgres`: 2,269 passed, zero failures across 204 files on local test PostgreSQL.
- Final `game-follow-context.test.ts` and `production-studio.test.ts` run: 23 passed, zero failures, including every malformed-coordinate case and the expanded canonical ballot assertions.
- Follow-player browser suite: 13 passed, including real speech/thinking media, hold acknowledgments, music continuity, transition boundaries and completion.
- Selected real-player browser journeys: 11 passed, covering both games' defaults, music taper, opening/voice handoffs, background music, closing music and theater/fullscreen continuity.
- Final `bun run check`: workspace typecheck and lint passed with the API fix and regression additions.

The initial focused API attempt waited on the full suite's shared database advisory lock and hit its setup timeout. It did not exercise an assertion. The final 23-test API run passed after the baseline released the database.

Temporary logs: `/tmp/house-follow-pr-provider-free.log`, `/tmp/house-follow-pr-postgres.log`, `/tmp/house-follow-pr-api-final.log`, `/tmp/house-follow-pr-browser.log`, `/tmp/house-follow-pr-player-browser.log` and `/tmp/house-follow-pr-final-check.log`. Browser-generated Next configuration was restored. This review used deterministic local fixtures; it made no paid provider calls or deployments and does not establish Windows/OBS listening acceptance.

## CI follow-up

The wider browser stories still used the retired music-only button, assumed linear slider percentages, and selected the first checkbox to toggle thinking. Updated those journeys to use master mute, the music slider inside Settings, exact shared-gain restoration and the named Show thinking checkbox.

Those journeys also exposed two product regressions: the added theater control overflowed the 320-pixel player, and moving music controls into Settings had omitted the existing failed-load retry action. Narrow-screen controls now fit without hiding buttons, and Settings exposes the existing music retry callback when audio is unavailable.

Six affected real-browser journeys passed across two runs: Influence/Werewolf sandbox sharing and restoration, thinking presentation, saved thinking preferences, victory music and the full music transport/mobile/HTTP-failure retry story. The final music story passed after reproducing and correcting the narrow-screen overflow. Workspace typecheck/lint passed. Logs are `/tmp/pr236-audio-browser-final.log` (five passed; the then-unfixed mobile test failed), `/tmp/pr236-music-retry.log` (the corrected music story passed) and `/tmp/pr236-ci-fix-check-final.log`. No paid calls were used.
