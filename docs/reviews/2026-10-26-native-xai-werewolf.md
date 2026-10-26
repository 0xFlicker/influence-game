# Native Grok 4.3 localhost Werewolf

On 2026-10-26, an explicitly authorized six-player API game completed using
native `xai:grok-4.3` at low reasoning. No dollar ceiling was requested, and no
configured budget guard was removed. The localhost gateway and worker used
`XAI_API_KEY` from the development configuration.

## Run

```sh
bun run simulate:werewolf:api --preset one_wolf \
  --model-catalog xai:grok-4.3 --reasoning-policy low \
  --audience omniscient --transcript \
  --out /Users/user/.codex/worktrees/d019/influence-game/packages/engine/docs/simulations/2026-10-26-native-xai-six-player.txt
```

- API: `http://127.0.0.1:3000`.
- Game: `52aa63e0-6d1f-4ed0-b879-59eb0feea41c` / `zen-blue-crane`.
- Local replay: <http://localhost:3001/games/zen-blue-crane/replay?audience=omniscient>.
- Six players, one wolf, ten-day maximum; village won on day two.
- Final database status: `completed`; retrospective completed all six statements.

## Evidence and cost

The durable `provider_call_attempts` rows contained 51 terminal, usable attempts,
all with `evidence_state = stored`. No failed attempt was recorded. Sanitized
requests/responses and available encrypted reasoning remain in private API
storage; this report does not publish those bodies.

The game's `game_provider_spend_entries` rows all used xAI / `grok-4.3`:

| Metric | Recorded value |
|---|---:|
| Calls, including retrospective | 51 |
| Actual LLM cost | $0.393445 USD |
| Input tokens | 266,202 |
| Cached input tokens (included above) | 10,368 |
| Output tokens | 28,632 |
| Reasoning tokens (included in output) | 25,095 |

The full text report and local summary are retained under
`packages/engine/docs/simulations/2026-10-26-native-xai-six-player*` in the run's
checkout. Those local artifacts are ignored by Git; durable game/evidence records
remain authoritative. The replay requires that localhost deployment and database.

This proves the native transport, hosted structured decisions, durable game
execution, private evidence persistence, cost recording and retrospective for
one Grok 4.3 Werewolf run. It does not qualify every Grok model, Influence-specific
schemas, production deployment, or strategic quality. Catalog status remains
evaluation-candidate pending broader coverage.
