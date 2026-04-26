# Rules Experiment Thesis: Post-Empower and Whisper Rooms

**Date:** 2026-04-25
**Owner:** Lead Game Designer
**Issue:** [INF-184](/INF/issues/INF-184)
**Parent:** [INF-183](/INF/issues/INF-183)
**Status:** Recommendation for first CLI simulator experiment

## Objective

The next rules experiments should make agents talk about the actual game state more often: who has power, who is exposed, what deals are being offered, which private pairings are suspicious, and why a vote should change.

The highest-leverage place to add this is immediately after empower/expose voting. The current loop jumps from voting into the empowered action with limited public pressure. That lets the empowered player resolve the round privately, especially when using `eliminate`, and it deprives the transcript of pleading, deal-making, betrayal, and investigation.

The second problem is whisper-room lock-in. Mutual room preference is strong, which is good, but in small endgames it can repeatedly pair the same two agents and starve the rest of private game talk. We should preserve scarcity while preventing the room system from becoming deterministic.

## Design Principles

- Keep the state machine simple for the first experiment. Prefer sub-steps inside existing phases over broad phase rewrites.
- Use the CLI simulator as the validation path. Web presentation is out of scope for this slice.
- Make agents respond to concrete stakes, not generic vibes.
- Add one pressure beat at a time so transcript improvements can be attributed.
- Accept a moderate token/runtime increase if it creates materially better strategic dialogue.

## Post-Empower Variants

### Variant A: Power Lobby After Vote

**Recommendation:** Test first.

After all empower/expose votes are cast, The House announces:

- empowered player
- provisional top two exposed players
- short expose score summary, optionally limited to top three

Then every alive player gets one short public message before the empowered player chooses `eliminate`, `protect`, or `pass`.

**Prompt thesis:**

```text
The votes are in. {EmpoweredName} is empowered.
The provisional council candidates are {CandidateA} and {CandidateB}.
Top expose pressure: {scoreSummary}.

You have one public message before the empowered player acts.
Make a concrete plea, offer a deal, pressure the empowered player, defend yourself,
or explain why another player is the real threat. Avoid generic social talk.
```

**Expected behavior change:**

- Candidates plead directly instead of silently waiting for power resolution.
- Allies can publicly bargain with the empowered player.
- Deceptive and strategic agents get a clear moment to redirect suspicion.
- Aggressive empowered agents face reputational pressure before auto-eliminating.
- Viewers get a readable cause-and-effect bridge between votes and elimination.

**Smallest implementation slice:**

- Add a new runner sub-step after `runVotePhase()` and before `runPowerPhase()`.
- Reuse public transcript messages with `phase: Phase.POWER` or introduce a string label in transcript metadata only if needed.
- Add one optional `IAgent` method such as `getPowerLobbyMessage(ctx, provisionalCandidates)`; mock agents can return deterministic one-line pleas.
- Do not change vote tallying, power actions, shields, or council resolution.

**Validation signals:**

- At least 70% of post-vote messages name the empowered player, a candidate, a deal, a vote, or a threat.
- Candidate messages contain explicit self-defense or counter-accusation.
- Empowered action reasoning references the public plea/deal beat in diary or action text.
- Fewer instant-feeling eliminations when `eliminate` is used.

**Cost/runtime impact:**

| Player count | Added LLM calls per standard round | Estimated token impact | Runtime impact |
|---:|---:|---:|---:|
| 6 | up to 6 | +2-4% per game | +8-15s per round |
| 10 | up to 10 | +3-5% per game | +12-25s per round |

This is affordable relative to the established cost baseline because it adds short completions and reuses existing context.

**Risks:**

- Agents may produce generic "please spare me" messages unless the prompt demands specific offers and accusations.
- Revealing provisional candidates before `protect` may confuse agents if the final candidates change after protection.
- The empowered player may still auto-eliminate, but that is acceptable if the transcript now contains public pressure before the strike.

**Mitigation:**

Call them "provisional council candidates" and explicitly state that `protect` can change the final reveal.

### Variant B: Candidate Plea After Reveal

After the empowered action resolves, The House reveals the final two council candidates. Each candidate gives one public plea, then each non-candidate may optionally give one endorsement or accusation before council voting.

**Expected behavior change:**

- Council becomes more like a trial.
- Pleas are targeted because final candidates are known.
- The phase directly improves pass/protect outcomes.

**Cost/runtime impact:**

| Player count | Added LLM calls per council round | Estimated token impact | Runtime impact |
|---:|---:|---:|---:|
| 6 | 2-6 | +1-4% per game | +6-18s per council |
| 10 | 2-10 | +1-5% per game | +8-25s per council |

**Failure mode:**

This does not help when the empowered player uses `eliminate`, because council is skipped. It improves a less common branch while leaving the dominant drama problem intact.

**Use later if:**

Variant A improves power action drama but council votes still feel under-motivated.

### Variant C: Binding Deal Window

After vote reveal, agents can make one public conditional offer:

- "If Atlas protects me, I will empower Atlas next round."
- "If Vera passes, I will vote Finn in council."
- "If Rex eliminates Lyra, I will not expose Rex next round."

The House stores these as non-enforced public promises. Later prompts summarize broken and kept deals.

