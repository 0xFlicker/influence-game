---
title: "Werewolf art exploration — Lantern Village, first study"
date: 2026-10-04
status: direction-selected
---

# Werewolf art exploration — selected direction

The operator selected the first useful slice: game/card backgrounds, individual reveals and scene-location art direction. Medieval village settings, wolf-form variants and day/night transitions are desired. This is one concrete direction for review, not a completed W9 exploration or approval of production defaults.

## Lantern Village

Warm timber, worn plaster, muted moss and amber lantern light establish village life. Charcoal, cold stone and moonlight will supply its night counterpart. Keep House iconography, familiar player controls and contemporary readable typography. Existing characters retain identity and clothing; the medieval setting does not require redesigning the shared cast.

Built-in image-generation tool produced these three previews, saved under `.renders/werewolf-art/lantern-village-v1/`. Exact prompts and reference paths are recorded in `prompts.json` beside them.

- [Game card](../../.renders/werewolf-art/lantern-village-v1/card.png): a spoiler-safe village vista, House mark and restrained woodcut border texture. UI/text are illustrative and must be real components if implemented.
- [Individual reveal](../../.renders/werewolf-art/lantern-village-v1/reveal.png): Marlow's existing full-body identity and House speech layout in a candlelit inn. Generated header/cast-count details are not authoritative. Production would retain actual controls/data and frozen character assets.
- [Discussion location](../../.renders/werewolf-art/lantern-village-v1/village.png): a daylight inn common room, as an environment reference without characters.

## Initial assessment

The card and reveal make the world distinct without requiring different navigation or player controls. The location needs a smaller table, fewer foreground obstructions and clearer seating/face positions before production. Do not claim the mockup demonstrates real compositing, anchor detection or mobile cropping; those require in-player validation. Existing nontransparent full-body assets also need a deliberate background treatment rather than assuming they can be pasted over an environment seamlessly.

Next compare cooler daytime lighting and the night counterpart, then test a varied existing cast and narrow framing. A selected direction can first supply reusable background art/textures and scene prompt references. Automatic generation and producer regeneration must use the same art inputs; do not replace existing published imagery implicitly.

## Where role imagery belongs

Doctor/Seer imagery is optional scene-specific art for role explanations, permitted Omniscient night actions and results/Cuts that discuss those actions. It does not belong on Mystery player portraits or generic spoiler-safe game cards. Do not build a class-badge system as part of this first slice.

## Follow-on work

- W6: match-specific wolf forms that preserve recognizable character identity; dark pack meeting place; resolved hunt/protection treatment.
- Shared day/night transitions: lighting and restrained atmosphere with reduced-motion support; avoid adding long interstitials.
- W5: carry the selected palette/materials into trailer graphics and covers; audition new music against an actual rough cut.
- W9 selection: record human selection of concrete artwork before making it the default. This first study is neither implementation nor approval.

## Operator feedback and second study — 2026-10-04

The operator likes the card direction. Keep it as the visual reference; this does not approve the initial reveal or room unchanged.

**Current asset constraint:** individual reveals must use the complete existing opaque rectangular full-body picture, including its original background. No transparent/cutout assets are available yet. Do not regenerate, mask, crop away or blend away the portrait background to achieve this treatment. Explore the surrounding stage, a restrained border, lighting and background texture instead.

**Scene-identification constraint:** characters must face the camera for reliable identification. Every seat must therefore face the camera too, including seats at either edge. Use enough separation to distinguish faces; avoid side-facing/inward-facing seats and foreground obstacles. Validate actual generated cast compositions, not just empty-room geometry.

**Location direction:** rough village meeting house rather than cabin resort. Hand-hewn wood, patchy limewash, rubble stone, worn floor and a modest hearth. Remove upholstered furniture, rugs, furs and decorative luxury.

Built-in image-generation revisions and exact prompts are saved in `.renders/werewolf-art/lantern-village-v2/`:
- [Rectangular portrait treatment](../../.renders/werewolf-art/lantern-village-v2/reveal.png): visible grey photographic rectangle, understated border, dark textured stage and village linework. This generated mockup illustrates placement only; implementation must use the original image unchanged. Generated text/counts are not product data. Reduce texture contrast if it competes with dialogue in actual viewport tests.
- [Rustic camera-facing room](../../.renders/werewolf-art/lantern-village-v2/village.png): six unobstructed front-facing chairs in one shallow row; simpler rough materials. This is a six-seat staging example, not a fixed roster count for all games.

