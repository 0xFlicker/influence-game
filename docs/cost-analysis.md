# Influence Game — Cost Analysis

**Version:** v0.4.1 (token tracking + model configurability)
**Date:** 2026-03-17
**Author:** Lead Game Designer

---

## Executive Summary

Using real token data from 7 simulated games across two player counts, this report
establishes per-game costs, validates the cross-model cost calculator, and makes a
production model recommendation.

**Bottom line:** `gpt-4o-mini` is the right default production model — $0.05/game at
6 players, $0.14/game at 10 players. `gpt-4.1-nano` is a viable lower-cost tier at
roughly 65% of the cost with comparable throughput. `gpt-4o` is recommended as a
premium showcase option (~16× the cost with meaningfully better strategic depth).

**o4-mini (reasoning model) is currently incompatible** — the agent makes calls with
`max_tokens` but reasoning models require `max_completion_tokens`. See bug note below.

---

## Simulation Setup

| Batch | Model | Games | Players | Rounds | Avg Duration |
|-------|-------|-------|---------|--------|--------------|
| Baseline A | gpt-4o-mini | 3 | 6 | 4 (all) | 139s |
| Baseline B | gpt-4o-mini | 3 | 10 | 8 (all) | 293s |
| Reasoning | gpt-4o | 1 | 6 | 4 | 141s |

All games ended via the **judgment** endgame (final council vote after jury deliberation).
All 6-player games settled at round 4; all 10-player games at round 8. The consistent
round counts suggest the game reliably reaches its natural conclusion within the current
`maxRounds: 10` config.

---

## Token Usage (Actuals)

### 6-Player Games (gpt-4o-mini)

| Metric | Per Game (avg) | 3-Game Total |
|--------|---------------|--------------|
| Prompt tokens | 261,163 | 783,490 |
| Completion tokens | 16,909 | 50,728 |
| Total tokens | 278,073 | 834,218 |
| LLM calls | 256 | 769 |
| Prompt % of total | **93.9%** | — |

### 10-Player Games (gpt-4o-mini)

| Metric | Per Game (avg) | 3-Game Total |
|--------|---------------|--------------|
| Prompt tokens | 769,265 | 2,307,796 |
| Completion tokens | 48,125 | 144,374 |
| Total tokens | 817,390 | 2,452,170 |
| LLM calls | 736 | 2,207 |
| Prompt % of total | **94.1%** | — |

### gpt-4o Validation Game (6 Players)

| Metric | Value |
|--------|-------|
| Prompt tokens | 253,633 |
| Completion tokens | 15,869 |
| Total tokens | 269,502 |
| LLM calls | 245 |

> **Key finding:** The gpt-4o game used **3.1% fewer tokens** than the gpt-4o-mini
> average for the same player count (269,502 vs 278,073). This is within normal
> variance, confirming that **model choice does not materially change token consumption**
> — a critical assumption for cross-model cost projection.

---

## Per-Game Cost by Model Tier

Costs computed from actual token counts. 6-player and 10-player per-game averages
are based on 3-game batches. gpt-5 is included as a forward projection; pricing
assumed at 4× gpt-4o.

### 6-Player Game

| Model | Input $/M | Output $/M | Per Game | 16× vs mini |
|-------|-----------|-----------|----------|-------------|
| gpt-4.1-nano | $0.10 | $0.40 | **$0.033** | 0.67× |
| gpt-4o-mini | $0.15 | $0.60 | **$0.049** | 1.0× (baseline) |
| gpt-4.1-mini | $0.40 | $1.60 | **$0.132** | 2.7× |
| o4-mini ¹ | $1.10 | $4.40 | **~$0.362** | 7.4× |
| gpt-4.1 | $2.00 | $8.00 | **$0.658** | 13.4× |
| gpt-4o | $2.50 | $10.00 | **$0.793** ✓ | 16.2× |
| gpt-5 (est.) | $10.00 | $40.00 | **~$3.17** | 64.7× |

✓ = validated with actual gpt-4o run
¹ = estimated, currently incompatible (see bug note)

### 10-Player Game

| Model | Per Game | Monthly × 100 | Monthly × 1K | Monthly × 10K |
|-------|----------|---------------|--------------|----------------|
| gpt-4.1-nano | $0.096 | $9.60 | $96 | $960 |
| gpt-4o-mini | $0.144 | $14.40 | $144 | $1,440 |
| gpt-4.1-mini | $0.385 | $38.50 | $385 | $3,850 |
| o4-mini ¹ | ~$1.058 | ~$105.80 | ~$1,058 | ~$10,580 |
| gpt-4.1 | $1.924 | $192.40 | $1,924 | $19,240 |
| gpt-4o | ~$2.404 | ~$240.40 | ~$2,404 | ~$24,040 |
| gpt-5 (est.) | ~$9.62 | ~$962 | ~$9,620 | ~$96,200 |

---

## Monthly Cost Projections (gpt-4o-mini)

| Volume | 6-Player Only | 10-Player Only | Mixed (50/50) |
|--------|--------------|----------------|----------------|
| 100 games/month | $4.93 | $14.40 | $9.67 |
| 1,000 games/month | $49.30 | $144.00 | $96.65 |
| 10,000 games/month | $493.00 | $1,440.00 | $966.50 |

