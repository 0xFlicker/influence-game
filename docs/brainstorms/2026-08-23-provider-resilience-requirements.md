---
date: 2026-08-23
topic: provider-resilience
---

# Provider Resilience Requirements

## Summary

Influence will preserve actionable provider-failure evidence, replace synthetic failure dialogue with explicit outcomes and legal engine fallbacks, and execute each game against a configurable, game-sealed provider manifest. Provider failover keeps games moving without allowing a systemic outage to silently shift the Daily queue onto an expensive fallback.

---

## Problem Frame

Successful model calls already produce private decision traces, but a provider exception can occur before that trace is emitted. A rejected request can therefore fail or suspend a game without retaining the exact request, provider error, or request identifier needed to diagnose it.

Some failed or unusable calls are also converted into synthetic `[No response]` text. That hides the underlying failure and allows downstream systems to mistake fabricated text for player or House speech.

A game currently depends on one selected provider/model. Request-specific refusals can strand otherwise valid games even when another qualified provider could complete the same logical call. Unbounded fallback would create the opposite risk: a systemic primary-provider failure could silently move every game onto a materially more expensive provider.

---

## Key Decisions

- **Completion before diagnostics.** Failure evidence is important, but an evidence-storage failure never blocks provider failover or causes a game to fail.
- **Real actions, honest provenance.** A deterministic engine fallback is a real accepted gameplay action with normal canonical consequences. It is labeled as engine fallback and does not invent model-authored rationale.
- **Configurable manifests, sealed games.** Creators can edit the ordered provider/model list in the web UI and CLI. A game freezes that manifest when it starts so later default changes cannot alter its execution or recovery.
- **Request failures are not provider outages.** A request-specific refusal advances within that logical call and the next call starts at the primary again. Systemic provider failures use a circuit breaker.
- **Cost control is part of resilience.** Each fallback manifest entry has a per-game call budget, and systemic primary failure pauses new Daily games instead of silently transferring their full workload to an expensive fallback.

---

## Actors

- A1. **Game creator** — selects and orders the complete provider manifest in the web game-creation flow or CLI.
- A2. **Daily scheduler** — starts games with the configured default manifest only when admission and provider health permit it.
- A3. **Running game** — performs logical model calls, commits at most one accepted result per call, and uses legal engine fallbacks when provider execution is exhausted or disallowed.
- A4. **Admin or sysop** — inspects per-game provider failures, reviews provider health, and runs probe-backed breaker recovery from the admin panel.
- A5. **Developer/producer MCP caller** — reads provider evidence and breaker status without mutating breaker state.
- A6. **Player or public viewer** — receives only accepted gameplay output and never receives private provider evidence.

---

## Requirements

**Failure evidence**

- R1. Every non-rate-limit provider failure preserves the complete request body exactly as submitted, including system and user prompts, authorized context, reasoning settings, schemas, tools, provider/model selection, and request parameters.
- R2. The same evidence preserves the complete provider error response and relevant response headers exactly as received, including the provider request identifier, status, and timestamp.
- R3. Each failure is attached to its game, logical call, actor, round, phase, action, provider attempt, and recovery or terminal outcome.
- R4. Local simulations write the complete evidence into their run artifacts, while API-backed games retain it through the existing private gameplay-evidence authority.
- R5. Failure evidence has no automatic expiry or deletion behavior in this work.
- R6. Failure-evidence storage failure marks diagnostics degraded but never blocks a recoverable game, provider failover, or legal engine fallback.
- R7. Rate-limit responses are represented as aggregate counts by provider/model and recovered-versus-exhausted outcome rather than as a raw per-attempt evidence log.
- R8. If rate-limit retries are exhausted and become terminal for a logical call, the terminal reason and aggregate retry count remain inspectable.

**Admin and developer access**

