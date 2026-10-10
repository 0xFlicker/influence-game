---
title: Production Studio keyboard shortcuts and help
type: feat
status: draft
date: 2026-10-10
pillar: A2
slices: [A2.1, A2.2]
---

# Production Studio keyboard shortcuts and help

Planning only. The operator is testing the running Studio; no application changes, service restarts, browser interaction, database writes or test harnesses are authorized by this planning request. This document proposes a small keyboard layer for the existing editing loop, with visible hints. It does not establish keyboard proof or operator approval.

The subsequent [editing refinements plan](2026-10-10-002-feat-production-studio-editing-refinements.md) records real-use feedback and decisions: row inspection no longer seeks, a separate seek icon recenters, wheel zoom/Shift+wheel pan, reusable thought/speech labels, per-type cut rules and compressed narrow-screen chrome. Reconcile these visible actions before implementing shortcuts. Inspector following and timeline auto-scrolling are different actions; this draft's R binding concerns the inspector only. Native splitter keys must retain resizing ownership. Letter bindings for labels and timeline auto-scroll/recenter remain to be chosen; do not infer them from this draft.

## Current implementation

Read-only inspection of `codex/production-studio` on 2026-10-10 found:

- `production-preview.tsx` already handles Left/Right (one frame), Shift+Left/Right (one second) and Home/End on the focused timeline. It pauses and uses the existing bounded seek/anchor path.
- Remotion Player 4.0.486 has `spaceKeyToPlayOrPause={false}`. Its installed `PlayerRef` exposes play, pause, toggle, seek, current frame, mute and volume. Playback remains owned by Player.
- `ProductionPreviewHandle` currently exposes only `pauseAndRetainAnchor()` and `seekMoment(id)`. Transport buttons call local functions and Player directly.
- `MomentWorkspace` owns Source/Selected cut, panel state, moment search, following/pinned inspection and presentation settings. `MomentInspector` owns the tag draft, revision check and exact save/retry path through `AdminSession`.
- `StudioDialog` uses native modal dialogs and returns focus to the prior element. `StudioSelect` already owns arrow navigation and Escape through Floating UI. Existing browser proof checks that Escape closes a select without closing its containing dialog.
- Public watch has its own `useWatchKeyboard` with different advance/chapter/speed semantics. Do not merge these controls or alter public replay to add Studio shortcuts.

Sources: [preview](../../packages/web/src/app/admin/production/production-preview.tsx), [workspace and inspector](../../packages/web/src/app/admin/production/production-workspace.tsx), [dialog](../../packages/web/src/app/admin/production/studio-dialog.tsx), [select](../../packages/web/src/app/admin/production/studio-select.tsx), [Player/seek learnings](../solutions/ui-bugs/2026-10-09-production-studio-player-and-frozen-recordings.md), [parent delivery plan](2026-10-09-001-feat-production-studio-moment-editor.md).

## Proposed initial bindings

These are proposals, not available shortcuts except for the existing focused timeline keys noted above. The active Source/Selected cut determines the playable timeline. No command silently switches to Source to reveal an omitted moment.

| Key | Action | Behavior |
| --- | --- | --- |
| Space | Play / pause | Use the current Player. On a focused button, Space retains native button activation. |
| Left / Right | Previous / next frame | Pause; step one frame; retain the exact moment/time anchor. |
| Shift+Left / Right | Back / forward one second | Pause; step by the current FPS, clamped at either end. |
| `[` / `]` | Previous / next playable moment | Pause and seek its beginning in the current Source/Cut. Use moment boundaries, not scene or response identity. |
| Home / End | Beginning / final frame | Pause and seek the bounded timeline endpoint. These keep their native meaning in fields and other controls. |
| M | Mute / unmute | Change monitoring audio only; do not change the exported music mix. |
| F | Enter / exit Studio fullscreen | Reuse the existing workspace fullscreen action; preserve errors and native fullscreen behavior. |
| `1` / `2` | Source / Selected cut | Reuse the view change and moment-anchor mapping. Reveal the corresponding moment panel on narrow screens. |
| `/` | Find a moment | Reveal the browser on narrow screens, pause/pin the current preview, then focus its search field. Do not erase the existing query. |
| T | Edit this moment's tags | Pause and pin the inspected moment, reveal Properties on narrow screens, and focus its first tag field or Add tag if no fields exist. This does not add a row, select cut membership or save. |
| Cmd+Enter on macOS / Ctrl+Enter elsewhere | Save displayed tag draft | Only inside the active MomentInspector, including its fields. Same validated save/CAS as the button; no implicit conflict overwrite or unknown-outcome retry. |
| R | Follow current moment in properties | Release the inspection pin; do not discard a saved/local draft or resume playback. This does not enable timeline viewport auto-scroll. |
| E | Open Export | Open the current Export dialog. Do not freeze, download, encode or start a job. |
| `?` | Keyboard shortcuts | Open the help dialog, pause/pin preview and preserve all editing state. |
| Escape | Dismiss the current layer | Keep existing menu → containing dialog → native fullscreen ownership. Do not install a competing global Escape handler. |

