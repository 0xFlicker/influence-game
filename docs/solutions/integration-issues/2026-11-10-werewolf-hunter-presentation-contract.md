---
module: Werewolf presentation and durable execution
tags: [werewolf, hunter, items, studio, export, presentation-parity, recovery]
problem_type: integration_issue
---

# Hunter item support across durable plans and presentation consumers

The Hunter implementation added a native item decision and watch cues but left
`night-speech/snipe` outside catalog key validation and the `snipe` action outside
export picture binding. Existing tests only expanded viewer cues, so they did not
exercise either failure. Complete v12 fixture games now pass through production
source generation, catalog construction, binding and independent selected cuts.

Item fields must be absent from pre-v12 observations, not present as empty values:
the database compares their canonical hashes when adopting a previously planned
turn. A PostgreSQL regression seeds the original observation shape and prepares
the same slot. Engine regressions cover versions 7–11. Corrected retrospective
facts include item, target and snipe result; an already-frozen input is accepted
only when its entire original definition matches, preserving accepted history.

Dawn copy must consume both canonical deaths and deduplicate a shared target.
Hunter private speech and held/fired action share the new moonlit lodge plate.
The room is snapshotted by the existing static-art writer, including its hash.
Narrated dawns use the shared paginated House caption once; non-narrated dawns
retain their own caption. The item badge uses the second speech-header line so it does not truncate the
name. Hunter action labels carry the actor/target facts once, leaving room for
portraits even in a short player; the House caption supplies the full action.

The deterministic render proof exercises actual viewer, Studio Source/Selected
cut Player and export composition. Its geometry audit waits for measured caption
layout instead of inspecting a transient zero-width mount; playing samples use
the same playback state in both consumers. Hunter fixtures sample every caption
page, isolated cuts, a speech/action/dawn sequence, reverse seeks, reduced motion
and recorded/unrecorded speech, at desktop, short and portrait sizes. Hunter
solo decisions have no separate thinking field, so a Hunter thinking-only cut is
not applicable. The source has eight players; the private action picture contains
its canonical actor and optional target. No paid contestant calls are required.

Run from `packages/web`:

```sh
HUNTER_PARITY=1 FORMAT_CONTEXT_STUDIO=1 bun run src/scripts/verify-presentation-parity.ts ../../.renders/hunter-parity-final
```

The report, prepared manifests, screenshots, decoded frames and fresh MP4s are
retained under `.renders/hunter-parity-final`. This proof tests Studio's real
Player and selected-cut rendering, not the editor's selection-click UI.

Existing selection IDs and pinned source/media remain valid. Prepare a fresh
bundle and rerender the MP4; reopen/reprepare Studio previews. Do not rewrite
accepted decisions, regenerate historical speech, or silently change media pins.

## Local proof results

- 235 viewer/export comparisons and 470 Studio Source/Selected cut comparisons:
  maximum mean RGB difference **0** across all four geometries.
- 11 freshly encoded H.264 clips, 70 decoded-frame comparisons: maximum mean RGB
  difference **3.239/255**, below the proof's compression tolerance of 4/255.
- Recorded audio correlation **0.992**, alignment offset **29.5 ms** (limit 50 ms).
- All sampled frames reproduce identically in reverse order. Every measured
  Hunter caption page appears, and short-layout label/portrait bounds pass.
- Historical v8 Mystery dawn: two additional viewer/export comparisons and four
  Studio comparisons pass in `.renders/hunter-historical-dawn`.
- PostgreSQL baseline: **2,615 passed, zero failed**, including Hunter creation
  and adoption of a historical planned observation hash.
- Provider-free baseline: 3,484 passed, 5 skipped, zero failed. Additional final
  dawn regressions pass. Typecheck and lint pass.

These are local deterministic fixtures, not staging/production deployment or
live-provider evidence. House Cuts/trailer generation is unchanged by these
watch/Studio/replay-export fixes.