- R9. A game with inspectable provider failures shows a dedicated action in the existing admin game list even when fallback allowed the game to complete.
- R10. Opening that action shows a chronological provider-failure panel with compact summaries and expandable exact request/response evidence.
- R11. The panel distinguishes recovered failures, terminal failures, provider transitions, degraded evidence capture, and aggregate rate-limit activity.
- R12. Admin and sysop users may access the web evidence panel and provider-health controls.
- R13. The producer/developer MCP may list and read the same provider evidence and may read breaker status.
- R14. MCP breaker access is read-only; provider probes and breaker reset remain admin/sysop web actions.
- R15. Public, player, subject-owner, transcript, and ordinary game-viewer surfaces never expose prompts, private context, raw responses, provider headers, request identifiers, or breaker diagnostics.
- R16. Provider credentials, authorization headers, and other authentication material are never persisted in evidence.

**Typed outcomes and engine fallbacks**

- R17. Provider refusal, rate limiting, provider service failure, transport timeout, authentication/configuration failure, cancellation, successful-but-empty output, malformed output, and undecodable structured output remain distinct typed outcomes.
- R18. No failed or absent model result is converted into `[No response]` or any other synthetic player or House dialogue.
- R19. Optional player speech or House narration may produce no message after provider execution is exhausted, without creating transcript or agent-authored state.
- R20. Every required gameplay decision has a deterministic, rules-legal engine fallback so provider exhaustion alone does not strand the game.
- R21. An accepted engine fallback commits through the normal canonical path, affects tallies and future decision history, and creates the ordinary strategic consequences of that action.
- R22. Engine-fallback provenance remains explicit and never fabricates model-authored rationale, thinking, or prose.
- R23. Simulation and API-backed gameplay apply the same typed outcomes and fallback semantics across player calls, House calls, ordinary speech, tools, and structured decisions.

**Provider manifest and failover**

- R24. Web, API, and CLI game creation accept the complete ordered manifest of models available through the existing OpenAI and Katana provider paths rather than a hard-coded waterfall.
- R25. Creators can add, remove, replace, and reorder manifest entries before launch.
- R26. The selected manifest, provider-specific compatible settings, and fallback-call budgets are sealed into the game before it starts and survive checkpoint recovery.
- R27. The Daily queue uses a configured default three-entry manifest: the current OpenAI primary, Katana `glm-5-2`, and Katana `grok-4-5`.
- R28. The exact `grok-4-5` and `glm-5-2` entries must retain game-ready compatibility with Influence speech, structured decisions, and tools. Daily qualification is based on those capabilities and current price; model speed is not an admission criterion.
- R29. Each logical call starts with the manifest primary unless that entry is circuit-open, incompatible with the call, or unavailable under the game's remaining budget.
- R30. A nonretryable request-specific refusal advances immediately to the next compatible entry without resending the unchanged request to the refusing provider.
- R31. Retryable rate-limit, service, and transport failures use a bounded same-provider retry policy before advancing when failover remains permitted.
- R32. Empty, malformed, or undecodable results advance only after their bounded same-provider repair or retry policy fails to produce a usable result.
- R33. Successful primary execution never contacts a fallback, and one logical call commits at most one accepted provider or engine result.
- R34. After request-specific fallback, the next logical call begins with the primary again unless a circuit breaker or game budget says otherwise.
- R35. Every provider attempt, transition, reason, usage, latency, and actual or estimated cost participates in one durable logical-call attempt chain and reconciled per-game accounting.
- R36. Recovery resumes the sealed manifest and attempt boundary and may retry an indeterminate remote attempt, while canonical fencing prevents duplicate accepted gameplay effects.

**Fallback budgets and provider circuit breaker**

