---
title: Play House replays inside X posts
type: feat
status: implemented_locally
date: 2026-10-21
updated: 2026-10-22
research: ../research/2026-10-21-x-player-cards.md
source_commit: 0336981e
---

# Play House replays inside X posts

## Approved scope

Implement the anonymous player for completed Influence and Werewolf games, plus a visible Share button in the existing player. Share captures the current position and playback settings when clicked. The receiver starts playing there and can scrub back through the complete replay. A completed replay link without a position begins at the opening.

No agent creation, signup, sign-in, public posting, or deployment is included. The initial research remains in [the technical write-up](../research/2026-10-21-x-player-cards.md). Local HTML and browser proof do not establish that X will accept or display a card for our domain.

Unrelated notification work was preserved in the root checkout before this branch started at `origin/main` (`0336981e`).

## Implemented structure

- The root layout contains only the document shell and global CSS. Ordinary route entry files live in `(site)` and retain the existing providers, metadata, footer, and account functionality. Shared implementation modules keep their existing source locations and imports; public URLs do not change.
- `/embed/games/:slug` and `/embed/games/:slug/:sequence` mount the existing game-specific players without the site providers. They have no auth bootstrap, wallet connection, producer controls, analytics initialization, or account prompts.
- Influence reuses its director, canonical presentation adapter, opening, visuals, thinking, music, and transport. Only the actual client player requests transcript and replay frames. Werewolf retains audience-specific bounded watch windows, publication cutoff, navigation generation fences, and its own canonical cursor.
- Embedded API reads use `anonymousApiFetch`: no bearer token, no device-storage access, `credentials: omit`. Embedded preferences remain in memory. Lazy visual/thinking reads follow the same anonymous path and existing API authorization. Requests abort on cleanup.
- `/api/game-entries/:idOrSlug/card` returns only routing identity, status, visibility, and existing episode copy/cover. It uses a bounded relational lookup, does not read history or generate media, and returns `private, no-store`. Hidden/missing/invalid-visibility games return 404; public and unlisted direct links retain their existing access policy.
- Both normal replay route forms use a small server routing bootstrap and client hydration instead of serializing the full replay into crawler HTML.

No database schema, storage model, game execution, canonical event, or contestant observation changes are involved.

## Sharing contract

Share lives in the transport bar. On browsers with Web Share it opens the OS share sheet directly from the user gesture. Cancellation does nothing further. When unavailable or denied, a small native HTML dialog shows the frozen URL and Copy link. If clipboard access is unavailable, the URL remains selectable. The dialog supports Escape, focus management, and fullscreen through the browser's top layer.

The URL retains the existing game-specific source coordinate:

- Influence: `/games/:slug/replay/:sequence` for a canonical game event; the plain replay route for authored opening cues.
- Werewolf: `/games/:slug/replay?audience=mystery|omniscient&cursor=N`; the audience-only route for an opening cue.

The query adds:

| Field | Meaning |
|---|---|
| `cue` | Exact stable presentation cue key within the canonical replay. Includes ballot substeps and opening beats. |
| `t` | Seconds elapsed **within that cue**, rounded to the nearest millisecond. This is not the displayed whole-replay timestamp. |
| `speed` | One of `0.5`, `1`, `2`, `4`. |
| `thinking` | `1` or `0`; Mystery always shares `0`. |
| `muted` | Music mute preference, `1` or `0`. |
| `volume` | Music volume between `0` and `1`. |

Cue-local time avoids an incorrect landing when earlier thoughts have not yet been fetched and their durations are absent from the whole-replay timeline. No screenshot, transcript parsing, elapsed wall-clock time, or mutable cue-array index establishes game position.

The click callback reads the live director rather than a previously rendered frame. Shared settings initialize before the player mounts and override device preferences for that mounted replay without changing the receiver's saved defaults. The recipient starts playing even if the sender shared while paused. Browser autoplay rules may still require a click to enable audio; saved unmuted state does not confer browser permission.

A shared offset that includes thinking waits for the current thought and restores its original local time, rather than adding that thought's duration twice. Default and Restart playback explicitly seek to frame zero. Initialization reads the live director state so React's development effect replay cannot reset a shared moment to the opening.

