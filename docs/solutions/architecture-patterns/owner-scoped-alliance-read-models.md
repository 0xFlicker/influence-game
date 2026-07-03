---
title: Owner-Scoped Alliance Read Models
date: 2026-07-03
category: architecture-patterns
module: api named alliance MCP and postgame analysis
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "exposing private or member-scoped gameplay facts through MCP"
  - "threading named alliance consequences into postgame summaries"
  - "summarizing hidden huddle transcripts without leaking raw private envelopes"
  - "deciding whether a generic event tool or a dedicated read model should carry subjective game knowledge"
tags: [named-alliances, mcp, read-models, postgame, privacy, huddles, summaries]
related_components: [assistant, testing_framework, documentation]
---

# Owner-Scoped Alliance Read Models

## Context

Named alliances made alliance proposals, huddles, and huddle outcomes real gameplay facts, but the first public/current read surfaces did not let an owner inspect the alliance knowledge their agent was allowed to know. `read_round_facts`, `filter_events`, and `player_timeline` were useful for public board state, but they were the wrong first home for hidden proposal history, member huddles, and selected-player thinking.

The solved shape was two-step:

- Add a dedicated owner-scoped `read_agent_alliances` tool for the selected owned player or agent.
- Make compact alliance facts the shared summary shape, then thread those compact facts into broader MCP and postgame surfaces.

Session search reinforced the sequence: the first slice was intentionally narrow and owner-scoped; the follow-up made the same data inspectable without requiring every caller to fetch transcript-heavy payloads. (session history)

## Guidance

Use a dedicated subject-player read model when a gameplay fact is real but its visibility depends on the selected player's membership, invitation, or ownership context.

For named alliances, the dedicated full read can include:

- proposals involving the selected player
- active, closed, and archived alliances where the selected player is a member
- huddle messages for member alliances
- member-safe huddle outcomes
- the selected player's own huddle `thinking`

The compact read should be the reusable shape:

```ts
type CompactAllianceFacts = {
  summary: {
    proposalCount: number;
    allianceCount: number;
    huddleCount: number;
    latestHuddleRound: number | null;
  };
  proposals: CompactProposal[];
  alliances: CompactAlliance[];
  huddles: CompactHuddle[];
};
```

Compact mode should omit raw huddle `messages` and `thinking`. It should return counts, names, member names, status, rounds, speakers, outcome counts, and latest outcome summaries. Full mode remains available when the caller intentionally wants transcript-heavy detail.

Thread compact alliance context into broader read surfaces without changing their core event contract:

- `player_timeline` can include an `allianceTimeline` when the caller is authorized for that player.
- `filter_events` can include `allianceContext` beside matching event results when `actor` resolves to an authorized player.
- `read_player_game_summary` can include an `allianceArc` describing joined alliances, involved proposals, huddles attended, latest plans, and betrayal or leak claims.
- `read_game_brief` can include aggregate `allianceSummary` counts and top named alliances without exposing non-member huddles.
- `read_game_turning_points` can add deterministic alliance-aware turning points when alliance membership and public votes make the cut legible.

Keep raw private canonical envelopes out of generic event arrays. If a generic tool needs private context, attach a compact, explicit side object rather than smuggling hidden events into `events`.

## Why This Matters

Alliance facts are not fake just because they are not public. A player should be able to inspect what their own agent heard, proposed, accepted, and said in alliance rooms. At the same time, dumping raw huddle rows into every event surface creates a privacy and token mess.

The compact/full split keeps the product usable:

- compact by default lets LLM clients answer "what happened with my alliances?" in one call
- full mode preserves debugging depth for API/MCP evaluation
- broader summaries can discuss alliance consequences without carrying full transcripts
- authorization stays tied to a selected player view instead of producer/global visibility

Public web/replay inspection has a different contract from owner-scoped MCP. The viewer is public-by-URL and not restricted to one owned agent, so it can use a game-level alliance projection for official proposals, rosters, huddle outcomes, and huddle speech. That projection must still omit hidden thinking, House scheduling rationale, raw canonical envelopes, source pointers, prompts, and producer/debug fields. It also must not feed spectator knowledge back into what agents know during the match.

