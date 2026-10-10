---
title: "W7B follow-through — shared participation history, separate competitive records"
date: 2026-10-06
status: completed
parent: 2026-10-05-005-feat-house-journey-parity.md
---

# Shared House history, game-specific competitive records

## Outcome and product decisions

An owner or profile visitor sees Influence and Werewolf together in one chronological history. Every entry identifies its game and describes that game's actual outcome. Ratings, points, standings and aggregate win rates retain explicit game scope.

This closes the profile/history gap in W7B B3. The operator clarified that mixing history is desirable; mixing leaderboard and score semantics is the concern. It does not introduce Werewolf ratings, a cross-game leaderboard or a new scoring formula.

- History defaults to **All games**, with an optional Influence / Werewolf filter in the existing surface. No additional top-level navigation.
- A Werewolf faction victory counts as a victory for every canonical winning member, including an eliminated member. Survival is a separate fact.
- Influence competitive records remain Influence-only and are visibly labeled as such. A Werewolf-only player has history and no Influence competitive record.
- Completed history is an outcome-bearing surface: label it **Results · Spoilers**. Game cards elsewhere remain spoiler-safe; viewing history does not change a saved Mystery replay preference.
- Existing completed games appear from persisted evidence without new games, model calls, image regeneration or a paid backfill.

## Source findings

| Surface | Current behavior | Required change |
| --- | --- | --- |
| `packages/api/src/routes/games.ts`, `GET /api/player/games` | Reads only `gamePlayers`; returns one row per owned seat. Performs per-seat queries and invents last place for every nonwinner. | Delegate to a shared participation read service. Add Werewolf via its canonical roster/results; use existing authoritative Influence results instead of fabricating placement. |
| `packages/api/src/services/public-agent-preview.ts` | Public recent results and per-agent aggregates both come from eligible public Daily Free Influence competition receipts. | Separate the history read from competition aggregates. Public history includes public completed participation, including custom Influence and Werewolf; competitive eligibility does not gate history. |
| `packages/api/src/services/public-player-profile.ts` | Combines receipt-based recent results, account career and agent previews. | Return mixed recent participation while retaining explicitly Influence-scoped career and competition fields. |
| `packages/web/src/app/dashboard/dashboard-mission-control.ts` | Computes games, wins and win rate from the same history array used to pick the latest result. | Latest result may be either game. Influence aggregates must filter by game kind and must not be calculated from a truncated history page. |
| `packages/web/src/app/dashboard/dashboard-agent-bench.tsx` and `packages/web/src/app/profile/[id]/public-player-profile.tsx` | Assume placement, individual winner and points. | Render common identity/link/date plus a typed game-specific result. Never show a Werewolf placement or zero-point placeholder. |
| `packages/api/src/services/owner-learning-eligibility.ts`, `loadOwnedWerewolfSeatRows` | Connects owned profile IDs to frozen players in canonical `werewolf.started`, including direct-created games. | Reuse the identity approach, not review eligibility, full private evidence or an unbounded scan. Lobby seats alone are not a historical participation source. |
| `packages/api/src/services/house-game-results.ts`, `completed-game-results.ts`, engine `werewolf/results.ts` | Already provide validated game-specific completed outcomes. | Reuse these authorities and extract only the small history allowlist. Do not add another rules reducer. |
| `packages/api/src/routes/profile.ts`, `free-queue.ts`, competition/season services | Account ELO and agent/season competition are separate existing score systems. | Audit both write and read boundaries; prove Werewolf cannot change either. Scope their UI labels without changing formulas. |

Relevant prior learning: [shared episode presentation](../solutions/architecture-patterns/house-episode-presentation-across-game-kinds.md). Shared endpoint routing, explicit public field allowlists and saved episode titles apply here too; a review picker is not proof of profile/history coverage.

## H1 — shared participation read contract

Add one API service for completed participation with two small game adapters. Keep the current owner history endpoint and public profile endpoint; update their contracts and consumers together. No parallel Werewolf profile page, plugin registry or compatibility response.

Use a discriminated union keyed by `gameKind`. Common fields: stable game ID/slug, saved episode title with slug fallback, completion time, stable seat/player ID, optional agent profile ID, frozen agent display name and cast size. Use `(gameId, playerId)` as row identity; one owner may have several agents in a game. Keep those rows distinct, with separate outcomes, ordered deterministically by completion time, game ID and player ID. Never infer an owner's single faction from several opposing agents.

