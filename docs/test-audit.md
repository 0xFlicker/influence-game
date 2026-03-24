# Test Audit & Inventory

**Date:** 2026-03-24
**Author:** Founding Engineer
**Codebase version:** v0.8.1

## Summary

| Tier | Tests | Files | Duration | External Deps | Command |
|------|-------|-------|----------|---------------|---------|
| 1 - Unit/Mock | 124 | 6 | ~2.5s | None | `bun run test` |
| 2 - DB Integration | 138 (3 LLM-skipped) | 5 | ~9s | PostgreSQL | `bun run test:db` |
| 3 - LLM Integration | 1 active + 1 skipped + 5 mock | 2 | ~5-15 min | Doppler (OPENAI_API_KEY) | `doppler run -- bun test:engine:full` |
| 4a - E2E Smoke (Playwright) | 5 | 1 | ~30s | Running staging server | `bun run test:e2e` |
| 4b - E2E Infra Smoke (Puppeteer) | 8 | 1 | ~30s | PostgreSQL, Puppeteer | `cd packages/api && bun test src/e2e/e2e-smoke.test.ts` |
| 4c - E2E Full Game (Puppeteer) | 3 | 1 | ~11 min | PostgreSQL, Puppeteer, Doppler | `cd packages/api && doppler run -- bun test src/e2e/game-flow.e2e.test.ts` |

**Total: 280 tests across 16 files.**

---

## Tier 1: Unit/Mock Tests (No External Dependencies)

Fast, deterministic, zero-cost. **Run on every commit.**

### packages/engine/src/__tests__/game-engine.test.ts
- **Tests:** 48
- **Duration:** ~1.2s
- **What it covers:** GameState player management, vote tallying (empower/expose), POWER phase mechanics (pass/eliminate/protect), shield expiry, council vote execution, endgame state machine transitions, jury tracking, endgame vote tallying
- **Dependencies:** None. Pure in-memory state manipulation.
- **Stateful:** No (fresh GameState per describe block via beforeEach)

### packages/api/src/__tests__/websocket.test.ts
- **Tests:** 10
- **Duration:** <100ms
- **What it covers:** WebSocket manager: handleOpen/handleClose subscriptions, observer counting, broadcastGameEvent translation (transcript_entry -> message, phase_change, player_eliminated, game_over), sendSnapshot to single client, graceful no-server handling
- **Dependencies:** None. Mock WebSocket and Server objects.
- **Stateful:** No

### packages/api/src/__tests__/viewer-event-pacer.test.ts
- **Tests:** 12
- **Duration:** ~500ms (uses short setTimeout holds)
- **What it covers:** ViewerEventPacer speedrun mode (passthrough), live mode hold timings (vote end, power reveal, council end, elimination, diary end, whisper end), event ordering preservation, default hold config values, partial override
- **Dependencies:** None. Timer-based async tests.
- **Stateful:** No

### packages/web/src/__tests__/api-utils.test.ts
- **Tests:** 7
- **Duration:** <10ms
- **What it covers:** `estimateCost()` function (cost scaling by player count and model tier), `isFillAccepted()` response type guard
- **Dependencies:** None.
- **Stateful:** No

### packages/web/src/__tests__/constants.test.ts
- **Tests:** 17
- **Duration:** <10ms
- **What it covers:** `phaseToRoomType` mapping, `phaseColor`, `ENDGAME_PHASES` set membership, `PHASE_LABELS` completeness, `DRAMATIC_PHASES`, `CHAT_FEED_PHASES`
- **Dependencies:** None.
- **Stateful:** No

### packages/web/src/__tests__/message-parsing.test.ts
- **Tests:** 30
- **Duration:** <10ms
- **What it covers:** All message parsers (parseVoteMsg, parseEmpowered, parseCouncilVoteMsg, parsePowerAction, parseJuryVoteMsg, parseJuryTally, parseWinnerAnnouncement, parseJuryQuestion, parseJuryAnswer, parseEliminationVote, parseEmpowerTied, parseReVoteResolved, parseWheelDecides), `isParseableStructuredMsg`, `wsEntryToTranscriptEntry` conversion
- **Dependencies:** None. Pure string parsing.
- **Stateful:** No

---

## Tier 2: DB Integration Tests (Requires PostgreSQL)

Medium speed, deterministic, zero LLM cost. **Run before merging API changes.**

All DB tests use `setupTestDB()` which:
1. Connects to `TEST_DATABASE_URL` (default: `postgresql://influence:influence@127.0.0.1:54320/influence_test`)
2. Runs Drizzle migrations once per process
3. Truncates all Influence tables via CASCADE before each test

