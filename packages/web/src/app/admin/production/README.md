# Production Studio

The workspace entry point is `/admin/production`. The bounded library links to `/admin/production/games/<game-id>` for completed Influence/Werewolf episodes and validated paused prefixes. Producer/Sysop grants protect editorial source, moments and cuts; existing Influence visual operators retain their existing visual services. Public replay behavior is separate.

## Editing loop

1. Open a game. For Werewolf, select Mystery or Omniscient. Mystery has no thinking or private night decisions.
2. Click a moment to seek and select it. Scrubbing follows the current moment's properties. Tag editing pauses and pins its draft; **Follow playhead** restores discovery. Scene comparison leaves the head alone.
3. Play, drag the timeline continuously, step frames/moments, or enter a frame. Mute and volume are top-level controls. Timeline zoom scrolls horizontally.
4. Save flat tags such as `cut=youtube` on thinking and speech independently. Choose the exact filter and watch **Selected cut**. **Add episode opening** and **Add game result** optionally include those moments without matching tags; the cut count includes these additions.
5. Inspect scene versions, repair candidates, review and explicitly publish using the existing production services. **Refresh published visuals** refreshes imagery at the same accepted source boundary. Gameplay resume remains an explicit action in **Game production and recovery**.
6. If another operator changes tags, the editor preserves the draft and shows the saved revision. A changed cut cannot be frozen silently: refresh saved tags, review the refreshed cut, then download again.
7. **Presentation** controls aspect ratio, timing, motion and music. **Export…** controls pixel size/fps and contains **Download selected export**, which freezes the exact reviewed IDs, annotations, geometry, timing, copy, visual references and selected recording metadata. Export remains completed-game only.

Source/audience/thinking, inspected moment, scene/version, source/cut view and return filters are reflected in the route. Source history stays pinned. File handles, credentials and audio object URLs are never serialized into a selection descriptor.

## MCP proposals

Producer MCP clients can read the same catalog with `read_production_moments`, patch shared tags with `update_production_moment_tags`, and call `preview_production_cut` to create a review link. Writes require explicit `producer:edit` consent in addition to `producer`; existing connections need a scope upgrade. Smart may mean interesting or relevant thinking, including mistakes worth showing. Silent discussion passes remain outside playback even with thinking enabled.

