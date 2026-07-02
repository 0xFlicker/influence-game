# Statefulness Remediation Plan

> **Status**: Draft — awaiting board review
> **Author**: Frontend Engineer (INF-98)
> **Date**: 2026-03-24
> **Scope**: Game engine (`packages/engine`) + API (`packages/api`)

---

## Problem Statement

Historically, every running game held its entire execution state in process memory. If the process crashed, was redeployed, or needed to scale horizontally, active games were irrecoverably lost. The architecture was originally designed around xstate's serializable state model, but the persistence layer was never built.

The engine now emits canonical accepted-domain events for simulator runs and writes them to `game-N-events.jsonl`. API-backed games also have a first durable game-run kernel: the API game ID is bound into engine events at construction, canonical events are written to Postgres under an owner epoch, and suspended/checkpoint/evidence metadata gives operators something inspectable after failure. The admin durable-run inspection read model can now validate the persisted event log, replay the trusted prefix into the canonical projection, and summarize checkpoint/evidence readiness.

This is now partially crash-recoverable at implemented completed phase boundaries, not generally crash-safe. On startup, the API process treats any pre-existing `in_progress` game as orphaned because the replacement process has no in-memory runner for it, marks it `suspended`, then configured startup recovery can claim and continue the same game when the newest resume-capable phase-boundary checkpoint is at the durable event head and has a supported actor coordinate plus complete resume inputs. Mid-phase interruptions, in-flight model calls, full XState snapshot restoration, arbitrary old-game repair, and multi-worker recovery remain unsupported.

### Current Risks

| Scenario | Impact |
|----------|--------|
| **Process crash mid-game** | The live runner dies. On API restart, pre-existing `in_progress` rows are treated as orphaned and marked `suspended`. Persisted canonical events/checkpoints/evidence manifests remain inspectable. If the newest resume-capable event-head checkpoint is a supported completed phase boundary, startup recovery can resume the same game; otherwise the run remains `suspended`. |
| **Deploy while games active** | Same as crash for unplanned termination. Supported phase-boundary recovery reduces risk, but graceful drain/resume and multi-worker coordination remain future work. |
| **Horizontal scaling** | Accepted commits are owner-epoch guarded, but each live run still needs one sequential owner. `activeGames` and WebSocket pub/sub remain process-local caches. |

---

## Audit: All In-Memory State

### Engine (`packages/engine/`)

| Component | Location | State Held | Serializable? |
|-----------|----------|-----------|---------------|
| `GameState` | `game-state.ts:29-55` | Players map, vote tallies, round results, jury, eliminations, empower tracking, room allocations, endgame state | Yes — Maps/arrays of primitives |
| `GameRunner` | `game-runner.ts:184-210` | Transcript log, whisper inbox, public messages, diary entries, elimination order, abort flag, room allocations | Yes — arrays/maps of plain objects |
| `PhaseMachine` (xstate) | `phase-machine.ts:17-43` | Phase, round, alive players, empowered ID, jury, endgame stage, finalists, winner | Yes — `actor.getSnapshot()` returns serializable state |
| `GameEventBus` | `event-bus.ts:11-14` | RxJS Subjects (events, actions, messages) | No — transient event streams, not needed for recovery |
| `InfluenceAgent` | `agent.ts:472-490` | Allies set, threats set, notes map, round history, last reflection | Partially — plain data, but LLM conversation context is not recoverable |
| `TokenTracker` | `token-tracker.ts:106-159` | Per-source token usage map | Yes — Map of strings to numbers |
| `InMemoryMemoryStore` | `memory-store.ts:32-46` | Memory records array | Yes, but API already uses `PgMemoryStore` (DB-backed) |

**Key positive**: Zero global shared mutable state across games. Each game instance is fully isolated. No singletons, no module-level mutable variables, no shared registries in the engine.

**Timers**: All `setTimeout` calls are transient (action collection timeouts, LLM retry backoff). None hold game-critical state. No `setInterval`.