This also preserves the social-game payoff. In the completed `vast-plum-bay` run, alliance language carried into pleas, accusations, opening statements, jury questions, and closing arguments. That is the desired arc: huddles remain private evidence, but their strategic consequences become public endgame material.

## What Did Not Work

- Treating `read_round_facts` as the answer was too public and too board-state oriented. It should expose revealed game facts, not member huddle transcripts.
- Stuffing private alliance events into `filter_events` or `player_timeline` as normal events would have blurred raw event visibility with subject-player visibility.
- Making the full transcript-heavy alliance payload the default created an oversized response for the common question.
- Letting producer visibility decide the default shape hid the product problem: producer can inspect almost anything, but the useful player-facing contract is still a selected player's view.
- Returning `agent_not_found` for an existing but unauthorized player made access failures misleading. Existence and authorization errors should stay distinct.

## When to Apply

Apply this pattern when adding MCP/API reads for first-class game knowledge that is:

- real gameplay state, not just model reasoning
- private, member-scoped, owner-scoped, or subject-player-scoped
- useful in compact summaries outside its dedicated transcript/debug tool
- too sensitive or verbose to expose as raw canonical envelopes in generic event feeds

Do not apply it to public board facts such as eliminations, vote ledgers, power outcomes, placements, or winners. Those belong in revealed facts, projections, and postgame analysis. Do not apply it to producer-only artifacts such as raw prompts, private trace manifests, House scheduling rationale, or source pointers unless a producer-specific tool is being designed.

## Examples

Dedicated tool shape:

```ts
tool({
  name: "read_agent_alliances",
  description:
    "Read named-alliance facts known to one owned agent in a game. " +
    "Compact by default; use detailLevel: 'full' for huddle transcripts.",
  properties: {
    gameIdOrSlug: { type: "string" },
    player: { type: "string" },
    playerId: { type: "string" },
    agentId: { type: "string" },
    detailLevel: { type: "string", enum: ["compact", "full"] },
  },
  required: ["gameIdOrSlug"],
  scope,
  readOnlyHint: true,
});
```

Compact embedding shape:

```json
{
  "events": [],
  "allianceContext": {
    "summary": {
      "proposalCount": 9,
      "allianceCount": 6,
      "huddleCount": 9,
      "latestHuddleRound": 7
    },
    "alliances": [
      {
        "name": "The Quiet Switch",
        "status": "archived",
        "memberNames": ["Marnie Glass", "Echo", "Lyra"],
        "huddleOutcomeCount": 2,
        "latestOutcome": "kept Marnie as hinge while Echo and Lyra held the final path"
      }
    ]
  }
}
```

Authorization behavior:

```text
selected player exists and caller owns it      -> return compact/full alliance facts
selected player exists but caller lacks access -> agent_not_authorized
selected player does not exist in the game     -> agent_not_found
multiple owned candidates, no selector         -> agent_ambiguous with selectable players
producer caller                                -> still select a player view unless using producer/raw tools
```

## Related

- `docs/solutions/architecture-patterns/production-mcp-role-resource-split.md` covers the broader `/mcp` scope boundary.
- `docs/solutions/architecture-patterns/agent-strategy-observability-spine.md` covers the separation between public transcript, private agent-turn evidence, canonical events, and MCP validation.
- `CONCEPTS.md` defines named alliances, alliance records, alliance huddles, alliance huddle outcomes, revealed game facts, postgame analysis projections, and MCP scopes.
- `packages/api/src/game-mcp/read-model.ts` owns the production MCP read-model assembly.
- `packages/api/src/game-mcp/server.ts` owns MCP tool schemas and `detailLevel` parsing.
- `packages/engine/src/postgame-analysis.ts` owns deterministic postgame alliance summaries and turning points.
- `packages/api/src/__tests__/production-game-mcp-read-model.test.ts`, `production-game-mcp-server.test.ts`, and `postgame-analysis.test.ts` cover the focused API behavior.
- `packages/engine/src/__tests__/postgame-analysis.test.ts` covers engine-side postgame analysis derivation.
