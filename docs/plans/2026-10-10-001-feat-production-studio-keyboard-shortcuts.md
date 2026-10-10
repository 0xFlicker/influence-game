---
title: Production Studio keyboard shortcuts and help
type: feat
status: in_progress
date: 2026-10-10
pillar: A2
slices: [A2.1, A2.2]
---

# Production Studio keyboard shortcuts and help

Current delivery: the remaining scoped bindings are implemented in the existing Studio and Help dialog. All required local checks, real keyboard/interface proof and encoded parity passed. Native macOS fullscreen and operator acceptance are recorded separately below.

Historical refinement checkpoint, before the remaining-shortcuts implementation: native timeline arrows/Home/End, separator arrows and inspector-only Cmd/Ctrl+Enter saving are implemented, with a compact Keyboard hints dialog. The broader workspace character dispatcher below remains a proposal. Inspector following is now **Follow current moment**; **Auto-scroll timeline** owns only viewport paging, and **Recenter** does not enable it. Following operator testing, label checkboxes save immediately through the existing annotation/CAS owner; the save chord applies remaining metadata drafts through that same owner. Do not advertise unimplemented Space/M/F/etc. global bindings in delivered help.

Historical planning scope (superseded by the operator’s explicit instruction to implement the remaining shortcuts): planning only. The operator is testing the running Studio; no application changes, service restarts, browser interaction, database writes or test harnesses are authorized by this planning request. This document proposes a small keyboard layer for the existing editing loop, with visible hints. It does not establish keyboard proof or operator approval.

The subsequent [editing refinements plan](2026-10-10-002-feat-production-studio-editing-refinements.md) records real-use feedback and decisions: wheel zoom/Shift+wheel pan, reusable thought/speech labels, per-type cut rules and compressed narrow-screen chrome. A later operator decision restores row-click seeking at a readable content offset; the separate target icon seeks the beginning. Both pause and recenter. Reconcile these visible actions before implementing shortcuts. Inspector following and timeline auto-scrolling are different actions; this draft's R binding concerns the inspector only. Native splitter keys must retain resizing ownership. Letter bindings for labels and timeline auto-scroll/recenter remain to be chosen; do not infer them from this draft.

## Source inventory at planning time

Read-only inspection of `codex/production-studio` on 2026-10-10 found:

- `production-preview.tsx` already handles Left/Right (one frame), Shift+Left/Right (one second) and Home/End on the focused timeline. It pauses and uses the existing bounded seek/anchor path.
- Remotion Player 4.0.486 has `spaceKeyToPlayOrPause={false}`. Its installed `PlayerRef` exposes play, pause, toggle, seek, current frame, mute and volume. Playback remains owned by Player.
- `ProductionPreviewHandle` exposes `pauseAndRetainAnchor()` and `seekMoment(id, at)`, with start/content destinations. Transport buttons call local functions and Player directly.
- `MomentWorkspace` owns Source/Selected cut, panel state, moment search, following/pinned inspection and presentation settings. `MomentInspector` owns the tag draft, revision check and exact save/retry path through `AdminSession`.
- `StudioDialog` uses native modal dialogs and returns focus to the prior element. `StudioSelect` already owns arrow navigation and Escape through Floating UI. Existing browser proof checks that Escape closes a select without closing its containing dialog.
- Public watch has its own `useWatchKeyboard` with different advance/chapter/speed semantics. Do not merge these controls or alter public replay to add Studio shortcuts.

Sources: [preview](../../packages/web/src/app/admin/production/production-preview.tsx), [workspace and inspector](../../packages/web/src/app/admin/production/production-workspace.tsx), [dialog](../../packages/web/src/app/admin/production/studio-dialog.tsx), [select](../../packages/web/src/app/admin/production/studio-select.tsx), [Player/seek learnings](../solutions/ui-bugs/2026-10-09-production-studio-player-and-frozen-recordings.md), [parent delivery plan](2026-10-09-001-feat-production-studio-moment-editor.md).