### API (`packages/api/`)

| Component | Location | State Held | Lost on Crash? |
|-----------|----------|-----------|----------------|
| `activeGames` Map | `game-lifecycle.ts:37-45` | Live `GameRunner` instances + execution promises | **Yes — CRITICAL** |
| `gameObserverCount` | `ws-manager.ts:39-42` | WebSocket observer count per game | Yes — rebuilds on reconnect (low risk) |
| `ViewerEventPacer` | `viewer-event-pacer.ts:55-65` | Event queue, drain flag, current phase | Yes — dramatic pacing lost (medium risk) |
| `_privyClient` | `auth.ts:40-52` | Lazy singleton PrivyClient | No risk — stateless, recreated on demand |
| `poolCache` | `db/index.ts:16-26` | DB connection pool cache | No risk — recreated on startup |
| `TokenTracker` per game | `game-lifecycle.ts:136-137` | Cumulative token usage | Yes — partial cost data lost |

### What IS Persisted (Safe)

- Game records (status, config, timestamps) — `games` table
- Game players (personas, agent configs) — `game_players` table
- Transcripts — `transcripts` table (bulk-inserted after game, or partially on error)
- Game results — `game_results` table (winner, rounds, token usage)
- Agent memories — `agent_memories` table via `PgMemoryStore` (written during game)
- Agent profiles, ELO ratings, users, auth — various tables

### Existing Recovery Mechanisms

1. **Orphaned game classification** (`index.ts`, `startup-orphaned-games.ts`) — On startup, pre-existing `in_progress` games are marked `suspended` for configured recovery because the replacement API process has no live runner for them.
2. **Durable event append** (`game-events.ts`) — API canonical events are appended in sequence under the active owner epoch and suspend on owner/identity/sequence/hash failure.
3. **Forensic checkpoint/evidence rows** (`game-checkpoints.ts`, `game-evidence.ts`) — Checkpoint capsules and private evidence manifests provide debug boundaries without making raw evidence public or claiming hydration.
4. **Durable truth read model** (`game-event-read-model.ts`, `game-projection-read-model.ts`, `game-durable-run.ts`) — Admin-only inspection can explain event-log integrity, replay status, board projection summary, checkpoint readiness, and redacted evidence counts from Postgres.
5. **Memory cleanup** (`game-lifecycle.ts`) — Normal completed/cancelled exits can clear `PgMemoryStore`; suspended runs avoid eager cleanup intended for safe terminal states.
6. **Phase-boundary startup recovery** (`game-recovery.ts`, `game-recovery-support.ts`, `game-lifecycle.ts`) — On startup, the API process scans suspended games by default, validates a supported checkpoint, claims a fresh owner, hydrates `GameRunner`, and continues the same game. Set `INFLUENCE_API_STARTUP_RECOVERY=false` only when recovery needs to be explicitly disabled.

These are partial crash-recovery mechanisms for supported phase boundaries plus fail-closed mitigation for everything else.

Note (as of 2026-06-14 Runtime Snapshot v1): durable checkpoints now carry a validator-derived `hydration passport` (forensic_only / blocked / hydration_candidate) backed by a versioned Runtime Snapshot payload (boundary receipt, actor witness, accumulator registry, transcript watermark, token cursor, and structured continuity capsules). A real phase-boundary checkpoint written through the durable API path can reach `hydration_candidate` when every v1 stamp passes, including a complete manifest, sealed token/transcript boundary evidence, expected active-player continuity coverage, and drained, proven-empty, or specifically validated structured accumulators. Unstructured captured accumulator labels, malformed snapshot subobjects, boundaryless cursors, and contradictory manifests fail closed. At that point, runtime resume remained out of scope and durable-run inspection kept `resumeAvailable: false`.

