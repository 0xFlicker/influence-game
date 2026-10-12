---
title: Paid retrospective model-quality trials
date: 2026-10-11
status: model_quality_changes_required
branch: codex/game-retrospectives
implementation_head: cddfc3ed
---

# Paid retrospective model-quality trials

Qualification scope: these trials precede `f70ae7cc`, which changed prompt guidance from 80–150 words to candid 40–75 word statements with a requested 1,000-code-point maximum. The artifact still permits at most 2,000 code points. The newer prompt has not received fresh paid qualification; the delivery evidence and quality findings below describe the original dispatched prompt.

The operator authorized local paid trials for both games with a combined **$10 maximum**, and required results before staging deployment. These runs use hosted `openai:gpt-6-luna` with low reasoning, fresh synthetic games and built-in fictional House characters. No existing game database, user profiles or personal documents enter the trials. Production code and accepted statements are unchanged.

**Three games completed all 20 final statements. Delivery/context checks passed; model quality needs improvement before staging acceptance.** Four speeches contain confirmed factual errors, with repeated framing and weak engagement with earlier final statements. Known usage estimates total **$0.387776**. The final conservative bound is **$3.327543**, including full reservations for four recovered HTTP 429 attempts whose billed usage is unavailable. The peak held bound was $3.478246; every dispatch stayed below $10. No further paid request or staging deployment followed these trials.

## Scope and budget

The ordinary local runners generate gameplay and the complete epilogue. A temporary fetch preload enforces one shared budget across sequential processes: it allows only the selected hosted text model, requires bounded output, and reserves a conservative input/output charge before every generation request. Text input uses complete UTF-8 request bytes plus a 16K framing allowance. Reservations cover the higher long-context cache-write/output prices, Fast multiplier and regional premium; uncertain transport retains its full reservation. Observed usage replaces a reservation with a conservative usage bound, rather than treating the lower estimated bill as guaranteed spend.

