---
title: Local House replay export and shared audiovisual timing
type: feat
status: completed
date: 2026-10-07
---

# Local House replay export and shared audiovisual timing

## Outcome

Export a completed Influence or Werewolf game to a local MP4 using the actual fullscreen content presentation. Preserve the game's dialogue, thoughts when permitted and enabled, votes, scenes, camera movement, transformations and results. Omit transport controls, settings, inspectors, page chrome, pointer and interactive prompts. Keep the in-frame scene/context label; content expands into the space normally occupied by controls.

Provide adjustable presentation timing and an optional recorded-speech input. Share presentation calculations and components with the browser player so subsequent visual and audio improvements reach both surfaces. This is a local renderer, not another trailer policy or gameplay system.

## Decisions and limits

- First delivery supports completed games of both kinds, including the existing supported Influence classic and format presentation paths. Live recording and partial in-progress exports are deferred.
- Default output: 1920×1080, 30 fps, H.264 MP4, AAC when audio is enabled, normal motion. Support explicit dimensions and integer fps; validate encoder-compatible dimensions and finite positive values.
- Export settings are explicit and recorded; do not read localStorage, device mute, reduced-motion preferences or browser autoplay state.
- Werewolf defaults to Mystery. Omniscient is explicit. Thinking defaults off and is rejected for Mystery. Influence uses its existing authorized spectator projection; do not invent Werewolf audience semantics for it.
- Music defaults on when the game has an approved score, with the existing 30% mix level. Influence remains unscored until music is selected for it. Speech defaults off unless a speech manifest is supplied.
- No provider calls, speech synthesis, image generation, publication, media worker jobs, upload, DB migration, or producer UI in this scope.
- No new gameplay timing presets. These controls affect presentation after the game has happened.
- Do not introduce a plugin registry or universal game-state schema. Use two explicit adapters and a discriminated presentation payload.

## Current foundations and required extraction

| Existing code | Reuse / change |
|---|---|
| `packages/web/src/components/watch/watch-director.ts` | Shared cue timing and thought insertion. Extract pure interval calculations used by browser scheduling and export compilation. Keep user commands, readiness and follow-tail in the browser controller. |
| `packages/web/src/components/games/werewolf/werewolf-watch-model.ts` | Canonical moment-to-cue expansion, ballot/tally stops, night actions and transformations. Preserve source cursor versus subcue identity. |
| `packages/web/src/app/games/[slug]/components/dramatic-replay-viewer.tsx` and `influence-presentation-director.ts` | Existing Influence cue compilation and format/classic behavior; extract its content stage from fetching, chrome and interaction. Do not extend the frozen classic parser. |
| `werewolf-watch-stage.tsx`, `visual-scene-view.tsx`, `solo-presentation.tsx`, vote and format presentations | Shared visual components. Replace dependence on previous React renders or wall-clock animations with explicit sampled state where necessary. |
| `components/watch/watch-thinking.tsx` and bubble typography helpers | Separate evidence loading from rendering; measure with actual fonts and output geometry before freezing pagination. |
| `components/watch/watch-music.ts` and `games/werewolf/werewolf-music.ts` | Reuse section selection and transition policy. Browser ambient transport and offline soundtrack scheduling have distinct transport responsibilities. |
| `lib/house-highlights-trailer-media-bundle.ts`, `scripts/render-house-highlights-trailer.ts`, `remotion/house-highlights-trailer/` | Reuse installed rendering, encoding, media probing and cleanup mechanics. Add a full replay composition; do not reuse trailer editorial selection or its visual layout. |

The current director accepts a clock, but injecting a fake clock alone is insufficient. Scene camera state remembers previous views, thinking can load asynchronously, fonts change pagination, and browser music uses its own media clock. All inputs required to evaluate an arbitrary frame must be explicit before rendering.

## Pipeline and authority

`authorized game reads → frozen audience-safe source → existing game cue adapter → layout/timing compilation → frozen render manifest → sampled shared stage + audio schedule → MP4`

