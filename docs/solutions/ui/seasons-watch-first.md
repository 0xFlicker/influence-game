---
module: Seasons
problem_type: ux
tags: [seasons, playback, lazy-loading]
---

# Watch-first Seasons

The selected season controls a lightweight public game feed, the watch surface, and standings. `GET /api/seasons/:seasonIdOrSlug/games` filters the exact season and public/non-hidden games before limiting discovery to 24 rows. It returns identity, kind, status and timestamps only; it does not load game transcripts, media or private evidence. Championship games retain their independent event relation and remain on the championship surface.

Discovery prefers a live game, then the newest completed replay, then a waiting game. Waiting, suspended and cancelled games do not offer playback. The all-season-games link opens the existing full shelf. Selecting a playable sidebar item starts it directly. Playback pins the selected game object and identity so background discovery refreshes cannot interrupt it; changing seasons unmounts the old player.

The player module is dynamically imported and mounted only after explicit playback. Preview backgrounds and the selected agent's transparent body (or headshot fallback) are ordinary page artwork. They do not require a replay request. Existing Influence and Werewolf players retain their own live data, audience controls, theater and fullscreen; no movie scene or export contract changes here.

The entry picker is collapsed initially. Join/Create remain prominent when needed; expanding retains switch, update and leave actions and existing season-intent validation. Choosing another agent changes only the preview until Switch/Join is pressed.

## Verification (2026-11-04)

- Existing localhost Season 1: one click loaded the real live `dead-mauve-flare` viewer in place. Theater filled the window; fullscreen entered/exited successfully.
- Browser observed-resource inventory before Play: 88 resources, 3 images, zero video, no game-detail/presentation/audio/visual requests and no season-game-player/replay chunk. The season metadata feed was present. After Play: 115 resources; player/replay chunks and real game/presentation/audio/visual requests appeared. Season 0 independently showed zero player resources before Play (101 total, 11 images, zero video); after Play its real Werewolf replay loaded (124 total, 23 images, two videos). Counts describe development mode and this observed state, not a production performance budget.
- Narrow viewport: no horizontal overflow; transparent Luna bust, collapsed entry, picker switching and headshot fallback verified without changing the queue. All Season 1 games opened the correct shelf. Empty historical season showed no playable game; Season 0 still showed its published championship.
- Isolated PostgreSQL season-read-model suite: 9 passed, 76 assertions. Includes season separation, public visibility, hidden attempt exclusion, metadata-only shape and missing season.
- Focused web discovery/preview and lazy-mount component tests: 12 passed, 40 assertions. Typecheck and lint passed. Full provider-free baseline recorded separately when complete.

No extra game, asset generation, server restart, database reset or deployment was performed for this layout.

## Playback layout follow-up

The game label and Close player row now reserves its real layout before playback, using hidden visibility and `aria-hidden` rather than conditional mounting. It remains unfocusable and invisible until playback; no viewer is mounted by the reservation. Browser measurements before/after real live playback: desktop player 800px, caption 47.995px, standings document Y 1471.875px; narrow layout player 460px, caption 75.981px, standings Y 1450.825px. Watch-section heights were unchanged (942.760px desktop, 887.813px narrow), with no horizontal overflow. The narrow browser's zoom-adjusted CSS viewport measured 416px.

Complete provider-free regression: **3,348 passed, 5 skipped, 0 failed, 40,578 assertions** across 358 files (234.12s). Initial sandbox run could not bind ephemeral test ports; rerunning with loopback test permission passed. Existing application servers were not operated. Full PostgreSQL regression is running in its own disposable database, independently of `influence_dev`.
