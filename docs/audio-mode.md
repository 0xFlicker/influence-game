# Audio Mode implementation

House narration in both viewers and the shared replay export now displays the existing House logo and accepted summary text for the exact recorded audio interval. Long summaries use deterministic readable pages; pausing or seeking samples the same recording clock, with no independent overlay timers. Existing text-only House scenes remain available when no recording exists. Werewolf village-vote elimination reveals desaturate the recorded victim during the announcement, while ballot collection and living players retain their color. Live Werewolf room rotations carry the preceding canonical room speaker across waiting-screen remounts, matching saved playback and export sampling.

Implementation is in progress on `codex/agent-voices-audio-mode`, based on
`codex/peragent-model-selection`. The [approved plan](plans/2026-10-24-001-feat-agent-voices-and-audio-mode-plan.md)
owns the complete product scope. Audio Mode is available as an independent, default-off game creation option for both games.

Every response that requests `thinking`, including House decisions and both games,
receives shared guidance for a concise, in-character inner monologue. It sets up
the spoken message or silent choice through motives, suspicions and game stakes.
Game rules are welcome; schema/ID commentary, prompt compliance and byte/token
arithmetic are not. This is prompt guidance, not a content filter or retry rule.
Speech-only responses do not acquire thinking. Existing delivery-tag preferences
and missing-pitch treatment remain in effect.

## Delivery compiler

`@influence/engine/audio-delivery` supplies the shared, provider-free text contract:

- `normalizeAudioDelivery` separates supported xAI controls from clean text,
  preserving the original string, UTF-16 source spans, annotations and diagnostics.
- `compileAudioDelivery` applies the missing thinking-pitch fallback using a typed
  context supplied by canonical game metadata. Ordinary thinking prefers
  higher-pitch; nighttime thinking prefers lower-pitch. An authored preferred
  pitch on any usable span counts as present. Other tags remain intact.
- Nighttime speech has soft prompt guidance, not forced wrapping or emphasis
  suppression. Identical nested wrappers collapse; distinct tags and separate
  spans remain. Compiling an already compiled rendition is idempotent.
- Broken recognized controls produce diagnostics rather than a game-decision
  error. Their words remain. Unknown brackets remain literal text; this parser
  is not an HTML sanitizer and must never be used with raw HTML rendering.
- `audioDeliveryGuidance` prepares the default prompt directions for both audio
  and non-audio games. Structured Influence, Werewolf, House narration and
  retrospective invocations now include it by default.

