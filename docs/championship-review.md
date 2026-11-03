# Championship implementation review — 2026-11-03

This is a separate code-review pass over the local implementation, performed after the first end-to-end milestone. It is not an independent-agent or external security audit. Scope: qualification and frozen admission, exact-game dispatch, lifecycle retries, worker shutdown, settlement/awards, public projections, authority and unintended launch blockers.

## Concrete findings fixed

1. **Delayed activation/pause retries could reverse a later operator decision.** Lifecycle handlers previously checked only current state before applying the action. They now resolve the actor/request audit identity first, reject cross-operation reuse, and preserve current state for a previously accepted request. Requests that were originally no-ops also record acceptance, so later retries remain no-ops. The regression alternates pause/resume and replays both original mutations and original no-ops.
2. **A legacy finalist could lock with no source revision, then fail Influence admission on day 17.** Lock now uses the existing active-revision maintenance helper when the pointer is absent, before persisting the competition snapshot. The regression clears a valid legacy pointer, proves its existing revision is restored, and successfully admits the finale with that exact revision. This does not change an already-valid live revision or re-project a locked build.
3. **Paused events could settle every result without reaching final status.** Completion now transitions either running or paused events to final when canonical winner resolution is complete. The real 17-game rehearsal pauses after dispatch and proves finalization and champion delivery still complete.
4. **Shutdown did not await an in-flight championship reconciliation.** The worker retains its reconciliation promise and awaits it before aborting game workers. The timer remains single-flight and is cleared on shutdown. This closes an ordering race; it is covered by type checking and the full regression baseline, not a dedicated process-crash test.
5. **Point policies accepted values the result column cannot store.** Policy validation now matches PostgreSQL signed 32-bit nonnegative point storage, with boundary regression coverage. This is numeric representation validation, unrelated to spending or gameplay admission budgets.

## Reviewed boundaries

- Public DTOs allowlist event metadata, unordered lineups, standings and badge metadata. They exclude sealed builds, seeds, private order, internal owner IDs and award evidence/reasons. REST/MCP badge schema parity and rejection of extra evidence fields are tested.
- Human writes use dedicated permissions. Service reconciliation requires an enabled principal and the championship scope; free-queue scope is insufficient. The service endpoint cannot activate an event or supply a dispatch clock.
- Event membership in relational rows selects frozen admission, not a caller-controlled config flag. Locked builds/configuration/routes are integrity-verified object references. Ordinary live-owner edits and seat projection cannot overwrite them.
- Creation serializes the exact event/match and retries reuse its game. Influence uses normal durable admission/adoption; Werewolf uses its canonical start/reducer and owner fences. Event games remain outside season scoring.
- Results use canonical outcomes and unique match/entry identities. Award allocations freeze recipients/evidence before delivery; delivery failures do not block dispatch, and retries cannot duplicate or implicitly reinstate revoked grants.
- No monetary ceiling, reserve or spend-based stop was introduced. Product choices remain explicit; fixture values are not launch defaults. Existing maintenance/provider safety and integrity boundaries remain.

## Remaining limits

Final scoring, equal-score fallback, role composition, participation threshold, attribution policy and start date still need choices. Influence draw resolution remains pending. Genuine-unavailability substitution, richer producer controls and audited correction/reinstatement UI remain follow-ups. There is no live-provider or hosted-availability proof. Migrations 0143–0144 and payload inventory changes must be coordinated with the separate AWS storage work.

See `championship-validation.md` for completed test evidence. Review fixes are local only; no production mutation, paid game or issue-comment retry occurred.
