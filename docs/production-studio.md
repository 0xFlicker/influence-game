# Production Studio

Open **Admin → Production**, choose a completed or validated visually paused Influence or Werewolf game, and open its studio. The library uses bounded metadata pages. A game played without generated imagery remains editable with portraits.

With the existing local PostgreSQL/development configuration, run `bun run dev:api` and `bun run dev:web` in separate terminals. API startup applies the current migrations, including the sparse moment-annotation table. Sign in with the appropriate current grants at `http://localhost:3001/admin/production`. The gateway and web are sufficient for editing and local export.

The operator approved the revised editing hierarchy on 2026-10-09. The real Studio sits directly below the admin tabs: moment browser left, contained preview upper right, properties beneath it, and transport/timeline along the bottom. Narrow screens share Source / Selected cut / Properties tabs. Presentation, recordings, export and scene tools open focused dialogs. Delivered-workspace acceptance remains a separate gate.

The moment is the editorial unit. Thinking and speech from the same response have separate selections and tags. Ballots, tallies, supported actions, outcomes, authored opening shots and results keep their game-owned source order. An opening is one selectable moment with internal shots. Thought camera entrance, pages, fade and return are internal segments. Tags are flat string maps; `cut=youtube` is an ordinary tag.

Clicking a moment seeks and selects it. Scrubbing follows the active moment's row and properties. Tag editing pauses and pins that moment; **Follow playhead** returns its properties to the current preview. Inspecting scene/image versions leaves the playable head alone. Dragging pauses and samples continuously; successful release restores prior playback, while cancellation leaves the chosen frame paused. Play/pause, mute and monitoring volume sit above the timeline. Player owns playback time and composition audio.

To build a first cut:

1. Open **Source** and seek or click a moment you want to keep.
2. In **Moment properties**, choose **Add tag**. Its initial key/value is `cut=youtube`; choose **Save tags**.
3. Repeat for each desired moment. Thinking and speech need their own saved tags.
4. Open **Cut rule** and match the same key/value. Opening and result additions are optional.
5. Switch to **Selected cut** to watch only the matching saved moments in their original order. Use **Export…** for the frozen selection download and local rendering command.

Clicking a moment selects it for inspection and seeking; the saved tag determines cut membership. Draft tags do not change playback. **Add episode opening** and **Add game result** optionally include those moments even without the matching tag; the displayed cut count includes both tag matches and these additions. There is no automatic context insertion, mandatory vote retention or narrative evaluator. A conflict shows saved tags/revision and retains the local draft for explicit comparison/retry. Tag editing is locked while saving or reconciling an unknown response; the exact retained request can be retried. Refreshing tags cannot erase a newer accepted local save.

The complete accepted source is reduced before selection. Omitted movie events cannot undo roster, tally or outcome state. Thinking visibility filters the same pinned authorized catalog; it does not fetch newer history or visuals. Mystery excludes thinking and private nighttime decisions at source, selection, media and serialization boundaries, including handcrafted references. Audience changes clear private editing data and media. Permission changes fence stale requests and clear the affected workspace. Leaving the Studio disposes its prepared media and recordings; reopening reads the current accepted source and saved tags.

## Scene and game operations

The inspector pages scene inventory and exact version/evidence detail separately. Comparison images and on-demand character framing are silent stills from the exact inspected version, separate from the source/cut Player. Review, reject, regenerate, supported harmonization and publication use the existing media owner and immutable versions. A bad candidate may be regenerated without falsely approving it. Uncertain outcomes require acknowledgement of the exact attempt IDs, including attempts outside the current receipt page. More than 100 unresolved attempts blocks another render while receipt pages remain available for reconciliation.

Game production/recovery tools preserve the game-owned Influence asset/finals repair and Werewolf scene/form pause validation. Publication and **Resume** remain separate actions. Suspended games preview a fixed accepted prefix; export requires completed history.

After publishing, choose **Refresh published visuals** to pause and pin the newly published media at the same accepted source boundary. Normal reads do not silently swap repaired imagery or advance history. Previously frozen selections and prepared bundles keep their media references. Missing pinned inputs fail clearly.

