# W1 — House results implementation review

Scope: [approved plan](../plans/2026-10-02-004-feat-werewolf-house-results.md). Worktree: `codex/werewolf`.

## Implemented

- Shared House results API with explicit game-kind dispatch, snapshot consistency and independent Public/Unlisted/hidden checks.
- Pure Werewolf outcome, revealed roster, survival and chronological night/day ballot facts. No provider calls, writes, migration or old-game backfill.
- One internal cursor-counting traversal for results evidence and replay windows; browser-safe contract separated from the server projection.
- House result header reused by Influence; Werewolf page with cast cards, accessible recap disclosures, desktop index and compact mobile section bar.
- Deliberate spoiler-labeled Results links from completed entry/library and replay settings; ending CTA and shared outcome wording.
- Shared guarded asset routes moved ahead of the Influence-only middleware so existing banners also work for Werewolf.

## Adversarial checks and resolutions

- A completed game row alone cannot establish an outcome. Missing terminal history, discontinuities, incompatible rules and forged resolved facts are rejected by canonical replay. Noncompleted lifecycle responses contain no results payload.
- Eliminated teammates retain faction victory; survival never determines winner labels. Draw is `day_limit`, not cancellation.
- Recap distinguishes majority checkpoints from final plurality, including hear-more versus unavailable abstentions, and protection versus no pack agreement.
- Omniscient evidence cursors are tested against actual replay entries; canonical event sequence is retained as identity. Hidden/silent entries are included in cursor counting. Mystery does not inherit results data.
- Browser compilation caught transitive server imports through shared labels; separated `results-contract.ts`.
- Visual review caught banner requests intercepted by the Influence-only kind guard; shared assets now mount before it and keep their own authorization.
- Initial Influence HTTP fixture lacked its terminal row and correctly returned unavailable; the fixture was completed instead of weakening the service.

## Validation

- `bun run test`: **2,211 passed, 5 skipped, 0 failed**. Focused results/watch/route rerun including the subsequently added maximum-duration case: **12 passed**.
- `bun run test:postgres`, pointed at a disposable local database: **1,831 passed, 0 failed**.
- `bun run check`: type checks and lint passed across all packages.
- Werewolf browser journey: **1 passed, 28 assertions**. Anonymous village/wolf/draw endings, six/eight-player rosters, real image decoding plus missing-image fallback, keyboard disclosures, exact source navigation, ending CTA, Mystery isolation, Unlisted noindex, and removal of already-loaded facts on hidden-game refetch.
- Existing Influence results/banner browser regression: **1 passed, 13 assertions**, covering anonymous and signed-in access, late images, sign-out, same-game navigation and hidden denial.
- Desktop and 390px mobile screenshots were inspected; no horizontal page overflow. Dense final ballots are expanded in the browser screenshot pass.
- Two browser reruns stalled during Next's route compilation before UI assertions. Moving only the test-owned `.next/e2e` cache aside restored a passing isolated run; operator servers and their normal build cache were untouched.

Maximum-duration fixture: 20 days, eight players, 2,330 events, 180 recap items, 160,013 JSON bytes. Direct rules fixture generation ~2.4 seconds, results projection ~0.8 seconds on this machine.

Desktop and mobile screenshots: `/tmp/w1-results-{village,wolves,disagreement}-{desktop,mobile}.png`. Browser databases are disposable. Operator games are untouched.

## Boundaries

W2 MCP, W3 review/learning, W4 House Cuts, W5 trailers/music, W6 art exploration and W7 visual failure parity remain separate. No generated editorial judgments, ranking, ratings, new scenes or provider calls were introduced. Local tests do not establish staging or deployment acceptance.
