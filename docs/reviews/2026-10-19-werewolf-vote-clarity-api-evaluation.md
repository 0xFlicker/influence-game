# Werewolf player cleanup, decision clarity and API evaluation

## Implemented

- Removed discussion-byte remaining/per-message text from the replay presentation and its discussion overlay. The browser was verified on a completed API game's spoken conversation. No replacement progress display was added. Agent budget awareness and canonical budget data remain available.
- Day ballots explicitly choose someone to **eliminate**, never endorse. The target schema describes the same meaning, and the instruction requires any spoken announcement to match the selected target. The acting player's ID, name, role and faction are explicit; legal elimination targets, vote order and prior canonical ballots include names beside IDs. Engine choices remain authoritative; no prose parsing or new inference call was introduced.
- Public conversation and ballot text are distinguished from private thinking and pack-only speech. Claiming a personal investigation discloses a Seer claim even without naming the role; a genuine result remains unverified to other players. Seer coaching repeats this distinction.
- Contributions can provide a previously unstated evaluation, candidate comparison, reason to trust/doubt a claim, or changed voting intention without new facts. Repetition remains a reason to pass. Asking a question does not guarantee an answer or another turn.
- Werewolf gameplay completion allowances increased from 2,000 requested tokens (Muse previously floored this to 2,048) to **8,192**, including introductions/night decisions. This allows room for native reasoning plus the structured response. Reasoning effort remained low in the paid runs. The 320-byte spoken contribution and existing thinking/cue field limits are unchanged; retrospectives retain their existing separate allowance. All feedback-informed length repairs and evidence retention remain intact.

The first revised vote prompt used preservation of a credible Seer as an example of avoiding endorsement votes. In the first Muse game, the wolf's saved thinking interpreted that as “Cannot vote Jace per instruction.” This was corrected before the final game: votes are faction-directed; wolves may eliminate genuine Seers, villagers may suspect claimants, and no claim makes a legal target immune. The final game provides direct evidence: Rex, the wolf, explicitly selected real Seer Atlas for elimination. No engine legality restriction was ever introduced. The first two games retain their original prompts as evidence.

## Full localhost API games

All games used six players, one wolf, the normal ten-day maximum, API-generated seeds/casts, sequential admission, and completed all six retrospectives. Local timed polling added no model calls. The third game verified the faction-neutral correction discovered by inspecting the first game's thinking.

