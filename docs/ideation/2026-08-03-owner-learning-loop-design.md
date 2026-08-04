# Owner Learning Loop Visual Acceptance Reference

This document and its three HTML frames are the visual acceptance authority for the Owner Learning Loop. They preserve the high-fidelity film-room direction approved on 2026-08-03. Implementation may adapt the content to live data and responsive constraints, but it must not collapse the experience into a generic AI loading panel, chat surface, or uniform card grid.

## Approved frames

- [Entry](./2026-08-03-owner-learning-loop-01-entry.html): owner credit, recommended Agent Profile, explicit one-to-three-game selection, immediate performance facts, start, and an optional MCP path.
- [Analysis](./2026-08-03-owner-learning-loop-02-analyzing.html): deterministic action/counterplay canvas remains useful while the secondary analysis surface advances through persisted stages.
- [Ready](./2026-08-03-owner-learning-loop-03-ready.html): editorial diagnosis, no more than three evidence-linked recommendations, exact strategy diff, manual edit, explicit apply, Keep current strategy, and optional MCP follow-up.
- [Shared styling](./2026-08-03-owner-learning-loop-review.css): typography, color, spacing, borders, states, and responsive behavior used by the approved frames.

## Hierarchy that must survive implementation

1. Owner credit, Agent Profile identity, current analytical revision, and the explicit one-to-three-game Daily Free selection establish what is being reviewed.
2. Deterministic game evidence is the primary workspace. Generated analysis remains secondary until it is ready.
3. The active analysis stage communicates durable progress without a numerical percentage or invented completion estimate.
4. Ready-state recommendations read as an editorial argument supported by exact moments, not as interchangeable AI cards.
5. The proposed `strategyStyle` change is visibly separate from diagnosis. Nothing changes until the owner explicitly applies it or completes a manual update; Keep current strategy is a distinct decline action.
6. MCP is a deeper cross-surface continuation path. It is not a prerequisite, a generic setup advertisement, or a URL handoff protocol.

## Required extensions of the approved frames

The implementation must extend the same visual language to these states:

- **Credit and game selection:** show no more than one owner credit, recommend a recently played agent and latest not-yet-analyzed games, allow one to three eligible current-revision games, and keep games marked `Previously analyzed` selectable.
- **Change agent:** before preflight, let the owner replace the recommended Profile with another owned Profile that has eligible current-revision evidence. Replace the revision context, game selection, and deterministic preview as one state change.
- **Rolling limit:** if the owner has credit but cannot dispatch yet, retain the selected Profile, games, and facts; disable Start; show the server-provided next eligible time; and recover from a fresh eligibility read rather than a generic error.
- **Generation unavailable:** if deployment configuration disables live generation, retain the selected Profile, games, and deterministic facts; disable Start; explain that strategic review is temporarily unavailable; and do not create an open review or imply that credit was spent.
- **No change:** retain the diagnosis and evidence hierarchy, explain why no update is warranted, and omit proposal/apply controls.
- **Awaiting evidence:** preserve deterministic facts and explain that the selected one or two early exits are not enough to diagnose a strategy. Do not create a review, occupy the singleton slot, or dispatch the model.
- **Strategy Health Check:** when exactly three selected current-revision games ended in round one or two, clearly label the serious strategy audit. Keep observed evidence, strategic interpretation, and proposed guidance visually distinct, and label recommendation support as `Seen across N games`, `Found in your strategy guidance`, or `Seen in play and guidance`.
- **Failure:** preserve deterministic evidence, name the safe failure, and show Retry only when lifetime budget remains plus Resolve failed review. Starting purchases the review; resolving failure closes the singleton without refunding its credit or rolling allowance.
- **Declined:** preserve the completed review and proposal, show that the owner chose Keep current strategy, and do not imply that the generated proposal was accepted.
- **Superseded:** preserve the review and proposal by ID, explain that an unrelated update to the reviewed agent won, and show no cleanup action.
- **Resolved:** distinguish exact apply, linked manual update, decline, automatic no-change, resolved failure, and unrelated-update supersede; retain immutable evidence and receipt context.
- **Existing open review:** when the owner attempts another review, lead them to the current singleton review instead of creating a second workspace.

## Interaction contract

- Every evidence reference is a control. Activating it selects the referenced game, focuses and temporarily highlights the exact timeline moment, and preserves a return target to the originating recommendation.
- On mobile, evidence navigation stays in the same document. It scrolls to the referenced moment and exposes a clear Back to recommendation action rather than opening a detached modal.
- Start, Retry, Apply, Keep current strategy, Resolve failed review, and manual-update actions disable duplicate submission while pending.
- Before Start, state that the action purchases the review using the owner credit and rolling allowance and cannot be cancelled. Failure resolution closes the purchased review without a refund.
- Viewing a ready recommendation does not resolve it. The owner must apply, complete a linked manual update, or choose Keep current strategy before another review can start.
- A lost poll keeps the last deterministic evidence and stage visible. A lost mutation response reconciles from the persisted review before showing another action.
- Semantic status and focus move only on meaningful persisted state changes; polling must not repeatedly announce the same state.

## Mobile composition

Use one reading and DOM order:

1. Owner credit plus Agent Profile and revision context.
2. One-to-three-game selection on entry, or the compact persisted-stage strip after start.
3. Deterministic selected-game summary and action/counterplay timeline.
4. Diagnosis and recommendations.
5. Exact strategy diff and resolution actions.

Ready-state actions may use a non-obscuring sticky footer. Touch targets are at least 44px, the page has no horizontal scroll, and keyboard/screen-reader order matches the visual order. Reduced motion replaces shimmer or animated stage treatment with a static active state without losing meaning.

## Browser acceptance

Verify the approved frames and every required extension at desktop and narrow mobile widths using live component rendering or contract-accurate fixtures. Review hierarchy, typography, content density, overflow, focus, reduced motion, and the evidence-link round trip. Functional correctness without fidelity to these frames does not satisfy visual acceptance.
