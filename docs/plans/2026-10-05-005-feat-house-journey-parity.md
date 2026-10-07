---
title: "W7B — House journey parity, Werewolf cards and episode naming"
date: 2026-10-05
status: in-progress
---

# W7B — House journey parity, Werewolf cards and episode naming

## Outcome

Werewolf uses House discovery, episode packaging, history and operator journeys with its approved Lantern Village identity. Existing games benefit from presentation changes; older completed games have an explicit, bounded path to acquire missing episode copy. Keep real rules and audience differences inside game modules, without separate parallel House UIs.

The operator approved the journey audit and identified missing approved card art and episode naming. This plan records source-verified gaps; it does not claim every journey is broken. No paid generation, backfill or publication is executed by planning.

## Findings — 2026-10-05

| Capability | Current source evidence | Required action |
| --- | --- | --- |
| Library card styling | `werewolf-library-card.tsx` supplies a generic House text frame; `werewolf-game-card.css` supplies only a blue gradient. | Implement the approved village card direction through shared House card presentation. |
| Approved artwork | `docs/brainstorms/2026-10-04-werewolf-art-lantern-village.md` selects v1 card, v2 rectangular reveal and v3 round table. Card/reveal files remain local `.renders` studies. | Convert the selected card direction into shipped reusable assets and real UI; do not embed a whole mockup containing fake text. Audit reveal treatment separately. |
| Locations and wolf art | W6 automatic generation and regeneration consume selected locations and reusable forms. | Preserve published scenes; verify these paths in the audit rather than regenerate them wholesale. |
| Episode naming | `episode-presentation.ts` auto-selects only live Influence games. Its prompt says Influence, cast comes from `gamePlayers`, and preview uses Influence scenes/events. | Add Werewolf source/premise adaptation to the existing durable episode service. |
| Name display | Werewolf library card hardcodes `title = game.slug` and fixed description. | Carry persisted episode title/teaser through summary, detail and metadata while routes keep the slug. |
| Historical copy | Existing admin backfill previews selected IDs, respects locks and queues durable jobs. | Reuse after game-aware generation/read paths work. Old completed games require explicit backfill; reads never generate. |
| Producer discovery | `listReplayVisualGames` filters to completed Influence games despite a Werewolf per-game adapter. | Discover both games through one entry; include W7A’s repairable suspended work. |
| Remaining journey surfaces | Profiles/history, previews, sharing and operational actions require end-to-end verification. | Record pass, deliberate difference or a concrete owned gap; avoid speculative rewrites. |

W4 explicitly deferred episode naming; W5 retained a game-name/deterministic-teaser fallback. Neither new games nor old games currently acquire Werewolf naming automatically. Approved art direction is not evidence that a component consumes that art.

## B1 — land the selected card direction

Use the shared `GameCard` shell, House iconography, actions and responsive behavior. Werewolf supplies a spoiler-safe village vista, restrained woodcut/aged-material accents, amber/charcoal palette and readable real typography. Preserve original opaque rectangular character images wherever used. Do not disclose wolf identities, target imagery or winner information in generic cards.

The v1 card mockup is a design reference, not a deployable card. Inspect available clean background assets and reuse suitable approved artwork; if a clean asset needs generation, make that one bounded art task rather than reopening the design exploration. Store shipped assets in the existing production asset convention, never depend on ignored `.renders` paths. No per-game generation is needed for a reusable background.

Apply default presentation to old and new Werewolf games. Preserve explicit operator-selected covers; use the selected default where no suitable cover exists. Connect listing and relevant fallback/share surfaces to the same game art input. Audit House Cut and trailer/poster artwork separately: existing rendered images/videos remain immutable until explicit regeneration. Do not promise CSS will restyle already-exported media.

Prove Hazy and another old game, plus waiting/live/new fixtures, in desktop and mobile cards. Keep text contrast, long titles, full-card links and actions readable. The approved rectangular reveal treatment is a separate audit item; do not quietly declare it shipped because location generation is working.

## B2 — share episode naming and description

Reuse `gameEpisodePresentations`, its durable job/lease/revision fencing, operator lock/edit and backfill controls. Supply game-specific cast and premise with a small explicit adapter. Werewolf uses frozen canonical public cast identity and personality; not role assignments, private pack speech, night choices, thinking, raw reasoning or owner strategy. Do not route Werewolf through Influence alliance/event parsing or fabricate Influence player rows.

First release matches Influence’s **pregame, spoiler-safe** packaging: a short evocative title and one-sentence teaser based on the cast. This is distinct from a postgame recap or a House Cut title. Use `gpt-6-luna`, the existing strict title/description schema and semantic length checks. Keep malformed responses failed/typed and preserve operator edits against stale completions.

Queue automatically once the game starts with its frozen cast, for both games. Waiting lobbies retain suitable default copy. Failed/unavailable naming keeps the stable slug display and exposes failure/retry to operators; it must not block play. Read paths have no provider side effects. Update the shared episode read contract, Werewolf summaries/cards, game heading, page metadata and new trailer/release manifests consistently. Keep every route/link keyed by the original slug, never the generated title (the current card uses one variable for both and must be separated).

Historical rollout: preview explicit selected completed IDs and estimated call count; generate only missing/unlocked copy by default. Existing titles/covers and user edits survive. Regeneration is explicit. Exercise selection/replay/locking with fake providers first. A real Hazy naming call or broader backfill needs an explicit bounded provider run; existing Cuts authorization does not authorize unlimited episode naming. Do not rewrite published trailers or share images when copy changes; show their current revision and allow the existing regeneration path where supported.

