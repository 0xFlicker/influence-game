---
title: Production MCP Role Resource Split
date: 2026-06-30
category: architecture-patterns
module: api Production Game MCP
problem_type: architecture_pattern
component: authentication
severity: high
applies_when:
  - "exposing production MCP tools to both player-facing clients and privileged producer/debug clients"
  - "adding user-facing MCP mutations that must stay limited to pre-match management"
  - "granting game inspection access without leaking producer private traces or global developer visibility"
  - "supporting MCP App/provider installs that need scope=games app reads"
tags: [production-game-mcp, oauth, scope-games, scope-mcp, producer-mcp, agent-management, cognitive-artifacts, queue-enrollment]
related_components: [service_object, assistant, documentation, tooling, testing_framework]
---

# Production MCP Role Resource Split

## Context

Influence's production MCP surface now has to serve two different jobs without letting them blur together:

- `/mcp` is the user-facing resource. It authorizes OAuth `scope=games`, is constrained to the authenticated subject, and is described as "access your games via MCP."
- `/mcp/producer` is the producer/debug resource. It authorizes OAuth `scope=mcp`, requires the current `mcp` role, and preserves global producer inspection plus private trace tooling.

The user-facing resource expanded from game inspection into a management-only surface: rules discovery, structured archetype vocabulary, owned-agent list/detail/search, owned-agent create/update, daily-free queue status/join/leave, open-game list/join, authorized cognitive artifacts, projections, events, timelines, and revealed round facts. It deliberately does not expose voting, empower/expose, Council decisions, Mingle/lobby/diary messages, ready checks, timers, phase controls, moderator controls, or power actions.

Session history showed the shape this replaced: early MCP work started as a privileged `scope=mcp` validation lane, then the `games` scope emerged as the correct user-facing lane. Treating `scope=mcp` as the future player scope was the recurring footgun; keeping producer access privileged and adding a separate subject-scoped `/mcp` resource made the boundary legible. (session history)

## Guidance

Keep the resource split precise:

```text
POST /mcp
  scope: games
  access: authenticated subject's games, owned agents, supported pre-match enrollment

POST /mcp/producer
  scope: mcp
  access: global producer reads, current mcp role required, private trace tools
```

Build the user-facing tool catalog as an allowlist. Shared game-inspection reads can appear on both resources, but user management tools belong only on `/mcp`; producer evidence tools belong only on `/mcp/producer`. Under `scope=games`, unknown or producer-only tool names should fail before a read model runs.

The current user-facing `/mcp` inventory is:

- Game reads: `list_games`, `read_projection`, `read_round_facts`, `filter_events`, `player_timeline`.
- Cognitive artifacts: `list_cognitive_artifacts`, `read_cognitive_artifact`, with user authorization before row-existence or no-capture details leak.
- Rules and vocabulary: `get_rules`, `search_rules`, `list_archetypes`.
- Agent management: `list_agents`, `get_agent`, `search_agents`, `create_agent`, `update_agent`.
- Pre-match enrollment: `get_queue_status`, `list_open_games`, `join_queue`, `leave_queue`.

The current producer `/mcp/producer` inventory keeps producer-only evidence access:

- Shared game reads and cognitive artifact reads with producer visibility.
- `inspect_durable_run`, `list_trace_manifests`, `read_trace_content`, `search_reasoning_traces`.

Never expose active-match actions on the user-facing MCP. Their absence is the product contract, not an implementation gap. Tool descriptions should say when not to call a tool and whether it has side effects. Descriptors must mark reads with `readOnlyHint: true` and mutations with `readOnlyHint: false`.

Keep archetypes as structured machine vocabulary. The shared user-selectable catalog should drive rules, schemas, validation, and tests. `list_archetypes` exists because rules prose and create/update schemas drift when clients have to scrape copy. `broker` is not user-selectable in this surface until a product decision enables it.

Be honest about rating provenance. Current free-track ELO is account-level. Per-agent `gamesPlayed`, `wins`, and `winRate` are per-agent stats, but the rating object must identify itself as `kind: "account-level-free-track"` with `agentEloAvailable: false`. Do not claim "highest ELO agent" or true per-agent ELO until a real per-agent source exists.

Derive ownership from auth context, never from MCP arguments. The bearer token and DB context supply the user identity; list/search query only owned profiles; create inserts for that user; update requires `(agentId, userId)`; queue joins first load the owned agent. Treat client-supplied `userId`, `ownerId`, `rating`, `stats`, `createdAt`, and other immutable or ownership fields as invalid input.

Prefer coarse, retry-tolerant mutations:

- `create_agent` creates one owned profile from coarse authoring fields and returns the full agent summary.
- `update_agent` updates mutable fields only and returns the full agent summary. It should not train users around current stats-reset behavior.
- `join_queue` supports `daily-free` and `open-game`; unsupported future types fail with `unsupported_queue_type`.
- `leave_queue` supports `daily-free` only and succeeds when the user is already absent.

Queue semantics should stay future-aware without pretending future queues exist. `queueType` is the extensibility point. In v1, daily-free status/leave are supported; open-game list/join are supported; open-game status/leave are not.

Keep responses LLM-legible. Management reads should include queue state, active enrollment, rating provenance, stats, useful display labels, and recovery-friendly domain errors. A provider client should not need to call five tools to answer which owned agent can be queued and what happened.

## Why This Matters

MCP clients infer behavior from tool names, descriptions, schemas, annotations, and returned payloads. If the user-facing resource advertises a live-match-shaped tool, a provider may try to use it. If a mutation is marked read-only, a host may treat it as safe exploration. If trace tools are discoverable under `scope=games`, private producer evidence becomes one prompt away from accidental exposure.

