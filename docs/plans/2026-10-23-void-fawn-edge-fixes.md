# Mixed-model game: fixes and implementation

Game: `void-fawn-edge` (`f3c0a374-460f-49d2-8b1c-3673e4fa229e`).

**Implementation authorized after the user stopped the game.** Changes are in the working tree; verification uses provider-free tests and an isolated PostgreSQL test database. The watcher is paused. No paid tests, game restart, stopped-game route rewrite or historical data repair was performed. The findings below preserve the original diagnosis and evidence.

## Findings at inspection

1. **Keep the game default in explicit-model fallback routes.** The game default is OpenAI `gpt-6-luna` (Flex), followed by Katana Grok 4.6. The route construction replaced Luna with the character's preference, producing `preferred → Grok`. Expected: `preferred → Luna → Grok`, skipping duplicate models. Preserve admin-defined ordering and define Luna's fallback allowance explicitly; do not invent an unlimited allowance. Apply to future games without rewriting this game's frozen routes.

2. **Honor provider cooldowns without blocking the game.** GLM returned `Retry-After: 60`, but the coordinator retried about one second later. For this failure, advance immediately to an eligible fallback and prevent further calls to the failing GLM route until its cooldown expires. Keep working Katana routes usable. Cooldown scope and persistence must hold across actors/restarts. Acceptance: no repeat GLM call within the cooldown and no mandatory 60-second wait before a fallback can run.

3. **Preserve useful error detail in diagnostics.** The summary says `502 status code (no body)`, although captured evidence contains a structured Cloudflare error body. Surface the sanitized status, error code, retry delay and request/ray ID in producer diagnostics. Keep raw bodies and developer warnings out of model pickers.

4. **Resolve Claude's conversation-schema incompatibility without weakening validation.** Opus 4.7's Lobby request returned HTTP 400: `output_config.format.schema: Invalid schema: Enum value None does not match declared type '['string', 'null']'`. The submitted `conversation_turn` schema has nullable enums for recipient and reply IDs. Katana's captured response reports the same rejection across four upstream providers. This is a confirmed request-schema compatibility failure, not a refusal. Preserve the exact permitted IDs and null/pass semantics when choosing a supported schema representation. Evidence: `provider-attempt:b5c9f89aa75be8265ea7e360b1378d5e939ea46f6c603fd0c704fd036e0dac1e`, request `9cb27edc-78c0-4de5-b83e-9847a3c7fdb8`.

5. **Make private strategy serialization deterministic across recovery (blocking, confirmed application defect).** Veyra's unfinished turn 23/subcall 1 hashes `compactionCharacter.currentStrategy`, which `packages/engine/src/agent.ts:5993` creates with ordinary `JSON.stringify`. This converts object field order into significant string bytes. The running store caches the in-memory commit result (`packages/api/src/services/durable-game-runner-store.ts:198`); recovery reads continuity capsules from PostgreSQL `jsonb` (`packages/api/src/db/schema.ts:1211`, `packages/api/src/services/game-execution-state.ts:27`). `cloneCompactStrategyState` spread that object and preserved its incoming order (`packages/engine/src/strategy-state.ts:43`). Consequently the same opening strategy serializes differently:

   ```json
   {"lifecycle":"opening","baseline":null,"deltas":[],"priorEpoch":null,"revision":0}
   {"deltas":[],"baseline":null,"revision":0,"lifecycle":"opening","priorEpoch":null}
   ```

   The outer canonical hash cannot normalize JSON already embedded in a string. This metadata is not sent in the provider request at revision zero, so identical model-facing messages can still fail the guard at `packages/engine/src/provider-adapters.ts:118`.

   **Evidence:** Both GLM attempts and the Grok timeout have identical messages and source hash `sha256:85a543a77e89b965a9a706d3966c83ee0781b8957ce32035fea016f8dc3ae843`. Manifests: `provider-attempt:b4464d91cbe70209a77a76180bc2104d4bc113e4e519a4de9b63bf3d715378ef`, `provider-attempt:2dae22a73d8246a3b5d2db9e33976932ca4807ffc1f9348b53ed539d8c79247b`, and `provider-attempt:3c2be4f19920f44e6221af3e2850f7e6e8646b02b31184a039484210521b811b`. A provider-free reconstruction from the captured request reproduced that exact hash, including seven context spans. Changing only the strategy string to the JSONB field order produced `sha256:2e72fef43aa0b9214c892f1bf1d65b3f8c6195e00de7ad28969da0974ea70f1a` and the exact reported exception through the existing execution code, with **zero dispatches**. Explicitly restoring the declared strategy field order restored the original recorded hash. The second hash is an offline reproduction, not a captured live retry hash: the guard at inspection recorded neither the candidate hash nor a field diff. Localhost inspection at `2026-10-24T03:24:02.125Z` still showed turn 22/event 16/dialogue 40 and another `runner_interrupted` closure.

   **Fix:** Serialize compact strategy in one explicit, deterministic field order, including nested prior-epoch state, before embedding it in context metadata. Use the same representation for initial calls, retries and restored agents. For this turn, the unchanged opening state must reproduce its existing hash; retain the guard and all attempt history. Add provider-free coverage for reordered keys and genuine value changes, plus a PostgreSQL recovery regression for an interrupted call after a failed fallback. Require equal messages, spans, schema and source hash across recovery, while real context changes still fail. Record sanitized component hashes for future conflicts and stop automatic reacquisition from repeatedly retrying an unchanged deterministic conflict. Live recovery remains a separate action and was not attempted.

