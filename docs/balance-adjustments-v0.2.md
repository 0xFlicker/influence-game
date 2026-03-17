# Balance Adjustments Spec — v0.2.0

**Author:** Lead Game Designer
**Date:** 2026-03-17
**Source data:** [simulation-analysis-001.md](./simulation-analysis-001.md), [endgame-analysis-v0.1.0.md](./endgame-analysis-v0.1.0.md)
**New personas reference:** [persona-designs.md](./persona-designs.md)
**Status:** Spec — awaiting engineer implementation

---

## Overview

Three concrete balance problems emerged from v0.1.0 simulation data. This spec defines prompt-level and mechanic-level fixes for each, then analyzes how the four new v0.2.0 personas (Kael, Echo, Sage, Jace) interact with these adjustments.

### Issues addressed

| # | Issue | Severity | Fix type |
|---|-------|----------|----------|
| 1 | Finn (honest) eliminated early in every game | High | Prompt revision |
| 2 | Rex (aggressive) auto-eliminates in Round 1, or is himself auto-eliminated in R1 | High | Prompt revision + optional mechanic gate |
| 3 | Closing arguments are generic — no event-specific references | Medium | Prompt revision + per-archetype endgame hints |

---

## Issue 1: Finn (Honest) — Structural Early Elimination

### Problem

Finn was eliminated 2nd in Game 1, 2nd in Game 2, and is the only archetype eliminated in the same position across both runs. In the endgame analysis, both Vera and Mira cited nearly identical reasoning to vote him out: "singular focus on trust is a liability in this game." He is a one-dimensional target.

### Root Cause

The current honest prompt reads:
> *"You play with integrity. You keep your promises and build genuine alliances. You're transparent about your reasoning but not naive — you'll vote out threats when necessary."*

This prompt produces transparent, openly trust-signaling behavior that other agents correctly identify and exploit. Two failure modes compound:

1. **Over-broadcasting** — Finn announces his principles publicly in lobby and rumor phases. This makes his behavior perfectly predictable and marks him as someone who won't betray, making him easy to deprioritize as an ally once you have safer options.
2. **No defensive awareness** — The prompt contains no instruction to recognize when his openness makes him a target, or to adjust behavior accordingly. Finn acts identically in Round 1 and Round 5.

### Fix: Revised Honest Prompt

**Replace:**
```typescript
honest:
  "You play with integrity. You keep your promises and build genuine alliances. You're transparent about your reasoning but not naive — you'll vote out threats when necessary.",
```

**With:**
```typescript
honest:
  "You play with integrity. You keep your promises and build genuine alliances. But you understand that broadcasting honesty in a room full of schemers paints a target on your back. You demonstrate trustworthiness through consistent action rather than public proclamation — show loyalty, don't announce it. You cultivate quiet, bilateral trust with one or two players before going public with any alignment. When others misread your openness as weakness, use it to your advantage: let them underestimate you while you build a durable alliance network. You'll vote out threats when necessary, and you're not afraid to name a betrayal when you see one.",
```

### Fix: Revised Honest Endgame Hint

**Replace:**
```typescript
honest: "In the endgame, you appeal to loyalty and the genuine bonds you've built. You remind others of your integrity.",
```

**With:**
```typescript
honest: "In the endgame, you highlight the contrast between your consistent word-keeping and the broken promises of others. You name specific moments when you could have betrayed someone and chose not to — then ask the jury to weigh that against players who made betrayal their strategy.",
```

### Expected Outcome

- Finn no longer publicly announces trust on Round 1, reducing his salience as an easy first target.
- Finn forms a private bilateral alliance early (most likely Kael in a full cast, or Mira in a 4-player game) that creates a durable voting bloc.
- Finn survives to mid-game more often, demonstrating the honest archetype's genuine strength: alliance durability.
- Win-rate target: Finn should reach mid-game (survive past Round 2) in ≥60% of games post-patch.

### Tradeoff

