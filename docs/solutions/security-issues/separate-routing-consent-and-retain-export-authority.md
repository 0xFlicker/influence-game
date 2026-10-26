---
module: Production MCP and Studio
date: 2026-10-25
problem_type: security_issue
component: authorization
symptoms:
  - Read-only producer tokens could change waiting-game routing
  - Accepted delivery annotations disappeared at durable turn boundaries
  - Source preview preferences changed selected export audio
root_cause: authority_boundary
resolution_type: code_fix
tags: [mcp, oauth, audio, studio, durable-turns, storage]
---

`producer` consent authorizes inspection. `producer:edit` authorizes moment tags.
Routing changes now require separate optional `producer:routing` consent and the
existing current admin/sysop and waiting-game checks. Migration 0139 expands only
the canonical scope constraints; it does not rewrite existing token grants.

Durable Influence audio joins the accepted provider attempt's stable decision ID
to transcript or canonical cognitive provenance. The final event watermark is a
visibility boundary shared by several contributions, not a decision identifier.
Only committed turns may supply annotations. These joins do not add fields to
historical source snapshots or rewrite saved audio recipes.

Studio prepares media for both preview and selected-cut moments. Source view and
its thinking preference affect playback only; generated and imported recordings
for the selected cut survive export regardless of the current preview view.

Storage inventory uses SQL column names, including `response_audio`. Its regression
now runs the inventory against the actual migrated database, in addition to the
synthetic old-storage cutover fixtures, so fixtures cannot reproduce a registry
typo and conceal it.

Provider-free regressions cover scope/role/client gates, equal-text contributions
from one actor sharing a watermark, uncommitted audio exclusion, audio schedule
parity across preview modes, and the migrated storage inventory. No deployed data
or historical accepted content was modified.