## Implementation

- **Routing:** Explicit preferences now precede the full game-default route, with duplicate models removed. The default has an admin-editable shared recovery cap (`defaultModelMaxFallbackCalls`, initially 24). House budgets remain separate and Luna stays Flex. Existing frozen games are unchanged.
- **Cooldowns:** A valid future `Retry-After` causes immediate fallback and a durable model-scoped cooldown. Other Katana models remain usable. Dispatch or Daily admission expires the cooldown; authentication/configuration circuits retain explicit probe recovery. Migration `0130_provider_route_cooldowns` adds the required health values.
- **Diagnostics:** Summaries include captured status, safe error code, retry delay and ray ID when available. The misleading no-body wording is replaced when structured captured evidence exists. No picker warnings were added.
- **Claude:** Katana Claude requests translate nullable enums into equivalent `anyOf` branches, following the [Claude structured-output reference](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). Exact local validation and semantic context hashes remain unchanged. Mocked schema-equivalence tests cover legal/null values and malformed objects; live Katana acceptance remains unverified.
- **Recovery:** Strategy cloning reconstructs explicit field order. PostgreSQL coverage exercises JSONB reordering after a failed fallback, genuine context-change rejection, successful recovery and accepted-result replay. Genuine conflicts now mark Influence execution `repair_required` under the owner fence and log hashes, preventing repeated automatic adoption while preserving committed history.

### Validation

- `bun run test`: 2,822 passed, 5 skipped, no failures. The sandbox blocked local test HTTP listeners; the successful run used loopback-enabled execution.
- `bun run check`: all package type checks and lint passed. `git diff --check` passed.
- `bun run test:postgres` on the disposable database: 2,176 passed, plus one unrelated 30-second cleanup-hook timeout in `staging-render-proof.test.ts`. Its eight assertions passed during the suite; a fresh isolated rerun also passed all eight tests with successful cleanup. The full command therefore was not entirely green. All changed routing, recovery, cooldown and probe tests passed in that run.
- Focused engine regressions: 98 passed. Offline six-model CLI preview confirmed explicit preference → Luna → Grok, shared default cap 24 and a separate House route.
- Fresh database migrations, including `0130`, succeeded. The shared local test database had a pre-existing migration-history mismatch at `0129` (duplicate `rate_card`); it was left untouched. No paid inference, live provider validation, game restart or application-data migration was performed.

**Test database repair — October 23 follow-up:** At the user's explicit request, the default local `influence_test` database was dropped and recreated. Normal test setup rebuilt all 131 migrations; every stored migration hash and timestamp matches the repository. The four targeted PostgreSQL files passed (66 tests), and a second independent process reused the default database successfully (15 tests). No `TEST_DATABASE_URL` override was needed. The earlier migration mismatch is resolved; `influence_dev` was untouched.

## Resume follow-up: unavailable response misclassified as accepted (fixed)

The later resume reached commit and failed with `Provider call sha256:416f4f51b03d79ad6960de86ef5ac87ed7f15074914760b650c244f2b9f63eb6 has no accepted value`. Read-only local database inspection confirmed this is Veyra's turn 23, slot 1, action `mingle-turn`, with `accepted_attempt_id = null`. Recorded attempts include GLM HTTP 502 failures (ordinals 1–2) and Grok timeouts (ordinals 3 and 5); the later timeout ended at `2026-10-24T04:08:46.685Z`. The committed frontier remained turn 22/event 16/dialogue 40.

**Root cause:** `getConversationTurn` returns a legal unavailable pass with `providerAbsence: { kind: "provider_exhausted", outcome: ... }`. `providerResultWasAccepted` incorrectly checked `providerAbsence === true`, so it added the failed logical call to the draft's accepted-call list. The database commit guard correctly rejected that false claim. This is a separate application defect exposed after the context-order fix, not missing successful evidence.

**Fix:** Treat the presence of the typed absence marker as unaccepted. Keep the strict commit guard and failed-attempt evidence. A model-authored pass without the absence marker still counts as an accepted response. Regression coverage reproduces the false acceptance, excludes unavailable performance cues, and verifies that an unavailable turn can commit and replay without fabricating an accepted provider value. No development-game rows or frozen routes were changed and no live resume was initiated.

**Verification:** The regression failed before the change. Afterward, 32 engine tests and 11 PostgreSQL commit/recovery tests passed. The database guard still rejects any draft falsely claiming the unsuccessful call was accepted.