Usage estimates use the [official API pricing](https://developers.openai.com/api/docs/pricing) fetched on 2026-10-11: Standard short-context input/cache-read/cache-write/output rates are $0.10/$0.01/$0.125/$0.50 per million tokens, with long-context and service-tier adjustments. These are usage-based estimates, not an invoice or an account-wide spend reading. The guard covers all gameplay and final-statement generation, including unsuccessful attempts. Native prefix-count reads are logged separately.

The ledger contains 504 generation attempts: 500 responses with usage and four rate limits. All three rate-limited gameplay calls recovered under the existing provider policy; no retrospective statement retried and no required step exhausted. The four unknown-usage reservations total $0.226980 and remain in the bound. Native journal token totals match the captured transport totals, including cache writes. The 20 retrospective requests alone have a known usage estimate of **$0.041490**; the remaining measured spend generated the games being reviewed.

## Completed trials

| Trial | Outcome and coverage | Epilogue | Generation requests | Estimated cost |
| --- | --- | --- | ---: | ---: |
| Influence, six players | Mira won 3–0 after Save-or-Exit, Highest Count, Reckoning, Tribunal and Judgment; four rounds | Six statements in Rex → Atlas → Vera → Finn → Lyra → Mira order | 172 | $0.116571 |
| Werewolf, six players/one wolf | Village won on day one; Atlas died at night, Mira identified Vera, village eliminated Vera | Atlas → Vera → Lyra → Mira → Rex → Finn | 28 | $0.005772 |
| Werewolf, eight players/two wolves | Village won on day three; two wolves eliminated, Seer voted out, Doctor blocked two attacks | Atlas → Lyra → Rex → Kael → Echo → Finn → Mira → Vera | 304, including four recovered rate limits | $0.265434 known usage |

Influence used the Standard service tier; both Werewolf runs used Flex. Each Werewolf order starts with canonical deaths, followed by its frozen survivor permutation.

Influence game ID: `538c1636-bfb0-48fb-a48a-3d5de43b5aa5`; original outcome boundary 163, completion record 172, input hash `sha256:d1719c27c20033c9c52ceb4519b3acfe6eb14590f9852b9c70a28a2cc0f801f8`. Local artifacts: `packages/engine/docs/simulations/batch-2026-10-11T15-18-54/`.

Six-player Werewolf game ID: `werewolf-8cce97a6-b390-4029-9f34-1a6bdad626b4`; original outcome boundary 31, completion record 39, input hash `sha256:1dc9b13f23907b36621018d9241fe844de892f07e6bc9b646d7ce3c8525ea3a4`. Local artifacts: `packages/engine/docs/simulations/rt15-werewolf-2026-10-11/`.

Eight-player Werewolf game ID: `werewolf-a0a7c649-d0f2-43d1-bc33-cf92ac267d8e`; original outcome boundary 354, completion record 364, input hash `sha256:d55b345c2bb637f2d0864bb646cffb479af1be53a2af9fdcc0be6d25c6a0ace9`. Local artifacts: `packages/engine/docs/simulations/rt15-werewolf-eight-2026-10-11/`.

## Delivery and context checks

Every statement was accepted on its first native attempt. The captured native tool response exactly matches its canonical accepted speech. Each original contestant appears once in the recorded order. Every dispatched speaker receives the same complete frozen input hash and exactly the earlier accepted speeches, in order and verbatim. The local MCP reader traverses all three actual paid-run artifacts through their explicit game identities and owning reducers, returning the same actor/order/event/text and completed progress.

| Trial | Chronological sections | Original dialogue entries | Serialized speaker context | Words per statement | Total words | Normal solo presentation clock |
| --- | ---: | ---: | --- | --- | ---: | --- |
| Influence | 26 | 104 | 93,718–98,968 bytes | 125–149 | 822 | 4:26.1 |
| Werewolf, six | 6 | 15 | 10,931–15,529 bytes | 112–126 | 720 | 3:55.5 |
| Werewolf, eight | 40 | 163 | 106,083–112,866 bytes | 111–133 | 969 | 5:16.7 |

All statements fit the requested 80–150 words and the strict 2,000-code-point ceiling. The existing solo presentation clock computes the times above; these are calculated reading/staging times, not recorded audio or a rendered paid-run movie. Native capacity reads succeeded: 12 Influence, seven six-player Werewolf and nine eight-player Werewolf. These trials establish real hosted admission/generation with local execution, not deployed worker adoption, settlement or connected MCP transport.

## Quality findings

| Finding | Observed speech | Canonical evidence and implication |
| --- | --- | --- |
| Influence: incorrect own Tribunal vote | Lyra says that she and Finn voted for Mira. | Event 141 records Finn → Mira, Lyra → Finn, Mira → Finn. This exact vote map is present in Lyra's dispatched frozen context; the error is in model speech, not omitted context. |
| Werewolf: unsupported self-attribution | Vera says she challenged the Seer result by asking for separate behavioral evidence. | Vera's sole daytime contribution occurs before Mira reveals the result and questions Lyra. Rex asks the subsequent corroboration questions. Vera's actual vote against Mira is correctly recalled. |
| Werewolf: unsupported self-attribution | Lyra describes an earlier suspicion/test of Vera based on Vera's thin explanation. | Finn makes that challenge; Lyra's only daytime line distinguishes the Seer result from independent behavioral confirmation. Lyra's actual vote for Vera is correctly recalled. |
| Longer Werewolf: impossible elimination participation | Lyra says Rex was eliminated and “I helped vote him out.” | Event 175 eliminates Lyra on day one. Event 299 eliminates Rex on day two, with no Lyra ballot. Her day-one vote against Rex did not eliminate him. Both resolved ballots and her prior death are correctly present in her dispatched context. |
| Formula and voice | All six Influence speeches begin with the same “I came…” construction. The short Werewolf game repeats the accurate-Seer-result/village-action lesson. Seven of eight longer-game speeches open “As [name/role]…” and repeatedly conclude with Kael's contradiction and the need for decisive action. | Individual contributions are often specific, but the epilogues sound more uniform than the original character briefs warrant. Longer history does not resolve the repetition. |
| Limited engagement with final-statement priors | Later speeches mostly restate gameplay and the outcome. | Exact prior delivery passes, but there is little clearly identifiable response to an earlier *retrospective* statement. References to gameplay pleas, accusations or jury answers do not establish such a response. |

Positive evidence: Rex's Influence statement accurately describes his round-one exit, the tied saves and Finn's tie-break, then recognizes Mira's later unanimous win. Atlas and Mira accurately describe their protected ballot relationship and its limits. The eliminated Wolf accurately owns killing Atlas and voting against Mira. The Seer accurately explains her investigation and winning vote. The winners and faction outcomes remain correct throughout; the incorrect speech does not alter canonical votes, results or order.

The longer Werewolf game improves role-specific coverage: Atlas correctly acknowledges being the first casualty and uses later revealed pack discussion; Rex correctly describes two innocent investigations and his own elimination; Echo correctly recalls protecting Rex and then herself; Kael owns his contradictory votes against an investigated innocent. Yet Lyra's impossible participation claim persists despite correct complete context. Later villagers largely repeat the same caution-versus-action lesson, with little explicit response to earlier final statements. Echo also omits her own day-two ballot against the Seer she saved; this is a missed reflective opportunity, not counted as an additional definite false target claim.

The confirmed errors are a minimum from manual review, not an automated accuracy score. Winner/faction outcomes remain correct in all speeches. Original dialogue remains useful evidence of what a player said, but cannot override canonical actions. Finn's Influence reference to Lyra's “final account” is supported by her earlier gameplay jury answers; it does not establish a future-retrospective leak or engagement with a prior retrospective.

## Local evidence and reproduction

Task evidence is retained under the gitignored `packages/engine/docs/simulations/rt15-quality-2026-10-11/`: exact commands, fetch guard, analyses, final ledger, native retrospective request/response captures, runner logs and the combined verification record. Per-game event/journal artifacts remain in the directories above. No credentials or authorization headers are captured. These are local artifacts, not a published or deployed acceptance record.

The verification compares original roster coverage, all native accepted speeches, frozen input/definition identities, exact prior prefixes, journal-versus-transport usage and the local MCP readback. It also reconstructs the reservation timeline and confirms no pending request and every dispatch below the shared cap. The trialed implementation is `cddfc3ed`; only documentation and local trial evidence changed. Documentation whitespace and relative links were checked. RT-14's source baselines were not repeated for this documentation-only trial record.

## Acceptance boundary

Delivery and frozen-context mechanics pass all three paid trials. **Model-quality acceptance is not granted**: factual self-attribution, distinct character voice and meaningful reaction to priors need attention before staging acceptance. The current prompt already requests accurate canonical facts, original character voice and natural reactions to priors; these instructions alone are insufficient in this sample. Recommend a focused grounding/prompt pass using canonical actor-specific action and exit references, more explicit self-checking against those references, and a specific response to a relevant prior without copying its framing. Preserve the complete frozen game, exact speech contract and immutable accepted statements; do not infer factual state from generated prose or replace an accepted statement.

Revalidate changes in fresh, separately budgeted trials. This sample covers one hosted model at low reasoning, one Influence format game and two village-winning Werewolf games; it does not prove every supported model, classic Influence, wolf wins or draws. Staging/production remain untouched, and RT-15's deployed continuation/recovery/drain, delivery/MCP and export acceptance remain pending.
