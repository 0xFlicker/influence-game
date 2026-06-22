---
date: 2026-06-21
topic: public-boundary-hardening-session
---

# Public Boundary Hardening Session Requirements

## Summary

A focused public-boundary hardening slice should make websocket transcript broadcasts construct viewer-safe message payloads from allowed fields instead of broad internal records with late redaction. The slice should preserve intended viewer content while blocking hidden reasoning, private trace, and producer evidence from crossing the public watch boundary.

---

## Problem Frame

Influence's watch and replay direction depends on public-by-URL viewing that remains useful without exposing producer/debug evidence. The current boundary is already documented and partly tested, but websocket transcript messages still begin from the internal `TranscriptEntry` shape and remove a private field afterward.

This makes the boundary harder to maintain as watch, replay, MCP, and cognitive-artifact surfaces grow. The refactor should pay down that construction debt without changing which information the product is allowed to show.

---

## Key Decisions

- **Websocket first.** The first hardening pass targets transcript broadcasts because they are the clearest broad-object-to-public-payload seam.
- **Allowed-field construction.** Public message payloads should be assembled from the fields the viewer contract allows, rather than copied from internal records and redacted later.
- **Preserve public legibility.** This is not a blanket removal of `thinking`; viewer-safe thinking or strategy remains allowed where current product contracts expect it.
- **Sentinel tests support the refactor.** Shared privacy assertions should guard the boundary, but the core change is construction style rather than test-only leak detection.

---

## Actors

- A1. Public watcher viewing a live or replayed game by URL.
- A2. Websocket transcript broadcaster that turns engine stream events into public display messages.
- A3. Engine transcript producer that may carry internal observability fields.
- A4. Maintainer extending watch, replay, MCP, or cognitive-artifact surfaces after this slice.

---

## Requirements

**Public Transcript Payload**

- R1. Websocket transcript broadcasts must expose a public message payload whose fields are selected for the viewer contract.
- R2. The public message payload must preserve visible transcript content needed for live watch and replay display.
- R3. The public message payload must preserve viewer-safe `thinking` or thinking-scope transcript entries when the existing watch contract allows them.
- R4. The public message payload must not expose `reasoningContext`, private trace content or metadata, source pointers, raw provider payloads, prompts, responses, storage keys, decision logs, or producer-only evidence.
- R5. Internal agent-turn observability records must remain absent from public websocket broadcasts.

**Boundary Tests**

- R6. Tests must prove public transcript payloads include allowed viewer fields and exclude hidden reasoning/evidence fields.
- R7. Tests must include a case where `thinking` survives while `reasoningContext` is excluded.
- R8. Tests must include a thinking-scope transcript entry so privacy hardening does not accidentally remove watchable strategy context.
- R9. A reusable privacy sentinel may be introduced when it reduces duplication across public payload tests without forcing an API-wide DTO package.

**Adjacent Surface Guardrails**

- R10. The slice must not change the public-by-URL watch access model.
- R11. The slice must not weaken existing `scope=games`, producer MCP, or cognitive-artifact authorization rules.
- R12. If one non-websocket sentinel example is included, it must validate the same public/private field split without expanding the refactor to every public API surface.
- R13. Documentation touched by the work must keep the distinction between viewer-safe `thinking`/`strategy` and private `reasoningContext`/producer evidence clear.

---

## Key Flow

- F1. Transcript event becomes public websocket message
  - **Trigger:** The engine emits a transcript entry for a watched game.
  - **Actors:** A1, A2, A3
  - **Steps:** The broadcaster receives the internal transcript entry, builds a public message payload from allowed viewer fields, and publishes the message to game observers.
  - **Outcome:** The watcher sees the intended transcript display without hidden reasoning or producer evidence.
  - **Covered by:** R1-R5

---

## Acceptance Examples

- AE1. **Covers R1-R4, R6-R8.**
  - **Given:** A transcript entry includes normal message text, viewer-safe `thinking`, and `reasoningContext`.
  - **When:** The websocket broadcaster publishes the public message.
  - **Then:** The message contains the display text and allowed `thinking`, and it does not contain `reasoningContext`.

- AE2. **Covers R3, R4, R8.**
  - **Given:** A transcript entry uses the thinking display scope and includes private reasoning evidence.
  - **When:** The websocket broadcaster publishes the public message.
  - **Then:** The thinking display entry remains visible, and private reasoning evidence remains absent.

- AE3. **Covers R4, R5.**
  - **Given:** An internal agent-turn record includes decision evidence, private reasoning, or producer-only fields.
  - **When:** Public websocket broadcast handling receives the event.
  - **Then:** No public message is published for that internal observability record.

- AE4. **Covers R9, R12.**
  - **Given:** A reusable privacy sentinel is applied to a second public response path.
  - **When:** The response is serialized for a user-facing caller.
  - **Then:** The sentinel proves hidden reasoning/evidence fields are absent without changing that surface's authorization policy.

---

## Success Criteria

- Public transcript broadcasts are constructed from an explicit viewer-safe field set.
- Existing watch/replay behavior that shows useful viewer-facing thinking or strategy does not regress.
- Hidden reasoning, private trace evidence, and producer-only internals are covered by focused sentinel tests.
- The resulting plan can stay narrow instead of becoming an API-wide DTO refactor.

---

## Scope Boundaries

In scope:

- Websocket transcript message payload construction for public watch/replay display.
- Focused privacy sentinel coverage for websocket transcript messages.
- One small non-websocket sentinel example only if it clarifies the reusable boundary and stays cheap.
- Documentation updates needed to keep the public/private reasoning boundary accurate.

Out of scope:

- A full public DTO package across every API route.
- Reworking Games MCP, producer MCP, or cognitive-artifact authorization policy.
- Removing viewer-safe `thinking` or strategy context from surfaces where it is intentionally public to viewers or participants.
- Changing basic watch access from public-by-URL to subject-scoped auth.
- Redesigning MatchWatchShell, replay theaters, or watch-intelligence product behavior.

---

## Dependencies / Assumptions

- The current product contract continues to treat basic game watching as public-by-URL.
- Viewer-safe `thinking` and whitelisted `strategy` remain distinct from private `reasoningContext` and producer evidence.
- `GameWatchState` remains the example of selected-field public read-model construction for shell-level facts.
- Planning will choose the exact type names, helper boundaries, and test utility shape.

---

## Sources / Research

- `docs/ideation/2026-06-21-refactoring-session-comments-todos-research-ideation.html`
- `docs/reasoning-transcript-observability.md`
- `docs/game-mcp-production-oauth.md`
- `docs/brainstorms/2026-06-20-game-watch-state-requirements.md`
- `CONCEPTS.md`
- `packages/api/src/services/ws-manager.ts`
- `packages/api/src/services/game-watch-state.ts`
- `packages/api/src/__tests__/websocket.test.ts`
- `packages/api/src/__tests__/game-watch-state.test.ts`
- `packages/api/src/game-mcp/read-model.ts`
- `packages/api/src/services/cognitive-artifact-policy.ts`
