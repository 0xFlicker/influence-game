# Avatar Storage Privacy Rotation

Profile pictures are public media, but their object keys must not contain an
internal `users.id`, Privy DID, agent ID, generation request ID, wallet, email,
handle, or other identity-derived value. New objects use only these forms:

```text
pfp/<random asset UUID>.<ext>
pfp/generated/<random asset UUID>.<ext>
```

Database ownership and the avatar change ledger remain authoritative. The
public object pathname is not an ownership or authorization boundary.

The rotation tool inventories the public PFP bucket, copies referenced legacy
objects to opaque keys, repoints every known database reference, and deletes
the old objects only after rechecking both the database and replacement bytes.
Its manifest contains the old private identifiers and must never be committed,
attached to a ticket, pasted into chat, or stored in a public artifact.

## Deployment gate

Deploy the prevention change before creating a rotation manifest. Drain all old
API instances and in-flight avatar generation work, then wait at least five
minutes for previously issued upload URLs to expire. Confirm a fresh manual
upload and a fresh generated portrait both use an opaque key. Do not begin the
rotation while an old producer can still create identity-bearing keys.

Run repoint and deletion in a maintenance window with avatar/profile mutations
blocked. Pause the render worker and wait for any claimed, rendering, composing,
or uploading House Highlights job to finish or return to a safely retryable
state; a worker can otherwise retain an old snapshot URL in memory after the
database has been repointed.

Rehearse the complete sequence against `social-strategy-agent/stg` before
production. Production also requires a current database backup and confirmation
that the object-storage recovery policy is understood.

Run the following commands as `root` from `/opt/influence` on the target host.
The Compose service supplies the environment already fetched from that host's
scoped Doppler service token, so the staging host uses
`social-strategy-agent/stg` and the production host uses
`social-strategy-agent/prd`. Do not substitute a laptop or another host's
Doppler configuration.

### Read-only database preflight

Before creating a manifest, use a disposable PostgreSQL client to run the
read-only audit. Doppler injects `DATABASE_URL` into the Docker client, and
`-e DATABASE_URL` forwards only that secret to the disposable container.
Retain counts only; do not copy matching URLs or keys into shared logs. Repeat
the legacy-reference query after repoint and after deletion, when every value
must be zero.

```sh
doppler run --token "$(cat /opt/influence/.doppler-token)" -- \
  docker run --rm -i \
  -e DATABASE_URL \
  postgres:16-alpine \
  sh -c 'psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1' <<'SQL'
SELECT
  (SELECT count(*) FROM agent_profiles
   WHERE regexp_replace(avatar_url, '%2[fF]', '/', 'g')
     ~ 'pfp/(generated/)?[^/"?]+/[^/"?]+') AS profile_hits,
  (SELECT count(*) FROM avatar_generation_requests
   WHERE regexp_replace(safe_metadata::text, '%2[fF]', '/', 'g')
     ~ 'pfp/(generated/)?[^/"?]+/[^/"?]+') AS generation_hits,
  (SELECT count(*) FROM avatar_change_events
   WHERE regexp_replace(coalesce(previous_avatar_url, '') || ' '
     || coalesce(new_avatar_url, '') || ' ' || coalesce(safe_metadata::text, ''),
     '%2[fF]', '/', 'g') ~ 'pfp/(generated/)?[^/"?]+/[^/"?]+') AS change_hits,
  (SELECT count(*) FROM game_postgame_media
   WHERE regexp_replace(coalesce(render_input_snapshot::text, ''),
     '%2[fF]', '/', 'g') ~ 'pfp/(generated/)?[^/"?]+/[^/"?]+') AS media_hits;

SELECT game_id, media_type, status, lease_expires_at
FROM game_postgame_media
WHERE status IN ('claimed', 'rendering', 'composing', 'uploading');
SQL
```

Treat the SQL as an independent safety net, not as the rotation authority. Any
hit not reconciled by the private manifest is a hard stop. The active-worker
query must return no rows before repointing.

### Rotation command setup

After the database preflight, choose a private persistent manifest path outside
the repository. Use `stg` in the filename on staging and `prd` in production.
Keep the same path for every phase. The tool creates and checkpoints the file
with mode `0600` after every object so interrupted phases can safely resume.

```sh
cd /opt/influence
export AVATAR_ROTATION_MANIFEST=/var/lib/influence/avatar-rotation/avatar-storage-rotation-stg.json
install -d -m 0700 "$(dirname "$AVATAR_ROTATION_MANIFEST")"
```

Define this shell function in the same session. It runs the CLI bundled into
the deployed, SHA-selected API image and bind-mounts only the private manifest
directory at the same absolute path inside the one-off container.

