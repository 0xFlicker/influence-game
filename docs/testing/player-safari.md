# Safari player performance and compatibility

The shared player supports Influence and Werewolf using one presentation director. Animation sampling is confined to the stage and transport, capped at the 30 fps presentation rate, and idle while paused/buffering. Recorded timing is cached and clip lookup is indexed. These are application-work reductions; they are not a claim of measured iPhone frame-rate gains.

## Automated checks

Install the pinned browser and run the deterministic fixture stories:

```sh
bunx playwright install webkit
PLAYWRIGHT_FORMAT_VIEWER=1 bunx playwright test e2e/format-aware-game-viewer.spec.ts \
  --project=webkit --project=webkit-mobile \
  --grep 'player performance|Influence scrubber|unmuted intro|Influence opening reveals cast|fullscreen portrait player' \
  --retries=0
```

Use `--project=chromium` for the comparison. Each project runs with one worker. The harness creates and drops its own local PostgreSQL database and stops its API/web children. No provider credentials or paid games are needed.

The performance stories check forward timeline progress and pause behavior for both games. Each attaches `player-performance.json` with requestAnimationFrame interval p95, maximum, sample count and backward-position count. Intervals measure callback availability, not GPU-rendered frames. Hardware, browser instrumentation, development compilation and concurrent tests affect these numbers; compare warmed production builds on the same hardware for a performance claim. Do not enforce a universal laptop timing threshold in CI. Failed cases retain screenshots and traces.

[Playwright WebKit](https://playwright.dev/docs/browsers#webkit) tests the engine build supplied with Playwright. The iPhone project emulates mobile viewport/input settings; it does not run iOS, its media session, GPU or browser chrome. Keep actual Safari/iPhone checks separate. On this machine the Node 26 installer stalled extracting WebKit; the existing Node 22 runtime completed the same pinned install. This is tooling setup, not a product dependency change.

### Local validation — 2026-10-27

The pass starts from `869a3bc8` (merged live-match loading transitions, #229). The selected browser command above, including Chromium, passed all **21 stories** with retries disabled. Both games advanced continuously with **zero backward scrubber samples** in all three projects. Desktop WebKit mouse dragging and mobile WebKit native touch seeking are separate assertions.

Five-second fixture probes produced the following callback intervals on this development machine. These are development-server smoke measurements, **not a before/after benchmark or real-device FPS**:

| Browser project | Influence p95 / max (ms) | Werewolf p95 / max (ms) |
| --- | ---: | ---: |
| Chromium | 16.8 / 183.4 | 16.7 / 16.8 |
| Desktop WebKit | 18 / 50 | 21 / 27 |
| Mobile WebKit emulation | 19 / 21 | 20 / 32 |

The provider-free baseline passed 3,098 tests (5 skipped); PostgreSQL passed 2,262 tests. After the final touch/audio refinements, the complete web suite passed 1,312 tests. Local listener tests require execution outside the filesystem/network sandbox; the sandbox-only attempt could not bind its ephemeral ports. No paid providers, staging or production were used. Actual Safari and physical iPhone profiling remain unperformed.

## Audio checks

Start with fresh site preferences. During the opening, press **Turn music on** once, then exercise pause/resume, skip opening, scene navigation, a crossfade, a loop boundary, volume/mute, and the final results. Repeat with a cold media cache and a slow connection. Verify the first requested audio starts and a later deck can play without another gesture.

Unmute handlers pass the new preference synchronously to the audio controller. Ambient audio resumes its context even when an earlier automatic resume is pending, and primes both retained media elements inside the gesture. `public/music/unlock.wav` is 100 ms of generated 8 kHz mono PCM silence for the otherwise-empty deck. Interrupted contexts retry through the bounded start path; permission denial exposes **Enable music**. Opening audio can start its permission request before metadata arrives, stays silent until positioning is possible, and applies the requested seek before audible playback. Automatic drift correction avoids seeking again while an earlier media seek is pending.

On real devices, test app switching, a locked screen, interruptions from another audio app, Bluetooth/headphone changes and return to the tab. The automated visibility event test proves transport policy and decoded-media continuity, not operating-system background guarantees. iOS controls native HTML media volume differently from desktop; verify opening/voice volume and hardware volume on the target device as part of this check.

When unmuting a paused player, media-element priming is asynchronous behind a silent master gain. Browser assertions must wait for the elements to return to `paused` and verify the transport still offers **Play replay** before starting playback. An immediate `paused` read races activation. PR #230's victory-music CI failure reproduced this race; the condition-based assertion passes all three ending scenarios and retains the actual playback, pause/resume and no-loop checks.

## Safari and iPhone profiling

Use [Safari Web Inspector Timelines](https://webkit.org/web-inspector/timelines-tab/) on desktop or through a connected iPhone. Record a warmed 30–60 second segment with opening video, a full room, spoken audio and Show thinking. Capture JavaScript & Events and Layout & Rendering; inspect Frames and CPU separately to avoid adding every profiling instrument at once. Compare the same game, cue, speed, viewport and thinking setting on the same device. Repeat paused: the stage and scrubber should no longer schedule continuous React updates. Save exported recordings with device, OS/browser version, game/cue and build SHA.

For automation against installed macOS Safari, use Apple's [safaridriver/WebDriver](https://developer.apple.com/documentation/webkit/testing-with-webdriver-in-safari). It requires Safari remote automation to be enabled. Playwright cannot target the installed Safari application. Actual iPhone validation remains necessary for touch, browser chrome, memory pressure, thermal behavior and audio interruptions.

## Fullscreen

The fullscreen request asks native browsers to hide navigation UI. Where element fullscreen is unavailable, the existing popover/fixed-viewport expansion preserves the mounted player and playback state. This fallback cannot hide Safari's address or status bars. WebKit's [iPhone element-fullscreen issue](https://bugs.webkit.org/show_bug.cgi?id=206854) tracks that platform limitation. Native video fullscreen is not a replacement for a player containing custom scenes, captions, thinking and controls. Verify rotation, safe areas, settings, Escape/exit and scroll restoration on an actual device.
