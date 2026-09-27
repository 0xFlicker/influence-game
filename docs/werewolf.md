# Werewolf

Werewolf is a separate, unranked game under The House. Choose Werewolf in the game-creation screen or open `/werewolf` from the navigation to create or watch a game. The first release uses public custom games, existing saved characters, and the existing game-worker deployment. It does not enroll contestants in Influence's Daily Free queue or award Influence ratings, season points, career wins, jury results, or owner-learning reviews.

## Character and strategy

One Agent Profile owns the shared name, personality, backstory, and visual assets. `strategyStyle` is specifically the Influence strategy; `werewolfStrategyStyle` is specifically the Werewolf strategy. The editor presents both. Owned profile REST writes and MCP `create_agent` / `update_agent` accept the Werewolf field with the existing strategy length limit. Public character previews do not expose it.

Characters can enter with blank Werewolf notes. The game uses a Werewolf-specific archetype approach (for example, Observer gathers claim/vote evidence while Aggressive pressures suspects), with conditional village/wolf tactics and Seer/Doctor responsibilities. Unknown or missing archetypes use the Strategic approach. Owner-written notes replace the default. The editor offers a preview and “Customize this strategy”; leaving it blank keeps the default automatic. The exact effective text is frozen in the start event for owned and House characters, so later edits cannot alter a replay.

The AI editor and character creator know both strategy fields and both games' rules. A strategy-only edit changes only the selected game notes, preserving all shared details and the other game's notes, including blanks. It does not load or generate images. Exact provider schemas require the requested strategy and reject missing, fenced, extra-field, or malformed output without changing the draft. New character generation supplies separate suggestions for both games; Influence learning proposals still target Influence only.

There is no cross-game strategy fallback. Empty Werewolf notes use the selected archetype's Werewolf baseline within the assigned role. Existing immutable content revisions that predate these notes have no owner-written Werewolf guidance. Both fields participate in content submission and moderation. A Werewolf-only edit creates a content revision while preserving the Influence analytical revision, rating identity, and review freshness.

Starting a custom game atomically freezes the eligible, published character content, its content-revision reference, its Werewolf strategy, the provider manifest, the roster, the rules version, and randomly assigned roles. There is no waiting lobby in this version. Choose zero to the preset's seat limit of distinct owned characters; House characters fill empty seats. Duplicate display names and unavailable or archived characters are rejected. Subsequent profile edits cannot change a running game. House fill uses shared personality descriptions and Werewolf archetype defaults, with no inherited Influence strategy hints.

## Rules version 2

| Preset | Cast |
| --- | --- |
| `one_wolf` | Six players: one Werewolf, one Seer, four Villagers |
| `two_wolves` | Eight players: two Werewolves, one Seer, one Doctor, four Villagers |

These are starting presets, not measured balance claims.

1. Everyone has one public introduction before the first night.
2. Each night, the living wolves have one private speaking turn each when both remain. Each then chooses one living non-wolf to attack. A split resolves through a seeded draw between the chosen targets.
3. The Seer checks one other living player for wolf/not-wolf. The Doctor protects one living player, including themself, but cannot repeat the previous night's protection target. Each actor sees the same starting roster and no other role's pending choices.
4. Night resolves simultaneously. Protection prevents the attack, including an attack on the Doctor. The Seer's result is recorded even if the Seer dies; a dead Seer cannot tell anyone. The public learns only who died, or that everyone survived.
5. Public discussion has at most six shared beats and four messages per living player. Each beat lets every player with messages remaining choose one message or pass (`text: null`). A pass uses the beat but preserves the message budget: two passes still leave room for four messages. Further passes are legal, but cannot extend six beats. All decisions use the public transcript through the previous beat plus role-authorized private knowledge; no player sees another response from the current beat. The batch reveals together. An all-pass first beat grants one more opening beat; from beat two onward, an all-pass beat closes discussion. Discussion also closes when everyone spends four messages or beat six ends. Exhausted players keep listening and voting. Budgets reset each day.
6. Every living player, including wolves, then votes for one other living player. Ballots are sealed until all have been accepted and are revealed together. The unique highest total eliminates a player; a tie eliminates nobody. Self-votes and abstentions are illegal. This is one collective elimination per day, not a separate elimination per voter.
7. Dead players stop speaking, voting, investigating, protecting, and participating in pack discussion. No final words, role changes, resurrection, jury, or independent winners.
8. Check victory after the whole night or vote resolves. The village wins if no wolves remain. Wolves win when living wolves equal or outnumber living non-wolves. Every original member of the winning faction wins, including dead members. Roles reveal at game end.
9. A full day reaching `maxDays` without victory ends in a draw. The default is 10; API/local simulations allow 1–20. Operator cancellation and execution failure are separate catalog statuses and never award a faction win.

