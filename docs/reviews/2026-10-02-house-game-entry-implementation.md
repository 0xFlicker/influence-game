---
title: House game entry implementation evidence
date: 2026-10-02
status: implemented
---

# House game entry — W0 and R35 core

Implemented in `/Users/user/.codex/worktrees/werewolf/influence-game`, branch `codex/werewolf`, starting from `c0519b4e`. The checkout was clean before this work. No deployment, commit, push, paid generation or development-database migration was performed.

## Delivered

- Optional-auth routing identity at `GET /api/game-entries/:idOrSlug`, allowlisting only ID, canonical slug and kind. Both public games work anonymously. Hidden/missing entries return 404; private Influence preserves owner/participant/operator access. Config errors remain errors. All direct game/watch/media guards remain independent.
- `/games/:slug` and `/games/:slug/replay` dispatch explicitly by that identity. No probing the wrong engine, second Werewolf page tree or old-route redirect. Results/highlights/sequence routes reject Werewolf until their corresponding modules exist. No disabled parity notices were added.
- Shared House episode/card/casting/portrait/site components. Influence keeps its preview/trailer and game-specific controls; Werewolf supplies safe cast data, House art and audience choices. The module lives in `components/games/werewolf/`.
- One `join_game` create-agent flow, using resolved identity to select the correct join transport. Recovery now includes `werewolfStrategyStyle`; other shared and game-specific draft fields retain their existing behavior.
- Cards, creation redirects, admin spectator links, API producer casting errors and CLI launch links use House routes. Active usage documentation follows the cutover.
- **Share this moment** in shared player settings, with native-share/clipboard feedback. Influence emits canonical event-sequence URLs; Werewolf emits explicit audience plus source cursor and loads the correct initial window. Sharing leaves play/pause intent alone. Explicit Influence sequence intent now survives the live-mode path as well as completed replay.

## Test evidence

| Check | Result / scope |
|---|---|
| `bun run test` | 2,204 pass, 5 pre-existing skips, 0 fail; 217 files, including classification and new House route tests |
| `bun run test:postgres` | 1,834 pass, 0 fail; 155 files, run against a newly migrated disposable database |
| Focused PostgreSQL follow-up | 12 pass, 0 fail; routing identity/malformed visibility and Werewolf admin after final link cleanup |
| Werewolf Puppeteer suite | 8 pass, 0 fail; actual local API + isolated DB, create/join/edit/start, desktop/mobile, fixed audiences, pack isolation, producer pages, hide revocation, delayed seeks, preferences, reduced motion, failed portraits and later-window sharing |
| Influence Playwright regression | 4 pass: captured thinking/order, fitted speech pagination, Mingle/fullscreen across screen sizes, classic replay/results |
| Influence sharing | 2 pass: canonical public-reveal roundtrips in completed and live Influence games |
| Repository check | `bun run check` passed: all workspace typechecks and lint checks, after restoring generated-only browser configuration |
| Visual inspection | Reviewed House Werewolf entry screenshots at narrow/tablet widths; mobile actions readable and no horizontal overflow. Existing browser journeys also assert fullscreen and mobile presentation. No claim of an exhaustive visual redesign |

Browser sharing checks assert the source position actually reopened, not just the link string. Werewolf starts after cursor 32 without a cursor-1 request; Mystery makes no thinking request. Invalid/repeated audience is rejected before watch loading. Influence shares the public vote-resolution event: private sealed ballot events do not become independently shareable reveals.

## Operator notes and rabbit holes

1. The shared `influence_test` database had migration-ledger/schema drift (missing `werewolf_lobby_seats`). Used a fresh isolated database rather than changing the operator's development DB or migration history. The temporary full-suite wrapper initially passed a DB object instead of its URL to cleanup; its exact orphan database was identified and removed, and the wrapper corrected. Other databases were untouched.
2. Puppeteer and Playwright both use `.next/e2e`. Concurrent launch hit Next's dev lock; subsequent runs were serialized. Next also rewrote generated type imports/includes. Those generated-only edits are restored after harness shutdown. A future per-process build directory would remove this harness restriction.
3. Old Influence tests still looked for obsolete control labels and thinking controls permanently inside settings. Updated selectors to the current responsive shared transport. This was test maintenance, not a gameplay change.
4. Private Werewolf transport support remains W7. The common identity endpoint fails closed for private Werewolf instead of suggesting the public watch/media services already support private access. Broader visibility/listing consolidation and the pre-existing Influence detail hidden-access discrepancy remain outside W0.
5. R35 core is present. Influence retains existing nearest/last sequence clamping and canonical-event granularity; historical cues without a stable sequence emit no guessed link. Werewolf rejects unavailable initial cursors. Review stricter Influence unavailable-location behavior and extend private authenticated UI/native-device-share verification in R35 follow-up.
6. W1 Results, W2 frozen MCP, W3 learning/review, W4 editorial Cuts with human approval, W5 trailer/music with human approval, W6 wolf/night art, W9 art exploration and A2 Production studio remain separate work. The MCP banner remains verbatim.

## Tools and proof boundaries

Used Bun unit/component tests, fresh PostgreSQL integration tests, Puppeteer against real local routes, Playwright against deterministic Influence payloads, screenshot inspection and git whitespace/caller audits. The existing browser CLI/native-browser tools are available for exploratory work; automated harnesses supplied repeatable assertions here. No real Clerk, live-model quality, paid visuals, staging, social publication or native mobile share-sheet testing was performed.

For a third game, follow [exported integration knowledge](../solutions/architecture-patterns/house-game-entry-and-replay-moments.md). Share the product shell and stable controls; keep authorization policy, canonical facts, audience projection and timing with the concrete game.
