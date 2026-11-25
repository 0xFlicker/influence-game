---
module: public-game-browse
tags: [nextjs, caddy, werewolf, portraits]
problem_type: performance
---

# Cold public game entry

The Games shelf requests multiple Werewolf cast portraits at once. Each character image used to hydrate replay narration, build the spectator projection, load published scenes, and then hydrate narration again to find the frozen cast. The November 25, 2026 UTC incident included many stalled portrait requests and a Caddy 502 after 12.6 seconds for `/api/games/iron-sage-lake`. Caddy recorded an upstream EOF. The affected color remained running. The logs show the requests failed together, but they do not identify what closed the API connections.

Read character membership from the indexed opening event. Both replay audiences retain every opening player at each cursor. Resolve the requested player's frozen portrait or body with the same reference resolver as Studio and exports. Continue to check public game visibility and validate replay URL parameters. Scene artwork still requires the audience-specific projection and publication checks.

For public character images stored as immutable payloads, stream the original object through the API. Read four signature bytes to preserve the existing PNG, JPEG, or WebP response type. Content hashes identify the saved object and remain part of storage verification. Public delivery uses the authorized key directly and avoids buffering or hashing the image on each request.

Next.js shares one bounded server read for public game identity and social metadata. The card acknowledges navigation while the route response is pending. The game shell shows a skeleton during data loading and offers a retry when the lobby request fails. API clients replace upstream HTML error documents with a short message.

For a recurrence, compare Caddy timestamps and durations for the document, game API and character URLs with API and web container logs. Run the browser test with a held route response and a simulated HTML 503 to verify the loading and retry states independently of production latency.
