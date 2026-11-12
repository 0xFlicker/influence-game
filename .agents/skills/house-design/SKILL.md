---
name: house-design
description: Design, audit, and refine The House frontend in influence-game, including discovery pages, agent workflows, Studio workspaces, and game presentation. Use for visual hierarchy, responsive layout, interaction polish, or reducing generic UI patterns; enforce viewer, Studio, and video parity whenever player content changes. Does not authorize changes to game rules or product policy.
---

# Design for The House

Make The House feel like a distinctive venue for watchable social games. Start from the actual content, audience, and task; improve clarity and character together. Replacing familiar components or adding effects is not itself an improvement.

Adapted from the audit workflow of `redesign-existing-projects` and the brief, hierarchy, and anti-template guidance of `design-taste-frontend` in `Leonxlnx/taste-skill`. This skill deliberately replaces their fixed palette, font, layout, image-generation, and scroll-effect prescriptions with repository-specific decisions.

## Establish the surface and evidence

Read the repository's current `AGENTS.md`. Inspect the affected route, shared components, styles, and actual dependencies. Read relevant entries in `docs/solutions/` before repeating a solved design or integration problem.

Use these sources from this skill directory:

- [Global tokens and treatments](../../../packages/web/src/app/globals.css): inspect the current foundation, phase, lighting, and semantic styles before introducing new values.
- [Visual design language](../../../docs/visual-design-language.md): useful broadcast context, but marked as a historical draft. Reconcile its examples with current code and requirements; do not revive obsolete branding, game semantics, or layouts.
- [Presentation parity checklist](../../../docs/presentation-parity.md): mandatory before changing any player picture, scene, framing, typography, caption, timing, audio, or presentation metadata. Follow its current consumers, matrix, commands, and handoff requirements.
- [Domain vocabulary](../../../CONCEPTS.md): use canonical House, game, and agent terms.

State a brief design direction grounded in the request: who uses this surface, what they should notice or do first, and what specific visual qualities support that job. Resolve routine design choices from the brief and existing language. Ask for an explicit decision when proposing a change to expected behavior or product policy; a request for visual polish does not authorize that change.

| Surface | Design priorities |
| --- | --- |
| Discovery and marketing | Let actual games, cast, and artwork establish identity. Make the next watch or participation action clear. Compose sections around distinct useful content rather than a stock hero/features/testimonials sequence. |
| Agent creation and management | Make identity, readiness, progress, and the next action legible. Keep real agent art prominent where useful; distinguish status, requirements, errors, and optional guidance. |
| Studio and operational workspaces | Support scanning, selection, editing, and recovery. Use consistent, purposeful density and stable controls. Editorial lists, inspectors, and timelines outside the player may scroll. |
| Live/replay and Studio player picture | Stage a produced show with readable cast, dialogue, stakes, and results. Use the shared deterministic presentation contract and complete parity proof below. |

The House is the venue; Influence and Werewolf retain their own rules and presentation ownership. A shared visual language does not justify routing one game's facts or choreography through the other.

## Audit before redesigning

For existing UI, inspect it in a running browser when available and retain a baseline at relevant sizes and states. Source inspection alone cannot establish how it looks. If runtime inspection is unavailable, label the findings provisional and report the missing visual verification.

Describe concrete defects and their consequences before selecting changes. Useful findings include a primary action lost among secondary buttons, duplicated status labels, a long agent name colliding with controls, or a panel whose layers obscure its content. Avoid diagnoses such as “not premium enough” without observable evidence.

Prioritize comprehension, accessible contrast and states, then hierarchy, layout, typography, and restrained visual polish. Prefer a focused change in the owning component or token over a new page-specific styling system. Broad token edits require checking other consumers. Work within the authorized scope; an audit finding is not permission for an unrelated redesign.

## Make deliberate visual decisions

- **Hierarchy:** Give each view a clear reading order and primary task. Use scale, weight, grouping, and space before adding badges, borders, or containers. Avoid nested panels that repeat the same grouping. Cards are appropriate for distinct selectable entities; tables and repeated rows are appropriate for comparison.
- **Typography:** Reuse the existing font setup and type roles. Fix line length, weight, wrapping, contrast, and rhythm before proposing a font change. Check descenders, long names, numbers, and zoom. Use tabular figures for changing numeric columns. Neither a font blacklist nor oversized headlines establishes identity.
- **Color:** Reuse foundation and semantic tokens. Preserve meaningful agent, phase, success, warning, and danger distinctions. A “single accent” rule must not erase those meanings. Pair color with readable labels or shapes. Check actual text and control contrast, including over artwork and glass.
- **Surfaces:** Use space and alignment to group content; add borders, elevation, or glass when they clarify depth or focus. The existing dark stage and phase atmosphere are intentional material. Remove redundant decorative layers rather than banning all glow or adding noise and gradients to every empty area.
- **Layout:** Match density to the job. Align shared baselines, labels, and actions; use a consistent spacing and radius vocabulary. Repeated entities benefit from predictable geometry. Use asymmetry when it improves composition, without forced randomization or a requirement that every section have a different layout.
- **Assets:** Prefer existing approved character art, scenery, brand assets, and real product captures with the correct source identity. Use image generation only when the task benefits from a new asset or concept, within authorization. Generated concepts do not prove responsive layout, real copy fit, or player parity. Do not add stock photography merely to satisfy an image quota.
- **Copy and data:** Write specific action labels and concise explanations. Remove vague promises, ornamental section numbering, repetitive eyebrows, and filler badges when they add no meaning. Keep genuine round, season, and phase labels. Never fabricate testimonials, activity, results, dates, or metrics to make a design look credible. Clearly mark fixture/sample data and keep it out of real product claims.
- **Interaction:** Preserve working navigation and action semantics. Design applicable loading, empty, error, retry, selected, focus, hover, pressed, and disabled states. Explain real unavailable actions. Do not introduce feature gates or new enrollment requirements for visual tidiness.
- **Accessibility:** Use semantic controls, accessible names, visible keyboard focus, sensible focus order, readable contrast, and usable touch targets. Do not make essential information hover-only or color-only. Decorative imagery may have empty alt text; meaningful imagery needs appropriate accessible treatment.
- **Motion:** Give motion a purpose such as focus, continuity, feedback, or reveal. Keep product interactions responsive and respect reduced motion. Avoid scroll hijacking, cursor effects, mandatory entrance animation on every block, or perpetual decoration. Player motion follows the sampled presentation clock below.

