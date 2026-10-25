---
title: Influence decision speech without changing ballot authority
module: Influence engine and playback
date: 2026-10-24
problem_type: design_pattern
component: decision contracts and transcript presentation
tags: [influence, ballots, sealed-voting, thinking, playback]
---

Keep public delivery separate from the fields that decide the game. The shared decision-speech policy adds a required, bounded message to exact decision schemas and removes structured thinking from ballots, format choices and tiebreaks. Nominations, vetoes, replacements and Safety Bounce keep private thinking; nominee pleas already have it. Native provider reasoning remains saved evidence.

Persist accepted speech through the existing transcript storage, with small typed action/actor coordinates. For classic receipt playback, link speech to its exact receipt entry sequence: searching for the next message from the same voter can accidentally borrow a later revote after an engine fallback. Do not infer targets or outcomes from the message.

Collect sealed decisions against the same frontier concurrently, then commit in roster order. Never append ballot speech to contestant public dialogue during collection. Playback joins it to the existing canonical ballot reveal; other announcements use solo full-body/avatar scenes. Engine fallback choices have no invented contestant speech.

Tests cover blank/oversized/extra-field output, prohibited vote thinking, parallel collection before any commit, preserved private evidence, a complete mock game, nominee plea thinking, exact receipt association, one reveal per ballot, and full-body/avatar background selection. Transcript persistence and public/MCP DTOs carry the same metadata.
