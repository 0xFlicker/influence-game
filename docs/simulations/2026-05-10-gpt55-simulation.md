# Simulation: GPT-5.4/5.5 Baseline Probe

**Date:** 2026-05-10
**Issue:** INF-217
**Runs:** 3 completed games
**Config:** baseline variant, 4 players, maxRounds=10, timers disabled
**Models:** gpt-5.4-nano, gpt-5.4-mini, gpt-5.5
**Raw artifacts:**

- `packages/engine/docs/simulations/batch-2026-05-10T02-04-34/` — gpt-5.4-nano
- `packages/engine/docs/simulations/batch-2026-05-10T02-06-12/` — gpt-5.4-mini
- `packages/engine/docs/simulations/batch-2026-05-10T01-54-09/` — gpt-5.5

## Availability Probe

`/v1/models` returned `gpt-5.5`, `gpt-5.5-pro`, `gpt-5.4`, `gpt-5.4-pro`, `gpt-5.4-mini`, and `gpt-5.4-nano`. No available model ID contained `instant`, so the low/medium/high probe used recent available sizes instead of a GPT-5.5 Instant model.

## Compatibility Notes

Initial GPT-5.5 and GPT-5.4-nano attempts exposed chat-completions parameter differences:

- GPT-5.4/5.5 reject non-default `temperature`; the engine now suppresses custom temperature for all `gpt-5*` models.
- GPT-5.5 returned empty visible output on small completion budgets; the engine now treats the full `gpt-5*` family as reasoning-token consumers for budget headroom.
- GPT-5.4+ reject `reasoning_effort` on chat-completions function-tool calls; the engine now omits `reasoning_effort` for GPT-5.4+ tool calls while keeping it for free-text and JSON response calls.

After those fixes, all three successful runs completed with zero empty/fallback responses.

## Results

| Tier | Model | Cast | Winner | Persona | Rounds | Endgame | Duration | LLM Calls | Tokens | Empty/Fallback |
|---|---|---|---|---|---:|---|---:|---:|---:|---:|
| Low | gpt-5.4-nano | Jace, Echo, Finn, Mira | Echo | observer | 2 | judgment | 93s | 114 | 291,660 | 0 |
| Medium | gpt-5.4-mini | Atlas, Vera, Jace, Finn | Finn | honest | 2 | judgment | 113s | 113 | 288,063 | 0 |
| High | gpt-5.5 | Atlas, Sage, Vera, Echo | Vera | deceptive | 2 | judgment | 370s | 111 | 308,025 | 0 |

## Transcript Read

The GPT-5.5 transcript quality was the strongest observer-facing sample:

- Introductions were specific, grounded, and immediately reusable as social leverage.
- Diary Room questions were sharper than the nano baseline tends to be; House repeatedly quoted earlier statements and forced agents to reconcile contradictions.
- Rumor phase converged cleanly on Atlas as a shared threat. Three separate rumors framed his friendly questioning as covert cross-examination, creating a strong consensus target.
- Vera's win was legible: she named Atlas as a narrative-control threat, used empowerment to eliminate him, then owned the visible aggression in Judgment.
- Sage created a credible counter-case as the coalition architect, but jurors rewarded Vera's explicit authorship over Sage's softer architecture.

The GPT-5.4-nano and GPT-5.4-mini runs were reliable after the tool-call fix. Both completed faster than GPT-5.5 and reached Judgment with no fallback messages. GPT-5.4-mini produced a clean honest-Finn victory with explicit event references; GPT-5.4-nano produced a coherent observer-Echo win but felt less dramatically dense than GPT-5.5.

## Balance Findings

Three single-game samples are not enough for win-rate conclusions, but they do surface two design signals:

- Four-player baseline skips whisper rooms, so these runs validate model compatibility and endgame transcript quality, not full social topology.
- The Judgment phase benefited from concrete event references across models. Finalists cited Round 1 votes, first eliminations, and alliance framing rather than generic personality claims.
- GPT-5.5 is much slower for this workload: 370s for one 4-player game versus 93s for 5.4-nano and 113s for 5.4-mini.

## Recommendations

1. Treat this as a new-model compatibility pass, not a balance sample.
2. Map low/medium/high to `gpt-5.4-nano`, `gpt-5.4-mini`, and `gpt-5.5` unless a future `instant` model appears in `/v1/models`.
3. Keep the model-parameter compatibility patch; without it, GPT-5.4/5.5 simulations either hard-fail on API params or degrade into fallback output.
4. Run a 5- or 6-player GPT-5.5 sample only after board approval for the higher cost/runtime profile.
