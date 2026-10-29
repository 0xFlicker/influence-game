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