- R37. Each fallback manifest entry has a configurable maximum call count per game.
- R38. When an entry exhausts its game budget, execution skips that entry and may continue through later compatible manifest entries with remaining budget; only after all permitted entries are exhausted or disallowed do required calls use legal engine fallbacks and optional calls produce no message.
- R39. Admin evidence shows fallback calls used, calls remaining, and actual or estimated spend without using delayed or variable billing as the V1 hard cutoff.
- R40. Request-specific policy refusals do not contribute to a provider-wide circuit breaker.
- R41. Authentication or configuration failure opens the affected provider breaker immediately, while repeated service or transport failure opens it after a bounded threshold.
- R42. An open primary-provider breaker pauses new Daily game admission instead of automatically shifting the Daily workload onto expensive fallbacks.
- R43. Running games do not fail when a systemic breaker opens; they omit optional speech and use engine fallbacks for required decisions when automatic cross-provider spending is disallowed.
- R44. Admin/sysop testing may still explicitly launch a game whose selected primary and manifest are healthy.
- R45. Authentication/configuration breakers remain open until an admin/sysop runs a successful provider probe after correcting the underlying problem.
- R46. Transient breakers automatically become half-open after a cooldown and admit one inexpensive health probe; an admin/sysop may request the same probe early.
- R47. A successful probe closes the breaker, while a failed probe leaves it open and records the new evidence.
- R48. No blind force-close action exists.
- R49. Breaker state and reasons survive process restart and remain visible to admin/sysop and read-only MCP inspection.

---

## Key Flows

- F1. **Request-specific refusal and recovery**
  - **Trigger:** A primary provider refuses one logical call.
  - **Actors:** A3, A4, A5.
  - **Steps:** Preserve full evidence; classify the refusal; advance to the next compatible manifest entry; validate and commit at most one result; expose the recovered attempt chain privately; begin the next call at the primary again.
  - **Outcome:** The game advances without hiding the refusal or permanently moving the game to an expensive provider.
  - **Covered by:** R1-R4, R9-R16, R24-R36.

- F2. **All providers exhausted**
  - **Trigger:** No permitted manifest entry yields a usable result.
  - **Actors:** A3, A4, A5, A6.
  - **Steps:** Preserve typed attempt outcomes; omit optional speech or execute the required legal engine fallback; commit fallback provenance and normal gameplay consequences; expose diagnostics privately.
  - **Outcome:** Provider exhaustion does not create fake dialogue or strand the game.
  - **Covered by:** R17-R23, R33-R39.

- F3. **Systemic primary-provider failure**
  - **Trigger:** Provider-wide failures open the circuit breaker.
  - **Actors:** A2, A3, A4, A5.
  - **Steps:** Pause new Daily admission; stop automatic expensive failover caused by the systemic failure; let running games use engine fallbacks; show breaker state and evidence; probe before reset.
  - **Outcome:** A credential or service incident does not become an uncontrolled fallback-spend event.
  - **Covered by:** R40-R49.

- F4. **Admin failure inspection**
  - **Trigger:** A game records one or more provider failures.
  - **Actors:** A4, A5.
  - **Steps:** Surface a game action and error count; open the chronological panel; inspect exact non-rate-limit evidence and aggregate rate-limit activity; read the same evidence through producer MCP when needed.
  - **Outcome:** An authorized operator can determine exactly why provider execution failed or recovered.
  - **Covered by:** R1-R16.

---

## Acceptance Examples

