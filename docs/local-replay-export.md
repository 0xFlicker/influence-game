# Local replay video export

Export a completed Influence or Werewolf game through the Production Studio's shared moment catalog, presentation compiler, sampled composition and audio schedule. Full exports retain their existing content coverage; selected exports contain the exact reviewed moments. Controls, settings and inspectors are omitted. This command never generates artwork or speech, spends provider credits, uploads or publishes anything.

Install the repository's Bun dependencies and have `ffmpeg` / `ffprobe` on PATH. Remotion uses its installed Chromium renderer (its first run can download the browser). Run from the repository root:

```sh
bun run replay:export -- hazy-ruby-sand \
  --api-base-url http://127.0.0.1:3000 \
  --audience omniscient \
  --output ./exports/hazy-ruby-sand.mp4
```

The API must run the current code. All API-backed local exports require current Producer/Sysop authorization, including full exports; the operator explicitly approved this permission change on 2026-10-09. The CLI checks its cached app session against the configured API, then opens the House sign-in page when a session is missing, expired or rejected. Sign in using the existing web authentication and choose **Authorize local CLI**; return to the terminal to continue. Use `--web-base-url` for a nondefault House web origin. Sessions are shared with the API simulators and cached privately per API origin under `~/.influence-game/api-sessions/`. Permission denial or a network failure does not trigger repeated login. `INFLUENCE_API_SESSION_TOKEN` supplies an explicit session for unattended tooling; it is never written to the cache or bundle. Public replay permissions are unchanged. The bounded production source pins complete accepted history and published visual versions before selecting moments.

Defaults are 1920×1080, 30fps, normal motion, thinking off, and music at 30% when a score exists. Werewolf defaults to Mystery; thinking requires explicit Omniscient. Influence uses its existing spectator projection and rejects `--audience`. Use `--thinking on`, `--music off`, `--volume 0.2`, `--reduced-motion`, and explicit `--width`, `--height`, `--fps` as needed. Thinking and speech are independent moments. A thought owns its camera entrance, isolated pages, fade and return; selecting only the thought never includes its neighboring speech. `thinkingRate` changes thought reading; `motionScale` changes camera and fades. Dimensions must be even, 128–7680; fps must be an integer, 1–120. Newly supported decision thoughts require explicit editorial selection and do not expand default full movies.

## Export a selected studio cut

Replay, Studio and export use the same responsive bubble typography. At full-HD
sizes, large speech/thinking boxes use 38–46px text; long passages paginate rather
than shrinking below the readable floor. Narrow and short players use smaller
bounded sizes. Full-body landscape introductions align the speech connector to
the saved head rectangle (or the standard head position when absent); narrow
screens retain separate stacked art and text. Thought trails grow with their
available span, and Omniscient Werewolf thoughts show the authorized actor role.
Mystery still excludes thinking. These changes affect presentation only, not
accepted dialogue, private evidence, or timing policy.

Portrait rooms keep one floor anchor across short/long speeches and independent
thinking shots. Thinking retains the room backdrop and perspective; a selected
thought followed by its own spoken ballot keeps the established character visible
through the handoff. Selecting the ballot alone still uses its normal entrance.
House narration fits the complete message on one screen for the recording's full
duration, shrinking type when needed instead of switching to a short overflow page.
Completed Werewolf retrospectives close on a silent final cast and elimination
recap, with winner/role/survivor labels and canonical night/day elimination coordinates.
The spoken result remains before retrospectives. Prepare a fresh bundle and
re-export to apply these changes to an existing movie; saved MP4s remain unchanged.

Open **Admin → Production**, choose a completed game, save flat tags such as `cut=youtube` on individual thinking or speech moments, and watch **Selected cut**. Set the target geometry, timing and audio mix before choosing **Download selected export**. Paused games support a fixed-prefix preview but cannot be exported.

When selected, Influence empowered tie-break thinking appears after the regular ballot roll call and aggregate, immediately before the tie-break scene. The same player’s earlier ballot keeps its own thinking. Studio preview and export share this canonical source ordering.

```sh
bun run replay:export -- --selection ./episode-selection.json \
  --api-base-url http://127.0.0.1:3000 \
  --output .renders/episode-cut.mp4
```

