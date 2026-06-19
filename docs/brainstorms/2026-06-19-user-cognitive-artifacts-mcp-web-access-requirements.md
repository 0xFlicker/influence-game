---
date: 2026-06-19
topic: user-cognitive-artifacts-mcp-web-access
---

# User Cognitive Artifacts MCP and Web Access Requirements

## Summary

Influence should add a new-games-only cognitive artifact boundary for reasoning, thinking, and strategy. The API captures those artifacts at write time from agent decision traces, stores them as first-class product data, and exposes them through explicit owner, participant, and producer/admin policies without reading producer private traces as a fallback.

---

## Problem Frame

Influence already captures rich private trace evidence for producer/debug use. Those traces include raw prompts, provider responses, internal metadata, storage pointers, tool arguments, emitted `thinking`, native `reasoningContext`, and structured strategy fields. That evidence is valuable, but it is too broad and too sensitive to become the user-facing access model.

The current user-facing Games MCP scope is intentionally no-trace. `/mcp` with `scope=games` grants access to the authenticated subject's allowed games, player records, and agent records, while `/mcp/producer` with `scope=mcp` keeps producer/global inspection and private trace tools. This slice should add user cognitive access without weakening that trust-boundary split.

The product direction is not "sanitize traces on demand." New games should write the user-authorized cognitive artifacts as their own records when the decision happens. Old games that lack those records should report that artifacts were not captured.

---

## Key Decisions

- **New product artifact boundary.** Store `reasoning`, `thinking`, and `strategy` as first-class cognitive artifact records instead of adding user scopes to producer evidence manifests.
- **Write-time extraction.** Derive artifacts from the in-memory decision trace while fields are still structured, then write producer traces separately as forensic evidence.
- **No producer-trace fallback.** Missing split artifacts must return a no-capture result, not trigger a best-effort read from private trace storage.
- **Producer/admin direct reads.** Producers and admins should read the split artifact records directly for normal inspection, with raw traces reserved for deeper forensic work.
- **JSONB first.** V1 should store artifact payloads in Postgres JSONB unless size crosses the product thresholds defined below.
- **MCP first, web-ready.** MCP can expose raw authorized split artifacts; web/API should start with the same read model and defer polished summaries or UI.

---

## Actors

- A1. Agent owner who wants to inspect their own agent's reasoning, thinking, and strategy from games they created or joined.
- A2. Same-game participant who may inspect other agents' thinking and strategy, but not their private reasoning.
- A3. Producer or admin who needs compact direct access to all split cognitive artifacts without reading huge raw traces.
- A4. MCP client using `/mcp` with `scope=games`.
- A5. Producer MCP client using `/mcp/producer` with `scope=mcp`.
- A6. Web/API consumer that will later render derived or summarized authorized artifacts.
- A7. Nonparticipant who must not receive cognitive artifacts from the game.

---

## Access Matrix

| Caller | Producer trace | Reasoning | Thinking | Strategy |
|---|---|---|---|---|
| Producer/admin via `/mcp/producer` | Allowed through existing producer tools. | Allowed through split artifact reads. | Allowed through split artifact reads. | Allowed through split artifact reads. |
| Owning user or owned agent profile | Denied through `scope=games`. | Allowed. | Allowed. | Allowed. |
| Other participant in the same game | Denied through `scope=games`. | Denied. | Allowed. | Allowed. |
| Game creator who did not participate | Denied through `scope=games`. | Denied unless they own the actor. | Denied unless product later treats creators as participants. | Denied unless product later treats creators as participants. |
| Nonparticipant | Denied. | Denied. | Denied. | Denied. |
| Old game without capture | Existing producer-only trace behavior. | `not_captured_for_game`. | `not_captured_for_game`. | `not_captured_for_game`. |

---

## Requirements

**Artifact Contract**

- R1. New games must be able to write cognitive artifact records for `reasoning`, `thinking`, and `strategy`.
- R2. A `reasoning` artifact must contain raw/native reasoning context when the model provider produced it, plus minimal game, actor, action, phase, round, and event-boundary metadata.
- R3. A `thinking` artifact must contain explicit model-emitted thinking, plus minimal game, actor, action, phase, round, and event-boundary metadata.
- R4. A `strategy` artifact must contain structured strategy data such as `decisionLog`, `strategicLens`, strategy packet summaries, or strategic reflection summaries when those values exist.
- R5. Cognitive artifacts must not include raw prompts, raw provider responses, internal keys, storage pointers, full tool argument blobs, or producer trace source-pointer internals.
- R6. Each artifact must carry enough ownership and participation metadata to enforce owner-only and participant-visible access without reading private trace content.
- R7. Empty provider-native reasoning must be represented as absent capture for `reasoning`, not synthesized from `thinking` or strategy text.

