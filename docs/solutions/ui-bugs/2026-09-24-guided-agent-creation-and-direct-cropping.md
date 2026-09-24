---
module: Agent creation
date: 2026-09-24
problem_type: ui_bug
component: frontend
symptoms:
  - Agent creation exposes the full editing form before character direction is established
  - Mobile crop sliders and the source image cannot be viewed together
root_cause: design_gap
resolution_type: code_fix
tags: [agent-creation, structured-output, mobile, portrait, pointer-events]
---

# Guided character creation and direct crop controls

Creation now offers Advanced create and a full-screen assistant backed by the
same draft recovery and save contract. Profile generation precedes explicit
character approval; image generation follows an appearance description. A
stage-specific strict command schema, decoded on both server and client, controls
which actions can run. Assistant prose never becomes transition authority.

Compact fixtures remain above chat. Explicit section selections constrain which
generated fields are applied. Cards open a full-screen reader before selecting
a section for revision. Edit adds an animated section pill and focuses the
composer; Close and Escape leave the selection unchanged. Direct text editing
remains available in Advanced create. Appearance requests apply
only visual design and generated images, preserving approved character text.

Starter pills share Advanced create's curated ingredients. Selected tags are
removable, support submission without typed text, and survive failed requests.
The inset send arrow shows activity; the last two conversation bubbles sit above
the composer without a separate mobile activity icon. Pending turns collapse
the disabled composer, pills, and secondary actions to a compact activity bar.

Interactive text calls previously inherited Flex processing while the command
request had a 60-second browser deadline. They now explicitly request Standard,
disable the Flex transport, use low reasoning effort, and cap each provider call
at 45 seconds without SDK retries. Keep background generation policy separate.
Timeout tests verify readable errors and preservation of the player's input;
mocked tests do not establish live provider latency.

Guided generation opens the full-screen portrait editor automatically, with
crop and head controls ready. Advanced editing opens in confirmation mode when
it has a crop and detected head. Optional editing selects one of the overlapping boxes. Pointer capture
supports mouse and touch movement and corner resizing; square crops use source
pixel geometry. Precise sliders remain available beside a sticky source image.
Keep the preview compact during editing so the source and controls fit on phones.

Regression coverage includes invalid and out-of-stage commands, conversation
endings, review/revision ordering, original draft recovery, desktop/mobile
creation, full-text section reading and scoped revision, touch/mouse crop edits and switching back
to Advanced. Model and image results in browser tests are simulated; live
provider quality is a separate opt-in check.
