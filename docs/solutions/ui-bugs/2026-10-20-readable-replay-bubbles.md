---
title: Readable replay bubbles across browser and export
module: Watch presentation
problem_type: ui_bug
tags: [replay, studio, export, typography, thinking, werewolf]
---

Fixed font ceilings and narrow boxes made speech and thinking difficult to read
in exported video. Shared bubble sizing now uses the available box width, with
a readable floor and pagination for long text. Include the font range in frozen
layout keys so a layout measured under another typography policy is not reused.

Full-body landscape speech uses the frozen head rectangle for its vertical
position and tail anchor. Headshots keep centered placement; mobile keeps art
and speech in separate stacked regions. Thought connectors fill their span with
graduated circles while leaving clearance at both ends.

Omniscient role labels must enter both the browser thinking context and the
sampled Studio/export context. Use the authorized actor metadata, never parse a
speaker label or thinking prose. Mystery remains gated out of private thinking.

The export proof also found a Node crypto import in shared core types, reached
through the open-conversation scheduler's default constant. Keep that constant
in a dependency-free module; the browser renderer must not import the scheduler
merely to obtain configuration defaults. Do not polyfill server crypto into the
presentation bundle.

Validation covers retained text across pages, head alignment, growing trails,
disabled thinking privacy, actual replay frames, and current-format Remotion
proof frames built from preserved local QA evidence at 1920×1080 and 390×844.

For curated homepage captures, speech fades follow the replay clock. Waiting
after seeking a paused replay does not finish the fade. Advance to a stable
speech frame and assert the bubble's computed opacity is at least 0.99 before
capturing. Marlow's pack-room preview uses 1:39 rather than the fading 1:38 frame.