Note (as of 2026-06-29 phase-boundary startup resume): `resumeAvailable` is no longer a proof-only flag. It is true only for implemented recovery support: suspended games whose phase-boundary checkpoint is at the event head, has safe Runtime Snapshot v1 evidence, has transcript replay and token cursor payloads, and targets a supported actor coordinate. Current runner hydration supports the original pre-round lobby checkpoint, persisted normal-round coordinates `vote`, `mingle`, `power`, and `reveal`, plus the first endgame entry coordinate `reckoning_lobby`; later endgame coordinates and blocked accumulators remain suspended and inspectable.

Note (as of 2026-06-30 endgame expansion): startup recovery supports staged endgame phase-boundary coordinates: `reckoning_plea`, `reckoning_vote`, `tribunal_lobby`, `tribunal_accusation`, `tribunal_vote`, and Judgment finale coordinates. Phase-boundary checkpoint identity includes the actor coordinate so transcript-only phases can persist distinct checkpoints at the same durable event head.

Note (as of 2026-07-02 Accusation Capsule V1): startup recovery now supports `tribunal_defense` through a structured `currentAccusations` accumulator payload sealed to the same checkpoint boundary. Recovery validates capsule version, boundary identity, active target/accuser IDs, player names, non-empty accusation content, and duplicate targets before hydrating `_currentAccusations`. Transcript prose, private trace text, and public dialogue remain non-authoritative for rebuilding accusation state.

### Current Resume Status (2026-07-02)

**Working now**

- Startup recovery is enabled by default. Set `INFLUENCE_API_STARTUP_RECOVERY=false` only to explicitly disable it.
- On API startup, pre-existing `in_progress` rows are immediately treated as orphaned and marked `suspended`; there is no "recent game may still be finishing" grace window in the single-API-process deployment.
- Recovery can claim a fresh owner epoch, hydrate the runner from persisted canonical events plus checkpoint resume inputs, append contiguous post-restart canonical events, and finish through the normal completed-results path.
- Supported actor coordinates: `lobby`, `vote`, `mingle`, `power`, `reveal`, `reckoning_lobby`, `reckoning_plea`, `reckoning_vote`, `tribunal_lobby`, `tribunal_accusation`, `tribunal_defense`, `tribunal_vote`, `judgment_opening`, `judgment_jury_questions`, `judgment_closing`, and `judgment_jury_vote`.
- Phase-boundary checkpoints store `actor_coordinate` so multiple transcript-only boundaries at the same event sequence can be ordered and recovered honestly.
- Startup recovery scans the newest phase-boundary checkpoints at the durable event head and selects the newest resume-capable checkpoint, not merely the newest checkpoint row. A newer unsupported same-head checkpoint leaves recovery free to use an older supported same-head boundary; if no checkpoint is resume-capable, recovery still fails closed.
- `tribunal_defense` checkpoints can carry Accusation Capsule V1 data through the `currentAccusations` accumulator. The payload is structured runtime state, not transcript-derived truth.
- Live local proof: `punk-khaki-bolt` recovered from round-2 `vote`, later recovered again from `reckoning_lobby`, appended canonical events through sequence 64 under fresh owners, closed the final owner healthy, wrote one completed result, and ended with Sage as winner.

**Known gaps**

| Boundary / Area | Status | Notes |
|---|---|---|
| Mid-phase interruption | unsupported | In-flight model calls and partially collected phase effects are still lost. The system resumes only from completed phase-boundary checkpoints. |
| Historical suspended games | opportunistic only | Old games can resume only if their latest event-head checkpoint has the implemented resume inputs. Missing transcript replay, missing token cursor, unsupported actor coordinates, or unsafe accumulators remain fail-closed. |
| Multi-worker / spot fleet | unsupported | Owner epochs fence durable writes, but startup recovery is still modeled around the current single API process acting as the worker. Real worker fleets need separate coordination and lease semantics. |

**Durable TODO hygiene**

