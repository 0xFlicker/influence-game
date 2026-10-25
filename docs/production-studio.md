# Production Studio

Open **Admin → Production**, choose a completed or validated visually paused Influence or Werewolf game, and open its studio. The library uses bounded metadata pages. A game played without generated imagery remains editable with portraits.

Influence uses the same 20-second House entrance, cast reveal, welcome card and
phase score as the public player. The opening is one selectable editorial moment;
**Add episode opening** includes all of its shots. Its timing stays fixed when
changing reading speed or motion timing. Music can be disabled for the whole cut,
and the final result can hold until the closing song finishes. Prepared exports
freeze the opening media and soundtrack alongside the selected cast art.

Games played before retrospectives remain editable. Influence sources retain their original accepted history and dialogue, including older classic games without a canonical event log; Werewolf v7 retains its original outcome boundary. Retrospective completion proof is required only after the game enters its canonical retrospective. Opening Studio never migrates a game or generates missing final statements.

Influence format ballot reveals follow canonical frame eligibility order, independently of database seat/join order. The catalog and shared preview/export compiler therefore agree on the first ballot and its preceding phase bridge. Fixing this presentation order does not change accepted source hashes, moment IDs or frozen selections. A missing production picture still fails at the binder; Studio does not silently drop accepted moments.

Werewolf characters whose frozen portrait is unavailable use the replay stage's existing House portrait or name-card fallback in Studio and local export. Available frozen full-body art still appears even without a portrait. The game-start identity remains authoritative. Preview/export use the same pinned availability and rendering; **Refresh published visuals** explicitly admits later available frozen bytes. A failed read of an asset already included in the pin remains an error.

Werewolf Studio opens in **Omniscient** when the link has no audience choice, making accepted thinking available immediately. Choose **Tools → Source settings → Mystery** to edit the Mystery view; an explicit `audience=mystery` link retains that choice. Public replay keeps its existing audience behavior.

With the existing local PostgreSQL/development configuration, run `bun run dev:api` and `bun run dev:web` in separate terminals. API startup applies the current migrations, including the sparse moment-annotation table. Sign in with the appropriate current grants at `http://localhost:3001/admin/production`. The gateway and web are sufficient for editing and local export.

The operator approved the compact editing-refinements prototype on 2026-10-10. Studio uses the full window: moments left, a contained preview upper right, properties below it and timeline along the bottom. Drag the desktop divider to resize the moment/preview columns; double-click it or choose Tools → Workspace → Reset layout to restore the default. Resizing changes the monitor, not movie geometry. On narrow screens, preview stays above Moments/Properties. The House navigation, audience and secondary tools live in menus/dialogs. Delivered-workspace acceptance remains a separate gate.

**Tools** opens one settings panel with a persistent section list and a single **X**. Switch directly between Presentation, Recordings, Source settings, Keyboard hints, Scene versions, authorized episode/trailer/recovery tools and Workspace. On narrow screens the section list scrolls horizontally above the content. Section changes keep the same dialog and paused preview, retain drafts in their existing owners and send no writes. X or Escape closes the panel and restores its original invoker; dropdown Escape closes only the dropdown first. There is no duplicate Done button. Changing audience still clears private editing state and closes the old workspace. Cut rules and Export retain their dedicated entry points.

The moment is the editorial unit. Thinking and speech from the same response have separate selections and tags. Ballots, tallies, supported actions, outcomes, authored opening shots and results keep their game-owned source order. An opening is one selectable moment with internal shots. Thought camera entrance, pages, fade and return are internal segments. Tags are flat string maps; `cut=youtube` is an ordinary tag.

Click a row to pause, inspect and seek where its content is visible, recentering the timeline. Thinking lands on its first fully readable page after the camera entrance; speech lands after its text entrance. Silent ballots land after the reveal, and other silent moments use a settled frame in their first authored shot. These positions follow the compiled presentation and current timing settings. The row's target icon instead pauses at the beginning of the moment and recenters. Editing labels pauses and pins that moment; **Follow current moment** returns Properties to the preview. The browser's All / Thinking / Speech / Other filters only change the list. In Werewolf Mystery, Thinking explains the privacy restriction and offers audience settings; Omniscient exposes available accepted thoughts.

