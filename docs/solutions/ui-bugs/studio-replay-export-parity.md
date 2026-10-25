---
module: Studio replay export
problem_type: ui_bug
tags: [werewolf, influence, remotion, audio, replay, character-cutouts]
---

# Studio and viewer parity audit — 2026-10-25

The previous Werewolf movie used music disabled and lost group-room context when Studio split accepted thinking into independently selectable moments. These independent thoughts also broke the previous-speaker chain, so the deterministic exporter snapped the circle to its next speaker. Omniscient pack proposals existed with recorded speech but were excluded by the default full-cut selection.

## Rendering paths checked

| Path | Treatment and verification |
| --- | --- |
| Viewer Werewolf day and pack discussions | Shared audience-safe `werewolfPortraitRoom` and backdrop selection. Living cast; pack roles only from authorized omniscient snapshots. |
| Studio source/cut preview | Same production binder, `compilePresentation`, and Remotion `ReplayFrame` as CLI export. Browser check against the actual localhost game. |
| CLI full game and saved Studio selection | Independent thought pictures retain room/background/head bounds. Explicit music setting and frozen asset/audio schedule. |
| Offline prepared bundle and render worker composition | Deterministic previous-speaker derivation from selected room pictures; no React render-history dependence. Random/reverse/sequential/fresh-browser frame checks. |
| Solo thinking and Doctor/Seer night reveals | Preserve full-body cutout selection/fallback, head rectangle, normal speech-space geometry and room backdrop. Existing solo action reveal choreography remains shared. |
| Pack and village thinking | Headshot room framing, zoom/vignette and readable thought bubble; no full-body substitution. A 650ms establish segment rotates the circle before the thought zoom. |
| Werewolf opening/title/ending | Existing shared opening composition and cutout assets; append viewer's completed-retrospective results reprise without duplicating narration or accepted events. |
| Influence Lobby/Mingle/huddles, solos and ending | Same shared room continuity; actual completed Influence source prepared for regression frames. Canonical `retrospective.completed` restores winner screen; unfinished retrospective does not. |
| Music, effects, thinking and spoken speech | Existing frozen recordings reused. Music explicitly enabled at 0.3, with shared fade/duck envelopes; six accepted pack speeches included with recordings. |
| Mystery audience | Pack/private thinking still excluded. No privacy broadening or reconstruction from prose. |

The production catalog is a fixed source snapshot. Reload Studio after this update; old explicit selections stay explicit and may omit pack moments. Select the full current catalog or add the six pack speeches to an existing cut. Existing immutable movie/bundle artifacts are preserved; they do not change when source code or artwork changes.

## Reproduce the requested replacement

From `/Users/user/Development/influence-game`:

```sh
bun run replay:export -- hard-smoke-rune \
  --output /Users/user/Documents/Codex/2026-10-24/task/evidence/studio-parity-1080/hard-smoke-rune-1080p30.mp4 \
  --audience omniscient --thinking on --music on --volume 0.3 \
  --width 1920 --height 1080 --fps 30 --inspect
REPLAY_RENDER_CONCURRENCY=4 bun run replay:export -- \
  --bundle /Users/user/Documents/Codex/2026-10-24/task/evidence/studio-parity-1080/hard-smoke-rune-1080p30.bundle \
  --output /Users/user/Documents/Codex/2026-10-24/task/evidence/studio-parity-1080/hard-smoke-rune-1080p30.mp4
```

Use a new output name for another render; existing output is protected unless overwrite is explicit. Concurrency defaults to 1 and may be set from 1 through 8. No new game, model, speech, or music generation is involved. Localhost Producer authentication uses the existing supported short-lived session exchange; credentials are never embedded in the export.

## Evidence

Evidence root: `/Users/user/Documents/Codex/2026-10-24/task/evidence/studio-parity-1080`.

- `hard-smoke-rune-1080p30.bundle/manifest.json`: 184 cues, 187 cached assets; 1920×1080 at 30fps; approximately 42m42s with thinking and recorded speech.
- `frame-proof/proof.json`: 29 Werewolf frame samples checked in reverse, random, sequential and independent-browser rendering orders. Includes start/middle/end of village and pack turns and enter/read/return thought framing. These samples precede the final closing-only amendment; unchanged sample coordinates remain valid.
- `viewer-pack-thinking.jpg`: actual localhost viewer comparison.
- `influence-audit.bundle/manifest.json`: actual Influence source, ending at canonical completed-retrospective winner presentation.
- `influence-frame-proof/`: bounded cross-format rendered regression evidence.
- Final video/receipt and mixed-audio verification are recorded in the handoff once encoding completes.

Focused tests cover room continuity, thinking establishment, pack selection/recordings, cut privacy, original event identity, both ending screens and unfinished retrospectives. Required provider-free, PostgreSQL and type/lint baselines are recorded in the final validation receipt. No provider calls were made by those suites.
