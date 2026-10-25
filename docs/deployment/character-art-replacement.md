# Publish character artwork through an Agent Profile

Use the approved full-body source without regenerating it. Keep source files and
review receipts. Existing games retain their frozen identity; a profile edit only
changes future enrollments (and ordinary following seats in waiting lobbies).

1. Upload the source through the existing application-owned public image storage
   workflow under a new opaque key from `createOpaqueAvatarStorageKey`. Verify the
   stored byte length and SHA-256 against the approved source. Preserve old objects.
2. Select a normalized head rectangle containing the complete head. Use the existing
   portrait crop workflow (`POST /api/agent-profiles/portrait-crop`) to derive the
   portrait from those same source pixels. Verify the resulting portrait bytes.
3. Submit `fullBodyReferenceUrl`, `avatarUrl`, `portraitCrop`, and `headPosition`
   through `PATCH /api/agent-profiles/:id`, with a fresh submission ID and the current
   expected content revision. Both coordinate records must reference the new source
   URL. The head source hash must identify the uploaded source, not a prior image or
   its cutout. The submission service validates dimensions/hash and records the
   owner's head confirmation. Normal moderation rules still apply.
4. Read back the accepted profile and immutable content revision. Verify the captured
   source and portrait in the private payload bucket by hash and length. PostgreSQL
   stores their references, not the image bodies.
5. Use the [normal cutout pipeline](character-cutouts.md) to derive transparency from
   that captured source. Profile submission records an optional source-hash demand.
   Preview inventory, then process the selected agent with the bounded backfill CLI.
   Never upload replacement pixels as a derivative of an old source hash.
6. Create a new game to demonstrate the corrected profile. Verify its portrait,
   full-body fallback, confirmed head geometry, ready cutout, playback and fixed
   export. Existing publication cutoffs retain their selected original/derivative;
   a fresh cutoff can adopt a newly completed cutout.

For a review bundle before publication, the provider-free staging helper remains:

```sh
bun packages/api/src/scripts/stage-character-art.ts \
  --source /absolute/full-body.png --cutout /absolute/cutout.png \
  --head '{"x":0.4,"y":0.02,"width":0.2,"height":0.2}' \
  --out /absolute/new-review-bundle
```

This preserves the inputs, derives a 512px portrait and circular preview, and records
hashes/coordinates. It neither publishes the assets nor confirms the profile's head.

## Historical games and exports

Do not rewrite canonical events, frozen personas, immutable content revisions,
original visual artifacts or accepted history to change an old game's appearance.
Historical games resolve their ordinary frozen references, independent of today's
profile. Already rendered movies remain unchanged. Export snapshots created using
the retired temporary presentation mapping cannot be reproduced by that removed
mapping; retain those files as evidence and create a fresh export from frozen assets.
Do not weaken source-hash validation or committed-playback equality checks to make
an obsolete snapshot pass.

Werewolf source identity now includes the confirmed head geometry from its immutable
content revision. Earlier snapshots that omitted this geometry also fail closed
instead of silently changing an existing export; create a new source selection.

## Production publication

Local profile edits do not publish to production. After explicit production
authorization, select the production owner/profile and its current revision, upload
the reviewed source to production-owned storage, crop and submit through the same
authorized workflow, and verify the captured objects. Then follow the cutout
runbook's production infrastructure/migration/worker prerequisites and bounded
enqueue procedure. Validate a new game and export; preserve every older game.
