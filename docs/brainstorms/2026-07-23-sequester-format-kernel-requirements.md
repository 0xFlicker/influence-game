---
date: 2026-07-23
topic: sequester-format-kernel
---

# Sequester Format Kernel Requirements

## Summary

Replace the default Power → Council elimination loop with a **format kernel**: after empower is chosen, The House offers two launch formats, the empowered player picks one, players optionally mingle under that format’s fixed rules, and the format resolves to exactly one elimination. Launch formats are Save-or-eliminate, Fewest Votes / Vote Bomb, and Safety Bounce.

---

## Problem Frame

Standard rounds have become predictable. The dominant pattern is majority pile-on: the same bloc math shapes expose pressure, power choice, and Council every round. Empower’s three actions (eliminate / protect / pass) are legible but stale, and private social time often runs before the vote rules of the round are known.

The product bar is watchable social strategy for a small audience (the operator and friends), not public-scale polish. The design need is format diversity so majority is **sometimes strong, sometimes brittle** — not the removal of coalitions, and not a permanent library of every reality-TV twist on day one.

---

## Key Decisions

- **Kernel + launch trio together.** Ship the new spine with all three formats from the start so rounds feel different immediately; validate each format’s behavior separately in sims.
- **Classic Power → Council retires as the default path.** It may return later as one format card, not as the everyday elimination engine.
- **House offers two formats; empowered picks one.** No post-pick mechanical twist layer. Each format has one canonical rule sheet. House agency is the menu (fitness, anti-repeat, cast-size), not mid-format rule mutation.
- **Empower keeps continuous teeth.** Empower is still won by plurality (existing empower vote). The empowered player chooses the format and breaks all format elimination ties. They no longer choose eliminate / protect / pass as the standard power menu. Format pick is not immunity: the empowered player is fully eligible to be eliminated the same round.
- **Expose is not required for v1.** Prefer stakes when they earn them later; launch trio does not depend on an expose ballot. Rare “exposed gets power” flips and House-gated expose cards are deferred.
- **Token-aware social order.** Lobby + alliance forming (+ scarce pre-format alliance huddles) run before the empower vote. Full multi-beat pre-format Mingle is not the default spend. After the format is known, run format-allowed mingle, then resolve. All three launch formats allow post-pick mingle.
- **Bounce public, ballots sealed.** Safety Bounce pointers are announced live as the chain runs. Save-or-eliminate and Vote Bomb ballots (and the Safety Bounce elimination vote) stay sealed until House reveals the tally with the outcome.
- **Always exactly one elimination** for the launch trio. Multi-elim formats stay in the later catalog.
- **Endgame unchanged.** Reckoning / Tribunal / Judgment stay as specified; this work targets standard pre-endgame rounds.

---

## Actors

- A1. **Alive agents** form alliances, cast the empower vote, mingle under known format rules, cast format ballots or bounce actions, and react to eliminations.
- A2. **Empowered player** picks one of two House-offered formats and breaks format elimination ties.
- A3. **The House** frames the round, builds the two-format menu, announces the chosen format’s fixed rules, runs allowed mingle, and enforces format resolution.
- A4. **Viewers / producers** watch format variety and scheme beats; validate via sims, transcripts, and (later) watch surfaces that the pile-on meta is broken.
- A5. **Maintainers** need a bounded product contract so formats can be added later without rewriting the round spine.

---

## Key Flows

### F1. Standard round under the format kernel

- **Trigger:** A standard pre-endgame round begins with 5+ alive players (endgame threshold unchanged).
- **Actors:** A1–A3
- **Steps:**
  1. Public Lobby.
  2. Alliance forming window (named-alliance propose / respond) and scarce pre-format alliance huddles as today allows.
  3. Empower vote (plurality; existing re-vote / wheel tie path for who becomes empowered).
  4. House announces the two-format menu for this round.
  5. Empowered player picks exactly one format.
  6. House announces the chosen format’s fixed public rules.
  7. If the format allows mingle (all launch formats do): format-aware private mingle.
  8. Format resolution (bounce chain and/or elimination ballots per format).
  9. Exactly one player is eliminated; last messages and exit beats as today.
- **Outcome:** One elimination under rules that are not classic Power → Council.

### F2. House format menu

- **Trigger:** Empower resolves.
- **Actors:** A2, A3
- **Steps:** House selects two distinct launch formats legal for current cast size and recent history; empowered picks one; no further mechanical parameters are chosen.
- **Outcome:** One format is locked for the round before post-pick mingle.

### F3. Format elimination tie

- **Trigger:** Format scoring ends with a legal elimination deadlock.
- **Actors:** A2, A3
- **Steps:** House states the tied set; empowered player chooses among the tied players only.
- **Outcome:** Exactly one elimination.

