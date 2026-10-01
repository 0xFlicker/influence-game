---
title: Production studio — workflow and navigation brainstorm
type: brainstorm
status: exploring
date: 2026-09-30
pillar: A2
---

# Production studio — workflow and navigation brainstorm

Parent: [four-pillar direction](2026-09-30-house-admin-and-production.md). This is pre-planning: proposals and questions, not an approved implementation scope.

## Prerequisite side quest

The user selected **Replace the public Werewolf viewer** as the first complete rendering target. Scope and source map: [Werewolf public visual replay](../plans/2026-09-30-004-feat-werewolf-public-visual-replay.md). Prove that player before finalizing the studio; then embed the same player rather than building another preview engine. The earlier private-player-first suggestion is not the selected direction.

## Starting problem

Werewolf production sits inside Games → Werewolf → selected game → Production. Influence production is reached through the top-level Production area, where tools expand inside game rows or open dialogs. The same production task has two homes, and both accumulate controls instead of supporting focused work.

The user's recent feedback also establishes two interaction constraints: nested section changes should be immediate prepared swaps with stable scroll; save the wheel effect for a possible top-level swipe. A studio should not add more navigation tiers or animate its working panels.

## Current source findings

- `packages/web/src/app/admin/production-panel.tsx` combines game browsing, batch episode naming, episode editing, trailer/poster dialogs and expanding replay image controls. Its list source changes with operator permissions (`listAdminGames` versus `listProductionGames`). A common library must not silently inherit those different list semantics.
- `packages/api/src/services/visual-replay-production.ts`: `listReplayVisualGames` explicitly selects completed Influence games. `readReplayVisualProduction` already delegates Werewolf to its own adapter. Both games already share the per-game production API, repair/version records and request controls.
- `packages/api/src/services/werewolf-production.ts` derives scenes from canonical room/cast changes and reuses them across subsequent conversation. A scene is not a dialogue line or a full playable timeline. Scene selection and presentation-cursor selection are related but distinct.
- `packages/web/src/app/admin/replay-visual-production-panel.tsx` exposes coverage, candidate versions, review, publication and attempt evidence in a vertically expanding list. Extract its operations into a focused inspector without replacing their server authority.
- `packages/web/src/app/admin/games/[id]/visual/scene-repair-panel.tsx`, `image-review-editor.tsx` and `admin-session.tsx` already provide request identity, receipt recovery, version conflicts and session drafts. Preserve that ownership when tools move.
- `packages/api/src/routes/visual-replay-production.ts` enforces producer/sysop roles. Existing Influence visual-editor and postgame editorial routes have different grants; UI consolidation must inventory these separately.
- Werewolf image publication remains private production; Influence publication can affect viewers. One shared button must not conceal that difference.

## Proposed navigation

Production owns one game library spanning Influence and Werewolf, plus a dedicated studio per game. Game operations offer an **Open in studio** link to that same destination; the studio offers **Game overview**. These are two entry points to one workspace, not duplicate production implementations.

Candidate route shape: `/admin/production` for the library, `/admin/production/games/:id` for a studio, `/admin/production/jobs` for cross-game jobs. Final route/selection encoding belongs in the plan. Scene/version/moment selection should be addressable; list filters and return context should survive the round trip. Retire duplicate editors rather than maintaining two evolving UIs.

Keep only one top-level Production navigation item. Inside a studio, the game switcher, scene browser and selected-item inspector do the work; do not reproduce Games → game kind → game → Production as another stacked tab hierarchy.

## Three connected working surfaces

| Surface | Main question | Primary content |
| --- | --- | --- |
| Production library | Which game am I working on? | Both game kinds, game identity, lifecycle, production coverage, review/failed-work filters, recent work |
| Game studio | What am I looking at and changing? | Scene browser, selected preview, version/coverage inspector and contextual actions |
| Jobs | What is running or needs intervention? | Existing jobs/attempts and receipts, scope links, supported recovery actions |