Existing native controls remain keyboard accessible: Tab/Shift+Tab move focus, Enter/Space activate buttons, and the volume/zoom sliders keep their arrow keys. Add Up/Down frame equivalents to the focused timeline so its slider semantics agree with the [WAI slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/). Up/Down are not global moment-navigation commands.

Do not intercept browser/OS commands such as Cmd/Ctrl+F, Cmd/Ctrl+S, Cmd/Ctrl+W, browser zoom or browser history. Do not bind Delete/Backspace to removing moments. No shortcut directly regenerates, reviews, publishes, resumes, refreshes pinned visuals, changes audience or sends an export request.

Defer J/K/L shuttling, reverse playback, held-key acceleration, custom remapping and a command palette. They require additional product/playback decisions and are not prerequisites for this initial set. A future direct Add/remove from cut action should get a shortcut only after it has a clear visible control and uses the same annotation owner; do not create a keyboard-only cut mutation now.

## Handling contract

1. **One scoped dispatch.** Use a bubbling React keyboard handler on the Studio workspace, active only while focus is within it and editorial access is current. Child controls handle their keys first; respect `defaultPrevented`. Avoid capture-phase/global listeners that outrun React's timeline/select handlers. Make the monitor focusable with a visible focus indicator so keyboard transport has a natural entry point; clicking its non-control surface may focus it. Do not use `role="application"`, a keyboard mode or a new transport owner.
2. **Typing wins.** Ignore shortcuts in inputs, textareas, selects, contenteditable regions and editable ARIA controls. The only exception is Cmd/Ctrl+Enter inside this inspector's tag editor. Ignore IME composition (`isComposing`), AltGraph and unrecognized modifiers. Use `event.key` for characters, including `?`, rather than assuming a US physical layout.
3. **Control keys stay local.** Space/Enter on buttons and links perform their native action once. Sliders, listboxes, menus and select triggers keep their navigation/typeahead keys. Timeline arrows/Home/End call the same transport actions locally and mark the event handled; the workspace must not step again.
4. **Open layers suspend editing shortcuts.** Any open native/custom modal, select menu or authentication flow blocks workspace commands. Dialog controls and native Escape retain their owner. Cmd/Ctrl+Enter must never submit a scene, release or authentication form. A select closes before its dialog; closing Help restores its invoker and leaves playback paused, matching existing Studio panel behavior.
5. **Read current Player time.** Frame steps use `getCurrentFrame()` for each keydown, not a stale React frame captured before repeated events. Reuse bounded seek and retained anchors; no second timer, polling loop, renderer or audio controller. Allow browser key repeat only for frame/one-second stepping. Ignore repeat for toggles, moment navigation, panel/view changes and saves.
6. **Same readiness and permissions.** Transport commands do nothing while no usable Player exists, during pointer capture, after permission loss or after unmount. Help remains available. No queued command may execute when delayed media becomes ready. Cmd/Ctrl+Enter is available only for a changed valid draft, current inspector identity and a known editable operation state; conflict/unknown/submitting states require the existing explicit controls.
7. **Single action path.** Extract/reuse the existing button actions, then bind shortcuts to those functions. If repeat exposes a shared seek defect, fix it in that action with a focused regression. Do not fix keyboard behavior by a separate seek implementation or synthetic DOM clicks.
8. **Character shortcut preference.** Help includes an accessible “Enable letter and symbol shortcuts” checkbox, initially enabled, with a browser-local preference and no server storage. Off disables letters, digits, brackets, `/` and `?`; the visible Help button, native timeline controls and explicit save chord remain. Character shortcuts must be focus scoped and/or switchable; the off switch directly addresses [WCAG character-key guidance](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html). Keep labels such as “Works while focus is in Studio; typing keeps its normal keys.”

## Hint placement and appearance

Recommended: one small **Keyboard shortcuts · ?** button at the right of the timeline header, adjacent to Timeline zoom. It is always discoverable without adding another permanent pane or consuming monitor space. On narrow screens use a keyboard icon with an accessible name and a 44px touch target; it opens the same dialog and supports an attached hardware keyboard.