The full timeline stays available. Sharing does not trim the replay or turn the initial position into a lower seek bound. The URL parser rejects duplicate playback fields, malformed booleans, invalid speeds, negative/nonfinite times, and out-of-range volume. Missing/stale exact cue keys produce an explicit unavailable message. Existing sequence/cursor validation and audience restrictions remain in force.

On narrow players, volume moves into Settings to leave room for Share, playback controls, mute, and fullscreen. Omniscient embeds visibly identify their spoiler mode.

## Card and HTTP behavior

Completed, visible games advertise `twitter:card=player` on the game landing page, replay page, and Influence sequence page. The player URL forwards only validated playback and audience fields. Other states keep image cards; direct embeds of unfinished games show an unavailable state. Unlisted metadata and all embed routes are noindex.

Metadata is identical for browsers and Twitterbot. There is no User-Agent-specific response or new Cloudflare cache variant. Next's existing HTML-limited-bot behavior puts Twitterbot metadata into the head. Open Graph remains a normal image preview. Posters use existing episode covers or neutral House/Werewolf artwork, resolved against the public web origin rather than an internal API host.

The card declares 640 × 640. Typed Next 16.1.7 metadata supplies `streamUrl: ""` because its type requires a value; the renderer omits the empty `twitter:player:stream` tag. Browser HTTP coverage verifies one player-card declaration and no stream tag.

Only `/embed/*` receives:

```http
Content-Security-Policy: frame-ancestors 'self' https://x.com https://*.x.com https://twitter.com https://*.twitter.com
X-Robots-Tag: noindex, nofollow
Referrer-Policy: strict-origin-when-cross-origin
```

There is no conflicting X-Frame-Options header. Other site framing behavior is unchanged. Production defaults to `https://thehouse.game`; `WEB_BASE_URL` selects a different deployment's public origin. Local development can resolve its request origin.

X may independently cache old cards. Always sending metadata prevents a crawler/browser cache split at our origin; it does not invalidate X's cache or prove Cloudflare's deployed response. No live cache policy or edge configuration was changed.

## Local verification and release work

Meaningful automated coverage includes:

- Snapshot URL round trip, validation, audience forwarding, image-card eligibility, and unlisted noindex.
- Anonymous card endpoint privacy, bounded response shape, and hidden-game denial.
- Exact shared time inside an initially unloaded thought and backward seeking on the same director.
- Actual Next HTTP responses for Twitterbot and a browser, metadata uniqueness, head placement, empty-stream omission, framing headers, and small embed HTML.
- Real Influence and Werewolf players in an iframe with the observed X sandbox and permissions attributes; device storage throws; no account/analytics requests or bearer header appears.
- Native share capture, restoration of the same non-opening cue/time/speed/thinking, backward scrubbing to zero, native-dialog fallback, compact 320/480-pixel controls, and plain completed replay links beginning at the opening.

The browser harness uses an isolated database and cleans up owned servers, Chrome, and the database. It uses a same-origin parent allowed by `'self'`; it does not pretend to be an actual X client. Normal API and provider-free baselines plus typecheck/lint remain required before merge.

Verified locally on October 22: `bun run test` **2,776 passed, 5 skipped**; `bun run test:postgres` **2,130 passed**; focused iframe browser tests **4 passed / 76 assertions**; `bun run check` passed. The production Next build passed using the existing test public Privy app ID (no real login credentials). The sandbox initially blocked local servers/database access and stalled the compiler; those commands succeeded when rerun with normal local access. Generated Next test config changes were removed.

After deployment is separately authorized:

1. Inspect public HTTPS HTML, poster decoding, player headers, and redirects through the actual Cloudflare/Caddy path, using both User-Agents. Verify the configured origin is the deployment being tested.
2. Confirm ordinary browsing, unlisted direct access, hidden-game denial, long-game loading, backward seeking, and autoplay-denial handling on the deployed site.
3. Publish a user-approved test post for a public completed game and a shared moment. Observe the actual iframe URL, loading, controls, shared start, full replay access, and error behavior.
4. Test X desktop, iOS, and Android separately. Check clipping, gestures, audio, fullscreen, and native sharing. Record unsupported surfaces accurately.
5. Only then claim that The House's player actually works inside X. No X approval process, domain eligibility, native-app support, cache lifetime, or immediate cache invalidation is assumed from local success.
