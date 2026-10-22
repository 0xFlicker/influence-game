# House short links

All existing share controls (replay moments, trailers, House Cuts, public profiles)
use `https://thehouse.game/s/<code>`. The ten-character cryptographically random
Base58 code omits ambiguous characters. No external shortener or new domain is
required. The square-with-up-arrow icon retains an accessible label and tooltip.

## Creation and lifetime

`POST /api/share-links` accepts exactly `{ "path": "/games/example/replay?..." }`.
Only app-relative paths are accepted. The shared `parseHouseShareTarget` contract
allowlists game/lobby pages, replay/sequence/results/highlights, public profiles,
game listings/types/seasons, home, rules, about, updates, privacy, terms and MCP
instructions. Admin, dashboard, creation, authentication, short-link nesting,
external URLs, duplicate settings and unknown query parameters are rejected.
Replay settings use the same parser as the player. Influence Cuts use the `public`
audience; Werewolf uses `mystery` or `omniscient`.

`house_share_links` stores only the code, normalized relative destination and
creation timestamp in PostgreSQL. Its unique destination index makes concurrent
identical requests reuse a link. Collision handling never overwrites a code.
There is no edit endpoint or automatic expiry. The route does not grant access:
creation and resolution check game visibility/status and public profile identity.
Unlisted games retain their existing link-access semantics; hidden games do not
become accessible through a saved link. Missing codes return 404.

The first icon click captures the replay cue, cue-local time and settings
synchronously and opens a small native HTML dialog. After link creation, Copy link
and a second share-icon button operate on the short URL. This fresh user gesture
lets `navigator.share` work even when the creation request took longer than browser
user activation allows. A creation failure shows an explicit retry; retries retain
the original captured moment. It never silently publishes the long URL. Closing
the dialog invalidates pending UI results.

## Automated abuse protection

Creation uses PostgreSQL transactions and row locks, shared across API instances:

- 120 attempts/minute per signed anonymous browser cookie.
- 6,000 attempts/minute per actual network peer. Behind the deployed ingress this
  is an aggregate ingress limit, intentionally far above ordinary sharing traffic.
- A blocked creation returns 429 and `Retry-After: 60`. There is no daily quota,
  required account, or CAPTCHA. The request body is capped at 4 KiB.

Identity keys are HMAC hashes using `JWT_SECRET`; raw addresses are not stored.
Bun supplies the peer address. Caller-controlled `CF-Connecting-IP` and
`X-Forwarded-For` headers cannot change this bucket. Rotating/blocked cookies still
shares the aggregate peer allowance. Expired counters are removed during creation.
These are protection limits, not a claim that humans and automation are perfectly
distinguishable.

GET resolution and social previews never consume creation allowance. Short-page
resolution is deduplicated within a render. Availability-sensitive responses use
`no-store` rather than caching access to a newly hidden game; the indexed mapping
lookup is independent of game transcript/history reads.

## Social previews and navigation

`/s/[code]` returns real HTML metadata in the initial head for every User-Agent.
The page reuses the completed game's Player Card builder or the selected Cut/profile
metadata. X's `twitter:player` still points to the anonymous `/embed/games/...`
player, with the frozen replay state and existing framing policy. Ordinary browsers
replace the short URL with its saved full-app destination. Without JavaScript, an
ordinary destination link remains available.

Farcaster's action points back to `/s/<code>?app=mini`. Farcaster can merge cast URL
parameters into its launch action, so this resolver discards everything except the
Mini App context hint before opening the saved route. It cannot override the cue,
time, speed, audience or settings. The full app retains its existing navigation and
authentication. Native host sign-in/wallet behavior still needs live host testing;
browser metadata/replay tests do not prove that integration.

## Deployment and verification

Migration `0126_house_share_links.sql` adds two tables and indexes. It does not
rewrite existing game data or alter existing tables; old API versions remain valid
rollback targets. No environment variables, providers, buckets or background
workers are added. Deploy through the ordinary staging/production release gates.

Focused tests cover route rejection, coordinate normalization, concurrent reuse,
distributed admission and expiry, hidden targets, spoofed headers, icon controls,
native-share cancellation and failures. The player browser suite checks initial-head
X/Farcaster metadata, both games' restored moments/settings, backward scrub, bare
replay starts, query-override resistance, and profile/Cut sharing. Validate the
deployed URLs with X and Farcaster preview tools before claiming live feed rendering.
