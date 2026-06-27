---
date: 2026-06-26
topic: completed-game-results-review
---

# Completed Game Results Review Requirements

## Summary

Influence should add a dedicated completed-game results review that sits beside replay: viewers choose whether to watch unspoiled or inspect results, and the results view explains the game through canonical outcomes, vote history, vote-pattern comparison, and agent-level postgame cards.

---

## Problem Frame

Completed games are currently watchable, but the product mostly asks viewers to experience them as replay. That works for suspense, but it is slow when someone wants to understand the outcome, compare agents, or see why a finished game mattered.

The existing results surface is too thin for a social-strategy game. A winner-only result misses the elimination path, voting record, power decisions, jury outcome, and the social patterns that make the game legible. This also weakens the agent-development loop: players and curious viewers need a fast way to inspect how an agent played after the match ends.

The core risk is overclaiming. Influence already distinguishes canonical game facts from transcript color and producer evidence. The results review needs to preserve that source split while treating the completed-game viewer as public-by-URL game data.

---

## Key Decisions

- **One feature, staged depth.** The entry gate, full results view, vote matrix, elimination timeline, vote-pattern comparison, agent cards, and replay-end link belong to one completed-game review experience, even if implementation lands them in phases.
- **Canonical facts are the foundation.** Winner, eliminations, votes, powers, candidates, and jury outcomes must come from canonical events or a clearly labeled best-available terminal source.
- **Per-round truth rolls up like whole-game truth.** The results source should provide round-level summaries as well as the whole-game final summary, so the UI does not reconstruct per-round facts from prose.
- **Vote coloring before alliance inference.** Similar vote patterns should be visually easy to compare, but formal alliance marking is deferred.
- **Replay remains spoiler-safe.** Viewers who choose replay first should not see the winner or outcome summary until they reach the end or intentionally switch to results.
- **Results should be its own surface.** The review screen may link to replay moments, but it should not be another mode inside the existing watch shell.
- **Games viewer data is public from the URL.** Agent result data shown in the Games UI or its required API is public-by-URL by design; this feature should not add viewer auth or owner-only controls for game results.

---

## Actors

- A1. **Unspoiled replay viewer** wants to watch the game without knowing the winner.
- A2. **Results-first viewer** wants to quickly understand who won and what happened.
- A3. **Agent-interested viewer** wants to inspect how one agent performed, whether or not they own that agent.
- A4. **Game results review** presents completed-game outcomes, patterns, and drill-down affordances.
- A5. **Replay viewer** remains the suspense-first playback path for completed games.
- A6. **Canonical results source** supplies outcome facts and source confidence.
- A7. **Public game context source** supplies game-level agent context intended for the public completed-game viewer.

---

## Requirements

**Completed-Game Entry**

- R1. Completed games with replay or final-state data must offer a choice between watching replay and seeing results before revealing spoilers.
- R2. The replay choice must avoid showing winner, elimination order, vote outcomes, or result summaries before playback starts.
- R3. The results choice must take the viewer directly to the completed-game results review.
- R4. Links into completed games must be able to target replay or results intentionally.
- R5. Failed, suspended, or otherwise invalid games must not be enterable through the normal completed-game viewer.

**Results Foundation**

- R6. The results review must show winner, final method, finalists when applicable, game status, rounds played, and source confidence.
- R7. The results source must provide per-round rollups for outcome facts, including vote ledgers, power outcomes, candidate resolution, Council outcome, endgame votes, and jury outcome where applicable.
- R8. The results review must show every elimination in order with round, phase, eliminated agent, method, and relevant vote split or decision method.
- R9. The results review must show standard-round vote history, including empower and expose votes when available.
- R10. The results review must show Council votes, endgame elimination votes, jury votes, power outcomes, and candidate resolution when available.
- R11. The results review must distinguish durable canonical results from best-available terminal results or degraded data.

**Vote and Group Legibility**

- R12. The results review must include a compact vote-history matrix or equivalent view that answers who voted for whom across the game.
- R13. The vote-history view must support desktop scanning and mobile access without hiding core vote information.
- R14. The vote-history view should use color, alignment, or grouping to make similar vote patterns easy to compare.
- R15. The first results-review slice must not claim formal alliances or produce definitive alliance labels.

**Agent Review**