## Initial bindings

The implementation below follows these agreed bindings. The active Source/Selected cut determines the playable timeline. No command silently switches to Source to reveal an omitted moment.

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
| `production-workspace.tsx` | Own scoped dispatch, availability, Source/Cut, search/properties focus, follow and help/export panel actions. Keep tag save inside MomentInspector with its own bubbling chord handler and existing operation owner; share workspace keyboard eligibility without a global save registration. |
| `studio-dialog.tsx`, `studio-select.tsx` | Retain layer/focus/Escape behavior. Only add explicit shortcut suppression markers if necessary for reliable layer detection; do not rewrite these components. |
| Existing `studio-shortcut-hints.tsx`, `workspace.module.css` | Render the same binding definitions in the existing dialog, add the compact entry button/`kbd` styling and narrow/fullscreen placement. |
| Existing unit/browser tests, `docs/production-studio.md` | Add behavior regressions and document implemented bindings after delivery. |

Suggested work sequence, after the operator's current testing session:

- [x] Initial bindings and existing Help placement authorized by the operator’s remaining-shortcuts implementation request.
- [x] Extract transport actions without changing behavior; prove buttons/local timeline still work.
- [x] Add scoped matching, suppression, repeat rules and current-frame stepping.
- [x] Add navigation/focus actions and the inspector-only save chord with existing conflict/retry ownership.
- [x] Add shared help/hints, preference and responsive/fullscreen behavior.
- [x] Run focused deterministic and real-browser keyboard regressions; update implemented documentation.
- [x] Complete the required integrated checks and record final proof.
- [ ] Operator tries the delivered keys, including native macOS fullscreen. Automated proof does not establish this acceptance.

## Validation checklist

- Repeated Left/Right and Shift stepping from paused and playing states update committed frames, moment properties, text pages and audio together. Clamp correctly at frame zero/end and between moment boundaries in Source/Cut; do not restore an older seek after a slow response/remount.
- Hold a step key; each event reads the latest frame. Space/M/F/1/2/E/? and save execute once per press. No keyboard action interferes with a real pointer drag or runs after loading finishes.
- Native Space on the Play button toggles once. Focused timeline keys also step once. Dropdown arrows/Home/End/character input and volume/zoom arrows never move the playhead or switch views.
- Type text containing every proposed letter/symbol/digit in search/tag fields and contenteditable controls, including IME/AltGraph. Neither playback nor panel/cut changes occur. Cmd/Ctrl+Enter saves only the displayed known draft; two presses cannot duplicate an in-flight request.
- Conflicts, unknown outcomes, invalid drafts and permission changes preserve their existing locks and explicit retry controls. Mystery exposes no thinking through T, moment navigation, help state or handwritten URLs.
- Source/Cut switching and shortcut-opened panels retain anchors/drafts. T reveals and pins the intended thought independently from sibling speech; saving its tag uses the existing exact selection/compiler.
- Escape closes an open menu first, then its dialog, without double dismissal or a fullscreen exit at the same time. Help fits desktop, 390px width, short windows and actual fullscreen; focus returns to its invoker. Native macOS fullscreen remains a manual proof boundary.
- Disable character shortcuts and verify all listed character bindings are inert while visible buttons, the timeline and save chord work. Browser/OS commands and controls outside Studio stay untouched.
- Extend `studio-interface-review.ts` / `replay-visual-production.e2e.test.ts`; use the existing isolated database/child-cleanup rules. The implementation request authorizes isolated harnesses; keep the operator’s dev services and real games untouched. No providers or deployed writes are needed.

No tests or browser proof were run for the original draft. Its evidence was read-only source/dependency/reference inspection and documentation validation.


## Remaining-shortcuts implementation ledger

