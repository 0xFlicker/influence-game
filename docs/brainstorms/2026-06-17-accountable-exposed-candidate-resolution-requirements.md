---
date: 2026-06-17
topic: accountable-exposed-candidate-resolution
---

# Accountable Exposed Candidate Resolution Requirements

## Summary

Replace exposed-candidate randomness with an accountable rule bundle. Expose votes lock the Council pair when they can; when the vote leaves ambiguity, the empowered player resolves only that ambiguity under a higher-votes-first constraint.

---

## Problem Frame

Post-vote Mingle made pressure legible, but the exposed-candidate path still has moments where the engine silently fills or tie-breaks rather than making the choice socially accountable. That weakens the drama at exactly the point where players should be able to argue, bargain, blame, or collect debt.

The desired change is not empowered free choice over the whole Council block. The exposed vote should still matter. The rule should preserve vote order first, then give the empowered player a visible choice only when the vote produces too many, too few, or shield-displaced eligible candidates.

---

## Key Decisions

- **Vote-first, choice-second.** Expose votes remain binding before empowered discretion applies.
- **One exposed receiver locks one seat.** If exactly one eligible player received expose votes, that player is locked as a Council candidate and the empowered player picks the second candidate from eligible players.
- **Exactly two exposed receivers locks the pair.** If exactly two eligible players received expose votes, the empowered player does not choose the initial Council pair.
- **More than two exposed receivers uses higher-votes-first.** The empowered player can choose only from the unresolved vote tier after higher-vote players are locked.
- **Shield replacement uses the remaining exposure bench first.** A shielded candidate is replaced from remaining eligible exposed vote receivers before all-player fallback is available.
- **Prompt clarity without behavior quotas.** Prompts explain why each player is or may be at risk, including zero-vote fallback risk, without requiring identical pleading or target-naming behavior.
- **Feature branch rollout.** There is no feature flag or experiment framework; this change ships on a feature branch and is validated through tests, staging, and simulations.

---

## Actors

- A1. **Empowered player** resolves exposed-candidate ambiguity, uses Power, and owns the social debt or backlash of discretionary choices.
- A2. **Exposed vote receiver** may be locked, selected, shielded, pulled up, or spared depending on vote count and Power fallout.
- A3. **Other live player** can become at risk through the all-player fallback when the exposure bench is too small or exhausted.
- A4. **House / producer** frames the pressure state and preserves private reasoning as producer/debug evidence.
- A5. **Viewer / maintainer** needs candidate outcomes, choice reasons, and simulation artifacts to be understandable after the fact.

---

## Requirements

**Exposure bench**

- R1. After the empowered player is resolved, the game must build an exposure bench from eligible non-empowered live players who received at least one expose vote.
- R2. The empowered player must never be eligible for the same round's Council candidate pair, even if they received raw expose votes.
- R3. Raw expose votes against the empowered player must remain available as vote pressure and ledger evidence without creating effective Council danger.
- R4. Already shielded players must not be eligible for the initial exposure bench unless current shield rules explicitly say otherwise.

**Initial Council pair resolution**

- R5. If the exposure bench has zero eligible players, the empowered player must choose both Council candidates from eligible live players.
- R6. If the exposure bench has exactly one eligible player, that exposed player must be locked as one Council candidate.
- R7. In the one-exposed case, the empowered player must choose the second Council candidate from eligible live players outside the locked candidate.
- R8. If the exposure bench has exactly two eligible players, both exposed players must become the Council pair without empowered choice.
- R9. If the exposure bench has more than two eligible players, the final pair must be selected using higher-votes-first ordering.
- R10. Higher-votes-first ordering must lock any eligible exposed player whose expose count is strictly required to fill the top two slots before empowered choice applies.
- R11. If a vote-count tier contains more eligible players than remaining Council slots, the empowered player must choose only from that tied tier.
- R12. If the top exposed tier itself has more than two eligible players, the empowered player must choose the two Council candidates from that tier.

**Power shield replacement**

- R13. If the empowered player protects a current Council candidate, that player must be removed from the candidate pair and receive the shield according to current Power rules.
- R14. Shield replacement must first draw from remaining eligible exposure-bench players who received expose votes and are not already in the pair.
- R15. Shield replacement must apply higher-votes-first ordering to the remaining exposure bench.
- R16. If the remaining exposure bench cannot fill the replacement slot, the empowered player must choose from all remaining eligible live players.
- R17. A replacement chosen through all-player fallback must be explained as fallback risk, not as if that player received expose votes.

**Empowered choice prompts and fallbacks**

- R18. The empowered player must receive a structured candidate-selection prompt whenever the initial Council pair is not fully locked by the exposure bench.
- R19. The empowered player must receive a structured pull-up prompt whenever shield replacement leaves an unresolved replacement choice.
- R20. Candidate-selection prompts must show which players are locked by vote count, which players are eligible for the current choice, and why the empowered player is choosing.
- R21. If the model returns an invalid candidate selection, the fallback must be deterministic and must preserve higher-votes-first constraints.
- R22. Fallback-applied outcomes must be marked in producer/debug records.