When a statefulness slice lands, update this section, `docs/refactor-queue.md`, and any touched plan or solution note in the same branch. Completed durability work should not remain described as the next necessary TODO. After Accusation Capsule V1, there is no currently named phase-boundary accumulator blocker; the next honest risks are mid-phase interruption/in-flight model calls and, if deployment topology changes, graceful drain plus multi-worker lease/pub-sub coordination.

---

## Future Remediation Plan

The current durable kernel slice stores API canonical events, owner epochs, checkpoint evidence capsules, inspection metadata, and a supported startup resume path for implemented phase-boundary checkpoints through Tribunal defense/vote and Judgment. The steps below are the remaining work required before interrupted games can be recovered from mid-phase state or coordinated across deployment topologies.

### Phase 1: Resume Safety (single instance)

**Goal**: Preserve and extend safe-boundary coverage while keeping unsupported or accumulator-heavy boundaries fail-closed until they have structured runtime contracts.

#### 1.1 — Phase-Boundary Snapshots

After each phase completes in the game loop, serialize the full game state to the database.

**What to serialize** (a "checkpoint"):
- `GameState` — all fields via a new `toJSON()` / `fromJSON()` pair
- Canonical game events or an equivalent persisted event cursor — domain replay can rebuild accepted board facts, but it still needs to be paired with checkpoint metadata for API resume
- xstate snapshot — `actor.getSnapshot()` (already serializable)
- `GameRunner` accumulated data — transcript, whisper inbox, public messages, diary entries, elimination order
- `TokenTracker` usage — cumulative counts

**Schema change**: New `game_checkpoints` table:

```sql
CREATE TABLE game_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id),
  round INTEGER NOT NULL,
  phase TEXT NOT NULL,
  game_state JSONB NOT NULL,       -- GameState.toJSON()
  machine_snapshot JSONB NOT NULL,  -- actor.getSnapshot()
  runner_data JSONB NOT NULL,       -- transcript, whispers, diary, etc.
  token_usage JSONB,               -- TokenTracker snapshot
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_game_checkpoints_game ON game_checkpoints(game_id);
```

**Engine changes**:
- Add production-ready `GameState.toJSON(): object` / `static GameState.fromJSON(data): GameState` or hydrate from a persisted canonical event log plus checkpoint metadata
- Add `GameRunner.checkpoint(): CheckpointData` that returns all accumulated runner state
- Add `GameRunner.toJSON()` / `static GameRunner.fromCheckpoint()` to reconstruct mid-game

**API changes** (`game-lifecycle.ts`):
- In `runGameAsync`, after each phase boundary (when `runner.run()` yields control between phases), call `saveCheckpoint(db, gameId, runner)`
- This requires the game loop to expose phase-boundary hooks — either via the existing `streamListener` callback or a new `onPhaseComplete` callback on `GameRunner`

**Estimated complexity**: Medium. The state is already structured and partially replayable through canonical events. The remaining work is production persistence, XState snapshot storage, runner/agent checkpoint data, and the DB write after each phase.

#### 1.2 — Game Hydration (Resume from Checkpoint)

Build a `GameRunner.fromCheckpoint()` static factory that reconstructs a game mid-execution from a DB checkpoint.

**What can be restored**:
- `GameState` — full restore from JSON
- `PhaseMachine` — xstate supports `actor.start(snapshot)` to resume from a snapshot
- Transcript, diary, whisper inbox, elimination order — plain data restore
- `TokenTracker` — restore cumulative counts

**What CANNOT be restored**:
- LLM conversation history per agent — the OpenAI/Anthropic conversation context is lost. Agents resume with a fresh context window but can be given a summary of prior rounds from the transcript.
- `ViewerEventPacer` queue — acceptable loss; viewers reconnect and get persisted `GameWatchState` catch-up. This restores viewer shell facts, not runner execution.

**Mitigation for lost LLM context**: When resuming, inject a "game recap" system message into each agent's context built from the checkpoint transcript. This gives agents enough context to continue play, though they lose nuanced conversation memory. This is an acceptable tradeoff — games are short (4 rounds typical).

