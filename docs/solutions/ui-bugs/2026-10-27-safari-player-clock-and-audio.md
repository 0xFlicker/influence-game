---
module: Watch player
tags: [safari, webkit, audio, performance, timeline, werewolf, influence]
problem_type: performance_issue
---

# Safari player sampling, audio activation and range dragging

The player pass started from `869a3bc8`, the squash merge of live-match loading transitions (#229).

## Findings

- Werewolf's director hook and both players' timeline hooks updated the whole viewer on animation frames. Cast, inspector and audio metadata work therefore shared the stage's render frequency.
- Recorded timing was repeatedly compiled during clock reads. Full-history clip filters were nested inside cue synchronization and repeated on unrelated director notifications.
- Evicting a Werewolf replay window could discard measured recording durations used by the full timeline, shifting later scrub coordinates.
- An unmute handler passed the old muted preference to its controller. A pending automatic AudioContext resume could also prevent a user gesture from issuing another resume. The second streaming deck had no explicit gesture activation before its first crossfade.
- Desktop WebKit reproduced a range-track drag that stopped near its initial click instead of following the pointer. Mobile WebKit's native range recognizer emitted `pointercancel` between input and touch end, discarding the preview. Mobile emulation requires touch input; desktop mouse gestures are not evidence of mobile touch behavior.

## Changes

Stage and transport rendering now sample independently, up to 30 fps, and sleep when the director stops animating. Notifications are coalesced to avoid reading half-completed director mutations. Recorded timing is cached; compact timing inputs survive window eviction without retaining game snapshots. Indexed clip candidates still use the exact canonical identity matcher.

Music receives the new mute preference inside the gesture, resumes an already-pending context, and primes both retained streaming decks. Opening audio requests permission before cold metadata loads but remains silent until it can seek. Native media seeks are not repeatedly issued while another seek is pending. A denied interruption recovery surfaces a user action instead of retrying indefinitely.

Scrubber mouse/pen movement is handled explicitly. Touch and keyboard input remain native; touch previews commit on `touchend`, survive the native recognizer's pointer cancellation, and discard on a real `touchcancel`. Seek completion updates the displayed frame together with preview release.

## Verification

Focused tests cover timing reuse/invalidation, retained window durations, exact indexed clip matching, idle/wake sampling, first-gesture audio, pending resumes, interruption denial and pointer dragging. The browser stories cover both players' forward timeline progress and pause, decoded music continuity, cold opening seeks, keyboard/pointer range interaction and fullscreen fallback/rotation. See [the Safari validation guide](../../testing/player-safari.md) for commands, artifacts and real-device limitations.

Do not equate WebKit mobile emulation with an iPhone performance or operating-system audio test. Do not replace the custom player with native video fullscreen to hide browser chrome: the player is a composed scene, not one video element.