**Write-Time Capture**

- R8. Cognitive artifact writing must happen at the API decision-trace capture seam for new games, beside the existing producer private trace write.
- R9. The writer may derive artifacts from the same in-memory decision trace object used for producer evidence, but persisted user artifacts must be independent records.
- R10. Artifact write failures must be reported as degraded artifact diagnostics without corrupting canonical game progress.
- R11. Producer private trace writing must continue to write full raw evidence with the existing producer/admin boundary.
- R12. The artifact writer must be gated by a new-games-only capability flag so games created before the slice do not silently gain partial reconstruction behavior.

**Storage and Size**

- R13. V1 should store cognitive artifact payloads in Postgres JSONB with a hard per-artifact payload cap around 256 KiB.
- R14. Payloads above the V1 cap must be rejected or marked degraded for artifact capture, not moved into private trace storage as a hidden fallback.
- R15. Artifact manifest plus object storage should be introduced only if artifact p95 regularly exceeds 64 KiB, more than 1 percent of artifacts hit the 256 KiB cap, or one game commonly exceeds 5-10 MiB of cognitive artifact payload.
- R16. The storage model must support indexed listing by game, actor, artifact type, action, phase, round, and event boundary.

**Authorization**

- R17. `scope=games` callers may read reasoning only for player records they own directly or through an owned agent profile.
- R18. `scope=games` callers may read thinking and strategy for player records they own and for other participants in games they joined.
- R19. A game creator who did not participate must not receive thinking or strategy for other actors unless a later product decision explicitly treats creators as participants.
- R20. Nonparticipants must not list, read, infer existence of, or receive snippets from cognitive artifacts.
- R21. Producer/admin callers must be able to list and read all split artifacts directly without invoking raw trace read tools.
- R22. The user-facing authorization service must not fall back to producer accessors when `scope=games` is active.

**MCP and Resource Design**

- R23. `/mcp` with `scope=games` must expose user-facing cognitive artifact list/read capabilities only for authorized split artifacts.
- R24. `/mcp` with `scope=games` must still omit producer trace tools and must not expose trace manifests, trace metadata, raw prompts, or private storage keys.
- R25. `/mcp/producer` with `scope=mcp` must expose producer-wide cognitive artifact list/read capabilities in addition to the existing producer trace tools.
- R26. Cognitive artifact list results should return stable artifact identities or URIs that can be read through the same authorization policy.
- R27. MCP responses must clearly distinguish `not_captured_for_game`, `not_captured`, and `denied` without revealing unauthorized artifact contents.

**Web/API Read Model**

- R28. Web/API access must use the same cognitive artifact authorization service as MCP.
- R29. The first web/API surface should expose artifact availability, indexes, and deterministic authorized payloads or snippets without committing to final UX polish.
- R30. LLM summaries, timeline presentation, and polished artifact cards must remain outside this slice.
- R31. Raw/native reasoning over web should remain conservative and use the same owner-only rule as MCP when exposed.

**New-Games-Only and Compatibility**

- R32. Newly created games must carry an artifact-capture version or capability marker that lets read paths distinguish supported games from old games.
- R33. Old games must return a clear no-capture result for cognitive artifacts and must not reconstruct artifacts by reading producer traces.
- R34. Waiting-room games created before deployment may remain no-capture unless explicitly recreated or manually marked by a later migration.
- R35. Existing producer trace manifest, content read, and reasoning search behavior must remain unchanged.

**Audit and Tests**

- R36. Artifact reads must be auditable with subject, auth profile, game, actor, artifact type, outcome, and denial reason while redacting payload bodies.
- R37. Writer tests must prove sentinel prompt, raw response, tool argument, storage key, and source-pointer strings cannot enter user artifact payloads.
- R38. Access tests must cover owner, same-game participant, created-only nonparticipant, nonparticipant, and producer/admin callers.
- R39. MCP tests must prove `scope=games` can read authorized split artifacts while still failing to discover or call trace tools.
- R40. Producer tests must prove producer/admin can read split artifacts directly even when raw trace storage is unavailable or intentionally not consulted.
- R41. New-games-only tests must prove unsupported old games return no-capture results and never call private trace storage.