| Result variant | Facts exposed |
| --- | --- |
| Influence | Canonical placement when available, individual win/loss, elimination fact when available, round count. Points only when an eligible competition receipt actually awards them. Preserve the existing completed-results service's explicit historical limitations; unavailable placement is not last place. |
| Werewolf | Faction, win/loss/draw, alive/eliminated at completion, day count. Derive victory from canonical `winnerIds`; use the explicit draw outcome before classifying nonwinners as losses. No points, rank or rating fields. |
| Unavailable result | Participation identity can remain visible with **Result unavailable** when the start/seat evidence is valid but terminal evidence cannot be validated. No inferred win, loss, survival or placement; emit the existing diagnostic path. |

History reads must not write competition receipts, ratings, account counters, learning credits or completion effects. Do not spread a frozen Werewolf player or complete results payload into the DTO: strategies, roles beyond the selected outcome fields, private dialogue, night actions and reasoning stay out.

Ownership is keyed by stable IDs, never names. Influence uses persisted seat ownership. Werewolf matches owned profile IDs to canonical opening players, as the existing owner-learning read does. Current profile ownership is the existing Werewolf association, not a newly invented historical owner snapshot. Confirm archive/moderation rules before exposing profile links; retain permitted frozen participation when an agent is renamed or archived, while withholding current content/links under existing eligibility policy. Do not infer an owner for an unowned fill character. If ownership transfers or missing profile records require a new policy, report that dependency rather than guessing or adding a migration in this slice.

Keep visibility explicit: public profiles list only Public, nonhidden games; authenticated owner history may list that owner's Public and Unlisted participation. Neither feed discovers hidden games or another owner's Unlisted games. An Unlisted game's direct viewer remains accessible by its known slug. Apply visibility before limiting or projecting results.

For the first version, preserve the owner endpoint's complete-history behavior and the public profile's five-row recent limit. Apply the selected game-kind filter before the public recent limit, then combine candidates with stable ties; fetch only the necessary canonical histories for those candidate games. The public filter must query the selected scope, not filter only the five rows already displayed. Batch source reads and deduplicate game loads across multiple owned seats. Avoid scanning every Werewolf event stream or one query chain per seat. Do not introduce pagination, a materialized history table or a job/backfill until measured need justifies it. Public history membership must be filtered before the candidate limit so unrelated games cannot hide an owner's entries.

## H2 — existing House surfaces

Update `PlayerGameResult` and public recent-result types to the shared discriminated contract (shared fields plus game-specific outcome); update all consumers found by typecheck rather than adding optional Werewolf fields to an Influence-shaped object.

- Dashboard latest result can be either game and links to `/games/[slug]` or its shared results route. The game badge and outcome make its meaning clear.
- Public profile recent results use the same row presentation, with the existing compact list size and All games filter. Agent-specific presentation filters the same records by stable profile ID wherever a history surface already exists; do not invent a new agent page.
- Row examples: **Werewolf · Village victory · Eliminated day 2** and **Werewolf · Wolves defeated · Survived**. Draw is **Werewolf · Draw** with survival separate. Only display an elimination day if provided by canonical results.
- Use saved episode titles, frozen agent names and stable slug links. Keep responsive wrapping, keyboard navigation and empty/loading/error states. No generated artwork is required.
- Label account career, agent competition summaries, season standings and leaderboard headings **Influence** where they would otherwise look cross-game. Keep their existing score units and eligibility distinctions; do not imply account ELO and season points are the same measure.
- Dashboard wins/win rate remain Influence-scoped. If keeping a mixed activity count, label it **Participations** and count owned seats consistently; do not call multiple owned seats multiple distinct games. Prefer existing Influence summary metrics over adding a new cross-game statistic.

No aggregate Werewolf win rate or leaderboard in this version. A future Werewolf score requires its own defined policy and fixtures; shared history does not authorize reusing Influence's ranking algorithm.

## H3 — score isolation and historical acceptance