**Prompt and player-legibility contract**

- R23. Post-vote pressure must explain each live player's current status: empowered, locked-at-risk, selectable exposed, replacement risk, fallback risk, or not currently in the danger lane.
- R24. Current Stakes and Post-Vote Pressure prompts must explain that zero-vote players can become at risk only when the exposure bench is too small or exhausted by shielding.
- R25. Mingle and Power prompts must preserve agent agency: players may plead, bargain, redirect, flatter, threaten, stay guarded, refuse, or stay quiet when that fits their position.
- R26. Prompt copy must not imply that all players with zero expose votes are equally at risk when enough exposed vote receivers exist to resolve the candidate pair.
- R27. Prompt copy must not describe the empowered player's own raw expose votes as effective danger for that round.

**Compatibility and observability**

- R28. Existing saves and event logs without new selection metadata must remain readable.
- R29. New candidate-resolution events should include optional metadata for selection mode, locked candidates, eligible choice set, empowered picks, fallback reason, and shield replacement reason.
- R30. Projection and transcript formatting must tolerate both legacy minimal candidate-resolution payloads and new detailed payloads.
- R31. Empowered exposed-candidate selections must be emitted as private producer/debug agent turn records when an LLM choice is requested.
- R32. Shield pull-up selections must be emitted as private producer/debug agent turn records when an LLM choice is requested.
- R33. Candidate choice records must not expose hidden thinking or reasoning as player-visible transcript.

**Validation and docs**

- R34. Focused tests must cover every exposure-bench size: zero, one, exactly two, and more than two.
- R35. Focused tests must cover higher-votes-first tiers, including tied top tiers and tied second tiers.
- R36. Focused tests must cover raw expose votes against the empowered player.
- R37. Focused tests must cover shield replacement from the remaining exposure bench and all-player fallback.
- R38. Prompt tests must prove at-risk explanations distinguish vote-derived risk from fallback risk.
- R39. Simulation validation must inspect whether empowered candidate choices become visible social debt in Mingle, Power, Council, or House summaries.
- R40. Documentation that explains Vote, Mingle, Power, or post-vote pressure must be updated when the behavior changes.

---

## Key Flows

- F1. **Initial pair from one exposed receiver**
  - **Trigger:** Vote resolves with exactly one eligible exposed vote receiver.
  - **Actors:** A1, A2, A3
  - **Steps:** The exposed receiver is locked; the empowered player chooses a second eligible candidate; post-vote pressure explains both the locked seat and the discretionary fill.
  - **Outcome:** The expose vote remains binding while the second seat becomes accountable empowered choice.
  - **Covered by:** R1, R2, R5, R6, R7, R18, R20, R23, R24

- F2. **Initial pair from exactly two exposed receivers**
  - **Trigger:** Vote resolves with exactly two eligible exposed vote receivers.
  - **Actors:** A1, A2
  - **Steps:** Both exposed receivers become the Council pair; the empowered player proceeds to Power without initial candidate choice.
  - **Outcome:** The vote fully resolves the Council pair.
  - **Covered by:** R1, R2, R8, R23, R26

- F3. **Initial pair from a crowded exposure bench**
  - **Trigger:** Vote resolves with more than two eligible exposed vote receivers.
  - **Actors:** A1, A2
  - **Steps:** Higher-vote players lock first; tied unresolved slots are presented to the empowered player; invalid choices fall back deterministically.
  - **Outcome:** Only true exposed-candidate ambiguity becomes empowered choice.
  - **Covered by:** R9, R10, R11, R12, R18, R20, R21, R22

- F4. **Shield pulls up a replacement**
  - **Trigger:** The empowered player protects a current Council candidate.
  - **Actors:** A1, A2, A3
  - **Steps:** The protected candidate leaves the pair; remaining exposure-bench players are considered first; if the bench cannot fill the slot, all-player fallback opens; the replacement reason is recorded and explained.
  - **Outcome:** Shield fallout stays legible and accountable instead of silently random.
  - **Covered by:** R13, R14, R15, R16, R17, R19, R23, R24, R29, R32

- F5. **Simulation review of candidate accountability**
  - **Trigger:** A maintainer reviews a completed run after this rule ships on the feature branch.
  - **Actors:** A4, A5
  - **Steps:** The reviewer inspects candidate-resolution events, private choice records, Mingle turns, Power actions, Council outcomes, and House summaries.
  - **Outcome:** The reviewer can tell whether candidate ambiguity created social debt rather than unexplained system selection.
  - **Covered by:** R29, R31, R32, R33, R39, R40

---

## Acceptance Examples

- AE1. **Covers R5, R18, R21.**
  - **Given:** No eligible non-empowered player received an expose vote.
  - **When:** Vote resolves and candidate resolution runs.
  - **Then:** The empowered player chooses both Council candidates from eligible live players, with deterministic fallback if needed.

- AE2. **Covers R6, R7, R23, R24.**
  - **Given:** Exactly one eligible non-empowered player received expose votes.
  - **When:** Vote resolves.
  - **Then:** That exposed player is locked as one candidate, and the empowered player chooses the second candidate from eligible live players.