Preferred initial landing is the library with a **Needs attention** filter and a **Continue editing** shortcut. Alternatives still open: attention-first inbox or reopening the last studio. Asked the user which workflow should lead; no answer assumed.

Do not reduce readiness to one green badge: generated, verified coverage, accepted version and viewer publication describe different facts. Missing imagery with a valid portrait fallback can still be watchable. A row can summarize these dimensions without promising a new universal readiness score.

## Studio interaction proposal

Desktop: scene browser at left, large selected preview in the center, contextual inspector at right. The browser emphasizes readable room/cast labels and small thumbnails; the inspector shows coverage, selected version, review, render/repair actions and the cost/receipt relevant to that selection. Provider diagnostics live behind deliberate disclosure.

Mobile: Browser → Preview → Inspector are linked views of the same selection, with an obvious back path. Selection and pending work survive movement; no attempt to squeeze three columns into a phone.

Keep the scene being inspected distinct from the published version. Preview must say whether it shows a candidate, an accepted private production version or the current viewer presentation. Generating or selecting an image must not publish it.

A small activity tray follows the selected game's work without replacing the cross-game job page. Operators can keep browsing while a job runs; only conflicting operations are locked. The job center reads the existing backend states rather than creating a scheduler. Retry, cancellation and reconciliation appear only where the job's actual API supports them.

## Scenes, moments and assets

Start with scene browsing to reach useful existing behavior quickly. A scene groups reusable room/cast imagery. A moment is a canonical presentation position using that imagery, a speaker and accepted dialogue or game results. An asset/version is a candidate or published production output.

Eventually the moment timeline selects a presentation cursor and highlights the scene used there. Selecting a scene can show **Used in these moments**. Repairing one shared scene should show how broadly the choice is used before publication; it should not fabricate duplicate jobs for every speech line.

A real player preview and timeline are separate deliverables. The current character-framing preview is not proof that either game's complete playback can already run inside the studio. Before planning playback, inventory each game's canonical presentation model, supported moments, seeking behavior and audience projection. Private Werewolf pack material must not leak into a Mystery preview merely because the operator has omniscient access.

## Candidate first useful scope — not yet selected

Shared library → open either game's studio → select a scene → inspect coverage/version → preview character framing → submit render/review → leave and return → inspect the receipt → explicitly publish to the supported audience.

This would prove the workspace before adding timeline playback. Existing Influence titles/covers/trailers/posters still need an explicit home and capability inventory; they cannot simply disappear when replacing the production list. Possible home: a compact game-level **Release assets** workspace adjacent to scenes. Decide whether those tools move in the first increment or remain reachable through a clearly named link until their studio integration is complete; do not create hidden feature flags or disabled promises.

## Future performance direction

The user wants prose, cues and scene labels to inform emotional staging. [Emotional performance cues](2026-09-30-emotional-performance-cues.md) explores a separate validated presentation track, authored or interpreted, without changing game facts. Keep that extension outside the first replay milestone; the studio may eventually preview and review those tracks beside image versions.

## Questions to resolve before the implementation plan

1. Landing workflow: choose a game, triage attention across games, or resume the last studio? Awaiting user preference.
2. First useful milestone: does scene browsing/review solve enough on its own, or must a playable timeline ship with the initial studio?
3. Work in progress: completed-game production only initially (matches the existing shared API), or inspect live games too? Live production is a backend/lifecycle expansion, not a list-filter change.
4. Scope of production: image scenes first with an explicit home for existing editorial tools, or a unified release workspace from the first increment?
5. Audience preview: when playback arrives, should Mystery/viewer mode be the default with an explicit omniscient toggle? Private production acceptance must remain distinct from public delivery.

Resolve these through concrete operator journeys and rough desktop/mobile interface sketches. Then inventory endpoints/jobs/grants and write a scoped implementation plan. No application code or database behavior changes in this brainstorm.
