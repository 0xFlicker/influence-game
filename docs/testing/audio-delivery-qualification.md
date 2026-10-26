# Default delivery-tag qualification

This gate qualifies default text generation before the first live Audio Mode
recording increment. It does not enable Audio Mode, synthesize recordings, alter
saved voice choices or backfill historical games.

## Werewolf live result — October 24, 2026

One authorized localhost game completed: `e0b67229-61c3-4f46-a283-1e730cf234df`
(`free-blue-shard`), Werewolf v10, eight model agents, two wolves, no Audio Mode.
The village won on day two and all eight retrospective statements completed.
The run used commit `4b02806f`; subsequent prompt refinements below were made
only after completion. No Influence game or TTS request was started.

- 69 accepted logical calls; 68 private annotation documents (the House episode
  copy call has no speech/thinking delivery fields); 81 persisted provider attempts.
- All annotation documents and provider evidence were read back with integrity
  checks. Saved field text matched accepted clean values. All 81 inspected native
  requests kept recognized delivery tags out of prior dialogue/context, including
  repair drafts. Every requested thinking field had the shared prompt guidance.
- Full replay reads covered 73 Mystery and 78 Omniscient entries, with no delivery
  tags in their presentation entries. Night speech included authored soft tags;
  missing nighttime/ordinary thinking pitch received the appropriate saved fallback.
  The production thinking reader also revalidated all 55 eligible thoughts against
  accepted values, hashes and canonical actions without another provider dispatch.
- Twelve rejected attempts: six speech-length failures, four overlong Haiku
  thinking responses, and two DeepSeek retrospective JSON-document failures.
  No rejection was caused by delivery tags. The configured GPT Luna recovery
  accepted one Haiku conversation turn; other accepted contestant calls used
  their selected models. Original failures and successful responses remain saved.
- Final recorded estimate: **$1.537443**, with **288.8 Katana credits** also reported
  by that provider. Dollar totals are static rate-card estimates, not a reconciled
  invoice; the native credit total is not an additional dollar charge.

Assessment: the tag persistence and context-isolation path passed this Werewolf
run. Thinking quality needs refinement: Sonnet narrated a length repair and Haiku
quoted instructions/remaining bytes and exhausted a thinking-length retry series.
The follow-up puts brief in-character guidance directly on the native thinking
field (usually 2–4 short sentences), removes the numeric negative example, and
reminds repairs not to narrate their mechanics. That prompt refinement changes no
game rules or text filtering. Its model-behavior improvement remains unproven
until a subsequent authorized live check; do not label this run as evidence for
the revised prompts or for synthesized audio/playback.

The operator clarified that the authored thinking limit should remain 2,000 UTF-16
code units; the temporary 8,000-unit increase was reverted without a paid rerun.
Thinking uses the same length-repair path as speech: the next attempt receives the
clean rejected draft, measured length, allowed length, exact overage, and rejected
structured decision, with instructions to shorten the field while preserving its
intent and other valid choices. Werewolf allows three attempts per model before
configured recovery. The provider output-token budget remains 8,192.

Follow-up automated validation passed: 231 focused tests; `bun run test` passed
2,950 tests with five skips; `bun run test:postgres` passed all 2,185 tests;
`bun run check` passed typechecking and linting. Tests preserve exact field shapes,
clean-text limits, nullability and acceptance of imperfectly styled thinking.

Private audit snapshots, full provider evidence, the routing report and cost/read
checks are retained in the task's `audio-implementation-validation/live/`
artifact directory. Do not commit raw prompts, profile data or provider bodies.

## Automated evidence

The implementation tests clean accepted fields, private annotation retention,
length-repair feedback, replay after restart, failed annotation upload, unchanged
frozen gameplay context hashes, current Werewolf night/day actions and native
provider schema compilation. Required checks are `bun run test`, sequential
`bun run test:postgres`, and `bun run check`.

Migration `0131_audio_delivery_annotations` introduces a nullable bucket reference.
Existing calls remain unchanged. Before any live test, run the feature branch's
API with its migrations applied; an existing localhost server on the model-selection
branch will not exercise this change. Preserve other running development work.

## Proposed live run

Run one complete eight-seat Influence game and one complete eight-seat two-wolf
Werewolf game through the localhost API. Use the original audition cast: GPT Sol,
Claude Sonnet, Claude Haiku, Gemini Pro, Meta Spark, Kimi K3, DeepSeek Flash and
Grok 4.6. Resolve their current IDs and model preferences through localhost MCP;
do not change saved profiles or substitute cheaper models silently. Use GPT Luna
for House text and the common recovery route. All nine relevant model entries
were available in the localhost catalog when this proposal was prepared.

Create a local roster document with `seats` (stable IDs, `agentProfileId`, current
`preference`) and the version-1 model-routing `policy`. Keep actual account IDs,
private source prompts and provider responses out of this document and public
panels. Preview both games before dispatch:

```sh
bun run simulate:models --game influence --players 8 --roster /path/to/local-roster.json --preview
bun run simulate:models --game werewolf --players 8 --roster /path/to/local-roster.json --preview
```

After explicit paid-game authorization, run each command without `--preview`
against the feature branch's localhost API, retaining the generated evidence
folder and actual game ID. The CLI starts a game; it does not by itself wait for
completion or establish a spend cap. Monitor progress, failures and actual provider
receipts through the existing API/MCP. Choose a text-provider spending allowance
before dispatch. The earlier $10 xAI audio-audition allowance does not cover new
full-game text simulations.

## Inspect before proceeding

1. Confirm every accepted speech/thinking field is clean in canonical game history,
   ordinary API/MCP dialogue, replay, and the next actor's context. System guidance
   may contain tag examples; quoted history must not contain delivery controls.
2. Read the accepted logical call's private annotation object and verify its hash,
   field paths and original source against the sanitized provider receipt. Check
   raw evidence retention independently of the normal public read models.
3. Inspect untagged, mixed-tag and malformed-tag responses. Tags must neither consume
   the clean-text allowance nor cause retries by themselves. Missing thinking pitch
   uses higher-pitch by day and lower-pitch at night. Night speech may use soft,
   other tags, or no tags. Passes stay passes.
4. Include House follow-ups/closing remarks, summaries and terminal retrospectives.
   Verify no invented thinking field is accepted where the exact schema omits it.
5. Check restart/recovery on a completed accepted call without another paid dispatch.
   Do not kill a paid in-flight request merely to repeat the provider-free fault test.
6. Record game IDs, the observed model routes, acceptance/retry outcomes and costs.
   Human review should assess whether tag use still sounds like the character and
   whether new delivery guidance harms concise dialogue or strategy.

The later recording gate still needs verified bucket uploads, source-to-moment
matching (including existing domain trimming), decoded duration/alignment, browser
seeking and export parity, and audible review. Passing this text gate does not
claim those playback features are complete.
