---
title: House Cuts editorial source boundaries
module: House Cuts
problem_type: architecture_pattern
date: 2026-10-04
tags: [house-cuts, werewolf, influence, editorial, audience, source-evidence]
---

# House Cuts editorial source boundaries

The W4 prototype separates source adaptation, editorial proposals and card rendering. Existing Influence highlights required alliance records and consequence-bearing scenes. Merely adding Werewolf event triggers would preserve that narrow editorial policy.

## Source adapters

Werewolf uses `walkWerewolfHistory`: validated canonical events become audience-local entries. Project entries first; do not serialize private reducer state and subtract fields later. Exclude the Mystery terminal result from discovery so final roles/outcomes cannot color earlier copy. Snapshot hashes cover only permitted source fields; changes to hidden pack dialogue must not change the Mystery hash. Do not include thinking, raw reasoning, strategy or current editable profiles.

Influence uses canonical replay for historical cast and resolved fact authority. Public transcript speech needs explicit speaker IDs and entry sequences. Text can be read as dialogue but cannot establish actor identity or accepted votes. A transcript sequence is not a canonical replay sequence: emit a moment link only when exact structured provenance exists. The prototype does not yet ingest private Mingle/huddle scopes; operational integration must reuse their existing access policy.

## Editorial boundary

Use an exact native output schema plus semantic validation against the invocation's source window. Bind responses to snapshot hash and window ID. Reject invented participants, quotes, facts, reordered source spans and references from other windows. Preserve whole original context in the human review packet.

These checks prove attribution/reference integrity, not that the model's interpretation is insightful or correct. A genuine quote can still be misleading when shortened. Causation, intention, omitted context and editorial value remain human review concerns.

Keep empty and single-card results valid. Do not inherit named-alliance eligibility, mandatory setup/conflict/payoff or category quotas into the shared editor. The local prototype accepts reviewer-supplied ordering and conservatively rejects overlapping source moments; that is not a calibrated ranking algorithm. W4 must finish automatic selection before integration. Human approval applies to the editorial method; production generation, selection and publication are automatic. A per-Cut approval queue and candidate-management UI are outside W4.

## Coverage and proof

Preflight every conversation group against call and serialized-input ceilings before invoking anything. Never silently drop large groups or the first half of a game. Byte counts are input-size bounds, not exact token/cost estimates. The initial whole-group-per-call design is deliberately measurable and may be too expensive; real samples must inform its revision.

`bun scripts/preview-house-cuts.ts` creates a synthetic review packet with no credentials, provider calls, DB mutation or publication. It tests the contract, card layout and baseline comparison. Do not mistake scripted proposals for evidence that an editorial model finds good stories.

The real-game trial lane below now connects approved samples through the shared provider execution path; explicit human approval of the selection/analysis approach is still required. Public publication was separate at that checkpoint; the automatic integration below now owns it. See the [W4 plan](../../plans/2026-10-04-001-feat-house-cuts-editorial-discovery.md).

## Real-game trial lane

`packages/api/src/services/house-cut-source.ts` reads completed, nonhidden Public or directly linked Unlisted games inside a read-only repeatable-read transaction. It dispatches to the game adapter. Influence canonical hashes/metadata must validate; public dialogue is limited to the existing viewer-safe kinds. Unsupported Mingle/huddle scopes are not silently promoted to public evidence.

The operator command is now:

```sh
# From the repository root. Read-only preflight, no model calls.
bun packages/api/src/scripts/preview-house-cuts.ts --game GAME_SLUG --audience mystery

# Only after explicit sample, audience and paid-provider budget approval:
bun packages/api/src/scripts/preview-house-cuts.ts --game GAME_SLUG --audience mystery --run --budget-usd 1
```

Use `omniscient` for Werewolf pack/resolved-night evidence, or `public` for Influence. Credentials come from the normal environment; never put them in arguments. `DATABASE_URL` selects the data source. The CLI is an operator tool, not an authenticated HTTP endpoint. Local artifacts retain game evidence and must not be published indiscriminately.