---

## Requirements

**Round kernel**

- R1. Standard pre-endgame rounds must not use eliminate / protect / pass → two-candidate Council as the default elimination path.
- R2. Each standard round must select exactly one active **round format** after empower resolves and before elimination resolves.
- R3. The House must offer exactly two distinct legal formats from the launch set; the empowered player must pick exactly one.
- R4. Formats have fixed public rule sheets. The House must not apply a post-pick mechanical twist that changes those rules.
- R5. The launch set is exactly: Save-or-eliminate, Fewest Votes / Vote Bomb, and Safety Bounce.
- R6. Each launch-format round must eliminate exactly one alive player (ties resolved per R10 and the active format’s tie rules).
- R7. Endgame stages remain the current Reckoning / Tribunal / Judgment contract unless a later requirements change says otherwise.

**Empower and House agency**

- R8. Players still cast an empower vote each standard round; plurality (with existing empower re-vote / wheel) selects the empowered player.
- R9. The empowered player’s primary power is choosing the round format from the House menu.
- R10. The empowered player breaks all elimination ties produced by the active format.
- R11. The House builds the two-option menu using fitness for cast size and anti-repeat pressure so the same format is not the only story every round. Exact anti-repeat math is planning-owned; the product intent is visible variety across a game.
- R12. The empowered player is fully eligible for elimination under the active format in the same round they hold power. Format choice is not a shield.
- R13. The empowered player is a full format participant: they cast bounce pointers and format ballots like any other alive player, and only gain an extra decision when a tiebreak is required.

**Social and alliances**

- R14. Lobby and named-alliance formation remain before the empower vote.
- R15. After the format is locked, the round must offer format-aware mingle for all three launch formats before elimination resolution. For Safety Bounce the public order is **mingle → bounce → vote**. For Save-or-eliminate and Vote Bomb the order is **mingle → ballot**.
- R16. Pre-Council alliance huddles do not run while Council is not part of the default path.
- R17. Pre-format alliance huddles may still run after alliance formation and before empower, within existing scarcity budgets.

**Expose and classic power**

- R18. V1 must not require a parallel expose ballot for the launch trio.
- R19. Classic Power Lobby / shield / auto-eliminate / exposure-bench Council pairing are out of the default path. They may inform a future “classic Influence” format card.

**Launch format: Save-or-eliminate**

- R20. Every alive player casts exactly one ballot that is either a **save** (+1 net to a living target other than self, unless planning explicitly allows self-save) or an **eliminate** (−1 net to a living target). Product default: no self-save; self-eliminate is illegal.
- R21. Net score per player = (saves received) − (eliminate votes received). The player with the **lowest** (most negative) net score is eliminated.
- R22. If multiple players share the lowest net, the empowered player breaks the tie among that set only.

**Launch format: Fewest Votes / Vote Bomb**

- R23. Every alive player casts exactly one elimination-direction vote for a living player other than self (self-votes illegal).
- R24. Any player who receives **zero** votes is **safe** and cannot be eliminated this round.
- R25. Among players who received at least one vote, the player with the **fewest** votes is eliminated.
- R26. If two or more players share the fewest positive vote total, the empowered player breaks the tie among that set only. If the positive-vote set is empty after ballots (pathological), House runs one full re-vote; if still empty, the empowered player eliminates any one alive player.

**Launch format: Safety Bounce**

- R27. One living player is chosen uniformly at random as the **bounce starter** and begins **safe**.
- R28. The current actor must point to a living player who is not yet classified; that target becomes **vulnerable** if the actor is safe, or **safe** if the actor is vulnerable. Alternation continues until every alive player is either safe or vulnerable.
- R29. Only the **vulnerable** pool is eligible for the elimination vote. Safe players cannot be voted out this round.
- R30. Every alive player then casts one vote among the vulnerable pool only (if the voter is the sole vulnerable, skip to R31 with that player eliminated). Self-votes are illegal if self is not in the pool; voters outside the pool still vote.
- R31. The vulnerable player with the most votes is eliminated. Ties in that pool are broken by the empowered player choosing among the tied vulnerable players only.

**Observability and validation**

- R32. Public framing must name the empowered player, the two offered formats, the chosen format, and the fixed rule summary before format play.
- R33. Safety Bounce pointers are public as each is made. Save-or-eliminate ballots, Vote Bomb ballots, and the Safety Bounce elimination vote are sealed until resolution.
- R34. Revealed outcomes must make the elimination math legible (nets, vote totals, safe/vulnerable sets, full bounce chain) so viewers and agents can learn the format.
- R35. Validation is CLI/sim first: success is not “game completes,” but that each format produces distinct coalition behavior and that pure same-target pile-on is less automatic than under classic Council.
- R36. Token/runtime cost of post-pick mingle must stay intentional; do not restore full pre-format multi-beat Mingle as required for v1.

