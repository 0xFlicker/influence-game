---
title: Keep Live Replay Observation Active During Suspension
date: 2026-09-22
category: architecture-patterns
module: live replay and visual presentation
problem_type: integration_issue
component: full_stack
severity: high
tags: [visual-mode, replay, publications, suspension, speech-bubbles]
---

# Keep Live Replay Observation Active During Suspension

In `odd-lime-vine`, a fresh watch page could scrub through structured voting and format results but skipped conversational scenes. Generated room images and accepted dialogue existed in storage.

Three independent omissions combined:

1. The watch page enabled the publication socket only while the game was `in_progress`. A suspended game hydrated canonical replay frames without the dialogue publications needed for lobby and Mingle presentation.
2. The publication materializer knew how to serialize `safeContext.visualScene`, but its database projection omitted `safeContext`. Restoring the socket therefore restored speech without its generated scene binding. Ballot, farewell and anonymous presentation metadata were also omitted.
3. Seeking while playback was paused left the bubble at time zero, where fade-in opacity was zero. The clock correctly stayed paused, but speech was invisible.

The observer connection now stays active across `in_progress` and `suspended`, retaining its publication cursor through pause/resume. It cannot execute gameplay. Materialization explicitly selects safe context and emits only public presentation fields, preserving the existing publication sequence and release schedule. No transcript parsing or historical data rewriting is necessary.

Paused presentation shows the initial bubble at its readable fade position without advancing the director clock. Expired bubbles remain expired; normal playback keeps its timed animation.

Regression coverage exercises suspended hook mounting and resume, metadata materialization from PostgreSQL, and readable paused scene/portrait beats. Browser verification must include a fresh join to a suspended game, forward and backward scrubbing, generated lobby and Mingle images, and room pinning. A provider-free game that starts mounted and never suspends cannot prove this path.

See [Visual Mode operations](../../visual-mode.md).
