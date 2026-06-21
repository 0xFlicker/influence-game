---
date: 2026-06-21
topic: dashboard-mission-control-overview
---

# Dashboard Mission-Control Overview Requirements

## Summary

Redesign `/dashboard` as a top-down Mission-Control Overview for signed-in agent owners. The page should lead with compact personal status, one state-priority primary action, and short modules that route users to existing deeper surfaces instead of exposing every list and filter inline.

---

## Problem Frame

The current dashboard has the right raw material but reads as a vertical stack: open games, game history, and saved agents all compete for attention. This makes it harder for a returning owner to answer the practical question: "What should I do next?"

Influence's strategy frames the product as an agent development and spectator loop. The dashboard should reinforce that loop by helping owners prepare an agent, get into play, watch or replay results, and return to agent management without introducing a large new backend slice.

---

## Key Decisions

- **Top-down command center.** Use the visual direction selected from the brainstorm probe: status first, then one primary action, then short supporting modules.
- **MCP callout is first.** Keep the existing Games MCP setup callout at the top of `/dashboard`; it is more important than the overview refactor and should not be buried below Mission Control.
- **State-priority ladder.** The primary action should follow a stable order instead of changing arbitrarily.
- **Existing functionality first.** V1 should recompose data and routes the app already has; any queue-specific status should be skipped or linked out if it would require new API work.
- **Preview over browser.** `/dashboard` should orient and route; full search/filter experiences belong on existing focused pages.

---

## Actors

- A1. Signed-in agent owner using `/dashboard` to decide what to do next.
- A2. Returning owner with prior games who may want to replay or improve an agent.
- A3. New owner with no saved agents or no game history.
- A4. Existing focused surfaces such as `/games`, `/games/free`, and `/dashboard/agents`.

---

## Requirements

**Overview structure**

- R1. The dashboard must keep the Games MCP setup callout above the Mission-Control overview.
- R1a. The dashboard must replace the current long-stack feel with a top section that presents personal status before detailed lists.
- R2. The overview must show one visually dominant primary action.
- R3. The overview must keep supporting modules short enough that the first screen communicates the user's current state and next route.
- R4. The dashboard must continue to work as a signed-in owner page and must not become an admin surface.

**Primary action**

- R5. The primary action must use this priority ladder: live/watchable game, current participation or queue state when available, latest replay/review, join or queue, create/manage agent.
- R6. If a ladder state cannot be determined from existing functionality in V1, the dashboard must skip that state rather than requiring new API work.
- R7. The primary action must link to or invoke existing functionality; it must not imply new reasoning analysis or agent-improvement behavior that does not exist.
- R8. When no clear action exists, the dashboard must fall back to a neutral browse or manage action instead of showing an empty command area.

**Supporting modules**

- R9. The active/live module must summarize watchable or active game context when the existing game list data supports it.
- R10. The recent-result module must highlight the latest relevant completed game and provide a replay route when history exists.
- R11. The agent-bench module must show a compact snapshot of saved agents and route to create or manage agents.
- R12. The open-games module must preview a small number of joinable or watchable games and route full browsing to `/games`.
- R13. Queue status may appear only when it can rely on existing functionality; otherwise the dashboard should route users to `/games/free`.

**Depth and navigation**

- R14. Full game filtering, free-queue details, leaderboard, and saved-agent CRUD must remain on existing focused pages.
- R15. The dashboard must provide clear routes to `/games`, `/games/free`, and `/dashboard/agents`.
- R16. Empty states must guide users toward the next existing action, such as creating an agent or browsing games.
- R17. Loading and error states must preserve the overview shape so missing data does not collapse the page into a confusing partial layout.

**Responsive behavior**

- R18. On mobile, the status and primary action must appear before supporting modules.
- R19. The overview must avoid requiring horizontal table scanning in the first screen.
- R20. Supporting modules may stack on smaller screens, but the primary action must remain easy to find.

---

## Key Flows

- F1. New owner setup
  - **Trigger:** A signed-in user has no saved agents.
  - **Actors:** A1, A3.
  - **Steps:** Dashboard shows empty agent status, makes agent creation the primary action, and links to `/dashboard/agents`.
  - **Covered by:** R5, R8, R11, R16.

- F2. Idle owner returns
  - **Trigger:** A signed-in owner has saved agents but no active or queued game state visible to V1.
  - **Actors:** A1.
  - **Steps:** Dashboard shows agent/game status, picks join or queue as the primary action, and previews a small set of open games.
  - **Covered by:** R2, R5, R12, R15.

- F3. Owner has a recent completed game
  - **Trigger:** The owner has game history with a latest completed result.
  - **Actors:** A1, A2.
  - **Steps:** Dashboard surfaces the latest result, offers replay, and avoids promising unavailable agent-analysis features.
  - **Covered by:** R7, R10.

- F4. Focused-page handoff
  - **Trigger:** The owner wants deeper browsing, queue details, or agent management.
  - **Actors:** A1, A4.
  - **Steps:** Dashboard sends the owner to the relevant existing page instead of recreating the full tool inline.
  - **Covered by:** R12, R14, R15.

---

## Acceptance Examples

- AE1. **Covers R5, R6.** Given no live game state is available from existing dashboard data, when the dashboard chooses a primary action, then it skips that branch and evaluates the next available state.
- AE2. **Covers R7, R10.** Given the owner has a completed game, when the recent-result module appears, then it offers replay without claiming to explain or improve the agent unless existing functionality supports that route.
- AE3. **Covers R12, R14.** Given many games exist, when the dashboard renders open games, then it previews a small set and links to `/games` for full filtering.
- AE4. **Covers R13, R15.** Given queue status is not pulled into V1, when the owner needs free-game context, then the dashboard links to `/games/free`.
- AE5. **Covers R18, R20.** Given a mobile viewport, when the dashboard loads, then the primary action appears before supporting modules and remains visible without table-style horizontal scanning.

---

## Success Criteria

- The first screen of `/dashboard` answers what the owner can do next.
- The redesign reduces duplication of `/games`, `/games/free`, and `/dashboard/agents`.
- V1 can be planned without adding a new personal-status backend.
- New and returning owners both receive a useful route from the dashboard.

---

## Scope Boundaries

- No new agent management page.
- No major saved-agent CRUD redesign.
- No new analytics dashboard.
- No new personal-status backend required for V1.
- No full post-game improvement loop beyond existing replay and agent-management routes.
- No admin controls or admin-oriented dashboard behavior.

---

## Dependencies / Assumptions

- Existing `/dashboard` history and saved-agent data remain available to the page.
- Existing game-list functionality can support a small open/watchable preview.
- Existing focused pages remain the destination for deeper tasks.
- Queue-specific dashboard status is optional unless it can be supported without new API work.

---

## Outstanding Questions

### Deferred to Planning

- Decide whether V1 should include queue status directly or link out to `/games/free`.
- Decide exact primary-action labels and empty-state copy.
- Decide the small preview count for open games and agent bench items.

---

## Sources / Research

- `STRATEGY.md`
- `docs/ideation/2026-06-21-dashboard-ux-redesign-ideation.html`
- `packages/web/src/app/dashboard/dashboard-content.tsx`
- `packages/web/src/app/games/games-browser.tsx`
- `packages/web/src/app/games/free/free-game-content.tsx`
- `packages/web/src/app/dashboard/join-game-modal.tsx`
- `packages/web/src/components/nav.tsx`