---

## Acceptance Examples

- AE1. **Covers R3, R5, R9.** Given empower just resolved, when House offers Save-or-eliminate and Vote Bomb, the empowered player must pick exactly one of those two; Safety Bounce is not playable this round.
- AE2. **Covers R20–R22.** Given nets of A: +2, B: −1, C: −1, D: 0, when Save-or-eliminate resolves, B and C are tied lowest; empowered eliminates exactly one of B or C.
- AE3. **Covers R23–R25.** Given vote totals A:3, B:1, C:1, D:0, when Vote Bomb resolves, D is safe; B and C tie for fewest positive votes; empowered breaks between B and C only.
- AE4. **Covers R27–R31, R33.** Given a finished bounce with vulnerable {B, C, E} and safe {A, D}, when the vote runs, ballots may only name B, C, or E; highest among that pool leaves. Bounce pointers were public; the elimination ballots were sealed until reveal.
- AE5. **Covers R1, R6, R12–R13, R19.** Given a completed launch-format round, empowered was a full participant and fully eligible, no protect shield and no two-candidate Council vote occurred, and exactly one player is out.
- AE6. **Covers R14–R15, R18.** Given format locked as Vote Bomb, agents receive post-pick mingle without an expose ledger requirement, then cast Vote Bomb ballots.
- AE7. **Covers R33.** Given Save-or-eliminate or Vote Bomb, individual ballots are not announced as cast; House reveals the full named tally with the elimination.

---

## Success Criteria

- Across a small sim batch (operator-watched), rounds visibly rotate formats rather than replaying one elimination script.
- At least two of the three formats show coalition behavior that is not “everyone piles the same name with plurality.”
- Agents can state the active format rules in decisions without prompt-scripted panic.
- Token cost of a standard round does not balloon past “Lobby + alliances + empower + one mingle window + format resolve” without an explicit product choice to spend more.
- Watchers can explain why someone left using format math, not only “the majority wanted them gone.”

---

## Scope Boundaries

**In scope**

- Format kernel spine for standard rounds
- Three launch formats with fixed rules
- Empower as format chooser + tiebreaker
- Token-aware social order (lobby, alliances, post-pick mingle)
- Sim-first validation expectations

**Deferred for later**

- Full catalog: Room Roulette, Even Votes, Double Votes, Even & Double, Dual Houses, Restricted-history, Date Night, Kingdom / Kings & Peasants, Ranked Elimination, BB-style nominations + veto
- Multi-elimination rounds
- Expose ballot, expose-gated menus, rare “exposed gains power” flips
- Classic Influence as a format card
- Post-pick mechanical twists / House knobs inside a format
- Format bleed into endgame stages
- Rich web UX polish for every format (beyond legible announcements and later watch facts)

**Outside this product’s identity**

- Turning Influence into a pure random minigame show with no social memory
- Live human mid-match steering of agents
- Removing empower / social alliance play entirely

---

## Dependencies / Assumptions

- Named alliances, Lobby, and empower plurality already exist and remain the pre-format spine.
- Cast size remains roughly 4–12; menu fitness may hide a format only if cast size makes it incoherent (planning defines thresholds; e.g. Safety Bounce with 3 alive is endgame territory already).
- Crash-safety / durable kernel work is orthogonal; this redesign does not claim crash-safe execution.
- Audience for first proof is operator + friends via sims and existing watch paths, not a public format tutorial product.

---

## Outstanding Questions

### Resolve Before Planning

_None._ Product shape is sufficient to plan.

### Deferred to Planning

- Exact House anti-repeat algorithm for the two-format menu (hard ban on immediate repeat vs soft weights).
- Minimum alive counts per format before House may offer them.
- How revealed vote ledgers and postgame cohort metrics generalize when ballots are save/elim or bounce-derived pools.
- Whether format choice is itself a public strategic receipt in later agent context packs (lean yes).
- Migration path for docs (`docs/rules-page-content.md`, CONCEPTS) and prompts during implementation.

---

## Sources / Research

- Current standard-round contract: `docs/rules-page-content.md` (Lobby → Mingle I → empower/expose Vote → post-vote Mingle → Power → Council).
- Domain vocabulary: `CONCEPTS.md` (Post-vote Mingle, Exposure bench, Revealed vote ledger, Named alliance, Alliance huddle).
- Product bar: `STRATEGY.md`; operating context in `Agents.md` (enjoyable-to-watch games, agent strategy quality).
- Prior drama experiments (historical, not binding): `docs/rules-experiment-thesis-inf-184.md`, `docs/brainstorms/2026-06-15-post-vote-mingle-drama-requirements.md`.
