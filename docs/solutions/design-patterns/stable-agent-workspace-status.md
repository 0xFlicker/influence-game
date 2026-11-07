---
module: Agent workspace
problem_type: design_pattern
tags: [layout-stability, asynchronous-operations, draft-recovery, moderation]
date: 2026-11-07
---

# Keep asynchronous agent status outside the editing layout

The editor inserted generation rows, recovery prompts and moderation banners in
separate asynchronous passes. A vertical reveal animation added another visible
movement. Management also used unordered SQL and variable review hint heights,
so publishing a revision could move its card and the rows below it.

Use one reserved editor footer. Details and recovery decisions open above it;
Resume stays a direct action. On mobile reserve content space for the fixed footer
and safe area. Keep artwork/candidate preview geometry and field feedback slots
stable. Status changes may fade but never translate the editor.

Management uses an Activity dialog without reserving a sidebar. Order owned
profiles by creation time descending, then ID ascending. Overlay status and
metadata badges on a fixed-height picture, with only the action row below it.
Let the name take its own grid row above the image so wrapping cannot cover the
face. Removing a status badge never changes card geometry. Never move an agent
because its status or update timestamp changed. Keep navigation restoration tied
to the agent ID.

Browser regressions compare heading, tabs, composer, preferences and footer bounds
through delayed activity and account draft reads, including Guided/Advanced create
and edit at desktop, short desktop and mobile sizes. A real reviewed publication
must leave gallery order and card positions unchanged.
