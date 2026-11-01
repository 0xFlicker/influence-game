---
module: Audio delivery and Studio speech
tags: [audio, studio, text-cleaning]
problem_type: ui_bug
date: 2026-10-31
---

# Unsupported delivery tags appeared in Studio

Gemini emitted `<warm>…</warm>`, outside the xAI delivery vocabulary. The engine
normalizer preserved unknown markup literally, and Studio trusted accepted text.

Compiler v2 removes XML-style tags from declared presentation fields while
preserving enclosed text, source spans and original private evidence. Supported
controls remain separate audio annotations. Unknown square-bracketed text stays
literal because it can contain meaningful dialogue rather than delivery cues.

Existing Studio/watch speech is cleaned at rendering. Historical page boundaries
and alignment offsets still use the original text; source spans hide even tags
split across pages. Static speech uses the same normalizer. New audio synthesis
also cleans saved annotations, without changing existing clips or saved history.

Regression coverage includes unsupported wrappers, attributes containing `>`,
namespaced/self-closing tags, Unicode offsets, retained square brackets, split
page tags and both static and timed speech rendering.

## Browser CI follow-up

The shared-moment-link test raced initial hydration: it saw the initial paused
transport, skipped its pause click, then autoplay started before its final
paused-state assertion. The CI trace showed no pause click after the short-link
navigation. Wait for the expected autoplay state before pausing on both initial
and shared-link navigation; retain the assertions that sharing preserves both
paused and playing intent. No playback behavior change is needed for this race.
