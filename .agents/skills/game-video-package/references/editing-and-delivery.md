# Editing and delivery mechanics

## Separate clocks and layers

Keep a shot manifest with source file/hash, accepted video intervals, narration/SFX intervals, output start/duration and overlays. Do not overwrite rejected or previously delivered media. Reuse accepted sources for typography/caption edits rather than regenerating footage.

A common failure is trimming silence by concatenating two video intervals inside one continuous shot. The voice improves, but the character jumps. Edit the narration independently while keeping the picture continuous, or make a deliberate cut to a different composition. Inspect a few frames before and after every edit boundary. A source shot can contain a surprise insert in its last fraction of a second; trim before it rather than leaving a flash before the next clip.

Generate headlines, subtitles, logo and URL as separate overlays. If FFmpeg lacks drawtext/subtitle filters, Pillow-rendered transparent text overlays are a deterministic alternative; check the installed font and measure actual text bounds. This is typography/composition, not a substitute for generative image tooling when new artwork is requested.

## Captions

Use actual recorded words, correct proper-name spelling against the script, and preserve word timestamps through every audio trim. After changed narration or timing, transcribe the new output rather than accidentally reusing cached QA from a previous version.

A useful input for `scripts/caption_timeline.py` is a JSON array:

```json
[
  {"start": 0.12, "end": 1.20, "text": "The villagers helped"},
  {"start": 1.20, "end": 2.30, "text": "the wolf win."}
]
```

Times are seconds on the final output clock. The script aligns boundaries to frames, caps each cue before the next, rejects missing/empty/invalid/zero-frame cues, audits frame-boundary exclusivity and writes matching SRT plus JSON. It does not invent speech timing or choose phrase boundaries. Run it only after grouping words into readable phrases:

```sh
python3 scripts/caption_timeline.py cues.json --fps 30 --duration 45.5 --out captions
```

Render its intervals as **start-inclusive, end-exclusive**. FFmpeg example: `enable='gte(t,START)*lt(t,END)'`. Inclusive `between()` at adjacent boundaries can display both overlays for one frame. Adding an exit hold and an early entrance independently can create ~160 ms overlaps. Cap the earlier cue at the next entrance; never layer two captions to preserve both holds.

For multiline captions, calculate one background rectangle from line count and font metrics. Keep line spacing sufficient. A fixed per-line rectangle can overlap or clip the next line. Make the phrase shorter before shrinking text to unreadable sizes.

## Platform composition

Keep both versions tied to the same editorial edit unless intentional changes are requested. Matching timing lets them share one SRT. The TikTok layout should leave room for current app chrome, including top controls and right-side actions; safe zones vary by app/device, so verify representative framing instead of promising a universal fixed margin.

An earlier 1080×1920 package placed branding at y≈240 for TikTok, but moving every headline below it covered faces. A lower headline band around y≈1120 above subtitles near y≈1390 worked for many medium shots, **not** every close-up. These are starting points, not universal coordinates. Check each headline's whole hold against moving faces and hands. Use shot-specific placement/timing; show a Hunter headline over a hand insert rather than across the Hunter's eyes. Preserve readable labels and important gestures too.

Do not stack several messages over the picture merely because each technically fits. Narration subtitles carry required speech; editorial headlines are optional emphasis. Keep branding subordinate to the story.

## Verification and packaging

- Run ffprobe for actual geometry, duration, fps and audio stream; fully decode each final MP4 with `ffmpeg -v error -i FILE -f null -`.
- Inspect full-motion edits and loop boundary, not only contact sheets. Create a short tail+head encoded preview for loop QA.
- Check actual final narration and music. Local ASR avoids sending unlisted material to another provider. Its wording check does not establish expressive delivery or sound quality.
- Compare frame-level caption cue counts and the actual rendered picture. Check that all subtitle times fit the delivered file and that no final word is truncated.
- Retain per-platform MP4, SRT, thumbnail/cover and copy text. If providing a no-burned-caption upload master, preserve branding/headlines as requested and name it clearly; do not silently remove captions from the requested final.
- Save title/description separately for YouTube and TikTok where their copy differs. Include the full-game link, concise thesis, reenactment disclosure when applicable and music attribution when required. Do not claim one model is universally superior based on one game.
- Record output hashes and which files supersede previous versions. Existing MP4s do not update when scripts or captions change.
