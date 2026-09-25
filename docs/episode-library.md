# Episode library

Games use wide show cards: two per shelf at desktop widths, one below 1024px.
Season shelves precede public games; private games are shown only to their creator,
a seated player, or an administrator. Search matches episode copy, original cast,
season and code words. View all opens `/games/season/<season-slug>`, `/games/public`,
or `/games/private`; each direct route renders its collection as a grid and stays
scoped after refresh. Season routes use a namespace separate from game slugs. Filters
narrow the current collection. Slugs and URLs do not
change when the House or an administrator changes a title.

## Interaction and playback

Mouse hover animates only the card artwork. Clicking the card opens the top-level
game page, with one-use, 15-second playback intent. Watch live/Watch Replay links
open `/replay`; Details opens `/results`. Direct visits and reloads do not request
autoplay. Waiting games retain their existing join/lobby screen.

Touch cards omit inline actions. A tap opens a native dialog styled to fill the
viewport, with inline video, Close and all game actions. Escape/Close restores
focus and page scrolling. Trailer completion, Skip, or a media error transitions
to the other renditions; Replay trailer is explicit. Only one hovered card animates.
Offscreen previews stop; backgrounded videos pause. Reduced motion disables automatic
artwork cycling and transform animation. Native video controls and captions remain.

Sound defaults off. The explicit sound control remembers the preference for this
tab session, including reloads. Playback attempts handle browser rejection: retry muted if sound-on
playback is blocked, then offer Play if muted playback is blocked too. A successful
navigation gesture is not treated as proof that playback started. No trailer audio
plays on hover.

## Editorial data and provenance

`game_episode_presentations` owns titles, descriptions, optional cover selection,
preview order, a manual lock and a revision. It does not mutate canonical game data.
The API batches summary reads and frozen cast portraits. Detailed media is fetched
only when a card is previewed or its entry page is opened.

The game worker queues naming for in-progress games without a presentation. A strict
provider-native JSON schema produces two bounded strings from original cast names
and personalities, with no result/history context. Generation uses Standard processing,
low reasoning and a 45-second timeout. It cannot block game execution. An unavailable
provider leaves slugs/cast artwork usable. Failed attempts are visible in the admin
editor and require explicit retry; old copy remains published. Titles stay stable
unless an administrator requests regeneration or edits them.

A DB lease serializes naming; revision and claim-token comparisons fence late
responses after edits, requeues, lock changes or lease replacement. Deployment
admission gates new worker claims, and shutdown aborts the active request.

Browse frames select published lobby scenes containing the complete original cast,
original portrait groups, and House teaser cards. Alliance cards use accepted
activation-time membership before the first canonical elimination, never current
membership or parsed dialogue. Invalid event streams produce no alliance teasers.
Existing spoiler-safe postgame trailer bundles provide video, poster and captions.
Outcome-bearing House Highlights remain behind the explicit Highlights link.

## Administration and backfill

Episode editing and backfill live only in `/admin/production`, alongside trailer
and poster diagnostics. The episode editor uses existing `manage_postgame_media` permissions (or
`manage_roles`). Editors can change copy, protect it from regeneration,
choose a published cover from that game, order frames, regenerate copy, and backfill
or rerender the existing trailer/poster bundle. Revision conflicts require reloading;
a late model response cannot overwrite the newer edit.

Production starts with zero selected games. Filters change the visible set and clear
selection plus any pending review. Each row has a checkbox; Select all applies only
to the matching set and is disabled above 50 matches. Individual selection is capped
at 50. Review sends only selected, currently visible IDs to a read-only preflight,
then lists the exact eligible titles, slugs and IDs plus skipped/call counts. Queue
submits only those reviewed IDs. Protected, already-named or active jobs are skipped
for missing-title backfills. No silent first-50 selection occurs. This action generates
text only; no images or video. Trailer/poster production uses the established render worker,
its publication contract and existing render management permissions. A failed
replacement does not remove the current published bundle. No independent generated
video or new per-game image-generation pipeline is introduced.

Migrations 0090 and 0091 create the editorial table and preview ordering respectively.
No historical games are renamed by migration. Administrators explicitly backfill
completed history. Naming is background work on the game-worker role; gateway reads
never trigger provider calls.

## Verification

Provider-free playback tests cover one-use intent, muted fallback and failure.
PostgreSQL tests cover strict output validation, durable publication, failure with
old copy preserved, edit fencing, locks, admin revision conflicts, invalid media selection and private preview access. The local public
identity browser suite includes the episode touch overlay, desktop destinations, blocked autoplay, sound preference and trailer completion;
format viewer browser tests enter the player through `/replay`.

Local validation for this change: `bun run check`, 1,975 provider-free tests,
1,655 PostgreSQL tests, 11 identity/episode browser tests and 17 API browser tests
passed. All 40 format-viewer cases passed across the full run and targeted rerun
of two updated route expectations. Desktop and 390px layouts were inspected against
local data. Browser media-policy tests use a tiny local video with controlled
playback promises; real Safari/iOS autoplay and paid House generation were not run.

Collection/production follow-up: browser coverage uses 60 fixture games, checks all
three collection URLs through reload, verifies public cards have no editorial controls,
and proves filter changes clear selection and a one-game review/queue sends exactly
one ID. No real backfill is performed by this test.