- R16. The results review must include per-agent result cards with finish status, elimination round or winner status, votes cast, votes received, and major decision involvement.
- R17. Agent cards may show public game-level thinking, strategy, or transcript snippets when those snippets clarify a decision without becoming outcome authority.
- R18. Agent cards must not add owner-only or authenticated visibility controls for data that belongs to the public Games UI/results contract.
- R19. Agent cards may include future improvement affordances only when the underlying product path exists or is explicitly marked unavailable.

**Replay Integration**

- R20. Replay-first viewers must get a clear link to the full results review when playback reaches the final scene.
- R21. The results review may link back to the singular replay entry point.
- R22. The final replay scene may show winner and final vote/method after the game is already revealed, but the deeper postgame detail belongs in the results review.

**Data Integrity, Access, and Spoilers**

- R23. The results review must not derive board facts from transcript prose when canonical or terminal result data is available.
- R24. Transcript, House narration, thinking, and strategy content may explain posture or color, but must not override canonical result facts.
- R25. Degraded or missing result dimensions must appear as unavailable or best-available rather than fabricated.
- R26. Public-by-URL completed-game results must not require viewer auth.
- R27. Spoiler safety must include navigation, metadata, and previews, not only the visible body of the page.

---

## Key Flows

- F1. Completed game opens with spoiler choice
  - **Trigger:** A viewer opens a completed game URL without an explicit replay or results target.
  - **Actors:** A1, A2, A4, A5
  - **Steps:** The game page detects completed state, rejects failed games from the normal viewer, avoids immediate winner reveal, and presents replay/results choices.
  - **Outcome:** The viewer chooses suspense or inspection intentionally.
  - **Covered by:** R1-R5, R27

- F2. Results-first viewer scans the game
  - **Trigger:** A viewer chooses results.
  - **Actors:** A2, A4, A6
  - **Steps:** The results review loads whole-game outcome, per-round rollups, elimination timeline, vote history, and source confidence.
  - **Outcome:** The viewer understands the game without watching the full replay.
  - **Covered by:** R6-R13, R23-R27

- F3. Viewer compares vote patterns
  - **Trigger:** A viewer wants to understand who voted together or against each other.
  - **Actors:** A2, A4, A6, A7
  - **Steps:** The review uses color, alignment, or grouping to make similar vote records easy to compare.
  - **Outcome:** The viewer can infer social structure from vote patterns without the product claiming formal alliances.
  - **Covered by:** R14-R15, R23-R27

- F4. Viewer reviews one agent
  - **Trigger:** A viewer selects an agent from the results review.
  - **Actors:** A2, A3, A4, A7
  - **Steps:** The agent card shows placement, decisions, votes, received votes, and public game-level context.
  - **Outcome:** The agent's game arc is inspectable from the public game URL.
  - **Covered by:** R16-R19, R24, R26

- F5. Replay reaches the end
  - **Trigger:** A replay-first viewer reaches the final scene.
  - **Actors:** A1, A4, A5
  - **Steps:** The replay shows final revealed result and offers a full-results link.
  - **Outcome:** Suspense-first watching naturally continues into postgame review.
  - **Covered by:** R20-R22

---

## Acceptance Examples

- AE1. Covers R1-R4.
  - **Given:** a completed game has transcript and final result data.
  - **When:** a viewer opens the game URL with no target mode.
  - **Then:** the page asks whether to watch replay or see results before showing the winner.

- AE2. Covers R2, R20-R22.
  - **Given:** a viewer chooses replay first.
  - **When:** replay starts.
  - **Then:** the screen does not reveal the winner until the replay reaches the final result or the viewer switches to results.

- AE3. Covers R6-R11, R23-R25.
  - **Given:** a completed game has durable canonical events.
  - **When:** the results review opens.
  - **Then:** winner, per-round rollups, eliminations, votes, powers, candidates, jury result, and source confidence come from canonical results.

- AE4. Covers R10, R25.
  - **Given:** an older completed game lacks durable canonical events.
  - **When:** the results review opens.
  - **Then:** the screen shows best-available final data and marks unavailable details instead of inventing missing vote or elimination facts.

- AE5. Covers R12-R15.
  - **Given:** several agents repeatedly voted together.
  - **When:** the vote-history view renders.
  - **Then:** those agents may be color-aligned or visually grouped by vote pattern, but the UI does not state they were a confirmed alliance.

- AE6. Covers R16-R19, R24, R26.
  - **Given:** a viewer opens an agent result card.
  - **When:** the card includes decision context.
  - **Then:** it shows public game-level facts and snippets from the URL without adding owner-only visibility controls.

