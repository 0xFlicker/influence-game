---
title: Named Alliances Rules Page Content - Plan
type: docs
date: 2026-07-02
topic: named-alliances-rules-page
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: knowledge-work
product_contract_source: ce-brainstorm
origin: docs/plans/2026-07-02-002-feat-named-alliances-rules-plan.md
---

# Named Alliances Rules Page Content - Plan

## Goal Capsule

- **Objective:** Update the durable rules-page content with concise named-alliance rules for players and agent-facing implementation consumers.
- **Authority hierarchy:** The Gameplay Rules Contract in `docs/plans/2026-07-02-002-feat-named-alliances-rules-plan.md` is the source of truth, followed by the user's July 2 decisions, then current `docs/rules-page-content.md` tone and structure.
- **Execution profile:** Knowledge-work documentation update only. Do not implement engine phases, prompts, schemas, UI, API, MCP, or simulation behavior in this slice.
- **Stop condition:** If a change would alter v1 gameplay rules rather than explain them, update the Gameplay Rules Contract or return to brainstorming before editing reader-facing rules.

---

## Product Contract

### Summary

This plan turns the named-alliance Gameplay Rules Contract into a concise rules-page update. The output should explain the new pre-endgame round cadence, named alliance formation, House-scheduled huddles, lifecycle limits, and visibility rules without drifting into implementation design.

### Problem Frame

`docs/rules-page-content.md` still describes the pre-alliance six-phase round shape. The named-alliance rules add a vote-facing Mingle I before Vote, House-scheduled huddles before Vote and before Council, and a separate post-vote Mingle fallout window. The project needs one compact human-readable rules artifact before the next brainstorm, planning, and work session designs the actual engine, prompt, context, and UI changes.

### Requirements

**Reader-facing rules**

- R1. The standard round description must reflect the v1 full-drama cadence: Lobby, Mingle I, pre-vote alliance huddles, public Vote, post-vote Mingle, Power/Reveal, pre-Council alliance huddles, and Council.
- R2. The named-alliance section must explain that alliances are non-binding, player-confirmed social pacts created or mutated during Mingle I by proposal, counter, consent, decline, trial, expiry, or deferral.
- R3. The huddle section must explain that The House may schedule scarce huddle sessions for active alliances, with pass-wise ordering, one speaking opportunity per live member per huddle session, and no promise that every active alliance meets.
- R4. Lifecycle rules must include multiple alliance membership, failed/closed proposal memory for participants, automatic archive below two live members, and universal-alliance closure before huddle eligibility.
- R5. Visibility rules must state that votes remain public; hidden alliance membership, terms, and huddle outcomes are not public live knowledge unless players reveal them through gameplay; House grant/skip rationale is internal audit material.

**Agent-facing rule contract**

- R6. The content must give implementation consumers a concise list of legal player actions and illegal/non-v1 actions so prompts and future code do not invent alliance powers.
- R7. The content must state the context each agent is entitled to receive: their active alliance roster, terms, status, huddle outcomes, and failed or closed proposals they participated in.
- R8. The content must distinguish named alliances from House alliance hypotheses, derived vote cohorts, sidecar UI ideas, MCP surfaces, and always-on private chat.

**Implementation handoff**

- R9. The content must include a short handoff section for the next brainstorm -> planning -> work session that names the next implementation questions without reopening v1 rules.
- R10. Future-work items already parked in `docs/refactor-queue.md` must stay out of the v1 reader-facing rules except as non-v1 notes where needed for clarity.

### Scope Boundaries

#### In Scope

- Updating `docs/rules-page-content.md`.
- Tightening the Gameplay Rules Contract only where document review found contradictions or rule loopholes.
- Updating `docs/refactor-queue.md` for future rules or token-work items surfaced by review.

#### Deferred to Follow-Up Work

- Engine phase implementation, prompts, persistence, transcript events, huddle scheduling code, UI sidecar/inspector design, MCP/API rules surfaces, and simulation battle testing.
- Actual website page and MCP rules catalog synchronization unless a later implementation plan includes them.
- Token optimization, huddle-seat caps, alliance membership caps, post-vote status mutation windows, delayed huddle reveal/recap rules, and private or alliance-aware vote reveals.

### Acceptance Examples

- AE1. Given a reader asks when alliances form, when they read the rules-page content, then they learn Mingle I is the only v1 formation/mutation window.
- AE2. Given an agent belongs to two alliances selected for huddles, when the rules are read, then overlap is legal and the player may speak in both scheduled alliances.
- AE3. Given an all-alive alliance exists or forms, when the next huddle window is approaching, then the rules say it closes before huddle eligibility.
- AE4. Given an implementer asks whether House rationale is player-facing, when they read the rules-page content, then they see rationale is internal audit material during live play.
- AE5. Given the next implementation session starts, when the handoff is read, then it points to representation, prompt/context packaging, UI, scheduling, and simulation proof as implementation questions rather than unresolved gameplay rules.

