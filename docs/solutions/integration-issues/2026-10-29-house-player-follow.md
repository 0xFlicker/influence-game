---
module: Watch player and House host
tags: [house-host, gpt-live, playback, visibility, screenshots, canonical-events]
problem_type: integration_issue
---

# Bound House context to canonical playback

Game history and audio can arrive before the player reaches them. DOM scraping is also insufficient: it loses structured decisions and thinking, depends on layout, and confuses a display preference with knowledge permissions.

The player publishes canonical source/action coordinates. A game-owned adapter reads the eligible canonical prefix and accepted cognition; Mystery Werewolf excludes roles and thinking, while Omniscient and Influence include thinking independently of its display toggle. Composite events need action-level boundaries: a first ballot must not expose the later tally or elimination, and a role's explanation must not expose its investigation result. Keep state reduction contiguous and attach separately released partial facts until the full event is eligible.

Use ordinary request cancellation to prevent delayed fetch responses crossing a seek. Images come from native tab sharing, carry the current coordinate, and reach the vision model as image content. Pixels supplement structured data. No HTML scraping or text parsing determines accepted facts.

Use actual media `playing` for speech priority; scheduling/preloading is too early. Apply local mute plus steering, then unmute at speech end. Preserve the existing sessions and context updates. See [usage and tests](../../house-follow.md).

## Operator-only activation

House Studio owns Follow game, tab sharing/preview, and Stop. It opens a paired Producer/Sysop `/admin/follow/:slug` player. Public live/replay/embed pages have no follow controls and no bridge subscriber. Keep playback observations generic in shared viewers; mount the networking provider only behind the operator access boundary. Bind each temporary Studio pairing to its game and origin, and invalidate it on replacement/stop/closure.

## Commentary pause experiment

Instantaneous output amplitude is insufficient for a commentary hold: real GPT-Live speech contained quiet gaps up to about 919ms inside a contribution. A 1.2-second quiet release prevented repeated game-audio restarts in the bounded replay. Keep manual mute/disconnect immediate and preserve operator play intent separately from the commentary hold.

This does not establish turn completion or prevent early reactions. For audio turn-taking, release the current contribution to the voice frontend only after its speech finishes, and reserve the next speaking boundary before the game advances. Use the canonical recorded-speech clock: native media `ended` alone missed clips because the voice hook stops them at that clock boundary. Explicit comment/pass and preparing decisions during playback remain test proposals; no production decision protocol is established yet.

## Buffered Studio handoff (2026-10-30)

Generated House audio is captured in Studio and held until the paired player acknowledges a quiet boundary. The player freezes the director synchronously when its media speech ends, then acknowledges after voice suspension is applied. The acknowledgment identifies a playback hold, never a GPT-Live reply. House playback and capture may overlap; release waits for the queued output clock and device latency. This avoids racing the next game clip and keeps the existing music/OBS routing.
