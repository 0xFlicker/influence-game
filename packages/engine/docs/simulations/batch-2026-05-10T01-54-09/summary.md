# Simulation Results

**Variant:** baseline
**Git:** 74888d7 (fix/inf-212-open-room-backend-gaps, dirty)
**Command:** `/usr/lib/node_modules/bun/bin/bun.exe /home/paperclip/.paperclip/instances/default/projects/efa7c0e1-047f-40ae-8dda-212aa9ae25a0/50f54176-8cc9-4aa0-9168-6a69e88223dd/influence-game/packages/engine/src/simulate.ts --games 1 --players 4 --model gpt-5.5 --variant baseline`
**Timestamp:** 2026-05-10T01:54:09.279Z
**Games completed:** 1/1
**Games attempted:** 1
**Model:** gpt-5.5
**Avg game length:** 2.0 rounds
**Avg duration:** 370s per game

## Instrumentation

| Signal | Count |
|--------|------:|
| Power actions | 1 |
| Power eliminate | 1 |
| Power protect | 0 |
| Power pass | 0 |
| Empowered actors | 1 |
| Consecutive eliminate repeats | 0 |
| Repeated protect-same-target occurrences | 0 |
| Auto-eliminations | 1 |
| Reveal phases | 0 |
| Council phases | 0 |
| Council votes | 0 |
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
| Vera | 1 | 1 | 0 | 0 |

## LLM Action Usage

| Action | Calls | Empty/Fallback | Empty Rate | Tokens |
|--------|------:|---------------:|-----------:|-------:|
| lobby | 28 | 0 | 0.0% | 79,799 |
| diary | 16 | 0 | 0.0% | 43,072 |
| reflection | 10 | 0 | 0.0% | 26,679 |
| question | 8 | 0 | 0.0% | 18,038 |
| followup | 8 | 0 | 0.0% | 22,765 |
| lobby-intent | 7 | 0 | 0.0% | 15,448 |
| introduction | 4 | 0 | 0.0% | 3,120 |
| rumor | 4 | 0 | 0.0% | 10,275 |
| vote | 4 | 0 | 0.0% | 10,436 |
| elimination-vote | 4 | 0 | 0.0% | 14,691 |
| accusation | 3 | 0 | 0.0% | 9,934 |
| last-message | 2 | 0 | 0.0% | 6,240 |
| tribunal-defense | 2 | 0 | 0.0% | 8,305 |
| opening-statement | 2 | 0 | 0.0% | 7,766 |
| jury-question | 2 | 0 | 0.0% | 7,223 |
| jury-answer | 2 | 0 | 0.0% | 7,593 |
| closing-argument | 2 | 0 | 0.0% | 6,880 |
| jury-vote | 2 | 0 | 0.0% | 6,114 |
| power | 1 | 0 | 0.0% | 3,647 |

## Per-Persona Stats

| Persona | Played | Wins | Win Rate | Avg Survival |
|---------|--------|------|----------|--------------|
| deceptive | 1 | 1 | 100% | 2.0 |
| strategic | 1 | 0 | 0% | 1.0 |
| diplomat | 1 | 0 | 0% | 2.0 |
| observer | 1 | 0 | 0% | 2.0 |

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
| Total LLM calls | 111 |
| Prompt tokens | 281,227 |
| Cached input tokens | 12,032 |
| Completion tokens | 26,798 |
| Reasoning tokens (CoT) | 4,742 |
| Visible output tokens | 22,056 |
| Total tokens | 308,025 |

## Cost Estimates

| Model | Input Cost | Output Cost | Total Cost |
|-------|-----------|-------------|------------|
| gpt-4o-mini | $0.0422 | $0.0161 | $0.0583 |
| gpt-4o | $0.7031 | $0.2680 | $0.9710 |
| o4-mini | $0.3093 | $0.1179 | $0.4273 |
| gpt-4.1-nano | $0.0281 | $0.0107 | $0.0388 |
| gpt-4.1-mini | $0.1125 | $0.0429 | $0.1554 |
| gpt-4.1 | $0.5625 | $0.2144 | $0.7768 |
| gpt-5-nano | $0.0135 | $0.0107 | $0.0242 |
| gpt-5-mini | $0.0676 | $0.0536 | $0.1212 |
| gpt-5 | $0.3380 | $0.2680 | $0.6060 |
| gpt-5.4-mini | $0.2028 | $0.1206 | $0.3234 |

_* = model used for this simulation_

## Individual Games

| # | Winner | Persona | Rounds | Endgame | Duration | Tokens | LLM Calls |
|---|--------|---------|--------|---------|----------|--------|-----------|
| 1 | Vera | deceptive | 2 | judgment | 370s | 308,025 | 111 |
