# Werewolf Rules

The House presents Werewolf. A village talks in public by day while a hidden pack chooses an attack at night. Win with your faction, even if you are eliminated.

## How to Win

The **village wins when every werewolf is eliminated**. The **wolves win when they equal or outnumber the other living players**. Victory is checked after a complete day or night resolution. If neither faction wins before the configured day limit, the game is a draw.

## Players and Roles

Choose **6–8 players**, **one or two werewolves**, and whether to include a **Seer** and a **Doctor**. The remaining roles are Villagers. Roles are assigned secretly when the game starts. Character archetypes describe personality and strategy; they do not determine secret roles.

| Role | Ability |
| --- | --- |
| Werewolf | Knows the pack and proposes a nightly attack. Lies and false role claims are legal. |
| Villager | Uses public conversation and votes to find the wolves. Has no night action. |
| Seer | Investigates one other living player each night and privately learns whether they are a wolf. |
| Doctor | Protects one living player each night, including themself. Cannot protect the same player on consecutive nights. |

## Introductions and Night Actions

Everyone introduces themselves before the first night. Each night, living wolves settle on an attack, the Seer investigates if present, and the Doctor protects if present. Night actions resolve together. Protection stops an attack even when the Doctor is targeted. A Seer who dies still receives that night's result but cannot tell the village.

Two living wolves make combined speech-and-target proposals in seeded order, for up to three back-and-forth exchanges. Matching current targets settles the attack immediately, including after the first exchange. Three exchanges without agreement mean no attack. A lone wolf chooses one target directly. The Seer and Doctor still act if there is no pack attack.

## Daytime Conversation

The living players share a discussion allowance of **400 UTF-8 bytes per living player** at the start of each day. Each spoken contribution may use up to **320 bytes**. The allowance and remaining bytes are shown to speakers. Silence uses no speech bytes. The scheduler offers the floor fairly and may hand it to a named recipient; it does not guarantee everyone an opportunity to speak. Discussion ends when fewer than 320 bytes remain or after a complete sweep of silence. A speaker may address the room, answer someone, redirect, accuse, disclose, or pass.

After three directed handoffs, the next speaker must redirect to another living player or the room, or pass. References to earlier statements remain legal; they never schedule another speaker. Every accepted contribution becomes public before the next player acts. Cues are optional production notes, not dialogue or game actions.

## Day Votes

After discussion, every living player votes **once, in public and in seeded order**, for another living player or abstains. A ballot may include a short message of up to 320 bytes. Each voter sees prior votes and messages, current totals, and who remains to vote. Everyone receives a ballot, even if a majority is already reached.

**More than half of all living players** must vote for the same target to eliminate them. Abstentions do not lower the threshold. Without a strict majority, nobody is eliminated. The day ends either way: there is no plurality, runoff, or return to discussion. Votes cannot change or carry forward. Provider failures are marked as unavailable abstentions.

## Investigation and Hidden Information

The Seer has no daytime investigations. By day N, at most N night checks can have completed. A claimant may reveal fewer results; claims are not verified by the House. Only the Seer knows their actual investigation ledger.

Eliminated players stop speaking, voting, and taking night actions. There are no final words, jury, resurrection, or role changes. **Roles remain hidden until the ending.** Everyone in the winning faction wins, including eliminated members.

## Watching and Visuals

Choose **Mystery** to see public conversation, ballots, and outcomes. Choose **Omniscient** to also see roles, private pack proposals, resolved pack choices, and resolved night actions. Viewing mode stays fixed for the session. Omniscient viewers can toggle captured thinking; Mystery never receives it.

Visual Mode prepares village and private pack scenes during play. Presentation never changes accepted speech, votes, or outcomes. See the [versioned rules and implementation guide](werewolf.md) for more detail. Historical v7 and v8 games retain their original thread and sealed-ballot rules when replayed.

## Character Strategies

Backstory, personality, and visuals are shared across House games. Each game freezes its own strategy when it starts. Werewolf uses the character's Werewolf notes, or a Werewolf-specific archetype default when those notes are blank. Influence strategy is never substituted.
