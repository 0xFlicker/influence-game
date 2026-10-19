# Werewolf API silence and evidence follow-up

## Scope and corrections

The user clarified that simulations **over the API** means simulations run through the localhost API, with durable game records available to replay, Studio and MCP. The prior twenty completed file-only evaluations did not meet that expectation. Their artifacts and spending remain preserved; they are not relabeled as API games.

The discussion prompt formerly led with imperatives to make a move, answer/question/challenge, close a point, or redirect. Permission to pass followed those instructions. It now first asks whether speaking adds something consequential, explicitly permits silence after direct handoffs, discourages invented questions and repeated agreements, and makes handoff constraints conditional on speaking. The budget is a ceiling, not a target. Strategic persuasion, bluffing, corrections and new voting commitments remain valid. Social and observer defaults no longer imply that quiet players must contribute. Final-turn references to earlier statements remain legal.

No pass quota, extra should-speak call, new scheduler or elimination-rule change was added. `thinking` now explains the value of contributing or listening within the existing decision contract.

## Evidence retention

Three boundaries previously lost successful evidence:

1. The shared provider coordinator omitted successful raw responses.
2. The API journal retained the accepted value (including thinking) but only wrote failed non-rate-limit raw evidence.
3. The local simulator retained success accounting, then printed a gameplay decision from which discussion thinking had deliberately been removed.

All three are corrected. Every terminal API attempt uses the existing private bucket/outbox path, including successes and rate limits. Local journals retain complete sanitized requests, terminal records, accepted thinking and available native reasoning, including encrypted provider content. Local persistence failures stop execution; Werewolf output directories cannot overwrite prior runs. Thinking remains separate from contestant-visible gameplay. Credentials remain redacted. No provider-hidden reasoning is fabricated or reconstructed.

Real readback also exposed a positive-round validator that rejected day-zero introduction evidence. It now accepts nonnegative rounds; the previously retained private outbox bodies reconciled without rerunning introductions.

The first two API runs below were diagnostic. Their thinking is retained, but successful native response bodies were still omitted upstream. After discovering that omission, the worker was restarted only after the second game completed. Final-capture runs must have one verified raw response per terminal attempt before acceptance.

## API games

All runs use the normal ten-day maximum and finish the full retrospective. These games use API-generated House casts and seeds, so they are qualitative observations, not a controlled paired comparison with the fixed-cast file-only cohort.

| Run | Model | API slug / ID | Day ballots | Spoken / voluntary passes | Result | Evidence status |
|---|---|---|---:|---:|---|---|
| Diagnostic 1 | Muse Spark 1.3 Contributor | `bold-grey-oak` / `be234183-c413-41d4-b6c9-01e4226a28ac` | 2 | 14 / 13 | Wolves, parity | 51 attempt envelopes; 27 discussion thinking records; successful native bodies missing |
| Diagnostic 2 | GPT-6 Luna | `grim-teal-trail` / `a9962852-3f47-4878-8e7f-815a66531d6f` | 1 | 7 / 4 | Village | 33 attempt envelopes; 11 discussion thinking records; only 3 failed raw responses retained |
| Complete capture 3 | Muse Spark 1.3 Contributor | `pure-beige-snow` / `41e3c550-b476-4515-8b2b-7e0f095b4f86` | 2 | 17 / 8 | Wolves, parity | 50/50 raw responses verified; 25 discussion thinking records; 50 native reasoning payloads |
| Complete capture 4 | GPT-6 Luna | `bare-brown-snow` / `b9290211-2c1c-44d4-870b-a7f1ecce683d` | 2 | 10 / 9 | Wolves, parity on Night 3 | 44/44 raw responses verified; 19 discussion thinking records; 4 responses contain native reasoning items |

One day ballot means the complete serial voting phase for one game day. Neither diagnostic run had a provider-unavailable discussion silence. Examples of retained pass explanations distinguish repetition from useful conversation: a player notes that merely agreeing would duplicate a contribution; another observes that an answer would repeat the already stated standard of evidence. This supports the intended mechanism but does not establish a universal pass rate.

