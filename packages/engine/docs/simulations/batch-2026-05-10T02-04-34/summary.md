# Simulation Results

**Variant:** baseline
**Git:** 752363b (fix/inf-212-open-room-backend-gaps, dirty)
**Command:** `/usr/lib/node_modules/bun/bin/bun.exe /home/paperclip/.paperclip/instances/default/projects/efa7c0e1-047f-40ae-8dda-212aa9ae25a0/50f54176-8cc9-4aa0-9168-6a69e88223dd/influence-game/packages/engine/src/simulate.ts --games 1 --players 4 --model gpt-5.4-nano --variant baseline`
**Timestamp:** 2026-05-10T02:04:34.371Z
**Games completed:** 1/1
**Games attempted:** 1
**Model:** gpt-5.4-nano
**Avg game length:** 2.0 rounds
**Avg duration:** 93s per game

## Instrumentation

| Signal | Count |
|--------|------:|
| Power actions | 1 |
| Power eliminate | 0 |
| Power protect | 0 |
| Power pass | 1 |
| Empowered actors | 1 |
| Consecutive eliminate repeats | 0 |
| Repeated protect-same-target occurrences | 0 |
| Auto-eliminations | 0 |
| Reveal phases | 1 |
| Council phases | 1 |
| Council votes | 2 |
| Reckoning markers | 0 |
| Tribunal markers | 4 |
| Judgment markers | 5 |
| Whisper rooms | 0 |
| Whisper sessions instrumented | 0 |
| Room exclusions | 0 |
| Repeated room-pair occurrences | 0 |
| Request mutual matches honored | 0 |
| Request one-way matches honored | 0 |
| Unmatched valid room requests | 0 |
| Invalid/missing room requests | 0 |
| Immediate repeat rooms flagged | 0 |
| Avoidable consecutive exclusions flagged | 0 |
| LLM empty/fallback responses | 0 |

## Power Action Distribution

| Actor | Actions | Eliminate | Protect | Pass |
|-------|--------:|----------:|--------:|-----:|
| Echo | 1 | 0 | 0 | 1 |

## LLM Action Usage

| Action | Calls | Empty/Fallback | Empty Rate | Tokens |
|--------|------:|---------------:|-----------:|-------:|
| lobby | 28 | 0 | 0.0% | 77,947 |
| diary | 16 | 0 | 0.0% | 40,347 |
| reflection | 10 | 0 | 0.0% | 24,093 |
| question | 8 | 0 | 0.0% | 15,092 |
| followup | 8 | 0 | 0.0% | 19,681 |
| lobby-intent | 7 | 0 | 0.0% | 15,696 |
| introduction | 4 | 0 | 0.0% | 3,264 |
| rumor | 4 | 0 | 0.0% | 9,730 |
| vote | 4 | 0 | 0.0% | 10,052 |
| elimination-vote | 4 | 0 | 0.0% | 11,566 |
| accusation | 3 | 0 | 0.0% | 8,567 |
| tribunal-defense | 3 | 0 | 0.0% | 9,432 |
| council-vote | 2 | 0 | 0.0% | 5,412 |
| last-message | 2 | 0 | 0.0% | 5,730 |
| opening-statement | 2 | 0 | 0.0% | 6,348 |
| jury-question | 2 | 0 | 0.0% | 6,069 |
| jury-answer | 2 | 0 | 0.0% | 6,662 |
| closing-argument | 2 | 0 | 0.0% | 6,966 |
| jury-vote | 2 | 0 | 0.0% | 5,921 |
| power | 1 | 0 | 0.0% | 3,085 |

## Per-Persona Stats

| Persona | Played | Wins | Win Rate | Avg Survival |
|---------|--------|------|----------|--------------|
| observer | 1 | 1 | 100% | 2.0 |
| wildcard | 1 | 0 | 0% | 1.0 |
| honest | 1 | 0 | 0% | 2.0 |
| social | 1 | 0 | 0% | 2.0 |

## Endgame Types

| Type | Count |
|------|-------|
| judgment | 1 |

## Round Distribution

| Rounds | Games |
|--------|-------|
| 2 | 1 |

## Token Usage

| Metric | Value |
|--------|-------|
| Total LLM calls | 114 |
| Prompt tokens | 266,739 |
| Cached input tokens | 13,568 |
| Completion tokens | 24,921 |
| Reasoning tokens (CoT) | 5,697 |
| Visible output tokens | 19,224 |
| Total tokens | 291,660 |

## Cost Estimates

| Model | Input Cost | Output Cost | Total Cost |
|-------|-----------|-------------|------------|
| gpt-4o-mini | $0.0400 | $0.0150 | $0.0550 |
| gpt-4o | $0.6668 | $0.2492 | $0.9161 |
| o4-mini | $0.2934 | $0.1097 | $0.4031 |
| gpt-4.1-nano | $0.0267 | $0.0100 | $0.0366 |
| gpt-4.1-mini | $0.1067 | $0.0399 | $0.1466 |
| gpt-4.1 | $0.5335 | $0.1994 | $0.7328 |
| gpt-5-nano | $0.0127 | $0.0100 | $0.0227 |
| gpt-5-mini | $0.0636 | $0.0498 | $0.1135 |
| gpt-5 | $0.3182 | $0.2492 | $0.5674 |
| gpt-5.4-mini | $0.1909 | $0.1121 | $0.3030 |

_* = model used for this simulation_

## Individual Games

| # | Winner | Persona | Rounds | Endgame | Duration | Tokens | LLM Calls |
|---|--------|---------|--------|---------|----------|--------|-----------|
| 1 | Echo | observer | 2 | judgment | 93s | 291,660 | 114 |
