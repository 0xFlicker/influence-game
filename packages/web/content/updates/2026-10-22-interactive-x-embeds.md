---
title: "How to put an interactive player inside an X post"
date: 2026-10-22
summary: "X Player Cards can load an HTML player inside a post. Here is the metadata, framing policy, Next.js setup, and testing process behind The House's replay implementation."
tags:
  - engineering
  - watch
  - sharing
---

We clicked a game preview on X and the game loaded inside the post. An actual
interactive page, with controls, appeared where the preview image had been.

That was the experience we wanted for The House. When an Agent makes a terrible
bluff or a village turns on the wrong player, a screenshot loses the timing.
A link to an entire match asks people to find the moment themselves. An embedded
replay can put them straight into the conversation, with the ability to pause,
scrub back, and see what led to it.

The mechanism is **X Player Cards**. A webpage advertises an HTML player URL in
its metadata. X can load that URL in a sandboxed iframe when someone activates
the card. The familiar `twitter:` prefix still applies.

The documentation is the awkward part. As of October 22, 2026, the old
[official Player Card documentation URL](https://developer.x.com/en/docs/twitter-for-websites/cards/overview/player-card)
redirects to the general API overview. The current
[documentation index](https://docs.x.com/llms.txt) has no Player Card section.
The [official sample code](https://github.com/xdevplatform/cards-player-samples)
is still available, but it does not explain the current interactive-game
experience end to end.

Here's how we implemented it for The House.

## Two URLs do different jobs

Here's the flow:

```text
Someone posts your share URL
  → X fetches its HTML metadata and poster
  → A reader activates the card
  → X loads your embedded URL inside its frame
```

The **share URL** is an ordinary page on your website. It supplies the preview
metadata and remains useful when opened directly. The **embedded URL** serves the
compact interface that fits inside X.

For example:

```text
Shared page: https://example.com/watch/match-42
Embed:       https://example.com/embed/match-42?t=12
Poster:      https://example.com/images/match-42.jpg
```

You host all three. The HTML integration itself needs no X SDK, OAuth token, or
posting API call.

## Put the player metadata in the shared page

Here is a minimal share page. Replace the example domain, account handle, and
assets with your own publicly reachable HTTPS resources. `twitter:site` should
identify your actual account; the name below is a placeholder.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>A moment from match 42</title>

    <meta name="twitter:card" content="player">
    <meta name="twitter:site" content="@YOUR_ACCOUNT">
    <meta name="twitter:title" content="A moment from match 42">
    <meta name="twitter:description" content="Watch what happens next.">
    <meta name="twitter:image" content="https://example.com/images/match-42.jpg">
    <meta name="twitter:player" content="https://example.com/embed/match-42?t=12">
    <meta name="twitter:player:width" content="640">
    <meta name="twitter:player:height" content="640">

    <meta property="og:type" content="website">
    <meta property="og:title" content="A moment from match 42">
    <meta property="og:description" content="Watch what happens next.">
    <meta property="og:image" content="https://example.com/images/match-42.jpg">
    <meta property="og:url" content="https://example.com/watch/match-42">
  </head>
  <body>
    <h1>A moment from match 42</h1>
    <a href="/embed/match-42?t=12">Watch from this moment</a>
  </body>
</html>
```

The important distinction is that `twitter:player` points to **HTML**, not an
MP4. That document can contain a video player, a canvas, or a JavaScript replay
interface. The optional `twitter:player:stream` field describes a direct media
stream; do not point it at your HTML app. The
[official HTML sample](https://github.com/xdevplatform/cards-player-samples/blob/main/player/page.html)
also demonstrates a player document without a stream tag.

Keep the Open Graph tags for services that show an ordinary link preview. Emit
one coherent Twitter card definition; check that a parent layout has not also
left a competing `summary_large_image` tag in the response.

## Let X frame the player

On the **player response**, send this HTTP header:

```http
Content-Security-Policy: frame-ancestors 'self' https://x.com https://*.x.com https://twitter.com https://*.twitter.com
```

This is the framing portion of your policy; retain the other CSP directives
your application needs. Apply it to the embed routes. The normal site does not
need the same framing permission.

`frame-ancestors` must be an HTTP header. A meta tag cannot set it. It checks
every ancestor in a nested frame chain, which matters when X inserts its own
wrapper. `frame-src` controls the frames your page loads and solves a different
problem. These distinctions are documented in
[MDN's frame-ancestors reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors).

Remove conflicting `X-Frame-Options: DENY` or `SAMEORIGIN` headers on the embed
response. Check the application, reverse proxy, and CDN: adding a permissive
CSP does not loosen another CSP that still denies framing. Inspect the final
response after redirects.

Framing permission does not require changing your API to wildcard CORS. The
player can make ordinary same-origin requests to its own backend.

## Start with a small, working player

For a first integration test, serve this as `/embed/match-42`, alongside your
own poster and MP4. It uses a native video element so you can prove the card
plumbing before introducing a larger application.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Match 42 player</title>
    <style>
      html, body { margin: 0; height: 100%; background: #111; color: white; }
      body { display: grid; grid-template-rows: minmax(0, 1fr) auto; }
      video { width: 100%; height: 100%; min-height: 0; object-fit: contain; }
      a { padding: 12px; color: inherit; font: 16px system-ui; }
    </style>
  </head>
  <body>
    <video id="player" controls playsinline muted preload="metadata"
      poster="/images/match-42.jpg" src="/media/match-42.mp4"></video>
    <a href="/watch/match-42" target="_blank" rel="noopener noreferrer">
      Open the full page
    </a>
    <script>
      const player = document.querySelector('#player');
      const requestedTime = Number(new URLSearchParams(location.search).get('t'));
      player.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(requestedTime) && requestedTime >= 0
            && Number.isFinite(player.duration)) {
          player.currentTime = Math.min(requestedTime, player.duration);
        }
      }, { once: true });
    </script>
  </body>
</html>
```

If you use a stricter script or style CSP, move the inline code into allowed
same-origin files or supply the appropriate hashes/nonces.

The House uses the same outer arrangement with our existing React replay
engines in place of the video. Our player reads recorded game events and renders
the scene, speech, and transport controls. The card is another way to watch an
existing match; opening it does not start a new game or generate new media.

We keep the embed outside the normal site's authentication and wallet providers.
Replay reads are explicitly anonymous, and preferences can live in memory.
That keeps playback usable when storage is blocked or the reader has never
visited The House.

## The Next.js details

Our implementation uses Next.js 16.1.7's metadata API. A simplified version of
the player metadata looks like this:

```ts
import type { Metadata } from "next";

export const metadata: Metadata = {
  twitter: {
    card: "player",
    title: "A moment from match 42",
    description: "Watch what happens next.",
    images: ["https://example.com/images/match-42.jpg"],
    players: [{
      playerUrl: "https://example.com/embed/match-42?t=12",
      streamUrl: "",
      width: 640,
      height: 640,
    }],
  },
};
```

In this version, the type requires `streamUrl`, but the renderer omits an empty
value. That lets us emit an HTML Player Card without a fake stream URL. We
verify the resulting HTML in integration tests; recheck this behavior when
upgrading Next. Real game routes use `generateMetadata` to load a small record
containing eligibility, title, artwork, and validated replay coordinates.

The tags must be available without running client JavaScript. Next already
includes Twitterbot in its blocking-metadata defaults. We chose
`htmlLimitedBots: /.*/` to deliver metadata in the initial head to all clients,
including less predictable social crawlers. This disables metadata streaming
and can delay the first response while metadata resolves; it is our tradeoff,
not an X requirement. See the
[Next.js configuration reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/htmlLimitedBots).

We also serve the same card metadata to humans and bots. This avoids introducing
a user-agent-dependent HTML variant for a CDN such as Cloudflare to cache
incorrectly. Framing headers likewise belong on every player response, not
only requests that identify themselves as Twitterbot. The person loading the
frame is using a browser.

## What works inside the frame?

During our desktop inspection of the
[Gates post](https://x.com/EckertAnthony/status/2113123343587025401),
X's wrapper frame used these attributes:

```html
sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
allow="autoplay; fullscreen; web-share"
```

The observed sandbox permits scripts and popups. `allow-same-origin` preserves
the player's origin; it does not give it access to X's cookies or DOM. The
observed frame omitted `allow-forms` and top-level navigation permissions.
An arbitrary full website therefore needs more testing than a focused player.

**Opening a new tab is possible under the observed permissions.** Use a normal
link triggered by the reader:

```html
<a href="https://example.com/watch/match-42"
   target="_blank" rel="noopener noreferrer">Open full experience</a>
```

`allow-popups-to-escape-sandbox` permits that new browsing context to open without
inheriting the frame's sandbox restrictions. It is the appropriate place for
sign-in and account flows, subject to normal browser behavior. Popup blocking
and X's client-specific configuration still apply. These are
[browser sandbox semantics](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe),
not a promise that every X client uses the same settings.

For audio, prepare a muted player and provide an explicit play/unmute action.
X's click may only create the iframe; do not assume it supplies activation to
your newly loaded document. Permission delegation does not override browser
[autoplay rules](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay).
Fullscreen and Web Share also need feature detection and real client tests.

## Preserve the moment in the URL

For The House, the share button captures the current replay coordinate, time
within the cue, speed, thinking visibility, mute state, and volume at the moment
it is clicked. Werewolf also preserves its viewing mode and audience-specific
cursor. The recipient can scrub backward; a completed replay with no timecode
starts at the beginning.

These settings travel to the player through the URL. X does not understand or
restore them for you. Validate the inputs on both entry paths, and keep account
tokens and private state out of share URLs. A requested audio setting also
cannot override a browser's requirement for a user gesture.

We shorten these links to `https://thehouse.game/s/<code>`. The short page resolves
the saved destination on the server and returns its own complete card metadata
with HTTP 200. Its `twitter:player` points directly to the corresponding embed
with the saved settings. A normal browser continues to the full replay, with an
ordinary link available as a fallback.

This avoids depending on a crawler to execute a JavaScript redirect or discover
metadata on a later page. It also lets the same share URL carry Open Graph
previews and a separate Farcaster Mini App launch action. Farcaster's launch
mechanism and permissions are independent of X's iframe.

## Verify each layer before blaming the cache

Fetch the public share page as a crawler:

```sh
curl -sS -L -A 'Twitterbot/1.0' \
  'https://example.com/watch/match-42' -o /tmp/card.html
rg 'twitter:|og:' /tmp/card.html

curl -sS -L -D /tmp/player-headers.txt \
  'https://example.com/embed/match-42?t=12' -o /tmp/player.html
cat /tmp/player-headers.txt
```

Check that the initial head has one player definition, the poster returns an
image, and the player returns HTML with the intended framing policy. All of
these resources must be reachable without login, a private network, or an
interactive bot challenge. A localhost result cannot prove crawler access.

Then load the player inside a test iframe using the sandbox attributes shown
earlier. Use a separate origin if you need to reproduce cross-origin behavior;
a same-origin harness does not reproduce every third-party restriction. Test
small widths, denied storage, seeking, sound activation, and the ordinary
outbound link. Our automated tests cover sandbox playback, anonymous reads,
metadata delivery, and restoration of the shared moment.

Finally, post the public share URL on X and test the actual card on desktop and
the mobile clients you care about.

| Symptom | Check first |
| --- | --- |
| No card or only an image preview | Initial HTML tags, duplicate card types, crawler access, poster response, and X's treatment of the domain. |
| Preview appears but the player is blank | Final player URL, CSP, X-Frame-Options, mixed HTTP content, and JavaScript errors. |
| Works in a tab but fails inside X | Auth dependencies, storage access, nested-frame permissions, and iframe-sized layout. |
| Changes do not appear | Distinguish your CDN response from X's cached card metadata. |

X's card cache and your application's cache are separate. Purging Cloudflare
does not establish that X has recrawled the URL. Compare the current public
response with a fresh test share URL to help isolate stale card data. We have
not established a guaranteed refresh interval or a reliable forced-refresh API.

The part worth building around is the interaction: someone can arrive at a
specific moment and explore it before leaving the post. A compact anonymous
player, explicit framing headers, and an ordinary full-page destination make
that interaction useful.
