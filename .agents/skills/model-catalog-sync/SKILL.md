---
name: model-catalog-sync
description: Update Influence's provider model catalog when a model is added or its documented capabilities or pricing change. Use for model discovery, metadata refresh, and catalog update requests, not paid gameplay qualification.
---

# Update the model catalog

Inspect the checkout and current catalog before editing. `packages/api/src/routes/provider-models.ts` fetches configured providers' model listings at request time; `bun run audit:models` performs read-only discovery and reports metadata gaps, but does not update snapshots. A live listing proves account visibility, not successful inference or game quality. Restrict a live check to the requested provider when practical; never expose credentials.

Consult the provider's current primary model and pricing documentation for the exact model ID. Record documented request capabilities, supported application reasoning controls, context and output limits, and provider-specific pricing (including relevant tiers and cache rates). Do not infer prices, alias facts, capabilities, or account access from a similarly named model. Record a fresh per-model check date rather than implying that an entire older snapshot was re-audited.

Update the owning facts and catalog paths after checking their current design: `packages/engine/src/*-catalog-snapshot.json`, `provider-model-facts.ts`, `model-catalog.ts`, and `model-route-metadata.ts`. Preserve provider identity, exact structured-output requirements, accurate cost accounting and frozen historical routing. Add an explicit evaluation candidate when appropriate; do not silently change defaults, free eligibility, or claim gameplay qualification. Unknown facts should remain unknown.

Add focused coverage for discovery and exact metadata, rates and tier boundaries, and update relevant documentation with sources, date, account-access evidence and limitations. Run the required repository checks in AGENTS.md, including provider-free tests, PostgreSQL tests and `bun run check`; report actual results. Do not run inference, paid simulations, or external writes unless separately authorized. If gameplay testing is requested, follow the repository's localhost API, budget and evidence requirements.

Close out a requested implementation by committing its changes and opening a pull request with the relevant validation and limitations; do not merge or deploy without authorization. Respect any explicit user instruction that narrows this closeout or existing checkout/worktree rules. If a required check or GitHub access is blocked, preserve the work and report the blocker rather than claiming completion.
