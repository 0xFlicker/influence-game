---
module: Werewolf discovery
tags: [werewolf, discovery, model-routing, localhost]
problem_type: runtime_error
date: 2026-11-02
---

# One incomplete probe row broke the combined Games page

Local `/games` displayed “Werewolf request failed. Try again.” Four panorama-probe
rows had only visual settings, without a provider manifest or model selection.
The Werewolf list mapped every row through strict model-label resolution; one
exception returned HTTP 500. The combined browser request then hid both game lists.

Match the Influence list's per-row isolation: retain strict model resolution,
warn with the affected game ID, and exclude malformed rows from public discovery.
Do not invent a model, update stored configurations, hide/delete the probe records,
or loosen creation/start contracts. Game history and rendering remain unchanged.

The localhost endpoint now returns HTTP 200 with 30 valid Werewolf games, and the
actual Chrome Games page shows both shelves again. A PostgreSQL regression mixes
valid lobbies with missing and invalid model configurations, checks the complete
valid result and no-store header, and verifies the original rows are unchanged.
Werewolf route/lobby/admin checks and all-package typecheck/lint validate the fix.

## Admin discovery

The separate Influence admin list had the same unhandled model-label exception
for seven local panorama-probe rows. Admin discovery now retains those records
with an explicit **Invalid model configuration** label and safe configuration
diagnostic. Completion-settlement messages retain their existing priority.
Strict execution/model resolution is unchanged; this is an operator-facing
projection, not a replacement provider selection or a stored-data repair.

The authenticated Chrome admin dashboard loaded valid games and the diagnostic
probe rows after the fix. All 47 admin-route/security tests and all-package
typecheck/lint passed. The regression verifies valid and malformed rows coexist,
their stored configurations remain unchanged, and anonymous access stays denied.