The vocabulary is pinned to the [xAI tag reference](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech#speech-tags)
checked on October 24, 2026. This is text transformation only: no audio DSP,
normalization, provider request, database mutation or gameplay decision parsing.

The document retains private production evidence. Persist its bodies through the
existing private bucket/payload infrastructure; store relational references and
hashes in PostgreSQL. Only `cleanText` may enter presentation and future agent
context. Source-to-text mappings do not establish audio timestamps.

## Accepted annotations and clean context

The exact structured-output registry normalizes only schema-declared presentation
paths before applying the original clean-text schema and semantic validation.
IDs, targets, votes and gameplay structure are untouched. Native schemas retain
that exact structure; delivery-bearing strings describe their visible-character
limits instead of enforcing them against raw tag characters. Local validation
still enforces every original length limit. Length-repair prompts quote clean text.

Both games persist clean accepted values and use those values for canonical
history, subsequent observations, self-history, summaries and public projections.
The provider coordinator retains sanitized source annotations separately; any
credential redaction recompiles source maps. Private traces show the actual prompt
including delivery guidance. Like repair instructions, delivery guidance is added
after frozen gameplay context hashing/compaction, so enabling it does not invalidate
an interrupted logical call's unchanged context. Existing accepted history is not rewritten.

`provider_logical_calls.audio_delivery_object` is a private `json-gzip` bucket
reference with verified hashes and lengths. The document holds compiler version,
explicit field paths (including nested whispers), source text, normalized spans
and the context-specific synthesis rendition. Journal acceptance commits this
reference together with the clean accepted result; failed uploads cannot publish
a partial acceptance. The existing payload inventory/garbage collector covers
unreferenced uploads. Annotation retention does not depend on debug trace retention.
Gameplay recovery and owner learning do not fetch these production documents.

Document offsets address the clean provider field before any existing domain
trimming or field renaming. Recording attachment must match that field to its
accepted production moment and account for the domain's whitespace normalization;
source maps alone neither identify a replay moment nor establish timestamps.
Thinking context is supplied by typed Werewolf action metadata, never inferred
from dialogue. Night speech is not forcibly wrapped.

## Stock voice identity contract

`@influence/engine/voice-catalog` freezes the audition's 28 stock voices and their
provider gender labels. Helios is reserved globally for the House; the remaining
27 are eligible for players. Version 1 hashes a namespaced stable character ID
using the engine's FNV-1a convention. Declared male/female gender narrows the pool;
non-binary/unspecified uses the full player pool. Explicit selection can cross
labels, and reset returns to the deterministic policy. No name, image, live catalog
order or random delivery effect enters selection. Persist the returned assignment
and copy it into a track snapshot; never recompute an existing assignment on reads.
Owner GET/PUT `/api/agent-profiles/:id/voice` provides the stock picker and an
explicit save. Helios is rejected for players. Automatic choices are persisted
when a game/track freezes its roster. Missing historical profiles use a stable
identity fallback. The eight operator-approved testing selections are listed
in the plan; install them through the owner API before live qualification.

## Production, playback and historical tracks

Browser-blocked or interrupted voice playback pauses the viewer without an enable-audio
prompt. The ordinary Play control (including its keyboard shortcut) retries voice
audio in the user gesture and resumes the existing position in both games. The voice
element is retained across cues; stale playback attempts cannot pause a later cue or
restart playback after the user pauses. Actual load/playback failures remain visible
and use the same Play control to retry.

Migration `0132_audio_tracks.sql` adds profile preferences, logical tracks/clips,
append-only versions and dispatch attempts. The existing private bucket stores
voice snapshots, manifests, recipes, request/response evidence and MP3 bytes.
Database rows contain identifiers, hashes, lengths, status, leases and duration.
The payload inventory includes all new body columns. A delivered response is
uploaded and verified before probing; an invalid MP3 remains private evidence.
No existing historical audio is regenerated or moved by this migration.

The execution worker polls queued tracks. Each required clip has up to three
attempts for explicit retryable provider responses. Unknown dispatch outcomes,
transport failures and evidence/storage failures stop paid work for operator
inspection. Expired leases cannot accept another worker's artifacts. An explicit
retry preserves ready clips and reserves another bounded allowance for gaps.
Estimates use $15 per million input characters, including tags conservatively;
reserved characters are an upper spending estimate, not an invoice.

Production uses xAI native MP3 (44.1 kHz, 192 kbps). `ffprobe` measures the returned
container. There is no normalization, pitch/speed filtering, reverb or other DSP.
The worker requires `XAI_API_KEY`, the existing private-payload bucket settings,
and `ffprobe` on PATH. It follows normal execution-worker activation/drain rules.

Audio Mode freezes voices in the game-start transaction. After text acceptance,
the runtime builds eligible production moments and waits for verified audio
before the next logical turn. Viewer reads stop at the ready prefix. Werewolf
shows an empty waiting window while its first announcement is being produced.
Audio failure preserves accepted gameplay and suspends execution; terminal
completion also waits. Influence's required gate is outside the optional,
error-swallowing projection callback. Neither game receives audio, tags or URLs
in contestant context.

Studio's Recordings panel previews the full-track count, frozen voices and price.
For an originally non-audio completed game, Generate full audio track explicitly
queues its first track; reopening Studio never generates it. Ready tracks publish
automatically. Retry missing clips uses the same frozen recipes. For a suspended
live game, finish retrying and then choose Resume game with ready audio. That
separate operation checks the exact failed owner and never clears an unrelated
suspension. Source-preparation failures require diagnosis before resuming.

Public playback uses the existing director clock and measured clip durations,
including thinking, pause/speed, buffering and in-clip seeks. Show thinking and
Werewolf audience choices filter playable references. Voice mute/volume is
separate from music; music ducks during audible speech. Autoplay rejection has
an explicit enable action. House phase/night/vote/result announcements derive
from canonical Werewolf fields, not parsed prose.

Studio pins its audio publication. Load ready audio into this preview explicitly
adopts newly completed work; polling a generation job never changes the cut.
Generated speech and thinking bind to the shared recording/timing compiler.
Frozen exports contain exact version IDs, text/speaker hashes and durations;
server validation rejects substituted versions. Export downloads existing media
and makes no provider calls. Future producer replacement can append a version
without changing logical clip identity; that editorial action is not exposed yet.

## Correcting a live cast

The explicit operator selections must exist in `agent_voices` before game start.
The normal deterministic fallback intentionally does not infer a special mapping
from an agent's name. The October 25 testing cast uses Sal, Ara, Liora, Atlas,
Iris, Altair, Kepler and Sirius in the plan's agent order; Helios remains House.

Stop execution and audio workers before correction. Retain interrupted text-call
reservations and use the existing text recovery workflow separately. Audio must
be settled: this tool rejects a running track or an unresolved generating clip.
It never invokes providers, starts services, or automatically resumes a game.

From `packages/api`, with the intended environment's `DATABASE_URL`, prepare one
JSON request per game containing `gameId` and `selections`, a complete object
mapping every roster **agent profile ID** to its explicit stock voice ID. Names
and model names are not accepted as identity substitutes.

```sh
bun src/scripts/recover-live-audio-voices.ts preview /absolute/path/request.json
# Add the returned previewHash to the reviewed request, then:
bun src/scripts/recover-live-audio-voices.ts prepare /absolute/path/request.json
```

Preview reports the exact cast, original track/owner, replacement count, reusable
count and estimated cost. Prepare validates that snapshot under game/owner/track
locks, persists all selections for future games, suspends the current game and
revokes its owner. It creates an active successor track linked by `predecessorId`.
Accepted events, transcripts, actions, character gender and images are untouched.
Old snapshots, clips, versions, attempts, cost reservations and bucket objects are
retained. The predecessor cannot be retried or published as the current track.

The successor starts failed/held with ready frontier zero. Matching delivery
recipes reuse verified bytes under fresh clip/version IDs; changed voices create
pending recipes for both speech and thinking. House Helios therefore needs no
new synthesis. Voice assignment provenance is excluded only from the reuse
comparison; text, tags, provider voice and encoding must still match. New version
URLs and recipe hashes prevent wrong-voice cache reuse.

Inspect the successor, then explicitly use Studio's **Retry missing clips** (or
the producer retry endpoint/service) to queue generation within the existing
shared budget guard. When it is ready, explicitly **Resume game with ready audio**
using the returned owner epoch. Any accepted text beyond the copied track manifest
is picked up by the normal required-audio gate before another model turn. Reload
open public viewers and explicitly load the new publication in Studio; a browser
that already downloaded old media cannot have those bytes remotely recalled.