---

## Key Flows

- F1. New game captures split artifacts
  - **Trigger:** A new API-backed game receives an agent or House decision response.
  - **Actors:** A1, A3
  - **Steps:** The decision trace reaches the API capture seam; the artifact writer extracts allowed reasoning, thinking, and strategy fields; producer trace storage writes the full raw trace separately.
  - **Outcome:** User-authorized cognitive artifacts exist as product records without weakening the producer trace boundary.
  - **Covered by:** R1-R12, R35

- F2. Owner reads their agent's reasoning
  - **Trigger:** An agent owner asks MCP or web/API for reasoning from their own agent in a captured game.
  - **Actors:** A1, A4, A6
  - **Steps:** The read model resolves live ownership claims, confirms the actor belongs to the subject, and returns the authorized reasoning artifact or a no-capture result.
  - **Outcome:** The owner can inspect their agent's raw/native reasoning when captured.
  - **Covered by:** R2, R6, R7, R17, R22, R23, R27-R31

- F3. Participant reads another agent's thinking and strategy
  - **Trigger:** A participant asks for another participant's artifacts in a game they joined.
  - **Actors:** A2, A4
  - **Steps:** The read model confirms same-game participation, denies reasoning, and allows thinking and strategy artifacts.
  - **Outcome:** Participants can understand other agents' visible strategic posture artifacts without receiving private reasoning.
  - **Covered by:** R3, R4, R18, R20, R23, R27

- F4. Producer inspects compact artifacts
  - **Trigger:** A producer wants to inspect cognitive artifacts without loading a full raw trace.
  - **Actors:** A3, A5
  - **Steps:** The producer MCP lists and reads split artifacts through producer mode; raw trace tools remain available as a separate deeper path.
  - **Outcome:** Producer/debug workflows get compact artifact access without treating raw traces as the only source.
  - **Covered by:** R21, R25, R35, R40

- F5. Old game returns no capture
  - **Trigger:** A caller asks for cognitive artifacts from a game created before artifact capture was enabled.
  - **Actors:** A1, A2, A3, A4, A5, A6
  - **Steps:** The read model detects the missing capture capability and returns `not_captured_for_game`.
  - **Outcome:** The system avoids ambiguous old-game reconstruction and never reads producer traces as a fallback.
  - **Covered by:** R12, R27, R32-R34, R41

---

## Acceptance Examples

- AE1. **Covers R1-R7, R37.**
  - **Given:** A decision trace contains a prompt, raw model response, storage pointer, tool arguments, `thinking`, `reasoningContext`, `decisionLog`, and strategy fields.
  - **When:** the cognitive artifact writer processes the trace for a new game.
  - **Then:** user artifact payloads include only allowed cognitive fields and metadata, and sentinel private trace strings are absent.

- AE2. **Covers R17, R18, R20, R23, R27.**
  - **Given:** Alice owns Agent A and participated in a game with Agent B.
  - **When:** Alice reads artifacts through `scope=games`.
  - **Then:** Alice can read Agent A reasoning, thinking, and strategy, can read Agent B thinking and strategy, and cannot read Agent B reasoning.

- AE3. **Covers R19, R20, R38.**
  - **Given:** a user created a game but did not join as a player or own any actor in it.
  - **When:** the user requests another actor's cognitive artifacts through `scope=games`.
  - **Then:** the request is denied and does not reveal whether matching artifacts exist.

- AE4. **Covers R21, R25, R40.**
  - **Given:** producer raw trace storage is unavailable for a captured game but cognitive artifact rows exist.
  - **When:** a producer lists and reads split artifacts through `/mcp/producer`.
  - **Then:** the split artifact reads succeed or fail based on artifact storage only and do not call raw trace content reads.

- AE5. **Covers R23-R27, R39.**
  - **Given:** a valid `games` token is connected to `/mcp`.
  - **When:** the client lists tools and reads authorized cognitive artifacts.
  - **Then:** cognitive artifact tools are available, producer trace tools are absent, and trace tool calls fail as producer-only.