Reuse `StudioDialog` for the help panel: compact width, internally scrolling body on short screens, paired action/`kbd` rows grouped as Playback, Navigation, Editing and Panels. It stays inside the Studio fullscreen subtree and returns focus on dismissal. The close and Done controls remain familiar. Include the character-shortcut preference and a short explanation that T edits tags while saving matching tags builds a cut.

Show compact key hints in relevant button tooltips/accessibility descriptions: Play (Space), Mute (M), Fullscreen (F), Export (E), Save tags (Cmd/Ctrl+Enter). Add `aria-keyshortcuts` to the action controls with the correct key syntax. One finite binding definition should generate the help rows and display hints so copy cannot drift from behavior.

Do not put this panel under Presentation or export settings: keyboard controls apply to editing. Do not auto-open it, keep a large help sidebar or open another popup above an already open dialog. A nonmodal popover is an alternative if the operator later needs a reference to remain visible while working; start with the existing dialog rather than maintaining two hint surfaces.

## Implementation points and order

| Location | Planned responsibility |
| --- | --- |
| New `packages/web/src/app/admin/production/studio-shortcuts.ts` | Small finite bindings, labels, key matching and focus/modifier eligibility. No command plugin registry or new dependency. |
| `production-preview.tsx` | Reuse/expose the existing play/pause, bounded frame/moment seek, monitor mute and Studio fullscreen functions through a typed handle. Buttons and local timeline keys use these same actions. |
| `production-workspace.tsx` | Own scoped dispatch, availability, Source/Cut, search/properties focus, follow and help/export panel actions. Keep tag save inside MomentInspector; register only its currently mounted save capability with cleanup and stable moment identity. |
| `studio-dialog.tsx`, `studio-select.tsx` | Retain layer/focus/Escape behavior. Only add explicit shortcut suppression markers if necessary for reliable layer detection; do not rewrite these components. |
| New `studio-shortcuts-help.tsx`, `workspace.module.css` | Render the same binding definitions in the existing dialog, add the compact entry button/`kbd` styling and narrow/fullscreen placement. |
| Existing unit/browser tests, `docs/production-studio.md` | Add behavior regressions and document implemented bindings after delivery. |

Suggested work sequence, after the operator's current testing session:

- [ ] Agree initial bindings and help placement; this draft does not authorize implementation during testing.
- [ ] Extract transport actions without changing behavior; prove buttons/local timeline still work.
- [ ] Add scoped matching, suppression, repeat rules and current-frame stepping.
- [ ] Add navigation/focus actions and the inspector-only save chord with existing conflict/retry ownership.
- [ ] Add shared help/hints, preference and responsive/fullscreen behavior.
- [ ] Run focused regressions, then required checks and manual keyboard acceptance; update implemented documentation.

## Validation to perform later

- Repeated Left/Right and Shift stepping from paused and playing states update committed frames, moment properties, text pages and audio together. Clamp correctly at frame zero/end and between moment boundaries in Source/Cut; do not restore an older seek after a slow response/remount.
- Hold a step key; each event reads the latest frame. Space/M/F/1/2/E/? and save execute once per press. No keyboard action interferes with a real pointer drag or runs after loading finishes.
- Native Space on the Play button toggles once. Focused timeline keys also step once. Dropdown arrows/Home/End/character input and volume/zoom arrows never move the playhead or switch views.
- Type text containing every proposed letter/symbol/digit in search/tag fields and contenteditable controls, including IME/AltGraph. Neither playback nor panel/cut changes occur. Cmd/Ctrl+Enter saves only the displayed known draft; two presses cannot duplicate an in-flight request.
- Conflicts, unknown outcomes, invalid drafts and permission changes preserve their existing locks and explicit retry controls. Mystery exposes no thinking through T, moment navigation, help state or handwritten URLs.
- Source/Cut switching and shortcut-opened panels retain anchors/drafts. T reveals and pins the intended thought independently from sibling speech; saving its tag uses the existing exact selection/compiler.
- Escape closes an open menu first, then its dialog, without double dismissal or a fullscreen exit at the same time. Help fits desktop, 390px width, short windows and actual fullscreen; focus returns to its invoker. Native macOS fullscreen remains a manual proof boundary.
- Disable character shortcuts and verify all listed character bindings are inert while visible buttons, the timeline and save chord work. Browser/OS commands and controls outside Studio stay untouched.
- Extend `studio-interface-review.ts` / `replay-visual-production.e2e.test.ts`; use the existing isolated database/child-cleanup rules. Do not launch these harnesses during the current operator session. No providers or deployed writes are needed.

No tests or browser proof were run for this draft. Only read-only source/dependency/reference inspection and documentation validation belong to this planning pass.
