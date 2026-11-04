# Explicit failed-game replacement

The recovery machinery did not provide a reliable user-accessible replacement action. Admin Retry game now atomically records one replacement, fences the old owner, hides the original and preserves its history. Concurrent requests and lost launch acknowledgements reuse the recorded replacement. Frozen admitted seats, routing, artwork and competitive roles survive owner edits.

Exact local launch filters adoption by game ID. A failed initial construction expires only its claimed epoch; an active lease left by that failure must not count as launch acceptance. It leaves the replacement's admitted inputs intact for redelivery. Canonical outcomes and captured settlements reject gameplay replay, preserving the separate settlement recovery path.

Werewolf seeded role assignment depends on sorted seat identifiers. Replacement seat identifiers preserve the original lexical ordering, and role equality is verified before committing. Randomizing those identifiers while retaining the same seed changes roles.

Tests exercise duplicate acceptance, legacy replay races, startup and transport failures, exact launch with an unrelated game present, canonical completion and championship settlement. Real providers and deployment remain outside these fixture tests. Production requires the separately implemented exact-game launcher; no recurring scheduling implementation is included.

If the page reloads after launch delivery failed, use the admin Hidden filter to find the original attempt and press Retry game again. That request returns and launches the already-recorded replacement, not another new game.
