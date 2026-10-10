---
title: Production Studio timeline, editorial labels and workspace sizing
type: feat
status: draft
date: 2026-10-10
pillar: A2
slices: [A2.1, A2.2]
---

# Production Studio editing refinements

Planning only. This follows real local Studio use and supplements the [combined delivery plan](2026-10-09-001-feat-production-studio-moment-editor.md) and [keyboard proposal](2026-10-10-001-feat-production-studio-keyboard-shortcuts.md). No application edits, restarts, browser interaction, database writes, dependency installation or test harnesses were performed for this draft. Delivered-workspace acceptance remains pending; approval of the prior prototype does not establish acceptance of these changes.

## Operator decisions from 2026-10-10

- A moment row selects its properties without seeking. A separate target/crosshair icon pauses, seeks to that moment and recenters the timeline. Pin denotes inspection state, so it is unsuitable for seek; a triangle suggests expansion.
- Vertical wheel movement over the timeline zooms around the playhead. Shift+wheel pans. Horizontal trackpad movement pans. Provide a visible horizontal scrolling control.
- Thinking labels: **Smart**, **4th wall**, **Mistake**. Speech/message labels: **Smart**, **Mistake**, **Aggressive**. Labels are independent checkboxes and reusable across cuts, rather than membership in a single named export.
- Cut controls have **All / None / Matching labels** per type. Matching includes any checked label within that type: thinking marked Smart OR 4th wall, for example. No exclusions or nested logical editor in this pass.
- On narrow screens the first problem is stacked navigation, titles and toolbars consuming the space above the preview. Compress those into a small bar and menus, then enlarge the preview. A narrow-screen resize handle is optional and is not a prerequisite.
- The reported absence of thinking occurred in Werewolf **Mystery**, on Source. Mystery deliberately excludes thinking. The UI must explain this restriction; Omniscient exposes available accepted contestant thoughts.

Playback page scrolling, proposed pane limits, label saving details and final compact layout below are recommendations for the next pass, not claims of implemented behavior or new operator acceptance.

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

## Validation for a later authorized coding pass

- [ ] Geometry tests cover middle/boundary zoom anchoring, Fit, pan bounds, resize, and zero/one-frame timelines; no operation changes the sampled frame unless seeking was requested.
- [ ] Browser proof measures actual content/viewport/scroll positions and exercises real vertical wheel, Shift+wheel, horizontal trackpad-equivalent input and the visible scrollbar. Browser zoom and controls outside the timeline retain normal behavior.
- [ ] Captured pointer seeks continuously while the viewport pans at both edges, including held-still edge dragging, cancellation, lost capture and changing media/scope. Playback auto-scroll pages repeatedly until the final frame; manual pan turns it off visibly.
- [ ] Row selection changes properties without moving the frame; target icon pauses and seeks/recenters. Active vs inspected styling remains clear. Omitted cut moments never reveal Source without an explicit action.
- [ ] Real authorized thinking appears separately in Omniscient/Influence; Mystery shows an explanatory policy state without private data/counts. Browser-only filters do not change cut membership or source pin.
- [ ] Checkbox drafts/save/conflict/unknown retry/permission loss use the existing single annotation owner. Independent thought/speech flags, retained unrelated tags and a second producer's revision edits are covered.
- [ ] Per-kind OR cases include all speech plus Smart/4th-wall thinking, thought-only and mixed highlights; empty matches, multiple labels, source order, no duplicates, unsupported kinds/keys and handcrafted private references are covered.
- [ ] Existing full-export IDs/coverage are unchanged. Previously downloaded full/tagged/ids exports still verify their unmodified hashes. Recipe freeze uses one selection snapshot, rejects stale displayed membership, and survives later label edits via its exact frozen IDs.
- [ ] Resize/collapsed chrome fits real desktop, HD, narrow/short and fullscreen views without reducing focus/touch access or stranding repair, review, publish, resume, settings, recording or export operations. Separator arrows do not step frames. Monitor resize preserves frame/audio and output geometry.
- [ ] Shared renderer sampling remains forward/reverse/random/fresh-mount consistent; slow responses cannot restore an older seek. Thought cuts never flash omitted speech. Preview/export frame and audio parity is checked using the existing local verifier after selection changes.
- [ ] After code lands, run `bun run test`, `bun run test:postgres`, `bun run check`, `bun run test:browser:api`, with existing PostgreSQL isolation and browser-child cleanup. No paid generation or staging/production mutations.
- [ ] Operator reviews the revised editing loop and explicitly accepts it. Current feedback and planning answers establish requirements, not delivered acceptance.

This draft records source/research findings and decisions only. Browser scrolling defects, new labels/rules, resizing and compact chrome have not been implemented or newly tested here. Export readiness/concurrency, broad transport audit, harmonize schema alignment and A2.3 job console remain separate.
