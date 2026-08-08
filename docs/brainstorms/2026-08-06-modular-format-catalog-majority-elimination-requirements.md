---
date: 2026-08-06
topic: modular-format-catalog-majority-elimination
---

# Modular Format Catalog + Majority Elimination Requirements

## Summary

Make adding sealed vote formats a routine catalog registration path, proved by shipping **Majority Elimination** (classic sealed plurality: most votes out) into the default live format set. Port **Vote Bomb** onto the same sealed-ballot resolve path so modularity is real reuse, not a one-off fourth branch. Leave a lightweight add-sealed-format skill. Defer per-game allowlists, Split House / Kingdom, and double eliminations while naming them as future capability classes.

---

## Problem Frame

The format kernel already owns standard-round spine (empower → menu → pick → mingle → resolve). The launch trio ships, but each new format still fans out through open dispatch, agent tools, resolution payloads, and presentation special cases. That cost will grow as the catalog expands.

Owner Learning Loop no longer blocks format work. The immediate need is not a full plugin system. It is a **straightforward, skill-packable path for sealed formats**, so easy cards can ship without rewriting the kernel, while harder formats (preselection, split field, multi-elim) remain honest future work.

---

## Key Decisions

- **Modularity proof first; Majority Elimination is the proof vehicle.** The slice fails if the fourth format ships without a reusable sealed path. It also fails if modularity ships with no live card proving the path.
- **Majority Elimination is the public name.** Tool/id naming is planning-owned. The format is classic sealed plurality: one non-self vote each; most votes eliminated; empowered breaks ties among the top set.
- **Default live catalog grows to four.** Majority Elimination joins Save-or-Eliminate, Vote Bomb, and Safety Bounce for normal format-kernel games.
- **Soft anti-repeat menu.** Never re-offer last round’s selected format. From the remaining legal formats, offer exactly two. Round 1 (no last format) offers any two of the catalog.
- **Shared sealed-ballot path with Vote Bomb as co-consumer.** Behavior-preserving Vote Bomb migration proves the path; Majority Elimination is the new consumer (most-votes tally instead of fewest-positive).
- **Safety Bounce stays outside the sealed-only skill.** Public-chain remains a separate capability already in production; this slice does not genericize it.
- **Lightweight sealed-format skill ships in-slice.** Checklist for the next easy sealed format only. It must state what it does not cover (preselection, split field, multi-elim).
- **Per-game format allowlist deferred.** No owner-facing toggles and no required sim policy surface in this slice.
- **Complex formats are named, not designed.** Split House / Dual Houses, Kingdom, double eliminations are deferred; product identity still expects them later as additional capability classes, not as extensions of sealed tally alone.
- **Majority pile-on is intentional as a card.** Format meta keeps majority sometimes strong (this card) and sometimes brittle (Vote Bomb, Bounce pools, SoE nets).

---

## Actors

- A1. **Alive agents** mingle under the locked rule sheet, cast sealed format ballots, and remain fully eligible for elimination.
- A2. **Empowered player** picks one of two House-offered formats and breaks format elimination ties.
- A3. **The House** builds the two-option menu from the default catalog, announces fixed rules, runs format mingle, and resolves elimination.
- A4. **Viewers / operators** watch offer, sealed lifecycle, and revealed tallies with the same ballot-presentation contract used by existing sealed formats.
- A5. **Maintainers / agent cooks** add the next sealed format via catalog registration + skill checklist without inventing a new kernel.

---

## Key Flows

### F1. Standard round with four-format catalog

- **Trigger:** Pre-endgame format-kernel round after empower resolves.
- **Actors:** A1–A3
- **Steps:**
  1. House builds a two-option menu from the default catalog under soft anti-repeat.
  2. Empowered player picks exactly one offered format.
  3. House announces that format’s fixed public rule sheet.
  4. Format-aware mingle runs (mingle → sealed ballot for Majority Elimination, Vote Bomb, and Save-or-Eliminate).
  5. Format resolves to exactly one elimination (empowered tiebreak when required).
- **Outcome:** Round elimination under a registered catalog format, not classic Power → Council.

### F2. Majority Elimination resolve

- **Trigger:** Locked format is Majority Elimination and format mingle has finished.
- **Actors:** A1–A3
- **Steps:**
  1. Every alive player casts one sealed non-self elimination-direction vote.
  2. Ballots stay sealed until resolution reveal.
  3. House tallies votes for all alive players.
  4. Highest vote total is eliminated; if several share the highest total, empowered chooses among that set only.
- **Outcome:** Exactly one elimination with a legible plurality ledger.

