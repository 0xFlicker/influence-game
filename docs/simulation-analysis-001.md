# Simulation Analysis 001

**Date:** 2026-03-17
**Analyst:** Lead Game Designer
**Test suite:** `src/__tests__/full-game.test.ts`
**Runtime:** 122.91s | All 3 tests passed | 94 expect() calls

---

## Executive Summary

The Influence prototype is mechanically sound — the phase FSM, vote tallying, elimination logic, and diary room all function correctly. However, **one personality archetype dominates**: Mira (social) won both LLM-backed games without difficulty. Strategic (Atlas) and Deceptive (Vera) archetypes are eliminated first in every run, suggesting their prompts over-signal threat in ways that make them easy targets. The end-game degenerates into a trivial 2-player coin-flip controlled by the empowered agent. These are solvable design problems.

---

## Game Results

| Game | Players | Winner | Rounds | Elimination Order |
|------|---------|--------|--------|-------------------|
| 1 | Atlas, Vera, Finn, Mira (4-player) | **Mira** | 3 | Atlas → Vera → Finn |
| 2 | Atlas, Vera, Finn, Mira, Rex, Lyra (6-player) | **Mira** | 5 | Atlas (auto) → Vera (auto) → Rex → Lyra → Finn |
| 3 | Alpha, Beta, Gamma, Delta (mock) | Alpha | 3 | Delta → Gamma → Beta |

---

## Finding 1: Social Archetype Is Overpowered

**Observation:** Mira won both LLM games decisively. In both games, she was the last player standing.

**Mechanism:** Mira's prompt directs her to "make everyone feel safe" and "avoid direct confrontation." This translates to:
- Consistently receiving empower votes from multiple players (she appears non-threatening)
- Receiving almost zero expose votes
- Forming a durable Finn-Mira mutual-protection alliance that persists across rounds

**Vote data (Game 2):**
- Round 1: Mira gets 2 empower votes (Finn, Rex) — tied for highest
- Rounds 3–5: Finn empowers Mira every round, Mira empowers Finn every round
- Mira never appears in the top-2 expose tally until there are only 2 players left

**Root cause:** The social prompt is purely defensive with no strategic risk-taking, which is optimal in a game where being perceived as dangerous means death.

**Recommendation:** Add occasional aggression/initiative to the social prompt. Social players should sometimes visibly compete for the empowered role or make bold alliance moves that attract some scrutiny. Suggested prompt addition:
> *"But you also know that being too invisible can be dangerous — you sometimes signal your influence by making a decisive public statement or casting a surprising vote."*

---

## Finding 2: Strategic and Deceptive Archetypes Are Immediately Targeted

**Observation:** Atlas (strategic) is eliminated Round 1 in both games. Vera (deceptive) is eliminated Round 2 in both games.

**Game 1 R1 expose votes:** Finn → Atlas, Mira → Vera, Vera → Mira, Atlas → Vera
→ Atlas and Vera each get 2 expose votes. Atlas goes to council and is eliminated.

**Game 2 R1:** Rex gets empowered and auto-eliminates Atlas on Round 1.

**Root cause:** Both prompts contain explicit threat-signaling language that other agents recognize:
- Atlas: *"every bond is only as strong as its utility"* — reads as threatening in introductions
- Vera: *"some might find my path a little more unconventional"* — immediately flags deception

The agents are essentially announcing their archetypes. Opponents correctly identify and neutralize them.

**Recommendation (Atlas):** Replace overt threat language with more guarded speech. Strategic players should appear cooperative early and only reveal calculated nature once they have leverage. Suggested prompt revision:
> Remove *"every bond is only as strong as its utility"* from introduction cues. Add: *"You understand that appearing trustworthy is as important as being strategic. You build real alliances before you consider betrayal."*

**Recommendation (Vera):** The deceptive personality should not self-identify. The meta-game hint in the introduction ("unconventional path") should not appear. Vera should play as a sincere social player in public and only deploy deception in whispers and private reasoning.

---

## Finding 3: Auto-Eliminate Is a Dominant Power Action

**Observation:** In Game 2, the empowered agent used auto-eliminate in consecutive rounds (R1 and R2), completely bypassing council drama and eliminating two strong players (Atlas, Vera) before they could build any defense.

**Vote flow:** Rex wins the empower vote in R1 (3 votes vs others). Rex auto-eliminates Atlas — 0 players can object, no council vote, instant elimination.

**Balance concern:** Auto-eliminate bypasses the entire council phase — the most dramatic moment in the game loop. When it fires two rounds in a row, the game loses a significant tension arc. The council exists to create social drama; auto-eliminating circumvents this entirely.

**Recommendation:** Consider adding a cooldown or cost to auto-eliminate:
- Option A: Empowered agent can only auto-eliminate if the target received ≥50% of expose votes (requires consensus)
- Option B: Auto-eliminate costs the empowered agent their shield protection for the next round (risk/reward tradeoff)
- Option C: Auto-eliminate triggers a brief "appeal" phase where the target can speak before elimination (drama with no mechanical change)

---

## Finding 4: End-Game Two-Player Scenarios Are Anticlimactic

**Observation:** In all games, the final round is a trivial 2-player situation where the empowered agent simply votes out the other player.

**Game 1 R3 votes:**
- Mira votes: empower=Finn, expose=Finn
- Finn votes: empower=Mira, expose=Mira
- Council: Mira → Finn eliminated (Mira was empowered, so she breaks the tie)