### packages/api/src/__tests__/db.test.ts
- **Tests:** 12
- **Duration:** ~1s
- **What it covers:** Schema CRUD: users (insert, unique wallet, nullable fields), games (insert, status default, status transitions), game_players (insert, multiple per game), transcripts (insert, auto-increment), game_results (insert, unique per game, null winner), cross-table full lifecycle
- **Dependencies:** PostgreSQL
- **Stateful:** Yes (truncated per test)

### packages/api/src/__tests__/auth.test.ts
- **Tests:** 18
- **Duration:** ~1.5s
- **What it covers:** JWT session tokens (create, verify, roles/permissions, invalid/tampered), requireAuth middleware (no header, invalid token, nonexistent user, valid user, roles attachment), requirePermission (block/allow/any-of), requireRole (block/allow), requireAdmin (block non-admin, allow RBAC, allow legacy ADMIN_ADDRESS, case-insensitive, block no wallet), optionalAuth (no header, valid, invalid)
- **Dependencies:** PostgreSQL + RBAC seed
- **Stateful:** Yes

### packages/api/src/__tests__/games-api.test.ts
- **Tests:** ~50
- **Duration:** ~3s
- **What it covers:** Full REST API test suite using Hono test client. Auth enforcement (all endpoints), POST /api/games (create, auto maxRounds, invalid JSON, defaults, game numbers, createdById), GET /api/games (empty, list, filter by status, player count), GET /api/games/:id (details with players, 404), POST /api/games/:id/join (add player, 404, not waiting, full, missing fields, userId), POST /api/games/:id/start (enough players, too few, not waiting, 404), POST /api/games/:id/stop (running, waiting, completed), GET /api/games/:id/transcript (empty, entries with names, ordering, 404, whisper toPlayerIds), full lifecycle (create->join->start->stop), hide/unhide (admin only, already hidden, 404, permission, unhide not hidden, filtering)
- **Dependencies:** PostgreSQL
- **Stateful:** Yes

### packages/api/src/__tests__/agent-profiles.test.ts
- **Tests:** 28 (3 LLM-dependent, skipped without OPENAI_API_KEY)
- **Duration:** ~2s without LLM tests
- **What it covers:** Agent profile CRUD (create, validation, minimal fields, list own profiles, get by id, update fields, stats reset on personality change, delete with FK cleanup), join game with saved profile (happy path, nonexistent, wrong user), AI personality generation (auth, validation, 503 without key; LLM: traits, archetype, refine)
- **Dependencies:** PostgreSQL; OPENAI_API_KEY for 3 generate tests
- **Stateful:** Yes

### packages/api/src/__tests__/game-lifecycle.test.ts
- **Tests:** 4
- **Duration:** ~3s
- **What it covers:** GameRunner (mock agents) producing transcript and persisting to DB, transcript entry structure validation, game completion (winner or max rounds), concurrent games running independently
- **Dependencies:** PostgreSQL + @influence/engine GameRunner
- **Stateful:** Yes

---

## Tier 3: LLM Integration Tests (Requires Doppler)

Slow, non-deterministic, costs real tokens. **Run before releasing engine changes.**

### packages/engine/src/__tests__/full-game.test.ts
- **LLM test:** 1 active ("runs a complete game with 4 LLM agents")
- **LLM test:** 1 skipped ("runs a complete game with 6 LLM agents" - manual only)
- **Mock test:** 1 ("Full game with scripted mock agents" - no LLM)
- **Duration:** 5-15 minutes for LLM test (15min timeout)
- **What it covers:** Complete game run with 4 real LLM agents (gpt-5-nano), validates phase cycle (Introduction -> Council -> elimination), multiple rounds, transcript output
- **Dependencies:** OPENAI_API_KEY via Doppler
- **Cost:** ~$0.05-0.15 per run (gpt-5-nano)
- **Stateful:** Yes (full game state)
- **Note:** Gracefully skips if OPENAI_API_KEY not set (returns early with warning)

### packages/engine/src/__tests__/stream-listener.test.ts
- **Tests:** 5
- **Duration:** ~2s
- **What it covers:** GameRunner stream listener: transcript_entry events, phase_change events, player_eliminated events, game_over event, getStateSnapshot during game, listener error resilience
- **Dependencies:** None (uses MockAgent, no LLM). Could be in Tier 1 but not included in `test:mock`.
- **Stateful:** Yes (runs full mock games)
- **Note:** This test does NOT need Doppler despite being in the engine test directory. It's excluded from `test:mock` because the engine's mock script only runs `game-engine.test.ts`.

---

## Tier 4: E2E Tests