### F3. Maintainer adds the next sealed format (skill path)

- **Trigger:** Product wants another sealed single-elim format (e.g. Even Votes later).
- **Actors:** A5
- **Steps:** Follow the sealed-format skill: register catalog entry, pure tally/resolve rules, agent decision surface, presentation metadata, tests, menu membership. Reuse the shared sealed-ballot path. Do not invent a parallel kernel branch.
- **Outcome:** New sealed card lands with the same social order and reveal lifecycle as other sealed formats.

---

## Requirements

**Catalog modularity**

- R1. Round formats in the default live set must be **registered catalog entries** rather than open multi-site if-ladders that each new format must extend by hand.
- R2. The default live catalog must include exactly these four formats after this slice: Save-or-Eliminate, Vote Bomb, Safety Bounce, and Majority Elimination.
- R3. Sealed single-elim formats that differ only in tally/eligibility math must resolve through a **shared sealed-ballot path** (collect legal ballots → score → eliminate or tiebreak → resolution facts → sealed-to-revealed presentation).
- R4. Vote Bomb must become a consumer of that shared sealed path without changing its product rules (zero votes safe; fewest positive out; empowered breaks fewest-positive ties).
- R5. Safety Bounce may remain on its existing public-chain path. This slice must not require a generic public-chain framework.
- R6. Future capability classes may be named in docs/skill as out-of-scope for the sealed skill: at least public-chain (exists), preselection / split-field, and multi-elim. Naming is not a commitment to implement them here.

**Menu**

- R7. After empower, The House must offer exactly two distinct formats from the default catalog that are legal for the current cast size.
- R8. Soft anti-repeat: when a previous-round selected format exists and at least two other catalog formats remain legal, the menu must not include last round’s selected format.
- R9. When no previous format exists (or anti-repeat cannot yield two legal options), the menu is any two legal catalog formats.

**Majority Elimination**

- R10. Public display name is **Majority Elimination**.
- R11. Every alive player casts exactly one sealed elimination-direction vote for a living player other than self (self-vote illegal).
- R12. Among alive players, the player with the **most** votes is eliminated.
- R13. If two or more players share the highest vote total, the empowered player breaks the tie among that set only.
- R14. Empowered is a full participant and fully eligible for elimination under Majority Elimination in the same round.
- R15. Social order is mingle → sealed ballot (same class as Vote Bomb / Save-or-Eliminate; no public preselection phase).
- R16. Ballots remain sealed until House resolution reveal; viewer ballot lifecycle follows the existing sealed/revealed contract.
- R17. Exactly one elimination per Majority Elimination round after tiebreak rules apply.

**Agent and watch surfaces**

- R18. Agents must receive the fixed Majority Elimination rule sheet after lock and cast through a legal sealed-ballot decision surface with deterministic repair/fallback for illegal targets.
- R19. Watch/replay/completed-results must show offer, selection, sealed lifecycle, revealed plurality tally, and elimination without inventing classic Power/Council fields.
- R20. Canonical events and projections remain the authority for ballots, tallies, ties, and elimination. Transcript prose must not repair format facts.

**Skill packaging**

- R21. A lightweight add-sealed-format skill (or equivalent checklist skill) must document the end-to-end path to register another sealed single-elim format: catalog entry, pure rules, agent decision, presentation metadata, tests, and menu membership.
- R22. That skill must state non-goals: public-chain formats, preselection/split-field formats, multi-elim rounds, per-game allowlist UI, and inventing formats from config without code.

**Validation**

- R23. Pure resolver tests must cover Majority Elimination clear winner and highest-total ties.
- R24. Integration or fixture coverage must show Majority Elimination in a format-kernel round with sealed ballots and one elimination.
- R25. Vote Bomb regression coverage must confirm product rules unchanged after shared-path migration.
- R26. Menu tests must cover four-format soft anti-repeat (last format excluded when three remain).

---

## Acceptance Examples

- AE1. **Covers R2, R7–R8, R10.** Given last round selected Vote Bomb and all four formats are legal, when House builds the menu, the two offered formats are distinct, drawn from {Save-or-Eliminate, Safety Bounce, Majority Elimination}, and never include Vote Bomb.
- AE2. **Covers R11–R13, R17.** Given Majority Elimination tallies A:3, B:2, C:2, D:1, when the format resolves, A is eliminated with no empowered tiebreak.
- AE3. **Covers R12–R13.** Given tallies A:3, B:3, C:1, when the format resolves, empowered must choose only among A and B.
- AE4. **Covers R3–R4, R25.** Given a Vote Bomb round after migration, zero-vote players remain safe and fewest positive still eliminates (or ties to empowered) exactly as before.
- AE5. **Covers R15–R16, R19–R20.** Given Majority Elimination locked, agents mingle then cast sealed ballots; viewers see sealed presentation until resolution; revealed named tallies and elimination come from canonical events, not transcript parsing.
- AE6. **Covers R14.** Given the empowered player receives the unique highest tally under Majority Elimination, they are eliminated.
- AE7. **Covers R21–R22.** Given a maintainer follows the sealed-format skill for a hypothetical next sealed card, the checklist routes them through registration and shared sealed path and explicitly excludes multi-elim / split-field work.

