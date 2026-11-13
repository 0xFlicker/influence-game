---
module: Werewolf presentation and API execution
tags: [werewolf, house, narration, hunter, replay, studio, export, provider-journal]
problem_type: integration_issue
---

# Generated Werewolf House narration

Werewolf used fixed House speech at phase openings, pack resolutions, night
choices (hunt, Doctor, Seer and Hunter), dawn, public-vote results, and completion.
The shared speech functions now prefer accepted authored text and retain their
existing factual text for historical events without narration references. UI
labels, rules, tally boards and contestant dialogue remain canonical and unchanged.

Authoring now supplies canonical facts and `requestedParts` output-key names,
without the former `required` fallback prose or any previously hydrated House
copy. The host is prompted as a charismatic game-show announcer. Announcement
inputs contain no recent dialogue or private spoken explanations; phase
announcements cannot recap pack talk. The reviewed Sage/Rune announcement is
saved Omniscient copy, not Mystery copy, and remains unchanged historically.

The API generates exact structured summaries on the sealed House route before
committing each narrated boundary. Mystery and Omniscient have separate calls
and audience-filtered inputs. Each night-action summary also has its own call
from the pre-resolution board, without dawn deaths or sibling choices. Earlier
accepted audience-batch references remain readable; current references bind each
individual beat. Accepted bodies use the existing private
object-storage provider journal; events contain only logical-call references.
Presentation reads verify the coordinate, object integrity and accepted-value
hash before projecting copy. Canonical gameplay reads never fetch these bodies.
Independently selected cuts remove omitted House and contestant speech while
retaining structured sibling actions needed for Doctor-save staging.
An absent historical reference means fallback; a broken referenced value is an
integrity error. No historical media, prose or game decisions are regenerated.

The new opening is held until its narration is accepted, preventing a viewer or
Studio selection from pinning a temporary fixed welcome. A new game carries the
opening-authoring revision; already accepted older openings are not backfilled.
Both immediate creation and waiting lobbies freeze that contract. An unfinished
older game may author future boundaries without changing accepted earlier ones.

The live evaluation caught two prompt-input hazards: a roster without living
status led to an incorrect six-person majority after a death, and Mystery dawn
inputs inherited cause-specific wording from the legacy fallback. The corrected
inputs explicitly provide living flags/counts and the exact majority threshold;
Mystery authoring receives only the public casualty list. Phase announcements
have no earlier-dialogue recap. A further live finding showed that batching
night actions with dawn could spoil the death in a hunt summary despite the
prompt. Independent pre-resolution inputs removed that information entirely. These corrections do not rewrite accepted copy
from the exploratory game.

The `young-pink-prism` production game exposed two further narration errors:
the first dawn reported six living players instead of seven, and the second
dawn announced nightfall rather than the completed night's no-death result.
Future authoring now sends an explicit `announcementKind`: resolved nights are
`dawn_result`, while independently scoped choices are `night_action`. Dawn,
phase-opening and pre-resolution action instructions are separate; a dawn call
never receives the instruction to withhold the later dawn result.
The final user message puts roster context first, followed by the announcement
kind, day, event/choice facts, count timing, required votes and living count.
`countTiming` distinguishes the pre-resolution action board from the board after
the current event. Dawn instructions explicitly say that the living count already
includes casualties and must not have deaths subtracted again. A no-death dawn
must announce that nobody died, without disclosing a cause to Mystery.
These are authoring-only changes: schemas, accepted narration references,
historical copy, observations, projections and viewer/Studio/export consumers
are unchanged. Existing selections and MP4s retain their accepted copy; no
historical narration should be regenerated to adopt this prompt revision.
Native-request regressions cover zero, one and two deaths, both audiences,
final fact ordering and the separation of dawn/action/phase instructions.

Validation for this dawn-prompt revision (2026-11-13): nine focused tests pass;
the provider-free baseline passes 3,526 tests with five skips and no failures;
the local PostgreSQL baseline passes all 2,638 tests across 248 files; typecheck
and lint pass. The provider-free run required localhost access after the sandbox
prevented test servers from binding. No paid evaluation or deployment was run.

## Local verification

- Provider-free baseline after the facts-only prompt revision: 3,495 passed, 5 skipped, zero failures; focused narration/Hunter
  tests also passed, including exact counts and temporal isolation.
- `bun run check`: typecheck and lint passed.
- Full PostgreSQL baseline after the facts-only prompt revision: **2,616 passed,
  zero failures** across 246 files (`bun run test:postgres`).
- Earlier final serial PostgreSQL regressions: 81 passed, zero failures across eight
  files, covering Werewolf execution, source snapshots, House audio, lobbies,
  visuals, character art, migrations and staging render proof. The narration
  integration test exercises malformed output retry, accepted-value recovery
  without another dispatch, audience-scoped watch/source/TTS output, object-only
  body storage, and corruption handling without breaking canonical reads.
