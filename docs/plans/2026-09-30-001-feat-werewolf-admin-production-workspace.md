---
title: Werewolf admin and production workspace
type: feat
status: implemented
date: 2026-09-30
---

# Werewolf admin and production workspace

## Purpose and scope agreement

Make Werewolf operable and producible through a coherent admin workspace: discover a game, understand its progress and costs, inspect its activity, prepare and review visual assets, and manage its visibility. This release covers the admin experience and the backend integration required to make its controls work. It does not replace the public Werewolf viewer or change gameplay.

Use this as the first concrete shared Game + Production workspace. Keep Werewolf-specific interpretation explicit, while reusing existing accounting, media jobs, assets, permissions and UI components. Do not duplicate the entire Influence admin or build a speculative game-plugin framework. A separate Werewolf entry point is acceptable for this interim release; a wholesale admin unification is not required.

Implementation is in the existing Werewolf worktree. The delivered routes, action matrix and validation evidence are recorded below; the scope agreement remains the reference for deferred work.

## Working base

Work only in `/Users/user/.codex/worktrees/werewolf/influence-game`, branch `codex/werewolf`. The worktree was updated through merge `3bc8bd7c`, incorporating fetched `origin/main` tip `ff36400c`. The newer lobby renderer, panel transitions, blurred backgrounds and visual review facilities are now available here. Preserve the existing uncommitted Werewolf gameplay work. Do not move implementation to the primary checkout.

The merge passed provider-free tests, PostgreSQL tests, typecheck and lint. That is baseline evidence, not validation of this proposed integration. No additional renderer import from another checkout is needed for the agreed base.

## Current-version-only baseline and completed local cleanup

On 2026-09-30, the user authorized removing older local Werewolf rules versions provided a current-version game existed. Current code and the retained game both use rules v7, not v6. The local `influence_dev` database on `127.0.0.1:54320` contained one completed v7 game, `bare-ruby-tower` (`6d22cc22-c3d9-44db-9824-f348d6c98df5`), with a canonical village-win completion event.

Removed 12 Werewolf games on v2–v6 and their dependent event, turn, provider-attempt, evidence and cost records in one transaction. No old game had an active owner. Verified all other game rows, shared character profiles and the retained game's event history were unchanged. A private recovery snapshot was saved outside the repo at `/tmp/werewolf-pre-v7-local-cleanup-2026-09-30.json`; it contains private records and is not a public artifact. No remote database or external evidence/media storage was cleaned.

The new admin/production work targets current-version Werewolf only. Do not maintain older-version viewers, reducers or migration adapters. Keep clear rejection of unsupported rules versions. This separately authorized local cleanup is complete; it does not authorize automatic future deletion or production cleanup. References below to deferred cleanup mean any additional cleanup beyond this operation.

## Included in this release

### 1. Werewolf discovery and a single game workspace

Provide an admin Werewolf list with slug/title, lifecycle status, progress, player count, cost summary, production attention state and visibility. Support useful status/search/hidden filters. Each row has one primary Open action; avoid accumulating per-feature pills.

Use a stable, linkable game workspace with four destinations:

| Destination | Responsibilities |
| --- | --- |
| Overview | Cast, game state, current day/action, result, operational problems, supported run controls and visibility |
| Production | Frozen character references, backgrounds, scene inventory, character coverage, assets, jobs, review, repair and publication |
| Costs | Gameplay and production spending, models, calls, retries, estimates, actual costs and incomplete accounting |
| Activity | Original conversation, cues, resolved ballots and outcomes; drill down to authorized diagnostic evidence |

Proposed routes are `/admin/werewolf` and `/admin/werewolf/[id]/{production,costs,activity}`, with the game root serving Overview. Confirm routing against the existing admin shell before implementation. Add a discoverable entry through existing admin navigation without expanding it into another long row of pills. Existing Influence destinations continue working.

Audit existing stop/resume/recovery and hide/restore semantics before wiring buttons. Only expose actions supported by Werewolf's durable ownership and lifecycle. Shared endpoint names do not prove that their behavior is game-neutral. Do not borrow Influence voiding, settlement, ratings, jury or learning behavior.

Include hide/restore so later cleanup can happen through the admin. Hiding is not deletion or a privacy mode. Define and test its effect on public listings, direct links and published media consistently. Do not perform cleanup, delete historical games, or hide games as part of implementation.

### 2. Cost visibility through existing accounting

