---
date: 2026-07-24
topic: format-kernel-mcp-readability
---

# Format-Kernel MCP Readability Requirements

## Summary

Make producer/MCP game reads **kernel-aware**: every game carries a durable **game kernel** label; format-kernel games omit classic Power/Council (and unused expose) fact sections instead of showing `not_yet_resolved`; postgame brief and round facts tell the full format + endgame story without event-log spelunking. Legacy classic games stay fully readable on the existing shape.

Related product design (gameplay spine, not this doc): `docs/brainstorms/2026-07-23-sequester-format-kernel-requirements.md`.

---

## Problem Frame

Format-kernel games already complete on the new spine (empower → format menu → pick → resolve; endgame unchanged). Producer analysis still reads them as unfinished classic games: power and council sit forever `not_yet_resolved`, expose targets are always null, endgame rounds have no first-class round facts, and the postgame brief remains classic-cohort oriented. Analysts reconstruct the arc from raw events and cognitive artifacts.

A second pressure is coming immediately: more launch formats under the same format kernel, then distinct **game modes** (werewolf, mafia, etc.). Inference-only dual shapes will not scale cleanly across modes. Rules/prompt re-containment and full ruleset versioning are real follow-ups, but the minimum bar now is **read compatibility** for old and new games and **confusion-free** format storytelling.

---

## Key Decisions

- **A + C-min, not C-full.** Dual fact shapes **plus** a durable game-kernel label. No ruleset semver, prompt pack id, or doc-revision platform in this pass.
- **Omit over placeholder.** On format-kernel standard-round surfaces, classic Power and Council sections **must not appear** as reader fields (schema may still know them). Do not ship `not_yet_resolved` / `not_applicable` placeholders that keep Power/Council in the mental model.
- **Kernel labels mode, not format.** Values distinguish spines (`classic`, `format`, later mode ids). Individual round formats (Save-or-eliminate, Vote Bomb, Safety Bounce, future cards) remain round-level facts under `format`.
- **Stamp kernel at run start; infer only for history.** New games persist kernel when the durable run starts. Missing historical rows may be inferred on read (`format` evidence ⇒ `format`, else `classic`); optional backfill is planning-owned.
- **Read-path only.** Agent prompt packing and “rules nuked by containment” fixes are out of this requirements set.
- **Brief + full round facts including endgame.** Minimum success includes first-class endgame stage facts, not brief-only.

---

## Actors

- A1. **Producer / operator analysts** (including coding agents on producer MCP) reconstruct completed games and evaluate format-kernel quality.
- A2. **MCP clients** call list/projection/round facts/brief without knowing engine internals.
- A3. **Legacy game rows** must remain legible under the classic fact shape.
- A4. **Future mode authors** will add kernels later; this pass must not force a full versioning platform but must not paint into a corner.

---

## Key Flows

### F1. Analyze a completed format-kernel game

- **Trigger:** Analyst opens a completed format-kernel game on producer MCP.
- **Actors:** A1, A2
- **Steps:**
  1. List or open game; kernel label is present and reads as format-kernel.
  2. Read postgame brief; get empower chain, format picks, format boots, endgame path, jury result in one surface.
  3. Drill into any standard or endgame round via round facts; see format (or endgame) sections, not classic Power/Council placeholders.
- **Outcome:** Full arc without guessing event type names or stitching raw sequences.

### F2. Analyze a legacy classic game

- **Trigger:** Analyst opens a pre-format-kernel completed game.
- **Actors:** A1–A3
- **Steps:** List/open shows classic kernel (stamped or inferred). Round facts and brief still expose empower/expose, power action, council candidates, and classic elimination story.
- **Outcome:** No regression in classic readability.

### F3. Add a future mode later (non-goals for this pass, shape constraint)

- **Trigger:** A new mode (e.g. werewolf) ships after this work.
- **Actors:** A4
- **Constraint:** New mode gets a new kernel value and its own fact sections; it must not overload format-kernel by stuffing werewolf into “missing power fields.” Format catalog growth stays under kernel `format`.