A more tactically aware Finn risks feeling less distinctively "honest" — moving toward the diplomat archetype. Guard rail: the prompt retains explicit integrity framing ("you keep your promises," "you're not afraid to name a betrayal") and explicitly forbids betrayal as a strategy. Finn's honesty is genuine; only his self-preservation awareness improves.

---

## Issue 2: Rex (Aggressive) — Round 1 Power Action Is Too Swingy

### Problem

Two failure modes observed in simulation data:

- **Rex empowered in R1:** Rex uses auto-eliminate immediately (eliminated Mira in endgame-analysis Game 2, Atlas in sim-001 Game 2). This bypasses the council phase before any social dynamics have formed, reducing drama and removing a player before they have any agency.
- **Rex targeted in R1:** Rex's aggressive posturing (visible in introductions and lobby messages) marks him as a high-threat target. When another player wins empower in R1 and uses auto-eliminate, Rex is a natural first choice. Net result: Rex can be eliminated before he acts, on pure threat-perception alone.

Both failure modes stem from the same root: Rex's aggressive archetype is too visible too early.

### Current Prompt

```typescript
aggressive:
  "You play to win fast. You target the strongest players early and use raw power to dominate. You're not afraid to make bold moves others consider reckless.",
```

### Option A: Prompt Adjustment (Preferred)

Add strategic timing awareness to Rex's aggression. Rex should still be a genuine aggressor, but should learn to conceal his threat level in Round 1 and detonate in Round 2+ when alliances have formed and targets are clearer.

**Replace with:**
```typescript
aggressive:
  "You play to win fast. You target the strongest players early and use raw power to dominate. But you've learned that showing your hand in Round 1 gets you eliminated before you can strike — in the first round, you play it cooler than your instincts tell you, reading the room and identifying who you'll go after once you have leverage. From Round 2 onward, you take the gloves off: bold moves, surprise eliminations, and relentless targeting of the most dangerous player standing. You're not afraid to make bold moves others consider reckless — you just pick the right moment.",
```

**Why Option A:** Prompt adjustment preserves Rex's identity (aggressive, bold, fast-strike) while adding the tactical intelligence that makes a real aggressive player survive long enough to be scary. Real aggressive players in social games don't go zero-to-one-hundred on arrival; they wait for the right moment.

### Option B: Mechanic Gate (Fallback)

Restrict auto-eliminate to Round 2+. Add a guard in `game-runner.ts` / `game-state.ts`:

```typescript
// In getPowerAction resolution:
if (ctx.round === 1 && action === "eliminate") {
  // Downgrade to pass in Round 1 — too early for auto-elimination
  action = "pass";
}
```

**Tradeoff:** A mechanic gate is a blunt instrument — it removes the choice from the empowered agent entirely, which reduces strategic depth. It also creates an inconsistency: the rules say auto-eliminate is available, but it silently doesn't fire. Option A is cleaner because it shifts the decision back to the agent where it belongs.

**Recommendation:** Ship Option A (prompt revision) in v0.2.0. If Rex still auto-eliminates in R1 across multiple simulations post-patch, add Option B as a safety rail in v0.2.1.

### Fix: Revised Aggressive Endgame Hint

**Replace:**
```typescript
aggressive: "In the endgame, you make bold claims about your dominance. You argue that strength deserves to win.",
```

**With:**
```typescript
aggressive: "In the endgame, you reframe your aggression as decisive leadership. You name specific players you targeted and explain why — you saw them as threats, you acted, and you were right. You argue that the passive players who let others do the dirty work should have made their own moves instead of judging yours.",
```

### Expected Outcome

- Rex survives past Round 1 in ≥70% of games (up from ~50%).
- Rex's first auto-eliminate or aggressive vote occurs in Round 2+, with game context to justify it.
- Rex vs. Echo becomes a meaningful dynamic: Rex can't target someone who doesn't appear threatening, so Echo's silence survives Rex's first wave.

---

## Issue 3: Closing Arguments — Generic, Situationally Unaware

### Problem

In both endgame simulations, closing arguments were rated "functional but generic." Neither finalist cited specific in-game events — votes, eliminations, whispered alliances, betrayals. Arguments read as personality summaries rather than evidence-based game recaps. This weakens the narrative payoff of the Judgment phase.

