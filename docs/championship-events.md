# Season-linked championships and reusable awards

The implementation runs a separate event linked to its source season. Event games have `seasonId = null` and use the custom track: they do not enter the free queue or alter Season 0 scoring. Nothing is automatically activated by a migration, season finalization, roster lock, or publication.

## Qualification and frozen competition builds

Season finalization now commits a verified object-storage snapshot in the same transaction as honors and final status. It retains all receipts, scoring evidence carried by those receipts, the complete Agent and Architect rankings, qualification ranks and exact integer scores. New championship locks use that snapshot. Historical final seasons without a snapshot retain the legacy qualification reader; this compatibility path does not claim to reconstruct an original finalization snapshot. Season 0 is still open and will use the new path when explicitly finalized.

The field is the top eight agents, with multiple agents per owner allowed. Roster locking stores verified content-addressed competition builds, sealed model routes, both game strategies, source revision identity and frozen game configuration. Legacy missing revision pointers are repaired with the existing revision-maintenance helper before lock commits. Live-owner edits remain allowed, including while a championship game is waiting for a start retry. Ordinary seat projection cannot replace a competition build. Influence admission reconstructs the pinned roster and configuration at its atomic start boundary; Werewolf creates its canonical start event directly from the pinned build. Existing durable owner leases, provider journals and restart adoption run the accepted games.

The same eight play 16 Werewolf matches and one Influence finale. There are no automatic fillers or owner-consent requirements. Genuine unavailable-qualifier substitution remains an explicit audited operator workflow to implement; ordinary owner edits are not unavailability. Cross-game memory remains deferred.

## Schedule and recovery

All 17 schedule records are generated at midnight UTC from an explicit start date: Werewolf days 1–16, Influence day 17. The game-worker process checks due championship work every 30 seconds. Gateways do not run this loop. An optional narrowly authorized service wakeup calls the same reconciler; no separate AWS resource is required for the worker-based schedule.

Only explicitly activated events dispatch. Creation and dispatch lock the exact event/match identity; duplicate calls return the same game. They never select a newest waiting game. A crash after Influence game creation resumes its existing waiting game, and a crash after accepted start uses the normal durable worker adoption path. Existing deployment admission/maintenance fences remain in force. Temporary dispatch errors remain retryable and do not invalidate the field. Award and result-reconciliation failures do not prevent due gameplay dispatch. No monetary ceilings, reserves or spend-based stops were added.

The clock is a not-before boundary, not a promise of second-exact execution. Delayed starts catch up in scheduled order. Multiple overdue matches may overlap following an outage; accepted games retain independent durable leases. Activation/pause request identities are audited even for no-ops; delayed retries cannot reverse a later producer decision. Operators can explicitly pause future starts; that does not abort accepted games. There is no automatic cancellation or replacement after a game failure.

## Balanced roles and spectator presentation

`balanced-roles-v1` generates two complete eight-rotation blocks, with exact per-agent role totals for the chosen role composition. A deterministic search prioritizes avoiding repeated complete lineups, then repeated wolf partners, then consecutive roles. The role composition remains an explicit policy choice.

For each match, dispatch deterministically finds a private seed that reproduces its planned lineup under the existing Werewolf role-assignment function. The normal canonical reducer validates that assignment on start and replay; no alternate interpretation of released rules is introduced. Invalid role counts fail validation before seed selection.

Public views receive only unordered, opaque lineup IDs and role maps. Seeds, future match-to-lineup bindings, frozen strategies and private owner IDs are excluded. Roles use optional spoiler reveals. Late-series deduction is acknowledged. Contestant prompts and memory receive neither the collection of future lineups nor the private schedule. The event page links back to its season, shows scheduled/completed games, Werewolf points and wins, and the separate Influence champion.

## Results and awards

Settlement reads canonical Werewolf outcomes or the normal Influence completion receipt. Unique match/entry rows store one outcome and point award per contestant; transaction locking prevents duplicate counting. Werewolf ranking compares configured series points, then exact frozen Season 0 score, then the explicitly chosen equal-score fallback. Influence's canonical winner wins its separate championship. An Influence draw remains unresolved pending a product decision; completed gameplay is retained rather than rerun automatically.

All 17 completed results finalize the event when winner resolution is complete. Finalization is audited. Result reconciliation and finalization also work while future dispatch is paused.

Built-in Season 0 badges cover Agent Crown, Architect Crown, season agent champion's architect, Top 8, Werewolf and Influence champions, each championship winner's architect, and agent/account participation. Additional reusable definitions support account or agent recipients. Public badge shelves appear on agent and account profiles.

