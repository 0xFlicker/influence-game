---
title: House Highlights Visual Briefs Before Media Generation
date: 2026-07-11
category: design-patterns
module: House Highlights visual presentation
problem_type: design_pattern
component: frontend_stimulus
severity: high
applies_when:
  - "turning selected House Cut scenes into shareable cards, posters, or trailers"
  - "deciding whether generated imagery may represent a postgame highlight"
  - "replacing rough editorial art direction with renderer-safe scene data"
  - "building social preview images from completed-game facts"
tags: [house-highlights, house-cut, visual-brief, visual-card, generated-background, truth-overlays, share-preview]
related_components: [service_object, background_job, documentation]
---

# House Highlights Visual Briefs Before Media Generation

## Context

House Highlights started with rough `posterDirection` prose such as a council slate, shield graphic, or vote-card composition. That was good human art direction, but it was not safe as public copy or as a generation prompt. The durable correction was to make Visual Briefs the scene-owned visual contract and keep `posterDirection` out of selected scene cards; the current scene type exposes `visualBrief` instead of `posterDirection` (`packages/engine/src/postgame-highlights/types.ts:177`).

This matters because House Cuts are editorial artifacts built from receipts. A renderer can make them cinematic, but it must not decide what happened. The selected scene owns the factual story; the Visual Brief tells presentation layers which template, slots, overlays, backdrop, and forbidden inventions are safe to use.

## Guidance

### Split story selection, visual direction, and media rendering

House Highlights scene selection decides what is worth showing. Visual Briefs decide how that selected scene can be represented. Visual Cards, image routes, and trailer renderers present the brief without reinterpreting the game record.

Use this handoff shape:

```text
selected scene + receipts
  -> Visual Brief: visual type, factual slots, truth overlays, backdrop, forbidden inventions
  -> Visual Card / trailer manifest: deterministic facts, agents, labels, images, timing
  -> renderer: HTML, image, video, or share preview
```

Do not wire generated media directly to a scene's prose hook, title, receipt labels, or old art-direction sentence. That turns editorial copy into a prompt-shaped API contract. The current Visual Brief helper names the template family, fills factual slots, declares truth overlays, records whether a backdrop category allows generated atmosphere, and carries diagnostics such as forbidden inventions (`packages/engine/src/postgame-highlights/visual-briefs.ts:108`).

### Keep generated imagery atmospheric, not factual

Generated imagery may supply mood: an empty council chamber, abstract jury wall, fractured table, spotlight stage, or surveillance-board texture. It must not supply names, vote totals, ballots, agent identities, alliances, emotions, or physical actions. The code reflects this boundary by marking safe generated backdrop categories and describing each as empty or abstract, with no agents, names, vote text, tallies, or implied action (`packages/engine/src/postgame-highlights/visual-briefs.ts:28`).

Factual presentation belongs to deterministic composition:

- agent identities, avatars, and initials;
- names and round labels;
- vote actions, eliminations, protection, survival, finalist, or jury outcome facts;
- alliance lines only when alliance receipts exist;
- card titles, outcomes, captions, and alt text;
- result and replay links outside the card.

The web card renderer follows that pattern: it uses a background image if present, then overlays the card title, outcome, primary/secondary agents, round label, and fact lines from the visual card model (`packages/web/src/app/games/[slug]/components/house-highlights-card.tsx:23`). The social image route uses the same split: background asset first, deterministic card data over it (`packages/web/src/app/games/[slug]/highlights/card-image/[sceneId]/route.tsx:126`).

### Make proof available without making proof language the card

Visual Cards should show what happened, not how the system proved it. "Vote record", "Alliance receipt", "proof link", and raw receipt IDs are useful in diagnostics, but they are weak public copy. Public card-facing models should expose fact lines such as who voted for whom, who was eliminated, who survived, or who shared a named alliance. The model currently maps card fact text for public display (`packages/web/src/app/games/[slug]/components/house-highlights-model.ts:131`).

Keep evidence affordances outside the card on the surrounding Highlights, results, replay, or admin diagnostics surfaces. This preserves shareability while keeping receipts reachable.

### Validate Visual Briefs in the selection path

A helper-level Visual Brief can be well-formed and still be unsafe for selected public output. Selection must reject scenes with missing visual slots, rejected backdrop categories, or unsupported alliance visuals (`packages/engine/src/postgame-highlights/selection.ts:82`). Regression tests should assert the pipeline result, not only helper output: selected scenes exclude `posterDirection`, have filled factual slots, use semantic receipt-type labels, and include truth overlays such as agent identity (`packages/engine/src/__tests__/postgame-highlights.test.ts:323`).

This is the guardrail that prevents "looks okay in the fixture" from becoming a brittle public card.

## Why This Matters

House Cuts are growth artifacts. They need to travel through Discord, X, screenshots, social previews, and trailers without forcing a cold viewer to understand internal evidence tiers. But they also cannot become vibe fiction. A generated image of a betrayal that implies crying, stabbing, secret meetings, or unsupported alliances damages trust faster than a plain card ever would.

The Visual Brief pattern keeps the sharp line:

- the engine/API decide truth and selected story;
- the Visual Brief declares safe presentation grammar;
- generated backgrounds add non-factual atmosphere;
- deterministic overlays carry the evidence-backed story;
- admin diagnostics keep the proof machinery visible to producers.

That lets the product become cinematic without making the image model a narrator with a fake memory.

## When to Apply

- Use this pattern when adding a new House Highlights scene type, Visual Card template, trailer scenelet, share image, poster, or generated background plate.
- Use it when a field starts as human art direction and begins drifting toward public UI or renderer input.
- Use it when a renderer would otherwise need to reverse-engineer receipt IDs, confidence labels, or diagnostics to decide what to draw.
- Use it before adding per-scene image generation. If the Visual Brief cannot identify deterministic slots and forbidden inventions, the image generation scope is not ready.

## Examples

### Good: Generated atmosphere plus deterministic facts

```text
Visual Brief
  type: council_slate
  backdrop: empty_council_chamber
  truth overlays: agent_identity, round_label, vote_outcome
  factual slots: eliminated_agent, surviving_agent, round
  forbidden inventions: no visible ballots, no agent emotions, no physical confrontation

Card
  background: approved empty chamber plate
  overlay: Vera, Sage, Round 4, "Sage was eliminated", "Vera survived the council slate"
```

The generated or approved background supplies tension. The card supplies truth.

### Bad: Direct prompt from editorial prose

```text
Generate an image of Vera surviving council while Sage is crossed out,
with betrayal and panic in the room.
```

This is unsafe because the prompt asks the model to invent people, emotions, a physical room scene, and possibly text. The renderer should instead use a safe background plate and deterministic overlays.

### Bad: Proof labels as public card content

```text
Vote record + Alliance receipt
Open the elimination receipt
```

Those labels may be useful to producers, but the public card should render the underlying facts. Proof links belong around the card, not as the card's headline or visual fact.

## Related

- `docs/plans/2026-07-06-001-feat-house-highlights-visual-briefs-plan.md` defines the Visual Brief product contract.
- `docs/plans/2026-07-06-002-feat-house-highlights-visual-cards-plan.md` defines Visual Cards, facts-over-proofs card language, share URLs, and reusable background plates.
- `docs/solutions/architecture-patterns/house-highlights-postgame-media-pipeline.md` covers the later durable trailer/poster media pipeline.
- `CONCEPTS.md` defines House Highlights artifact, Main House Cut, Highlight scene card, Visual Brief, Visual Card, and Background plate.
