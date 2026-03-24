# Statefulness Remediation Plan

> **Status**: Draft — awaiting board review
> **Author**: Frontend Engineer (INF-98)
> **Date**: 2026-03-24
> **Scope**: Game engine (`packages/engine`) + API (`packages/api`)

---

## Problem Statement

Every running game holds its entire state in process memory with no mid-game persistence. If the process crashes, is redeployed, or needs to scale horizontally, all active games are irrecoverably lost. The architecture was originally designed around xstate's serializable state model, but the persistence layer was never built.

### Current Risks

| Scenario | Impact |
|----------|--------|
| **Process crash mid-game** | All running games die. Orphaned `in_progress` records cleaned up after 10-min grace period on next startup. No resume. |
| **Deploy while games active** | Identical to crash — process stops, all in-memory state vanishes. No graceful drain. |
| **Horizontal scaling** | Impossible — `activeGames` Map is process-local, WebSocket pub/sub is per-process (Bun), no distributed lock for game ownership. |

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

1. **Orphaned game cleanup** (`index.ts:79-103`) — On startup, cancels `in_progress` games older than 10 minutes.
2. **Partial transcript save** (`game-lifecycle.ts:412-437`) — On error, attempts to persist transcript before marking cancelled.
3. **Memory cleanup** (`game-lifecycle.ts:467-472`) — Clears `PgMemoryStore` on game end/error.

These are crash-mitigation (cleanup), not crash-recovery (resume).

---

## Remediation Plan

### Phase 1: Deploy Safety (crash-safe single instance)

**Goal**: A game that was running when the process stopped can be resumed after restart.

#### 1.1 — Phase-Boundary Snapshots

After each phase completes in the game loop, serialize the full game state to the database.

**What to serialize** (a "checkpoint"):
- `GameState` — all fields via a new `toJSON()` / `fromJSON()` pair
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
- Add `GameState.toJSON(): object` and `static GameState.fromJSON(data): GameState`
- Add `GameRunner.checkpoint(): CheckpointData` that returns all accumulated runner state
- Add `GameRunner.toJSON()` / `static GameRunner.fromCheckpoint()` to reconstruct mid-game

**API changes** (`game-lifecycle.ts`):
- In `runGameAsync`, after each phase boundary (when `runner.run()` yields control between phases), call `saveCheckpoint(db, gameId, runner)`
- This requires the game loop to expose phase-boundary hooks — either via the existing `streamListener` callback or a new `onPhaseComplete` callback on `GameRunner`

**Estimated complexity**: Medium. The state is already structured and serializable. The main work is writing `toJSON`/`fromJSON` pairs and adding the DB write after each phase.

#### 1.2 — Game Hydration (Resume from Checkpoint)

Build a `GameRunner.fromCheckpoint()` static factory that reconstructs a game mid-execution from a DB checkpoint.

**What can be restored**:
- `GameState` — full restore from JSON
- `PhaseMachine` — xstate supports `actor.start(snapshot)` to resume from a snapshot
- Transcript, diary, whisper inbox, elimination order — plain data restore
- `TokenTracker` — restore cumulative counts

**What CANNOT be restored**:
- LLM conversation history per agent — the OpenAI/Anthropic conversation context is lost. Agents resume with a fresh context window but can be given a summary of prior rounds from the transcript.
- `ViewerEventPacer` queue — acceptable loss; viewers reconnect and get a catch-up snapshot.

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
2. Load latest checkpoint for each
3. Resume via `GameRunner.fromCheckpoint()`
4. Re-register in `activeGames` Map

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
Phase 1.1  Phase-boundary snapshots     ← Highest priority
Phase 1.2  Game hydration (resume)      ← Depends on 1.1
Phase 1.3  Graceful shutdown hook       ← Depends on 1.1 + 1.2
Phase 1.4  Incremental transcripts      ← Independent, can parallel with 1.2

Phase 2.1  Redis Pub/Sub                ← Independent of Phase 1
Phase 2.2  Game ownership lock          ← Depends on 2.1 for full value
Phase 2.3  Sticky sessions / catch-up   ← Solved by 2.1
```

**Recommended order**: 1.1 → 1.4 → 1.2 → 1.3 → 2.1 → 2.2

Phase 1 makes single-instance deploys safe. Phase 2 enables horizontal scaling. Phase 1 is the immediate priority.

---

## Key Architecture Decisions

1. **Checkpoint granularity: per-phase, not per-event.** Per-event would add latency to every LLM call. Per-phase (roughly every 30-120 seconds during a game) is frequent enough for minimal data loss and cheap enough to not impact performance.

2. **LLM context is not recoverable.** Agent conversation history with the LLM is ephemeral. On resume, agents get a transcript-based recap. This is acceptable because games are short (4 rounds typical, ~10 minutes) and agents already handle context well from system prompts.

3. **`suspended` vs `cancelled` status.** New status distinguishes intentional pause (deploy) from failure. Suspended games auto-resume on startup; cancelled games do not.

4. **Postgres advisory locks before Redis.** Avoids a new infrastructure dependency. Redis is only needed when we actually want distributed WebSocket pub/sub (Phase 2).

---

## Files That Need Changes

### Engine (`packages/engine/`)
- `game-state.ts` — Add `toJSON()` / `static fromJSON()` serialization
- `game-runner.ts` — Add `checkpoint()` method, `static fromCheckpoint()` factory, `onPhaseComplete` callback
- `token-tracker.ts` — Add `toJSON()` / `static fromJSON()` serialization
- `phase-machine.ts` — No changes needed (xstate snapshots already work)

### API (`packages/api/`)
- `src/db/schema.ts` — Add `game_checkpoints` table, add `suspended` to game status enum
- `src/db/migrations/` — New migration for above
- `src/services/game-lifecycle.ts` — Phase-boundary checkpoint writes, resume logic, graceful shutdown, incremental transcript persist
- `src/services/ws-manager.ts` — (Phase 2) Redis pub/sub adapter
- `src/index.ts` — Startup resume logic for `suspended` games, SIGTERM handler

---

## Open Questions

1. **Checkpoint retention**: How long to keep old checkpoints? Recommend: delete all but latest per game after game completes. Keep for 24h for debugging, then prune.
2. **Concurrent game limit per instance**: Should we cap `activeGames.size`? Currently unlimited. Recommend: configurable limit (default 5) to prevent OOM.
3. **Resume notification**: Should viewers be notified that a game was resumed? Recommend: yes, emit a system transcript entry like "Game resumed after interruption."
