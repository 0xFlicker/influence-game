---
title: Send new wolf forms through private background removal
module: Werewolf production
problem_type: integration_issue
tags: [werewolf, cutouts, privacy, studio, presentation-parity]
date: 2026-11-05
---

Wolf forms were generated against a plain grey background, saved as visual
artifacts, and handed straight to the player. Only normal character assets
created background-removal demands. The wolf entrance consequently displayed the
entire rectangular source image.

Queue a cutout demand in the same transaction that first saves a verified form.
Do not enqueue when reusing an existing form: this repair intentionally affects
newly generated assets without a historical backfill. Reuse the existing worker,
lease, dimension/alpha validation and durable private-payload storage.

The ordinary cutout publisher writes public profile art, which would be wrong for
wolf identities. `character_cutouts.private_source` is sticky for private inputs,
including orphaned jobs; public retries cannot downgrade it. Finished private
results create `visual_character_cutouts` source-to-artifact associations inside
the owning game. No public URL or profile content asset is published. Attaching a
new game's demand to a completed cached job re-runs artifact association without
re-running inference. Only attached demands get associations.

`publishedWerewolfScenes` decorates read-time wolf references with available
private derivatives. It does not edit stored plans, variants, original generation
references or head geometry. The shared binding supplies viewer and Studio/export
with the same authorized IDs. Existing audience, cursor and game boundaries still
control byte access. Frozen Studio reads apply the cutout creation cutoff; live
views can pick up completion after opening. Background-removal failure does not
block canonical gameplay.

Migration `0154_private_wolf_cutouts` adds only access metadata and relational
artifact references, with no data backfill or movement of binary bodies.

## Verification

API regressions cover durable demand deduplication, no work on historical reuse,
private alpha publication, cache reuse across games, orphan privacy, no public
profile assets, viewer media access, Mystery/early-cursor denial, fresh Studio
selection and unchanged older selections.

Fresh visual proof uses the API regression's materialized source, with bundled
transparent artwork substituted for its tiny transport fixture. It tests the
actual viewer, Studio Source/Selected cut and export adapters, normal/reduced
motion, entrance/reveal/handoff, reverse seeking, 1280×720, 640×360 and 390×700.
The background-removal model itself is unchanged; no paid provider or production
image generation was used for this proof.

Refresh proof (use an isolated, migrated PostgreSQL test database):

```sh
WOLF_CUTOUT_PROOF_DIR="$PWD/.renders/wolf-cutout-proof" \
  TEST_DATABASE_URL=postgresql://influence:influence@127.0.0.1:54320/influence_wolf_cutout_48b3 \
  bun run test:postgres
cd packages/web
bun run src/scripts/prepare-wolf-cutout-parity.ts ../../.renders/wolf-cutout-proof
FORMAT_CONTEXT_STUDIO=1 bun run src/scripts/verify-presentation-parity.ts \
  ../../.renders/wolf-cutout-proof/render-final ../../.renders/wolf-cutout-proof/cases.json
```

Evidence is retained under `.renders/wolf-cutout-proof/`, including the API source,
selection cases, sampled PNGs, comparison report, frozen manifests and fresh MP4s.
No existing production assets were changed. Old MP4s remain unchanged; create a
fresh selection/bundle to adopt a cutout that completed after an earlier selection.
