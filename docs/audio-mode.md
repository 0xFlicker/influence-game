# Audio Mode implementation

Implementation is in progress on `codex/agent-voices-audio-mode`, based on
`codex/peragent-model-selection`. The [approved plan](plans/2026-10-24-001-feat-agent-voices-and-audio-mode-plan.md)
owns the complete product scope. Audio Mode is not yet available in game creation.

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
  and non-audio games. It is not connected to model invocation yet.

The vocabulary is pinned to the [xAI tag reference](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech#speech-tags)
checked on October 24, 2026. This is text transformation only: no audio DSP,
normalization, provider request, database mutation or gameplay decision parsing.

The document retains private production evidence. Persist its bodies through the
existing private bucket/payload infrastructure; store relational references and
hashes in PostgreSQL. Only `cleanText` may enter presentation and future agent
context. Source-to-text mappings do not establish audio timestamps.

## Next integration boundary

Before enabling tag guidance, persist accepted annotations atomically with the
owning turn and use clean text throughout both games' observations, self-history,
summaries, thinking presentation, transcripts and public read models. Preserve
the existing exact schemas, gameplay semantic validation, provider journal and
private raw evidence. Do not enable prompting piecemeal before these boundaries
are proven. Use direct House calls and no `as any` casts.

Then connect the frozen stock-voice catalog/House identity, bucket-backed xAI
recordings, live readiness/suspension, deliberate Studio backfill and the existing
shared playback/export recording schedule. No production integration, provider
spend or completion of those layers is implied by the compiler tests.

## Validation

Run `bun test packages/engine/src/__tests__/audio-delivery.test.ts` for the compiler
contract. It covers supported vocabulary, mixed and malformed tags, duplicate
nesting, word preservation, Unicode/source mapping, long text/deep nesting,
nighttime prompt preference, context-specific fallback and idempotence. These are
provider-free tests; audible quality and browser/export alignment need their own
qualification when the recording integration lands.

Initial increment validation (October 24): 53 focused compiler tests passed;
`bun run test` passed 2,934 tests with five skips; `bun run test:postgres` passed
2,183 tests; `bun run check` passed. The provider-free suite required loopback
access outside the sandbox for its existing local-server/child-process tests.
No paid providers were called during this implementation increment.