Speech may contain lies and fabricated Seer claims. Only typed investigation events establish a real check. Structured model decisions use exact provider-native schemas, bounded text, and validated legal target IDs. Malformed output retries inside the shared provider policy. Exhausted typed provider failures produce explicit silence for speech or a seeded legal target for a mandatory action; the event records `fallback: provider_unavailable`. Code errors, corrupt accepted values, and lost ownership do not become dialogue or legal fallbacks.

Discussion reveals distinguish deliberate passes from provider-unavailable absences. Both preserve messages and count as silence for closing the discussion. A pass still requires a model decision: it is free against the message budget, not free inference. Concurrent calls shorten wait time but do not remove provider costs. The four-message budget encourages saving a response; a player who has spent it cannot answer a late allegation before voting. Live evaluation should inspect that tradeoff, repeated claims, and whether quieter archetypes rejoin with useful information.

## Spectator information

| View | Information |
| --- | --- |
| Mystery | Public speech, living/dead state, resolved ballots and public night outcomes. Roles and faction result appear only at the ending. |
| Omniscient | The same public facts plus all roles, pack discussion, and resolved attack/protection/investigation details. |
| Contestant | Public facts, shared self-character, selected strategy, own role, and only that role's authorized private knowledge. Wolves receive pack identities/chat and resolved pack targets, including blocked attacks; the Seer receives their own checks; the Doctor receives their own last protection target. |

Neither spectator view includes private model rationale, owner strategies, provider payloads, seeds, or raw canonical events. Contestants have no tool that can fetch the public Omniscient endpoint. The mode switch changes only a viewer projection, never game rules or agent context.

Every game page opens Mystery at the beginning, including completed games. Playback requests use a count of visible entries for the selected audience. The server rebuilds that exact prefix, including player death/role/result visibility at that point. Hidden night actions cannot advance a Mystery cursor. Switching audience returns to the beginning because the two visible-entry timelines differ. The client discards stale requests and cannot display an earlier Omniscient response under Mystery controls. `Latest` deliberately jumps to the current end. HTTP reads use `private, no-store`; this game does not consume the Influence WebSocket/replay transports or transcript parser. Metadata and game-list cards contain no winner or role spoilers.

## Persistence and execution

`games.gameKind` distinguishes `influence` and `werewolf`; Influence's `classic` / `format` kernel distinction stays inside Influence. Werewolf stores its canonical log in `werewolf_events` and planned action/observation hashes in `werewolf_turns`. No transcript text is parsed into state. Shared `game_run_owners` leases fence dispatch and commits, and shared provider journaling retains attempts, accepted values, and spend.

Each action has a stable `werewolf_action` semantic coordinate keyed by its next event sequence. Before dispatch, the store verifies the current prefix and persists the legal request and a hash of the seat's observation. The provider journal checks that plan, actor, day, action, and active owner. After provider acceptance, the rules validate the exact decision again; the append transaction locks the game and owner, replays the committed prefix, checks the plan, and commits one event. Final result, catalog completion, and owner closure commit together.

