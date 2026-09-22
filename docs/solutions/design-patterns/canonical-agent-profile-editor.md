---
title: Canonical Agent Profile Editor
date: 2026-08-28
category: design-patterns
module: agent profile creation and editing
problem_type: design_pattern
component: frontend
severity: medium
applies_when:
  - "creating or updating an Agent Profile in the web app"
  - "entering Agent creation from game join or Daily Free acquisition"
  - "editing an Owner Learning strategy proposal"
  - "saving while portrait generation is still pending"
tags:
  - agent-profile
  - responsive-editor
  - strategy-diff
  - avatar-generation
  - draft-recovery
related_components:
  - api
  - database
  - testing_framework
---

# Canonical Agent Profile Editor

## Problem

Agent creation had accumulated several embedded and full-page variants. The shared form was visually optimized for a compact modal, which made the longest and most consequential field, Strategy, the smallest editing surface. A review-linked edit also reopened the saved Strategy instead of the proposed update, separating the player from the before/after context they needed. Draft portrait generation and saved-profile completion previously had separate lifecycles, allowing later images to mutate an already submitted character.

## Pattern

Use one full-page editor for ordinary create, ordinary edit, review-linked edit, game-join creation, and Daily Free creation. Acquisition surfaces choose a saved Agent or route to the editor with typed flow context; they do not embed another profile form.

The responsive hierarchy is deliberately asymmetric:

- Strategy is the first content card on mobile and the dominant right-hand workspace on desktop.
- The Strategy textarea starts large, grows with content to a viewport-bound maximum, and remains manually resizable.
- Desktop keeps identity controls in a left rail. Mobile places the compact identity card after Strategy and collapses Persona and AI tools by default.
- Personality and Backstory remain generous supporting fields below identity.
- A persistent action dock keeps Cancel and Save reachable and reports text, upload, portrait, or draft state without conflating them.

## Strategy comparison contract

Every edit session has a stable Strategy baseline. Ordinary edit retains the saved Strategy as its baseline; the Live Changes panel is enabled only for review-driven editing. A review-linked edit validates the owned unresolved review, verifies that its `before` value still matches the saved Strategy, initializes the editor from `proposal.after`, and shows a word-level live diff against `proposal.before`.

Review-linked custom save is disabled until Strategy differs from both the saved baseline and the initial proposal. This prevents an identity-only mutation, an untouched generated proposal, or a revert to the original Strategy from resolving the review as a custom edit. Missing, foreign, resolved, superseded, or stale review links fail closed with explicit routes back to the review or ordinary edit.

## Portrait and save contract

Text, performance instructions, selected images and crop metadata form one draft. Refine with AI completes the textual character design, generates one full-body image and derives its portrait crop. Either image opens the larger crop editor. Pending generation or upload disables final submission and offers Save draft instead. Generation must complete, fail, time out or be explicitly canceled. Cancel requires confirmation; submitting after an unfinished replacement requires confirmation too. Completion changes only the draft, and canceled or timed-out late results never attach automatically. See [the atomic submission contract](../../agent-content-submissions.md).

Web creation carries a stable per-owner UUID request key bound to a normalized payload fingerprint. Equivalent retries return the same Agent; reuse with different profile details fails explicitly. An owner-scoped recovery read resolves that key back to a committed Agent before a retry submits changed draft text, so even a lost create response can continue with the one created profile. The editor persists the exact originally submitted snapshot and performs a three-way comparison against the recovered Agent: only locally changed, non-conflicting fields are patched, unrelated remote edits are preserved, and same-field divergence stops for an explicit merge. If create succeeds but an acquisition handoff fails, the editor remembers or recovers the created Agent and retries join or enrollment without creating a duplicate profile. Join itself replays the same owner/Agent seat both after the game crosses from waiting to active and when identical requests race through the game lock. The editor stores its working fields, creation key, original submission, and portrait request in tab-scoped draft storage, offers an explicit restore choice, and bounds status polling before exposing manual refresh.

Edit submissions carry a retry-safe submission ID and the content revision loaded with the form, in addition to the analytical revision used by review workflows. A differing revision rejects a content-changing stale save instead of letting an old tab overwrite newer Strategy, personality, or identity text; an exact response-loss retry remains a no-op success. Image-only submissions advance content revisions without changing competitive revisions or recalibrating ratings. A linked manual review update uses the same no-op replay rule after `manual_update` resolution, preventing a lost success response from turning Retry into a conflict or a second resolution event.

## Failure presentation

Profile generation, portrait generation, upload, save, validation, and status-observability failures remain separate. A status read failure never becomes `Portrait not generated`; it preserves the last known provider state and says status is temporarily unavailable. Incomplete asset evidence or obsolete portrait-attachment inputs reject the complete submission and preserve the draft. Successful submission atomically records the active content, immutable snapshot and pending moderation review; moderation does not gate gameplay.

## Deployment boundary

The create and join request contracts intentionally replace the old inline-Agent paths. Deploy the API and web bundle as one coordinated release; cached or mixed-version clients are not supported. Drain old API writers before applying migration `0070`, then apply the migration and start the new fleet. The migration only detaches unconsumed legacy draft portrait rows, so previously consumed portraits cannot become attachable again.

## Validation

Keep server and client length limits in the client-safe `@influence/engine/agent-profile-contract` export. Cover create idempotency and owner recovery, pending controls, cancellation and save confirmations, upload precedence, late-result fencing, ownership rejection, timeout and failure recovery, same-seat join replay after start, stale edit rejection, linked-review response-loss replay, saved-Agent-only join, review initialization, Strategy save gating, responsive semantic field structure, and bounded degraded polling. Browser QA should inspect desktop plus 390px and 320px mobile widths, with the Strategy textarea visible before the diff and `Non-binary` unwrapped on mobile.
