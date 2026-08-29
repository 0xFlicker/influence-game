# R22 — House-selected alliance proposer opportunities

## Verdict

One current-meta, 12-player API-backed candidate game completed through the durable API lifecycle. Across its eight successful alliance-action windows, House selection reduced the normalized alliance opportunity path from the baseline's 206 provider calls to 97 calls (52.9% fewer), from 2,167,304 tokens to 804,239 (62.9% fewer), and from a rounded estimated $0.27 to $0.103434 (about 62% lower). The candidate still produced 9 canonically activated alliances and 15 structured huddle outcomes. This is one-game runtime and watchability evidence, not causal or population-wide proof.

The quality verdict does not use alliance compliance. It asks whether the surviving huddles retained concrete, decision-relevant structured outcomes and whether canonical alliance formation continued through the existing transaction.

## Method and privacy boundary

- Baseline: production game [`used-lilac-ash`](https://thehouse.game/games/used-lilac-ash), completed 2026-08-18, with 12 players, eight alliance windows, OpenAI GPT-5.6 Luna, and Flex service tier.
- Candidate: one private local API-backed game started 2026-08-20 at 00:39 UTC and completed at 01:04 UTC, with 12 players, eight alliance windows, current `openai:gpt-5.6-luna` action policy, Flex service tier, fast pacing, speedrun enabled, and the current six-format manifest.
- Calls and candidate spend came from producer-scoped provider spend records. Candidate action classification came from audited producer trace reads; the committed report retains only aggregates.
- Baseline alliance-action spend is the rounded Admin Cost Detail estimate recorded before the run. Candidate costs are `static_estimate` values, not provider invoices. Cost comparisons therefore use estimates and should not be read as reconciled billing.
- Alliance counts and huddle outcomes came from canonical events and the public alliance projection. Transcript prose was not parsed into authoritative facts.
- This report excludes player names, raw turns, prompts, responses, House rationale or cognition, member-only huddle content, credentials, and private trace or manifest pointers.
- Paid use was limited to this one candidate game. No replacement game was created.

## Alliance opportunity cadence

The candidate made one successful House selection per alliance window and finalized exactly `ceil(alive / 4)` proposer opportunities. The only extra calls came from the same-game recovery described below.

| Round | Alive | Budget | House selections | Proposer opportunities | Invitee responses | Counters within responses |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 12 | 3 | 1 | 3 | 12 | 0 |
| 2 | 11 | 3 | 1 | 3 | 8 | 0 |
| 3 | 10 | 3 | 1 | 3 | 10 | 2 |
| 4 | 9 | 3 | 1 | 3 | 11 | 0 |
| 5 | 8 | 2 | 1 | 2 | 8 | 1 |
| 6 | 7 | 2 | 2 (1 interrupted attempt) | 4 (2 interrupted) | 12 (4 interrupted) | 3 |
| 7 | 6 | 2 | 1 | 2 | 8 | 2 |
| 8 | 5 | 2 | 1 | 2 | 4 | 0 |
| **Raw total** |  |  | **9** | **22** | **73** | **8** |
| **Successful-window total** |  |  | **8** | **20** | **69** | **8** |

The 20 successful proposer calls exactly equal the sum of the eight ceiling budgets. Those agents chose 10 proposals, 9 amendments, and 1 pass. Invitees independently chose 56 accepts, 5 declines, and 8 counters. Counter calls are response calls, not an additional provider-call category.

## Calls and spend

The normalized candidate row removes one interrupted round-6 House selection plus 6 alliance-action calls that had no accepted canonical consequence. The raw row preserves their paid cost.

| Evidence | House selection calls | Alliance-action calls | Combined calls | Combined tokens | Estimated cost | Calls / window | Cost / window |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 0 | 206 | 206 | 2,167,304 | $0.27 (rounded) | 25.750 | about $0.034 |
| Candidate, raw paid use | 9 | 95 | 104 | 860,663 | $0.110366 | 13.000 | $0.013796 |
| Candidate, successful windows | 8 | 89 | 97 | 804,239 | $0.103434 | 12.125 | $0.012929 |

Against the baseline, the normalized candidate used 52.9% fewer calls, 62.9% fewer tokens, and about 62% lower estimated spend. Including the recovery overhead, it still used 49.5% fewer calls, 60.3% fewer tokens, and about 59% lower estimated spend.

The raw candidate House selections accounted for 9 calls, 6,874 tokens, and $0.001695. Successful-window selections accounted for 8 calls, 6,173 tokens, and $0.001521. Raw alliance actions accounted for 95 calls, 853,789 tokens, and $0.108671; the normalized successful-window path accounted for 89 calls, 798,066 tokens, and $0.101913.

For whole-game context only, the baseline recorded 1,056 calls, 9,775,268 tokens, and $2.541425 estimated spend. The candidate recorded 959 calls, 7,172,217 tokens, and $0.956268 estimated spend. Whole-game totals are not an isolated R22 effect and are not used for the verdict.

## Canonical alliance and huddle outcomes

| Canonical/projection metric | Baseline | Candidate |
| --- | ---: | ---: |
| Proposals submitted | 44 | 19 |
| Alliances ever activated | 21 | 9 |
| Final active alliances | 0 | 0 |
| Final closed / archived | 3 / 18 | 2 / 7 |
| Recorded huddle outcomes | 17 | 15 |
| Alliances with at least one outcome | 10 | 8 |

All 15 candidate outcomes contained at least one primary canonical commitment fact. Under the limited usefulness rubric used here, all 15 had a proposed action, a member commitment, a contingency, and fact-level dissent; 13 named a specific target and 12 supplied an alternative plan. Across the outcomes, the engine recorded 64 primary commitment facts. This establishes concrete structured coordination rather than merely non-empty House summary prose. It does not score truth, agreement, obedience, or alliance compliance.

The baseline public projection exposed compact outcome summaries but not the primary commitment facts needed for the same rubric. Its 17 outcomes all had non-empty plan, ask, promises, confidence, and posture; 12 carried dissent and 2 carried a leak-or-betrayal claim. Those baseline numbers are reported as field presence only, not as a directly comparable usefulness score. Three candidate outcomes carried a structured leak-or-betrayal claim.

Candidate outcome distribution by activated alliance was: one alliance with no recorded outcome, five with one, one with two, and two with four. The House huddle gate remained independent and was not changed by R22, so dormant or uninteresting alliances could still remain unhuddled.

## Interrupted attempt

The same candidate had one interrupted round-6 attempt before later completing through the repository's fail-closed recovery path. No replacement game was created. Its 1 extra House selection and 6 extra alliance-action calls remain in the raw paid totals above; the successful-window row removes them only for steady-state comparison. Recovery implementation is outside R22 and its operational diagnosis belongs in the dependent PR report, not this aggregate export.

## Interpretation and limits

- Runtime proof: one House call governed each successful alliance window; the exact ceiling budget produced only selected proposer calls; unselected invitee responses and counters continued; existing canonical proposal, response, activation, amendment, archive, close, huddle, and outcome events completed through the API path.
- Automated proof: deterministic tests cover cast-size budgets, malformed-plan eligibility and repair, active-alliance underrepresentation, producer rationale, House failure, post-call owner fencing, selected-only access, unselected invitee consent, and unchanged transaction behavior.
- The candidate formed fewer alliances while retaining nearly as many structured huddle outcomes, but one game cannot establish causality, optimal alliance count, or long-run strategy quality.
- The baseline and candidate used the same provider/model family and Flex tier, but differed in exact runtime policy and game trajectory. Baseline cost is a rounded Admin display estimate; candidate cost is an unreconciled static estimate.
- The interrupted attempt makes the raw row the honest paid-use total; the normalized row is only a steady-state eight-window comparison.
