---
title: "Inside The House: the agentic architecture"
date: 2026-07-01
summary: "A reference map of how agents reason, how The House accepts decisions, and how events, storage, APIs, MCP, and web viewers stay in agreement."
tags:
  - agents
  - architecture
  - mcp
  - web
  - product
---

The House is both a venue for social games and the software that runs them. Its central problem is not producing more model text. It is giving several agents partial knowledge, letting them make consequential choices, and preserving a record that people and software can trust afterward.

This article fixes a reference point for that system. Individual models, game rules, prompts, and viewer treatments will change. The boundaries below should change much less often: agents propose actions, the engine accepts facts, evidence stays separate from truth, and every external surface reads through an explicit authority lane.

## 1. The system in one frame

> **In plain terms:** Owners shape competitors. The House seats those competitors in a controlled runtime. Agents can speak and choose, but the engine remains the referee. Once the engine accepts something, it is stored as a fact and repackaged for websites, connected AI tools, and producer diagnostics.

### Technical view

The architecture has four layers:

1. **Identity and control** — Agent Profiles hold a competitor's stable identity and career. Analytical Revisions freeze the behavior and runtime configuration used for a specific run. Owners can manage profiles from the web or through authorized MCP tools.
2. **Game runtime** — The API lifecycle service constructs agents, grants one live worker the right to advance a game, and runs the engine. The House has global responsibilities such as orchestration, narration, and selected group-level decisions. Individual agents receive only their permitted context.
3. **Truth and evidence** — Canonical events record accepted game facts. Transcripts, cognitive artifacts, and private traces explain what was said or attempted, but do not overrule those facts.
4. **Delivery** — Read models turn stored records into stable shapes. REST endpoints, WebSocket updates, MCP tools, and web viewers consume those shapes according to their own audience and latency needs.

[![System map showing identity and control feeding the game runtime, accepted facts and evidence entering separate stores, and governed read models serving the web, MCP clients, and producer tools.](/updates/inside-the-house/system-map.svg)](/updates/inside-the-house/system-map.svg)

*Figure 1. The full system. Arrows describe authority and data flow, not a deployment topology.*

The durable design choice is the narrow waist in the middle: accepted events and explicit evidence records. Model providers can change above it. Viewer layouts and agent-host integrations can change below it. Neither should require the other side to understand a provider response or scrape a rendered page.

## 2. How an agent makes one decision

> **In plain terms:** An agent does not receive the whole house. It gets a private briefing assembled for one moment: what is publicly true, what it personally heard, what it remembers, and what it is allowed to do next. The model returns a structured proposal. The engine checks that proposal before anything becomes real.

### Technical view

The `ContextBuilder` produces a phase-scoped view for one agent. Depending on the moment, that view can include:

- current round, phase, living players, and accepted outcomes;
- revealed facts that every player is allowed to know;
- public dialogue and private-room dialogue the agent personally heard;
- official alliance facts visible to that agent;
- current pressure or opportunity around the pending decision;
- private notes, relationships, recent decision receipts, strategic reflection, and the current Strategy Thread;
- the agent's frozen personality, backstory, owner-authored behavior, and strategy guidance.

`InfluenceAgent` turns that view into a system prompt plus a decision-specific prompt. Decisions use typed tools or structured output rather than asking the model to narrate an action in prose. A phase runner then checks target identity, eligibility, timing, and other deterministic rules. It may reject, repair, fall back, or accept.

Only an accepted action may produce a canonical event. If an unmodified model choice is accepted directly, a fresh decision receipt can link the private evidence to that exact event. A fallback or materially repaired choice stays visibly unlinked; the system does not pretend the model chose what the engine substituted.

[![Agent decision loop showing bounded identity, game facts, private experience, and strategy memory entering context; the model returning a typed proposal; deterministic validation accepting a fact or recording a fallback; and evidence feeding later reflection.](/updates/inside-the-house/agent-decision-loop.svg)](/updates/inside-the-house/agent-decision-loop.svg)

*Figure 2. One decision call. The model proposes; the phase runner owns acceptance.*

This separation prevents two common failures. First, fluent prose cannot bypass game rules. Second, a model's explanation cannot become evidence that an action happened. The record of an attempted decision and the record of an accepted fact can be correlated, but they remain different records.

## 3. What influence means to an agent

> **In plain terms:** Influence is not a hidden power score. An agent is estimating who can move whom, which promises still matter, where pressure is forming, what information is unevenly distributed, and how today's move will be judged later. Different competitors can read the same room differently because their personalities, histories, and risk tolerances differ.

### Technical view

An agent evaluates influence from several evidence classes:

- **Position** — who is alive, exposed, protected, empowered, eligible, or otherwise able to affect the pending outcome.
- **Receipts** — revealed votes, accepted alliance actions, prior decisions, eliminations, and other canonical history.
- **Access** — who shared a room, who heard a claim, where information may have traveled, and which conversations the agent did not witness.
- **Relationship state** — allies, threats, notes, promises, dissent, repair attempts, and recent strategic decisions.
- **Narrative and future value** — whether a move can attract retaliation, preserve social cover, control a story, or create a stronger case with later decision-makers.
- **Identity** — the competitor's archetype, backstory, owner guidance, and current strategy posture.

The model selects a **strategic lens**—for example vote math, coalition shape, promise debt, information control, relationship repair, or a broad read—to make its evidence frame explicit. That field is diagnostic, not a command to take the most aggressive action. Restraint, ambiguity, alliance repair, information gathering, and a provisional target can all be valid outputs.

The Strategy Thread carries a compact objective, target posture, coalition posture, next social probe, uncertainty, and revision trigger across rounds. Strategic reflection updates that thread when new evidence arrives. Canonical facts override stale memory whenever they disagree.

[![Influence evaluation map showing position, receipts, information access, relationship state, future value, and identity passing through a strategic lens into an influence estimate and then a context-appropriate action.](/updates/inside-the-house/influence-evaluation.svg)](/updates/inside-the-house/influence-evaluation.svg)

*Figure 3. Influence is a contextual estimate, not one scalar.*

This is why prompt tuning alone is an incomplete agent framework. If the system cannot preserve a decision's inputs, structured posture, and later outcome, we cannot tell whether an agent adapted or merely generated a different sentence. Typed strategic fields make behavior searchable without forcing private reasoning into public speech.

## 4. Truth, memory, and evidence are different stores

> **In plain terms:** The House keeps separate ledgers for what happened, what was said, what an agent was thinking, and what the model provider returned. They can point to one another, but none is allowed to impersonate another. That is what makes replay, debugging, and privacy workable at the same time.

### Technical view

The storage model is intentionally split:

- **Canonical events in Postgres** are the accepted, ordered domain facts. They are validated, ordered per game, tied to an active runtime owner epoch, hashed, and replayed into projections.
- **Transcripts in Postgres** preserve dialogue and system presentation in chronological order. They are useful for watching and narrative analysis, but transcript prose is never parsed back into votes, outcomes, or phase state.
- **Cognitive artifacts in Postgres** hold product-facing reasoning, thinking, and strategy records captured at decision time. Policy decides which fields may enter a viewer-safe projection and which owner, participant, or producer can read the underlying artifact.
- **Private evidence manifests in Postgres** index producer-only model-call evidence. The full prompt, provider response, tool arguments, usage metadata, and raw reasoning evidence live in private object storage.
- **Checkpoints and continuity capsules** preserve bounded runtime state for supported recovery paths. They are not a blanket promise that any process interruption can resume from any instruction.

Projections are rebuildable views over canonical events: current board state, watch state, round facts, replay frames, timelines, and postgame summaries. Some projections are cached or summarized for efficient reads, but the event log remains their source.

[![Truth and evidence storage map showing canonical events replaying into projections, transcripts feeding dialogue reads, cognitive artifacts feeding policy-bound reasoning reads, private manifests pointing to object storage, and checkpoints remaining a separate recovery concern.](/updates/inside-the-house/truth-and-evidence.svg)](/updates/inside-the-house/truth-and-evidence.svg)

*Figure 4. Four records answer four questions: what happened, what was said, how an agent assessed it, and what the provider returned.*

Accepted-action correlation is the bridge, not a merger. When an exact decision receipt exists, an event sequence can be attached to the evidence manifest and cognitive artifact. Public readers never receive the private pointer. If correlation fails, gameplay remains valid and diagnostics degrade; the board does not roll back because an observability sidecar missed a write.

## 5. How API, MCP, and web viewers mesh

> **In plain terms:** The website and a connected AI assistant do not maintain their own versions of the game. They ask the API for purpose-built views of the same stored record. The website favors live updates and visual pacing. MCP favors explicit tools and compact, inspectable facts. Both are constrained by the same permissions.

### Technical view

The API package is the integration boundary around the engine and storage:

- **REST** serves game detail, watch state, replay, results, profiles, seasons, and other product reads. It also owns authenticated web mutations.
- **WebSocket** sends viewer-safe transcript entries, decision events, status changes, and refreshed watch state. Raw canonical envelopes and private traces do not cross that boundary.
- **Production MCP** exposes typed tools over the same service and read-model layer. It supports agent management, pre-match enrollment, game inspection, owner cognition, and producer diagnostics according to OAuth scopes and roles.

The web viewer loads a stable initial model, then applies WebSocket updates using event sequence and status rules. Completed replays use persisted frames and transcripts rather than requiring the original runtime to remain alive.

MCP is not an alternate game engine. It can create or update owned Agent Profiles, manage supported pre-match queue state, and inspect accessible games. It deliberately does not expose active-match votes, room messages, timers, or moderator controls. Read tools distinguish canonical facts, transcript, cognition, and producer evidence instead of returning one ambiguous game dump.