The descriptor freezes exact source-ordered IDs, annotation values/revisions, source and media references, copy, settings and selected recording metadata. A changed tag predicate cannot silently change the reviewed cut: refresh saved tags and review again before downloading. Once frozen, later tag edits do not invalidate its exact IDs. New publication does not replace pinned imagery; use **Refresh published visuals** in the studio explicitly. Export reauthorizes the frozen references and fails if required pinned inputs are missing.

Selected export rejects conflicting presentation flags; its settings come from the descriptor. When the descriptor contains recordings, pass the same `--speech-manifest` and local files used for preview. Byte hash, speaker, exact text, duration and alignment must agree. A descriptor without recordings cannot acquire new speech through this flag. Credentials and local file paths are absent from the descriptor.

### Choose local, staging or production

The downloaded `*-selection.json` is a frozen selection descriptor, not a prepared media bundle. It contains exact source/media identities and presentation settings, but no environment origin, credentials or downloaded media. Choose the source environment explicitly when preparing it. `--api-base-url` selects the API to read and authorize against; `--web-base-url` selects the House browser sign-in page. With a same-origin web proxy, both flags use the same public URL. The download notice in the Studio supplies the origins for that workspace.

```sh
# Staging requires access to its Tailscale hostname.
bun run replay:export -- --selection episode-selection.json \
  --api-base-url https://influence-staging.tail8a79ed.ts.net \
  --web-base-url https://influence-staging.tail8a79ed.ts.net \
  --output .renders/staging-cut.mp4

# Production uses the same local command against the production source.
bun run replay:export -- --selection episode-selection.json \
  --api-base-url https://thehouse.game \
  --web-base-url https://thehouse.game \
  --output .renders/production-cut.mp4
```

Use the environment where the reviewed game and pinned media exist. The exporter validates the frozen references/hashes; changing origins does not migrate a game or recreate missing media. The configured environment must have this Studio/API implementation, annotation migration and browser CLI login deployed. Local implementation and fixture proofs do not confirm those deployment prerequisites or real sign-in on staging/production.

Preparation writes the sibling `.bundle` directory with selected data, media and settings. That bundle can render offline with `--bundle <directory>` and needs no environment flags or sign-in. API/web flags are rejected with `--bundle`.

Werewolf exports include the same opening as the webpage player: The House, the episode title, the initial cast, and the closing door. Mystery has no role labels; Omniscient uses the permitted initial roles. The opening freezes actual episode metadata (or “Werewolf” before naming), video, posters, music and extracted sound effects into the bundle. Its `opening` cue keys are presentation identities, not canonical event cursors. Exporting a range beginning at a canonical game cue omits the opening while preserving the full timeline's audio offsets.

## Inspect and select a range

```sh
bun run replay:export -- hazy-ruby-sand --inspect \
  --output ./exports/hazy-ruby-sand.mp4

bun run replay:export -- --bundle ./exports/hazy-ruby-sand.bundle \
  --from-cue '<key from inspection>' --until-cue '<next boundary key>' \
  --output ./exports/excerpt.mp4
```

Inspection downloads and checks selected media, saves the logical timeline, and lists stable cue keys, canonical source positions, durations and recording identities. The start key is inclusive; the end key is exclusive. Compile the whole replay before selecting a range so entering camera state and music offsets remain the same as the full traversal. A cursor and a playable subcue are different: each ballot and its final tally have separate keys.

A sibling `.bundle` contains the permitted cue payloads, timing, hashed media and built-in stage artwork. The renderer performs a font/image/layout prepass and saves measured speech/thinking typography before encoding. `--bundle` verifies hashes and uses local assets; it does not read the API. Game-loading options cannot be combined with `--bundle`. To pick up current presentation code or change settings, supply the game slug with `--overwrite` (or choose a new output path). `--bundle --overwrite` reuses the saved presentation; it does not refresh old cues or timing. A prepared bundle can include private Omniscient evidence; keep it local unless deliberately sharing it.

Existing output files and prepared bundles are refused unless `--overwrite` is supplied. With a game slug, `--overwrite` downloads current game data and media and rebuilds the sibling `.bundle`, including the opening, thinking camera timing and fresh layout measurements. Preparation happens in a temporary directory; failures preserve the previous bundle and movie. With `--bundle`, `--overwrite` only replaces the output movie. Encoding writes to a temporary sibling file; the MP4 becomes visible only after ffprobe verifies its codec, dimensions, duration and expected audio track. A `.mp4.receipt.json` records hashes, revision/dirty marker, settings, duration, size, tool versions and render time. Interrupting the command cleans up rendering processes and temporary output while retaining the prepared bundle.

