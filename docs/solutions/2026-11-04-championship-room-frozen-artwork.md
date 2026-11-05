# Championship watch room and frozen artwork

The event now hosts the existing viewers in a contained player. The cast uses
full-body art from frozen builds over a designed hall; the public projection
exposes only visual fields, not strategies or build payloads. Influence uses its
salon preview, Werewolf its village, and a reserved control row prevents layout
movement when the Werewolf-only viewing-mode selector disappears.

The original opaque-body issue was provenance, not just CSS: championship
preparation published the frozen original but did not request a cutout.
Roster lock now registers its precise hash/payload reference and cutout demand.
A championship-scoped backfill supports older rosters without rewriting frozen
builds or live profiles. In local verification all eight derivatives completed
through the existing CPU worker, with no paid image generation.

The previous mixed original/cutout widths also made one finalist appear larger.
Both variants now share framing. All eight local finalists were visually checked.

Verification: focused API PostgreSQL tests passed (25 tests, 186 assertions);
focused web tests passed; real localhost replay controls, theater, native
fullscreen and responsive layouts were exercised without intercepted responses.
Preview switching at widths 1440, 800 and 390 produced zero schedule displacement,
kept Influence's selector absent and changed to its distinct backdrop.
The existing local championship has no played Influence finale yet, so that
event's actual finale playback remains unverified. Scene content and Studio/export
renderers were not changed by this page/chrome integration.

Final regression evidence:
- Typecheck/lint passed.
- Provider-free baseline: 3,329 passed, 5 skipped, no failures.
- Full isolated PostgreSQL baseline: 2,414 passed, one test-cleanup deadlock.
  The scoring replay fixture left its background runtime active before the next
  fixture's truncate. Added awaited abort/drain using the existing retry-test
  lifecycle. Post-fix affected suite: 29 passed, 225 assertions, including the
  previously failing migration test. The full baseline was not repeated after
  this test-only cleanup fix.
- Web focused suite: 3 passed, 26 assertions.
- Preview geometry verified at 320, 390, 700, 701, 800 and 1440px with zero shift.

Follow-up full PostgreSQL rerun after cleanup fix: **2,415 passed, 0 failed,
34,325 assertions across 226 files**, 883.82 seconds. This supersedes the
earlier full-rerun limitation. Executed against the isolated
championship_task2_scheduler_tests database; development servers and user game
data were not changed.