The trial uses `executeModelInvocation`, the exact structured-output registry and `ProviderExecutionCoordinator`, with a dedicated `house_cut_discovery` semantic coordinate. Semantic quote/reference validation occurs before an attempt becomes accepted. Saved `journal.json` reserves cost before dispatch, retains failed attempts and usage, and replays accepted values on rerun. Its binding includes the complete source, model, prompt, schema, limits and editorial version. The output-directory lock prevents overlapping trials. A dispatched attempt without a terminal receipt stops resumption for operator inspection; never silently repeat an unknown paid outcome. A stale lock after process death likewise requires inspection.

Budget admission reserves three attempts per remaining window (two Flex attempts plus one standard-tier attempt only after capacity failures) using conservative input-byte and output-token ceilings at the repository's standard model rate; actual known usage is estimated at the returned service tier. Unknown usage retains its reservation. These are local rate-card estimates, not a provider invoice. The packet lists costs per logical call including retries; the journal has each transport attempt. This local journal deliberately does not masquerade as a production job, API admin cost row, or approved publication.

Real packets show every candidate in source order for human selection. This is discovery output, not a claim of calibrated ranking. Replay links use the site's origin and existing shared URL helpers. Mystery links start at the end of the supplied context window so the viewer has reached the information used in the caption; they do not start at the first quote and then spoil later context. Fixture destinations remain inert.

## Night-story calibration

Editorial v2 groups a Werewolf night's pack speech, sealed pack outcome, resolved night and first morning discussion thread into one window. Group membership comes from typed day/phase/thread data. Later threads remain independently discoverable; this is not whole-game hindsight or a cross-game prompt abstraction.

For Omniscient only, the adapter adds a `doctorSave` evidence seed when a non-null attack target equals the protection target and the resolved death is null. The protecting actor comes from canonical roles at that frame. A no-attack night and missed protection are not saves. Mystery retains the public no-death outcome without these identities or causes. Fact-led proposals may have no named participants and no quotes, but must still cite a canonical fact. Never invent dialogue to fill the card.

The editor is prompted to propose a save story and to avoid padding with routine tally recaps. The operator prefers two strong cards over three with a weak filler; selected count remains zero to five. Sample review calibrates whether these stories are worth publishing; once the method is approved, individual production Cuts do not require human approval. Prior trial receipts remain immutable: use a new output directory after source/prompt policy changes.


## Shared completion-to-publication integration

The reusable layers are **game adapter → permitted source → strict discovery/selection → persisted publication → House surfaces**. The public card schema has no game-specific prose parsing or authority. A third format should provide its canonical/dialogue adapter and audience policy, then reuse the queue, journal, publisher, gallery, images and MCP contract.

Queue inside completion's transaction, never in a read handler. Keep one `(game_id, audience)` job and fence every save/publication by a fresh lease token. A job reserves before each dispatch; the final selection is also a journaled structured invocation. Revalidate at publication from the source's canonical windows instead of trusting candidate-cached context or links. Recheck game visibility under lock before publishing. Public reads project only publication/status; they must never serialize the job row.

The operator authorized automatic OpenAI `gpt-6-luna` generation at $1 per audience ($2 per Werewolf game). Unknown provider outcomes retain reservations and require inspection. Restart may replay accepted values, but it must not silently start a new budget. No startup backfill exists. Local trial files and worker jobs are distinct receipts; when importing a reviewed example, validate its exact source against current data first. The Mystery sample changed only grouping, but that still correctly invalidated reuse.

`read_game_cuts` uses the shared read-only MCP contract, preserving the caller's audience in follow-ups. Social images and metadata use the same public projection and no-store reads; a hidden game or foreign-audience card must not keep leaking through a public image cache. Use the existing share interaction rather than inventing a separate sharing product.

Do not confuse the new gallery with the existing Influence trailer compiler: the latter still needs its V1 Highlights input. W5 must migrate new trailer creation deliberately while keeping queued render snapshots intact. Removing the old gallery does not authorize changing a saved trailer. No per-Cut review queue, candidate swapping UI or new producer controls are prerequisites for automatic publication.