1. Resolve game kind through the existing House entry contract. Read completed status and a fixed event/transcript boundary plus a single publication cutoff. Use the normal audience and media authorization services. Never discover kind through an Influence failure or bypass access via direct database reads.
2. Fetch all required history in bounded pages. Validate ordering, continuity, completion, and source identity across pages; fail if the snapshot changes or contains gaps. A Werewolf cursor, an Influence event sequence, a message ID and a playable subcue are different identifiers.
3. Select images through current accepted/published scene rules. Resolve normal portrait fallbacks before compilation. Freeze the exact chosen scene versions, wolf forms and character art. Do not consult newer publications mid-render.
4. Fetch only permitted thinking and speech assets. Mystery data, manifests, receipts and asset directories must contain no private pack/role/thinking material, including unused preloads.
5. Cache the selected media locally, check HTTP status/content type, decode/probe it, and record content hashes. A 404 JSON response is an asset error, not a CORS workaround. Use ordinary authorized asset fetching and configured local upload roots; never repair agent artwork implicitly.
6. Compile the layout and timeline, render, verify media output, then atomically publish the final local file. Rendering from the frozen local bundle requires no API or provider connectivity.

Prefer existing typed read endpoints. Where an existing endpoint cannot provide a stable complete replay, add the smallest game-specific read-service extension with the same guards; do not serialize reducer state as an export shortcut. Credentials stay outside manifests and receipts. Restrict credential forwarding to the configured API origin, including redirects. Reuse existing media URL validation/download protections.

## Contract

The following are target boundaries, not a new independent set of gameplay DTOs. Use existing game payloads and runtime validation; avoid `unknown`/`any` catch-all presentation data.

### Export request

- Game ID or slug and API base URL; existing authorized credentials when required.
- Game-supported audience and thinking enabled/order.
- Output width/height/fps and motion preference.
- Timing profile JSON, optional cue overrides, optional speech manifest, music enabled/volume and ending policy.
- Optional source range using stable cue keys from inspection output; start inclusive, end exclusive. Do not use raw slider indexes as durable IDs.
- Output path; refuse overwrite unless explicitly requested.

### Frozen source and assets

- Schema version, game identity/kind, audience, canonical boundaries and publication cutoff.
- Frozen projected cue inputs, exact source references and permitted text.
- Asset table: relative bundle path, hash, media type, measured image dimensions or audio duration/sample rate, and selected publication identity where applicable.
- Speech attachments reference stable message ID + speaker ID + exact text hash + audio asset ID. A changed message or wrong speaker cannot silently reuse a recording.
- Optional speech alignment contains monotonic text-span offsets and measured audio timestamps. Validate range, coverage and duration; malformed supplied alignment fails preflight.
- Render receipt includes source/settings/asset hashes, code revision and dirty-state marker, tool versions, dimensions, duration and output checksum. Reproducibility refers to the same renderer revision and environment, not identical encoded bytes across machines.

### Compiled presentation

Each cue contains:

- Stable cue key and discriminated game payload, with its canonical source reference and any subcue index.
- Absolute start/end time; explicit intervals for establishment, thinking, speaking/reading, post-speech hold and exit.
- Resolved thought/speech pages and page visibility intervals for the output geometry.
- Camera start/end framing and transition timing, including the predecessor framing required at the start of a range.
- Selected asset references and permitted active cast/status. No final-state lookup while rendering an earlier moment.

A shared pure sampler accepts compiled cue context plus presentation time and returns the view state: camera geometry, opacity, visible text/page, ledger or selection progress, transformation state, and other existing visual treatments. Browser and Remotion pass time to the same sampler. The rendered content must not require a live `PresentationDirector` object, networking or manual-advance handlers.

Use milliseconds for semantic intervals and audio positions. Derive integer frame boundaries from absolute times once, with contiguous half-open ranges `[startFrame, endFrame)`. Never sum independently rounded segment lengths. Frame `f` samples `f * 1000 / fps`. Final duration rounds up once; test frame boundaries and audio sample accuracy separately.

### Audio schedule

Keep a small explicit list of clips with asset ID, purpose (`speech` or `music`), presentation start/end, source offset and gain envelope. Expand repeats into concrete clip placements; do not depend on runtime `ended` events. Clip offsets and envelopes are evaluable at any time. A later effects track can use this boundary when it has an actual consumer; do not build an effects library now.

Speech, camera movement and bubble visibility share presentation time. Audio device clocks remain implementation clocks, not an independent authority for advancing game facts.

## Adjustable timing