The two-profile resource model lets Influence expose useful end-user capability without weakening producer debugging. Players can create or tune agents and enter supported pre-match flows from AI apps, while raw trace metadata/content, global corpus inspection, and producer visibility stay behind `/mcp/producer` and the current `mcp` role.

Provider compatibility also depends on exact resource boundaries. Session history showed provider-packaged MCP apps are sensitive to externally visible metadata, callback URLs, and challenge shapes; fixes should come from live metadata and route checks, not guessed URL patterns or extra deployment knobs. (session history)

## When to Apply

Apply this pattern whenever adding or changing production MCP tools, OAuth resource metadata, MCP App entry points, game-inspection reads, cognitive artifact access, agent profile management, pre-match enrollment, or queue types.

Use the same boundary when designing ranked, tournament, party, invite-code, spectator, or avatar flows: user-facing `/mcp` may prepare or inspect subject-owned state; active match participation and producer evidence stay elsewhere unless there is a deliberate product decision and a new security review.

Also apply it when updating docs. `docs/game-mcp-production-oauth.md`, `CONCEPTS.md`, README/DEVELOPMENT validation notes, and tool descriptions must agree on the exact split: `scope=games` is subject-scoped; `scope=mcp` is producer/global; `/mcp/producer` uses the current `mcp` role.

Do not apply this as justification to expose gameplay actions through MCP. If a tool casts votes, sends Mingle/lobby/diary messages, controls timers/phases, invokes powers, makes Council decisions, or moderates a live game, it is outside the user-facing MCP contract.

## Examples

Descriptor shape for a user-facing mutation:

```ts
tool({
  name: "join_queue",
  description:
    "Enroll one owned agent into a supported pre-match queue. " +
    "Do not use for active-match participation. Requires scope=games. " +
    "Side effect: inserts a queue entry or waiting game player row.",
  properties: {
    queueType: { type: "string", enum: ["daily-free", "open-game"] },
    agentId: { type: "string" },
    gameIdOrSlug: { type: "string" },
  },
  required: ["queueType", "agentId"],
  scope,
  readOnlyHint: false,
});
```

Rating payload shape:

```json
{
  "stats": { "gamesPlayed": 7, "wins": 2, "winRate": 0.2857142857142857 },
  "rating": {
    "kind": "account-level-free-track",
    "currentElo": 1388,
    "peakElo": 1440,
    "accountGamesPlayed": 27,
    "accountWins": 9,
    "agentEloAvailable": false
  }
}
```

Queue operation matrix:

```text
daily-free:
  get_queue_status: yes
  join_queue: yes, idempotent for same user and same agent
  leave_queue: yes, idempotent when absent

open-game:
  list_open_games: yes
  join_queue: yes, requires gameIdOrSlug and waiting/open capacity
  get_queue_status: no in v1
  leave_queue: no in v1

ranked/tournament/party/invite:
  reject explicitly with unsupported_queue_type until implemented
```

Boundary checklist for a new MCP tool:

```text
1. Which resource owns it: /mcp, /mcp/producer, or both?
2. Which scope should appear in descriptor security schemes?
3. Does it mutate state? If yes, readOnlyHint must be false.
4. Does it act inside an active match? If yes, it does not belong on /mcp.
5. Does it expose private trace metadata/content? If yes, producer only.
6. Does authorization come entirely from bearer token and DB context?
7. Is the response rich enough for an LLM client to explain the result?
8. Is there a regression test for inventory, auth boundary, and failure shape?
```

Readiness checks for this surface should cover:

- Tool inventory for `/mcp` and `/mcp/producer`.
- OAuth security schemes and scopes in tool descriptors.
- Correct `readOnlyHint` annotations for reads and mutations.
- Producer trace tools not discoverable or callable with `scope=games`.
- Active-match-shaped names rejected under `scope=games`.
- `list_archetypes` and create/update schemas exclude non-user-selectable archetypes.
- Owned-agent list/search/update cannot cross users or leak another user's prompt.
- Agent summaries label account-level rating provenance.
- Daily-free join/leave idempotency and conflict behavior.
- Unsupported queue types rejected explicitly per operation.
- Open-game list/join filters for waiting, visible, custom, non-full games.

Use Bun for validation. If a DB-backed test or local API read reports `ECONNREFUSED` from a sandboxed command, rerun with elevated/local-DB access before declaring the database down.

## Related

- `docs/game-mcp-production-oauth.md` is the canonical production MCP OAuth and resource-profile contract.
- `packages/api/src/game-mcp/server.ts` owns JSON-RPC routing, tool descriptors, read/write annotations, and the user/producer inventory split.
- `packages/api/src/game-mcp/rules.ts` and `packages/api/src/services/agent-archetypes.ts` keep rules/archetype vocabulary structured and aligned with validation.
- `packages/api/src/services/agent-profile-management.ts` owns subject-scoped agent reads/mutations, rating provenance, immutable-field rejection, and rich agent serialization.
- `packages/api/src/services/queue-enrollment.ts` owns daily-free/open-game enrollment semantics and unsupported queue errors.
- `packages/api/src/__tests__/production-game-mcp-server.test.ts`, `agent-profile-management.test.ts`, `queue-enrollment.test.ts`, `game-mcp-rules.test.ts`, and `agent-archetypes.test.ts` are the focused regression suite.
- `CONCEPTS.md` defines MCP role/scope, Games MCP scope, Management-only MCP, Producer MCP, Production Game MCP, cognitive artifacts, and private trace terms.
- `docs/solutions/runtime-errors/production-game-mcp-raw-trace-read-limit.md` covers producer trace response sizing. It is adjacent, not a substitute for this management-surface boundary.
- `docs/solutions/architecture-patterns/agent-strategy-observability-spine.md` covers the broader separation between player-visible state, canonical events, and producer/debug evidence.