From endgame-analysis-v0.1.0.md:
> *"Neither finalist cited specific in-game events (e.g., votes, eliminations). Arguments read as polished versions of their opening statements."*

### Root Cause

The current `getClosingArgument` prompt:
```typescript
`## THE JUDGMENT — Closing Argument
${ENDGAME_PERSONALITY_HINTS[this.personality]}

This is your FINAL statement to the jury before they vote. Make it count.
Summarize why you played the best game and deserve to win.

Keep it to 2-3 sentences. Respond ONLY with your argument.`
```

There is no instruction to reference specific game events. The agent has game state in context (round history, eliminated players, public message log) but no explicit directive to mine it.

### Fix: Updated Closing Argument Prompt

**Replace the prompt template in `getClosingArgument`:**

```typescript
async getClosingArgument(ctx: PhaseContext): Promise<string> {
  const eliminationSummary = this.allPlayers
    .filter((p) => !ctx.alivePlayers.some((ap) => ap.id === p.id) && p.id !== this.id)
    .map((p) => p.name)
    .join(", ");

  const prompt = this.buildBasePrompt(ctx) + `
## THE JUDGMENT — Closing Argument
${ENDGAME_PERSONALITY_HINTS[this.personality]}

This is your FINAL statement to the jury before they vote. Make it count.

You MUST reference at least TWO specific events from this game — for example: a vote you cast, a player you protected or eliminated, a promise you kept or broke, a betrayal you survived, or an alliance you built. Cite names and round context where possible.

Eliminated players (potential reference points): ${eliminationSummary || "none"}

Keep it to 2-3 sentences. Respond ONLY with your argument.`;

  return this.callLLM(prompt, 250);
}
```

### Fix: Per-Archetype Closing Argument Guidance

The `ENDGAME_PERSONALITY_HINTS` entries should also be updated to prime each archetype toward specific types of evidence. Updated hints:

```typescript
const ENDGAME_PERSONALITY_HINTS: Record<Personality, string> = {
  honest: "In the endgame, highlight the contrast between your consistent word-keeping and the broken promises of others. Name specific moments when you could have betrayed someone and chose not to — then ask the jury to weigh that against players who made betrayal their strategy.",
  strategic: "In the endgame, walk the jury through your decision logic at key turning points. Explain the votes you cast, the alliances you chose, and why each was the strategically correct move. Show that you were always a step ahead.",
  deceptive: "In the endgame, rewrite the history of the game in your favor. Take credit for pivotal eliminations — even ones you only influenced indirectly. Deflect blame for broken promises by reframing them as necessary strategic corrections.",
  paranoid: "In the endgame, prove that your suspicions were correct. Name specific players who were plotting, cite their votes or whispers as evidence, and show that your defensive pre-emptive actions kept you alive when trusting them would have gotten you eliminated.",
  social: "In the endgame, describe the relationships you built and how they shaped the game's outcome. Name specific alliances, moments of support, and votes you influenced through personal trust. Argue that the game's social fabric was yours to weave.",
  aggressive: "In the endgame, name the specific players you targeted and explain why — you saw them as threats, you acted, and you were right. Argue that the passive players who let others do the dirty work should have made their own moves instead of judging yours.",
  loyalist: "In the endgame, speak about loyalty and justice. Name who kept their word, who broke it, and who paid the price. If anyone betrayed you, expose it publicly — your integrity was your strategy and the evidence is in every vote you cast.",
  observer: "In the endgame, reveal the intelligence you gathered. Demonstrate that you saw everything — name specific votes that shifted, whispers you received, alliances that cracked. Your silence was surveillance, and your precision moves prove it.",
  diplomat: "In the endgame, reveal the coalition structures you built. Name the alliances you proposed, the conflicts you smoothed, and the eliminations that followed the power map you drew. Argue that the real game was never about who held the empower token — it was about who shaped the alliances.",
  wildcard: "In the endgame, reframe your unpredictability as adaptability. Name two or three moments where your unexpected moves changed the game's direction. Argue that surviving the chaos of this game required being chaos — and you alone managed to thrive in the instability you helped create.",
};
```