## Round 2 Empower presentation mismatch (fixed; recorded outcome preserved)

Localhost MCP canonical events 41–48 show an initial Arden/Rowan tie, clearing only Marnie/Milo/Larry's votes, their three replacement ballots (Rowan/Arden/Arden), then Rowan selected by `wheel`. The viewer's `validEmpoweredSetWinner` counts only the replacement ballots (Arden 2, Rowan 1). Execution's `resolveEmpowerRevote` counts the complete active tally, including Arden's retained vote for Rowan (and Rowan's retained vote for Marnie, outside the tied set), so it sees Arden 2, Rowan 2 and uses the wheel. The viewer therefore emits `empower_tally_mismatch`: “Final Empowered agent does not match the accepted revote state.” The event log is complete with no MCP diagnostics; this is a counting-semantics disagreement, not missing data or a provider failure.

The agreed rule for new games is new ballots only. Game creation now freezes `empowerRevoteVersion: 2`; canonical initialization records it and recovery retains it. Existing games without a version use version 1 for all remaining rounds, counting the active ballots. Engine and viewer share the versioned tally function; neither selects rules by matching a tally to the winner. This game remains version 1: its recorded round-2 tally displays Arden 2 (Milo, Larry) and Rowan 2 (Marnie, Arden), followed by Rowan’s recorded random wheel win. There is no historical warning in the viewer. Under version 2 these new ballots yield 2–1, so no wheel occurs. No recorded events, votes, outcomes or provider evidence are rewritten, and no game is resumed by this fix.

Regression coverage includes the same five-player ballot pattern, recovery between revoters, exclusion of earlier rounds, true ties and no eligible revoters, preserved historical playback, and rejection of missing ballots or contradictory new-rule outcomes.

Verification: a fresh localhost MCP read confirmed events 41–48 are unchanged, including Rowan's `wheel` result. Compiling the actual recorded round-two prefix now returns `ready` with no diagnostic. Browser playback shows the initial tie, revote receipts and preserved result in both embedded and fullscreen views; Empower tally scenes use the existing fit-to-frame layout so shorter viewports retain the full ledger. Both durable and non-durable execution use the shared revote resolver.

Validation after freezing rule versions: 2,841 provider-free tests passed (5 skipped); typecheck and lint passed. The fresh PostgreSQL suite passed all 2,182 test cases but reported one unrelated 30-second staging-render cleanup-hook timeout. That file passed all 8 tests in isolation. Coverage includes both rules, legacy recovery and later rounds, stored creation configuration, terminal playback, and exports that preserve historical source hashes. The saved localhost MCP round-two prefix still compiles to the 2–2 tally and Rowan’s recorded wheel win. No paid inference or live-game mutation was used.


## Provider issue, not an established application defect

Six inspected GLM Flash attempts failed across introduction, round-one Lobby and voting: all HTTP 502, `origin_bad_gateway`, with response times of roughly 0.6–1.4 seconds. Cloudflare reports an invalid or incomplete response from Katana's origin. No refusal or generated GLM output was returned. The underlying origin failure remains unknown; the evidence does not establish a prompt, schema or capability defect.

Evidence is retained in the game's localhost MCP provider-attempt manifests. Example: `provider-attempt:540eff04c0b276b50fa537e2839dce874bd5c2a2454d4022bdc88c350103e986`; Cloudflare ray `a4f5c76e6ddc5599-DEN`.

## Observation discipline

Record preferred versus actual models separately: Veyra's initial accepted response came from Grok after GLM failed. Fallback responses must not be credited to GLM in the eventual game comparison. Add findings with evidence and distinguish confirmed defects from hypotheses; do not change agents, routing, execution state or application code while collecting them.

## Watch checkpoint — October 23, 9:16 p.m. MDT

- Canonical round 1: Arden was empowered and selected Even Votes; all six remain alive. Current phase is Format Mingle.
- Preferred/accepted calls at the checkpoint: Kimi 6/6, Opus 2/4, GLM 0/3, DeepSeek 3/3, Gemma 3/4, Muse 4/4; House Sol 8/8. All alternate accepted calls used Grok. These are routing counts, not model-quality scores.
- **Repeated execution interruption (see fix 5).** Localhost `inspect_durable_run` showed newly acquired owners closing with `runner_interrupted`, while committed turn 22/event 16/dialogue 40 and planned turn 23 (`mingle-beat-1`, planned at `2026-10-24T03:14:25.612689Z`) stayed unchanged. Observed closures include `2026-10-24T03:15:43.757Z`, `2026-10-24T03:16:09.754Z` and `2026-10-24T03:18:51.950Z`. Game status remains `in_progress`, kernel healthy, authority ready. Subsequent investigation reproduced the strategy-field-order conflict in fix 5; no live recovery has been attempted. Do not label this corrupt state or mutate/resume the game during observation.