To refresh an older export that predates the opening or thinking camera:

```sh
bun run replay:export -- hazy-ruby-sand --audience omniscient --thinking on \
  --output ~/Movies/hazy-ruby-sand-omniscient-v2.mp4 --overwrite
```

## Presentation timing

Pass `--timing ./replay-timing.json`. These settings affect recorded presentation, never gameplay rules, events or decisions.

```json
{
  "readingRate": 1.15,
  "thinkingRate": 1,
  "conversationGapMs": 200,
  "ballotHoldMs": 5500,
  "tallyHoldMs": 4500,
  "motionScale": 1,
  "ending": "finish-score",
  "overrides": {
    "<an inspected cue key>": {"postSpeechHoldMs": 750}
  }
}
```

Omitted values retain the existing game timing. Rates above 1 shorten unvoiced reading or thinking; `motionScale` above 1 lengthens motion. `establishingHoldMs` controls the establishing interval before a spoken contribution. The Werewolf opening's authored shot durations stay fixed so video and recorded effects remain synchronized; these reading/motion settings do not stretch it. Unknown fields, invalid numbers and unknown override keys fail. Timing uses milliseconds, with output frame boundaries derived from absolute times rather than accumulated rounded cue lengths.

`finish-score` holds the final result until its victory music finishes naturally. This can add several minutes. Unscored or muted endings retain the normal result hold. Alternatively use `"ending": {"holdMs": 5000}` for an additional fixed result hold. Range exports that stop before the result do not acquire the ending hold.

## Existing speech recordings

Pass `--speech-manifest ./speech.json`. The manifest is an array; recording paths are relative to that file. Inspection supplies message IDs, speaker IDs and SHA-256 hashes of the exact text.

```json
[
  {
    "messageId": "<inspection messageId>",
    "speakerId": "<inspection speakerId>",
    "textHash": "<inspection textHash>",
    "file": "recordings/message.wav"
  }
]
```

Attachments must match exactly one spoken cue. Unknown messages, wrong speakers, changed text, invalid audio and duplicates fail. Missing attachments retain unvoiced reading. The measured recording can extend the speaking interval; reading-rate changes never speed up or truncate it. Thinking is separate and unvoiced. Music ducks during speech with 150ms attack and 350ms release.

Optional `alignment` is an array of `{textStart, textEnd, startMs, endMs}` spans. Text offsets are JavaScript UTF-16 offsets and must cover the exact message contiguously; times must be ordered and within the measured recording. Use word-level spans for paginated text. A span crossing a measured page boundary fails rather than claiming word-level synchronization. Without alignment, pages follow the existing deterministic text-weighted reading progress.

Audio placement is quantized to output frames; source samples are not stretched. Speech starts at the preceding frame boundary so the entire recording fits within its visible speaking interval. Synchronization checks must allow one frame plus codec delay. Use 30fps or higher for final voiced output.

## Shared behavior and proof boundaries

The studio and exporter share catalog selection, moment binding, timing, camera interpolation, vote/role/transformation treatments, typography and audio placement. Complete game history is reduced before movie selection; omitted events still establish canonical state, while their text and audio never enter the selected bundle. Export supplies explicit prepared media and frozen layout; browser readiness uses Player buffering. Built-in portrait-room motion uses the presentation clock in both surfaces.

Studio Player owns picture and scheduled audio time, including seeks and playback rate. It has top-level mute/monitoring volume controls and no ambient music controller. The public replay retains its existing transport behavior: its gameplay music can preserve section position through a seek. Public replay transport is outside this delivery.

The authored Werewolf opening is the exception: **Lantern Shadows** and its clip effects are locked to presentation time in both surfaces, including browser speed and seeks. The opening fades out before existing spoken introductions, whose **Lantern to Fang** score is unchanged. Picture videos are muted; extracted effects play once through the audio schedule. `--music off` disables the opening score and effects as well as gameplay music. Reduced motion retains timing and uses posters for its videos.

Local recorded speech can be previewed in the studio without upload or generation. Existing media services own repair and publication; the exporter only prepares and encodes. Existing format rules and the frozen classic presentation parser remain authoritative; transcript prose is never used to infer new game facts.

