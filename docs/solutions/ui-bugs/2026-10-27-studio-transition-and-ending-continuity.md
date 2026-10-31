---
module: Studio replay export
problem_type: ui_bug
tags: [replay, studio, werewolf, influence, thinking, layout, narration]
---

# Keep room, ballot and closing frames continuous

Portrait-room floor placement depended on the measured speech bubble height. An
independent thought has empty speech, so returning to a real message moved the
whole ring. Short and long consecutive speeches could do the same. Influence
thought pictures also omitted the room backdrop and floor perspective.

Use the fixed speech-space budget to anchor the ring. Fit each bubble above that
anchor, and retain the same backdrop/perspective in independently selected thought
pictures. Speaker rotation and thinking zoom still use their existing clocks.

A thought returned to a visible full-body character, but its spoken ballot started
another image entrance. The thought also lacked the ballot ledger's reserved
space. Match the selected predecessor's canonical source and actor before skipping
the new entrance, and reserve the same responsive ledger inset during the thought.
No votes or omitted dialogue are copied into the thought picture. Standalone
ballots keep their normal entrance; collection and exit behavior stay intact.

House narration split every 190 characters and timed equal-length page intervals.
A two-word overflow page therefore appeared halfway through the recording. Keep
the whole message visible and measure its type against the available frame,
including the logo/header. The recording clock still owns visibility; there is no
page clock. Contestant speech retains its existing measured pagination.

Completed Werewolf retrospectives now close on a silent results tableau instead
of repeating the House result message. Final audience snapshot fields supply cast,
roles, winners, survivors and elimination day/kind. This also works on a direct
seek without loading every prior window. The original spoken result remains
before retrospectives, and incomplete retrospectives acquire no closing scene.

## Local verification

Regression tests cover room framing, exact thought/response identity, visible
portrait handoff with normal later exit, complete House text throughout playback,
and the silent canonical recap in both Werewolf audiences.

A separate browser harness sampled the shared `ReplayFrame` with existing
`hard-smoke-rune` source/art at 1920×1080 and 640×360. It checked eight-player room
anchors across thought/speech, stable ballot image opacity and size, single-screen
House text bounds, and the closing recap. Evidence lives under
`.renders/studio-fixes/` (`proof.json` and sampled PNGs). The standalone Bun browser
harness substitutes an ordinary image element for Next Image's ledger avatars;
the shared stage, timing, typography, thinking, solo character and ending components
are unchanged. This is local frame evidence, not a new full movie, a production
deployment, or a provider run. Existing saved bundles and MP4s remain intact;
prepare a fresh bundle and re-export to apply the fixes.

Validation: 116 exporter/presentation tests and 32 solo/ledger tests passed;
PostgreSQL baseline passed all 2,262 tests; typecheck and lint passed. The broader
provider-free run passed 3,083 tests with five skips and 27 sandbox-blocked
local-server failures; all affected files passed when rerun with loopback access.
