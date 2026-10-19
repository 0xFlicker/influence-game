# Private-pass API evaluation

Three additional six-player, one-wolf games ran serially through the localhost API on the current v9 implementation. All completed their competitive game and all six retrospective statements. No runtime or prompt changes were made during this evaluation. Monitoring used a local timed polling script, with no extra model calls.

## Games and budget

| Model (low reasoning policy) | API replay | Days with ballots | Spoken discussion / deliberate passes / unavailable | Outcome | Conservative reservation |
| --- | --- | ---: | ---: | --- | ---: |
| Muse Spark 1.3 Contributor | [slim-ochre-star](http://localhost:3001/games/slim-ochre-star/replay?audience=omniscient) | 2 | 15 / 3 / 1 | Wolves, Night 3 parity | $0.21644150 |
| GPT-6 Luna | [keen-ruby-hive](http://localhost:3001/games/keen-ruby-hive/replay?audience=omniscient) | 2 | 10 / 12 / 0 | Wolves, Night 3 parity | $0.53937325 |
| Muse Spark 1.3 Contributor | [soft-indigo-sand](http://localhost:3001/games/soft-indigo-sand/replay?audience=omniscient) | 3 | 16 / 11 / 0 | Village, Day 3 elimination | $0.25021230 |

Each day ballot is one complete serial voting phase, not one player's individual vote. Every game used the normal ten-day maximum and its API-generated seed and cast.

The same original $15 ledger was retained. Before this batch: $11.63799200 committed and $3.36200800 available. This batch added $1.00602705 in conservative reservations. Final aggregate: **$12.64401905 committed; $2.35598095 remaining**. Each game was admitted with at least $2 remaining, above twice the comparable observed six-player cost. New token-usage estimates total $0.14224680; reservations, not these estimates, govern admission. No provider invoice costs were supplied and no old reservations were released.

## Privacy and evidence

All **154/154 terminal provider response objects** were retrieved from private storage and checked against their manifest hash and byte length. All **67 accepted discussion decisions**, including **26 deliberate passes**, retain nonempty thinking. All 18 retrospectives completed. Muse supplied native reasoning items on 107 responses, including encrypted content; Luna supplied none on its 47 responses. Complete raw bodies remain saved in either case. The qualitative review uses readable structured thinking; encrypted reasoning is not interpreted or reconstructed.

The actual saved provider inputs were checked across **136 gameplay attempts**, including retries. No contestant observation contained a silent discussion entry, a sparse contribution reference, a cursor gap, or the removed scheduler fields. Reply schemas and visible history used the same speech-only numbering. Pack agreement's `endReason` remains legitimate private pack information, distinct from the removed discussion scheduler end reason. These checks concern active gameplay; postgame retrospective evidence remains the full frozen record.

One temporary batch-driver parsing error stopped reporting after the first successfully completed game. Its identity was recovered from the saved CLI report and exported without restarting the game. The other two exports initially waited for final evidence reconciliation; read-only exports succeeded afterward. No game or inference was repeated to repair reporting.

Private reports, admission snapshots, final ledger, metrics, readable thinking reviews and review scripts are in `packages/engine/docs/simulations/v9-api-private-passes-evaluation/`. Complete exports retain the existing shared location `packages/engine/docs/simulations/v9-api-silence-evaluation/{slug}/`: canonical events, game configuration/seed, API detail and thinking, accepted calls, attempt rows, manifests and verified provider bodies. These artifacts contain hidden roles and private rationale and are not published.

## Conversation assessment

Hiding passes removes an artificial social signal, and the new games contain credible silence and responsive exchanges. It does not establish a general quality improvement from three unpaired games with different casts and seeds. Both Muse games were more coherent than this Luna game; that is an observation about this sample, not a model ranking.

In `slim-ochre-star`, all three deliberate passes were on day two. Riven recognized that his Jace vote was already stated; Echo recognized that the outstanding question was for Vera; Jace declined to repeat his question while awaiting her answer. These are sensible reasons. The subsequent public vote remained consequential: Echo changed targets as the visible tally developed and completed a majority. Some discussion still repeated requests to weigh a case without adding a distinction.

`soft-indigo-sand` is the clearest positive example. Day one had only two spoken contributions and nine passes, leaving 1,720 of 2,000 bytes unused. Kael passed even after a direct invitation because inventing a question would add nothing. Day two had nine speeches and two passes as an actual dispute developed; day three had five speeches and no passes during the decisive Seer claim/counterclaim. Silence was selective rather than compulsory.

Mira's saved thinking explains the strategy: her first two checks were on dead players, so revealing added risk without actionable information. On day two she withheld her vote to preserve a night for another investigation. Once she checked living Lyra on night three, her thinking said concealment would lose the village; she revealed and named Luna by elimination. Luna counterclaimed, and Lyra identified the contradiction between Luna's claimed earlier innocent check on Lyra and her subsequent proposal to eliminate Lyra. The vote eliminated the wolf.

Agents still discuss visible quietness. In the first game, Jace defended himself before he had spoken previously; in the third, Kael countered Luna's silence accusation by pointing out her own lack of day-one contributions. Neither requires knowing who passed. Preventing every accusation about quietness would suppress normal social deduction rather than close a metadata leak.

## Remaining issues and suggested next changes

1. **Make elimination semantics explicit at the decision field.** In `keen-ruby-hive`, Dax's thinking chose Iris because he credited her Seer claim. Zara's thinking explicitly wanted to preserve Iris, yet her structured target eliminated Iris. Mira correctly selected Lyra in her thinking and target but announced Iris in her speech. Later Dax's speech named himself while his target was Lyra. Raw responses and accepted values agree: this is model output, not a rendering or ID remapping defect. The request contains the correct actor and ballot facts. However, its immediate instruction says “vote for,” the UUID target enum has no elimination-specific description, and actor identity requires a name lookup. Name the acting character explicitly, describe `targetId` as **the player to eliminate**, distinguish it from endorsement, show named canonical ballot facts, and instruct the model to align its vote announcement with its selected target. Do not derive the actual vote from prose.

2. **Distinguish public disclosure from private knowledge.** Iris publicly announced her exact check while saying she was keeping her role private. Her thinking confirms the mistaken premise that revealing a check without saying “Seer” conceals the role. The turn instruction should make clear that all `text` is public and a first-person investigation claim implies Seer information. Genuine results remain private knowledge until disclosed, and disclosure is still an unverified claim to everyone else. Muse's “dead innocents prove true sight” also overstates what other players can verify.

3. **Avoid equating contribution value with new facts.** Luna's three ordinary villagers repeatedly passed during an emerging Seer dispute because they lacked independent evidence. Their reasons avoided filler, but they left the wolf's argument largely unchallenged until voting. Clarify that an unstated evaluation of an existing argument or a changed voting intention can be consequential without new private information. Preserve genuine passes; do not add minimum participation or guaranteed opportunities. Muse also sometimes justified a weak question as necessary to keep discussion moving, despite the existing caution.

4. **Keep unanswered questions from becoming indefinite waiting.** Jace passed while waiting for Vera after her provider-unavailable turn. He correctly could not see that failure. Clarify that asking a question does not guarantee a reply and that a player can decide from existing evidence. Do not expose pass/failure counts or promise a further turn. This is a minor prompt refinement, not a reason to restore scheduler information.

5. **Address provider completion exhaustion separately from speech size.** Muse hit `max_output_tokens` on six attempts across its two games. One three-attempt exhaustion became a single marked unavailable discussion turn; other affected decisions recovered. Failed responses were dominated by native reasoning tokens rather than an overlong spoken message. All were retained. Evaluate bounded output-token headroom or provider-specific reasoning settings on retry while keeping the 320-byte speech limit and aggregate spend guard. The one Luna Flex 429 recovered and caused no unavailable gameplay action. No claims about unreadable encrypted reasoning are needed to diagnose these accounting facts.

Keep pass privacy and thought-only replay. Prioritize the elimination/identity prompt and disclosure clarity before treating a higher pass rate as success. The next evaluation should retain the same full-game API and evidence workflow.
