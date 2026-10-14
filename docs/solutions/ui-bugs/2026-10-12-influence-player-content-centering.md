---
module: Influence watch player
tags: [replay, layout, fullscreen, centering]
problem_type: ui_bug
---

# Center width-limited Influence scenes inside the player

House summaries and result scenes were shifted left outside fullscreen. The shared content wrapper in `dramatic-replay-viewer.tsx` had `w-full max-w-3xl` but no horizontal auto margins. Centering inside an individual scene only centered it within that already-offset wrapper. Fullscreen removed the width cap, masking the issue.

Apply `mx-auto` to the shared content wrapper. This centers width-limited scenes while preserving full-width solo, room, and fullscreen layouts and the existing text alignment.

Local Chromium verification with deterministic game fixtures measured a 39px left offset after removing the fix from the rendered desktop wrapper. With the fix, House summaries, aggregate vote results, and elimination scenes had zero horizontal offset from the player center. House summaries also remained centered at a 390px mobile viewport, in fullscreen fallback, and after exiting fullscreen. This is local fixture evidence, not a production or native fullscreen check.