---

## Planning Contract

### Key Technical Decisions

- **Rules-page content is a derivative, not a new rule source.** The docs update should explain the Gameplay Rules Contract; any gameplay contradiction must be fixed upstream in the contract first.
- **Separate player-facing prose from agent-facing constraints.** The reader should get watchable rules first, while implementers get a compact legal-action/context checklist afterward.
- **Keep future rules parked.** Review raised useful ideas around post-vote fracture, huddle-seat budgets, and delayed reveals, but v1 keeps those in `docs/refactor-queue.md`.
- **Do not sync live code surfaces in this slice.** The actual web page and MCP rules catalog can be updated in the next implementation session once the rules text is agreed.

### Product Contract Preservation

The source Gameplay Rules Contract was changed only to resolve review-proven contradictions and loopholes: House rationale is audit-only, all-alive alliances cannot become huddle-eligible, proposer membership is explicit, counter-cap resolution is explicit, huddle outcomes cannot mutate alliance terms, and the new Mingle I window is called out as intentional.

---

## Implementation Units

### U1. Patch the Gameplay Rules Contract

- **Goal:** Resolve document-review findings that would make downstream planning ambiguous.
- **Requirements:** R1, R2, R3, R4, R5, R10.
- **Dependencies:** None.
- **Files:** `docs/plans/2026-07-02-002-feat-named-alliances-rules-plan.md`, `docs/refactor-queue.md`.
- **Approach:** Apply only rules-contract clarifications that preserve v1 scope. Park review findings that would expand v1 into follow-up queue items.
- **Test scenarios:** Verify direct text coverage for House rationale visibility, universal-alliance closure before huddle eligibility, proposer consent, counter-cap expiry, and Mingle I as a new pre-vote window.
- **Verification:** The contract has no reader-facing contradiction between requirements, key flows, and acceptance examples.

### U2. Rewrite the Rules Page Content

- **Goal:** Make `docs/rules-page-content.md` accurately explain named-alliance gameplay to players and readers.
- **Requirements:** R1, R2, R3, R4, R5, AE1, AE2, AE3, AE4.
- **Dependencies:** U1.
- **Files:** `docs/rules-page-content.md`.
- **Approach:** Preserve the existing plain-language rules-page tone, update the standard-round cadence, add a named-alliance section, and keep hidden information boundaries clear.
- **Test scenarios:** Verify the document no longer says each standard round has six main phases; verify it includes Mingle I, pre-vote huddles, post-vote Mingle, pre-Council huddles, public votes, and universal-alliance closure.
- **Verification:** A reader can answer when alliances form, when huddles happen, who sees alliance facts, and what remains public.

### U3. Add Agent-Facing and Handoff Guidance

- **Goal:** Give future implementation work a concise rules checklist without embedding implementation architecture.
- **Requirements:** R6, R7, R8, R9, R10, AE5.
- **Dependencies:** U1, U2.
- **Files:** `docs/rules-page-content.md`.
- **Approach:** Add an agent-facing rules contract and a next-session handoff that names implementation questions: representation, scheduling, prompt/context packaging, in-match/internal read surfaces, and simulation battle testing.
- **Test scenarios:** Verify the handoff does not prescribe storage, schemas, API, prompt, UI, or MCP design as rules. Verify it names future/refactor-queue work as non-v1.
- **Verification:** The next brainstorm -> planning -> work session can start from the rules without re-litigating the v1 gameplay contract.

---

## Verification Contract

- `git diff --check` passes for the edited markdown files.
- Targeted text checks confirm `docs/rules-page-content.md` contains `Mingle I`, `Pre-Vote Alliance Huddles`, `Post-vote Mingle`, `Pre-Council Alliance Huddles`, `Named Alliances`, and `Agent-Facing Rules Contract`.
- Targeted text checks confirm `docs/rules-page-content.md` does not retain the stale phrase `six main phases`.
- A reviewer pass finds no remaining rule contradiction that blocks using the content as a handoff artifact.

---

## Definition of Done

- `docs/rules-page-content.md` contains concise player-facing named-alliance rules and agent-facing legal/context guidance.
- The Gameplay Rules Contract reflects the document-review fixes without adding deferred v1 scope.
- Future work raised by review is parked in `docs/refactor-queue.md`.
- Verification commands pass or any skipped check is explicitly explained.
