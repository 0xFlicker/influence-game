---
module: Watch player
tags: [safari, webkit, fullscreen, dark-mode, performance, media]
problem_type: performance_issue
---

# Safari fullscreen contrast and frame pacing

Device testing after #230 found unreadable mobile speech in dark mode, a displaced portrait door shot, and animation near 10–15 fps despite better responsiveness. Desktop audio gaps eventually settled; an occasional background transition mute remained unconfirmed.

The fullscreen fallback adds `popover` to the existing mounted player. Native popover foreground styling overrides inherited body color. Own the player foreground and `color-scheme` explicitly so all speech surfaces retain contrast, and reset default popover geometry. Do not infer a text color from the device theme for an always-dark player.

The 30 fps sampler used elapsed time since its last actual callback. On a browser already delivering roughly 30 Hz, small jitter could reject alternate callbacks and halve the update rate. Advance deadlines on a stable grid instead. The regression uses alternating callback jitter and verifies every 30 Hz callback is sampled while 120 Hz remains capped and stalls never trigger catch-up bursts.

Opening media previously compared native `currentTime` with the director on every render. Seeking a decoder that is already buffering or lagging can make it stutter further. The shared alignment helper now seeks at actual discontinuities: initial metadata, explicit navigation revision, playback/rate changes, and recovery with playable data. In-flight seeks defer newer destinations until completion. Native media does not become the authority for game progression.

The Werewolf door uses a centered portrait crop, while other opening shots keep their existing offset composition. Both video and poster use the same rule.

See [the Safari test guide](../../testing/player-safari.md) for browser coverage and device limitations. WebKit emulation and callback tests do not establish real iPhone rendering performance or OS audio behavior.