**Expected behavior change:**

- Creates explicit promises that can be honored or betrayed.
- Gives honest, loyalist, deceptive, and broker-style personas sharper material.
- Produces future evidence for investigation and jury arguments.

**Cost/runtime impact:**

Similar to Variant A if implemented as one public message per alive player, plus minor prompt-growth cost in later rounds from deal summaries.

**Failure mode:**

Without structured memory, broken promises may not reliably surface later. This variant is stronger after agent memory has a durable promise ledger.

**Use later if:**

Variant A proves agents can make concrete offers, and the Founding Engineer has bandwidth to summarize public commitments in future contexts.

## Whisper-Room Variants

### Variant W1: Anti-Repeat Room Allocation

Keep the current limited-room model, but penalize repeated pairings.

Rule:

1. Mutual requests still get priority unless the same pair shared a room in the immediately previous whisper phase.
2. A repeated pair can still be assigned only if no non-repeat pairing is available.
3. In the Reckoning at four players, the previous-round pair cannot be assigned together unless every legal pairing is a repeat.

**Expected behavior change:**

- Reduces final-two style lock-in before actual final two.
- Forces dominant alliances to maintain trust in public rather than always refreshing it privately.
- Gives excluded or peripheral players more chances to enter private negotiations.
- Creates better suspicion: "Why did you request them again even though The House split you?"

**Smallest implementation slice:**

- Track previous room pairs by sorted player ID pair.
- During room allocation, sort mutual matches into non-repeat before repeat.
- Add a simulator log line when The House breaks a repeat preference.

**Cost/runtime impact:**

No additional LLM calls if room request and message count stay unchanged. Runtime impact is negligible.

**Risks:**

- Agents may feel less agency if a mutual request is denied.
- Strong alliances may become harder to sustain, which could increase chaotic voting.

**Mitigation:**

Tell agents in the room request prompt: "The House avoids repeating last round's exact room pair when possible."

### Variant W2: Commons Micro-Whisper

Keep limited rooms, but excluded players receive one short commons message visible only to other excluded players.

Rule:

- Paired room agents each send one private room message as usual.
- Excluded agents each send one commons message to the other excluded agents.
- The commons is not a full room; it is a consolation channel for players shut out of private rooms.

**Expected behavior change:**

- More players get private game talk every round.
- Excluded agents can coordinate against the room insiders.
- Exclusion remains dramatic, but no longer means total silence.

**Cost/runtime impact:**

| Alive players | Current paired-message calls | Added commons calls | Runtime impact |
|---:|---:|---:|---:|
| 6 | 4 | +2 | +4-10s |
| 8 | 6 | +2 | +4-10s |
| 5 | 2 | +3 | +6-15s |
| 4 | 2 | +2 | +4-10s |

**Failure mode:**

The commons may become a second full whisper room and weaken the punishment of exclusion. This is useful for private talk volume but less clean than W1 for solving repeated pairing.

**Use later if:**

W1 reduces lock-in but transcripts still lack enough private strategic negotiation.

## First Experiment Recommendation

Implement **Variant A: Power Lobby After Vote** first, paired with **Variant W1: Anti-Repeat Room Allocation** only if the engineering slice stays small.

If only one change can ship, choose Variant A. It attacks the board's core complaint directly: there is not enough hard gameplay talk after the game state becomes real. W1 is nearly free mechanically, but it should not distract from validating post-vote drama.

### Exact First Slice

Add a public "Power Lobby" sub-step between `VOTE` and `POWER`:

1. Run normal empower/expose vote collection.
2. Tally empowered player and provisional exposed candidates.
3. Append a House system message:
   ```text
   The vote is locked. {EmpoweredName} holds power. Provisional council pressure falls on {CandidateA} and {CandidateB}.
   ```
4. Ask each alive agent for one short public power-lobby message.
5. Continue into the existing empowered action.
6. Run existing reveal/council logic unchanged.

### CLI Validation Plan

Run two simulator batches:

| Batch | Rules | Games | Target |
|---|---|---:|---|
| Baseline | current mainline | 3 | measure current post-vote silence and auto-eliminate drama |
| Experiment A | Power Lobby after Vote | 3 | compare transcript specificity and power-action justification |

Recommended transcript scoring:

| Signal | Pass threshold |
|---|---:|
| Post-vote messages naming empowered/candidates/votes/deals | >= 70% |
| Candidate self-defense or counter-accusation present | >= 1 per round with candidates |
| Empowered diary/action references plea/deal/pressure | >= 50% of power actions |
| Auto-eliminate has preceding public pressure beat | 100% of auto-eliminates after round 1 |
| Generic social-only post-vote messages | <= 20% |

### Board Decision Needed

Approve the first CLI experiment as a simulator-only rule variant. This does not approve production game-loop changes; it approves implementing enough engine/test harness support to compare transcripts.

## Summary

The first test should not be a broad rules rewrite. Add one explicit post-vote public pressure beat, then measure whether agents produce concrete pleas, deals, accusations, and power negotiations. In parallel or immediately after, add anti-repeat whisper allocation to stop the room system from repeatedly pairing the same alliance at low player counts without increasing token cost.