The complete-capture Muse game had eight passes on day one and none during the consequential day-two Seer claim/counterclaim. Saved thinking explains that another contribution would repeat an existing point, or that withholding a Seer check serves a strategic purpose. Both days eventually used the speech budget (277 and 280 bytes remained, below the 320-byte contribution allowance). This establishes that passing is viable without forcing a pass rate or suppressing a contested exchange. It does not establish that every conversation is sensible: players still sometimes use silence as an accusation despite the prompt caution, and the retrospective repeated a questionable heuristic favoring a claimed wolf result over two clear results.

The complete-capture Luna game had seven day-one passes and two day-two passes. Day one stopped with 641 bytes unused after a silent sweep, then all five living voters abstained. Day two ended at the budget with 286 bytes unused; Vera was eliminated by a 3–1 majority, and the wolf reached parity after the next night kill. No discussion or ballot used an unavailable fallback. Saved thinking distinguishes waiting for a concrete claim from merely repeating an evidence standard. Quality issues remain: Vera's vote speech named Nyx while the structured target was Lyra, and Vera's retrospective falsely claimed a wolf victory for herself. Canonical structured ballots and outcomes, not those claims, determine the report.

All 94 final-run terminal responses were retrieved from private storage and independently checked against manifest hash and byte length. All 44 accepted discussion decisions retain nonempty thinking. Muse returned native reasoning items on every response, including encrypted content; Luna returned reasoning items on four responses and only tool-call output on the other forty. The complete response bodies are retained in either case. Encrypted native content is not readable reasoning, and missing provider reasoning items are not reconstructed. Earlier discarded successful native bodies cannot be recovered by this fix.

Private exports are under `packages/engine/docs/simulations/v9-api-silence-evaluation/`. Canonical API records and private bucket objects remain the source; local exports include events, accepted values, manifests, attempt records, API thinking and hash/length-verified provider bodies. The first CLI report was initially written under a duplicated relative package path; both copies are preserved in the evaluation directory, with the original under `original-path-report/`. Monitor writes briefly interleaved raw snapshots into its separate console log; the CLI's own report and canonical API data were unaffected. Subsequent reports use absolute paths and separate monitor files.

## Budget and validation

The original $15 aggregate cap remains controlling. The same ledger (`/private/tmp/werewolf-paid-2026-10-18.json`) includes all prior file-only attempts, all API calls, retries and retrospectives. The local API worker applies the guard before dispatch. No old reservations were removed or reset.

The first API run admitted against $4.72642150 headroom and the prior $4.68626450 broad reserve. Subsequent six-player runs use a conservative $2 whole-game reserve, above twice the observed comparable six-player game cost. Model/preset comparisons replace the unrelated worst-case eight-player Luna comparator; this is an admission estimate, while the hard per-attempt shared cap remains unchanged. Runs are admitted serially.

Final aggregate committed reservation is **$11.63799200 / $15.00**, leaving **$3.36200800**. This includes the original file-only runs and all four new API games. Token-usage estimates total $1.39064155; no provider invoice/actual-cost rows were supplied. Six unsettled accounting reservations remain fully included in the conservative committed total; they are not active games. Both final games and all retrospectives completed, and no additional paid games were scheduled. The final ledger and validation logs are preserved under the private evaluation directory's `verification/` folder.

Validation on the final runtime changes:

- `bun run check`: all workspace typechecks and lint passed.
- `bun run test`: 2,727 passed, 5 skipped, 0 failed. The sandbox denied local socket binding; the network-enabled rerun passed.
- `bun run test:postgres`: 2,086 passed, 0 failed against local PostgreSQL.
- Focused engine evidence/prompt checks: 50 passed. Focused API journal and actual coordinator-to-outbox checks: 57 passed. These include successful native response capture, rate limits, day-zero evidence, accepted thinking and persistence failure behavior.
- The completed Muse API replay rendered in the localhost browser; the localhost MCP `read_game_thinking` returned stored thinking at its completed cursor.

An earlier full database run loaded the pre-fix day-zero validator and failed its new regression test. The final full run above passed after the correction. No failed checks are being counted as successful validation.