---

## Success Criteria

- A second sealed format (Majority Elimination) ships without a new kernel spine.
- Vote Bomb remains product-correct on the shared sealed path.
- Soft anti-repeat menus rotate among four cards with visible variety across multi-round games.
- Viewers can explain a Majority Elimination exit as plurality math.
- The sealed-format skill is short enough to follow for the next easy format and honest about hard formats.
- Token cost of a Majority Elimination round stays in the same class as Vote Bomb (mingle + sealed ballots + resolve).

---

## Scope Boundaries

**In scope**

- Format catalog registration for the default live set
- Shared sealed-ballot resolve path
- Behavior-preserving Vote Bomb co-migration
- Majority Elimination as a default live format card
- Soft anti-repeat menu for four formats
- Lightweight sealed-format skill/checklist
- Existing sealed ballot presentation reuse
- Tests and legible House/agent rule sheets

**Deferred for later**

- Per-game / sim format allowlist policy and owner toggles
- Split House / Dual Houses, Kingdom / Kings & Peasants, Date Night, Room Roulette, BB nominations + veto, Ranked Elimination, Even/Double Votes (except as future sealed candidates via the skill)
- Double eliminations and multi-elim rounds
- Classic Power → Council as a format card
- Generic public-chain framework refactor of Safety Bounce
- Format-specific Owner Learning coaching
- Format DSL, hot-loaded plugins, designer UI for inventing formats
- Endgame format bleed

**Outside this product’s identity**

- Replacing social alliance play with pure random minigames
- Live human mid-match steering of agent votes
- Treating transcript prose as elimination authority

---

## Dependencies / Assumptions

- Format kernel (empower → menu → pick → format mingle → resolve) remains the standard pre-endgame spine.
- Launch trio rules for Save-or-Eliminate, Vote Bomb, and Safety Bounce stay product-stable; only Vote Bomb’s internal resolve wiring is expected to move under the shared sealed path.
- Sealed ballot presentation lifecycle and event authority contracts remain as currently specified.
- Cast size for standard rounds remains roughly endgame-threshold and above; cast-size fitness may still hide a format only if it is incoherent (none of the four cards currently require hiding at normal N).
- Crash-safe mid-ballot resume remains fail-closed unless a separate recovery slice says otherwise.
- Primary audience remains operator + friends: watchable strategy over public-scale tutorial polish.

---

## Outstanding Questions

**Resolve Before Planning**

- None.

**Deferred to Planning**

- Stable tool/format id string for Majority Elimination (e.g. `majority_elimination`).
- Exact catalog/registry module shape and how presentation metadata stays browser-safe.
- Whether Save-or-Eliminate joins the shared sealed path now (polarity ballots) or remains a sibling sealed variant until a later cleanup.
- Skill file location and packaging conventions under `.agents/skills` / repo skill layout.
- How menu shuffle RNG is injected for deterministic tests while preserving soft anti-repeat product rules.
- Depth of agent prompt wording so Majority Elimination is not confused with Vote Bomb or Safety Bounce’s final pool vote.

---

## Sources / Research

- `docs/brainstorms/2026-07-23-sequester-format-kernel-requirements.md` — format kernel, launch trio, deferred catalog (Dual Houses, Kingdom, multi-elim).
- `docs/plans/2026-07-23-001-feat-sequester-format-kernel-plan.md` — kernel implementation units; broader catalog deferred.
- `docs/refactor-queue.md` W17 — extract format decision surfaces when adding the next launch format.
- `packages/engine/src/formats/` — pure resolvers and menu for the launch trio.
- `packages/engine/src/format-presentation-metadata.ts` — browser-safe format presentation contract.
- `packages/engine/src/phases/format-kernel.ts` — current menu → pick → mingle → per-format resolve wiring.
- `CONCEPTS.md` — format kernel, round format, launch format vocabulary.
- Prior product dialogue: modularity-before-hard-formats; per-game allowlist valuable later; skill packaging for sealed formats as we continue to cook.
