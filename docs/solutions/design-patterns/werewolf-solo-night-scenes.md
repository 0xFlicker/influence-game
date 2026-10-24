---
title: Versioned solo night explanations and audience-safe Werewolf scenes
date: 2026-10-24
module: Werewolf
problem_type: design_pattern
component: model contracts and playback
tags: [werewolf, structured-output, privacy, replay, versioning]
---

# Solo night decisions

Doctor and Seer choices previously had a target and private thinking but no speech
for the viewer. A lone wolf used the same thinking-plus-optional-speech contract as
a negotiating pack. Generic studio backgrounds also obscured phase changes.

V10 freezes the new solo contract at game creation: a legal target, required spoken
explanation and nullable acting cue. There is no separate thinking field. Multi-wolf
negotiation keeps its existing contract. Waiting lobbies retain their saved rules
version when started; historical v7/v8/v9 contracts are not rewritten.

The explanation is an Omniscient-only aside, not a village message. Doctor and Seer
speech is projected from accepted actions only after canonical night resolution.
One shared night-step expansion drives server durations, navigation, browser cues
and Studio/export binding: explanation, role result, then the remaining night beats.
Invalid provider output cannot fabricate speech or change a target. Exhausted
rules-legal fallbacks keep their existing target policy and have no spoken clip.

Four static generated plates distinguish village, pack, Doctor and Seer settings.
The room fills the stage outside the thinking camera, with top-aligned cover sizing.
Solo clips prefer frozen full-body art and fall back to portraits. Shared Influence
components accept an optional background; their default presentation is unchanged.

## Verification

- Exact solo schemas reject missing explanations, unknown targets, extra thinking,
  and oversized speech. V9 contracts and multi-wolf thinking remain covered.
- Private night explanations do not change any contestant observation or appear in
  Mystery watch/export data. Role results cannot appear in the explanation clip.
- Server timing and keys match browser/export cues; Studio retains separate speech
  and result moments.
- A provider-free API game exercises v10 end to end. Browser fixtures verify all four
  rooms and Doctor/Seer ordering at 1440×900 and 800×1100. Component coverage verifies
  full-body preference and that the room stays outside the camera transform.
