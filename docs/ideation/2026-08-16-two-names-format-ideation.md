# Influence Two Names Format Ideation

**Status:** Working product direction, not requirements or an implementation plan  
**Captured:** 2026-08-16

## Context

The production blue-green release work is already in flight and remains a separate effort. **Two Names** is a candidate for the next substantial format capability and UI expansion. Kingdom / Kings & Peasants remains interesting, but is deferred until its roles, teams, and presentation requirements are explored separately.

## Product intent

Create a high-drama format in which the Empowered player receives unusually concentrated power and publicly exposes their political targets. The Override creates a second power center and can force a replacement name, producing grudges and future-round consequences.

The two-name version is the first target. A three-name version with an additional saving mechanism remains a possible later extension, but is not part of this format.

## Locked round shape

1. The existing empowered vote remains unchanged.
2. If the Empowered player selects **Two Names**, they remain **Empowered**; the format does not introduce a second power-role label or election.
3. Empowered publicly submits two living players as the initial names.
4. The House publicly draws one **Override holder** at random from all living players, including Empowered and both initial names.
5. The first Mingle occurs after the two names and Override holder are known. The named players can seek safety, the Override holder can be lobbied, and Empowered can plan a possible replacement.
6. The Override holder may remove either name or decline to use the Override. A named Override holder may remove themself.
7. If the Override is used, Empowered immediately submits a replacement name.
8. Empowered, the Override holder, and the removed player are ineligible to be the replacement.
9. If the Override changes the final two names, run a second Mingle around the actual elimination choice. If the Override is declined, skip the second full Mingle.
10. Regardless of whether the second Mingle ran, each final nominee receives one short, uninterrupted final plea.
11. Eligible players cast sealed votes between the final two nominees. The final nominees do not vote. Empowered votes only to break a tie.
12. The resolved vote and any tie-break eliminate exactly one of the final nominees.

## Why random Override works for the first version

Influence does not yet have a reusable agent competition system. A public random draw supplies uncertainty and redistributed power without inventing an expensive model-driven competition or bespoke competition presentation. The consequential decisions—whether to use the Override, whose name to remove, whom to submit as replacement, and whom to eliminate—remain strategic.

An agent competition primitive can later replace the draw without changing the rest of the format's product identity.

## Presentation opportunities

- Preserve the existing Empowered visual treatment instead of introducing another power role.
- Present the naming ceremony as one deliberate two-player selection rather than two unrelated ballots.
- Reveal the Override holder publicly with a short draw animation or House announcement.
- Make Override use, the removed name, and any replacement distinct dramatic beats.
- Keep the final two names visibly at risk throughout the final deliberation.
- Give both final nominees a brief final-plea beat immediately before voting.
- Reveal sealed elimination votes clearly and reserve the final dramatic choice for an Empowered tie-break.

The ceremonial moments can briefly take over the viewer, then collapse into a persistent status rail showing Empowered, the current two names, and the Override holder. During Mingles, existing conversation remains primary while the status rail preserves the stakes. Mobile uses the same information in a compact stacked treatment, and reduced motion replaces movement with explicit state changes.

## Strategic character

- Empowered can protect allies and force rivals into danger, making this format attractive to the player who earned power.
- Public names reveal priorities and create accountability that can persist into later rounds.
- An Override holder can cooperate with or openly defy Empowered.
- A replacement name can expose a previously concealed target or force Empowered to betray an ally.
- Concentrated power is balanced socially rather than by weakening the format: Empowered owns the outcome and may become a future target.

## Questions for requirements and planning

- At what living-player count does the format become unavailable because two initial names plus replacement protections leave no legal replacement?
- Does the Override draw require a canonical seeded-random event so replay and recovery reproduce the same holder?
- Do simulations support the locked one-Mingle / conditional-second-Mingle sequence without unnecessary token growth?
- Which reusable UI primitives should be introduced for two-name submission, optional Override, replacement selection, and nominee-only voting?
- Which canonical events and recovery checkpoints represent the initial names, draw, Override, replacement, Mingles, final pleas, ballot, and tie-break?
- How should agent prompts distinguish Empowered's powers, Override-holder immunity, and final voting eligibility?

## Deferred extensions

- agent competition as an alternative way to award Override;
- a separate three-name format with an additional saving mechanism;
- Kingdom / Kings & Peasants and the role/grouping primitives it may require.