Defaults reproduce current normal playback. Extract existing timing constants/calculations rather than replacing them with a newly invented pacing preset. Store the fully resolved profile in the bundle so future default changes do not alter an existing export silently.

| Control | Meaning |
|---|---|
| `readingRate` | Multiplier on current unvoiced reading duration, preserving minimum readable holds and pagination |
| `thinkingRate` | Multiplier on current thinking duration; independent of dialogue |
| `conversationGapMs` | Clear breathing room between spoken contributions |
| `ballotHoldMs` / `tallyHoldMs` | Individual receipt and completed tally holds, without changing vote authority or order |
| `establishingHoldMs` | Initial room/scene hold, distinct from camera travel |
| `motionScale` | Scales supported existing transition durations, including camera moves and wolf transformation; never accelerates speech recordings |
| `postSpeechHoldMs` | Hold after speech or text reading ends |
| `ending` | `finish-score` (default) or a fixed result hold in milliseconds |

Per-cue overrides use stable cue keys and the same named fields; unsupported fields or unknown keys fail validation. Do not add arbitrary force-duration overrides that can truncate spoken audio. Keep this as a JSON configuration and CLI input, not a new viewer settings panel.

The compiler owns all duration changes. Stages consume normalized progress or explicit intervals rather than hiding hardcoded hold lengths. Preserve established thought/speech overlap semantics by default: current thinking-first can retain the thought through speech.

Unvoiced speaking duration uses current measured reading behavior. Voiced speaking duration is at least the measured clip length and the minimum required readable page duration; retain the bubble through the entire recording. If aligned pages are available, show each page before its first spoken text and hold through its last word. If timing is too tight, extend holds or fail an invalid alignment; never clip words. Without alignment, distribute pages deterministically over the speaking interval by text length, explicitly without promising word-level sync.

For `finish-score`, the final visible result remains until the later of its minimum hold and the natural end of its non-looping victory track. Muted/unscored endings use the result hold. Fixed endings retain all required final speech, then hold the result and fade music at the file boundary. Report the resulting total duration before rendering; long victory songs may add several minutes.

## Speech readiness and future audio

First implementation accepts optional local prerecorded speech via a validated manifest. Missing attachments use unvoiced reading timing; an explicitly supplied broken attachment fails. Inspection reports voiced/unvoiced message counts. Use a small pair of fixture recordings to prove the contract; production-wide TTS, casting voices, regeneration UI and speech asset publishing are later work.

Recordings are never stretched implicitly to fit a requested hold. Reading-rate controls affect unvoiced passages only. Export v1 uses speech at 1×. Future audible browser speed changes must preserve pitch and scale visual speaking time to match; that feature needs its own acceptance tests and is not implied by supporting prerecorded export tracks.

Music ducks beneath speech using a shared gain-envelope policy with explicit attack/release, leaving thoughts unvoiced. Save mix gains in the profile. Start each semantic music section at source zero, repeat/crossfade according to the approved game score, and preserve continuous position across speakers. Do not change music for a future outcome before its canonical reveal.

Current interactive ambient music deliberately preserves its position on same-section seeks and stays at 1× when replay speed changes. Preserve that behavior in this implementation. Offline export compiles the soundtrack for an uninterrupted traversal; a range export retains source offsets from that full traversal. Document this deliberate distinction from a viewer who has scrubbed around.

When speech is added to the browser later, pause freezes visual and speech position together; resume continues there; seek resolves the clip/offset from the final sampled position; scrubbing does not audition every intermediate clip. Audio mute never advances or rewinds the timeline. Loading waits happen before a voiced segment starts, with explicit failure behavior. This work supplies the shared schedule and rendering contract, not that entire browser voice rollout.

## Rendering and failure behavior