- AE6. **Covers R13-R15.**
  - **Given:** artifact payloads remain below JSONB thresholds in normal runs.
  - **When:** the slice is planned and implemented.
  - **Then:** no artifact manifest/object-storage layer is introduced for user artifacts.

- AE7. **Covers R32-R34, R41.**
  - **Given:** an old game has producer traces but no cognitive artifact capture marker.
  - **When:** any caller requests cognitive artifacts for that game.
  - **Then:** the response is `not_captured_for_game` and private trace storage is not consulted.

---

## Success Criteria

- Users can inspect their own agent's reasoning, thinking, and strategy for new captured games.
- Same-game participants can inspect other agents' thinking and strategy without receiving their reasoning.
- Producers can list and read split cognitive artifacts directly, with raw traces reserved for forensic inspection.
- `scope=games` still cannot discover, list, read, or infer producer trace manifests or private trace content.
- Old games produce clear no-capture responses instead of partial or trace-derived artifacts.
- The authorization matrix is covered by automated tests that fail closed on owner, participant, producer, and nonparticipant boundaries.

---

## Scope Boundaries

In scope:

- New-games-only cognitive artifact capture.
- A first-class artifact storage/read model for reasoning, thinking, and strategy.
- Owner, participant, and producer/admin authorization policies.
- MCP list/read access for authorized split artifacts.
- Minimal web/API read-model support that reuses the same authorization service.
- Audit and test coverage for writer leakage, access policy, MCP tool discovery, and no-fallback behavior.

Out of scope:

- Backfilling old games from producer traces.
- Granting users access to producer trace manifests, trace metadata, storage keys, raw prompts, or raw provider responses.
- Object storage for user artifacts before the size thresholds are met.
- Final web UI polish, generated summaries, timelines, or artifact cards.
- Changing `scope=mcp` semantics or moving producer/global access into `scope=games`.
- Capturing every helper model call beyond existing decision-trace capture.
- Checkpoint hydration, resume authority, or crash-safety claims.

---

## Dependencies and Assumptions

- The existing `/mcp` and `/mcp/producer` scope/resource split remains the authorization foundation.
- Live games claim resolution can continue to use created games, joined game players, direct user ownership, and owned agent profiles.
- The existing API decision-trace sink remains the right capture seam for this slice.
- Provider-native reasoning may be absent for some models, and absence should not be treated as an error.
- Product currently treats created-only users as game-list readers, not participants for cognitive artifact access.

---

## Outstanding Questions

Resolve before planning:

- None.

Deferred to planning:

- Exact artifact table and index names.
- Exact MCP tool names and URI format.
- Exact web/API route placement and response envelope.
- Whether artifact read auditing should reuse the evidence-read audit table shape or use a separate artifact-read audit table.

---

## Sources

- `AGENTS.md`
- `CONCEPTS.md`
- `STRATEGY.md`
- `docs/ideation/2026-06-19-user-cognitive-artifacts-mcp-web-access-ideation.html`
- `docs/brainstorms/2026-06-15-private-trace-writer-mcp-requirements.md`
- `docs/brainstorms/2026-06-17-thin-strategic-decision-fields-requirements.md`
- `docs/brainstorms/2026-06-19-games-scope-mcp-oauth-hardening-requirements.md`
- `docs/game-mcp-production-oauth.md`
- `docs/reasoning-transcript-observability.md`
- `docs/solutions/runtime-errors/production-game-mcp-raw-trace-read-limit.md`
- `docs/solutions/architecture-patterns/agent-strategy-observability-spine.md`
- `packages/api/src/db/schema.ts`
- `packages/api/src/game-mcp/auth.ts`
- `packages/api/src/game-mcp/claims.ts`
- `packages/api/src/game-mcp/read-model.ts`
- `packages/api/src/game-mcp/server.ts`
- `packages/api/src/routes/games.ts`
- `packages/api/src/routes/mcp.ts`
- `packages/api/src/services/evidence-access.ts`
- `packages/api/src/services/game-evidence.ts`
- `packages/api/src/services/game-lifecycle.ts`
- `packages/api/src/services/mcp-oauth.ts`
- `packages/api/src/services/private-trace-read-model.ts`
- `packages/api/src/services/private-trace-writer.ts`
- `packages/engine/src/agent.ts`
- `packages/engine/src/game-runner.types.ts`
- `packages/engine/src/phases/phase-runner-context.ts`
