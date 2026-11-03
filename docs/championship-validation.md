# Local championship verification

Execution machine: `Flicks-MacBook-Pro-4.local`, macOS Darwin 27 arm64. Isolated checkout: `/Users/user/Documents/Codex/2026-11-02/task-2/influence-game`, branch `codex/season-0-championship`, based on `84d2f468aef8d94966a5edd6fa412de7503c8a38`. The original development checkout remains untouched.

PostgreSQL is local at 127.0.0.1:54320. The complete API suite uses only `championship_task2_test` with advisory lock 123456701. Focused verification and browser fixtures use `championship_task2_browser` with lock 123456702; browser servers are stopped before that database is reused. No shared development/test database, paid provider, real Season 0 state, production migration, live scheduler or deployment was used.

## Completed evidence

- Full provider-free baseline: **3,305 passed, five skipped, zero failed**, 40,340 assertions across 346 files. Final award/standings presentation changes also passed the focused web tests.
- Final focused PostgreSQL run: **59 passed, zero failed**, 2,109 assertions across seven files. This includes championships, the execution rehearsal, season behavior/read models, payload migration, agent revisions and account/service authority.
- One complete eight-agent event ran through **16 canonical Werewolf matches and one durable Influence finale**, with deterministic test agents and the normal database stores. It reached final event status and delivered both champion awards. The focused test includes owner replacement mid-Werewolf, duplicate dispatch/settlement/delivery, per-match planned roles, live profile changes, unchanged season receipt membership and repeated owners.
- Influence uses the existing durable mock runner and worker adoption path, not a fabricated completion row. Werewolf uses its canonical runner, event reducer, retrospective and owner fences. These are provider-free execution proofs, not live-model quality or hosted-provider availability tests.
- The normal owner profile-update service preserves an already-created waiting championship seat; retrying start uses the same game and frozen inputs.
- The championship service wakeup rejects free-queue-only credentials and disabled principals. An explicit championship scope can reconcile, but cannot activate an event through that route.
- New season finalization snapshots retain all receipts, completed-game identities and full rankings. Object integrity and immutable competition reads are tested. The legacy storage migration fixture was corrected to classify the newly introduced bucket-only columns.
- Fresh browser flow: Next.js event page → local Hono API → isolated PostgreSQL/payload store with a completed canonical Werewolf test match. HTTP 200, actual series standings visible, all 16 role disclosures initially closed, reveal works, zero page errors, and no horizontal overflow at 390px. Desktop/mobile screenshots were inspected.
- Type checks and lint passed across all workspaces. `git diff --check` passed.

The first broad PostgreSQL run during execution development was stopped after it loaded a pre-fix dispatch module alongside a later duplicate-request test. A clean full regression run against the final API code is tracked separately; do not describe the interrupted run as a passing baseline.

## Evidence and remaining limits

Browser evidence is retained under `artifacts/championship/` in the task checkout (`desktop.png`, `mobile.png`, `role-reveal.png`, `browser-result.json`). The fixture server refuses any database except `championship_task2_browser`. It uses deterministic local test agents and does not dispatch paid provider calls. Temporary servers are stopped after verification.

No production activation or live-provider rehearsal has occurred. Game engine/worker integration is covered locally; wall-clock hosting availability, production credentials, real external providers, and any future cloud wakeup resource still need deployment-specific verification. Genuine-unavailability alternate handling, richer producer controls/allocation previews, and correction/reinstatement UX remain explicit implementation follow-ups. Final product rules and launch date remain unresolved; fixture choices are not production defaults.