2026-10-10: The operator explicitly requested implementation. The finite binding list now drives matching, button tooltips/`aria-keyshortcuts` and existing Help rows. A bubbling Studio handler owns navigation/panel actions; typed Preview commands use the existing Player/button actions and current frame. The inspector owns the platform-specific save chord through its existing validated annotation/CAS operation. Export only opens its panel. No new clock, listener on public watch, dependency, mutation owner or label/autoscroll key was added.

Native typing/IME/AltGraph, browser modifiers, menus/dialogs, sliders, separator and button/disclosure Space keep their owners. Only frame/second steps repeat. Letter/symbol commands have a browser-local Help preference. Pointer capture eligibility is shared by workspace dispatch, focused timeline commands and inspector save, while accepted responses keep their separate workspace/access settlement fences. Register known drag surfaces on pointerdown and inspect native capture directly: the divider captures on pointermove before React receives its capture event, including input in its expanded hit area. Removed/released elements cannot permanently disable the replacement Player.

The first full browser run exposed the native-capture timing gap above. Two cleanup defects also contaminated later fixtures: releasing a mouse button that was already up interrupted teardown, and a held annotation could settle after fixture restoration. Tests now reset input, release and settle requests, restore the prior browser preference and then restore fixture rows. The subsequent failed run predates these cleanup fixes; its downstream failures are not counted as product proof.

Final validation:

- `bun run test`: **2,487 passed, 5 existing skips, 0 failures**, 18,324 assertions across 262 files (`/tmp/studio-keyboard-test-final.log`).
- `bun run test:postgres`: **1,983 passed, 0 failures**, 22,564 assertions across 171 files (`/tmp/studio-keyboard-postgres-isolated.log`), using the existing disposable-database helper around the unchanged required command. Its database was dropped; the development/shared schema was not repaired or changed.
- `bun run check`: all-package typecheck and lint passed (`/tmp/studio-keyboard-check-delivery.log`).
- Focused keyboard browser regressions: **3 passed, 0 failures**, 45 assertions (`/tmp/studio-keyboard-browser-focused-final.log`), with database `influence_e2e_54363_d30a3f0354024ef5a10174da83f76820` dropped. Real input covers both games, repeated Player stepping, native control ownership, captured-divider removal, metadata/save ownership, a real revision conflict, narrow focus/persisted preference, loading without queued commands and Mystery privacy.
- `STUDIO_INTERFACE_PROOF=1 STUDIO_ENCODED_PROOF=1 bun run test:browser:api`: **67 passed, 1 optional synthetic-duration skip, 0 failures**, 1,039 assertions across 13 files, 494.43 seconds (`/tmp/studio-keyboard-browser-complete.log`). Includes those keyboard fixtures, desktop/narrow/short/fullscreen interface proof, row/content navigation, real pointer/wheel/resize, held annotation outcomes, uncertain retries, permissions, public replay and canonical repair/publication/explicit resume. Exit zero after owned cleanup; Studio database `influence_e2e_55310_9c08a83a354b4cafaf1b0e062c8ec85e` was dropped.
- Direct encoded parity artifact: `/var/folders/7b/zb_l0ml96vqg87_fzj__vh0c0000gn/T/production-studio-ui-encoded-proof-h7Jaaw/studio-parity.json`. The frozen thought-only Werewolf cut at 640×360 / 24 fps matched three Studio samples with mean channel differences **1.44 / 2.04 / 1.39 out of 255**, and passed the shared forward/reverse/random/fresh/contiguous verifier. Its schedule has zero audio clips. This is frame/omission evidence; recorded-speech waveform alignment/gain retains the separate shared verifier evidence.

Native macOS fullscreen and operator keyboard acceptance remain manual boundaries. Development services were not restarted; the normal Studio returned HTTP 200 after the changes. Only generated Next route-path additions were restored after all browser children exited. No real-game annotations, paid generation, staging/production writes, commit or deployment occurred. Labels, Auto-scroll keys, J/K/L, remapping and a command palette remain explicitly unassigned/deferred.