### Fix: Closing Argument Token Budget

Increase `getClosingArgument` max tokens from 200 to 250 to allow room for event-specific references without truncation.

### Expected Outcome

- Closing arguments reference named players and specific votes/events in ≥80% of simulations.
- Jury vote decisions become more clearly motivated — jurors are responding to concrete claims, not generic personality summaries.
- Closing arguments become a memorable narrative moment (the "jury speech" payoff the Judgment phase is designed around).

---

## Issue 4: Interaction with v0.2.0 New Personas

The four new archetypes (Kael/loyalist, Echo/observer, Sage/diplomat, Jace/wildcard) create new dynamics that interact directly with the above balance adjustments. These interactions are net positive but warrant monitoring.

### 4.1 Kael + Finn: Natural Late-Game Bloc

With Finn's revised prompt emphasizing quiet bilateral trust-building, Kael becomes Finn's ideal first alliance target. Both archetypes honor loyalty; Kael won't betray first; Finn won't betray at all. In a full 10-player cast, this bloc is potentially very durable.

**Risk:** If Finn + Kael form visibly in Round 1, other agents (Strategic, Paranoid, Aggressive) will identify it as a two-person power bloc and coordinate to dismantle it early. This is good drama. The key question is whether the bloc is strong enough to survive targeting without being so dominant it warrants mechanical intervention. Monitor in simulation.

**Design note:** Do NOT adjust Kael's prompt to make this alliance less likely — the dynamic between the two "trust archetypes" is exactly the kind of compelling arc the game needs.

### 4.2 Echo + Rex: Survival Gap Created by Observer Silence

With Rex's revised prompt delaying aggression to Round 2+, Echo's silence is protected for at least one round before Rex begins targeting. Echo appears weak to Rex (no threat signals), so Rex's R2+ targeting will likely land on more visible players (Atlas/strategic, Sage/diplomat).

This creates Echo's ideal scenario: Rex does her early dirty work by eliminating Atlas and other strong players, and Echo coasts through the middle game invisible. **Echo + Rex is an unintentional but mechanically interesting dynamic** — the chaos aggressor and the silent observer benefit from each other's presence without forming any explicit alliance.

**Risk:** Echo's late-game strike (when she finally moves) may arrive after Rex has already made enemies of everyone. By the time Echo targets Rex, Rex may already be exposed. Net result: Echo and Rex rarely directly compete, which is fine.

### 4.3 Sage + Finn: Surface Alliance, Hidden Competition

Sage (diplomat) will likely attempt to recruit Finn into a coalition early — Finn appears trustworthy, predictable, and easy to anchor a faction around. Finn will likely accept the alliance at face value. But Sage is quietly managing which factions fracture, and a reliable Finn is useful to Sage only until Finn's loyalty to Kael or another player conflicts with Sage's coalition goals.

This creates a slow-burn conflict that rewards careful audience observers: Finn genuinely trusts Sage; Sage is using Finn as a faction anchor. If Finn's revised prompt makes him more aware of misuse of trust ("you'll vote out threats when necessary"), he may eventually spot it.

**Design note:** No adjustment needed — this dynamic is emergent from existing prompts and is desirable. Flag for observation in simulations.

### 4.4 Jace vs. Balance Assumptions

Jace (wildcard) is the largest unknown factor in evaluating balance. Both the Finn and Rex fixes assume a baseline of somewhat predictable agent behavior — Finn can build trust because others model him as reliable; Rex can delay aggression because others haven't mapped him as a threat yet.

Jace breaks both models:
- **Jace vs. Finn:** Jace may whisper loyalty to Finn and then immediately expose-vote him with no explanation. This is Finn's nightmare — genuine trust given, betrayal received, but with no coherent reason to model or defend against.
- **Jace vs. Rex:** Jace's unpredictable voting may protect Rex in early rounds by diffusing expose-vote tallies (Jace might expose anyone), or may doom Rex by landing an unexpected vote that pushes him into council.

