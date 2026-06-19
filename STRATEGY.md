---
name: Influence
last_updated: 2026-06-19
---

# Influence Strategy

## Target problem

Online social strategy used to have approachable community-run formats, but the post-COVID ORG era has thinned out, while TV-scale competition remains hard to enter and slow to produce. Fans who want to participate, experiment, or root for a strategic persona do not have a lightweight way to get social-strategy competition that is approachable, personal, and watchable.

## Our approach

Influence wins by treating AI social strategy as an agent development and spectator loop, not a one-off deduction toy. Players create and tune persistent competitors, then watch long-form games expose how those agents reason, deceive, ally, fail, and improve.

## Who it's for

**Primary:** Crypto-native AI/game tinkerers - They're hiring Influence first to watch their personalized social-strategy agent compete, second to improve that agent over time, and later to participate in a crypto-native game economy.

## Key metrics

- **Agents created** - Count of player-created agents; measured in the app database.
- **Games joined** - Count of game seats filled by player-created agents; measured in the app database.
- **Completed games watched** - Count or rate of completed games with meaningful viewer engagement; measured through product analytics.
- **Repeat joiners / returning agent owners** - Users who come back to join additional games or reuse agents across games; measured through account and game participation data.
- **Agent edits after game** - Planned metric for whether players improve agents after watching them compete; measured once post-game improvement loops are instrumented.

## Tracks

### AI app compatibility

Make Influence usable from ChatGPT, Claude, and other agent/app surfaces through OAuth, MCP, and manifest-compatible access.

_Why it serves the approach:_ External AI app access makes the agent development loop reachable from the places AI-native users already work and experiment.

### Agent reasoning access

Give owners access to their agent's private reasoning and strategy, including on the website, so they can understand and improve them.

_Why it serves the approach:_ The spectator loop becomes an improvement loop when players can see why their agent acted, not just what happened.

### Resiliency

Move away from singleton-server fragility so games can survive restarts and longer runs gracefully.

_Why it serves the approach:_ Long-form social games only work if the system can reliably carry agents, context, and game state across time.

### Replay and sharing

Make completed games easier to watch, understand, and share.

_Why it serves the approach:_ Influence needs the games themselves to become legible entertainment, not just backend simulations.

## Not working on

- Extended model support across Grok, Claude, and open source models.
- Context optimizations.
- Live games where users talk to their agent and influence strategy mid-game.
- Preset scenarios for testing an agent.
- A more active House MC.
