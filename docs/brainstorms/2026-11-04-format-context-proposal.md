# Format context during Influence Mingle — proposal

Status: **prototype for discussion; no product behavior is changed or approved.**

## Problem

After the format pick, viewers need the selected format to understand the
ensuing Mingle and alliance huddles. The watch shell can repeat “Format Mingle”
without showing the format. Theater/fullscreen also removes the shell from view.
The existing social-scene `ActiveFormatLabel` is supplied as the settings-menu
header in `WatchTransport`, so it is available only after opening settings; it
is not a persistent player label. The selection reveal has two 1,800 ms base
cues, with the rules appearing only in the second. Effective playback timing can
also depend on the shared timing profile and playback speed.

## Recommended design for review

Open [the interactive mockup](./2026-11-04-format-context-prototype.html) locally.
It is a self-contained illustration with sample copy, not a running game. Switch
between embedded, theater and narrow views; activate the pill to see the proposed
rules panel.

1. Put a small **Format · Highest Count ⓘ** button in the player picture's
   upper safe area, away from cast, captions and transport. Keep it visible
   throughout post-pick Mingle and post-pick huddle speech, including thinking.
   It remains visible when transport controls fade, in embedded, theater and
   fullscreen. Placement and spacing must reflow at narrow/short sizes; the
   mockup is an illustration, not proof that every scene fits.
2. On hover or keyboard focus, offer a short discoverable hint. Click, tap or
   keyboard activation opens a dismissible panel with the selected format's
   **same concise rules shown at selection**. The mockup assumes opening the
   panel pauses playback and closing it leaves playback paused, so the viewer
   controls when to resume. This is a proposed behavior requiring approval.
   Support Escape, outside dismissal, focus restoration and a clear close button;
   prevent the player's click-to-advance handler from firing. Do not depend on
   hover, and keep the panel usable inside fullscreen.
3. Give the selected-format rules their own reading hold. Proposed starting
   point at 1×: after the choice's 1.8 s stage, hold the actual selected rules
   for at least **8 s**, or `2 s + words / 180 × 60 s`, whichever is longer,
   rounded up to the next half second. This is a design hypothesis for review,
   not a measured accessibility guarantee. Separate entrances/transitions from
   reading time; if text needs pages, allocate enough hold to each page using
   the shared clock. Honor deliberate playback speed and existing timing choices;
   recorded narration must finish and not be cut off. Explicit navigation may
   still advance normally. Test the longest actual format copy before settling
   the formula and check the current automatic single-format selection path.

Do not show a format before its canonical pick has been presented. Reset at a
round boundary and omit it for classic games or missing trusted context. A
pre-pick huddle must never borrow a later format. Two Names can have two Mingle
windows; both should retain the same selected name while the canonical context
for nominees changes. Seeking backward, direct entry, reconnect and isolated
cuts must use the selected format valid at the presented moment, never the
game's latest state or transcript prose.

## Presentation contract to resolve before implementation

The persistent format name is **movie content**, not only viewer chrome: the
recommended treatment carries the same name and placement into Studio Source,
Studio Selected cut, and freshly prepared exports. The interactive panel is
player chrome and is not rendered into an MP4; a video viewer gets the longer
automatic rules reveal instead. This proposed distinction needs explicit user
agreement under the parity checklist. Its benefit is that a selected cut that
starts during Mingle or a huddle still identifies the format without including
the earlier selection or any omitted dialogue.

Use canonical `format.selected` and the presentation cursor, with only the
minimum audience-safe framing context carried into selected cuts. Preserve
frozen source/media identities and do not leak future selections, private
huddle contents or other omitted moments. Current display metadata supplies
`conciseRules`, but historical/versioned rules and the accuracy of that copy
must be checked against the frozen game before choosing the source of truth;
do not silently present current copy as historical fact. In particular, inspect
the Safety Bounce copy against the current canonical order before implementing.

Relevant paths include `format-presentation-model.ts` and its duration helpers,
`influence-replay-cues.ts`, `dramatic-replay-viewer.tsx`, `active-format-label.tsx`,
`format-offer-stage.tsx`, production-source/catalog construction,
`replay-export/cues.ts`, timing and selected-cut framing, Studio Player, and
Remotion/worker frames. Trace real call sites before changing them. Rules-panel
interaction is separate from the deterministic shared render of the label.

## Acceptance and verification for a later implementation

- Compare viewer, Studio Source, Studio Selected cut and encoded export at the
  same source, audience, geometry, timing and scene; retain fresh screenshots,
  coordinates, fixture identity, assertions and an encoded clip per
  `docs/presentation-parity.md`. Extend its fixtures for actual format Mingle
  and huddle beats, the selected rules reveal, and an isolated cut omitting the
  pick; test thought-only and speech-only where applicable.
- Check both Mingle windows for Two Names, pre-pick huddles, round transitions,
  seek/reverse/direct entry, live reconnect, historical/missing format context,
  and automatic single-format selection. Never infer state from dialogue.
- Check long format names and rules, large casts, narrow/short/fullscreen
  geometries, captions and control collisions. Fit or clock-paginate movie text;
  no player scrolling, clipped required content or unreadable type. Prove keyboard,
  mouse and touch behavior, focus/dismissal and no accidental advancement.
- Exercise recorded/unrecorded audio, reduced motion, timing settings and speed;
  verify the encoded duration and full spoken audio. Explain how to rebuild an
  existing selection/bundle and that existing MP4s require a new render.
- User requested **no local database tests**. Use PR checks for the required
  PostgreSQL baseline when implementation is proposed; report their actual
  results and any missing parity proof rather than claiming completion.

## Decisions requested

1. Is the persistent upper player pill and the video/Studio parity treatment the
   desired placement? Should it continue beyond social scenes into resolution?
2. Should opening rules pause playback and leave it paused after dismissal?
3. Is the proposed 8-second minimum plus length-based reading hold a good
   starting point, subject to testing actual copy?