---

## Requirements

**Game kernel identity**

- R1. Every deployed game exposed on producer/MCP list, projection, and postgame surfaces must present a durable **game kernel** value.
- R2. Initial kernel values are at least **`classic`** (Power → Council default spine) and **`format`** (format-kernel spine). Additional mode values may be added later without redesigning the field’s meaning.
- R3. New runs must stamp kernel at durable run start from the spine that will execute that game.
- R4. When historical rows lack a stored kernel, reads must still return a kernel via a documented inference rule (format evidence ⇒ `format`, otherwise `classic`) so tools never return “unknown” for completed local corpus games without an explicit diagnostic.
- R5. Kernel names the **match spine / mode**, not the active round format id.

**Dual fact shapes (omit dead classic sections)**

- R6. For kernel `format`, standard-round reader facts must include empower (and empower re-vote when used) and **format** facts (menu, selection, resolution, sealed-ballot access as already authorized).
- R7. For kernel `format`, standard-round reader facts must **omit** classic Power and Council sections as present reader fields. Absence means “not part of this kernel,” not “unresolved.”
- R8. For kernel `format`, when expose is not part of the ballot contract, expose targets and expose tallies must not appear as null noise on every voter; omit unused expose fields from the reader ledger.
- R9. For kernel `classic`, reader facts must continue to present the classic sections required for Power → Council legibility (including expose when that game used dual ballots).
- R10. Format-specific resolution details (Save-or-eliminate nets, Vote Bomb tallies, Safety Bounce chain + vulnerable pool) must be available on round facts when that format resolved the round.
- R11. Misleading status values that imply unfinished classic pipeline on a finished format round (e.g. power/council `not_yet_resolved` after format elimination) must not appear on format-kernel reader surfaces.

**Endgame round facts**

- R12. Completed endgame stages (at least Reckoning, Tribunal, and Judgment-related rounds/stages that produce eliminations or jury outcomes) must be readable via round facts or an equivalent first-class round/stage fact surface—not only raw event filters.
- R13. Endgame fact surfaces must include enough structure to answer: stage, alive set, elimination votes or jury votes when resolved, eliminated player(s), and progression to the next stage or winner.
- R14. Endgame continuity fields that format-kernel currently leaves null but that affect story (e.g. last empowered from regular rounds when an empowered player existed) must be populated when known from accepted board facts.

**Postgame brief**

- R15. For kernel `format`, the postgame brief executive summary and round summaries must tell the **format-kernel arc**: empower chain, format offered/selected, format boot method, endgame eliminations, finalists, jury result.
- R16. Format-kernel brief content must not frame the game primarily in classic Power action / Council candidate language when those systems did not run.
- R17. For kernel `classic`, brief behavior remains classic-legible (no regression of existing classic story fields).
- R18. Brief (or its structured payload, not only teaser prose) must be sufficient for an analyst to answer “who won and how” for a format-kernel game without calling event filters.
- R19. Kernel label must appear on the brief (or its top-level structured envelope) so consumers do not infer mode from field absence alone.

**Compatibility and non-regression**

- R20. Reading a completed classic game after this change must preserve empower, expose (if present), power, council, and elimination story parity with today’s classic readability.
- R21. Reading a completed format-kernel game after this change must not require knowing internal event type string aliases to recover the main arc.
- R22. Dual shapes are intentional: consumers branch on kernel (and on present sections). Document that contract for MCP tool descriptions at a product level (exact copy is planning-owned).

**Correctness cleanups in scope when they block legibility**