- AE1. **Request-specific refusal recovers. Covers R1-R4, R9-R16, R24-R36.** A primary call is refused, its exact request and provider error become privately inspectable, the next manifest entry succeeds once, and the next logical call tries the primary again.
- AE2. **Primary success is isolated. Covers R29-R35.** A primary call succeeds, no fallback provider is contacted, and accounting contains one accepted provider attempt.
- AE3. **Recovered rate limiting stays compact. Covers R7-R8, R11, R31, R35.** Several rate-limit retries recover; the admin view shows an aggregate count and recovered outcome without presenting a raw row for every retry.
- AE4. **Exhausted rate limiting is honest. Covers R7-R8, R17, R31.** Bounded retries exhaust; the terminal outcome and count remain visible, after which permitted failover or the engine fallback proceeds.
- AE5. **Evidence degradation is nonfatal. Covers R6.** Private evidence storage fails while a fallback provider is available; diagnostics are marked degraded and the game continues.
- AE6. **Optional speech is absent. Covers R17-R19, R23.** Every provider fails during an optional Mingle turn; no transcript message or synthetic dialogue is created and the phase continues.
- AE7. **Required vote falls back. Covers R20-R23, R33.** Every provider fails during a required vote; the engine selects a legal deterministic target, commits the vote normally, updates tally/history, and labels the decision as engine fallback without inventing rationale.
- AE8. **Systemic authentication failure is contained. Covers R41-R45, R48-R49.** A provider credential is invalid; its breaker opens immediately, new Daily games pause, running games remain live through engine behavior, and only a successful post-fix probe closes the breaker.
- AE9. **Transient outage recovers. Covers R41, R46-R47.** Repeated service failures open the breaker; after cooldown one probe succeeds, the breaker closes, and ordinary traffic resumes.
- AE10. **Fallback spending stops at each budget. Covers R37-R39.** A game uses all permitted calls on an expensive fallback entry; later calls skip that entry, may use a later compatible entry with remaining budget, and use omission or engine fallback only after every permitted entry is exhausted or disallowed.
- AE11. **Recovery accepts one effect. Covers R26, R33, R35-R36.** The process restarts during a provider attempt chain; an indeterminate remote request may be retried, but recovery neither repeats an accepted provider action nor commits a second fallback result.
- AE12. **Private evidence remains private. Covers R12-R16.** Admin/sysop web and producer MCP callers can inspect evidence, while public, player, and ordinary owner reads reveal none of it.

---

## Scope Boundaries

- Automatic evidence expiry, retention windows, deletion controls, and historical cleanup are deferred.
- New provider transports and a separate provider marketplace are out of scope. Existing OpenAI and Katana model access remains available for manually configured and test games; qualification governs unattended Daily defaults.
- Currency-denominated hard cutoffs are deferred; V1 uses per-game fallback-call counts and reports actual or estimated spend.
- External notifications for provider incidents are deferred; V1 surfaces state through the admin panel and MCP.
- Breaker reset through MCP is out of scope for V1.

---

## Dependencies and Assumptions

- Existing successful private decision traces remain the authority for successful-call evidence; this work closes the thrown-failure gap rather than replacing them.
- Existing provider accounting remains the source for actual or estimated per-attempt cost.
- Daily-default entries must declare enough capability information to prove they can execute each logical call before unattended admission or failover.
- The selected `glm-5-2` third entry must pass the same Influence contracts as the primary and secondary entries.

---

## Outstanding Questions

**Deferred to planning and qualification**

- What fallback-call budget should each default manifest entry receive?
- What failure threshold and cooldown should govern transient circuit breakers?
- What exact provider-backed acceptance evidence must be refreshed before changing either Daily fallback model?
- What compact summary fields and copy affordances best fit the existing admin game-action panel?

---

## Success Criteria

- A real provider refusal can be diagnosed from the admin panel and producer MCP without reproducing the game.
- No provider error is hidden behind fabricated player or House dialogue.
- Required gameplay always has a legal engine continuation, and optional speech can be absent safely.
- Provider fallback commits exactly one result, survives recovery, and reconciles attempts and cost.
- Systemic primary failure cannot silently shift the Daily queue onto an unbounded expensive fallback workload.

---

## Sources

- `docs/refactor-queue.md` — R27 failed-provider evidence, R28 typed no-response semantics, and R29 provider fallback manifest.
- `docs/ideation/2026-06-27-multi-model-provider-grok-router-ideation.md` — provider profiles, model qualification, Katana/Grok direction, and simulator parity.
- `packages/engine/src/agent.ts` — successful private decision trace boundary and current synthetic no-response behavior.
- `packages/engine/src/game-runner.types.ts` — private decision evidence and gameplay context vocabulary.
- `packages/api/src/services/game-lifecycle.ts` — API private trace persistence and degraded evidence behavior.
- `packages/api/src/services/private-trace-read-model.ts` — producer evidence retrieval authority.
- `packages/web/src/app/admin/admin-panel.tsx` and `packages/web/src/app/admin/games/game-history-browser.tsx` — existing per-game admin action and panel patterns.
