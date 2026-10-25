# Audio Mode implementation

Implementation is in progress on `codex/agent-voices-audio-mode`, based on
`codex/peragent-model-selection`. The [approved plan](plans/2026-10-24-001-feat-agent-voices-and-audio-mode-plan.md)
owns the complete product scope. Audio Mode is not yet available in game creation.

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
This is a tested contract only: profile persistence, API/MCP selection and the
sample picker are still pending.

## Remaining integration

Connect the frozen stock-voice catalog/House identity, bucket-backed xAI recordings,
live readiness/suspension, deliberate Studio backfill and the existing shared
playback/export recording schedule. Use direct House calls and no `as any` casts.
No audio generation, game creation setting or completion of
those layers is implied by the text-boundary integration.

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