Werewolf already invokes the shared provider journal/accounting hooks. Verify the complete path from accepted and failed attempts through spend records and rollups to admin DTOs. Reuse the existing cost-detail service and components where their contracts fit.

Distinguish gameplay from production costs; expose model/provider, calls, retries and available usage. Keep estimates, provider-reported actuals, unknown/unpriced attempts and uncertain charges distinct. Missing accounting is not zero cost; retain the established N/C distinction. Avoid double-counting shared journals or counting recovered provider calls as new spend.

Current-version games with incomplete cost records must remain inspectable and honestly labeled. Older Werewolf rules versions are unsupported; do not add legacy replay, conversion or compatibility paths. Do not automatically rerun inference or paid production to fill gaps. Existing safe read-only evidence is preferable to inventing totals.

### 3. Working visual production and admin previews

Connect Werewolf's canonical events to the existing visual production pipeline. A game-specific projection supplies the scene boundary, actual participants, speaker, audience and original cue. Shared production owns assets, jobs, render attempts, review and publication. Never derive roster, votes, phase or speaker identity from transcript prose or feed Werewolf records through Influence GameState.

Initial scene scope:

- Public introductions/day discussion: lobby staging from the canonical cast at that point.
- Pack conversation: one private room containing the applicable wolves, using existing Mingle production facilities. This is presentation reuse, not a change to Werewolf conversation mechanics.
- Resolved votes/eliminations: inspect canonical ballots and results in Activity; retain enough canonical identity/timing information for the later viewer. No new cinematic vote sequence in this release.

Start with completed-game production and explicit operator-selected jobs, reusing current replay-production behavior. Live progress, costs and Activity remain available for running games. Do not insert visual generation into the gameplay critical path or change agent image context in this release.

Provide actual admin previews, generation, review, repair and publication for the included scene types. Reuse existing immutable media versions and explicit publication boundaries. Publication here accepts assets for their authorized audience; it does not claim the deferred public viewer consumes them yet. Pack imagery and role-bearing metadata must not leak through Mystery DTOs, previews, asset URLs or exports.

Audit character-reference availability: Werewolf currently freezes character identity in its own event state, while existing production expects Influence player/reference storage. Resolve this explicitly. Never silently use an edited current profile as the historical character. If a frozen full-body reference is missing, expose that condition and use an available portrait fallback; producing a replacement requires an explicit production action.

Inventory the existing titles/covers, trailers/posters and other production controls. Reuse applicable metadata/assets, but automated editorial text, trailers and video generation are deferred unless separately brought into scope. “Game + Production” does not mean importing every Influence-specific generator.

### 4. Panel and fallback contract

Do not impose a two-panel limit on generated assets. Section grouping can produce more than two panels, including for eight players, and more than three for twelve. Keep every usable verified source panel.

For presentation, reuse the current lobby approach: one speaker-focused image normally; at most two primary image layers during a transition. Decorative blurred neighbor/background layers fill the rest of the stage. This is not a claim that only two images may be loaded or rendered internally.

- Prefer the verified shot containing the current speaker and its validated identity mapping.
- Reuse existing panning and panel transitions where applicable; do not require generative stitching.
- Missing coverage must not discard other good panels.
- Show an available individual full-body reference on a neutral backdrop for an uncovered speaker; use a portrait when the full-body reference is unavailable.
- Production shows both panel status and coverage by character, including the planned fallback.

Reuse the renderer in admin previews. Expect integration and targeted fixes rather than a renderer redesign; verify existing fallback capabilities before promising full-body compositing. Do not add a simultaneous multi-panel conversation layout, eye-contact/gaze actions or new camera-direction model calls. Public playback integration is deferred.

### 5. Deliberate desktop and mobile UI

Desktop: stable game identity/status header, compact section navigation, clear hierarchy and enough space to inspect evidence and images. Put detailed tasks on linked screens instead of piling dialogs and pills onto a list row.

Mobile: section menu, stacked readable summaries, dedicated detail/review screens, usable touch controls and no page-wide horizontal overflow. Cost tables and dense ledgers need mobile-specific presentation. Preserve navigation/filter state on return from details.

Design the list, workspace header, Production coverage view and Costs view before building out all screens. Review desktop and narrow mobile layouts with realistic long names, partial assets, pending jobs, empty states and failures. Use the existing product visual language with consistent spacing and typography.

## Shared versus game-specific boundary

