---
title: Separate Visual Failure Policy from Operational Evidence
date: 2026-09-21
category: architecture-patterns
module: visual generation and game execution
problem_type: architecture_pattern
component: service_object
severity: high
tags: [visual-mode, durable-events, provider-attempts, repair, observability]
---

# Separate Visual Failure Policy from Operational Evidence

A successful game and a successful image request are separate outcomes. Treating every image failure as a suspended game prevents ordinary matches from finishing. Catching failures and retaining only console messages makes degraded games impossible to diagnose.

Use explicit product policies instead of ambiguous “fail open” terminology:

- **Best effort** is the default. Wait within the scene attempt timeout, permit one safe repair, then continue with portraits and canonical text context. Cues remain available, and future arrangements may render.
- **Require visuals** is opt-in. Preserve the committed cursor and pause when required references, media or agent annotations are unavailable. Admins inspect evidence, authorize repair and explicitly resume through ordinary worker adoption.

Both policies write the same durable evidence. Reserve paid calls before dispatch; commit receipt, output and completion event together. Retain provider error bodies and rejected verification output with bounded evidence size and explicit truncation. Separate successful composition from uncertain anchors. An unanchored viewer scene can be acceptable in Best effort while insufficient for Require visuals.

Operational records are immediately available from `visual_operation_events`, including during a pause. The next committed turn promotes pending IDs into producer-only `visual.operation_recorded` canonical events. These do not affect game rules, player context or public dialogue. This preserves the canonical turn writer's ownership of event sequence numbers.

A scene-wide repair allowance includes xAI fallback across sections. A missing transport response does not authorize another paid request. Manual repair needs an expected scene revision and resolved accounting uncertainty. Reverification reuses candidate pixels; regeneration creates a new revision. Old attempts and costs remain intact. Late receipts are retained even when their scene cannot be published.

Policy changes and resume are separate actions. Resume clears only a visual-owned pause and preserves the durable execution cursor; it cannot resume an unrelated suspension. Owner and arrangement fences remain mandatory in both modes.

See [Visual Mode operations](../../visual-mode.md) and [durable provider fallback authority](coordinate-provider-attempts-with-durable-fallback-authority.md).
