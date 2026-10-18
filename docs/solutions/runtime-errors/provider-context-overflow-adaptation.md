---
title: Adapt oversized provider requests under the existing decision journal
module: Provider execution
problem_type: runtime_error
date: 2026-10-18
tags: [context-size, compaction, provider-journal, recovery]
---

Provider context-limit responses previously became generic nonretryable request errors. A fallback could receive the same oversized input. Removing application byte gates does not resolve this provider failure.

The shared invocation path now classifies context overflow and compacts builder-marked historical context. Mechanical action fields remain exact. Strict summary results have separate child-call identities, inherit parent authorization, and use the existing private accepted-value storage. They cannot accept a game decision. Attempt metadata retains source identity and revision so restart skips known rejected requests and reuses accepted summaries.

Keep compaction bounded and route exhaustion through existing phase behavior. Explicit retrospective recovery reopens its existing retry generation, retaining the latest context revision and accepted summaries. Do not add a separate suspension mechanism or claim to recognize every strategically necessary fact.

Deterministic tests cover large Unicode sources, actual game/House builders, chunk splitting, restart, fallback, source drift, object references and owner fencing. They establish execution and mechanical invariants; hosted-model fidelity and deployment need separate evidence. See [the runtime contract](../../context-adaptation.md) for limits and the invocation inventory.