### 4a. Playwright Smoke Tests (e2e/smoke.spec.ts)
- **Tests:** 5
- **Duration:** ~30s
- **What it covers:** Homepage loads (200 + title), API health check, games list API, games page loads, free queue page loads
- **Dependencies:** Running staging server (PLAYWRIGHT_BASE_URL, default: `http://influence-staging`)
- **Run:** `bun run test:e2e` (runs `bunx playwright test`)
- **Config:** `playwright.config.ts` - Chromium only, 30s timeout, 1 retry

### 4b. E2E Infrastructure Smoke (packages/api/src/e2e/e2e-smoke.test.ts)
- **Tests:** 8
- **Duration:** ~30s
- **What it covers:** Test DB creation with migrations and RBAC, wallet generation, admin/player user creation with JWTs, test server startup and health check, authenticated API requests, Puppeteer browser launch, test DB cleanup
- **Dependencies:** PostgreSQL, Puppeteer (headless Chrome)
- **Run:** `cd packages/api && bun test src/e2e/e2e-smoke.test.ts`

### 4c. E2E Full Game Flow (packages/api/src/e2e/game-flow.e2e.test.ts)
- **Tests:** 3 (sequential scenarios sharing state)
- **Duration:** Up to 11 minutes (10min game + 1min buffer)
- **What it covers:**
  1. Admin creates a 6-player budget live game (API + browser verification)
  2. 6 players join the game (API + browser verification of PlayerRoster)
  3. Anonymous viewer watches game play to completion (incognito page, polls until game ends)
- **Dependencies:** PostgreSQL, Puppeteer, OPENAI_API_KEY via Doppler (real LLM game)
- **Run:** `cd packages/api && doppler run -- bun test src/e2e/game-flow.e2e.test.ts`
- **Cost:** ~$0.05-0.15 per run (full 6-player game with gpt-5-nano)
- **Failure debugging:** Screenshots saved to `e2e-screenshots/`

---

## Test Hierarchy: When to Run What

```
                     Every Commit
                    +------------+
                    | Tier 1     |  bun run test
                    | 124 tests  |  ~2.5 seconds
                    | No deps    |  FREE
                    +-----+------+
                          |
                  Before API Merges
                    +------------+
                    | Tier 2     |  bun run test:db
                    | 138 tests  |  ~9 seconds
                    | PostgreSQL |  FREE
                    +-----+------+
                          |
                  Before Engine Releases
                    +------------+
                    | Tier 3     |  doppler run -- bun test:engine:full
                    | 6 tests    |  ~5-15 minutes
                    | Doppler    |  ~$0.10/run
                    +-----+------+
                          |
                  Before Staging Deploys
                    +------------+
                    | Tier 4a    |  bun run test:e2e (Playwright)
                    | 5 tests    |  ~30 seconds
                    | Staging    |  FREE
                    +-----+------+
                          |
                  Before Major Releases
              +-----------+-----------+
              | Tier 4b               | cd packages/api && bun test src/e2e/
              | 11 tests              | ~11 minutes
              | PostgreSQL + Puppeteer| ~$0.10/run
              | + Doppler             |
              +-----------------------+
```

---

## Gaps & Recommendations

### Tests NOT in `test:mock` that could be
- **stream-listener.test.ts** (5 tests): Uses MockAgent, no LLM. Should be added to engine's `test:mock` script.
- **full-game.test.ts mock section** (1 test): The "Full game with scripted mock agents" test uses MockAgent. Could be split or added to `test:mock`.

### Coverage gaps
- **No web component tests:** The `packages/web` tests only cover utility functions and parsers. No React component tests exist.
- **No API route handler unit tests:** API tests are all DB integration tests. Pure route logic could be tested without a database.
- **No WebSocket integration test with real Bun server:** The WS tests mock everything. No test validates actual Bun WebSocket connections.

### Abort/timeout concerns
- The LLM full-game test has a 15-minute timeout. If the LLM is slow or the API is down, this test blocks CI for the full timeout before failing.
- The E2E game-flow test polls for 10 minutes. If the game never completes, the entire test suite hangs.
- **Recommendation:** The `bun run test` command (Tier 1) is the only safe gate for pre-commit. Never gate commits on Tier 3+ tests.

### Token/cost optimization
- LLM tests use gpt-5-nano which is cheap but still costs real money.
- Running `doppler run -- bun test` in engine runs ALL engine tests including the LLM test. There's no way to run _just_ the mock engine tests plus the stream-listener tests without also triggering the LLM test (unless OPENAI_API_KEY is missing, in which case the LLM test skips gracefully).
- **Recommendation:** Add a `test:mock-all` script to engine that runs game-engine.test.ts + stream-listener.test.ts + the mock section of full-game.test.ts. This captures all free tests without triggering LLM calls.