- R23. Format resolution fields must not mark a clear single elimination as a “tie” solely because a leftover tied-set field reuses the eliminated player.
- R24. Jury membership and jury vote ledgers on completed Judgment must be consistent (every eligible juror either has a recorded vote or an explicit non-vote reason); silent drops of early boots from the jury tally are a bug unless product rules exclude them.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R6–R8, R11.** Given a completed format-kernel game, when an analyst reads round facts for a standard round that used Safety Bounce, the payload includes empower + format/bounce resolution and does not include Power or Council sections, and does not list null expose targets on every voter.
- AE2. **Covers R9, R17, R20.** Given a completed classic game, when an analyst reads the same surfaces, Power action and Council elimination remain present and interpretable as today.
- AE3. **Covers R12–R13, R15, R18–R19.** Given `zero-peach-leaf`-class format-kernel completion, when the analyst reads only list → brief → optional endgame round facts, they can name winner, finalists, format boots by round, and endgame boot order without `filter_events`.
- AE4. **Covers R3–R5.** Given a newly started format-kernel run, list/projection show kernel `format` before completion; a newly started classic-capable run shows `classic` when that spine is the one in force.
- AE5. **Covers R4.** Given an older completed game with no stored kernel and clear format.selected evidence, reads still return kernel `format` via inference.

---

## Success Criteria

- A producer can evaluate a format-kernel game’s meta (chooser stickiness, format variety, boot methods) from brief + round facts alone.
- No finished format-kernel standard round presents Power/Council as “not yet resolved.”
- Classic corpus games do not lose Power/Council legibility.
- Adding a third kernel later is an additive label + section set, not a reinterpretation of missing classic fields.
- Follow-up format cards under kernel `format` require no new game-kernel value.

---

## Scope Boundaries

**In scope**

- Durable game kernel label (C-min)
- Dual reader shapes with omit semantics for format-kernel
- Postgame brief format-kernel storytelling
- First-class endgame stage facts for completed games
- Historical kernel inference rule
- Legibility bugfixes that block trust (false “tied”, incomplete jury ledger)

**Deferred for later**

- Full rules/prompt versioning, prompt containment rewrite, rules pack ids
- New gamemode designs (werewolf, mafia) beyond reserving kernel extensibility
- Additional launch formats’ *gameplay* (owned by format-kernel requirements)
- Expose reintroduction as a format stake
- Web watch UI polish for every format
- Large forensic dump cleanup (`inspect_durable_run` passport spam) unless it blocks brief/round facts work
- Strategy packet freshness on jury actions

**Outside this product’s identity**

- Forcing a single rigid JSON shape that keeps empty Power/Council forever
- Treating format catalog growth as a new kernel per format card
- Claiming crash-safe resume or durable passport completeness as part of this readability pass

---

## Dependencies / Assumptions

- Format-kernel gameplay spine is already specified in `docs/brainstorms/2026-07-23-sequester-format-kernel-requirements.md` and largely implemented on `feat/sequester-format-kernel`.
- Endgame remains Reckoning / Tribunal / Judgment unless a later product change says otherwise.
- Producer MCP (`read_game_brief`, `read_round_facts`, `read_projection`, `list_games`) is the primary consumer surface for this pass.
- Classic and format-kernel games will coexist in local/deployed corpora for the foreseeable future.

---

## Outstanding Questions

### Resolve Before Planning

_None._ Scope is sufficient to plan.

### Deferred to Planning

- Exact field name and enum serialization for game kernel on list/projection/brief envelopes.
- Whether historical inference is pure on-read or also backfilled into storage.
- Precise endgame round vs stage keying for round_facts (round number vs stage id).
- How postgame cohort/momentum metrics that were council-centric degrade or reform under format ballots.
- MCP tool description wording for dual shapes.
- Whether `lastEmpoweredFromRegularRounds` is restored only on endgame stage events or also on brief continuity lines.

---

## Sources / Research

- Operator analysis of localhost game `zero-peach-leaf` (format-kernel completion with power/council `not_yet_resolved`, empty expose, weak endgame round facts, thin brief).
- Format-kernel product requirements: `docs/brainstorms/2026-07-23-sequester-format-kernel-requirements.md`.
- Domain vocabulary: `CONCEPTS.md` (Format kernel, Round format, Format menu, Revealed vote ledger).
- Existing dual-path notes in engine revealed-round facts and House interviewer format-kernel framing (planning will locate exact modules).
