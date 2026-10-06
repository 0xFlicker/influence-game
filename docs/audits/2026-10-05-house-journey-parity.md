---
title: House journey parity audit
date: 2026-10-05
status: partial
---

# W7B journey ledger

Evidence distinguishes source review, automated isolated fixtures and real local browser inspection. No production writes, paid episode calls, historical backfill or trailer rendering were performed. This is not a claim of full journey parity.

| Surface and owner | Influence / Werewolf adapter | Evidence and remaining work |
| --- | --- | --- |
| Discovery and cards: `games-browser`, `GameCard` | Influence episode presentation / Werewolf summary with frozen initial cast | **Implemented and browser tested.** Both retain stable slug links. Werewolf uses shipped Lantern Village art, saved copy and cast search. Public listed; Unlisted/hidden excluded. Real Hazy and wild-lemon-sun visibly receive art. Fixtures cover old completed, waiting and live at 390/1440px; no horizontal overflow. |
| Entry, preview and social metadata: shared episode route | Influence lobby/alliance frames / Werewolf initial public identities only | **Implemented and tested.** Outer router previously returned Influence's 409 for Werewolf; moved shared episode routes above the kind guard. Anonymous Unlisted works, hidden is 404. Saved title/teaser appears without changing URLs. Existing poster is used when ready, otherwise explicit cover or village art. HTML metadata and local image loading verified; external social crawler rendering not exercised. |
| Replay/results: House route and game modules | Existing Influence replay/results / existing Werewolf audience/results projection | Saved title now appears in Werewolf replay header and results identity. Existing audience and result contracts remain game-owned. House-results PostgreSQL tests cover canonical outcomes and privacy. This slice did not repeat every playback/motion/device test from W6. |
| Trailer/Cuts sharing: shared publication coordinator | Influence manifest / Werewolf opening-only manifest | New Werewolf manifests freeze saved episode title/teaser; stable game slug remains canonical. Strict manifest shape and bounded copy validation retained. Existing ready media is not replaced when text changes. Exported art remains unchanged until explicit regeneration; no real renderer or social upload ran here. |
| Episode naming: `episode-presentation` durable job | Influence frozen `gamePlayers` / Werewolf initial canonical cast | **Implemented 2026-10-06.** Starts queue atomically, including direct Werewolf starts. Worker uses game-specific premises and only frozen names/personalities with strict copy validation. Operator explicitly authorized automatic `gpt-6-luna` naming. Fake-provider tests cover generated persistence, missing canonical source and duplicate/edit protection. No real historical backfill or provider trial performed. |
| Owner learning: `owner-learning-eligibility` and workspace | Influence seats / frozen Werewolf owned seats | **Source verified; existing tests cover workflow.** Werewolf completed-game choices use canonical initial seats. Public spectator access is separate from private owner-review evidence. |
| Public profile and history: `public-player-profile`, `public-agent-preview` | Influence competition receipts / no equivalent Werewolf participation feed | **Open gap reported to operator.** Add a separate game-aware participation/outcome summary. A dead member of the winning faction still won; do not inject Werewolf outcomes into Influence ratings or career statistics. Review-picker presence does not close this gap. |
| Production discovery: shared `ProductionPanel`, `listReplayVisualGames` | Admin Influence list + producer visual listing for both | **Source verified and existing W7A recovery coverage.** Producer/sysop sees completed Werewolf and visual-suspended games. Admin-only list remains Influence-only, so admin-only episode discovery is a separate gap. Do not widen paid render permission merely to fix discovery. |
| Producer naming/edit controls | Shared episode API, batch controls and editor for both games | **Implemented 2026-10-06.** Werewolf supports explicit selected batches and its per-game Production page exposes the shared editor. Generate/retry/refresh and protected edits use existing controls. Maximum-50, visible-selection, preview-count, lock and revision safeguards remain; active jobs cannot be duplicated. |
| Visual/trailer/Cut recovery | Shared job/publication machinery with game-specific evidence | Existing PG tests cover repair/publication conflicts and hidden-game denial; W7A includes durable pause and explicit resume. Source review confirms Werewolf production route. No new real repair, generation or publication performed during this audit. |
| Rules/MCP/availability | Shared rules reader and setup copy / game-specific Markdown and adapters | **Source reviewed.** Rules and `/get-mcp` cover both games. Creation/discovery consult enabled game kinds while existing URLs remain readable. No new connected-client or real-auth trial was run. |
| Individual reveal framing | Shared opaque full-body assets / approved rectangular study | **Still open.** W6 locations and wolf forms do not imply the v2 decorative rectangular reveal treatment shipped. Preserve original opaque portraits. |

## Validation artifacts

- `packages/api/src/e2e/house-journey.e2e.test.ts`: two isolated browser scenarios; desktop/mobile discovery, saved title, stable URL, entry, results, metadata, anonymous Unlisted and hidden denial. Harness uses gateway role and no provider credentials.
- `packages/api/src/__tests__/episode-presentation.test.ts`: frozen public source allowlist, no read-triggered job, outer-router access, copy persistence, visibility, plus existing Influence locks/job coverage.
- `packages/web/src/__tests__/werewolf-library-card.test.tsx`: old/waiting/live defaults and explicit operator cover/copy.
- `packages/engine/src/__tests__/werewolf-trailer-manifest.test.ts`: saved copy snapshot, stable slug, malformed/oversized copy and existing opening-only evidence contract.
- The pinned MCP schema generator updated `house-output-schemas.json` from the shared results type; API fixtures exercise strict MCP serialization. No connected MCP client was exercised in this slice.
- Local screenshots: `/tmp/w7b-cards-1440.png`, `/tmp/w7b-cards-390.png`, `/tmp/w7b-entry-mobile.png` (ephemeral; visually inspected).

## Final validation — 2026-10-05

- `bun run test`: 2,295 passed, five existing skips, zero failures.
- `bun run test:postgres`: 1,890 passed, zero failures, against the disposable `influence_w7b_test` database; database removed afterward.
- `bun run check`: all package typechecks and lint passed.
- Isolated House journey browser scenarios: two passed. Screenshots inspected at both widths.
- `git diff --check`: passed.

Initial test failures identified the hardcoded teaser validator and stale MCP output schema; both were fixed before the clean baselines. A focused long-history test hit Bun's default five-second timeout; it passed in the required full baseline using the repository's 30-second test timeout. No live provider, connected-client, production deployment or real rendering claim follows from these tests.

## B2 validation — 2026-10-06

Automatic naming/backfill changes passed 2,296 provider-free tests (five existing skips), 1,894 PostgreSQL tests, typecheck, lint and diff checks. The naming tests use fake providers; shared Production selection/preview/queue is component-tested. Authenticated real-browser verification was unavailable because the local browser session was signed out. No paid backfill, real naming trial or deployment was performed.

## Card asset provenance

Shipped `packages/web/public/visual/werewolf/lantern-village.webp` derives from the operator-approved v1 Lantern Village card study. One built-in image generation edit produced clean background art; Sharp encoded WebP quality 85. The original reference is `.renders/werewolf-art/lantern-village-v1/card.png`. UI typography, status, actions and the existing House logo remain real components, not baked into the background.

Generation brief: preserve amber dusk medieval village, timber/plaster houses, cobbled descending street, warm lanterns, pine hills and mist, restrained etched texture and charcoal shadows. Remove all text, logos, borders, cards, buttons and UI; fill naturally. No people, wolves or role clues. Upper two thirds show village; lower third dark enough for real typography. Premium rustic atmosphere, not resort. Landscape 1536×1024. No per-game generation is required.
