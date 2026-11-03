# Championship events and awards — foundation draft

This draft adds separate Season-linked event records, qualification snapshots, immutable competition manifests, a balanced role schedule generator, public event pages, and reusable account/agent awards. It does **not** install game execution adapters, dispatch live games, configure AWS schedules, or automatically award season/event honors. It is not launch-ready.

## Current contracts

- Top eight agents; no account cap. Qualification comes from all eligible season receipts using the existing Agent standings policy, not the discovery-filtered public game list.
- Lock only after the source season is final, with explicit policy choices and start date. One transaction persists the field, content-addressed build references, all candidate ranks, private role schedule and 17 match records. Repeating the same lock operation is idempotent. No game rows are created by this operation.
- Frozen builds contain both game strategies and character inputs, plus sealed model routing metadata. Owners can edit the live agent. Reads verify object hashes and manifest identity rather than reloading the current profile. **Existing game-start paths are not wired to these manifests yet.**
- Sixteen Werewolf matches at 00:00 UTC on days 1–16, Influence at 00:00 UTC on day 17. The starting date has no default.
- `balanced-roles-v1` uses two complete eight-rotation blocks. Every enabled role has exactly twice its per-game count per agent. A deterministic candidate search minimizes repeated complete lineups, repeated wolf partners, then consecutive roles. The chosen role composition is explicit; no production default is supplied.
- Public lineups contain only opaque lineup IDs and role maps, independently ordered from scheduled matches. Seed and private order stay in object storage. The page uses native spoiler disclosures and warns about late-series deduction. Do not pass the public roster collection into contestants' context.
- Win/loss/draw points, final equal-score policy, participation threshold and owner attribution are explicit nullable draft choices. Scoring compares series points, then the exact frozen Season 0 integer score. A further exact tie without a selected fallback is unresolved rather than silently decided.
- Cross-game learning is deferred. No budgets, cost reservations or spend-based stopping rules are present.

## API and permissions

Public: `GET /api/championships/:slug` (published events only), `GET /api/award-definitions`, `GET /api/awards/agents/:id`, and `GET /api/awards/accounts/:publicIdentifier`. Public projections omit private owner IDs, build payloads, audit reasons and private seed/order.

`manage_championships`:

- `POST /api/admin/championships`: create draft with slug, name and sourceSeasonId.
- `GET /api/admin/championships/:id`: inspect public projection plus unresolved choices and explicit execution-unavailable status.
- `PUT /api/admin/championships/:id`: replace policies and startDate on a draft. All policy keys must be present; undecided values are null.
- `POST /api/admin/championships/:id/lock`: freeze final qualification and builds, with `Idempotency-Key`.
- `POST /api/admin/championships/:id/publication`: set `published` boolean; this does not activate execution.

`manage_awards`: manually grant evidence-backed awards or revoke them with reason and `Idempotency-Key`. Unique definition/recipient/source identity prevents duplicate achievements; different evidence requires correction instead of overwrite. Revocation preserves grant and audit rows. Repeated grants never reinstate a revoked award implicitly.

`manage_award_definitions`: create additional reusable definitions. Built-in Season 0 codes are reserved. All approved Season 0 achievement types exist, including agent/account participation, Top 8, both crowns, separate game champions and three distinct champion-owner contexts. Defining awards does not allocate them.

## Storage and isolation

Migration `0143_championship_foundations` is additive. PostgreSQL holds identities, relationships, operational status and small policy values. Private payload storage holds qualification documents, role schedules, frozen builds and award evidence with hash verification. Uploads in rolled-back transactions can leave content-addressed orphan objects; preserve them under existing inventory/retention handling rather than deleting objects during a retry. New payload columns are registered in the inventory and never had inline legacy bodies.

`sourceSeasonId` belongs to the event. It does not assign event games to `games.seasonId`. No live season transition occurs here. Broad tests must use a dedicated test database, not the shared development/test databases.

## Remaining implementation slices

1. Atomic season-finalization snapshots and shared finalization/ranking policy, including full receipt/tie evidence and correction versions.
2. Audited genuine-unavailability alternate handling without imposing new eligibility thresholds.
3. Actual Influence and Werewolf admission/start adapters consuming pinned manifests; frozen rules/media/configuration and actual provider-context assertions; balanced roles integrated with canonical start/replay validation.
4. Exact-match idempotent dispatch, recovery/reconciliation, result receipts, standings and finalization, including pause/overrun semantics. No newest-waiting fallback.
5. Dedicated service principal scope, Lambda wakeup, falsefloor/infra resources and reviewed IAM changes. No automatic activation or reuse of the broad free-game token.
6. Finalization-driven award allocation/outbox, auditable correction/reinstatement and allocation previews. Owner attribution and participation criterion remain product choices.
7. Producer UI, richer artwork/evidence details, result views and the remaining browser/worker end-to-end tests.

The public event UI and badge SVGs are a reviewable first presentation draft. They are outside the game-player picture; no viewer/Studio/export frame behavior was changed. Whole-championship execution and presentation parity for any future in-player branding must be verified separately.
