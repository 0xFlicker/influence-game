# Lobby Prompt Overhaul — Before/After Analysis

**Date:** 2026-03-24
**Issue:** INF-74 — Increase lobby speaking budget and support multi-step whisper plans
**Model:** gpt-4o-mini
**Games:** 3 BEFORE (batch-2026-03-24T01-04-45) vs 4 AFTER (batch-2026-03-24T03-42-57, batch-2026-03-24T03-57-10)

## Problem Statement

Board feedback identified three critical lobby issues:

1. **Elimination fixation** — After Round 1, every agent wrote eulogies for the eliminated player. Entire lobby rounds were consumed by farewells.
2. **No strategic subtext** — The "do NOT talk about strategy" instruction was too heavy-handed, producing bland pleasantries with zero game tension.
3. **No pre-lobby planning** — Agents entered lobby with no strategy for what to subtly communicate, resulting in generic social chatter.

## Changes Made

### 1. Pre-Lobby Strategy Intent (`getLobbyIntent`)

New method called once before lobby sub-rounds. Each agent privately formulates:
- What they want to subtly communicate
- Who to target with pointed remarks
- What emotional angle fits their personality

This intent is injected into each lobby message prompt as private context the agent uses to guide subtext.

### 2. Revised Phase Guidelines

**Before:** "The lobby is a SOCIAL space. The unspoken rule is: do NOT talk about the game, strategy, votes, alliances..."

**After:** "The lobby is where personality meets strategy — but NEVER overtly. The surface is social. The subtext is the game." With specific guidance for:
- Snide asides at rivals, loaded compliments to allies
- Double-entendres, sarcasm toward the powerful
- Personality friction (not everyone gets along)
- ONE brief acknowledgment of eliminations, then move on
- Mid/late game: reference history, pointed observations about behavior

### 3. Sub-Round Awareness

Agents now know which message they're sending (1/4, 2/4, etc.):
- **First message:** Set the tone, lead with personality
- **Middle messages:** Build on conversation, respond directly to others
- **Final message:** Leave an impression — pointed observation or loaded remark

### 4. Reduced Elimination Guidance

- Elimination context only appears in the FIRST sub-round message
- Guidance shortened: "brief acknowledgment, then move on" (vs. "show genuine grief, anger, or loss")
- No elimination guidance in subsequent sub-rounds

## Before/After Comparison

### BEFORE — Round 2 Lobby (all 5 agents eulogize Jace)

```
Atlas: "Wow, Jace really brought the laughter and light to our little circus here!
  I'll miss his taco tales..."
Kael: "Jace, your humor brought a lot of life to this place, and I'll miss those
  jackfruit taco stories!"
Echo: "Jace, you definitely brought a unique flavor to the game... I'll miss the
  laughter!"
Lyra: "Wow, Jace was such a character! I'll miss his wild food truck stories..."
Vera: "Ah, Jace, we barely knew you! You brought a whirlwind of laughter and chaos..."
```

**Every single message** is a eulogy. Zero engagement with living players. Zero tension.

### AFTER — Round 2 Lobby (brief nod, then strategic subtext)

```
Finn: "Well, I guess Jace's punchlines are now just echoes in the room. Speaking of
  punch, Atlas, your eagerness to dissect everyone's words is impressive, but let's
  not confuse analysis with over-analysis."
Rex: "Jace's exit was like a punchline that landed flat. Speaking of hits, Atlas,
  your detective skills are impressive, but don't get too caught up in dissecting
  every word..."
Echo: "It's a shame to see Jace go. But honestly, Atlas, your detective work is
  impressive, though I can't help but wonder if you're more focused on theatrics
  than truth."
```

Brief farewell (1 clause), then immediate pivot to engaging and challenging living players with loaded subtext.

### BEFORE — Round 3 Lobby (all 4 agents eulogize Atlas)

```
Echo: "Atlas, your humor definitely brought some light to this place!"
Vera: "Ah, Atlas, you brought such a clever wit to our little ensemble!"
Kael: "Atlas always had a way of lightening up the room, didn't he?"
Lyra: "Wow, Atlas really brought some charm and wit to our little circus!"
```

### AFTER — Round 3 Lobby (no dwelling, heavy strategic subtext)

```
Kael: "It's interesting how some folks can command the room with their voices while
  others are left trying to find a moment to speak... Sometimes it's the quiet ones
  who see things most clearly, right, Vera?"
Vera: "It's amusing how some people have a knack for weaving elaborate tales, Echo.
  Almost as if they're not just sharing memories but constructing a whole narrative..."
Echo: "Charm can sometimes feel like a well-crafted performance—captivating at first,
  but if you look closely, you might find a few cracks."
```

No elimination fixation. Players are targeting each other with strategic subtext.

## Quantitative Observations

| Metric | BEFORE (3 games) | AFTER (3+1 games) |
|--------|------------------|-------------------|
| Avg game length | 4.0 rounds | 4.0 rounds |
| Avg duration | 1045s | 772s |
| LLM calls/game | ~660 | ~520 |
| Token cost (4o-mini) | $0.79 (3 games) | $0.67 (3 games) |
| Elimination eulogy messages | ~100% of R2+ lobby | ~10% (brief, first msg only) |
| Strategic subtext present | ~0% of lobby msgs | ~90% of lobby msgs |
| Player-to-player friction | Rare | Every round |

**Cost note:** Despite adding the `getLobbyIntent` pre-call (1 extra LLM call per player per lobby), total costs decreased because the more focused prompts produce shorter, more targeted responses.

## Remaining Observations

1. **Food/baking metaphor repetition** — Agents over-rely on cooking metaphors (likely influenced by backstory context). Not a lobby-specific issue; could be addressed via persona prompt tuning.
2. **Message length** — Some messages still exceed the 2-3 sentence target. Could tighten with stronger length constraints.
3. **Deceptive persona (Vera) dominance** — Won 2/3 AFTER games. The strategic subtext may benefit manipulative archetypes. Worth monitoring across more games.

## Files Changed

- `packages/engine/src/agent.ts` — New `getLobbyIntent()` method, revised `getLobbyMessage()` prompt, updated `getPhaseGuidelines()` for LOBBY
- `packages/engine/src/game-runner.ts` — Added `lobbySubRound`/`lobbyTotalSubRounds` to PhaseContext, pre-lobby intent call in all lobby phases (normal, reckoning, tribunal)