These revisions supersede the initial reveal's composited character and the initial room's inward-facing, furnished seating arrangement. No live defaults or published scenes changed.

## Table-layout comparison — 2026-10-04

The operator strongly likes the revised single-player rectangular portrait treatment. Retain that direction. The straight row of chairs remains rejected: the room should read as a conversation around a table.

Two built-in image-generation studies, with exact prompts alongside them in `.renders/werewolf-art/lantern-village-v3/`:

- [Long communal table](../../.renders/werewolf-art/lantern-village-v3/long-table.png): camera at the empty near end; three seats on each side angled toward it. Strong central perspective and atmosphere, but near/far face-size variation and overlap need testing with the cast.
- [Broad round table](../../.renders/werewolf-art/lantern-village-v3/round-table.png): six seats in a curved far semicircle, near half empty. More consistent expected face scale and better frontal visibility. Selected by the operator; next validate populated compositions.

Both use six seats for direct comparison; six and eight are actual supported cast sizes to validate. Empty chairs are not proof that eight rendered characters will remain identifiable. Next proof should use representative real characters, check edge-person framing and preserve an unobstructed view of every face. Table may cover legs but must not obstruct faces or intended upper-body framing.

The rustic materials and rectangular portrait constraint remain unchanged. No live game assets or defaults were replaced.

## Selected direction — 2026-10-04

The operator explicitly selected the **broad round table** (v3) with “ok round table it is”. This completes the layout choice for the daytime village discussion location. Retain the accepted v1 game-card direction and v2 rectangular individual-reveal treatment.

Production art brief:
- Rustic medieval village meeting house: rough timber, patchy limewash, worn stone and modest hearth; restrained amber light with readable daylight.
- Broad round table; cast arranged around the far semicircle, near half open toward camera.
- All characters face the camera with distinguishable, unobstructed faces; no rear-facing or profile-only edge seats.
- Validate six- and eight-player compositions, face scale, character identity and mobile crops before treating the layout as production-proven.
- Individual reveals preserve the original opaque rectangular full-body picture and its background. Apply styling around that image.
- Reuse the selected art direction in automatic production and producer regeneration. Existing published scenes are not replaced by recording this choice.

Night locations, wolf forms, transitions and music still need their own concrete studies. The room-layout selection does not imply those later assets have been approved or tested.

## Night background studies — 2026-10-05

The operator accepted the direction of a ruined stone cellar for pack meetings and a moonlit timber-village lane for hunts. Wolf forms must retain the source character's rendering style, including nonrealistic/anime/illustrated styles, as well as recognizable clothing and identity. A shared setting does not require realistic redesigns of stylized characters.

Built-in image generation produced two empty background studies:
- [Pack cellar](../../.renders/werewolf-art/lantern-village-night-v1/pack-cellar.png): two camera-facing chairs, low table, broken masonry and restrained lantern/moonlight.
- [Moonlit lane](../../.renders/werewolf-art/lantern-village-night-v1/moonlit-lane.png): open foreground and separated middle-distance target space.
- [Exact prompts](../../.renders/werewolf-art/lantern-village-night-v1/prompts.json).

These are review candidates, not approved production defaults. Validate populated one-/two-wolf compositions, target face scale, localization and mobile framing before adoption. No game assets or published scenes were replaced.

## Night-background feedback — 2026-10-05

The operator selected the v1 moonlit alleyway. Populated composition, identification and responsive framing still need validation before production adoption.

The v1 cellar chairs were rejected as artificial-looking. The [revised cellar](../../.renders/werewolf-art/lantern-village-night-v2/pack-cellar.png) replaces them with worn stone seats built into the masonry and a low rough stone slab, retaining the camera-facing positions and existing lighting. The operator approved this v2 cellar. Together with the selected v1 alleyway, it is the chosen night-background direction for W6; populated composition and player validation remain. [Exact edit prompt](../../.renders/werewolf-art/lantern-village-night-v2/prompt.json). Built-in image generation was used; no published assets changed.
