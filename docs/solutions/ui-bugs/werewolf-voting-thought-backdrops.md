---
module: Production Studio
problem_type: ui_bug
tags: [werewolf, thinking, voting, replay-export]
---

# Keep voting thoughts on the voting set

The Studio export of `hard-smoke-rune` was reported to switch from the voting set
to a daytime scene during thinking close-ups, then return to voting at rest.

Ballot playback selected the voting backdrop directly, but the shared backdrop
helper used by thinking shots defaulted to the village. A second path retained
generated village imagery attached to the accepted vote action, even though the
ballot stage does not display that imagery.

Resolve ballot backdrops in the shared helper and use it in ordinary playback.
Thinking shots also exclude generated scene imagery for ballots, matching the
ballot stage. Ordinary conversation thoughts retain their accepted scene.

The production presentation regression covers both paths and failed before each
fix. This changes framing only; no canonical history, cut IDs or audio pins are
rewritten. Previously encoded movies need a fresh export.

Validation: 43 focused framing/export tests; the full provider-free suite passed
3,020 tests with 5 skipped; typechecks and lint passed. The PostgreSQL gate passed
2,241 tests across four isolated shards. Shard 4 was rerun alone after an unrelated
staging-render fixture's database-cleanup hook timed out under parallel load; its
rerun passed all 589 tests without changing the test or product code.
