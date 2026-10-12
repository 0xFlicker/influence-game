---
title: Production Studio timeline, editorial labels and workspace sizing
type: feat
status: in_progress
date: 2026-10-10
pillar: A2
slices: [A2.1, A2.2]
---

# Production Studio editing refinements

Implementation authorized on 2026-10-10. This follows real local Studio use and supplements the [combined delivery plan](2026-10-09-001-feat-production-studio-moment-editor.md) and [keyboard proposal](2026-10-10-001-feat-production-studio-keyboard-shortcuts.md). The operator approved the isolated interactive refinements prototype at `http://127.0.0.1:63098/` before final component/layout choices. The original planning findings below describe the pre-edit checkpoint. Current implementation/proof is recorded at the end; delivered-workspace acceptance remains pending.

## Operator decisions from 2026-10-10

- Initial decision: a moment row selects its properties without seeking. A separate target/crosshair icon pauses, seeks to that moment and recenters the timeline. The later content-seeking follow-up at the end supersedes the row behavior: rows seek readable content; target icons retain start seeking. Pin denotes inspection state, so it is unsuitable for seek; a triangle suggests expansion.
- Vertical wheel movement over the timeline zooms around the playhead. Shift+wheel pans. Horizontal trackpad movement pans. Provide a visible horizontal scrolling control.
- Thinking labels: **Smart**, **4th wall**, **Mistake**. Speech/message labels: **Smart**, **Mistake**, **Aggressive**. Labels are independent checkboxes and reusable across cuts, rather than membership in a single named export.
- Cut controls have **All / None / Matching labels** per type. Matching includes any checked label within that type: thinking marked Smart OR 4th wall, for example. No exclusions or nested logical editor in this pass.
- On narrow screens the first problem is stacked navigation, titles and toolbars consuming the space above the preview. Compress those into a small bar and menus, then enlarge the preview. A narrow-screen resize handle is optional and is not a prerequisite.
- The reported absence of thinking occurred in Werewolf **Mystery**, on Source. Mystery deliberately excludes thinking. The UI must explain this restriction; Omniscient exposes available accepted contestant thoughts.

Playback page scrolling, proposed pane limits, label saving details and final compact layout below are the original recommendations, not claims of new operator acceptance. The follow-up ledger records the later change to immediate checkbox saving after operator testing exposed the explicit-save step as too easy to miss.

## Findings from the current checkout

Read-only inspection of `codex/production-studio` confirms:

| Report | Current implementation and consequence |
| --- | --- |
| Zoom grows from the beginning | The zoom slider sets the inner timeline width to `zoom * 100%`, with no adjustment of the viewport scroll position around the current frame. |
| Wheel/panning feels broken | There is no wheel handler or viewport panning control. CSS declares horizontal overflow, so the operator's inability to scroll still needs actual `scrollWidth`/`clientWidth` and pointer/browser proof; missing overflow is not a confirmed root cause. |
| Playback/edge dragging leaves the visible window | No playback viewport-follow or drag-edge scrolling exists. `Follow playhead` currently follows the moment inspector/list, not the timeline viewport. |
| Row inspection unexpectedly moves the head | One full-row button calls the seek/selection path. There is no separate seek icon. |
| Full episode with selected thinking cannot be built | `ProductionSelection` supports full, one exact tag predicate, or exact IDs. The tagged predicate applies across kinds and matches every predicate entry; it cannot express per-kind alternatives. |
| Thinking is hard to discover | A global thinking visibility checkbox, audience selection, text search and Source/Cut membership can all affect the list. Mystery has no thinking. The browser has no dedicated Thinking filter/count or explanatory audience state. |
| Preview stays small despite available room | Desktop columns favor the moment browser (1.25:1); the monitor also has a height cap. Narrow preview height is capped at 96–120 px, or 80 px while Properties is open. Increasing right-column width alone does not fix those caps. |
| Narrow chrome consumes the editor | The site navigation and admin area tabs remain above a wrapped Studio command bar, source/scope bar and mobile panel tabs. Their cumulative height reduces the useful editing space. |

Sources: [preview/transport](../../packages/web/src/app/admin/production/production-preview.tsx), [workspace/inspector](../../packages/web/src/app/admin/production/production-workspace.tsx), [layout styles](../../packages/web/src/app/admin/production/workspace.module.css), [admin shell](../../packages/web/src/app/admin/admin-shell.tsx), [site navigation](../../packages/web/src/components/nav.tsx), [catalog/selection](../../packages/engine/src/production-moments/index.ts), [Player and frozen export learnings](../solutions/ui-bugs/2026-10-09-production-studio-player-and-frozen-recordings.md).

## Research and disposition