Review links open Selected cut with the proposed recipe and music settings. Studio recomputes the proposal fingerprint and reports changed source/tags before allowing export. The voice summary reports existing recording coverage; it does not generate audio. The link is not an export or an authorization grant. Operators can adjust labels, review the revised cut and freeze it through the existing flow. See [MCP contract](../../../../../../docs/game-mcp-production-oauth.md#producer-moment-editing-and-cut-review).

## Local export

Start the local API/web stack using the repository's usual development commands and sign in with Producer/Sysop access. Save the downloaded selection beside any optional speech manifest and audio files. From the repository root:

```sh
bun run replay:export -- <slug> \
  --selection <slug>-selection.json --output .renders/<slug>.mp4
```

The CLI reuses a checked, API-origin-bound app session shared with the API simulators. When needed it opens House sign-in; choose **Authorize local CLI** and return to the terminal. Use `--api-base-url http://127.0.0.1:<api-port>` and `--web-base-url http://localhost:<web-port>` for other local ports. `INFLUENCE_API_SESSION_TOKEN` is an optional unattended override. The exporter uses the descriptor's frozen IDs/settings; later predicate edits do not reselect the cut.

## Local recordings

**Import local recordings** accepts one JSON speech manifest and its audio files. Nothing is uploaded or generated. Each entry uses the existing speech manifest contract:

```json
[{"messageId":"accepted-message-id","speakerId":"accepted-speaker-id","textHash":"raw-lowercase-sha256-of-exact-text","file":"speech.wav"}]
```

Optional alignment spans use `textStart`, `textEnd`, `startMs` and `endMs`, covering the complete exact text in order within the recording. Browser manifests use plain filenames. Every manifest identity is checked against the complete permitted speech before any audio is read; only currently playable speech is hashed/measured/prepared. Missing selected files and invalid alignment fail visibly. Replacing/removing the import, changing source scope or losing permission disposes preview object URLs.

For a frozen cut with recordings, supply the same local files during export:

```sh
bun run replay:export -- <slug> \
  --selection <slug>-selection.json --speech-manifest speech.json \
  --output .renders/<slug>.mp4
```

## Proof scopes

The operator approved the revised desktop/narrow editing hierarchy on 2026-10-09. The real Studio uses that hierarchy with canonical source, annotation, recording and recovery owners. Design approval is separate from delivered-workspace acceptance, recorded in the implementation plan. The temporary prototype UI has been removed after its real operations passed browser proof.

Run its focused UI proof from `packages/api`:

```sh
STUDIO_INTERFACE_PROOF=1 DRIZZLE_MIGRATIONS_DIR=./drizzle bun test \
  --config=../../bunfig.browser.toml src/e2e/replay-visual-production.e2e.test.ts \
  --max-concurrency 1 --test-name-pattern 'Actual Studio interface proves'
```

Use `STUDIO_OPERATOR_REVIEW=1` instead with the same `--test-name-pattern 'Actual Studio interface proves'` to run the full proof headlessly, then open fresh authenticated, natively resizable desktop/narrow Chrome windows for up to two hours. The native review uses no emulated viewport. The runner prints the reachable review URL and local cleanup endpoint. Close that task-owned Chrome or POST the endpoint to stop its browser/API/Next children and drop its isolated database. Do not overlap this with another Next browser harness.

`packages/api/src/e2e/replay-visual-production.e2e.test.ts` exercises canonical database-backed source, independent thinking, sampling, real pointer dragging, conflict recovery, frozen selections, changed-cut rejection, local WAV import, native audio play/seek/pause/mute/volume recovery, audience privacy and narrow layout. Its existing repair flow uses deterministic local pixels and no provider calls. `werewolf-visual-recovery.e2e.test.ts` owns canonical pause/repair/publication/resume evidence. These harnesses own isolated databases and clean up all children. Actual API coverage replaces the temporary DTO-only Studio runner; local browser proof does not establish deployed behavior.

Run browser harnesses sequentially; `.next/e2e` is shared. Next may update `next-env.d.ts`/`tsconfig.json` with generated E2E type paths; restore only those generated additions after the final child stops. Report local tests, browser evidence, encoded-media evidence and operator acceptance separately.

For an additional actual Studio → frozen descriptor → encoded frame comparison, run from `packages/api`:

```sh
STUDIO_ENCODED_PROOF=1 DRIZZLE_MIGRATIONS_DIR=./drizzle bun test \
  --config=../../bunfig.browser.toml src/e2e/replay-visual-production.e2e.test.ts \
  --max-concurrency 1 --test-name-pattern 'Actual Studio.*encoded movie'
```

This uses the same isolated local API, database and Next child as the browser proof. It samples the Player and encoded movie at 640 × 360 / 24 fps, including thought entrance, reading and return, then runs the existing export verifier. Evidence is retained in a fresh `production-studio-ui-encoded-proof-*` directory inside the system temporary directory; the runner prints its absolute path.

The separate `STUDIO_LONG_SOURCE_PROOF=1` mode runs the test named `Synthetic saved source` in that harness. It adds 192 uniquely identified saved responses at the fixture's existing accepted presentation boundary, without adding game decisions. It records actual duration, cold preparation, desired playhead response, committed composition and decoded readiness separately, plus Chromium heap/DOM metrics. This synthetic workload is not representative production evidence.

The retained review uses the actual database-backed Studio and local fixture accounts. Use its authenticated Chrome tabs; opening the URL in another browser does not transfer the test session. Tags and frozen downloads work; the local harness rejects repair/publication/resume writes. Automated isolated browser tests provide those operation proofs. Headless fullscreen/menu proof passed; native macOS fullscreen remains a manual trial. Closing Chrome, calling the local stop URL printed by the runner, or reaching the review timeout cleans up the browser, API, Next and isolated database, then restores only Next's generated route-path additions. Credentials are never printed or put in URLs/files.
