# Championship implementation review — 2026-11-03

This is a separate code-review pass over the local implementation, performed after the first end-to-end milestone. It is not an independent-agent or external security audit. Scope: qualification and frozen admission, exact-game dispatch, lifecycle retries, worker shutdown, settlement/awards, public projections, authority and unintended launch blockers.

## Concrete findings fixed

1. **Delayed activation/pause retries could reverse a later operator decision.** Lifecycle handlers previously checked only current state before applying the action. They now resolve the actor/request audit identity first, reject cross-operation reuse, and preserve current state for a previously accepted request. Requests that were originally no-ops also record acceptance, so later retries remain no-ops. The regression alternates pause/resume and replays both original mutations and original no-ops.
2. **A legacy finalist could lock with no source revision, then fail Influence admission on day 17.** Lock now uses the existing active-revision maintenance helper when the pointer is absent, before persisting the competition snapshot. The regression clears a valid legacy pointer, proves its existing revision is restored, and successfully admits the finale with that exact revision. This does not change an already-valid live revision or re-project a locked build.
3. **Paused events could settle every result without reaching final status.** Completion now transitions either running or paused events to final when canonical winner resolution is complete. The real 17-game rehearsal pauses after dispatch and proves finalization and champion delivery still complete.
4. **Shutdown did not await an in-flight championship reconciliation.** The worker retains its reconciliation promise and awaits it before aborting game workers. The timer remains single-flight and is cleared on shutdown. This closes an ordering race; it is covered by type checking and the full regression baseline, not a dedicated process-crash test.
5. **Point policies accepted values the result column cannot store.** Policy validation now matches PostgreSQL signed 32-bit nonnegative point storage, with boundary regression coverage. This is numeric representation validation, unrelated to spending or gameplay admission budgets.

6. **Default Werewolf guidance was resolved at dispatch rather than roster lock.** An agent without explicit notes could pick up a changed fallback after a code deployment. The snapshot now stores the resolved text while leaving the live profile's notes untouched. The regression verifies the canonical start uses the stored text.

## Reviewed boundaries

- Public DTOs allowlist event metadata, unordered lineups, standings and badge metadata. They exclude sealed builds, seeds, private order, internal owner IDs and award evidence/reasons. REST/MCP badge schema parity and rejection of extra evidence fields are tested.
- Human writes use dedicated permissions. Service reconciliation requires an enabled principal and the championship scope; free-queue scope is insufficient. The service endpoint cannot activate an event or supply a dispatch clock.
- Event membership in relational rows selects frozen admission, not a caller-controlled config flag. Locked builds/configuration/routes are integrity-verified object references. Ordinary live-owner edits and seat projection cannot overwrite them.
- Creation serializes the exact event/match and retries reuse its game. Influence uses normal durable admission/adoption; Werewolf uses its canonical start/reducer and owner fences. Event games remain outside season scoring.
- Results use canonical outcomes and unique match/entry identities. Award allocations freeze recipients/evidence before delivery; delivery failures do not block dispatch, and retries cannot duplicate or implicitly reinstate revoked grants.
- No monetary ceiling, reserve or spend-based stop was introduced. Product choices remain explicit; fixture values are not launch defaults. Existing maintenance/provider safety and integrity boundaries remain.

## Artwork review follow-up

A fresh read-through traced lock request → preparation worker → provider journal → verified private/public image storage → frozen entries → both game admission paths. It checked original account linkage, normal owner edits, source-reference use, lease/retry behavior and provider receipt recovery.

Three concrete defects were fixed:

1. The worker's global per-tick limit let one retrying event starve other preparing events. The limit now applies per event; a regression proves the second event locks while the first retains its retry.
2. Empty visual-design text suppressed the persona fallback, and generation omitted recorded gender. Missing-image requests now retain both identity inputs. Existing headshot pixels are still supplied unchanged as the body reference.
3. Rebuilding request text from current code could conflict with an existing operation hash after deployment. Retries now hydrate the accepted request from verified storage, check its hash and reference-image hashes, and reuse its prompt/dimensions. Changed template tests cover known failures and reconciled uncertain outcomes. A saved successful provider output is also recovered after an interrupted preparation step without a second provider call.

Production-path local tests exercise actual source reads, public image publication and readback, original profile preservation, account/agent links, and accepted pixel/hash evidence. Only the provider HTTP response is stubbed in that integration test. No paid or production execution is implied.

## Remaining limits

Scoring, shared-champion fallback, roles, one-game participation, attribution and pre-lock alternates are confirmed and implemented. The actual start date and hypothetical Influence draw resolution remain pending. Audited recipient/evidence replacement and completed-result resettlement/replay are now implemented; arbitrary canonical outcome editing is intentionally absent. Paid image quality and hosted availability are unverified. Uncertain image-provider responses need producer evidence through the reconciliation API; there is no dedicated panel form yet. Migrations 0145–0150 and payload inventory changes must be coordinated with the separate AWS storage work.

See `championship-validation.md` for completed test evidence. Review fixes are local only; no production mutation or paid game occurred. Authorized factual milestone updates were posted to issue #282.

## Completed-result correction review

Corrections lock the event before match/game or grant rows, validate the exact current attempt and result revision, and record request identity before retry-sensitive state changes. Prior canonical games, result revisions and evidence remain intact. Only current completed revisions contribute to standings. Champion allocations for the affected game kind are superseded, including legacy grant replacement descendants; old deliveries and reinstatements cannot resurrect them. Explicit manual revocations carry forward to replacement allocations until a producer reinstates the current grant.

The review found and fixed two edge cases: legacy manually delivered grants needed allocation linkage propagated down their recipient-replacement chain, and historical superseded grants needed to reject new visibility actions while still accepting harmless retries of previously accepted requests. Both are covered by the focused correction suite. The producer interface shows scoring history and recipient replacement links; long audit entries wrap on mobile. No new competition or eligibility policy was introduced.