## B3 — journey audit and smallest fixes

Maintain a parity ledger with surface, shared owner, each game’s data adapter, expected difference, evidence and outstanding work. Follow actual journeys rather than relying on text searches:

- Discover → create/configure → cast/join/start → choose audience → watch → finish → results → inspect/review/Cuts/share → return to the agent or another game.
- Dashboard, public profile and history mix both games chronologically, with game-specific outcomes including dead members of a winning Werewolf faction. Leaderboards, ratings, points and aggregate win rates remain game-scoped. Follow-through: [shared participation history plan](2026-10-06-001-feat-house-participation-history.md).
- Game cards, titles/descriptions/covers, social previews and share links resolve the same episode identity. Direct Unlisted links work anonymously; Unlisted is excluded from discovery; hidden games remain unavailable.
- Production lists both game kinds, routes to the existing House workspace and exposes repair/retry/publication/cost state with the correct permissions. W7A adds visual-owned suspended games; do not remove completed-game repair.
- Stop/hide, paused execution, failed scene/trailer/Cut jobs, stale preview/publication conflicts and retry recovery are truthful from user and operator entry points.
- Rules and MCP setup copy match supported games. Availability configuration controls creation/discovery consistently while preserving existing game URLs.

Any newly discovered large dependency gets a concrete operator report before broadening the slice. Do not use this audit to build the deferred producer studio or a generic plugin system.

## Acceptance and delivery order

1. B1 gives an immediately visible improvement to existing games without provider calls or asset regeneration per game.
2. B2 completes shared episode packaging and a reviewable historical backfill path.
3. B3 closes confirmed gaps in small changes, coordinated with W7A’s recovery journey. Record intentionally distinct/deferred features explicitly.

Tests: provider-free component/contracts, PostgreSQL job/lock/permissions/source-adapter coverage, malformed naming outputs, frozen cast inputs, idempotent queue/backfill and no-read-generation, old/new game parity, anonymous Public/Unlisted/hidden routes, and Influence regressions. Browser proof on Hazy plus representative fixtures at narrow/wide sizes; inspect social image output separately from HTML and distinguish new manifests from previously rendered media. Run required Bun baselines and diff checks for code changes. Mock-provider proof does not count as operator approval of generated copy or real paid backfill execution.

## Out of scope

New seasons/ratings/scheduling, private games, outcome-derived episode naming, automatic retroactive media replacement, new per-Cut approval UI, additional roles, and a producer studio redesign. W6 sound and physical-device checks remain separate follow-ups.

## Implementation checkpoint — 2026-10-05

- B1 implemented: shipped clean Lantern Village art in shared cards, live entry and trailer fallback. Explicit covers survive; old games require no regeneration. Inspected real Hazy/wild-lemon-sun cards and isolated desktop/mobile fixtures.
- B2 read integration implemented: frozen public Werewolf cast, saved title/teaser in listing/search/entry/replay/results/metadata and new trailer manifests. Shared episode routes now precede the Influence-only guard. Reads do not generate copy.
- B2 completed on 2026-10-06: both games queue naming transactionally with their frozen cast at start. The shared worker uses a game-specific premise and strict copy schema. Werewolf sends only original cast names and bounded personalities, never roles, strategies or night evidence. The operator explicitly authorized this automatic OpenAI `gpt-6-luna` payload (900 output tokens, 45-second request timeout). Shared Production selection/backfill and the per-game Werewolf episode editor are enabled. No real historical backfill or paid naming trial ran during implementation.
- B3 audit captured in [House journey parity ledger](../audits/2026-10-05-house-journey-parity.md). Public profile/history completed on 2026-10-06 through the shared participation plan, with mixed chronology and isolated Influence scoring. Admin-only discovery remains a concrete open gap. W7A producer/sysop discovery already includes completed Werewolf and visual-suspended games.

W7B still requires the recorded admin-only discovery gap to be resolved or explicitly deferred. Existing rendered trailers, posters and Cuts are unchanged.

## B2 operational behavior — 2026-10-06

- New games persist one naming job in the same transaction as the frozen roster/start. The worker no longer scans only currently running games, so a game that completes before its next tick still receives copy. Waiting lobbies do not queue naming.
- Existing games: open Production → Edit episode → Generate title & description. Failed jobs expose Retry. The shared Production list supports Werewolf in explicit selected batches with a call-count preview, up to 50 games. Hidden/waiting/protected/already-active jobs are skipped; repeating a request cannot replace active work. Default backfill preserves existing titles, while explicit regeneration can replace unlocked copy.
- Rechecking queue eligibility is atomic. Generation completion retains revision/lease fencing, so a late result cannot overwrite an operator edit. Failures retain existing copy and never block gameplay. Reads do not create jobs or call providers.
- Naming uses `gpt-6-luna`, zero provider retries, 900 output tokens and a 45-second request timeout. Personality input is limited to 1,200 characters per cast member. No roles, strategies, later events or private reasoning are sent. Missing canonical Werewolf cast fails visibly instead of consulting mutable profiles or Influence rows.

Validation: `bun run test` passed 2,296 tests (five existing skips); `bun run test:postgres` passed all 1,894 tests against disposable `influence_naming_test`; `bun run check` and `git diff --check` passed. The shared Production component test exercises explicit Werewolf batch preview and queue; it runs in a subprocess because older suites globally mock the permission hook. The initial shared test database had a branch-schema mismatch, so it was not repaired or reused. The real local browser was signed out: authenticated page acceptance and a paid naming/backfill trial remain unexercised. No production deployment occurred.
