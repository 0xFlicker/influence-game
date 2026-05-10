# Simulation Results

**Variant:** baseline
**Git:** 752363b (fix/inf-212-open-room-backend-gaps, dirty)
**Command:** `/usr/lib/node_modules/bun/bin/bun.exe /home/paperclip/.paperclip/instances/default/projects/efa7c0e1-047f-40ae-8dda-212aa9ae25a0/50f54176-8cc9-4aa0-9168-6a69e88223dd/influence-game/packages/engine/src/simulate.ts --games 1 --players 4 --model gpt-5.4-mini --variant baseline`
**Timestamp:** 2026-05-10T02:06:12.858Z
**Games completed:** 1/1
**Games attempted:** 1
**Model:** gpt-5.4-mini
**Avg game length:** 2.0 rounds
**Avg duration:** 113s per game

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
| Finn | 1 | 0 | 0 | 1 |

## LLM Action Usage

| Action | Calls | Empty/Fallback | Empty Rate | Tokens |
|--------|------:|---------------:|-----------:|-------:|
| lobby | 28 | 0 | 0.0% | 76,873 |
| diary | 16 | 0 | 0.0% | 41,038 |
| reflection | 10 | 0 | 0.0% | 24,123 |
| question | 8 | 0 | 0.0% | 14,537 |
| followup | 8 | 0 | 0.0% | 18,853 |
| lobby-intent | 7 | 0 | 0.0% | 14,970 |
| introduction | 4 | 0 | 0.0% | 3,199 |
| rumor | 4 | 0 | 0.0% | 10,133 |
| vote | 4 | 0 | 0.0% | 10,128 |
| elimination-vote | 4 | 0 | 0.0% | 11,945 |
| accusation | 3 | 0 | 0.0% | 8,630 |
| council-vote | 2 | 0 | 0.0% | 5,273 |
| last-message | 2 | 0 | 0.0% | 5,919 |
| tribunal-defense | 2 | 0 | 0.0% | 6,431 |
| opening-statement | 2 | 0 | 0.0% | 7,245 |
| jury-question | 2 | 0 | 0.0% | 6,158 |
| jury-answer | 2 | 0 | 0.0% | 7,019 |
| closing-argument | 2 | 0 | 0.0% | 6,776 |
| jury-vote | 2 | 0 | 0.0% | 5,783 |
| power | 1 | 0 | 0.0% | 3,030 |

## Per-Persona Stats

| Persona | Played | Wins | Win Rate | Avg Survival |
|---------|--------|------|----------|--------------|
| honest | 1 | 1 | 100% | 2.0 |
| strategic | 1 | 0 | 0% | 1.0 |
| deceptive | 1 | 0 | 0% | 2.0 |
| wildcard | 1 | 0 | 0% | 2.0 |

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
| Total LLM calls | 113 |
| Prompt tokens | 260,003 |
| Cached input tokens | 9,984 |
| Completion tokens | 28,060 |
| Reasoning tokens (CoT) | 8,036 |
| Visible output tokens | 20,024 |
| Total tokens | 288,063 |

## Cost Estimates

| Model | Input Cost | Output Cost | Total Cost |
|-------|-----------|-------------|------------|
| gpt-4o-mini | $0.0390 | $0.0168 | $0.0558 |
| gpt-4o | $0.6500 | $0.2806 | $0.9306 |
| o4-mini | $0.2860 | $0.1235 | $0.4095 |
| gpt-4.1-nano | $0.0260 | $0.0112 | $0.0372 |
| gpt-4.1-mini | $0.1040 | $0.0449 | $0.1489 |
| gpt-4.1 | $0.5200 | $0.2245 | $0.7445 |
| gpt-5-nano | $0.0126 | $0.0112 | $0.0238 |
| gpt-5-mini | $0.0628 | $0.0561 | $0.1189 |
| gpt-5 | $0.3138 | $0.2806 | $0.5944 |
| gpt-5.4-mini * | $0.1883 | $0.1263 | $0.3145 |

_* = model used for this simulation_

## Individual Games

| # | Winner | Persona | Rounds | Endgame | Duration | Tokens | LLM Calls |
|---|--------|---------|--------|---------|----------|--------|-----------|
| 1 | Finn | honest | 2 | judgment | 113s | 288,063 | 113 |