- [Premiere timeline preferences](https://helpx.adobe.com/premiere/desktop/get-started/preferences-and-settings/timeline-preferences.html) distinguishes page scrolling from smooth scrolling during playback. Start with the proposed page behavior based on the operator's expected 20% repositioning, with a visible toggle; defer a second smooth mode.
- [Final Cut timeline scrolling](https://support.apple.com/en-euro/guide/final-cut-pro/ver4ca732c0e/mac) exposes scrolling as a visible control and supports manual scrolling. Keep inspector following and timeline auto-scrolling separate. A native macOS scrollbar alone is insufficient discoverability because its visibility depends on OS settings.
- [Final Cut keyword collections](https://support.apple.com/en-nz/guide/final-cut-pro/ver68416335/mac) and [Smart Collections](https://support.apple.com/en-ca/guide/final-cut-pro/ver2833eb5b/mac) reuse editorial metadata in different filtered views. Use that principle for House labels and cuts; do not reproduce their broader query interface or project storage.
- [MDN wheel events](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event) distinguishes wheel input from actual scrolling and identifies browser zoom gestures through Ctrl-modified wheel events. Handle only supported gestures over this timeline; preserve browser zoom/pinch and normal page/control scrolling elsewhere.
- [WAI window splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/) describes a focusable, named separator with bounded values and orientation-appropriate keyboard resizing. [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) is a candidate maintained implementation; it is not installed locally. Prove its current Group/Panel/Separator API and DOM constraints with Bun before selecting it. No dependency is authorized or installed by this planning pass.

## Timeline viewport contract

Player continues to own time, playback and audio. Timeline viewport state owns only scale and horizontal position; it must never advance frames independently.

1. **One frame/pixel mapping.** Measure viewport width and timeline content width, and use the same bounded transform for pointer seeking, zoom anchoring, playhead rendering, recentering and edge scrolling. Retain the existing semantic moment/offset anchor across compilation and stale media responses. Layout resize changes geometry without changing the sampled frame.
2. **Playhead-centered zoom.** Slider and vertical wheel zoom center the current Player frame in the resulting visible window, clamped at the beginning/end. Never seek to achieve a zoom. At Fit, the complete cut is visible and no horizontal pan is expected. Add a visible Fit action. Evaluate the current 8× maximum against long real games; define a meaningful minimum visible interval if that bound prevents useful inspection.
3. **Manual panning.** Shift+wheel and horizontal wheel/trackpad input pan; normalize wheel units and distinguish the dominant axis. Provide a persistent, keyboard-accessible horizontal scrolling control linked to the actual viewport, rather than relying solely on transient OS scrollbars. Pan never changes the playhead. Do not consume Ctrl/Cmd-modified browser zoom/pinch or unrelated control input.
4. **Visible `Auto-scroll timeline`.** Recommended default is on. As playback approaches the right edge, move the viewport so the playhead is approximately 20% from the left, clamped near the end. Use Player frame updates; do not add a running timer. Manual panning turns the toggle off visibly so playback cannot immediately fight the operator's chosen window. Explicitly enabling it brings the current playhead into view. A separate Recenter action does not silently re-enable it.
5. **Drag-edge scrolling.** While the captured pointer approaches either viewport edge, pan proportionally within bounds and continuously seek the frame under the pointer using the updated geometry. This is active drag behavior even when playback auto-scroll is off. A drag-only animation callback may service scrolling while a pointer is held still at an edge; it stops on release, cancellation, lost capture, permission/scope change or unmount. It is not a playback clock. Preserve the existing successful-release/cancel playback rules.
6. **Explicit navigation.** Seek-to-moment pauses and centers that moment's first playable frame, even when auto-scroll is off. Frame/moment stepping and exact-frame entry keep the destination visible. A moment omitted from the current cut must not silently switch audience or reveal Source; it needs an explicit Source action.
7. **Separate follows.** Rename inspector behavior to `Follow current moment` (or equivalent explicit copy). It controls properties/list inspection only. Timeline auto-scroll controls the viewport only. Keyboard help must describe both correctly.

## Moment discovery and annotation

The producer can call these thoughts and messages; internally they remain independently selectable moments. Response/event identity provides provenance, not combined cut membership. Thought camera entrance, pages, fade and return remain internal presentation segments.

- On Source, show an obvious All / Thinking / Speech / Other type filter with authorized counts, plus text search. Browser filters must not alter cut rules, exported membership, source history or pinned visuals. The existing global thinking checkbox currently affects both the list and playback/selection; replace that coupling with explicitly separate list filtering and per-type cut choices. If a Source playback thinking toggle is retained, label its playback effect and keep it independent from Cut rules.
- In Mystery, show `Thinking is unavailable in Mystery. Use Omniscient to edit private thoughts.` This is a constant audience policy explanation, not a disclosure that particular private evidence exists or how many thoughts are hidden. Changing audience retains the current privacy-clearing/reload boundary.
- In Omniscient/Influence, zero available thoughts says no accepted thinking is available in this source. Do not invent thoughts from native reasoning, prompts, transcript parsing, pending decisions or producer logs. Accepted contestant/juror thinking already enters the catalog through game-owned source services.
- A row inspection pins properties without moving the playable head. Keep the active playhead row visually distinct from the inspected row. During playback, inspection can remain pinned while Player continues; beginning an annotation edit pauses through the existing owner.
- Place a target/crosshair **Seek to moment** button at the row's trailing edge, with a tooltip/accessibility name and a separate hit target. It pauses, seeks and recenters. The row, seek button and label controls must not be nested interactive elements.
- Show applicable label checkboxes in Moment properties, and compact saved label indicators in the row. Thinking: Smart / 4th wall / Mistake. Speech: Smart / Mistake / Aggressive. Multiple labels may coexist. Selecting a label on a thought does not set it on sibling speech. Do not auto-classify narrative quality.
- Recommended save interaction: checkboxes edit the same moment's tag draft; the existing Save action persists it. Show unsaved state, and use the planned Cmd/Ctrl+Enter save chord. Keep this one explicit mutation owner rather than adding an autosave request racing the tag draft. A later faster marking interaction must reuse that owner and its locks.
- Store these as ordinary flat string tags, proposed keys `label.smart`, `label.fourth_wall`, `label.mistake`, `label.aggressive`, with the exact value `true`. The prefix separates the new checkbox vocabulary from existing arbitrary metadata. Unchecking removes only that key. Human labels hide this storage spelling. Preserve other metadata, optimistic revision checks, draft conflict comparison and exact unknown-outcome retry. No new annotation table or migration.
- Custom metadata, if retained, lives behind an additional disclosure rather than being required for the primary cut workflow. Existing arbitrary tags remain valid annotation/export evidence; do not build a second label store or migrate game data during planning.

## Cut controls and shared selection

The visible Cut dialog groups choices by content type. Thinking and Speech each offer **All / None / Matching labels**; Matching reveals that type's label checkboxes and says `Keep any checked label`. Other game moments inherit the normal episode baseline, with explicit inclusion controls where needed; opening/result remain optional producer choices. Nothing is retained for continuity automatically.

Example: normal Omniscient episode, Speech = All, Thinking = Matching Smart or 4th wall. A second cut can use the same saved labels with Speech = Matching Smart or Aggressive, Thinking = Matching Smart or Mistake, other content excluded unless chosen. A Thinking-only review cut can set Speech/other content to None. Rules are evaluated against each moment's kind and saved labels, then assembled once in original source order.

Recommended internal extension is one finite `recipe` selection variant:

```ts
type MomentPolicy =
  | {mode: "all"}
  | {mode: "none"}
  | {mode: "any"; labels: readonly string[]};

// Added to the existing active full/tagged/ids union.
type RecipeSelection = {
  mode: "recipe";
  thinking: boolean;
  base: "full" | "empty";
  policies: Partial<Record<ProductionMomentKind, MomentPolicy>>;
};
```

- A supplied policy overrides the baseline for exactly that kind. Omitted kinds use the existing `defaultIncluded` coverage with full baseline, or none with empty baseline. This prevents adding otherwise non-default content accidentally.
- `all` is explicit inclusion of all authorized moments of the specified kind; `any` includes moments matching at least one allowed label's corresponding flat `label.*` key with exact `true`. These explicit choices can select non-default catalog thoughts. Existing default full export retains precisely its current coverage. The selection's thinking gate reflects the permitted content choice, not a transient browser type filter.
- Type and label match together. Policies combine by union across kinds, with no duplicates or reordering. An empty `any` list matches nothing. Use strict bounded validation for known kinds, label IDs, unique arrays and fields; reject unsupported expressions. Initial label/type availability is finite; no nested AST, scripting language, generic plugin registry or query-builder framework.
- Mystery catalog/privacy validation remains the authority: recipe syntax, exact IDs or handcrafted labels cannot authorize private thinking/nighttime decisions. The baseline is audience-specific; Omniscient's ordinary speech/gameplay includes its permitted private pack/night material and is not a public-only baseline.
- The engine owns one selector for Studio preview, freeze and export. The API freezes the resolved exact IDs in its existing consistent annotation/source read and checks the displayed membership. Only the source/order/selection changes need proving; no new compiler, reducer or media/audio path.
- Existing full/tagged/ids descriptor forms remain active exact export contracts. Add the new validated variant without normalizing already downloaded descriptors before hash verification or introducing a legacy adapter. Frozen IDs stay authoritative after later label edits; current recipe membership is not re-evaluated to invalidate an accepted download.
- Cut changes pause and retain the existing semantic anchor. Show selected count/duration and a plain-language summary such as `All speech and gameplay · Smart or 4th wall thinking`. No automatic context insertion, narrative-gap warnings, mandatory ballots or result retention.

## Workspace sizing and narrow chrome

**Desktop:** start with a narrower moment column and a wider preview/properties column. Add a vertical separator between them; allow the moment column to shrink to a readable minimum with a compact row layout. Prototype approximately one-third/two-thirds as a starting allocation, not a fixed approved number. Fitting the Player into the actual right-hand container must replace the current independent fixed height cap, while preserving enough space for properties and transport. Output dimensions/aspect ratio remain presentation/export settings, not physical pane size.

**Narrow:** replace the accumulated upper rows with one compact Studio bar containing back/game identity, current Source/Cut and access to tools/navigation. Move House/admin navigation to a menu in this workspace only; keep account, production library and all existing operation entry points reachable. Move the long source pin explanation, audience/detail controls and secondary tools into appropriate menus/dialogs with concise visible status. Export and playback controls stay discoverable; mute/volume remain top-level playback controls. Remove duplicated Source/Cut controls and large wrapping title/tool rows.

Use the recovered vertical space for a materially larger contained preview. Fit landscape close to available width; fit portrait to a deliberate height budget that leaves timeline and one useful list/properties surface. Do not shrink the preview merely because Properties is selected. Judge the new height after chrome reduction in real narrow/short windows; do not begin by adding another small-screen splitter. A future preview handle is only justified if the compact layout still needs adjustment.

For desktop resizing, prefer a maintained accessible separator after a bounded integration proof. Library Group/Panel/Separator DOM constraints require a local workspace container change, not a global layout rewrite. Set actual min/max sizes, orientation/name/value, keyboard arrows and reset behavior. Persist only a browser-local pane preference, never export geometry or a cut-project row. Reflow and resizing must preserve Player identity, frame, playback and audio. ResizeObserver can update viewport geometry; it must not seek or remount the composition. Include a Reset layout action. Do not introduce persistence for speculative panel layouts.

The next prototype must show compressed navigation, thought discovery/labels, the cut controls, zoom/pan/auto-scroll, seek icons and desktop resizing together. It needs desktop, narrow portrait/landscape and short-window review before final component/layout choices. Do not reopen a fixture or interrupt the current testing session as part of this planning turn.

## Implementation points and proposed order

| Work | Owner / dependency |
| --- | --- |
| 1. Viewport math, zoom anchor, Fit and manual panning | Preview component and a small pure timeline geometry helper; deterministic fixture tests first. Keep Player ownership unchanged. |
| 2. Auto-scroll, recenter and drag-edge scrolling | Same preview/viewport owner; depends on one mapping and bounds. Actual pointer/wheel proof is required. |
| 3. Separate row inspection and seek icon | Workspace list + typed preview handle; uses existing bounded seek. Inspector follows must be labeled distinctly. |
| 4. Per-kind recipe selector and strict decoder | Engine production-moments module/tests; deterministic fixtures independent of storage/UI. Preserve full coverage and privacy. |
| 5. Label draft controls, thought discovery and Cut dialog | Workspace + existing MomentInspector/AdminSession annotation owner; API freeze validation/regressions use the shared selector. No new mutation/storage service. |
| 6. Compact chrome and desktop separator | Admin shell/site navigation scoped to actual Studio route, workspace/CSS, bounded separator dependency proof. Prototype before final layout boundaries. |
| 7. Reconcile keyboard help | Existing shortcut draft: inspector following, viewport auto-scroll/recenter and type/label controls have distinct commands. Native separator/slider keys must win over transport dispatch. Bind labels only after the visible saving flow is agreed. |
| 8. Acceptance and documentation | Update current Studio guide after implementation; distinguish deterministic tests, real browser interaction, encoded media and operator acceptance. |

Preserve the current branch and unrelated/task dirt. The existing continue-in-place authorization remains in effect; this plan does not authorize commits, deployment, providers or external writes. Keep the original ST-01–ST-15 checklist intact and link this follow-up when implementation actually lands.

## Validation

- [x] Geometry tests cover middle/boundary zoom anchoring, Fit, pan bounds, resize, and zero/one-frame timelines; no operation changes the sampled frame unless seeking was requested.
- [x] Browser proof measures actual content/viewport/scroll positions and exercises real vertical wheel, Shift+wheel, horizontal trackpad-equivalent input and the persistent position control. Browser/OS zoom is ignored by the timeline handler; native controls keep their ownership.
- [x] Captured pointer seeks continuously while the viewport pans at both edges, including held-still dragging. Native lost capture proves the cancellation policy stops seeking and leaves playback paused. Playback auto-scroll pages repeatedly until the final frame; manual pan turns it off visibly. Pointer-cancel and host/scope animation cleanup were also reviewed; OS/device-generated cancellation during scope change is not separately automated.
- [x] Row selection changes properties without moving the frame; target icon pauses and seeks/recenters. Active vs inspected styling remains clear. Omitted cut moments never reveal Source without an explicit action.
- [x] Real authorized thinking appears separately in Omniscient/Influence; Mystery shows an explanatory policy state without private data/counts. Browser-only filters do not change cut membership or source pin.
- [x] Checkbox saves/conflict/unknown retry/permission loss use the existing single annotation owner. Independent thought/speech flags, retained unrelated tags and a second producer's revision edits are covered. Held 200/409 saves settle after inspecting another moment; actual colon-form drafts/conflicts clear on revocation. The operator follow-up below changes checkboxes from explicit-save drafts to immediate saves.
- [x] Per-kind OR cases include all speech plus Smart/4th-wall thinking, thought-only and mixed highlights; empty matches, multiple labels, source order, no duplicates, unsupported kinds/keys and handcrafted private references are covered.
- [x] Existing full-export IDs/coverage are unchanged. Old full/tagged/ids payload/checksum regression rejects decoder normalization; recipe freeze uses one selection snapshot, rejects stale displayed membership, and survives later label edits via its exact frozen IDs. This is local fixture evidence, not validation of an operator's historical download against a deployed source.
- [x] Resize/collapsed chrome fits desktop, HD, narrow/short and headless fullscreen views. Real divider drag/arrows preserve the Player and frame; resizing during playback preserves playback/mute state and output geometry. Existing operation homes remain accessible. Native macOS fullscreen/operator usability remains manual acceptance.
- [x] Shared renderer sampling remains forward/reverse/random/fresh-mount consistent; slow responses cannot restore an older seek. Thought cuts never flash omitted speech. Local Studio → frozen recipe → CLI encoded frames pass the existing verifier. The thought-only encoded cut schedules no audio; recorded-speech alignment/gain remains separately verified by the shared local verifier/browser suite.
- [x] After code lands, run `bun run test`, `bun run test:postgres`, `bun run check`, `bun run test:browser:api`, with existing PostgreSQL isolation and browser-child cleanup. No paid generation or staging/production mutations.
- [ ] Operator reviews the revised editing loop and explicitly accepts it. Current feedback and planning answers establish requirements, not delivered acceptance.

Export readiness/concurrency, broad transport audit, harmonize schema alignment and A2.3 job console remain separate.

## Implementation ledger — 2026-10-10

- [x] Inspect current clean `codex/production-studio` checkout; preserve planning history, read AGENTS and relevant Player/export/layout solutions. Continue in place without restarting the operator's local services.
- [x] Add strict finite per-kind recipe selection to the single engine catalog/selector; preserve full/tagged/ids shapes and default full coverage. Deterministic selector/viewport fixtures pass (18 tests, 135 assertions at the foundation checkpoint).
- [x] Prove actual installed `react-resizable-panels@4.14.2` Group/Panel/Separator using Bun and isolated desktop/narrow browser input. Operator approved prototype direction.
- [x] Integrate labels through existing sparse annotations/drafts/CAS; split row inspection from target seeking, add browser type filters and explain Mystery. No new storage or mutation owner.
- [x] Integrate playhead-centered zoom, normalized wheel/pan, persistent scroll control, Fit/Recenter, explicit playback page-follow and captured edge dragging through Player events and drag-only animation frames.
- [x] Integrate compact navigation/dialog homes and desktop resizing. Preserve Player subtree and movie geometry across responsive layout changes. Keyboard hint copy covers current local control/save bindings; broader character shortcuts remain a separate proposal.
- [x] Complete current canonical browser, required baseline and encoded-media checks; fix failures before marking proof complete.
- [x] Final bounded simplification/consistency review: one selector/compiler/Player/audio owner and annotation mutation owner. Fix private draft cleanup, settlement across inspector remounts and synchronous audience invalidation; recipe summary now includes gameplay/opening/result and kind overrides. No remaining material reviewer findings.
- [ ] Delivered operator acceptance. Approved prototype direction is recorded separately above.

Concrete findings during implementation:

- Panel `className` styles its inner element, so CSS ordering there cannot move the outer sizing wrapper. Reorder keyed direct children under Group instead. Keep both registered panel IDs on narrow Properties, with moments bounded to zero, to avoid registration/layout races and retain Player.
- Bound effective zoom to the new duration/FPS when switching from a long source to a short cached cut. No seek/remount is required.
- The playhead could extend horizontal overflow at the final frame. Clip horizontal content at the timeline boundary so Fit has no residual pan.
- A label conflict can remove the last cut member, changing media preparation and remounting Properties. Freeze even an unchanged draft before submission and retain comparison/error alongside that draft in the existing session owner. Audience/permission cleanup still clears it.
- Werewolf opening audio needs prepared duration evidence even when music is off. Do not compile metadata-only duration summaries using an empty asset map while media is loading; wait for the already-owned preparation result.
- The existing shared test database reported migrations applied but lacked `werewolf_lobby_seats`. The first required PG baseline failed at reset before Studio assertions. The rerun uses the existing disposable-database helper and the same required command; no dev/shared schema repair is included.
- An inspector-mount settlement guard discarded held annotation 200/409 outcomes after switching rows. Settlement now follows the game/audience workspace; the audience generation invalidates synchronously before routing. Native source playback is not paused again when a delayed save settles.
- Production draft/conflict keys have colon suffixes and can resemble game metadata URLs. Revocation clears owned draft/operation/UI keys independently of the allowed metadata-read exception.
- Two older browser journeys needed current operation entry points/assertions: Tools → Episode tools, and Trailer & poster for an admin without episode-edit permission. Their first failure left a fixture role downgraded and caused a subsequent banner read failure. Production permission gates were preserved.

### Current evidence ledger

- `bun run test`: **2,481 passed, 5 existing skips, 0 failures**, 18,064 assertions across 261 files. Log: `/tmp/studio-refinements-test-final.log`.
- `bun run test:postgres`: **1,983 passed, 0 failures**, 22,568 assertions across 171 files, using the existing isolated PostgreSQL helper around the unchanged required command. Log: `/tmp/studio-refinements-postgres-isolated.log`. The shared test-schema drift remains an environment issue.
- `bun run check`: all package type/lint checks passed after final lifecycle fixes. Log: `/tmp/studio-refinements-check-final.log`.
- Focused actual-interface proof passed with real wheel/pan, held edge dragging, lost native capture, repeated playback paging, divider drag/arrows, resizing during playback, unchanged Player identity, independent label saves and narrow/short/fullscreen operation access. Log: `/tmp/studio-refinements-interface-final.log`; the final full-suite run rechecks the final integrated layout.
- Held annotation settlement proof: **1 passed**, both accepted 200 and conflicting 409 after inspecting a sibling; retained draft and accepted cut membership verified. Log: `/tmp/studio-refinements-annotation-settlement.log`.
- First complete browser run: 55 passed / 1 optional skip / 3 failures described above. Its Studio and direct encoded parity tests passed. Thought-only movie: 640×360 / 24 fps; three direct Studio/encoded frame differences below 2/255 and shared four-frame/reverse/random/fresh/contiguous verification. No scheduled speech/music clips in that cut. Artifact: `/var/folders/7b/zb_l0ml96vqg87_fzj__vh0c0000gn/T/production-studio-ui-encoded-proof-pmxGm3/studio-parity.json`.
- `STUDIO_INTERFACE_PROOF=1 STUDIO_ENCODED_PROOF=1 bun run test:browser:api`: **59 passed, 1 optional synthetic-duration skip, 0 failures**, 923 assertions across 13 files. Log: `/tmp/studio-refinements-browser-final2.log`. Includes current Studio pointer/resize/label proof, held annotation settlements, exact unknown retries, Werewolf admin/results, review/publication and canonical repair/publish/explicit-resume journeys. Exit code 0 after cleanup.
- Final direct encoded artifact: `/var/folders/7b/zb_l0ml96vqg87_fzj__vh0c0000gn/T/production-studio-ui-encoded-proof-2DRWBS/studio-parity.json`. Movie 640×360 / 24 fps; three direct Studio/encoded samples have mean differences 1.44 / 2.04 / 1.39 on the 255-level channel scale; the shared four-sample and contiguous-range verifier also passed. The thought-only schedule contains zero audio clips. This is not a new spoken-audio proof; the existing shared fixture covers recording waveform alignment/gain separately.
- Final narrow-height regression also passed after the last layout adjustment: 1 actual-interface test, 57 assertions, including Properties preview height at least the Moments preview height. Log: `/tmp/studio-refinements-narrow-final.log`. Owned browser/Next/API teardown and database drop completed; generated route-path additions were restored without resetting files.

The operator's normal API/web services were not restarted. The isolated prototype server was stopped after approved direction and integrated browser proof. Browser runs use owned databases/children; no provider generation, staging/production mutation, commit or deployment occurred. Broader global character shortcuts remain in the separate proposal; the implemented help lists only current control-owned keys and explicit metadata Save.

### Operator follow-up — immediate labels and one Cut rules control

Delivered acceptance remains pending. The operator reported Smart thinking consistently resolving to zero and redundant Cut rules entry points. Read-only inspection of the current Omniscient game confirmed Smart thinking rules but no stored annotations: checkbox changes were still drafts awaiting Save. The previous draft-only marking flow did not make that distinction clear enough for repeated editorial marking.

- [x] Save each checkbox immediately through the existing revision-checked annotation operation. Update cut membership only after acceptance and expose Saving, Saved, failure, conflict and exact-retry states. Existing pre-change drafts still require explicit Save once.
- [x] Keep custom metadata in draft, including unfinished and duplicate rows. Checkbox saves preserve saved custom tags without submitting those drafts; Cmd/Ctrl+Enter and Save labels retain explicit metadata ownership.
- [x] Unknown retries bypass current draft validation and submit the retained request exactly. Accepted checkbox values come from the result even after an audience switch cleared the old draft. Preserve audience-generation, session and access-denial settlement fences.
- [x] Keep one header Cut rules button, available as rules on narrow screens and while Properties hides the moment browser. Remove the redundant browser-heading entry point.
- [x] Add isolated real-browser regressions for three checkbox-only Smart thoughts, reload, exact cut/frozen IDs, Mystery exclusion, 390px/320px access, custom draft retention, uncertain retry, revision conflict and retry after audience change. The initial complete follow-up run passed all these new regressions and direct encoded parity.
- [x] Complete bounded save/retry simplification review. Fix the reviewer-found unfinished-draft retry, accepted-checkbox display and duplicate metadata-group retention cases. No remaining material review findings.

The initial follow-up full browser run had 60 passes, one optional skip and two obsolete assertions: an admin's existing `manage_postgame_media` grant permits Episode presentation; metadata key/value matching must not assume `cut` occupies row one after accepted label reconciliation. Both tests were corrected without altering production grants or metadata ordering. This also corrects the earlier ledger's mistaken description of that admin as lacking episode-edit permission. Log: `/tmp/studio-checkbox-browser-final.log`.

Fresh provider-free baseline: 2,481 passes, five existing skips, zero failures, 18,067 assertions across 261 files (`/tmp/studio-checkbox-test-final.log`). Its first sandbox run could not bind test HTTP listeners; the local-network rerun passed. The prior 1,983-test isolated PostgreSQL baseline above remains the API/schema baseline: this follow-up changes browser save behavior and browser tests, without changing backend storage or mutation services.

Final follow-up evidence:

- `bun run check`: all package types/lint passed after the retry and test-assertion fixes (`/tmp/studio-checkbox-check-corrected.log`).
- `STUDIO_INTERFACE_PROOF=1 STUDIO_ENCODED_PROOF=1 bun run test:browser:api`: **62 passed, one optional synthetic-duration skip, zero failures**, 968 assertions across 13 files, 453.21 seconds (`/tmp/studio-checkbox-browser-corrected.log`). All checkbox-only Smart, reload/freeze, narrow entry point, custom draft/conflict/exact retry, audience switch, delayed refresh, permission and existing recovery journeys passed. Exit code zero after owned cleanup; the Studio database drop is recorded in the log. Only generated Next route-path additions were restored after all children exited.
- Direct encoded parity: `/var/folders/7b/zb_l0ml96vqg87_fzj__vh0c0000gn/T/production-studio-ui-encoded-proof-lZzmOk/studio-parity.json`. Thought-only movie 640×360 / 24 fps, three Studio/encoded mean channel differences 1.44 / 2.04 / 1.39 on the 255-level scale. Shared reverse/random/fresh/contiguous verifier passed. Zero scheduled audio clips in this cut; recorded speech evidence remains the separate shared fixture.
- Actual saved-cut screenshots: `/var/folders/7b/zb_l0ml96vqg87_fzj__vh0c0000gn/T/production-studio-smart-cut-desktop.png` and `production-studio-smart-cut-narrow.png`. These are isolated canonical browser fixtures, not operator acceptance or real-game mutations.

The operator's game was inspected read-only; no labels were saved on their behalf. Normal API/web services were not restarted. Existing operator drafts need Save labels once before reload; new checkbox changes save directly. Previously downloaded selections remain frozen and require a fresh download to include newly saved moments. No providers, staging/production writes, commit or deployment occurred. Delivered operator acceptance remains open.

## Follow-up: select readable content, target the beginning

The operator changed the row-selection contract after testing: clicking a row should move the head into its type's visible content; the target icon should retain beginning-of-moment navigation. This explicitly supersedes the initial inspection-only decision above without changing layout, cut membership, source privacy or playback ownership.

- [x] Compile a content destination beside each moment's start/end using the existing presentation timing. Thinking uses its first read boundary after camera entrance, speech uses its read boundary, silent ballots use the existing revealed-vote boundary scaled to the hold, and other silent moments use the first authored shot's midpoint. Clamp within that shot, including one-frame shots. Atomic openings remain one moment.
- [x] Row selection pauses, seeks content, recenters and pins Properties. Target icons pause at the beginning and recenter. Previous/next moment transport retains beginning navigation. Settings and filters do not acquire a second seek owner.
- [x] Preserve the latest semantic content selection while media preparation has no mounted Player; resolve it against the eventual compiled timing. Mounted seeks retain exact moment/time offsets through the existing path. Source thinking-off or omitted-cut selection pauses/retains and explains the restriction without enabling hidden content.
- [x] Deterministic sampling proves readable thought/speech content at 24/30/60 fps, edited motion/reading settings, thought-only omission, first-shot bounds and silent-ballot reveal. Real browser proof covers both games, generated-scene speech, row/icon distinction, Source thinking-off pause and two selections made during held initial private-media preparation.
- [x] Bounded final reviewer found no remaining material content-anchor/selection issues after fixing the disabled-thinking early return.
- [x] Record the complete final browser/encoded run below after cleanup.
- [ ] Delivered operator acceptance remains pending; this behavior request is authorization to implement, not completed acceptance.

Fresh provider-free baseline: **2,483 passes, five existing skips, zero failures**, 18,192 assertions across 261 files (`/tmp/studio-content-frame-test.log`). Focused real interface/content proof passed both games and disabled-thinking pause (`/tmp/studio-content-frame-browser-fixed.log`, two passes); its delayed-media regression initially targeted the wrong game's route. After matching the Influence source service's actual private `/visual/artifacts/` path, the held-media test passed and database cleanup completed (`/tmp/studio-content-frame-delayed-media.log`, one pass). This was a test interceptor correction; product media routes were unchanged. The unchanged backend retains the isolated PostgreSQL baseline above.

Final integrated checks:

- `bun run check`: all-package typecheck and lint passed (`/tmp/studio-content-frame-check-final.log`).
- `STUDIO_INTERFACE_PROOF=1 STUDIO_ENCODED_PROOF=1 bun run test:browser:api`: **64 passes, one optional synthetic-duration skip, zero failures**, 994 assertions across 13 files, 454.96 seconds (`/tmp/studio-content-frame-browser-final.log`). Includes current row/icon selection, both games, held initial media, pointer/resize editing, annotation/conflict/permission journeys, public replay and canonical repair/publication/explicit resume. Exit zero after owned cleanup; Studio database drop recorded as `influence_e2e_46235_eaa83821bb1e4bd8ae5128fdadc5f2d9`.
- Direct Studio/frozen-export encoded proof: thought-only 640×360 at 24 fps, Studio/encoded frame differences 1.44 / 2.04 / 1.39 out of 255, plus the existing forward/reverse/random/fresh/contiguous sampling verifier. Zero scheduled audio clips. Artifact: `/var/folders/7b/zb_l0ml96vqg87_fzj__vh0c0000gn/T/production-studio-ui-encoded-proof-G4ohm7/studio-parity.json`.

Normal development API/web services were not restarted. Only the known generated Next route-path additions were restored after the isolated browser children exited; no files were reset. No real-game annotations, paid generation, staging/production writes, commit or deployment occurred. Operator acceptance remains separate.

## Follow-up: remaining keyboard shortcuts

The operator authorized the remaining keys from the [keyboard plan](2026-10-10-001-feat-production-studio-keyboard-shortcuts.md). They now use the existing Player/button actions and annotation owner, with Studio-scoped bubbling dispatch, native typing/control/layer ownership, a shared pointer-capture fence and a browser-local character-shortcut preference in the existing Help dialog. This supersedes the earlier proposal-only keyboard checkpoint. Row selection still seeks readable content; bracket navigation and the target icon seek moment beginnings. Follow current moment remains independent from timeline Auto-scroll. The keyboard plan records the current checks and manual acceptance boundary; no label or Auto-scroll letter keys were inferred.

## Follow-up: one settings-style tools panel

The operator requested a single X and a persistent section list because the previous tools hub replaced the whole dialog and supplied two equivalent close controls. This is authorization for the layout refinement; delivered usability acceptance remains separate.

- [x] Replace the hub with one dialog/section list. Desktop uses a side list; narrow screens use a horizontal strip. Active sections remain visible and content scroll resets on navigation.
- [x] Remove Done; retain one accessible 44px X, native modal focus containment, dropdown-first Escape and original-invoker restoration.
- [x] Embed existing episode, trailer and recovery forms with their current grants and operation owners. Remove obsolete episode/trailer modal wrappers and global Escape handling. Keep their draft/conflict/unknown-outcome state in the existing session.
- [x] Consolidate loading/loaded tool rendering so readiness does not replace the dialog. Cut rules and Export keep their dedicated entry points; audience changes still invalidate the outgoing private workspace.
- [x] Prove dialog identity, one close button, all sections, desktop/390px/320px, retained drafts and zero navigation writes for both games. The isolated harness needed its existing episode routes mounted; no production API contract was changed. Focused proof: 1 passed, 176 assertions (`/tmp/studio-tools-browser-focused2.log`); owned database was dropped. The three existing keyboard browser cases also passed with the new shell.
- [x] Finish required baseline and integrated interface/export/recovery proof, then record results.
- [ ] Operator acceptance of the delivered tools navigation.

Required provider-free baseline: `bun run test` passed **2,487 tests**, with five existing skips and zero failures, 18,320 assertions across 262 files (`/tmp/studio-tools-test-final.log`). `bun run check` passed all package typechecks and lint after removal of the unused dialog-size option and generated-route cleanup (`/tmp/studio-tools-check-final.log`).

Required PostgreSQL baseline: unchanged `bun run test:postgres` against a disposable migrated database passed **1,983 tests**, zero failures, 22,556 assertions across 171 files, 891.67 seconds (`/tmp/studio-tools-postgres-isolated.log`). The wrapper used the repository isolation helper rather than altering the development/shared schema; owned database cleanup completed (`influence_e2e_39842_21994e1647bf4eff82bbb2dfd5c20469`) and the process exited zero.

Integrated interface/encoded proof: `STUDIO_INTERFACE_PROOF=1 STUDIO_ENCODED_PROOF=1 bun run test:browser:api` passed **68 tests**, with one existing optional synthetic-duration skip and zero failures, 1,215 assertions across 13 files, 582.49 seconds (`/tmp/studio-tools-browser-complete.log`). Covers both games, persistent dialog identity, one X, every authorized section, retained episode drafts, dropdown-first Escape, 390px/320px layouts, zero navigation writes, existing keyboard/native-control fences, annotation/conflict/permission journeys, and canonical repair/publication/explicit resume. The Studio database was dropped (`influence_e2e_40455_14875c7c5b0c485291b4ab10d359ab9c`) and the suite exited zero after child cleanup.

Direct Studio/frozen-export encoded proof remains consistent: thought-only 640×360 at 24 fps, Studio/encoded frame differences 1.44 / 2.04 / 1.39 out of 255, zero scheduled audio clips, with reverse/random/fresh/contiguous sampling and encoded frame/audio presence verified. Artifact: `/var/folders/7b/zb_l0ml96vqg87_fzj__vh0c0000gn/T/production-studio-ui-encoded-proof-KT5u03/studio-parity.json`. Desktop and narrow tools screenshots for both games were captured; Influence screenshots were visually inspected. Normal Studio returned HTTP 200 after the isolated suite. Development services were not restarted; only generated Next route-path additions were restored after browser children exited. No real-game writes, paid generation, staging/production writes, commit or deployment occurred. Delivered operator acceptance remains pending.

## Follow-up: Werewolf Studio entry audience

- [x] Default a missing Studio audience parameter to Omniscient, exposing accepted thinking on entry. Keep explicit Mystery choices, Influence's public audience, existing invalid-value handling and public replay behavior. Audience controls, authorization and source projection retain their existing owners.
- [x] Update the existing Mystery browser journeys to choose that audience explicitly; prove both direct Studio entry and the admin-to-Studio link reveal thinking by default, with subsequent Mystery isolation and Omniscient switching preserved.
- [x] Run provider-free, affected browser and typecheck/lint checks; preserve existing changes and restore only generated Next route paths after owned browser cleanup.

Fresh `bun run test`: **2,487 passes**, five existing skips, zero failures, 18,323 assertions across 262 files (`/tmp/studio-omniscient-test.log`). Affected Studio interface suite: **18 passes**, two opt-in encoded/long-source skips, zero failures, 708 assertions (`/tmp/studio-omniscient-browser.log`); owned database drop recorded as `influence_e2e_59700_f3c555cb13ee47d28101c2e090b651c9`. Admin-to-Studio Werewolf journey: **one pass**, zero failures, 50 assertions (`/tmp/studio-omniscient-werewolf-entry.log`), with owned cleanup and zero process exit. `bun run check` passed (`/tmp/studio-omniscient-check.log`). The unchanged backend/exporter retains the immediately preceding PostgreSQL, full browser and encoded proofs above; those were not rerun for this entry-default change. Normal development services were not restarted and no real-game writes or paid generation occurred. Broader operator acceptance remains pending.

## Follow-up: missing frozen character art — 2026-10-12

- [x] Stop advertising a nonexistent frozen portrait in production sources. Reuse the existing nullable field and shared stage fallback for Studio and export; preserve game-start identity and public replay behavior.
- [x] Retain an available frozen body independently from portrait availability, across identity/moment/pre-night bindings. Keep pin validation, current-profile isolation, explicit visual refresh and recovery permissions with their existing owners.
- [x] Prove missing-revision, body-only and later-restored portrait cases with an isolated PostgreSQL regression: one pass, 808 assertions (`/tmp/studio-fallback-postgres-focused2.log`), owned database dropped.
- [x] Prove real Studio opening, seeking, labels, selected-cut download, desktop/narrow presentation and encoded fallback parity: one pass (`/tmp/studio-fallback-browser-focused.log`), owned database dropped. The thought-only 640×360/24 fps encoded comparison measured 1.41 / 1.87 / 1.36 mean frame differences out of 255, zero scheduled audio clips, with reverse/random/fresh/contiguous sampling verified. Artifact: `/var/folders/7b/zb_l0ml96vqg87_fzj__vh0c0000gn/T/production-studio-missing-art-encoded-UFe6b3/studio-parity.json`.
- [x] Run required provider-free, PostgreSQL, full browser/interface/encoded and typecheck/lint baselines; record actual outcomes and verify cleanup.
- [ ] Deployment and delivered operator acceptance remain separate from local implementation/proof.

See the [solution record](../solutions/ui-bugs/2026-10-12-production-studio-missing-frozen-character-art.md). The staging investigation used a read-only transaction; no staging data, paid generation, real-game repair or deployment was authorized or performed.

Fresh provider-free baseline: **2,512 passes**, five existing skips, zero failures, 18,436 assertions across 264 files (`/tmp/studio-fallback-test.log`). Fresh isolated PostgreSQL baseline: unchanged `bun run test:postgres` passed **1,993 tests**, zero failures, 23,423 assertions across 171 files, 752.63 seconds (`/tmp/studio-fallback-postgres-full.log`); owned database drop completed as `influence_e2e_75191_f894b7b0904941fbbe6bd9aca022399a`.

Integrated browser runs exposed a capture before the fresh Player's visible measured layout had painted, and the season harness exceeded its default five-second cleanup hook. The shared sampling helper now foregrounds the preview, waits for visible measured bounds, then waits for paint without relaxing frame/pixel comparisons; the season hook retains its existing bounded cleanup steps with the matching 60-second total deadline. The complete Studio interface/encoded suite passed after these corrections: **20 passes**, one optional synthetic-duration skip, zero failures, 721 assertions (`/tmp/studio-fallback-browser-paint2.log`); its owned database was dropped (`influence_e2e_24633_c7e392ca86f8446c81f914007500e473`). The corrected fallback's encoded frame differences were 1.44 / 2.04 / 1.39 out of 255, with the same sampling and audio checks; artifact: `/var/folders/7b/zb_l0ml96vqg87_fzj__vh0c0000gn/T/production-studio-missing-art-encoded-GrkYpX/studio-parity.json`.

Final required full browser/interface/encoded run: **69 passes**, one optional synthetic-duration skip and **one failure**, 1,247 assertions across 13 files, 612.64 seconds (`/tmp/studio-fallback-browser-complete.log`). Every Studio test, both encoded comparisons and the season cleanup passed. The public Werewolf game-creation/replay journey showed `Failed to fetch` after a replay reload and timed out in `watchStops`; this public path passed in the preceding integrated run and its binding contract is unchanged by the fix. Its isolated rerun passed **one test**, zero failures, 31 assertions, 16.92 seconds (`/tmp/studio-fallback-public-watch-rerun.log`). The full run's nonzero result remains recorded; no product retry or broad transport change was added for a failure that did not reproduce.

The integrated missing-art export again measured 1.44 / 2.04 / 1.39 frame differences out of 255, with zero scheduled audio and all verifier sampling checks (`/var/folders/7b/zb_l0ml96vqg87_fzj__vh0c0000gn/T/production-studio-missing-art-encoded-b2qgkr/studio-parity.json`). Its owned database was dropped (`influence_e2e_28423_0aeebdb89ee743e9ab8118ef059cc708`). `bun run check` passed all package typechecks and lint (`/tmp/studio-fallback-check-final.log`); `git diff --check` passed. Owned runners and browser-server children exited, only generated Next route-path additions were restored, and the existing local Studio returned HTTP 200. Development services were not restarted. Deployment, staging verification and delivered operator acceptance remain separate; no paid generation, real-game writes, commit or deployment occurred.
