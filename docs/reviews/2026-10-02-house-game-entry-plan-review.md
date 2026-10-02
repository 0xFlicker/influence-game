---
title: House game entry plan — simplification and consistency review
date: 2026-10-02
status: resolved-in-plan
---

# House game entry plan review

Reviewed the [W0 plan](../plans/2026-10-02-001-refactor-house-game-entry.md) and [task specifications](../plans/2026-10-02-002-house-game-entry-tasks.md) against the current `codex/werewolf` source at `62c7a54e`. Findings below are incorporated into both documents. This is a document/source review, not implementation verification or an external model review.

## Findings and resolutions

### R1 — unnecessary new Werewolf moment-link feature (medium)

The original W0 draft invented `cursor=N` URLs and changed initial watch-hook seeking. Today's Werewolf route only chooses audience and starts at the beginning. This adds behavior and regression risk to a routing/UI consolidation before results/MCP define the actual evidence-link need.

**Resolution:** W0 moves existing watch behavior and validates audience. Keep Influence sequence links; reject their use for Werewolf rather than conflating canonical sequences with audience-local cursors. The user subsequently confirmed moment sharing as a product requirement: [R35](../refactor-queue.md#r35-share-the-current-replay-moment-across-house-game-players) now owns the shared player action and Werewolf link support as a near-term W0 follow-up, without waiting for Results/MCP. Existing in-player scrubbing is unchanged.

Evidence: `app/werewolf/[slug]/page.tsx`, `werewolf-viewer.tsx`, `use-werewolf-watch.ts` and `lib/game-links.ts` under `packages/web/src/`.

### R2 — ambiguous shell ownership and excess orchestration (medium)

The phrase “shared replay shell” could be implemented as a new wrapper around a viewer that already renders the full-screen `WatchShell`. “Entry adapters/controllers” also leaves room for a new framework despite this being two concrete games.

**Resolution:** replay routes dispatch; existing watch shell owns the viewport. Site nav/layout is for entry, casting and audience choice. Share ordinary presentation components and preserve existing data hooks/actions. No controller hierarchy, generic polling layer or registry. Audience actions on entry link directly into replay; only a direct replay link missing audience needs a chooser.

Evidence: `components/watch/watch-shell.tsx` renders a fixed full-screen main; `app/games/[slug]/replay/replay-page.tsx` currently adds Nav/max-width layout; Werewolf viewer already uses shared controls.

### R3 — missing suspended lifecycle and vague failure state (medium)

The lifecycle table said “cancelled/failed” but omitted `suspended`, which is an actual `GameStatus`. This could hide available history or treat an interrupted game as completed.

**Resolution:** use the actual statuses. Preserve suspended state/reason and partial history, never auto-resume the game or infer an outcome. Waiting entry stays casting until the existing detail/lobby data changes; starting does not automatically honor stale watch intent.

Evidence: `packages/web/src/lib/api.ts` defines waiting/in_progress/completed/cancelled/suspended.

### R4 — join-flow deletion conflicts with safe checkpoints (medium)

HE-04 removed `join_werewolf`, but HE-06 updated emitters. The advertised intermediate working checkpoint could therefore strand the old form links.

**Resolution:** HE-04 prepares the common handler; HE-06 changes emitters and removes the obsolete parser/branches together. Existing routes/intents remain functional until that checkpoint, with no legacy compatibility paths retained afterward.

Evidence: `app/agents/create/page.tsx`, `app/dashboard/agents/agent-create-content.tsx` and Werewolf casting entry.

### R5 — duplicate status authority and excessive identity boot machinery (low)

Returning status in a new identity endpoint and then loading the game-specific detail creates two snapshots that can disagree during start/completion. Repeated generic instructions about SSR/client resolution could also lead to unnecessary duplicate fetches or new auth infrastructure.

**Resolution:** identity returns only id/slug/gameKind. Existing detail/lobby reads own lifecycle. Reuse successful SSR bootstrap data; anonymous misses may retry through existing client auth, without new server token forwarding, cache or auth state machine. Do not poll identity or switch an active player based on it.

### R6 — hidden visibility was stated more broadly than the source supports (medium)

The draft implied universal downstream hide denial. Influence episode reads exclude hidden games, but the inspected generic game detail handler relies on private-episode visibility without applying that hidden filter. An entry endpoint cannot protect direct access to another API.

**Resolution:** W0's identity endpoint excludes hidden games before permissions. Test that boundary and preserve current Werewolf watch/media access checks. Record the existing Influence discrepancy as a separate visibility audit follow-up; do not silently claim it fixed or expand W0 into a blanket authorization rewrite. It needs endpoint-by-endpoint assessment before stating its full exposure or changing operator behavior.

Evidence: `packages/api/src/routes/games.ts` detail handler and `routes/episodes.ts` public episode handler/visibility helper.

### R7 — duplicated decision text and overbroad regression work (low)

Both documents redefined URL behavior, and HE-05 proposed re-covering most of the existing watch-director behavior for a module move.

**Resolution:** plan owns behavioral decisions; task document owns edits/order/proof. Reuse established playback suites and add route-level checks for audience, preferences, mount stability and request isolation. Required repository checks still apply. Results/highlights remain explicit W1/W4 dependencies, with no fake result payload or second Werewolf app.

## Kept deliberately

- A small visible-identity read is justified: the existing Influence API guard rejects Werewolf. Broadening every Influence endpoint or probing failures for kind is worse than one narrow resolver. Keep authorization checks explicit and reuse existing helpers.
- Shared casting/cards remain in W0 because the user asked for one House UI. Moving URLs alone would leave the duplicated experience intact.
- Game-specific engines, timeline adapters and services remain separate. The route/UI refactor is not a universal game schema.
- Human creative gates, art/music exploration and Production studio redesign stay outside W0.

## Follow-ups and proof

W1/W2 consume the audience-safe moment-link contract delivered by R35. The roadmap records this product task independently of results/MCP implementation. The Influence hidden-detail discrepancy is recorded above for a separate security/visibility audit.

Document validation: relative links, Markdown fences and `git diff --check`. No runtime tests or browser acceptance are claimed; no application code changed. No unresolved contradiction was found in the revised W0 documents within this review's scope.

## Product review clarifications — 2026-10-02

- Public watching does not require login for either game. Optional auth only identifies viewers who may access a private game. Cache-control `private` is unrelated to game visibility.
- Private/unlisted creation exists for Influence, while Werewolf hardcodes public. The revised plan describes a common House visibility policy, with missing Werewolf support and existing Influence inconsistencies recorded under W7.
- Direct watch/media URLs retain checks because entry-page access is not a credential. Kind is explicitly resolved rather than guessed from endpoint failures.
- Sharing the current moment is required product work, recorded as R35 in the requested main-checkout refactor queue and mirrored into this worktree. No application behavior changed in this clarification pass.
