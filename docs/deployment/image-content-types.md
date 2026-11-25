# Image object Content-Type repair

The private payload uploader stores the encoded image's MIME type on new image objects. It preserves the binary key, reference shape, SHA-256 and bytes. PNG, JPEG and WebP are accepted, and provider attachments can also use GIF. A conditional-create collision preserves the existing object and verifies its digest. Its owning reference still belongs in the backfill, even if the application row also deduplicates. Audio, gzip documents and other generic binary payloads retain their existing write path.

## Rollout order

1. Deploy the image writer to the gateway and workers using the regular release process. Verify the live revision and configured database, data endpoint and bucket in each environment. Complete a local rehearsal before updating live objects.
2. Snapshot the application-owned references, dry-run the proposed migration, and review the exceptions. Snapshot again after the old writers have retired and reconcile any new keys before switching portrait delivery. Writes can continue throughout.
3. Rehearse the same-key metadata copy and signed original GET on the current provider. Apply in bounded batches. Compare request latency and errors while the job runs and pause or increase the batch delay if latency or errors rise.
4. Verify historical portraits, private-game visibility, direct browser GET and replay behavior before deploying the separate portrait delivery change.

## Inventory and apply

Generate the SQL with Bun and execute it read-only against the explicitly identified application database. The SQL emits a single JSON column. For example, feed it to `psql -X -At -v ON_ERROR_STOP=1` using the environment's existing connection setup. A database that requires host network access can run the query in its API network, with the JSON result redirected to a private local file.

```sh
umask 077
bun packages/api/src/scripts/migrate-image-content-types.ts sql > image-references.sql

bun packages/api/src/scripts/migrate-image-content-types.ts dry-run \
  image-references.ndjson image-migration.ndjson DATABASE PROVIDER ENDPOINT BUCKET 100 100

bun packages/api/src/scripts/migrate-image-content-types.ts apply \
  image-references.ndjson image-migration.ndjson DATABASE PROVIDER ENDPOINT BUCKET 10 250
```

Pass the existing credentials via the environment. Supply the exact provider identity (`linode_object_storage` or `aws_s3`), HTTPS endpoint and private data bucket. Local MinIO uses its configured loopback URL. The tool validates those values and the snapshot database identity before opening the migration journal and binds the journal to that snapshot's digest. Keep snapshots and journals private. They contain object keys and owning row references.

The snapshot selects frozen agent assets, championship artwork, cutout inputs and outputs, visual artifacts, visual render attempts and room library images. It also locates provider attachment references in the private attempt evidence manifests and pending outbox. It verifies evidence hashes and reads those documents only to resolve the attachment references. It never copies, updates or logs evidence bodies. The application stores payload references by immutable key and digest without an S3 version ID. Receipt versions are provider history. A versioned self-copy creates a fresh current version and checks the old version remains unchanged. An externally version-pinned reference needs explicit review before changing delivery.

The dry run uses one conditional signature range per distinct referenced image. It records correct, incorrect, missing, unrecognized and failed inspections. Each invocation processes up to the specified limit of evidence rows and the limit of images, with up to four reads in parallel, configurable as the final argument. Repeat with the same inputs to resume. Apply is serial and skips objects already verified in that journal. It conditionally copies the object to the same key while preserving writable metadata and tags. It requires the expected owner-private ACL and verifies the resulting metadata, ACL, tags and full SHA-256 against the immutable reference. Unsupported ACLs, protected metadata, changed objects and permissions failures remain exceptions. Keep the before and after receipts for review. A fresh snapshot and journal recheck changes and transient inventory exceptions. If interrupted, confirm the original process has exited before removing its stale journal lock.

A normal app credential can have object read/write rights without ACL, tag or version reads. Use an existing authorized operator credential for the migration if those checks are denied. The application continues to use its current credentials and storage provider.

## Public Werewolf portrait delivery

The public character route checks game visibility, the frozen opening cast and the requested character before looking up private image metadata. For stored images, GET returns a private, non-cacheable redirect to the original key with a two-minute signature. The storage GET serves the saved Content-Type. HEAD checks the same authorization and returns the image type and length from the API. Bundled images and existing public uploads use their catalog or origin MIME.

Confirm the image loads in the viewer and that the replay asset loader follows the redirect without forwarding API authorization across origins. Studio and export source reads use the same frozen bytes. Existing source selections, bundles and movies retain their pinned images and require no refresh for this transport change.

Provider image signing also uses the saved type and length from object metadata.
Its existing 15-minute deadline covers the provider request and retry window.