#### 1.3 — Graceful Shutdown Hook

On `SIGTERM` (sent by Docker/systemd before kill):

1. Set a shutdown flag — stop accepting new game starts
2. For each active game, call `saveCheckpoint()` to persist current state
3. Abort all runners (existing `abortAllGames()`)
4. Mark games as `suspended` (new status) instead of `cancelled`
5. Exit

On next startup:
1. Query for `suspended` games
2. Leave them suspended for inspection until resume-capable checkpoint support exists
3. Future work: load latest resume-capable checkpoint for each
4. Future work: resume via `GameRunner.fromCheckpoint()`
5. Future work: re-register in `activeGames` Map

**Schema change**: Add `suspended` to the game status enum.

#### 1.4 — Incremental Transcript Persistence

Currently transcripts are bulk-inserted after game completion (`game-lifecycle.ts:234-252`). Partial save only happens on error (`game-lifecycle.ts:412-437`).

Change to: write transcript entries to DB incrementally after each phase. This way, even without checkpoints, viewers can always replay what happened.

**Implementation**: Move the transcript insert logic into the phase-boundary hook from 1.1. Each checkpoint write also flushes new transcript entries since the last checkpoint.

### Phase 2: Scaling Readiness (multi-instance)

**Goal**: Multiple API instances can run games concurrently, with any instance able to serve WebSocket observers for any game.

#### 2.1 — Distributed Event Bus

Replace Bun's process-local `server.publish()` with Redis Pub/Sub (or a similar broker).

**Current flow**: `broadcastGameEvent()` → `server.publish(topic, message)` → only local WebSocket clients receive it.

**New flow**: `broadcastGameEvent()` → Redis `PUBLISH(topic, message)` → all instances subscribe → each instance forwards to its local WebSocket clients.

**Implementation**:
- Add `ioredis` dependency
- Create `RedisPubSub` adapter in `ws-manager.ts` that wraps publish/subscribe
- On game event: publish to Redis channel `game:{gameId}:events`
- Each instance subscribes to channels for games its clients are observing
- Fall back to local pub/sub if Redis is not configured (dev mode)

#### 2.2 — Game Ownership Lock

Only one instance should execute a given game. Use a database advisory lock or Redis distributed lock.

**Option A — Postgres advisory lock** (simpler, no new dependency):
```sql
SELECT pg_try_advisory_lock(hashtext(game_id));
-- Returns true if lock acquired, false if another instance holds it
-- Released on disconnect or explicit unlock
```

**Option B — Redis lock** (better for multi-DB setups):
- Use Redlock algorithm with `ioredis`
- TTL-based: lock expires if holder crashes (no manual cleanup needed)

**Recommendation**: Start with Postgres advisory locks since we already have Postgres. Move to Redis locks if/when we add Redis for 2.1.

**Implementation**:
- Before `runGameAsync`, acquire lock on `gameId`
- If lock fails → game is running on another instance → return error
- Lock released in `finally` block of `runGameAsync`
- On startup resume (Phase 1.3), re-acquire locks for resumed games

#### 2.3 — Sticky Sessions or Catch-Up Protocol

WebSocket clients connecting to instance B for a game running on instance A need to receive events. Two approaches:

**Option A — Redis Pub/Sub (from 2.1)**: Events flow through Redis to all instances. Any instance can serve any observer. Preferred approach.

**Option B — Sticky sessions**: Route WebSocket connections to the instance running the game. Simpler but requires a load balancer with game-aware routing. Not recommended for resilience.

With Redis Pub/Sub from 2.1, this is already solved.

---

## Migration Path

