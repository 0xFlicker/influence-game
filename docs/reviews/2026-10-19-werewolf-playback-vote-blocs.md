# Werewolf playback: skip passes and restore vote blocs

Pass decisions no longer create playback, navigation, or scrub stops, including when Show thinking is enabled. Their canonical records and saved thinking remain available for debugging. Spoken contributions still support thinking.

Public ballots use the existing vote presentation: accepted speech plays, then the portrait collects into its target or Abstain bloc. Each ballot carries the canonical prefix of that day's accepted ballots, so direct seeks and API window boundaries show prior votes without future votes or previous-day carryover. Spoken abstentions retain their speech; silent ballots invent none. The final resolution shows the complete tally and result without replaying every ballot. Historical sealed ballots keep their original reveal sequence.

The large facts overlay was used for public ballots and pack proposals; both instances are removed. Ordinary day conversation had no instance of this overlay. The small phase/context label and centered outcome cards remain.

## Verification

- Read-only audit of the completed four-day localhost API game `just-amber-wyrm`: 24 passes skipped and 22 public ballots checked in each audience. All 96 omniscient and 87 mystery timing rows matched the UI cues.
- Browser checks with Show thinking enabled: seeking into a pass run advances to voting; spoken abstention and target ballots use vote blocs; the portrait flies into its bloc after speech; pack dialogue has no proposal banner.
- Export regression verifies spoken public ballots retain speech and solo timing; silent abstentions have no speech.
- Focused playback tests: 37 passed initially; expanded model/export tests: 25 passed.
- Provider-free baseline: 2,741 passed, 5 skipped, zero failures (saved simulation source snapshots excluded from discovery).
- `bun run test:postgres`: 2,086 passed, zero failures across 181 files.
- `bun run check`: all workspace typechecks and lint passed. `git diff --check` passed.

Screenshots and the real-game audit are saved under `packages/engine/docs/simulations/v9-playback-review/`. No paid inference was run for this presentation change. Existing saved games were used; their source evidence was not rewritten.