Reuse the installed styling, icon, component, and motion facilities after checking their implementations and types. Do not migrate Tailwind versions, add a component suite, or install GSAP to satisfy an imported skill's defaults. Ordinary page scroll and editorial workspace scroll are separate from the player ban.

Preserve attribution, conversion measurement, ownership, permissions, and action availability while changing layout. Improvements that reduce measurement coverage or change consent/product policy require the explicit decision described in `AGENTS.md`.

## Player presentation is a completion gate

For any affected movie content, read and execute the full [presentation parity checklist](../../../docs/presentation-parity.md); this section is a reminder, not a replacement or reduced matrix.

1. **Define one comparison.** Hold accepted source, pinned media, audience, source moment, elapsed time, geometry, thinking selection, reading/motion settings, and audio choices constant. Compare live/replay, Studio Source, Studio Selected cut, and freshly prepared local/worker exports. Include House Cuts or other compositions when affected. Player controls and editing chrome are distinct from encoded content; any additional intentional difference needs explicit user agreement and documentation.
2. **Trace every boundary.** Follow canonical projection and metadata through production catalog/order/IDs, cue binding, independent thinking/speech, timing/audio, frozen assets and measured layouts, Remotion frame, and worker composition. Reuse the current shared renderer, layout, and sampled clock; verify actual callers pass the required data. Shared imports alone do not prove parity.
3. **Keep authority intact.** Use structured canonical events and projections for cast, state, outcomes, and choreography. Do not infer facts from transcript prose. Preserve audience boundaries, frozen identities, and historical game-version semantics. An isolated cut may retain permitted room/board/cast context, but must not serialize omitted speech, future choices, or private evidence.
4. **Fit the picture without scrolling.** Ban horizontal/vertical `overflow-auto` or `overflow-scroll`, hidden-scrollbar panes, outer-scene scrolling, and scripted scrolling inside every player surface. Fit/reflow cast and labels; paginate long names, dialogue, thoughts, and House copy on the shared clock with readable holds. Required content cannot be clipped, ellipsized, shrunk beyond readability, or left to a separate required paging UI. Established transport advancement remains allowed. Decorative scenery may crop.
5. **Sample deterministically.** Animation, text pages, and entrances must work on direct seek, reverse/random frame order, and fresh renderer startup without earlier renders, wall-clock timers, hover, or user scroll. Preserve recorded voice duration and verify unrecorded speech and affected reduced-motion behavior.
6. **Exercise actual consumers.** Cover full sequences and isolated/edited cuts, including omitted neighbors and thought-only, speech-only, or result-only selections where relevant. Check long names/copy and supported large casts at narrow, short, intended-output, and fullscreen sizes. Werewolf supports at most eight players; use game-appropriate fixtures. Test integration props and bindings, not only standalone components with ideal inputs.
7. **Retain fresh proof.** Extend the existing proof fixtures to render the changed beat. Retain viewer–Studio/export comparisons and a freshly encoded short clip, including decoded representative frames, source/selection identity, settings, sample coordinates, assertions, and justified tolerances. Verify encoded audio when affected. A browser screenshot or an old green suite is insufficient. Use existing authorized fixtures/media; do not regenerate game history or run paid games to obtain evidence.

Missing a consumer or required rendered/encoded evidence means **presentation parity is incomplete**. Preserve the change and report the specific gap; do not claim it is finished or ready to merge.

## Verify and hand off

Inspect the rendered result after implementation, including the affected interaction states and responsive sizes. Verify keyboard use, long real content, image loading, and stable layout. Compare it with the baseline and the stated direction; remove additions that create competing focal points without helping the task.

For code-backed changes, run the required repository checks from `AGENTS.md` (`bun run test`, `bun run test:postgres`, `bun run check`) plus affected browser/render checks. Use Bun and the documented PostgreSQL isolation rules. Report actual failures or unavailable proof. Documentation-only skill edits need skill validation and reference review, not a pretend UI parity run.

In the handoff, explain what improved and why, the affected surfaces, actual validation and artifacts, and any unresolved limitations. For player changes, include the full parity handoff and refresh instructions: whether existing selection JSON can rebuild a fresh bundle, whether the frozen source needs a refreshed selection, and that existing MP4s must be rendered again. Never silently unpin media or regenerate accepted history.