- Bundle the actual stage CSS and fonts. Await font and selected image readiness, measure text at the requested geometry, then freeze layout. Export must not show loading spinners, user buttons, eight-second image timeouts or transient portrait-to-scene swaps.
- Missing generated scenes may use the game's already-selected portrait presentation. Failure to fetch/decode a selected required asset fails preflight with its cue/asset ID; do not silently render a blank frame.
- Use frame-driven motion throughout exported content. Remotion warns that CSS transitions and other animations outside its frame clock can flicker; see [animation guidance](https://www.remotion.dev/docs/animating-properties). The existing [renderMedia API](https://www.remotion.dev/docs/renderer/render-media) supplies the encoding seam; verify options against the installed version.
- Render arbitrary frames independently. Explicit camera predecessor state replaces reliance on mounts or the sequence of prior renders. Do not simulate a whole game from zero for every output frame.
- Begin with conservative renderer concurrency. Load source data in bounded pages, deduplicate assets, and use indexed cue lookup. Log preparation/render/encoding stages, frame progress and estimated duration; no credentials or private text in progress logs.
- Support cancellation, bounded asset/render timeouts and cleanup of temporary servers/processes. Keep the prepared bundle for rerender; no custom checkpoint scheduler in v1.
- No-overwrite default and atomic final rename prevent incomplete outputs from masquerading as completed videos. A machine-readable receipt is written only after ffprobe validates duration, dimensions, codec and expected audio streams.

## CLI and artifacts

Root command:

```sh
bun run replay:export -- hazy-ruby-sand \
  --api-base-url http://127.0.0.1:3000 \
  --audience omniscient --thinking off \
  --timing ./replay-timing.json \
  --output ./exports/hazy-ruby-sand.mp4
```

Additional minimal options: `--inspect` prepares and validates the bundle without encoding and lists cue keys/durations; `--from-cue` / `--until-cue` select a range; `--speech-manifest` attaches existing recordings; `--music off`; `--width`, `--height`, `--fps`; `--overwrite`; `--bundle` renders an already-prepared bundle without network access. Enforce mutually exclusive game-loading and bundle inputs. Show exact supported options in help and reject unknown flags.

Store the MP4 with a sibling bundle directory containing validated source/settings, compiled timeline, hashed assets and final receipt. Bundle path fields are relative; no credentials, expiring signed query strings or arbitrary file references in the render manifest. Bundles can contain permitted private Omniscient evidence and must remain local unless the operator explicitly shares them.

For ranges, compile the full timeline first, then slice and rebase picture/audio while retaining original source references, entering camera state and clip offsets. Only a range containing the terminal result gets the selected ending treatment. Range export at a mid-transition cue must match the corresponding full-export frames.

## Implementation slices and gates

### RE-01 — shared timing and frozen input contract

Define validated request/profile/source/asset/speech contracts and a deterministic interval compiler. Extract current default timings into shared pure functions; preserve interactive behavior. Implement bounded loading through existing authorized projections, source snapshot checks and asset preflight. Add inspection output with cue IDs, counts, duration, fallback selections and voice coverage.

Gate: both games produce complete audience-safe manifests; absent optional speech works; invalid data fails before rendering; timing changes affect only presentation. Mystery noninterference includes serialized files and fetched asset URLs.

### RE-02 — shared content stage and deterministic frame sampling

Extract Influence's content from the viewer, adapt Werewolf's stage to sampled props, and remove export-time dependence on director methods and prior render history. Reuse the same stages in the browser immediately. Resolve text layout before compile and preserve stable portrait framing through thought/speech intervals.

Gate: screenshot comparisons at the same viewport/time match browser content; frames rendered sequentially, in reverse order and individually have equivalent content. Cover camera pans, pagination, votes, nominee decisions, lone/multiple wolf transformations, save/kill and terminal results. Existing browser navigation/readiness behavior remains intact.

### RE-03 — local MP4 and existing music

Add the replay Remotion composition and CLI using existing media utilities. Compile music section offsets, repeats, crossfades and finite ending. Produce one short Influence and one short Werewolf export, inspect them visually and audibly, then export a whole completed game of each kind.

Gate: no controls/loading frames; full dialogue and final tally preserved; fades/loops/ending correct; files playable and validated; missing assets and cancellation produce actionable failure and cleanup. Record actual render wall time and output size; do not promise faster-than-realtime rendering before measuring.

### RE-04 — speech proof and documentation

Attach prerecorded fixture speech to messages, compile speaking intervals and music ducking, prove text/voice synchronization and changed-recording duration recompilation. Test with and without alignment, mixed voiced/unvoiced messages, enabled thinking in both orders and range exports. Document commands, timing JSON, receipts, boundaries, local asset configuration.

Gate: all spoken samples finish, bubbles remain readable, audio and images agree at segment/range boundaries. This completes the optional audio contract without building synthesis or browser voice controls.

## Validation and acceptance

- Provider-free unit tests: timing precedence/validation, thought overlap, frame rounding, zero/short/long clips, page timing, cue overrides, score loops/envelopes/end holds, stable IDs, range offsets and arbitrary-frame determinism.
- PostgreSQL-owned API tests: game-kind resolution, completed-only snapshots, public/unlisted access, hidden/unauthorized rejection, audience filtering, publication cutoff, contiguous loading and required asset selection. Use `setupTestDB()` and the existing isolation discipline.
- Browser/render fixtures: Influence classic and representative format outcomes; Werewolf Mystery/Omniscient with ballots, pack, Doctor save, Seer and lone wolf. Include source-image fallbacks, long dialogue, thought-first/speech-first, different aspect ratios and no generated scenes. Synthetic canonical fixtures cover unavailable recent games; do not pay for new games to test export.
- Audio fixtures: known impulses or short prerecorded samples at defined times; decode the MP4 to check offsets and envelope boundaries with codec tolerance. ffprobe alone does not establish synchronization. Listen to actual speech/music overlaps and loop seams.
- Required baseline before merge: `bun run test`, `bun run test:postgres`, `bun run check`, plus the classified browser/render tests relevant to the stage extraction. Keep local render proof separate from staging, provider quality or publication claims.
- Manual acceptance: inspect short clips first, then one full export per game; no missing/duplicate cues, no clipped messages, no private Mystery material, no on-screen controls, and a deliberate finite ending.

## Scope guardrails and follow-up

If full-frame parity exposes a large Influence presentation dependency, report the exact dependency and smallest extraction before broadening into a player rewrite. Do not fork a visually similar exporter to avoid sharing the stage. If loading requires a transport redesign, separate that larger work and identify the narrow snapshot read needed here.

Deferred: production TTS and voice selection; browser synchronized speech and pitch-preserving rate changes; producer/export UI; worker scheduling and publication; new sound effects; live recording. No release is claimed by this planning document.

## Related plans and local evidence

- [Shared House watch player](2026-10-01-001-refactor-shared-house-watch-player.md)
- [House replay music](2026-10-05-002-feat-house-replay-music.md)
- [W5 trailer and release assets](2026-10-05-001-feat-werewolf-trailers-release-assets.md)
- [Share the clock without sharing game rules](../solutions/architecture-patterns/share-watch-clock-with-game-owned-projections.md)
- [Shared replay music transport](../solutions/architecture-patterns/shared-replay-music-transport.md)
- [Trailer renderer and spoiler boundary](../solutions/architecture-patterns/werewolf-trailer-shared-renderer-and-spoiler-boundary.md)

## Implementation evidence

Implemented on `codex/house-replay-export`; see [usage, timing/audio contracts and validation evidence](../local-replay-export.md). RE-01 through RE-04 have local implementation and verification: complete exports of both games, 1080p excerpts, bounded authorized reads, frozen assets/layout, frame-order checks, canonical format fixtures, and recorded-signal/range-audio checks. No provider calls or publication were made.

The provider-free baseline passed 2,330 tests (5 skipped), PostgreSQL passed 1,917 tests in a fresh isolated database, and type/lint checks passed. A subsequent focused exporter run passed 18 tests including the range-mix regression. Whole-game verification used 640×360/12fps; the separately inspected introduction clips used 1080p/30fps. Full-resolution end-to-end viewing and subjective listening with actual voice recordings remain operator acceptance, not claimed proof.

Implementation findings:

- Browser camera history and timer-driven format entrances needed explicit offline context. The exporter reuses stage geometry and entrance definitions; sampled frames matched across forward/reverse/independent renders.
- Asset and font readiness are not a timed loading beat. A preparation pass freezes speech/thinking layouts before encoding; required asset failures stop with the affected cue.
- Remotion volume callback time is relative to the visible audio sequence, not its trimmed source. Excerpts must retain a separate absolute envelope clock. Decoding the rendered audio caught and verified the correction.
- Remotion's Chromium runner exits synchronously on SIGINT. The local exporter owns exit cleanup for its temporary bundle and partial output in addition to normal asynchronous cleanup.
- The shared development test database lacked an older legacy table. Baseline proof used an isolated migrated database and removed it afterward, preserving the operator's database and separate checkout.