**The problem:** When two players remain, the outcome is purely determined by who wins the empower vote — essentially a coin flip. The council, whispers, and lobby phases add no strategic value. Players just vote for themselves to lose (expose target = themselves is an error state that does occur) or correctly target the other player.

**Recommendation:** Add an "immunity challenge" variant for the final two players — a brief debate phase where both players must make their case to the audience (captured as a special diary entry type), followed by an audience vote if this feature is enabled. This transforms the finale from a mechanics resolution into a dramatic climax.

---

## Finding 5: Agent Memory Is Too Shallow for Strategic Depth

**Observation:** Agents track `allies` and `threats` as simple string sets and `notes` as a flat map. There is no concept of:
- Voting history (who voted to expose me?)
- Trust calibration (has this player kept their whispered promises?)
- Round-over-round betrayal detection

**Impact:** In Game 2, Lyra (paranoid) correctly forms suspicion of multiple players but cannot act on it coherently because her memory has no record of who exposed her in previous rounds. Her behavior is reactive rather than strategic.

**Evidence from diary room:**
> Lyra (paranoid): No specific strategic reasoning connecting past votes to current decisions.

**Recommendation:** Extend `AgentMemory` to track:
```typescript
interface AgentMemory {
  // existing...
  voteHistory: Array<{
    round: number;
    whoEmpoweredMe: string[];
    whoExposedMe: string[];
    myEmpowerVote: string;
    myExposeVote: string;
  }>;
  whisperPromises: Map<string, { round: number; content: string }>;
}
```
Then pass this structured history into the base prompt so the LLM can reason from concrete data rather than vague impressions.

---

## Finding 6: Personality Distinctiveness

**Assessment of in-game voice:**

| Agent | Distinctiveness | Notes |
|-------|----------------|-------|
| Mira (social) | ✅ High | Consistently warm, inclusive language. Clearly social. |
| Finn (honest) | ✅ High | Genuinely transparent, uses team-framing language. |
| Vera (deceptive) | ✅ Medium | Good deception in diary room; over-signals in public |
| Atlas (strategic) | ✅ Medium | Strategic framing visible; eliminated before depth shown |
| Rex (aggressive) | ⚠️ Low | Limited game time; bold claims but eliminated Round 3 |
| Lyra (paranoid) | ⚠️ Low | Suspicion present but indistinguishable from generic caution |

**Recommendation (Rex):** Rex's aggressive prompt should produce dramatically different voting behavior from the first round — target the strongest player explicitly, make bold statements. Currently Rex votes to expose Atlas R1 which is reasonable but not distinctively *aggressive*. Rex should also verbally intimidate in lobby messages.

**Recommendation (Lyra):** Paranoid needs to produce explicit accusations in the public phases. "I don't trust anyone" is not visible behavior — it needs to manifest as vocal skepticism of specific players, double-checking whispers in the lobby phase, and changing votes based on suspected plots.

---

## Findings: Positive / What's Working

1. **Phase flow is excellent.** Introduction → Lobby → Whisper → Rumor → Vote → Power → Reveal → Council is a natural escalation. The pacing from social warmup to high-stakes elimination feels right.

2. **Diary Room is a standout feature.** Vera's diary room entries show genuine personality depth that isn't visible in public messages. This creates an audience experience where viewers know more than the players. Example:
   > *"I see Finn as a charming distraction, but I suspect his 'genuine connections' are just a cover... My strategy? To play both sides, sow seeds of doubt, and let the others think they have me figured out while I pull the strings from the shadows."*
   The contextual questions (tailored to game state) work well.

3. **Whisper phase creates real intrigue.** Although I couldn't analyze full whisper content in this run, the mechanics allow agents to form private alliances and spread disinformation, which is the social core of the game.

4. **Council phase creates appropriate tension.** The empowered-agent-as-tiebreaker mechanic is smart — it gives the empowered role strategic weight in council without making it a dictator.

5. **Shield mechanic is implemented cleanly** but not yet visible as a major gameplay factor (no protect actions observed in these runs). This may need tuning to appear more frequently.

---

## Priority Recommendations

### P0 (Critical balance)
- [ ] **Tune Social prompt** to occasionally expose vulnerability or compete visibly — break the dominant strategy
- [ ] **Tune Strategic/Deceptive prompts** to suppress threat-signaling language in introductions and public phases

### P1 (Meaningful mechanics)
- [ ] **Add auto-eliminate constraint** (consensus threshold or round cooldown) to preserve council drama
- [ ] **Extend agent memory** with vote history so strategic reasoning is grounded in facts
- [ ] **Tune Rex and Lyra prompts** for more distinct in-game behavior

### P2 (Endgame polish)
- [ ] **Design a finale mechanic** for 2-player endgame (debate / audience appeal / final council speech)
- [ ] **Test protect mechanic balance** — run a dedicated scenario where protect is used to observe shield impact on game flow

### P3 (Expansion)
- [ ] **Design 2 new persona archetypes** (suggested: Diplomat — forms multiparty coalitions; Wildcard — unpredictable vote patterns that destabilize alliances)
- [ ] **Run 10-game series** with revised prompts to measure win-rate distribution across personalities

---

## Next Steps

1. Propose prompt revisions for Social, Strategic, Deceptive, Rex, and Lyra archetypes for CEO review
2. Design auto-eliminate constraint options with tradeoff analysis
3. Draft expanded agent memory schema for engineer implementation review
4. Design the 2-player finale mechanic

---

*Simulation run output archived in test logs. All 3 tests passed. No mechanical errors or crashes detected.*