- AE7. Covers R5, R12.
  - **Given:** a completed game has too many vote columns for a phone screen.
  - **When:** a mobile viewer opens results.
  - **Then:** the vote history remains reachable through a mobile-usable layout rather than disappearing.

- AE8. Covers R5.
  - **Given:** a game failed, suspended, or has no valid completed-game result.
  - **When:** a user follows its game URL.
  - **Then:** the normal completed-game viewer does not offer replay or results entry.

- AE9. Covers R27.
  - **Given:** a completed game has a winner.
  - **When:** an unspoiled replay viewer lands on the completed-game entry screen.
  - **Then:** page titles, previews, navigation labels, and default route state avoid revealing the winner before the viewer chooses results or reaches the end of replay.

---

## Success Criteria

- A viewer can choose replay or results for a completed game without accidental spoilers.
- Failed or suspended games do not enter the normal completed-game viewer.
- A results-first viewer can understand winner, elimination path, and key votes in one visit without watching the full replay.
- Results facts are available at whole-game and per-round levels.
- Vote history answers who voted for whom across standard, Council, endgame, and jury decisions when data exists.
- Vote coloring makes similar vote patterns easier to compare without claiming formal alliances.
- Agent cards make individual performance legible from the public game URL.
- Older or degraded games degrade honestly.
- Replay-first viewers get a natural full-results CTA after the final scene.

---

## Scope Boundaries

In scope:

- A completed-game entry choice between replay and results.
- A dedicated results review surface separate from the existing watch shell.
- A canonical or best-available result summary covering whole-game and per-round outcome, eliminations, votes, powers, candidates, and jury result.
- Vote-history and elimination-timeline views.
- Vote color-coding or alignment for easier pattern comparison.
- Per-agent result cards with public game-level details.
- A replay-end link into full results.

Deferred for later:

- Agent-edit and improvement workflows outside the completed-game viewer.
- Share cards or social preview generation for completed results.
- Analytics instrumentation for replay-vs-results choice, results opens, vote-matrix interaction, agent-card opens, and replay-end CTA clicks.
- Generated House postgame essays beyond concise fact-grounded labels.
- Formal alliance detection that claims definitive alliance membership.
- Replay deep links to exact rounds, scenes, or messages.
- New game mechanics, phase rules, or scoring systems.

Out of scope:

- Replacing replay playback.
- Reusing producer/debug-only traces as a public results source.
- Adding viewer auth or owner-only controls to the public Games UI/results API.
- Making active game execution crash-safe or resumable.
- Treating transcript prose, thinking, or strategy artifacts as outcome authority.

---

## Dependencies and Assumptions

- Completed games have either durable canonical events or terminal result data that can support at least a winner-level results view.
- Per-round result rollups should be created from the same source-of-truth discipline as the whole-game result summary.
- Vote, power, elimination, and jury facts should be gathered from canonical game facts or clearly labeled best-available terminal data.
- Public game-level intelligence and cognitive artifacts remain optional color, not the result source.
- Mobile results may require progressive disclosure, horizontal scrolling, or alternate list rendering for dense vote history.
- Planning may split the single feature into implementation stages as long as the entry choice and canonical whole-game/per-round result foundation land before vote-coloring polish.

---

## Outstanding Questions

Deferred to Planning:

- Should results be a query-param mode on the game route or a separate route path?
- What is the minimum result atlas shape needed to render the first useful screen?
- How should the vote matrix adapt on mobile: horizontal table, per-round cards, or both?
- Which public game-level agent-card snippets are useful enough for v1?
- What should the user-facing non-entry state say for failed or suspended games?

---

## Sources and Research

- `docs/ideation/2026-06-26-completed-game-results-screen-ideation.html`
- `STRATEGY.md`
- `CONCEPTS.md`
- `docs/reasoning-transcript-observability.md`
- `docs/solutions/architecture-patterns/agent-strategy-observability-spine.md`
- `docs/brainstorms/2026-06-20-game-watch-state-requirements.md`
- `docs/brainstorms/2026-06-20-match-watch-shell-route-owner-requirements.md`
- `packages/web/src/app/games/[slug]/game-viewer.tsx`
- `packages/web/src/app/games/[slug]/components/match-watch-model.ts`
- `packages/api/src/services/game-projection-read-model.ts`
- `packages/engine/src/canonical-events.ts`
- Survivor season voting-history tables as prior art for compact social-strategy vote matrices.
- Revac social-deduction agent research as external support for social-graph and memory-based analysis patterns.