## Live Influence audio coordinates

Published transcript-derived clips include both the saved database `transcriptId`
and, when available, the durable game-local `entrySequence`. Live websocket
dialogue uses synthetic message IDs, so it binds audio through `entrySequence`;
saved replay and export retain their real transcript IDs. House announcements,
speech and thinking use the same identity mapping. Event-only clips keep their
event coordinates.

The API enriches this read projection from game-scoped transcript rows. It never
changes stored manifests, source/recipe hashes, version IDs or audio bytes.
Existing active tracks therefore gain the coordinate on their next publication
read without regeneration or a database migration. Reload the serving API and
the updated web matcher; game/TTS workers need no restart for this change.

## Qualification still required

The implementation's mock-provider checks do not establish xAI pronunciation,
audible browser/export alignment, mobile autoplay or production storage setup.
Run the separately budgeted localhost API qualification after applying migration
0132 and the approved model-agent voice assignments. No paid provider calls were
made in this workflow implementation increment. The owner picker currently lists
presets; reusable stock sample previews still need to be published. Very long
historical speech beyond xAI's single-request limit needs segmented production
before it can be qualified; ordinary current game output bounds are much smaller.

## Validation

Run `bun test packages/engine/src/__tests__/audio-delivery.test.ts` for the compiler
contract. It covers supported vocabulary, mixed and malformed tags, duplicate
nesting, word preservation, Unicode/source mapping, long text/deep nesting,
nighttime prompt preference, context-specific fallback and idempotence. These are
provider-free tests; audible quality and browser/export alignment need their own
qualification when the recording integration lands. The next text-generation
gate is documented in [default delivery-tag qualification](testing/audio-delivery-qualification.md).

Initial increment validation (October 24): 53 focused compiler tests passed;
`bun run test` passed 2,934 tests with five skips; `bun run test:postgres` passed
2,183 tests; `bun run check` passed. The provider-free suite required loopback
access outside the sandbox for its existing local-server/child-process tests.
No paid providers were called during this implementation increment.


Second increment validation (October 24): the provider-free baseline passed 2,944
tests with five skips; the final House follow-up/prompt refinement also passed its
65 focused tests. `bun run check` passed. The PostgreSQL rerun passed 2,185 tests
but returned nonzero for an isolated staging-render fixture's cleanup
hook timeout; rerunning that file alone passed all eight tests and cleanup in
23.58 seconds. The earlier migration-fixture failure was corrected and passed on
the full rerun. No paid providers were called. Live qualification remains pending;
these results do not establish model quality, audio timing or playback/export parity.

The subsequent eight-model Werewolf API qualification completed with 69 accepted
calls and 81 provider attempts, at an estimated $1.537443. Private annotations and
clean replay/context checks passed. Overlong and instruction-narrating thinking
prompted a follow-up: usually 2–4 short in-character sentences directly in the
native thinking field description, plus a reminder not to narrate length repairs.
Existing bounds and tolerant tag handling remain unchanged. See the
[live result](testing/audio-delivery-qualification.md) for recovery, evidence and
the remaining model-quality check; no audio was generated.

Live playback can receive recorded durations before saved thinking text. The director captures the current content position before inserting that text into its timing cache, preserving the camera entrance instead of advancing to the thought boundary. Speech and thinking still use their measured recording durations; paused and exact-seek positions remain on the shared clock.

Influence live WebSocket messages have negative UI IDs. Audio binding uses their durable game-local `entrySequence`, not those synthetic IDs; completed replays keep exact persisted transcript-ID matching. Transcript lookups never widen to event-only matching, because one event can contain several contributions. Older event-only format clips retain their existing event/actor binding.

House summary cues in Influence expose a full-cue speech interval even though they have no contestant speech bubble. The shared director/export policy replaces that interval with the saved narration duration, enabling synchronized House audio and captions without changing silent room-title bridges.