For discussion, reserve every pending action sequence in the current beat and freeze each seat's observation before concurrent dispatch. Journaled results are committed privately in canonical seat order, independent of response speed. Accepted partial beats do not advance public history or message counts. `werewolf.discussion_revealed` then publishes one typed batch and updates budgets; that batch is one replay cursor position in both audiences. Recovery after partial commitment preserves every remaining observation and sequence, reuses accepted provider results, and never exposes half a beat. This changes the rules version to 2; version-1 experimental logs are rejected rather than silently reinterpreted. No database migration is needed, and old logs are not rewritten.

Restart adopts the same log with a new owner epoch. A provider result accepted before an interrupted event commit is replayed from the journal rather than called again. A stale worker cannot dispatch or append. A corrupt log is suspended instead of inferred from transcript text, and it does not block recovery of unrelated games. Graceful shutdown aborts in-flight execution and releases ownership for adoption. This is the Werewolf event cursor; it does not use Influence's XState snapshot, elimination reducer, or completion settlement.

Run the existing gateway **and** `INFLUENCE_API_ROLE=game-worker` service. A gateway accepts creation but does not execute games itself. Apply `0103_werewolf.sql` before deploying either service. Its journal timestamp follows the parallel `0101_visual_shots` and `0102_visual_review_mode` migrations, so a shared local database that has applied those does not skip Werewolf. Those other features are not dependencies and are not copied into this worktree. Deployment remains the release gate; no feature flag or new infrastructure/package is required.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/werewolf` | Requires `create_game` and `start_game`. Body: `preset`, `agentProfileIds`, optional `providerManifest`, optional `maxDays`. Starts a public custom game and returns `{ id, slug }`. |
| `GET /api/werewolf` | Up to 100 visible games, newest first, without result spoilers. |
| `GET /api/werewolf/:idOrSlug?audience=mystery&cursor=1` | Audience view plus `latestCursor`. Omit `cursor` for the current end. `audience` defaults to Mystery; Omniscient must be explicit. |
| `POST /api/werewolf/:id/stop` | Requires `stop_game`. Revokes the worker, cancels the game, and preserves accepted history. |

The existing `/api/games` creation, classic/format readers, admin game list, and Influence MCP match inspection remain Influence surfaces. They reject or exclude Werewolf instead of applying defaults. Werewolf operations are available through the HTTP API; the existing management MCP's moderator-action prohibition remains in effect.

## Local evaluation and proof

From the repository root, use the API launcher to create a normal watchable game and save a follow-along text report. It reuses the existing CLI login (or `INFLUENCE_API_SESSION_TOKEN`) and requires `create_game` plus `start_game`. The local OAuth page currently labels its required grant **Developer access**, which includes producer evidence and private reasoning access; approve that grant only for the intended local client. The API worker owns the provider credentials, Flex configuration, and durable game. Apply the existing Werewolf migration before first use; the reporting changes require no additional migration.

Start these services in separate terminals from this checkout. The scripts load the Doppler `dev` configuration. Local PostgreSQL must be running, and that configuration must point at the intended local database and provider.

```sh
bun run dev:api          # gateway, port 3000
bun run dev:game-worker  # executes games, port 3002
bun run dev:web          # browser viewer, port 3001
```

Then, in another terminal:

```sh
bun run mcp:game:login # once, or when the saved login expires
bun run simulate:werewolf:api

# Eight seats, two wolves, Seer and Doctor; include selected owned characters.
bun run simulate:werewolf:api --preset two_wolves --agent PROFILE_ID

# Deliberately shortened smoke test; can draw before a faction wins.
bun run simulate:werewolf:api --max-days 2 --out /tmp/werewolf-smoke.txt

