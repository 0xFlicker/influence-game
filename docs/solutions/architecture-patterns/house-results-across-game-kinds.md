---
title: Share House results entry while retaining game-specific authority
date: 2026-10-02
module: House results, Werewolf watch, shared assets
problem_type: architecture_pattern
category: architecture-patterns
tags: [house, werewolf, results, routing, canonical-events, replay, testing]
---

# House results across game kinds

W1 extends the House results route to Werewolf. Keep the venue URL, common header, visibility policy and image delivery shared. Keep faction victory, survival and day/night recap semantics in the Werewolf projection; Influence retains jury, alliance, placement and season modules.

## Boundaries that matter

- `GET /api/games/:idOrSlug/results` returns a closed `gameKind` union. Register the shared route **before** Influence-only middleware and remove the old registration. Read visibility, lifecycle and history from a repeatable-read, read-only snapshot. The route's service owns its access check because callers can bypass House entry.
- Shared image routes must also precede that middleware. Their own asset authorization stays intact. The first real browser render caught a Werewolf banner request incorrectly intercepted by the Influence kind guard; unit tests of the asset service alone would not catch this composition bug.
- `werewolf/results.ts` replays canonical events and emits allowlisted completed facts. Dead faction teammates can win; surviving opponents can lose. No Influence `game_results` row is written. Incomplete or corrupt history is unavailable, never inferred from dialogue or a completed status flag alone.
- `werewolf/results-contract.ts` contains browser-safe types and outcome labels. Do not import the server projection merely to share wording: its transitive rules/protocol imports are not browser-safe. Type checking passed this mistake; the real Next browser build caught it.
- `walkWerewolfHistory` is the internal source of audience cursor counting for both watch and results. It includes silent source entries. Result evidence retains event sequence and resolved Omniscient cursor; URLs use the latter. Do not use a cue index or copy the same number into Mystery.
- Results is an explicit spoiler destination. The regular game entry and library only offer a warning-labeled link. Result queries have a separate cache key and do not hydrate watch state. A denied refetch clears the visible result and images.

## Proof without historical game samples

`fixtures/werewolf-results.ts` uses scripted, rules-legal actions and the canonical reducer to construct village victory with a dead Seer, wolves winning with a dead teammate, a Doctor save, failed pack agreement, a final tie and unavailable ballots. It contains no providers. Advancing canonical state directly keeps maximum-duration fixture creation fast; the projection independently replays the produced ledger.

Test the endpoint through `createGameRoutes`, not only its service, and test actual API mount order in the browser. Isolated browser games cover six/eight players, desktop/390px layouts, keyboard disclosures, missing and usable portraits, Unlisted noindex, results-to-source navigation, Mystery isolation and hidden-game denial. The existing Influence banner browser suite covers the shared header and asset route regression.

A 20-day, eight-player no-elimination fixture contains 2,330 events and 180 recap items. Its results JSON measured about 160 KB; projection was roughly 0.8 seconds locally. This supports the current bounded response without speculative pagination. It is not production performance proof.

Next game integration should add a typed outcome projection and a concrete results module to these boundaries. Do not build a plugin registry or turn a team outcome into a single-winner result for reuse. MCP, generated analysis, review, House Cuts and trailer contracts remain separate work.
