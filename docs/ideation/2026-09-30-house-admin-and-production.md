---
title: House admin and production experience
type: ideation
status: active
date: 2026-09-30
---

# House admin and production experience

## Product intent

Make House administration a coherent, comfortable application for running games and producing something enjoyable to watch. Werewolf and Influence should share navigation, presentation quality and operational services while retaining their own rules and lifecycle. Admin screens are user-facing product surfaces.

The current priority is continuity: pages disappear during section changes, Werewolf looks disconnected from the House admin, and useful evidence is buried in JSON. The longer-term direction is a production studio organized around selected scenes and a player preview, with operational jobs available separately.

This document owns the four-pillar task map and product boundaries. Each pillar gets a scoped implementation plan when it becomes active. It is not authorization to implement all four at once.

## Task map

| ID | Pillar | Status | Deliverable |
| --- | --- | --- | --- |
| A1 | Fix continuity and bring Werewolf into House admin | Implemented locally; acceptance evidence recorded | Persistent navigation and game workspace, continuous section changes, House styling, readable cost details |
| A2 | Turn Production into a studio | Direction established; needs its own plan | Scene/asset browser, selected preview and inspector, job center, then timeline and playback |
| A3 | Improve detail display across admin | Direction established; follows A1 evidence | Reusable compact metadata and domain receipts in remaining operational screens |
| A4 | Improve game visualization for Influence and Werewolf | Direction established; needs capability inventory | Consistent game workspaces with explicit game-specific state and presentation |

A1 implementation plan: [Admin continuity and Werewolf integration](../plans/2026-09-30-002-refactor-admin-continuity-and-production-studio.md).

A1 execution: [task specifications](../plans/2026-09-30-003-admin-continuity-tasks.md) and [review dispositions](../reviews/2026-09-30-admin-continuity-plan-review.md). A1 is implemented and locally validated; its task checklist retains comparative measurement and extended browser-matrix evidence follow-ups. A2–A4 remain unimplemented.

Operational baseline: [Implemented Werewolf admin workspace](../plans/2026-09-30-001-feat-werewolf-admin-production-workspace.md).

## A1 — continuity and House integration

**User outcome:** move between Overview, Production, Costs and Activity without a blank screen, lost context or a different-looking application.

- Shared House black surfaces, persistent admin navigation and consistent game identity/header.
- Top-level areas: Games, Production, Operations and People; local navigation owns their routes. Visibility follows permissions and direct routes enforce access.
- Werewolf becomes a game choice under Games. Keep existing list APIs and game engines separate.
- Preserve loaded data during refresh, prepare section requests, eliminate the detail-to-section request waterfall, and make cold loading and errors local.
- A restrained wheel-like content transition inside a stationary frame. Reduced motion uses a prepared swap without rotation or fade through black.
- Replace the Werewolf cost JSON wall with readable model usage and call receipts, reusing existing cost presentation components.

**Done when:** keyboard, mobile and desktop navigation retain context; cold/warm/slow/error transitions remain understandable; permissions and pending production requests survive correctly; costs distinguish estimates, reported charges and missing prices. Browser recordings demonstrate the continuity, not just screenshots.

## A2 — production studio

**User outcome:** browse a game's material, select a moment, inspect what viewers would see, and make production decisions in context.

Desktop composition: scene/asset browser on the left, selected preview in the center, contextual inspector on the right, timeline and transport beneath. Mobile uses linked Browser, Preview and Inspector screens rather than shrinking the entire desktop interface.

Working increments:

1. Stable browsing, addressable selection, preview, versions and contextual production actions.
2. Job center aggregating existing visual and postgame media records, with a small studio activity tray. Keep current workers and retry authority; do not invent another scheduler.
3. Player preview at a canonical presentation cursor, clearly distinguishing candidate assets from published presentation.
4. Fast seeking, cue stepping, play/pause, speed and discoverable keyboard shortcuts. Spacebar must respect input/dialog focus.

**Done when:** operators can find a scene, understand its coverage and version, follow work without staying on the originating panel, and preview/seek without causing generation or publication. Missing panels retain usable imagery and existing fallbacks.

**Questions for its planning:** what is the first useful browsing unit—scene, event or asset; which actions belong in the inspector; what review states need filters; how do game-specific events become presentation cues; what job types support cancellation or reconciliation? Do not block A1 on these questions.

## A3 — readable operational details

**User outcome:** understand what happened and what can be done, without decoding backend objects.

Start with A1's cost receipts, then provider attempts, production diagnostics and inference/learning evidence. Reuse a small set of presentation primitives: definition lists, compact tables, status summaries, expandable groups, and copyable identifiers.

JSON structure can suggest a layout. Explicit field metadata must supply labels, units, enum meanings, safe visibility and links. Unknown is not zero; false is not missing. Raw JSON remains an optional technical view. Do not build a schema-driven form framework or use model calls to translate runtime diagnostics.

**Done when:** common evidence is scannable and actionable, long records stay bounded, and technical disclosure does not expose more information than the authorized API allows.

## A4 — game visualization parity

**User outcome:** understand either game through familiar navigation and tools, without losing its distinctive rules.

Inventory Influence's existing actions before migrating them. Establish comparable Overview, Production, Costs and Activity locations, with game-specific phase, cast, decision and outcome content. Link canonical activity moments to production previews. Consider a combined game browser and cross-game cost views through explicit read models.

**Done when:** both games are discoverable and operable, their current state and production readiness are legible, and no existing operator action disappears during migration. Shared screens must not introduce Influence assumptions into Werewolf.

## Shared boundaries

- Canonical events/projections own facts, decisions, audience visibility and replay identity. Never reconstruct authority from transcript prose.
- Share UI, provider accounting and production infrastructure; keep game rules and interpretation explicit.
- No public viewer replacement or audience-access expansion is implied by an admin preview.
- Scrubbing is read-only; it cannot dispatch generation or mutate a game.
- Generation, verification, review and publication are distinct states. Unknown job progress is not a percentage.
- Use existing House styling and dependencies; no redesign-driven framework replacement, speculative plugin system or new feature flags.
- Work remains in the existing Werewolf worktree. Primary-checkout work and existing dirty changes are preserved.

## Sequence and decision record

Start with A1. Plan A2 from the stable workspace. Extract A3 patterns from actual repeated evidence rather than generalizing in advance. Plan A4 after the first workspace and studio patterns are proven; inventory can happen earlier without starting the migration.

Confirmed during source audit: the app already has a QueryClient provider and Motion; existing cost components can be extracted; the current Reviews destination is agent learning review and belongs under People. Performance timings and wheel-motion comfort still need browser validation during implementation.
