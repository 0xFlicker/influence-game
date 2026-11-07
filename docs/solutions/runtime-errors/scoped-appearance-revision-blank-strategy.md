---
module: Agent creation
tags: [guided-editor, appearance, optional-strategy, structured-output]
problem_type: runtime_error
date: 2026-11-07
---

# Appearance revision rejected an unchanged blank strategy

An older agent had no Werewolf strategy, which is valid saved content. Guided
Revise routed successfully, then sent an unscoped full-character generation
request. Its validator required nonempty game notes and rejected the preserved
blank block. Clearing image work was unrelated to that text validation failure.

Guided appearance revision now explicitly selects `visualDesign`. Both the API
and editor use `characterEditFields` to include missing character details
and preserve populated fields. The owner clarified that completing empty game
notes is welcome during character edits, so these are now explicitly selected
for completion rather than rejected or silently treated as populated notes.
Focused strategy-only edits remain isolated. The strict output validator remains
enforced. Newly filled performance
instructions are also used in the following image request.

Regression coverage includes the real API validator with mocked provider output,
the editor field selection and missing-detail application, and the browser path
Clear → Revise → queued image while completing blank Werewolf notes. Assistant failures also
return their request ID for Support references and matching API logs.
