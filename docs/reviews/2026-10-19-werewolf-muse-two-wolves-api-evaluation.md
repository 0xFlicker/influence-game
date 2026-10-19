# Eight-player Muse game: localhost API evaluation

Completed one full eight-player, two-wolf game on `meta-muse:muse-spark-1.3-contributor`, using the unchanged low reasoning policy, ten-day cap and current prompts. The setup also includes a Seer, a Doctor and four villagers. No runtime code or prompts changed during this run.

[Mystery replay](http://localhost:3001/games/just-amber-wyrm/replay?audience=mystery) · [Omniscient replay](http://localhost:3001/games/just-amber-wyrm/replay?audience=omniscient)

API game: `f8d0839d-e993-4655-af72-92f04b8d33e2` (`just-amber-wyrm`). The game finished naturally after four days, followed by all eight speech-only retrospectives. There were 40 discussion speeches, 24 passes and 22 individual ballots across four daily voting rounds.

## Outcome and observations — spoilers

The village won with Rex and Finn surviving. Iris, the Seer, died on night one with an unpublished wolf result. Finn saved Thane on night two, extending the game. Day one ended with seven abstentions; Nyx was eliminated 6–1 on day two, Mira 4–1 on day three, and Echo 2–1 on day four.

| Day | Discussion speeches | Passes |
| --- | ---: | ---: |
| 1 | 13 | 18 |
| 2 | 13 | 5 |
| 3 | 9 | 0 |
| 4 | 5 | 1 |

The longer game produced useful strategic development. Players revisited earlier commitments and challenged whether the same standards applied to different suspects. Quiet players were drawn into exchanges through direct questions. Wolves agreed after two combined speech/proposal turns on both nights while both were alive. Echo then voted against doomed teammate Nyx to preserve cover; saved thinking explicitly recognizes that the majority was already secured. After the Doctor save, Echo inferred that Thane could not be protected on consecutive nights and successfully attacked him again.

The final day had a consequential reversal. Finn repeatedly announced a Rex vote, but switched to Echo when casting his ballot. His saved thinking compares possible partners of the two previously eliminated players rather than merely following the earlier commitment. Rex's final thinking uses Finn's actual ballot to reason that a wolf Finn could have eliminated Rex immediately, and votes Echo. This shows the serial voting pass supplying information that affects the final decision.

Remaining quality issues are visible. Many voting speeches imitate the same “Friends” opening and repeat nearly identical arguments. Day-one demands for future voting evidence culminate in everyone abstaining, yielding little new information. Finn's final-day opening confusingly asks Echo to explain why Echo is wrong while announcing a Rex vote. The late switch is real, but its justification remains a probabilistic social inference, not a mechanically proven partnership.

The retrospectives preserve the actual final outcome, personal votes and night actions. They acknowledge bluffing and mistaken trust, including Finn having protected Echo. Some hindsight remains loose: Finn says saving Thane “felt great” without distinguishing a known protection choice from the later confirmation of a save, then blames himself for moving protection even though repeating the target was illegal. Iris accurately describes the check resolving on her death night, but does not explicitly separate that postgame result from usable knowledge while alive. These are speech-quality limits, not missing canonical facts.

## Evidence and spend

All 113 provider attempts succeeded without retries or unavailable decisions. All 113 raw responses and native reasoning payloads were retained, with durable object hashes and lengths verified before export. All 64 discussion decisions, including passes, retain structured thinking. Encrypted native reasoning was preserved, not interpreted as readable thought.

Audits passed for all 105 gameplay requests: faction coaching, hidden passes, scheduler metadata, dense contribution references, reply schema enums, acting identities and named legal vote targets. All eight retrospective requests contain the exact canonical named reference and use an output schema containing only `speech`. None of the final speeches uses the two removed example phrases. Source hashes were unchanged throughout the run.

The cumulative $30 ledger increased from **$15.20284545** to **$15.96558755** in conservative reservations: **$0.76274210** for this game, leaving **$14.03441245**. Its token-usage estimate is $0.13622450, not an invoice charge or a release of reservations. No evaluation game remains active; existing suspended games were untouched. No additional game was launched.

Private evidence is preserved under `packages/engine/docs/simulations/v9-api-muse-two-wolves-evaluation/`, including events, API views, accepted decisions, thinking, attempts, manifests, full provider evidence, readable analysis, audit results, per-day counts, ledger snapshots, CLI reports and source snapshots. No application code changed, so the preceding passing test baseline was not rerun. The localhost worker remains available.