- Hunter narration matrix: 235 viewer/export and 470 Studio Source/Selected cut
  comparisons; 11 fresh H.264 clips and 70 decoded-frame comparisons. Maximum
  encoded mean RGB difference 3.2281 (limit 4); synthetic recording correlation
  0.9921 and offset 29.5 ms (limit 50). Includes held/fired shots, single/double
  deaths, both audiences, sequence and isolated cuts, recorded/unrecorded speech,
  reduced motion, long labels, four geometries, caption pages and reverse seeks.
  Artifacts: `.renders/werewolf-house-narration/`.
- Additional phase/pack/Doctor/hunt/result matrix: 60 viewer/export and 120
  Studio comparisons, five encoded clips. Fresh historical dawn: two
  viewer/export and four Studio comparisons, retaining fixed fallback text.
- Real API Night 2 sequence: 72 viewer/export and 144 Studio comparisons, one
  fresh encoded clip. This uses the accepted Seer, Hunter, hunt and dawn text
  with standardized local character imagery for the offline proof.
- Initial retained proof: 369 viewer/export comparisons, 738 Studio comparisons,
  17 encoded clips and 103 decoded-frame comparisons. All Studio comparisons
  are pixel-identical; maximum viewer/export mean RGB difference is 0.6332,
  within the proof tolerance; maximum encoded difference is 3.3232 (limit 4).
  Additional artifacts: `.renders/werewolf-house-other-beats-final/`,
  `.renders/werewolf-house-historical-dawn/`, and
  `.renders/werewolf-house-live-night-two/`.
- Final isolated-cut refresh: 96 viewer/export comparisons, 192 pixel-identical
  Studio Source/Selected cut comparisons, three fresh encoded clips and 24
  decoded-frame comparisons. Full accepted Night 2 plus isolated House and dawn
  cuts passed across four geometries. Maximum viewer difference 0.6332; maximum
  encoded difference 3.0762 (limit 4). Standardized local imagery is retained.
  Artifacts: `.renders/werewolf-house-live-final/`.
- Facts-only prompt revision: eight focused authoring tests cover the native
  request, all fixture beats, historical fallback and audience isolation. The
  final render proof has 60 viewer/export comparisons, 120 pixel-identical
  Studio comparisons, five fresh clips and 15 decoded-frame comparisons.
  Maximum viewer difference 0.6131; maximum encoded difference 3.2654 (limit 4).
  Deterministic authored fixture copy exercises rendering; no new paid model
  evaluation was run for this prompt revision. The first render attempt timed
  out starting a headless browser; the complete retry passed. Artifacts:
  `.renders/werewolf-house-facts-only-final/`.
- The initial full PostgreSQL run passed 2,590 tests but hit one stale-module
  import error while code was being edited; the affected suites subsequently
  passed in isolated databases. The subsequent four-shard run used independent
  temporary databases but exposed an opening-cursor defect and an outdated art
  fixture, both fixed, plus migration/render timeouts under concurrent local
  load. Every failing file passed in the final serial 81-test run. That earlier run did not produce a green aggregate; the later facts-only
  revision baseline above completed the full suite with zero failures.

## Public localhost API evaluations

Both games use the explicitly approved OpenAI `gpt-6-luna` route. All sanitized
provider requests/responses, native reasoning, retries, failures, usage and
accepted values remain in the API's durable private journal/storage.

- Exploratory: `af7db828-17c3-461d-a1ce-85074d040b7d`, `fast-tan-salt`, six players,
  Echo as Hunter, two-day cap. Preserved incorrect early narration as evidence;
  local watcher reloads interrupted the CLI report and required lease recovery.
  Completed with a village win and all six retrospectives. Night 2 exercised
  the final independently scoped summaries, while Night 1 proves accepted
  earlier summary references remain readable.
- Corrected validation: `a6539a82-2cb6-4f50-b33b-b0f412116ccc`, `young-brown-crown`,
  six players, Lyra as Hunter, one-day cap. Completed as a day-limit draw with
  all six retrospectives; verified the corrected three-of-five announcement.
  Its earlier hunt summary remains accepted historical evidence of the timing
  defect subsequently fixed and verified on the other game's Night 2.
- Reports and audience snapshots: `packages/engine/docs/simulations/2026-11-10-werewolf-house-narration/`.
  `audit.json` records 33 and 17 House calls respectively, plus 86 and 52 provider
  attempts. All 137 terminal attempts have stored evidence, including three
  rate-limit failures. One interrupted pre-response attempt remains explicitly
  indeterminate in the durable journal. No successful evidence was discarded.
  Private provider bodies are not included in public watch snapshots or movies.

## Refreshing selections and movies

Existing movies do not update. Historical selections without generated copy
continue to use their factual fallback. Rebuild a fresh bundle from the frozen
selection/source and encode again for renderer changes. Adopting narration from
a newer source requires explicitly refreshing that selection. Never silently
replace pinned content or regenerate historical game/media evidence.