| Model | Replay | Days with ballots | Discussion speeches / passes | Outcome | Reserved budget |
| --- | --- | ---: | ---: | --- | ---: |
| Muse Spark 1.3 Contributor | [lean-amber-cloud](http://localhost:3001/games/lean-amber-cloud/replay?audience=omniscient) | 2 | 18 / 2 | Village, Day 2 | $0.25120930 |
| GPT-6 Luna | [calm-khaki-lake](http://localhost:3001/games/calm-khaki-lake/replay?audience=omniscient) | 2 | 11 / 6 | Wolves, Day 2 parity | $0.71239325 |
| Muse Spark 1.3 Contributor | [lean-mint-stone](http://localhost:3001/games/lean-mint-stone/replay?audience=omniscient) | 1 | 11 / 4 | Village, Day 1 | $0.17970420 |

A day ballot is the full serial voting phase; the three games contain **22 individual ballots**. All announced targets/abstentions matched the structured choice on manual review. No player received an unavailable gameplay fallback. This is a small unpaired sample, not evidence that all identity or action consistency errors are solved.

The user authorized another $15. The original ledger was snapshotted, its cap increased from $15 to **$30**, and all 1,448 existing entries were preserved. This batch added **$1.14330675** in conservative reservations, bringing aggregate committed reservations to **$13.78732580**, with **$16.21267420 remaining**. Each new game required $4 whole-game admission headroom to accommodate the increased completion allowance. Token-usage estimates for this batch total $0.10914135; no invoice cost was supplied, and estimates did not replace reservations or release older uncertain charges. No games remain in progress.

## Evidence and quality

All **124/124 terminal provider responses** were retrieved and verified against manifest hashes and lengths. All **52 accepted discussion decisions**, including **12 passes**, retain nonempty private thinking. The actual saved inputs for **106 gameplay attempts** passed checks for hidden pass entries, scheduler metadata, speech-only reference/schema numbering, acting-player identity, elimination instructions and target descriptions. All gameplay requests carried the 8,192-token allowance. All five final-game ballot prompts contained the faction-neutral correction.

Muse retained native reasoning items on all 79 responses; Luna returned no native reasoning items on its 45 responses. Complete bodies are saved in either case. Readable structured thinking was reviewed; encrypted native content was not interpreted. Muse had no failures. Luna had four recoverable Flex 429 responses. There were no completion-length failures. The largest Muse gameplay completion was 1,945 tokens, so this batch verifies the increased allowance is sent and succeeds, but does not demonstrate a response that required more than the previous floor.

The Muse games show useful contribution without requiring new facts. In `lean-amber-cloud`, Sage changed her evaluation of Rex's argument, then changed her voting commitment after Jace's explicit Seer disclosure. Jace's thinking distinguished keeping an innocent check concealed from revealing a wolf result to secure the necessary three votes. Everyone's selected elimination target matched their speech.

`lean-mint-stone` was the strongest exchange. Atlas deliberately revealed a wolf check; Rex counterclaimed and pushed Atlas's elimination; the villagers compared claim timing and investigation-target arguments. Dax's thinking distinguished a new vote commitment from mere agreement. Dax, Atlas and Orion subsequently passed because their positions were already clear. Rex continued arguing because changing one commitment could still matter. He then voted against the real Seer, with thinking explicitly identifying that faction goal. This confirms both strategic silence and the corrected elimination semantics in a complete game.

Luna improved in the narrower areas under test: no endorsement-style elimination of a trusted claimant, no announced target/ID mismatch, and no speaker referring to themself as a separate candidate. Zara's thinking deliberately chose to reveal her check, and her later ballot thinking acknowledged that she had publicly claimed Seer; it no longer described the same disclosure as keeping her role private.

## Remaining issues

- **Paraphrase is still mistaken for contribution.** Several Luna players called slightly different versions of “the check is on a dead player, so it identifies no living suspect” distinct evaluations. The permission to evaluate existing facts is working, but its judgment of whether an evaluation changes anything remains weak. Muse also still sometimes asks for a read “to keep the exchange moving.”
- **Unsupported role possibilities still distort decisions.** After claimant Zara died, Luna players expected another check and entertained Iris as a hidden Seer despite no claim. The rules already say a Seer killed that night cannot communicate the result; this sample did not reliably apply that constraint.
- **Thinking and public explanation can disagree even with the right target.** Luna's Orion correctly reasoned that Echo already had a locked majority, but his speech claimed splitting the vote could prevent elimination. The selected vote was consistent; the causal explanation was not.
- **Retrospectives still invent or overstate facts.** Jace in the first Muse game falsely said he had voted for Mira; the canonical ballot was Vera. Other statements exaggerated what first-claim timing or night deaths prove. The retrospective is a separate prompt surface and was not rewritten by these gameplay changes.
- **First-claim credibility remains an overconfident heuristic.** The final village reached the correct result, but first-to-claim is not proof. The game remains open to wolf bluffs; the evaluation outcome should not be converted into a deterministic strategy rule.

Private reports, admission records, ledger snapshots, metrics, full thinking reviews, validation logs and browser proof are under `packages/engine/docs/simulations/v9-api-clarity-evaluation/`. Full exports remain in the shared `packages/engine/docs/simulations/v9-api-silence-evaluation/{slug}/` directory, including seed/configuration, canonical events, API thinking, accepted values, attempt metadata, manifests and complete provider evidence. Evidence reconciliation briefly delayed exports; read-only retries succeeded without repeating inference.

## Validation

- Focused initial prompt/replay regressions: 32 passed.
- Full provider-free suite: 2,732 passed, 5 skipped, 0 failed.
- Full PostgreSQL suite: 2,086 passed, 0 failed.
- After the faction-neutral wording correction: all 24 v9 tests passed, including exact prompt/schema and legal-choice checks; workspace typecheck and lint passed again.
- Browser: spoken conversation renders without the byte-budget overlay; existing Show thinking preference restored after inspection. Screenshot: `player-without-byte-counter.png` in the private evaluation directory.
- `git diff --check`: passed. No deployment or publication performed.