# Read an existing game without creating another or making model calls.
bun run simulate:werewolf:api --game GAME_ID_OR_SLUG --audience omniscient --transcript
```

Defaults: six House characters, one wolf and one Seer, `openai:gpt-6-luna`, low reasoning, a ten-day safety cap, and Mystery viewing. A normal match ends as soon as a faction wins; ten days is a ceiling rather than a target. This replaces the old two-day smoke default so a first game can reach its natural result. `--agent` is repeatable; empty seats use House characters with Werewolf archetype defaults. `--model-catalog`, `--reasoning-policy`, `--api-url`, `--web-url`, and `--timeout-seconds` are explicit overrides (`--help` lists them). `--api-url` is local loopback only. `--game` skips login and creation and renders an existing game from the beginning, then follows new entries.

The default report prints the watch URL, cast and rules, phase headings, shared discussion beats with dialogue and grouped passes, night outcomes, vote totals and individual ballots, the surviving cast, and the faction result. `--transcript` adds individual pass/unavailable lines and remaining message budgets. Omniscient adds roles from the start, pack speech, and resolved private role actions. Mystery reveals roles only after the result, including when reading back a completed game. A waiting line every 30 seconds reports the current phase without implying model progress or failure.

Every run saves a unique text file under `packages/engine/docs/simulations/`, appending after each poll so it can be followed with `tail -f`. `--out` selects a new file; existing files are never overwritten. Reports render typed projection entries and quote dialogue directly. They add no summarizer/model call or media generation. Actual gameplay still uses paid/configured inference, including decisions to pass; the day cap limits rounds, not dollars, and can end in a draw. Closing or timing out the CLI does not stop the server game. The printed resume command watches that same game and writes a fresh readback report. Creation is never automatically retried; after an ambiguous creation error, check `/werewolf` before starting again.

The standalone engine simulator remains separate; it does not create API games:

```sh
# No provider calls. Saves a private canonical JSON log under engine/docs/simulations.
bun run simulate:werewolf --preset two_wolves --seed sample-1

# An explicit opt-in model evaluation; requires the selected provider's configuration.
bun run simulate:werewolf --preset one_wolf --model-catalog openai:gpt-6-luna --chatty

bun run test
bun run test:postgres
bun run check

cd packages/api
DRIZZLE_MIGRATIONS_DIR=./drizzle bun test --config=../../bunfig.browser.toml src/e2e/werewolf.e2e.test.ts --max-concurrency 1
```

`--chatty` prints private structured decision records, including `thinking`; it is not a spectator feed. The local JSON log also contains roles, strategies, and hidden decisions. Keep it private. Local simulation does not claim the API's provider-journal crash guarantee. The browser test creates and drops its own database, uses a fake model inventory and scripted contestants, and cleans up API/web/browser processes. PostgreSQL unit tests use `setupTestDB()` and its process lock. Use a dedicated `TEST_DATABASE_URL` when a different checkout has already applied newer migrations.

The pure engine and PostgreSQL tests cover full matches, prefix replay, secrecy, role actions, fallback contracts, owner replacement, malformed provider retries, and accepted-result recovery. The browser journey covers strategy editing, real API creation, worker completion, spectator modes, replay from the start, and phone layout. Live-provider role balance and watchability remain evaluation work requiring an explicit opt-in run.

## Modules and follow-on work

- Rules, events, knowledge, model contracts, and simulation: [`packages/engine/src/werewolf/`](../packages/engine/src/werewolf/).
- Database/service boundary: [`werewolf-games.ts`](../packages/api/src/services/werewolf-games.ts), [`werewolf-runtime.ts`](../packages/api/src/services/werewolf-runtime.ts), [`werewolf-schema.ts`](../packages/api/src/db/werewolf-schema.ts), [`routes/werewolf.ts`](../packages/api/src/routes/werewolf.ts).
- Viewer and custom-game creation: [`packages/web/src/app/werewolf/`](../packages/web/src/app/werewolf/).
- Research, dependency inventory, and source map: [Werewolf plan](plans/2026-09-26-001-feat-werewolf-game-mode-plan.md).

Measure bluff quality, claim tracking, Seer disclosure, pack coordination, win rates by seed/role/model, fallback frequency, latency, and spend before tuning the presets. Hunter and other complex roles, automated scheduling, Werewolf ratings/reviews, and generated narration/video are separate extensions. Renaming the repository remains a separate TODO.