Permissions remain operation-specific. New editorial source, annotations and selected-export descriptors require Producer/Sysop. Library metadata also permits the existing admin discovery grants. Influence visual operators keep their existing read and `start_game` mutation grants. Werewolf production grants do not inherit those Influence grants. Episode presentation, batch naming, trailer/poster operations and resume retain their existing permissions.

## Selected local export

Choose aspect ratio, reading rates, motion and music in **Presentation**. Choose pixel size and frames per second in **Export…**; these settings update the shared preview/compiler without enlarging the monitor. Watch **Selected cut**, then choose **Download selected export** inside Export. The API resolves tags in one consistent read and checks that the resolved IDs equal the cut displayed locally. If another edit changed membership, refresh saved tags and review the changed cut. The downloaded descriptor freezes exact moment IDs, selected tag values/revisions, source/media snapshot, copy, settings and imported recording evidence. Later tag edits do not invalidate its exact IDs. An interrupted response exposes **Retry exact export request**; changing the cut does not replace that retained request.

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

`@influence/engine/production-moments` owns finite source identity, catalog eligibility and selection. Game services own audience projection, accepted source ordering and pause validation. API owns sparse revisioned annotations, scoped metadata/media reads and one final selection checksum. Web's browser-safe binder/compiler owns presentation timing and audio. Filesystem/network preparation and Remotion encoding remain export-host concerns. No cut-project table, generic plugin registry, new job queue, second running timer or ambient music controller is used.

The operator approved the revised desktop/narrow hierarchy on 2026-10-09, and it is integrated into the real Studio. Delivered-workspace acceptance remains pending. All four required local checks passed after integration: 2,475 provider-free tests (five existing skips), 1,982 isolated PostgreSQL tests, all-package types/lint and 56 API-browser tests (three optional-mode skips). Actual interface/source-pin proof passed separately on desktop, narrow, short and fullscreen views; existing Werewolf review and canonical pause/repair/publication/resume journeys passed through the new dialog homes. Browser teardown is bounded and cleans only owned processes/databases. The temporary prototype was removed after real-operation proof.

Encoded cuts from both games and direct Studio → frozen selection → CLI → encoded-frame parity passed after integration. The existing verifier compares forward/reverse/random/fresh samples and contiguous frames; the local recording also passed waveform alignment/gain checks within the explicit AAC allowance. The core browser suite verifies Producer/Sysop CLI authorization and cache reuse using local fixture accounts. Exact logs, counts and artifact paths are recorded in the [implementation plan](plans/2026-10-09-001-feat-production-studio-moment-editor.md). These local results do not establish real Clerk sign-in, deployed behavior, paid-generation quality or real publication/resume.

Retained operator review proves the full interface headlessly before opening fresh native Chrome windows with no viewport emulation. Native resize and committed previews are checked before handoff. An automated macOS fullscreen request remained pending in the earlier headful/emulated proof; matching physical bounds did not resolve it. Direct native input was blocked by the locked Mac, so native fullscreen remains an explicit manual trial rather than a passed claim. The headless fullscreen seek/menu assertions remain intact.

A2.3's cross-game job console, exporter readiness/concurrency optimization, broad public transport migration, unpublished-candidate playback, richer scene-use navigation and harmonize schema alignment remain separate work.

## Retrospective speech

Fresh completed Influence and Werewolf sources include every accepted retrospective speech after the competitive result. These are ordinary **speech** moments marked **Retrospective**, with canonical actor, speaker ordinal and event reference in the inspector. Tag them individually or give all final speeches the same tag to make a retrospective-only cut. Including the result remains a separate selection choice; the editor never adds it between speakers.

The owning source reader verifies the full completion proof and exact speech provenance. A failed or running epilogue remains watchable through replay/inspection/recovery, but cannot create a completed export. Full exports include the accepted epilogue, while frozen selected exports retain only their reviewed IDs, text, source/media versions and recording hashes. Later tags and published visuals cannot expand that selection. See [retrospective runtime](game-retrospective-runtime.md) and [local export](local-replay-export.md).