| Shared concern | Werewolf-owned interpretation |
| --- | --- |
| Authentication and permission checks | Which operations are legal at the current Werewolf lifecycle state |
| Provider attempts, spend and media accounting | Meaning of calls: opening, reply, ballot, investigation, protection, pack negotiation |
| Media jobs, references, versions, review and publication | Scene membership and boundaries from Werewolf events |
| Reusable admin layout and evidence widgets | Day/night progress, roles, factions and result labels |
| Renderer framing, speech timing and fallback display | Authorized speaker, original speech/cue and audience at each point |

Costs, failed jobs and production needing attention are future cross-game queues. Keep IDs, links and reusable components suitable for those views, but do not implement a global admin redesign or generic capability framework now.

## Relevant modules and docs

Paths below are relative to this worktree.

| Area | Starting points and work |
| --- | --- |
| Admin shell/list | `packages/web/src/app/admin/{admin-sections.ts,admin-tabs.tsx,admin-page-shell.tsx,admin-panel.tsx,admin-game-filters.tsx}`; add interim discovery and routed workspace without broad Influence redesign |
| Production UI | `packages/web/src/app/admin/{production-panel.tsx,replay-visual-production-panel.tsx}` and `games/[id]/visual/{visual-operations.tsx,scene-repair-panel.tsx,image-review-editor.tsx}`; identify reusable controls and Influence assumptions |
| Cost UI/API | `packages/web/src/app/admin/admin-cost-view.tsx`; `packages/api/src/services/{admin-game-cost-detail.ts,provider-cost-accounting.ts,provider-call-journal.ts,visual-render-journal.ts}` |
| Admin/production routes | `packages/api/src/routes/{admin.ts,werewolf.ts,visual.ts,visual-replay-production.ts}`; game-kind dispatch, authorization, audience handling and mutation legality |
| Werewolf authority | `packages/engine/src/werewolf/{types.ts,rules.ts,observation.ts}` and `packages/api/src/services/{werewolf-games.ts,werewolf-runtime.ts}`; derive projections without gameplay changes |
| Visual pipeline | `packages/api/src/services/{visual-replay-production.ts,visual-scene-store.ts,visual-scene-renderer.ts,visual-shot-review.ts,visual-media-worker.ts,visual-media-viewer.ts,visual-production-export.ts,visual-game-assets.ts}`; adapt discovery/reference lookup while sharing job execution |
| Scene contracts | `packages/engine/src/{visual-mode.ts,visual-scene-plan.ts}`; participants, grouping, anchors and fallback metadata |
| Existing viewer components | `packages/web/src/app/games/[slug]/components/{visual-scene-view.tsx,visual-scene-layout.ts,scene-image.tsx,stage-backdrop.tsx}`; reuse in admin previews |
| Tests | API Werewolf, provider-accounting, visual-replay-production and visual-media tests; web admin and renderer tests; authenticated browser harness |
| Documentation | `docs/werewolf.md`, `docs/visual-mode.md`, `docs/reasoning-transcript-observability.md`, `CONCEPTS.md`, `docs/solutions/architecture-patterns/separate-werewolf-game-authority.md`; usage docs when commands or operator flows change |

## Implementation sequence

1. Audit route permissions, lifecycle controls, accounting, frozen references and scene publication. Produce an explicit supported-action matrix and final DTO/route shapes. Identify required schema changes rather than assuming none.
2. Design and review desktop/mobile list and workspace screens. Resolve which existing components can be extracted with their current contracts.
3. Deliver discovery, Overview, Activity, Costs and hide/restore end to end, using canonical Werewolf projections and shared accounting. Keep this independently usable.
4. Add completed-game scene discovery and reference preparation, then connect shared media jobs, coverage inspection, review/repair and explicit publication. Prove public/pack audience isolation before exposing generated assets.
5. Exercise production previews using existing speaker-focused rendering, partial panels and individual fallbacks. Make only the necessary renderer fixes.
6. Run required checks and browser journeys; update operating docs and record remaining viewer work separately.

No new packages, model provider or infrastructure are presumed necessary. No new feature flag: deployment is the gate. Paid image generation and live-provider evaluation remain explicit opt-in tests; deterministic fixtures cover required validation.

## Acceptance criteria