- AE3. **Covers R8.**
  - **Given:** Exactly two eligible non-empowered players received expose votes.
  - **When:** Vote resolves.
  - **Then:** Those two players become the Council pair without empowered initial-pair choice.

- AE4. **Covers R9, R10, R11.**
  - **Given:** Three eligible players received expose votes with counts 4, 2, and 2.
  - **When:** Candidate resolution runs.
  - **Then:** The 4-vote player is locked, and the empowered player chooses the second candidate from the two 2-vote players.

- AE5. **Covers R12.**
  - **Given:** Three eligible players are tied for the highest expose count.
  - **When:** Candidate resolution runs.
  - **Then:** The empowered player chooses two candidates from that tied top tier.

- AE6. **Covers R2, R3, R27.**
  - **Given:** The empowered player received the most raw expose votes.
  - **When:** Post-vote pressure is shown.
  - **Then:** Their raw expose pressure remains visible as a receipt, but they are not described as effectively at risk.

- AE7. **Covers R13, R14, R15.**
  - **Given:** Two candidates are set, and the empowered player shields one of them.
  - **When:** A remaining exposure-bench player exists.
  - **Then:** The replacement is drawn from the remaining exposure bench before all-player fallback is considered.

- AE8. **Covers R16, R17, R24.**
  - **Given:** A shield removes a candidate and no remaining exposure-bench player can fill the slot.
  - **When:** The replacement is selected.
  - **Then:** The empowered player chooses from remaining eligible live players, and prompts explain that the replacement is fallback risk.

- AE9. **Covers R28, R30.**
  - **Given:** An older save or simulation event has a minimal `power.candidates_resolved` payload.
  - **When:** The projection or transcript formatter reads it.
  - **Then:** It remains readable without requiring new selection metadata.

- AE10. **Covers R31, R32, R33, R39.**
  - **Given:** The empowered player made a candidate-selection or shield-pull-up choice through an LLM decision.
  - **When:** A maintainer reviews the simulation artifacts.
  - **Then:** A private producer/debug record shows the eligible set, selection, fallback status, and hidden reasoning fields without leaking them as player-visible speech.

---

## Success Criteria

- Candidate resolution has no opaque random exposed-candidate fill in the standard path.
- Expose votes still determine the pair whenever they produce exactly two eligible receivers.
- One-exposed and zero-exposed edge cases become empowered choices with clear prompt explanations.
- Shield replacement uses remaining exposed vote receivers before all-player fallback.
- Agents can explain and react to why a player is at risk, including fallback risk for zero-vote players.
- Existing saves and old simulation logs remain readable.
- A full simulation shows at least one candidate-selection or shield-replacement choice becoming social evidence in later Mingle, Power, Council, or House output.

---

## Scope Boundaries

In scope:

- Standard-round exposed-candidate resolution.
- Initial candidate choice when the exposure bench under- or over-specifies the pair.
- Shield replacement from the remaining exposure bench before all-player fallback.
- Prompt updates for Vote, post-vote Mingle, Power, Current Stakes, and Post-Vote Pressure.
- Optional event metadata and private producer/debug choice records.
- Backward compatibility for existing saves and old minimal candidate-resolution events.
- Focused tests plus at least one real simulation validation pass.

Out of scope:

- Feature flags or a general experiment framework.
- A new standalone phase between Vote and Mingle or between Mingle and Power.
- Reworking the broader post-vote Mingle loop beyond what this rule requires.
- Full redesign of Council voting or empowered Council tie-breaking.
- Making hidden reasoning, strategy packets, or producer/debug traces player-visible.
- Removing the revealed vote ledger direction.

---

## Dependencies and Assumptions

- The empowered player is known before the exposure bench is built.
- The empowered player remains immune from the same round's Council candidate pair.
- The current post-vote pressure model remains the shared prompt surface for Mingle and Power stakes.
- Existing canonical event replay should treat old candidate-resolution events as legacy-valid.
- Feature branch, staging, and simulation validation are the rollout path.

---

## Outstanding Questions

Deferred to planning:

- What exact names should the selection modes use in event metadata and private agent turn records?
- Should the one-exposed locked player be visually distinguished from the empowered-filled second candidate in viewer UI?
- Which current prompt tests should be updated versus replaced by new at-risk explanation tests?
- What simulation command and model should be the first validation pass for this branch?

---

## Sources

- `docs/ideation/2026-06-17-exposed-candidate-randomness-ideation.html`
- `docs/brainstorms/2026-06-15-post-vote-mingle-drama-requirements.md`
- `CONCEPTS.md`
- `packages/engine/src/game-state.ts`
- `packages/engine/src/post-vote-pressure.ts`
- `packages/engine/src/phases/vote.ts`
- `packages/engine/src/phases/power.ts`
- `packages/engine/src/agent.ts`
- `packages/engine/src/context-builder.ts`
- `packages/engine/src/__tests__/post-vote-pressure.test.ts`
- `docs/solutions/architecture-patterns/agent-strategy-observability-spine.md`