Automatic allocation uses three independent phases: the locked field after activation, source-season honors/participation, and each game's championship. Each phase freezes recipient attribution and evidence in an object-backed outbox. Delivery retries preserve the allocation, use stable achievement/request keys, and never duplicate or implicitly reinstate a revoked badge. Participant counts use distinct completed game receipt identities, including otherwise ineligible scoring receipts; no production threshold is supplied. Owner attribution is explicitly qualification-time or allocation-time. A missing historical finalization snapshot defers automatic source-season allocation without blocking matches or other awards.

## Producer workflow and badge correction

`/admin/championships` is available to accounts with `manage_championships`. It lists up to 100 recent events and connects draft creation, explicit policy/date entry, top-eight roster lock, publication, activation/resume, pause, exact-match retry, and event-scoped reconciliation. Source-season operations remain in the existing Seasons screen; the championship panel never closes a season implicitly. Blank policies remain undecided. A draft-create retry with the same slug/actor/source/name returns the same event; conflicting reuse is rejected.

Publication does not activate the schedule. Activation permits due games and automatic awards; overdue starts can overlap. Reconciliation from this panel targets only its selected event. Match rows show the actual game status when it differs from event progress, with links to existing game pages. Event audit history and operation receipts support recovery. Unknown browser operations retain their original request/body in the account-scoped admin session for a deliberate retry; this in-memory continuity does not survive a full browser reload.

Accounts with `manage_awards` can preview available allocations, including before activation after roster lock. Preview reuses the allocation planner without writing allocations, grants, or payload objects. Existing allocations are marked frozen/delivered; unallocated plans are explicitly previews and may change before allocation. Champion phases await canonical outcomes; source-season allocation needs finalization evidence. Event and source-season badges are listed together, with pagination.

Badge review exposes original evidence and its audit history only to authorized operators. Explicit revoke/reinstate actions require a reason, preserve the same grant identity and original evidence, and record every accepted correction. Delayed retries cannot reverse a later correction, including accepted no-ops. Automatic delivery still never reinstates a revoked badge. These controls do not rewrite recipients, evidence, scoring or canonical results; those replacement/correction policies remain separate work.

## API and authority

Public reads: `GET /api/championships/:slug` (published only), `GET /api/award-definitions`, `GET /api/awards/agents/:id`, and `GET /api/awards/accounts/:publicIdentifier`.

`manage_championships` authorizes:

- `GET /api/admin/championships`: list recent events.
- `POST /api/admin/championships`: create or recover the same draft.
- `GET /api/admin/championships/:id`: inspect the event and unresolved policy choices.
- `PUT /api/admin/championships/:id`: configure draft policies and start date.
- `POST /api/admin/championships/:id/lock`: freeze qualification/builds/configuration, with `Idempotency-Key`.
- `POST /api/admin/championships/:id/publication`: change public visibility without activation.
- `POST /api/admin/championships/:id/activate`: explicit activation or resume, with `Idempotency-Key`.
- `POST /api/admin/championships/:id/pause`: pause future starts, with `Idempotency-Key`.
- `POST /api/admin/championships/:id/matches/:ordinal/dispatch`: retry one exact due match.
- `POST /api/admin/championships/:id/reconcile`: reconcile only this event.
- `GET /api/admin/championships/:id/award-preview`: read-only allocation preview; also requires `manage_awards`.

`POST /api/internal/championships/reconcile` requires a service principal enabled in the database and a signed `dispatch_championship` scope, or a normally authenticated human with that permission. A free-queue-only token is insufficient. The route does not accept a caller-supplied clock or activation request.

`manage_awards` authorizes manual grants, revocations and explicit reinstatement with evidence/reason and `Idempotency-Key`. Producer reads use `GET /api/admin/awards?eventId=...&after=...` and `GET /api/admin/awards/:id`; reinstatement uses `POST /api/admin/awards/:id/reinstate`. `manage_award_definitions` authorizes custom definitions; built-in codes are reserved.

## Rollout and remaining decisions

Additive migrations 0143–0144 and payload inventory entries must deploy together with the API. Only isolated local test databases have been migrated by this task. Bucket references are verified before commit; rolled-back uploads may leave content-addressed orphan objects for normal inventory/retention handling. Coordinate these additions with the separate AWS storage migration.

Do not activate a real event until its start date, role composition, win/loss/draw points, equal-score fallback, participation threshold and owner-attribution policy are chosen. An Influence draw policy also needs a product decision before a drawn finale can be finalized. Test values are fixtures, not production defaults.

Still to implement/review: genuine-unavailability alternate selection and evidence, recipient/evidence replacement or canonical-result correction workflows, and any desired final badge-art refinement. In-player branding was not changed; existing viewer/Studio/export rendering remains the authority. The event page and profile award shelves are outside the player picture.

See `championship-validation.md` for exact local evidence and limits. No live provider execution or production activation is claimed.