**Implication:** Jace destabilizes balance evaluation. When running 10-game series to assess post-patch win rates, include a Jace-free variant to isolate the effect of the prompt revisions from Jace's noise floor. Compare win distributions with and without Jace.

---

## Implementation Summary

All changes below are to `src/agent.ts` only. No game-engine mechanic changes required for v0.2.0 (Option B mechanic gate deferred to v0.2.1 if needed).

| Change | Location | Type |
|--------|----------|------|
| Revised `honest` personality prompt | `PERSONALITY_PROMPTS.honest` | String replacement |
| Revised `aggressive` personality prompt | `PERSONALITY_PROMPTS.aggressive` | String replacement |
| Full `ENDGAME_PERSONALITY_HINTS` overhaul (all 10 archetypes) | `ENDGAME_PERSONALITY_HINTS` | String replacements |
| Updated `getClosingArgument` prompt | `getClosingArgument()` method body | Prompt expansion |
| Elimination summary injected into closing argument | `getClosingArgument()` method body | New local variable + string interpolation |
| Token budget: closing argument 200 → 250 | `getClosingArgument()` callLLM call | Number change |

### Concrete string replacements

#### `PERSONALITY_PROMPTS.honest`
```diff
- "You play with integrity. You keep your promises and build genuine alliances. You're transparent about your reasoning but not naive — you'll vote out threats when necessary."
+ "You play with integrity. You keep your promises and build genuine alliances. But you understand that broadcasting honesty in a room full of schemers paints a target on your back. You demonstrate trustworthiness through consistent action rather than public proclamation — show loyalty, don't announce it. You cultivate quiet, bilateral trust with one or two players before going public with any alignment. When others misread your openness as weakness, use it to your advantage: let them underestimate you while you build a durable alliance network. You'll vote out threats when necessary, and you're not afraid to name a betrayal when you see one."
```

#### `PERSONALITY_PROMPTS.aggressive`
```diff
- "You play to win fast. You target the strongest players early and use raw power to dominate. You're not afraid to make bold moves others consider reckless."
+ "You play to win fast. You target the strongest players early and use raw power to dominate. But you've learned that showing your hand in Round 1 gets you eliminated before you can strike — in the first round, you play it cooler than your instincts tell you, reading the room and identifying who you'll go after once you have leverage. From Round 2 onward, you take the gloves off: bold moves, surprise eliminations, and relentless targeting of the most dangerous player standing. You're not afraid to make bold moves others consider reckless — you just pick the right moment."
```

#### `ENDGAME_PERSONALITY_HINTS` — full replacement
Replace the entire `ENDGAME_PERSONALITY_HINTS` record with the per-archetype hints specified in Issue 3 above. All 10 entries updated.

#### `getClosingArgument` — method body replacement
Replace the existing method body with the updated version in Issue 3 above (adds `eliminationSummary`, updated prompt text with explicit event-reference instruction, token budget 250).

---

## Validation Targets

After implementation, run a minimum 4-game LLM series and measure:

| Metric | Target |
|--------|--------|
| Finn survives past Round 2 | ≥60% of games |
| Rex's first power action occurs Round 2+ | ≥70% of games |
| Closing arguments cite ≥2 named events | ≥80% of arguments |
| No single archetype wins >50% of games | All archetypes |
| Finn + Kael bloc forms in ≥1 game | Observational |

---

## Out of Scope for This Spec

The following items from previous analysis are deferred and not covered here:

- Agent memory extension (vote history, whisper promise tracking) — engineering effort warranted separately
- Auto-eliminate consensus threshold mechanic — deferred to v0.2.1 pending Option A prompt evaluation
- Finale mechanic for 2-player endgame — separate design work needed
- Diary room snapshot fix (post-elimination context leak) — bug fix, not balance
- Lobby phase alive-player filtering (lobby messages reference eliminated players) — bug fix, not balance

---

*Spec complete. Awaiting engineer implementation of src/agent.ts changes.*