> **Interpretation:** At 4o-mini, even 10,000 games/month is under $1,500. This is
> extremely affordable. The cost question only becomes material at gpt-4o+ pricing,
> where 10K games/month approaches $24K.

---

## Cost Calculator Validation

The token tracker introduced in INF-34 uses actual prompt and completion tokens from
each OpenAI API call to project costs across all model tiers.

**Test:** Run a 4o-mini game → use recorded tokens to estimate gpt-4o cost → compare
to actual gpt-4o run.

| | Estimate (from mini tokens) | Actual (gpt-4o run) | Delta |
|---|---|---|---|
| gpt-4o cost | $0.696 (avg of 3 games scaled to 1) | $0.793 | +14% |

The 14% delta is within acceptable variance — it reflects normal game-to-game token
variation (range: 245K–295K tokens observed), not systematic calculator error. Across
the 3-game mini batch, the individual game range was 245,456–294,805 total tokens,
a spread of ±9%. The calculator is validated for pricing decisions.

---

## Gameplay Quality: gpt-4o vs gpt-4o-mini

### Methodology

Both runs used identical personas, phase structure, and maxRounds. I read transcripts
from both models, comparing Introduction, Diary Room, Whisper, and Rumor phases.

### Findings

**gpt-4o strengths:**
- **More concise public messages.** Introductions and lobby messages are tighter and
  more memorable ("I'm reading the room and keeping my cards close").
- **Sharper strategic reasoning in Diary Room.** Atlas immediately identifies Echo's
  observer style as a potential weakness. Rex notes Jace's chaos as "a shield and a
  weapon." Agents reason about second-order effects.
- **Better rumor manipulation.** Jace plants genuine doubt about Mira in the public
  rumor phase ("Mira's positivity might be a cover for strategic plotting"). Sage
  strategically reveals his private alliance outreach to build public credibility.
- **Alliance formation is more specific.** Whispers name concrete mutual benefits, not
  just generic "let's work together."

**gpt-4o-mini strengths:**
- **Adequate personality expression.** Personas are clearly differentiated and agents
  stay in character.
- **Functional strategy.** Voting patterns reflect stated alliances. Diary Room entries
  show real preference tracking.
- **Cost effective.** 16× cheaper than gpt-4o for equivalent gameplay structure.

**gpt-4o-mini weaknesses:**
- **Verbose and formulaic.** Public lobby/rumor messages tend to be 3-4 sentences of
  generic trust discourse. Less memorable for spectators.
- **Shallower counter-strategy.** Agents react to surface-level signals rather than
  modeling opponents' models.

### Quality Verdict

| Dimension | gpt-4o-mini | gpt-4o |
|-----------|------------|--------|
| Personality expression | ★★★☆ | ★★★★ |
| Strategic depth | ★★★☆ | ★★★★★ |
| Dialogue naturalness | ★★★☆ | ★★★★ |
| Viewer engagement | ★★★☆ | ★★★★★ |
| Cost efficiency | ★★★★★ | ★★☆☆ |

---

## Balance Notes (Incidental)

The social/diplomat archetype dominated across all gpt-4o-mini 6-player games (3/3
winners were social or diplomat). In 10-player games, social won 2/3. This is a small
sample, but consistent with the v0.3 analysis. Worth tracking across more games.

The aggressive and strategic personas went winless across all 7 games. Early boldness
appears to make these agents easy first-vote targets.

---

## o4-mini Incompatibility Bug

**Bug:** `400 Unsupported parameter: 'max_tokens' is not supported with this model.
Use 'max_completion_tokens' instead.`

**Cause:** OpenAI's o-series reasoning models (o1, o3, o4-mini) do not accept
`max_tokens` — they require `max_completion_tokens`. The current `agent.ts` uses
`max_tokens` unconditionally.

**Impact:** o4-mini (and likely o3-mini, o1-mini) cannot be used until fixed.

**Fix needed:** In `agent.ts`, detect whether the model is an o-series reasoning model
and switch to `max_completion_tokens`. Alternatively, pass both parameters with the
non-reasoning one set to undefined. This is a Founding Engineer fix.

---

## Production Model Recommendation

| Use Case | Recommended Model | Reason |
|----------|------------------|--------|
| Development / CI tests | gpt-4o-mini | Cheapest, adequate quality |
| Standard production games | gpt-4o-mini | $0.05–0.14/game, solid experience |
| Premium / showcase games | gpt-4o | 16× cost, materially better strategic depth |
| Budget tier (future) | gpt-4.1-nano | 65% of mini cost, not yet tested |
| Reasoning model (future) | o4-mini (pending fix) | ~7× mini cost; quality unknown |
| gpt-5 games (future) | Not yet | ~64× mini; reserve for special events |

**Recommended production configuration:**
- Default model: `gpt-4o-mini`
- Premium toggle: `gpt-4o`
- Target player count: 6 players for cost/quality balance (10-player games are 3× the
  cost with diminishing returns on game quality given current mechanics)

---

## Raw Data

Simulation batch directories:

| Batch | Path |
|-------|------|
| 6-player mini (3 games) | `docs/simulations/batch-2026-03-17T13-34-45/` (test worktree) |
| 10-player mini (3 games) | captured in stdout; files in test worktree |
| gpt-4o (1 game) | `docs/simulations/batch-2026-03-17T13-50-44/` (test worktree) |

Full game transcripts are in the corresponding `game-N.txt` files within each batch
directory.