Wheel over the timeline zooms around the playhead. Shift+wheel or horizontal trackpad movement pans; the persistent horizontal position slider also pans. Panning disables **Auto-scroll** visibly. Auto-scroll pages forward during playback, placing the playhead about 20% from the left. **Recenter** restores the current frame's visible position without enabling Auto-scroll; **Fit** shows the whole movie. Captured dragging near either edge pans and seeks continuously, including a stationary held pointer. Successful release restores prior playback; cancellation leaves the chosen frame paused. Player remains the only playback/audio clock.

Click the preview to focus keyboard transport. **Space** plays/pauses; **←/→** step one frame, **Shift+←/→** one second, **Home/End** seek the endpoints and **[/]** seek previous/next playable moment beginnings. **M** changes monitoring mute; **F** uses Studio fullscreen. **1/2** switch Source/Selected cut; **/** focuses the existing moment search; **T** opens the inspected moment’s metadata and focuses its first field or Add tag. **R** returns Properties to the current moment without enabling timeline Auto-scroll. **E** only opens Export; **?** opens **Keyboard hints** (the keyboard button by the timeline). **Cmd+Enter** on macOS, **Ctrl+Enter** elsewhere saves a changed metadata draft only inside Properties.

Typing, native control keys and open menus/dialogs suspend Studio commands. Frame/second keys repeat; toggles, panels, navigation and saves do not. Shortcuts do nothing during a captured drag or after access changes. Transport requires a usable Player; delayed media does not queue it, and Help remains available while loading. Help includes **Enable letter and symbol shortcuts**, saved in this browser; switch it off to disable letters, digits and symbols while Space, arrows, visible controls and the explicit Save chord remain. Keyboard actions do not repair, publish, resume, refresh media or freeze an export.

To build a first cut:

1. For Werewolf, choose **Tools → Source settings → Omniscient** to work with available thinking; Mystery keeps it private. Browse **Source → Thinking**, inspect a thought and check Smart, 4th wall or Mistake in Properties. Each checkbox saves immediately; wait for **Saved** before moving to the next label. The row shows its saved labels.
2. Speech has its own Smart, Mistake and Aggressive labels. Labeling thinking never labels sibling speech.
3. Open the single **Cut rules** button in the top bar (**rules** on narrow screens). Keep Speech = All and Thinking = Matching labels with Smart and 4th wall checked. The initial recipe already uses these choices, plus normal gameplay.
4. Switch to **Selected cut** to watch all speech/gameplay with only the matching thoughts, in original order. Any checked label matches within each type.
5. For highlights, use Matching labels for speech too and uncheck normal gameplay/opening/result. For thought-only review, set Speech = None and exclude other content. Use **Export…** after watching the cut.

Checkboxes use the existing revision-checked annotation save, and the cut updates after the API accepts each change. Labels remain flat metadata (`label.smart=true`, for example). **Other metadata** stays in draft until **Save labels** or Cmd/Ctrl+Enter; checking a label does not save unfinished custom metadata. Old drafts made before immediate checkbox saving still need Save once. Each type offers All / None / Matching labels. Other game moments inherit normal full-export coverage unless explicitly overridden. **Add episode opening** and **Add game result** are optional; the count includes them. No continuity evaluator, automatic insertion or mandatory retention is used. A conflict retains the draft and saved revision for explicit comparison/retry; label checkboxes lock until it is resolved. Editing also locks while saving or reconciling an unknown response; retry preserves the exact request, even with unfinished metadata. Inspecting another moment while a save is pending retains its eventual saved revision or conflict. Audience/permission changes invalidate outgoing results and clear private drafts. A slow refresh cannot erase a newer accepted save.

The complete accepted source is reduced before selection. Omitted movie events cannot undo roster, tally or outcome state. **Tools → Source settings → Play thinking in Source** affects Source playback only; it does not change browser filters, cut rules or the pinned authorized catalog. Selecting a thought while this preference is off pauses at the current frame and explains how to enable it; it never silently changes playback preferences or cut membership. Mystery excludes thinking and private nighttime decisions at source, selection, media and serialization boundaries, including handcrafted references. Audience changes clear private editing data and media. Permission changes fence stale requests and clear the affected workspace. Leaving the Studio disposes its prepared media and recordings; reopening reads the current accepted source and saved tags.

## Scene and game operations

The inspector pages scene inventory and exact version/evidence detail separately. Comparison images and on-demand character framing are silent stills from the exact inspected version, separate from the source/cut Player. Review, reject, regenerate, supported harmonization and publication use the existing media owner and immutable versions. A bad candidate may be regenerated without falsely approving it. Uncertain outcomes require acknowledgement of the exact attempt IDs, including attempts outside the current receipt page. More than 100 unresolved attempts blocks another render while receipt pages remain available for reconciliation.

Game production/recovery tools preserve the game-owned Influence asset/finals repair and Werewolf scene/form pause validation. Publication and **Resume** remain separate actions. Suspended games preview a fixed accepted prefix; export requires completed history.

After publishing, choose **Refresh published visuals** to pause and pin the newly published media at the same accepted source boundary. Normal reads do not silently swap repaired imagery or advance history. Previously frozen selections and prepared bundles keep their media references. Missing pinned inputs fail clearly.

Permissions remain operation-specific. New editorial source, annotations and selected-export descriptors require Producer/Sysop. Library metadata also permits the existing admin discovery grants. Influence visual operators keep their existing read and `start_game` mutation grants. Werewolf production grants do not inherit those Influence grants. Episode presentation, batch naming, trailer/poster operations and resume retain their existing permissions.

## Selected local export

Choose aspect ratio, reading rates, motion and music in **Presentation**. Choose pixel size and frames per second in **Export…**; these settings update the shared preview/compiler without enlarging the monitor. Watch **Selected cut**, then choose **Download selected export** inside Export. The API resolves type/label rules in one consistent read and checks that the resolved IDs equal the cut displayed locally. If another edit changed membership, refresh saved tags and review the changed cut. The downloaded descriptor freezes exact moment IDs, selected tag values/revisions, source/media snapshot, copy, settings and imported recording evidence. Later tag edits do not invalidate its exact IDs. An interrupted response exposes **Retry exact export request**; changing the cut does not replace that retained request.

Run from the repository root. The CLI reuses a checked app session shared with the API simulators. If authentication is needed, it opens the existing House sign-in flow; sign in, choose **Authorize local CLI**, then return to the terminal:

```sh
bun run replay:export -- --selection ./episode-selection.json \
  --api-base-url http://127.0.0.1:3000 \
  --output .renders/episode-cut.mp4
```

Use `--web-base-url` when the House web origin differs from `http://localhost:3001`. Cached sessions are private and bound to the API origin; expiry or a rejected session opens browser sign-in again. Permission changes and network failures fail clearly rather than repeatedly asking for login. `INFLUENCE_API_SESSION_TOKEN` is the optional unattended override; manual token copying is not part of the normal workflow.

The selection JSON contains no environment URL or credentials. Choose its source environment with `--api-base-url` and its sign-in page with `--web-base-url`; Export displays the current environment's command after download. For same-origin deployed web/API, both flags use that origin (staging: `https://influence-staging.tail8a79ed.ts.net`, requiring Tailscale; production: `https://thehouse.game`). The target must contain the original game, exact source/media versions and this Studio/API implementation, including migration 0113. These changes have not been deployed or verified against staging/production. A descriptor from an isolated local fixture cannot export a production game with the same display name.

The CLI reauthorizes the frozen source and exact IDs, prepares only selected payloads, freezes local assets/layout/audio, then encodes an MP4. It never generates media or publishes. A sibling `.bundle` can be rendered later without API reads or login; selection/source hashes are recorded in its boundary. Use `--inspect` to prepare without encoding. Version 1 replay bundles must be freshly prepared with the current exporter.

For recorded speech, import the existing JSON speech manifest and its local audio files into the studio. They remain in browser memory; replacement, scope change and unmount revoke object URLs. Full permitted speech identity is validated before selected audio is opened. Only selected recordings enter the descriptor. Without an import the frozen cut contains no recorded speech.

Pass the corresponding files to the CLI with `--speech-manifest ./speech.json`. It checks the exact speaker, text hash, recording byte hash, measured duration and alignment; it uses the frozen duration for compilation (up to 50 ms host-probe rounding is permitted). A frozen cut without recordings rejects this option, so an export cannot silently add a soundtrack you did not preview. Unknown/mismatched references fail even when their moments were omitted; valid omitted files are not opened or cached in the export.

## Ownership and validation

`@influence/engine/production-moments` owns finite source identity, catalog eligibility and selection. Its bounded recipe variant supplies per-kind All / None / any-known-label policies over the existing full or empty baseline. Full/tagged/ids exports retain their exact descriptor shapes; frozen IDs remain authoritative after label edits. Game services own audience projection, accepted source ordering and pause validation. API owns sparse revisioned annotations, scoped metadata/media reads and one final selection checksum. Web's browser-safe binder/compiler owns presentation timing and audio. Filesystem/network preparation and Remotion encoding remain export-host concerns. No cut-project table, generic plugin registry, new job queue, second running timer or ambient music controller is used.

The preceding Studio delivery passed local interface/source-pin, Werewolf review and canonical pause/repair/publication/resume journeys. Its historical counts and artifacts remain in the combined implementation plan. Current refinements evidence is below. Delivered-workspace acceptance remains pending; approved prototype direction does not satisfy that gate. Browser teardown is bounded and cleans only owned processes/databases.

Encoded cuts from both games and direct Studio → frozen selection → CLI → encoded-frame parity passed after integration. The existing verifier compares forward/reverse/random/fresh samples and contiguous frames; the local recording also passed waveform alignment/gain checks within the explicit AAC allowance. The core browser suite verifies Producer/Sysop CLI authorization and cache reuse using local fixture accounts. Exact logs, counts and artifact paths are recorded in the [implementation plan](plans/2026-10-09-001-feat-production-studio-moment-editor.md). These local results do not establish real Clerk sign-in, deployed behavior, paid-generation quality or real publication/resume.

Retained operator review proves the full interface headlessly before opening fresh native Chrome windows with no viewport emulation. Native resize and committed previews are checked before handoff. An automated macOS fullscreen request remained pending in the earlier headful/emulated proof; matching physical bounds did not resolve it. Direct native input was blocked by the locked Mac, so native fullscreen remains an explicit manual trial rather than a passed claim. The headless fullscreen seek/menu assertions remain intact.

A2.3's cross-game job console, exporter readiness/concurrency optimization, broad public transport migration, unpublished-candidate playback, richer scene-use navigation and harmonize schema alignment remain separate work.

### Editing-refinements validation (2026-10-10)

The first refinements checkpoint passed **2,481 provider-free tests** (five existing skips), **1,983 isolated PostgreSQL tests**, all-package types/lint and **59 API-browser tests** (one optional synthetic-duration skip). The browser run enabled the actual-interface and encoded proof modes. Real wheel/pointer/separator input, lost capture, paging until the end, resize during playback, independent labels, held 200/409 settlements and current recovery homes passed. The direct thought-only recipe export matched three Studio frame samples within codec tolerance and passed shared reverse/random/fresh/contiguous sampling; it contains no scheduled audio clips. The shared recorded-speech verifier separately checks waveform alignment/gain.

Operator testing then exposed that checkbox drafts were too easy to leave unsaved, so Smart thinking stayed outside the saved cut. The follow-up saves checkboxes immediately and provides one Cut rules entry point. New browser regressions prove three Smart thoughts survive reload, enter the matching cut and freeze as the same IDs; custom metadata drafts, exact uncertain retries, conflicts, audience changes and 390px/320px controls are also covered. Fresh checks passed: **2,481 provider-free tests**, all-package types/lint and **62 API-browser tests** (one optional synthetic-duration skip), including direct encoded parity. The unchanged API/schema retains the isolated PostgreSQL baseline above; full results and cleanup evidence are recorded in the refinements plan. Operator acceptance remains pending.

The subsequent row-content navigation change passed **2,483 provider-free tests**, all-package types/lint and **64 API-browser tests** (one optional synthetic-duration skip), including direct encoded parity. Deterministic timing tests cover readable destinations across frame rates and presentation settings. Real browser tests prove row/content versus target/start behavior in both games, generated-scene speech, thought-only cuts, disabled-thinking pause and latest selection during held initial media loading. The unchanged backend retains the PostgreSQL baseline above. Normal services were not restarted; delivered operator acceptance remains pending.

The remaining-keyboard delivery passed **2,487 provider-free tests** (five existing skips), **1,983 isolated PostgreSQL tests**, all-package types/lint and **67 API-browser tests** (one optional synthetic-duration skip), with actual-interface and direct encoded-parity proof enabled. Real keyboard fixtures cover both games, repeated stepping, native controls, capture timing/removal, platform Save, revision conflicts, narrow focus/preferences, delayed media without queued transport and Mystery privacy. The final thought-only export retains zero scheduled audio clips and frame differences within codec tolerance. Native macOS fullscreen and operator keyboard acceptance remain manual checks.

Exact logs, artifacts, scope limits and current task checklist are recorded in [the refinements plan](plans/2026-10-10-002-feat-production-studio-editing-refinements.md). The shared test database had unrelated schema drift, so the PostgreSQL baseline used the existing disposable-database helper without changing the development/shared schema. Prototype approval and delivered operator acceptance remain separate. Keyboard hints now describe the implemented scoped shortcuts and browser-local character preference; keyboard proof is recorded in the [shortcut plan](plans/2026-10-10-001-feat-production-studio-keyboard-shortcuts.md). No provider generation, external writes or deployment was performed.

## Retrospective speech

Fresh completed Influence and Werewolf sources include every accepted retrospective speech after the competitive result. These are ordinary **speech** moments marked **Retrospective**, with canonical actor, speaker ordinal and event reference in the inspector. Tag them individually or give all final speeches the same tag to make a retrospective-only cut. Including the result remains a separate selection choice; the editor never adds it between speakers.

The owning source reader verifies the full completion proof and exact speech provenance. A failed or running epilogue remains watchable through replay/inspection/recovery, but cannot create a completed export. Full exports include the accepted epilogue, while frozen selected exports retain only their reviewed IDs, text, source/media versions and recording hashes. Later tags and published visuals cannot expand that selection. See [retrospective runtime](game-retrospective-runtime.md) and [local export](local-replay-export.md).


## Audio tracks

The Recordings panel can preview and explicitly queue a completed game's first
xAI track, or retry missing clips without replacing accepted audio. It shows a
character-based estimate and bounded retry allowance before dispatch. Audio Mode
games use voices frozen at game start; historical first tracks use the reviewed
current choices. Helios is the House voice. No custom voice creation or DSP is
performed.

Newly ready audio does not alter an open cut: choose **Load ready audio into this
preview**. Thinking remains independently selectable. Generated recordings pin
version IDs, text hashes, speaker identity and measured durations in the same
export descriptor used by local recordings. A suspended Audio Mode game stays
paused after successful retry until **Resume game with ready audio** is selected.
See [Audio Mode](audio-mode.md) for worker configuration and qualification limits.

## Frozen source and recording authority

New Werewolf snapshots carry `projectionVersion: 1` inside the source hash.
Unversioned descriptors resolve the finite historical catalog/reference contracts
by an exact full-hash match. This preserves the pre-audio catalog, phase-scene and
proposal-default changes, original head geometry availability and original cutout
selection. The verified catalog contract travels with every source page and drives
both Studio binding and CLI compilation. Existing selected IDs are never reselected
or expanded. An explicit visual refresh records the verified historical catalog
contract in the new versioned snapshot; it does not upgrade cut membership.
Historical pass-thinking IDs can be reconstructed only under their
verified old hash; current catalogs, live playback and contestant history still
omit passes.

An exact source hash cannot recover a deleted temporary appearance mapping or an
old rendering compiler that was never retained or versioned. Keep original offline
bundles/movies for those cases. Missing or changed historical inputs fail closed;
never replace their hashes with new ones. Source contract versioning preserves the
recorded inputs and membership; it is not a promise of pixel-identical encoding
across unpinned browser/codec versions.

A frozen export's generated recordings resolve by their original version IDs and
published track frontier, including after a retake, House refresh or voice recovery
publishes a successor. Source text, speaker, media hash and duration must still
match. Old unpublished copies, foreign-game versions and private audio outside the
selected audience remain unavailable. The CLI reads these exact versions before
fetching their original URLs; it does not regenerate audio.

The Source preview's thinking switch, filters and view do not change the selected
cut's recordings or media. Preparation covers the union of preview and selected
cut moments. A thinking segment retained in the cut therefore keeps its measured
recording and timing even while the Source preview hides thinking.