- An authorized operator can discover a Werewolf game, open its workspace and navigate all four destinations by URL on desktop and mobile.
- Live/completed/failed/hidden states are understandable; unsupported actions never invoke Influence-only logic.
- Gameplay and production cost evidence reconciles with existing ledgers, including retry, missing-price and recovery cases.
- Canonical speech, cues, ballots and results are inspectable without parsing prose into facts or changing gameplay.
- A completed game can produce, inspect, repair and publish an authorized lobby or pack scene through the existing media job system.
- Source references are frozen or explicitly unavailable; cast edits after game creation cannot silently alter historical production.
- Verified panels survive partial failure. Coverage identifies an uncovered speaker and its available fallback.
- Admin preview handles more than two stored panels with existing focused framing and transitions; desktop/mobile remain legible.
- Pack/role/private evidence stays behind the correct permissions and audience boundary, including direct asset access.
- Hide/restore behavior is tested; no historical cleanup is executed as part of delivery.
- Existing Influence admin, production and renderer behavior continue to pass regression checks.
- Provider-free tests, PostgreSQL tests and `bun run check` pass; authenticated desktop/mobile browser journeys cover list → game → costs → production/review and visibility changes. Browser proof and live generation proof are reported separately.

## Explicitly deferred

Public Werewolf replay-viewer replacement; cinematic vote/elimination presentation; live production inside game execution; agent visual perception or gaze; House dialogue rewriting; new Werewolf roles/rules; automated trailers/video and new editorial generation; global cross-game admin consolidation; cross-game queues; historical game deletion/cleanup; deployment and paid simulations.

Keep the existing Werewolf spectator viewer until its replacement works. Its eventual integration should use these assets and the existing lobby player. The precise vote close-up choreography remains a later viewer decision, not a requirement to alter canonical voting now.

## Compact continuation hint

Continue in the existing Werewolf worktree, now based on merged main. Preserve dirty gameplay work. Build the admin-only workspace (Overview, Production, Costs, Activity), reuse provider accounting and visual jobs, and derive scene identity/audience from Werewolf events. Keep original dialogue, private pack boundaries and immutable references. Preserve good panels; reuse one focused image/two transition layers with blurred surroundings. Do not redesign the renderer or replace the spectator viewer in this scope. Validate the permission/action matrix and mobile screens before expanding controls; no cleanup or paid generation without its own authorization.


## Delivery record

- Routes: `/admin/werewolf` and `/admin/werewolf/[id]/{production,costs,activity}` with Overview at the game root. A single Administration link leads to the workspace. Filters survive navigation through URL query parameters; mobile uses a visible section selector.
- API: `/api/admin/werewolf` list, `/:id` canonical overview/activity, `/:id/costs` shared ledger detail, `PATCH /:id/visibility` exact boolean request. Reads require current `view_admin` or Producer/Sysop; visibility requires `hide_game`. Stop reuses the current Werewolf route and `stop_game`; resume/recovery is not supported.
- Production: completed games only, current Producer/Sysop, shared `/api/admin/production/games/:id/visual` jobs/review/repair/receipts/publication. No new schema or dependency. Werewolf roster boundaries and captured reference bytes are supplied by the explicit adapter. Unsupported older versions are rejected.
- Images: private authenticated previews use the existing lobby renderer. N source panels, verified coverage and full-body/portrait fallback are retained. Public visual reads and artifact URLs reject Werewolf, even after publication. The public spectator viewer is unchanged.
- Accounting: shared gameplay costs plus separate production receipts, with actual/estimated/retry/unpriced distinctions. Provider evidence is expandable; original speech/cues/ballots remain in Activity.
- Deferred production inventory: the shared review workflow handles background-bearing source images, references, versions and jobs. Automated titles/covers/posters/trailers/video and new editorial generation remain outside this release. No Influence settlement or learning actions were imported.
- Validation: authenticated isolated-database browser journey covers desktop/mobile navigation, three stored fixture panels, uncovered-character portrait fallback, saving a reviewed version, private publication, preserved list filters and hide/restore. Final required checks: `bun run test` — 2,135 passed, 5 skipped; `bun run test:postgres` — 1,794 passed; `bun run check` — passed. The complete Werewolf browser file passed all four journeys, followed by a passing targeted admin journey after the final preview interaction change. `git diff --check` passed. No paid generation or deployment was performed.


Read-only check against the retained local v7 run: `bare-ruby-tower` discovers four room scenes, both lobby and pack, with no missing references. Its existing ledger contains 248 calls, an estimated USD 0.320922 and zero unpriced calls. This is an accounting/projection check, not a new simulation or paid production run.


Validation also corrected an existing React test teardown race: the create-game form test now awaits React cleanup before restoring DOM globals. Shared production tests distinguish regenerating an existing image from rendering a missing one. Isolated browser servers and databases were cleaned up; generated Next configuration changes were removed. Work remains uncommitted in `codex/werewolf`, preserving the earlier gameplay edits.