Audit every Werewolf completion entry point, including resumed durable execution, against account ELO, account career counters, competition receipts, agent competition ratings and season standings. Add explicit game-kind guards at the owning score boundary wherever missing; do not rely solely on which caller currently invokes it. Preserve existing Influence writes and eligibility.

Verification must compare score state before and after a Werewolf completion and repeated completion/recovery, not just assert that the UI hides numbers. Public and owner reads must also leave score state unchanged. Keep generic saved-agent usage counts distinct from rated competition counts when auditing fields.

Use representative persisted Werewolf games for browser acceptance where available, but deterministic fixtures cover missing outcomes. No need to play paid games to obtain a dead winning villager or a draw. Old games without valid canonical ownership/outcome evidence get an honest unavailable/absent association, not invented attribution or an LLM reconstruction.

## Tests and acceptance

1. **Pure projection/UI:** mixed ordering, game filters, title/slug fallback, same owner with multiple agents/opposing factions, living/dead winners, living/dead losers, draw, unavailable evidence, and Influence canonical placement/receipt points. Werewolf-only history renders with no Influence competitive record. No undefined place, fake zero points or combined win-rate denominator.
2. **PostgreSQL/API:** use `setupTestDB()` before mutations. Exercise actual outer owner/public routes and their allowlisted response fields; Public vs owner-only Unlisted discovery, hidden games, another owner, archived/renamed agents, direct-created Werewolf without lobby seats, completed vs cancelled/suspended/live. Assert global recent ordering/limit and batch loading across repeated seats. Reads do not mutate storage.
3. **Score boundary:** unchanged account ELO/counters, agent ratings, receipts and season totals after Werewolf completion and recovery; existing Influence scoring/leaderboard tests still pass. A latest Werewolf result does not become an Influence win in dashboard summaries.
4. **Browser:** one mixed owner dashboard and public profile at desktop/mobile widths; follow both game types to shared results, exercise filters and empty states, verify long names/titles and explicit Influence score labels. Use the isolated API/browser harness; clean up its database and child processes.
5. **Required implementation checks:** `bun run test`, `bun run test:postgres`, `bun run check`, targeted browser coverage and `git diff --check`. If a shared DTO reaches MCP, update strict schemas and fixtures through the existing generator; do not add a new MCP feature or weaken schemas.

## Delivery and documentation

Implement H1 and H2 together as the smallest usable vertical slice, then finish H3's score assertions and browser acceptance before marking the gap closed. No provider calls, new ratings, seasons, music, artwork, migrations or deployment are planned.

Update the W7B audit row with actual proof, clarify participation vs competition in `CONCEPTS.md`, and extend the existing House integration learning with the adapter/score-boundary lessons. Keep any unrelated producer-discovery gap separate. Implementation and validation are recorded below.

## Implementation and validation — 2026-10-06

H1–H3 are implemented. `house-participation.ts` selects owned seats before limiting, batches episode/receipt data, deduplicates canonical projections per game and reads within one read-only snapshot. Existing owner/public endpoints and shared UI rows now expose the discriminated result contract. Public filtering is server-side; the complete owner history is filtered locally. No historical backfill is required.

Influence completion capture, settlement and competition boundaries explicitly reject/no-op Werewolf. History/agent/season/account UI labels retain Influence scoring scope. The public-profile MCP tool's existing hand-maintained closed schema and runtime validator were updated; this contract is not part of the generated House-game schema bundle.

Validation:
- `bun run test`: 2,299 passed, five existing skips, no failures.
- `bun run test:postgres`: 1,900 passed, no failures, using disposable `influence_history_test`.
- `bun run check`: typecheck and lint passed.
- House journey browser suite: three passed; authenticated owner and anonymous public history at 1440/390px, mixed results links, filters, Unlisted exclusion/public and inclusion/owner, and no horizontal overflow. Screenshots inspected.
- Deterministic fixtures cover dead faction winners, opposing owned seats, draw, unavailable terminal evidence, missing Influence placement, archived/renamed identities, no lobby-seat dependency and secret-field exclusion. Actual durable Werewolf completion/recovery and deliberately misrouted score calls leave Influence scoring state unchanged.
- No provider call, paid generation, migration, deployment or new scoring policy was introduced. Remaining admin-only production discovery and decorative reveal art gaps stay outside this completed slice.
