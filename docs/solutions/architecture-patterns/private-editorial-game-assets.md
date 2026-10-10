---
module: Game Assets
date: 2026-09-26
problem_type: architecture
component: api
tags: [game-assets, private-storage, oauth, minio, receipts]
---

# Keep editorial images separate from gameplay visuals

External promotion images need CRUD, presentation labels, and late attachment without becoming canonical scenes or game facts. Store dedicated game-asset metadata and immutable S3 objects using the existing MinIO/Linode content configuration. Asset `visibility` accepts `public` or `spoiler`; it is presentation metadata, never an ACL. Public-game images are anonymous-readable, and management roles control writes only. Public and Unlisted game images are anonymous-readable; hidden and invalid game visibility remain unavailable. Asset presentation labels and management permissions are independent.

Scope-bearing opaque OAuth tokens are accepted only by the asset endpoint family. Consent and use require current management permission; neither a scope string nor cached JWT claims grants a role. Existing producer and sysop roles receive the permission, and the CLI selects explicit asset consent using shared PKCE helpers.

S3 writes precede a short metadata publication transaction. Durable request receipts retain candidate keys before upload. Claim and game fences serialize publication, revisions, and cleanup; cleanup terminalizes abandoned intents before deleting objects. A late completion cannot resurrect a cleaned candidate. Deletion hides metadata/bytes immediately even when physical cleanup remains pending. No-store responses let later requests observe replacement, deletion, and game-access changes.

Mount a byte loader only in the results route, using anonymous requests on public games and the session when needed for existing game access. Auth identity changes remount it; abort stale work and revoke blob URLs on logout, route exit, replacement, and failures. After sign-out, a public-game spoiler banner reloads anonymously. A focus refresh discovers late historical uploads without a worker or generation-on-read.

The [operating guide](../../game-assets.md) and [operator review](../../deployment/game-assets-operator-review.md) distinguish isolated tests, real local MinIO, and ephemeral/staging deployment proof. Each test owns its objects/database/processes; the shared bucket and trace objects remain untouched.