## Local verification

To repeat frame-order verification against a prepared bundle, run from `packages/web`:

```sh
bun run src/scripts/verify-house-replay-export.ts \
  ../../exports/hazy-ruby-sand.bundle ../../.renders/replay-frame-proof \
  ../../exports/hazy-ruby-sand.mp4
```

This opt-in check renders representative frames in forward, reverse and deterministic random order, compares contiguous-frame output, and repeats samples in fresh Chromium processes. It writes PNG samples and `proof.json`; it makes no provider or API calls. The optional MP4 adds encoded geometry/duration/frame and pixel evidence. Recording-only, nonoverlapping schedules also compare decoded PCM against the expected recording placement. Mixed/overlapping schedules explicitly report recording alignment as unverified; non-silence alone is not synchronization proof.

Implementation validation on 2026-10-07:

| Evidence | Result |
|---|---|
| Provider-free baseline | 2,330 passed, 5 skipped; subsequent focused exporter suite 18 passed |
| Isolated PostgreSQL baseline | 1,917 passed; disposable database removed afterward |
| Types and lint | Passed |
| Cancellation | SIGINT leaves no final/partial MP4 or exporter scratch bundle |
| Default Mystery preparation | 98 cues, 19 assets; no private night-action or transformation stages |
| Whole Werewolf, `hazy-ruby-sand` | 108 cues; 945.67s; 640×360/12fps; 44.3 MiB; 1,055s render |
| Whole Influence, `tame-mint-hive` | 66 cues; 856.75s; 640×360/12fps; 38.1 MiB; 957s render |
| Short final-resolution clips | Both games exported at 1920×1080/30fps and inspected |
| Arbitrary-frame checks | 14 Werewolf, 9 Influence, 14 canonical format fixture samples matched reverse-order rendering; three contiguous ranges and a fresh-browser frame per bundle also matched |
| Recorded-audio proof | 16s and 3s known signals completed; encoded offsets within 60ms including AAC delay and analysis window; excerpt mix/source correlation above 0.999 with an 8-sample codec offset |

The full-game runs establish complete traversal at a smaller verification resolution. Later targeted checks cover frozen layout, transformations, camera motion, nominee selection, winner padding and range audio. They do not claim a full 1080p game was manually watched end to end. The attachment proof uses known test tones, not synthesized voices or a subjective assessment of voice/music quality. Real voice recordings and final viewing/listening remain operator acceptance work.

Refresh validation on 2026-10-08: prepared and then overwrote a fresh `hazy-ruby-sand` Omniscient bundle (117 cues, 9 opening cues, 59 thinking intervals). Twenty rendered samples—including solo and scene thinking focus—matched reverse-order output, three contiguous ranges and a fresh browser. A 45.3-second 640×360/12fps H.264/AAC excerpt includes the opening and first thinking/speech sequence; a decoded MP4 frame confirms the head focus and vignette. The existing full-length movie was left untouched.

## Retrospective coverage

For fresh completed games, full movies render gameplay, the competitive result and all accepted final speeches. Studio can freeze a retrospective-only cut by tagging its ordinary speech moments; result inclusion is independent. Original solo portraits, canonical part/outcome labels, captions, reading timing and optional exact-identity recordings use the same shared sampled frame as replay and Studio.

Export requires a completed retrospective proof. Existing games without captured statements cannot gain one through export; reads perform no generation or historical adaptation. Frozen bundles pin text, moment IDs, source heads, media versions and recording hashes. Offline sampling and encoding use those exact bytes and IDs without re-evaluating current tags or fetching newer source history.


## Generated game audio

A Studio-frozen cut with generated audio carries version IDs in `recordings`.
`export:replay` fetches its authorized existing MP3 versions and verifies text,
speaker, content hash and measured duration before compiling the shared schedule.
Generated versions do not need `--speech-manifest`; imported local recordings
still do. Preparation never synthesizes missing audio. Missing or changed frozen
versions fail explicitly. Thinking clips use the same independent thought moments
and can be excluded without retaining their audio or duration.

Influence House-summary scenes retain the exact accepted transcript ID and text as their recording identity even when their visual beat is a House card or winner scene rather than a player speech bubble. Generated narration still requires one unambiguous line, an exact speaker/text hash match, and matching frozen media integrity; the measured recording drives the shared House caption window.
