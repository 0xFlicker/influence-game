# Native JSON-schema game decisions: localhost API evaluation

This evaluation changes future game inference. Completed-game events, replay,
Studio, and saved evidence are retained. Active-game upgrade continuity is
outside scope; deployment drains games. LM Studio remains best effort, with no
qualification work added on the basis of an old local experiment.

## Runs

| Game | Model | Configuration | Result |
| --- | --- | --- | --- |
| `soft-pink-dusk` (`4437792b-a5fd-4311-ace9-585774587b2b`) | GPT-6 Luna | Influence, 6 players, medium reasoning | Completed through all six retrospective statements. Wren won 3–0 over Luna. |
| `kind-olive-soul` (`53f38102-01c2-40c4-9c4c-479d6cfa1b22`) | Muse Spark 1.3 Contributor | Influence, 6 players, medium reasoning | Completed through all six retrospective statements. Riven won 2–1 over Luna. |
| `kind-cyan-oak` (`0c6a29c1-ab5d-4dd2-9432-c4863546aed8`) | Katana Grok 4.3 | Werewolf, 6 players, one wolf, medium reasoning | Completed on the final source, including all six retrospective statements. Village won on day one, voting out Atlas 4–1. |

Local replay URLs use `http://localhost:3001/games/<slug>/replay`.
No production deployment or paid image generation is part of this evaluation.

## Evidence and implementation boundary

Private exports are under
`packages/engine/docs/simulations/json-schema-2026-10-19/`. They include canonical
events, durable turns and calls, transcripts, cognition, production sources,
provider attempt metadata, and full sanitized request/response evidence. Each
exported provider evidence object is checked against its saved SHA-256 and byte
length. Export files are created exclusively, never overwritten.

The Luna and Muse games started after player, Werewolf, retrospective, and shared
provider transport migration, but before the final House opening-question
conversion. Plain-text calls in those runs are identified separately below;
they are not evidence that the final House question path ran live. The final
source returns an exact `{question}` object and has malformed-output, retry,
and fallback-attribution coverage.

### Luna

- 228 provider attempts: 219 strict JSON-schema requests, nine plain House
  opening questions, zero tool requests.
- One transport timeout recovered. No schema or semantic-output rejection.
- All 81 conversation decisions retained thinking; 16 were passes.
- 173 accepted decisions carried thinking. The cognitive store contains 173
  thinking, 163 strategy, and 40 reasoning artifacts; 58 raw provider responses
  contain native reasoning summaries. Raw evidence also retains House and
  retrospective reasoning independently of contestant cognition.
- All six retrospective accepted values contain only `speech`.
- Usage-based estimate: $0.34780125. Conservative budget commitment: $3.57858225,
  including reservation coverage for the timeout without a usage receipt.
- The new replay loaded and played decoded introduction dialogue in the browser.

### Muse

- 224 provider attempts: 215 strict JSON-schema requests, nine plain House
  opening questions, zero tool requests. No schema or semantic-output rejection.
- Two transport timeouts exhausted one Save-or-Exit ballot's attempts. That
  logical call has no accepted model value; the phase's existing legal fallback
  allowed the game to continue. This is a completed game with a transport fallback,
  not a claim that every decision succeeded or both timeouts recovered by retry.
- All 74 conversation decisions retained thinking; two were passes. The cognitive
  store contains 172 thinking and 158 strategy artifacts. Muse returned no native
  reasoning summary in these responses; the complete raw evidence is retained.
- All six retrospective accepted values contain only `speech`.
- Usage-based estimate: $0.16526850. Conservative budget commitment: $1.23299540,
  including reservation coverage for the two timeouts without usage receipts.

### Grok

- Exactly one game launched. All 42 attempts used strict Chat Completions
  `response_format` JSON Schema. All 42 succeeded; no retries, tool requests,
  plain-text requests, or phase fallbacks.
- All 36 gameplay decisions retained thinking, including 23 discussion decisions
  (ten spoken contributions and 13 passes). All 42 raw provider responses retained
  native reasoning. Werewolf's accepted calls and private evidence own these
  values; it does not populate Influence's cognitive-artifact table.
- All six retrospective accepted values contain only `speech`.
- Usage-based estimate at the conservative Katana rate: $0.75892886; no actual-cost
  receipt was exposed. Conservative budget commitment: $6.23830548.

## Budget and conclusion

These three games used 494 provider attempts. Their recorded usage estimates and
provider receipts total **$1.27199861**, excluding unknown actual usage for three
timed-out attempts. Conservative reservations cover those timeouts and keep the
whole shared evaluation ledger at **$18.03377588 of its $25 cap**, including
earlier open-conversation games. The ledger's known usage/receipt total is
$2.16563271; conservative headroom is $6.96622412. Final ledger and audit snapshots
are saved beside the private game exports.

All three providers completed full localhost API games with schema-constrained
decisions. No schema rejection occurred in these runs. Muse's transport-exhausted
ballot is an explicit limitation, and the final House opening-question conversion
has unit coverage rather than live coverage in these two Influence runs. This
qualifies the transport exercised here, not every game format or model behavior.

## Completed-game compatibility

The pre-migration Influence game `punk-brown-rock` still opened and played in the
browser. Its Studio source returned HTTP 200 with the first 256 messages and
moments. The pre-migration Werewolf game `just-amber-wyrm`
(`f8d0839d-e993-4655-af72-92f04b8d33e2`) returned HTTP 200 from the Studio source
API with 64 moments and 56 thoughts in the requested page. Historical raw tool
evidence remains readable; no stored game payload was migrated or rewritten.

## Validation

- Provider-free baseline: 2,739 passed, five skipped.
- Final player/House/provider-adapter checks: 243 passed.
- Prompt evaluation broker/panel checks: 17 passed; blind-review fixture checks
  passed after updating its schema-less request fixture.
- Typecheck and lint passed.
- Full PostgreSQL baseline: 2,094 passed, zero failed.
