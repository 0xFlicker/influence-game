---
module: Contestant context
problem_type: design_pattern
tags: [gender, prompts, roster, influence, werewolf, recovery]
---

# Share stored gender through the frozen roster

Agent profiles stored gender, but both contestant rosters omitted it. Models could only guess from names or dialogue.

Influence copies profile gender into the waiting seat persona, freezes it in `game.roster_initialized`, and supplies the canonical roster to every agent's shared system prompt. Durable recovery loads that roster before initializing agents. Werewolf freezes the approved character gender in `werewolf.started` and exposes it in each contestant's `board.players`. New retrospective accounts retain gender in their canonical roster facts too.

Missing gender stays unspecified. Historical Werewolf observations omit absent roster fields to preserve the hashes binding planned turns and owner-learning evidence. Prompts direct contestants to use names or neutral language rather than guessing, and do not equate gender with explicit pronoun preferences. This change adds no foreign personality, backstory, strategy, role, or reasoning to contestant context.

Deployment activates this for newly frozen rosters. Do not backfill historical rosters from current profiles or rewrite frozen retrospective documents. Tests cover all three stored values, null/absent values, foreign-contestant visibility, private-field exclusion, profile edits after game start, and durable restart with conflicting newly supplied identity.

House-created casts also need authored identity metadata: casting previously omitted gender in Influence and wrote null in Werewolf, while audio ignored roster gender for every player without a saved profile. The original fixed names were still present in the simulation cast and portrait-generation script, but API fills paired independent pools. `HOUSE_CAST` now owns all fourteen fixed name/archetype/gender identities. API fills, factories, simulations and waiting-seat reconciliation use it; the gallery labels the same names. A restricted pool cannot clone characters under spare names. Voice defaults read stored roster gender. Never infer gender during replay/audio reads or apply House metadata to owned profiles; historical unspecified identities and frozen recordings stay unchanged.