```
Phase 1.1  Broaden safe phase-boundary resume coverage, including staged endgame coordinates
Phase 1.2  Accusation Capsule V1 / full accumulator support for tribunal_defense and future accumulator-heavy boundaries [done 2026-07-02]
Phase 1.3  Graceful shutdown hook       ← Uses existing startup recovery path
Phase 1.4  Incremental transcripts      ← Independent hardening

Phase 2.1  Redis Pub/Sub                ← Independent of Phase 1
Phase 2.2  Game ownership lock          ← Depends on 2.1 for full value
Phase 2.3  Sticky sessions / catch-up   ← Solved by 2.1
```

**Recommended order**: 1.3 or 1.4 next only if the operational pain is visible; otherwise keep R1 API-backed local runs ahead of broader topology work. Phase 2 remains future until multiple API instances or cross-instance observers become real.

Phase 1 makes single-instance deploys safer at completed boundaries, but it does not make active execution generally crash-safe. Phase 2 enables horizontal scaling.

---

## Key Architecture Decisions

1. **Canonical events are a domain replay prerequisite, not resume by themselves.** The simulator event spine proves accepted board facts can rebuild a projection. API crash recovery still needs persisted event storage, XState snapshots, runner state, ownership, and resume orchestration.

2. **Checkpoint granularity: per-phase, not per-event.** Per-event would add latency to every LLM call. Per-phase (roughly every 30-120 seconds during a game) is frequent enough for minimal data loss and cheap enough to not impact performance.

3. **LLM context is not recoverable.** Agent conversation history with the LLM is ephemeral. On resume, agents get a transcript-based recap. This is acceptable because games are short (4 rounds typical, ~10 minutes) and agents already handle context well from system prompts.

4. **`suspended` vs `cancelled` status.** `suspended` distinguishes inspectable interrupted/failure runs from intentional cancellation. Suspended games now auto-resume only when the latest event-head checkpoint matches implemented resume support; unsupported runs remain suspended.

5. **Postgres advisory locks before Redis.** Avoids a new infrastructure dependency. Redis is only needed when we actually want distributed WebSocket pub/sub (Phase 2).

---

## Files That Need Changes

### Engine (`packages/engine/`)
- `game-state.ts` — Add production hydration support from checkpoint/event data
- `canonical-events.ts`, `canonical-event-log.ts`, `game-projection.ts` — Extend simulator-proven event replay into a persisted API event-store boundary
- `game-runner.ts` — Add `checkpoint()` method, `static fromCheckpoint()` factory, `onPhaseComplete` callback
- `token-tracker.ts` — Add `toJSON()` / `static fromJSON()` serialization
- `phase-machine.ts` — No changes needed (xstate snapshots already work)

### API (`packages/api/`)
- `src/db/schema.ts` — Add `game_checkpoints` table, add `suspended` to game status enum
- `src/db/migrations/` — New migration for above
- `src/services/game-lifecycle.ts` — Phase-boundary checkpoint writes now exist as evidence capsules; resume logic, graceful shutdown, and safe incremental transcript persistence remain future work
- `src/services/game-event-read-model.ts`, `src/services/game-projection-read-model.ts`, `src/services/game-durable-run.ts` — Durable-run inspection now validates persisted event rows, replays trusted events into a canonical projection summary, and redacts checkpoint/evidence metadata for operators.
- `src/routes/admin.ts` — Admin read endpoint now exposes durable-run inspection for a game ID or slug.
- `src/services/ws-manager.ts` — (Phase 2) Redis pub/sub adapter
- `src/index.ts` — Startup orphan classification now marks pre-existing `in_progress` runs suspended immediately, then configured startup recovery attempts same-game continuation; SIGTERM checkpointing and multi-worker handoff remain future work

---

## Open Questions

1. **Checkpoint retention**: How long to keep old checkpoints? Recommend: delete all but latest per game after game completes. Keep for 24h for debugging, then prune.
2. **Concurrent game limit per instance**: Should we cap `activeGames.size`? Currently unlimited. Recommend: configurable limit (default 5) to prevent OOM.
3. **Resume notification**: Should viewers be notified that a game was resumed? Recommend: yes, emit a system transcript entry like "Game resumed after interruption."
