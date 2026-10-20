# Faction guidance and retrospective hindsight: localhost API evaluation

Two complete six-player, one-wolf games ran sequentially through the localhost API after restarting the development worker with the latest faction coaching and retrospective perspective. Both used low reasoning, the normal ten-day cap, 8,192-token gameplay completion allowances, and the existing separate retrospective allowance. No game was artificially stopped at its first day. Each completed all six final speeches. This is a small, unpaired sample with different casts and seeds, not a controlled estimate of improvement.

| Game | Model | Days with a public voting pass | Outcome | Discussion speeches / passes |
| --- | --- | ---: | --- | ---: |
| [warm-olive-core](http://localhost:3001/games/warm-olive-core/replay?audience=omniscient) | GPT-6 Luna | 1 | Village; Atlas eliminated 4–1 | 7 / 0 |
| [mad-ruby-silver](http://localhost:3001/games/mad-ruby-silver/replay?audience=omniscient) | Muse Spark 1.3 Contributor | 2 | Village; everyone abstained day one, Finn eliminated 3–1 day two | 12 / 6 |

API IDs: `8bbd4114-3a59-4eac-91fd-81f9b30ff0cf` and `9304a223-a1bd-424d-a021-165accb3927d` respectively. Each day has one voting pass; each living player casts a ballot in that pass.

## Faction guidance

Both wolves voted to eliminate the actual Seer. No wolf treated preserving a Seer as a binding objective.

Luna's Atlas recorded: “Voting the genuine Seer is best for wolves.” The same thinking briefly questioned whether Rex was targetable, then correctly checked that he was legal. Atlas tried to undermine the claim and voted Rex; he did not endorse a village objective. The villagers treated Rex's claim as actionable but unverified, while Rex distinguished his certain private result from what others could verify. Every explicit vote announcement matched its canonical target.

Muse's Finn understood that day-one abstention benefited the wolves. On day two he first tried to steer Iris toward Vera, then counterclaimed Seer when three players committed against him. His vote thinking explicitly sought a 2–2 split to prevent elimination and reach another night: “I am lone wolf … Real seer Orion threatens me.” He selected Orion. This is useful evidence of faction-directed play, although he lost.

The Muse Seer concealed an innocent check on day one and revealed both dated innocent results on day two, narrowing his own uncertainty to Finn or Vera. Villagers evaluated the late counterclaim against Finn having withheld an alleged night-one wolf result through day-one abstention. That is more concrete than merely rewarding whoever claims first.

## Retrospective improvement and limits

The then/now distinction is clearer. Luna's Dax said he could not independently verify Rex during play and called his vote a reasoned bet; Rex explained that the result was certain to him while the village had only his word. Muse's Finn openly identified his Seer claim as fake after the game. Orion correctly described knowing two innocents while remaining uncertain between Finn and Vera. The inspected statements did not invent an explicit personal ballot target contrary to the new reference.

Factual accuracy is still unreliable:

- **False final result and repetition:** Echo's first Luna retrospective falsely says the village eliminated its Seer and refers to a nonexistent tie. Actual results were four votes against wolf Atlas, one against Seer Rex, with Rex surviving. Echo had no earlier final statement to copy. Atlas then received Echo's speech and repeated the false Seer-elimination claim, despite also correctly saying four players voted against himself. The source account contains the correct outcome and ballots; this was not missing simulation data. Later speeches recovered the correct vote account, while some still exaggerated how close the village came to losing.
- **Chronology is reconstructed incorrectly:** Muse's Finn accused Vera of attacking Orion “once he claimed,” although Vera's initial accusation preceded the Seer reveal. Vera then made a new conditional argument. Orion and Iris criticized Finn as though he had misrepresented that later argument, which had not yet occurred when Finn spoke. Iris repeated this interpretation in her retrospective. Saved thinking supports a deliberate attempt to redirect suspicion, but does not establish that the precise chronological error was intentional rather than a model mistake.
- **Motives become facts:** Muse speakers confidently attributed night kills to fear or hidden knowledge. Some had a disclosed pack explanation for Nyx's death; claims such as Cyrus “knowing too much” went beyond the factual reference. An opponent's account and a plausible motive remain different from a verified cause.
- **Formulaic language:** Ten of twelve speeches reused “I can see now.” The prompt's example wording is appearing as a template rather than consistently producing natural reflection.

The new reference helps with personal action recall and knowledge boundaries. It does not by itself make the full game outcome, temporal arguments, or explanations of other players' motives reliable.

## Discussion and passing

Muse's Iris passed twice because the exchange was circular and she had no substantive answer; Orion passed to keep an innocent result concealed. These are sensible reasons. Finn and Vera also passed because they believed speaking would interrupt Iris's pending answer, even though Iris had already privately passed. Their prompts correctly hid the pass and scheduler state. A private pass leaves an unanswered public question, and agents still sometimes treat that as an obligation to wait. No pass information leaked to opponents.

Luna used its day allowance on seven spoken contributions, including several generic statements about what would count as evidence. Muse had more distinct character voices and a sharper day-two dispute. Neither result establishes that the conversation problem is solved.

## Recommended next changes, not implemented in this evaluation

1. Add a compact, named final-result and day-elimination reference alongside the speaker's own actions: who was eliminated, who survived, the tally, and the winning faction. The existing complete account is correct but its outcome references still require resolving IDs.
2. Ask speakers to check any earlier retrospective claim against that reference before agreeing with it. Preserve spontaneous disagreement and character voice.
3. Remove literal “then/now” example phrases while retaining the knowledge distinction. Ask for the distinction when relevant, not a recurring verbal formula.
4. Clarify that an unanswered question need not delay the speaker's own opportunity, without revealing whether anyone passed. Continue monitoring chronological mistakes separately from successful target selection.

## Evidence and spend

All 69 terminal attempts have complete raw responses exported after hash and length verification; no provider retries, unavailable decisions, or evidence loss occurred. Export of the first game waited for durable evidence reconciliation before the second game was admitted. All 57 gameplay prompts received the correct role coaching and passed the hidden-pass/scheduler/reference audit. All 12 retrospective prompts included the exact canonical personal reference and the revised knowledge guidance. Their output schema remained exactly `{ speech }`, without private-thinking or rationale fields.

All 25 discussion decisions, including six passes, retain structured thinking. Muse returned native reasoning payloads on all 43 responses; Luna returned none on its 26 responses. Complete response bodies remain saved in both cases. Encrypted native payloads were preserved, not interpreted. Retrospective analysis uses the shareable speech, not a new thinking field.

The unchanged cumulative authorization is $30. Conservative committed reservations increased from **$13.78732580** to **$14.43605275**, a batch increment of **$0.64872695**, leaving **$15.56394725**. The batch token-usage estimate is $0.06100845; it is not an invoice charge and does not replace conservative reservations or release earlier uncertain charges. No test games remain active; pre-existing suspended games were untouched.

Private evidence is under `packages/engine/docs/simulations/v9-api-perspective-evaluation/`: per-game events, API views, accepted values, thinking, attempts, manifests, full provider evidence, prompt audits, readable analysis, ledger snapshots, admission/completion records, CLI reports, and source snapshots. Neither old game artifacts nor prior ledger entries were overwritten. Runtime code and prompts were not changed during these games.
