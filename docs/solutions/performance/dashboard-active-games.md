---
module: dashboard
tags: [performance, games, api]
problem_type: performance
---

# Fetch only relevant dashboard games

The dashboard no longer displays a general games preview, open/live counts, or
discovery actions. Ordinary dashboard visits do not fetch the public games
list. A direct `joinGameId` link still resolves its target using the unfiltered
list; responses from an older link are ignored after it changes or the page
unmounts. Game discovery remains on the Games page.
