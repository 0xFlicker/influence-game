# Local replay video export

Export a completed Influence or Werewolf game through the same content components as the fullscreen player. The MP4 includes the context label, dialogue, selected thinking, ballots, scenes, transformations and results. Controls, settings and inspectors are omitted. This command never generates artwork or speech, spends provider credits, uploads or publishes anything.

Install the repository's Bun dependencies and have `ffmpeg` / `ffprobe` on PATH. Remotion uses its installed Chromium renderer (its first run can download the browser). Run from the repository root:

```sh
bun run replay:export -- hazy-ruby-sand \
  --api-base-url http://127.0.0.1:3000 \
  --audience omniscient \
  --output ./exports/hazy-ruby-sand.mp4
```

The API must run the current code: Influence transcript and canonical frame reads support bounded pages. Public and Unlisted games use their existing viewer permissions. For reads requiring a credential, set `HOUSE_REPLAY_TOKEN` in the environment. It is sent only to the configured API origin, including across redirects, and never saved in the bundle.

Defaults are 1920×1080, 30fps, normal motion, thinking off, and music at 30% when a score exists. Werewolf defaults to Mystery; thinking requires explicit Omniscient. Influence uses its existing spectator projection and rejects `--audience`. Use `--thinking on`, `--music off`, `--volume 0.2`, `--reduced-motion`, and explicit `--width`, `--height`, `--fps` as needed. Thinking always runs before speech: camera entrance, isolated reading, thought fade, camera return, then spoken delivery. `thinkingRate` changes only thought reading; `motionScale` changes the camera and fades. Recorded speech begins after the return. Dimensions must be even, 128–7680; fps must be an integer, 1–120.

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

A sibling `.bundle` contains the permitted cue payloads, timing, hashed media and built-in stage artwork. The renderer performs a font/image/layout prepass and saves measured speech/thinking typography before encoding. `--bundle` verifies hashes and uses local assets; it does not read the API. Game-loading options cannot be combined with `--bundle`. Choose a new output path to prepare different settings. A prepared bundle can include private Omniscient evidence; keep it local unless deliberately sharing it.

Existing output files are refused unless `--overwrite` is supplied. Encoding writes to a temporary sibling file; the MP4 becomes visible only after ffprobe verifies its codec, dimensions, duration and expected audio track. A `.mp4.receipt.json` records hashes, revision/dirty marker, settings, duration, size, tool versions and render time. Interrupting the command cleans up rendering processes and temporary output while retaining the prepared bundle.

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

The browser and exporter share cue adapters, thought insertion, content components, camera interpolation, vote/role/transformation treatments and typography. Export supplies an explicit predecessor and prepared media instead of relying on prior React renders, browser preferences, asynchronous thought reads or loading timeouts. Built-in portrait-room motion uses the presentation clock in both surfaces.

Interactive music intentionally retains position on same-section seeks and plays at 1× when browser replay speed changes. Export instead compiles an uninterrupted soundtrack with explicit repeats, fades and range offsets. This is deliberate; a scrubbed browser session is not the reference soundtrack.

The authored Werewolf opening is the exception: **Lantern Shadows** and its clip effects are locked to presentation time in both surfaces, including browser speed and seeks. The opening fades out before existing spoken introductions, whose **Lantern to Fang** score is unchanged. Picture videos are muted; extracted effects play once through the audio schedule. `--music off` disables the opening score and effects as well as gameplay music. Reduced motion retains timing and uses posters for its videos.

No new voice generation, synchronized browser speech controls, dramatic thinking camera mode, publishing workflow or renderer worker is included. Existing format rules and the frozen classic presentation parser remain authoritative; transcript prose is never used to infer new game facts.

## Local verification

To repeat frame-order verification against a prepared bundle, run from `packages/web`:

```sh
bun run src/scripts/verify-house-replay-export.ts \
  ../../exports/hazy-ruby-sand.bundle ../../.renders/replay-frame-proof
```

This opt-in check renders representative frames in forward and reverse order, compares contiguous-frame output, and repeats a frame in a fresh Chromium process. It requires only the frozen local bundle. It writes PNG samples and `proof.json`; it makes no provider or API calls.

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
