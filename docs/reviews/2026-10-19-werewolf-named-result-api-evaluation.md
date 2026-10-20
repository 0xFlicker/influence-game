# Named retrospective results: localhost API evaluation

Added a canonical, named `revealedAfterGame` reference to each Werewolf retrospective speaker: winning faction and reason, winners, survivors, night/vote eliminations, and each resolved day's named tally, abstentions, voting mode and threshold. Winners and survivors are separate because dead teammates can win. This is derived from typed events and final state; dialogue never establishes an elimination or result. Existing frozen game inputs and accepted speeches remain unchanged.

The prompt asks speakers to check outcome claims against this reference, including claims in earlier final speeches. Removed the literal “I suspected then” / “I can see now” examples while retaining the distinction between knowledge during play and postgame revelations. The output remains exactly `{ speech }`; no thinking, rationale or evidence-reference fields were added.

## Full API games

Both games ran through the localhost API with six players, one wolf, a ten-day cap, low reasoning policy and the existing 8,192-token gameplay output allowance. Both finished naturally on day one, including all six retrospectives; neither was stopped early. Different casts and seeds make this a small, unpaired sample, not a controlled comparison. It does not test long-game retrospective recall.

| Game | Model | Result | Discussion speeches / passes | Provider attempts |
| --- | --- | --- | ---: | ---: |
| [sharp-lilac-ridge](http://localhost:3001/games/sharp-lilac-ridge/replay?audience=omniscient) | GPT-6 Luna | Village; Jace eliminated 4–1, Zara survived | 5 / 10 | 34 |
| [hazy-white-pine](http://localhost:3001/games/hazy-white-pine/replay?audience=omniscient) | Muse Spark 1.3 Contributor | Village; Thane eliminated 4–1, Nyx survived | 11 / 13 | 43 |

API IDs: `e53eb741-eeb6-4e02-8e77-cf9de374e185` and `e29b89b7-ee6d-42cf-8a4e-ce3da79e17f9`, respectively. Each had one complete day voting pass with five individual ballots.

## Findings

**Outcome recall improved in this sample.** All twelve final speeches are consistent with the actual winner, eliminated wolf, and surviving Seer. There is no repeat of the preceding Luna game's invented Seer elimination or nonexistent tie. Luna's Orion correctly distinguishes learning about the check after his death from knowledge available while alive. Mira correctly reports her recorded vote against Jace despite her confusing vote speech. Muse's Thane admits the fake Seer counterclaim; villagers distinguish trusting Nyx's claim from learning that she really was Seer.

**Removing examples helped the exact phrase, not all formulaic delivery.** None of the twelve speeches uses either removed example. Luna nevertheless repeats the same argument about preserving the sole claimed information source across almost every speech. Muse has more character voice, but Riven, Vera and Orion each use “Learned after…” after earlier speeches model that framing. Prior-speech imitation remains a source of repeated structure.

**Public disclosure confusion persists and spreads into retrospectives.** Muse's Vera calls Thane's public, directed counterclaim a whisper. Thane explicitly corrects her during discussion. Vera nevertheless repeats the whisper claim in her final speech, and Nyx praises that supposed whisper read afterward. All relevant dialogue was supplied with its public scope; this is a model interpretation error, not missing evidence or an actual private channel. The named outcome reference cannot settle dialogue-scope claims by itself. Vera's phrasing also blurs when her own vote commitment arose relative to the counterclaim.

**Motives and confidence are still embellished.** Atlas calls his night death evidence of fear, and Orion says an appeal “proved” Thane feared a reasoned vote. These are interpretations, not established facts. Thane's retrospective gives a more specific explanation of the Atlas kill than his saved gameplay thinking (“blind N1 kill … remove steady voice”). Neither the factual reference nor speech-only retrospectives can establish an unrecorded motive. The prompt already cautions against this; the sample shows the caution is imperfect.

**Faction guidance still helps.** Both wolves vote against the real Seer. Luna's Jace explicitly identifies removing the claimant as his wolf objective. Muse's Thane counterclaims, challenges individual voters and finally attempts to obtain abstention. He recognizes his elimination is locked once three ballots are recorded. No wolf treats protecting the Seer as a mandatory instruction.

**Passes mostly have sensible recorded reasons.** Luna's Mira contributes no daytime discussion speech and votes when Jace presents a concrete target; the other late passes avoid repeating settled evaluations. Muse's villagers pass after stating commitments or after someone else rebuts the wolf, while Thane keeps speaking because changing a vote could save him. This uneven participation is more conversational than obligatory speeches. Vera's last pass partly defers to Orion's pending answer even though Orion has already privately passed; hidden passes still leave unanswered questions that another agent may unnecessarily wait on. No pass or scheduler metadata leaked.

**Other gameplay issues remain.** Luna's Zara says revealing her innocent check prevents voting on Orion, although he is dead and ineligible. Mira's ballot targets Jace while its speech conditionally discusses voting Zara; the structured choice and saved thinking agree on Jace, but the public wording is confusing. Luna's final voters also misstate when the three-vote majority is reached. Muse's later wolf appeals partly repeat earlier claims, and his thinking undercounts how many village commitments must change. These were observed, not patched during this evaluation.

The clearest next prompt work is public-address versus private-channel clarity, cross-checking statements about living eligibility and current tally, and discouraging repetition of earlier retrospective phrasing. A named outcome summary is useful factual grounding but does not make all strategic interpretations reliable. No extra inference was purchased beyond the requested pair.

## Evidence, validation and budget

All 77 attempts completed successfully with no retries or unavailable decisions. All raw responses were exported and verified against durable object hashes and lengths. All 65 gameplay requests have the correct faction coaching. All 39 discussion decisions, including 23 passes, retain structured thinking. Native reasoning payloads were returned on four Luna and all 43 Muse responses and were preserved in full; encrypted payloads were not interpreted as readable reasoning.

All twelve retrospective requests contain the exact canonical named reference and the revised prompt, with output schemas containing only `speech`. Audits passed for hidden passes, scheduler metadata, dense speech references, legal reply IDs/schema enums, named acting identities and named legal elimination targets. The original frozen retrospective input hashes of both preceding evaluation games remain unchanged with the new derivation.

- Focused retrospective tests: 39 passed.
- Provider-free baseline: 2,739 passed, 5 skipped, 0 failed.
- PostgreSQL baseline: 2,086 passed, 0 failed.
- `bun run check` and `git diff --check`: passed.

The provider-free command was `bun run test --path-ignore-patterns='**/docs/simulations/**'`. A prior saved source snapshot otherwise gets discovered as executable tests without its fixture dependencies. Exact focused paths avoid that artifact too. This run's source snapshot uses a tar archive rather than an executable test tree. An initial test type-inference error was fixed before simulations and the final typecheck passed.

The unchanged cumulative authorization is **$30**. Conservative reservations increased from **$14.43605275** to **$15.20284545**, a batch increment of **$0.76679270**, leaving **$14.79715455**. Token-usage estimates total **$0.06796100** for this pair; they are not invoice charges and do not release conservative reservations or earlier uncertain charges. No evaluation games remain active; pre-existing suspended games were untouched.

Private artifacts are in `packages/engine/docs/simulations/v9-api-named-result-evaluation/`: API views, canonical events, provider attempts and manifests, full provider evidence, accepted decisions and thinking, readable analyses, prompt audits, ledger snapshots, CLI reports and source snapshots. Previous experiments and ledger entries were preserved. Runtime code and prompts were unchanged during the two games. The localhost worker remains available; nothing was deployed.