```sh
avatar_rotation() {
  docker compose --env-file /opt/influence/.env run --rm --no-deps \
    --volume "$(dirname "$AVATAR_ROTATION_MANIFEST"):$(dirname "$AVATAR_ROTATION_MANIFEST")" \
    api bun run dist/rotate-private-avatar-storage-keys.js "$@"
}
```

If the SSH session ends, re-export the exact existing manifest path and redefine
the function before resuming. Never print or transmit the manifest contents.

## 1. Inventory

Inventory is read-only. It lists recognized legacy uploaded/generated PFP key
shapes, independently scans the entire database for those legacy keys and URLs,
HEADs every candidate object, counts references across agent
profiles, avatar generation metadata, avatar change history, and House
Highlights render-input snapshots, and assigns a random replacement key only
to referenced objects. A database reference whose source object is absent is a
hard stop; it cannot fall outside the manifest and later pass verification.

```sh
avatar_rotation inventory \
  --manifest "$AVATAR_ROTATION_MANIFEST"
```

The SQL preflight reports counts only. Inventory creates the private per-object
old-key to replacement-key mapping in the manifest. Review the summary counts
and privately classify every non-opaque object in the complete `pfp/` listing;
any path outside the recognized historical shapes is a hard stop until its
provenance and disposition are known. If a legacy object appears after
inventory, stop and repeat the deployment/drain gate with a new manifest path.

## 2. Copy and verify replacement bytes

This phase is mutating and requires `--apply`. Each copy preserves content
metadata, explicitly applies `public-read`, and must have the same byte length,
content type, and non-null ETag as the source before the manifest records it as
copied. Rerunning the command
re-verifies an existing replacement rather than blindly overwriting it.

```sh
avatar_rotation copy \
  --manifest "$AVATAR_ROTATION_MANIFEST" \
  --apply
```

The number of copied objects must equal the number of referenced objects. An
unreferenced legacy object is deliberately not copied; it will be removed only
after the deletion gate proves it remains unreferenced.

## 3. Repoint database references

This phase transactionally replaces the old key and URL in:

- `agent_profiles.avatar_url`;
- `avatar_generation_requests.safe_metadata`;
- `avatar_change_events.previous_avatar_url`, `new_avatar_url`, and
  `safe_metadata`;
- `game_postgame_media.render_input_snapshot`, with its manifest hash recomputed.

```sh
avatar_rotation repoint \
  --manifest "$AVATAR_ROTATION_MANIFEST" \
  --apply
```

Every entry is checkpointed only after its transaction commits and a second
reference scan returns zero old references.

## 4. Pre-deletion verification

```sh
avatar_rotation verify \
  --manifest "$AVATAR_ROTATION_MANIFEST"
```

Verification performs another independent whole-database scan rather than
checking only keys saved in the manifest. Continue only when:

- `ok` is `true`;
- `untrackedLegacyObjects`, `oldReferencesRemaining`,
  `missingReplacementObjects`, and `mismatchedReplacementObjects` are all zero;
- every agent portrait renders on the signed-in agent dashboard and a public
  player/game surface;
- anonymous `HEAD` requests to a sample of replacement URLs return `200` with
  the expected image content type and length.

`legacyObjectsRemaining` is expected to be nonzero at this point because the
old objects have not yet been deleted. If any check fails, do not run deletion;
the old objects are still available while the database or manifest is repaired.

## 5. Delete old objects

Deletion requires two explicit confirmations. Before every delete, the tool
recounts database references and re-HEADs the replacement object. It refuses
the entire phase if the bucket contains any legacy object absent from the
manifest.

```sh
avatar_rotation delete \
  --manifest "$AVATAR_ROTATION_MANIFEST" \
  --apply \
  --confirm-delete-old-objects
```

The command performs a final verification. Success requires every verification
counter, including `legacyObjectsRemaining`, to be zero. Independently confirm
that representative old URLs return `404` and replacement portraits still
render. Old shared links intentionally stop working; there is no redirect or
compatibility path because it would preserve the identifier disclosure.

Keep the private manifest only through the bounded production observation
window. Then securely remove it according to the operator host's storage policy.

## Stop conditions

Stop without deleting when any of the following occurs:

- old API instances or unexpired old upload targets still exist;
- avatar/profile writes are still admitted or a render worker has an active job;
- a replacement object is missing or has different bytes;
- any old database reference remains;
- an untracked legacy object appears after inventory;
- the dashboard or a public portrait surface fails against replacement URLs;
- the production database backup or private manifest checkpoint is unavailable.