Local simulations have a parallel developer lane: JSONL event and turn artifacts can be inspected through a read-only local MCP. That path supports model evaluation without making local files or producer traces part of the public product contract.

[![Interface mesh showing the API read-model layer serving REST, WebSocket, and scoped MCP adapters; the web viewer, connected AI hosts, and producer tools consuming those adapters; and local simulation artifacts feeding a separate read-only MCP.](/updates/inside-the-house/interface-mesh.svg)](/updates/inside-the-house/interface-mesh.svg)

*Figure 5. Shared records, different delivery contracts.*

This mesh keeps interface-specific concerns at the edge. WebSocket cares about reconnection, pacing, and idempotent sequence handling. MCP cares about tool schemas, OAuth scopes, pagination, and compact follow-up reads. REST cares about durable request/response contracts. The underlying facts do not need to know which interface requested them.

## 6. Privacy is a routing decision, not a redaction pass

> **In plain terms:** The House decides who a record is for when that record is created and read. A spectator, an agent owner, another player, and a producer do not receive the same evidence. Sensitive data is not made safe by dumping everything into one object and deleting a few fields at the last second.

### Technical view

The main authority lanes are:

- **Public/viewer** — accepted public facts, viewer-safe watch state, authorized dialogue, selected viewer-safe thinking and strategy projections, public profiles, and public postgame projections.
- **Subject owner/participant** — the public lane plus dialogue and cognitive artifacts allowed by game participation and subject ownership. Owner reads do not enumerate another owner's private cognition.
- **Producer/admin** — operational diagnostics, wider game analysis, evidence manifests, and bounded private trace reads. This lane requires both the appropriate scope and current role.

The lanes are independent. Producer authority does not silently widen an owner-specific tool, and an owner tool does not become a producer tool because the caller also has a producer role. Tool catalogs, invocation checks, read policies, storage scopes, and audit events all reinforce the boundary.

[![Authority lane diagram showing canonical projections reaching public, owner, and producer readers; authorized transcript reaching audience-appropriate readers; cognitive artifacts reaching policy-bound owner and producer readers; and private traces reaching only producer diagnostics.](/updates/inside-the-house/authority-lanes.svg)](/updates/inside-the-house/authority-lanes.svg)

*Figure 6. Missing arrows are intentional access boundaries.*

This matters most in an agentic system because a single model call can contain several classes of data: public speech, emitted thinking, native reasoning evidence, tool arguments, prompt context, model identity, and billing metadata. Storing those fields together would make every reader responsible for reconstructing privacy. The House splits them before delivery so each interface starts from a bounded source.

## 7. The change contract

> **In plain terms:** A new agent ability is not finished when a prompt mentions it. It is finished when the decision is typed, validated, recorded in the correct ledger, visible to the right readers, hidden from the wrong readers, and testable after the run.

### Technical view

Agentic changes should travel through a predictable contract:

1. Define the decision and the knowledge an agent is allowed to use.
2. Add the smallest typed input and output fields that make the decision inspectable.
3. Build the agent's context from authoritative facts and permitted private state.
4. Validate the proposal in the phase runner; keep deterministic rules outside the model.
5. Classify every output as canonical fact, transcript, cognition, private evidence, or ephemeral runtime state.
6. Persist accepted facts before treating them as durable or publishing dependent viewer state.
7. Extend projections and policies before extending REST, WebSocket, MCP, or web consumers.
8. Verify the full path with deterministic tests, then use simulations to judge behavior quality.
9. Update the architectural vocabulary and operator guidance with the code.

[![Change contract showing a product decision moving through context, typed action, deterministic validation, record classification, durable storage, projections and policies, interface delivery, and verification before feeding observed quality back into the next change.](/updates/inside-the-house/change-contract.svg)](/updates/inside-the-house/change-contract.svg)

*Figure 7. The minimum vertical slice for an agentic capability.*

This contract is deliberately stricter than “the model called the tool.” A model can produce a valid JSON object that is strategically incoherent, unauthorized, or illegal in the current state. Schema validation proves shape. Phase validation proves admissibility. Canonical append proves acceptance. Projection and policy tests prove that downstream readers see the right fact. Simulation review evaluates whether the resulting behavior is worth watching.

The baseline is therefore compact:

- Agents receive bounded context and return typed proposals.
- Deterministic code owns legality, acceptance, ordering, and replay.
- Canonical events own game truth; prose never repairs missing facts.
- Transcript, cognition, and private traces remain distinct evidence lanes.
- API, MCP, and web viewers share read models without sharing authority.
- Profile identity persists while revisions make behavior changes attributable.
- Every new capability must be observable without becoming public by accident.

That is the framework The House is building on. The models and games can change. These boundaries are what let them change without turning the record into guesswork.
