# Game model routing cutover

Deploy API/worker and web together after required checks. Migration `0128_game_model_routing.sql` adds profile/enrollment preferences (Default) and fallback budget keys. Migration `0129_provider_journal_house_authority.sql` adds frozen attempt rate cards, the requested primary on logical calls, and the House journal authority fields described below. No stored context/evidence bodies move and no historical events are rewritten.

Local development applied the initial `0128` before the journal additions were complete. Its original bytes are preserved (SHA-256 `a9e4cb9e7e3fd01f8d1f6fa888cf8f1c454e2550d5ab05f31acf9b09b00aa8c4`); the additions are a separate forward migration. An installation at `0128` must apply `0129` before starting the new API. Do not reset the database, delete migration ledger rows, or replay `0128` to fix a missing `authority_kind` column. The upgrade replaces either known name for the old evidence owner FK with the canonical generated-column FK, validating all existing rows.

Episode title/description generation now uses the existing provider journal under its own revision/lease. Attempts, evidence outbox records and evidence manifests gain `authority_kind` (`game` or `episode_copy`). Their existing `owner_epoch` stores the execution token. A generated `game_owner_epoch` preserves the existing game-owner foreign keys for game calls and is null for episode calls; the episode service validates the live lease, revision and responsibility before journal operations. Existing rows default to `game`, retaining their owner constraints. Episode spend has a null game-owner reference and retains the journal call/attempt IDs. This is necessary to journal pre-start House work without inventing a game worker owner.

Before each environment release, inventory `games` by status and whether its JSON config has `modelRouting`, `providerManifest`, or `modelSelection`. Inspect active `game_run_owners`, `game_execution_states` and waiting seats. Do not print private provider payloads. Local isolated test migrations are not proof of staging/production inventory. Production deployment remains separately authorized.

Exact mapping:

* Existing profiles and enrolled seats without a preference become Default through the column default.
* A waiting legacy game's explicit ordered manifest becomes both its contestant default/fallback chain and its House chain; exclusions/overrides begin empty. Legacy single selection becomes a one-entry chain. Reasoning and caps are retained.
* A waiting game's first start freezes each seat and resolved runtime metadata, removes old top-level manifest/selection writes and removes `agentConfig.model`, atomically with roster freeze. New preferences are not retroactively read from an already-enrolled profile.
* In-progress/suspended/recoverable legacy games keep their existing sealed manifest, service policy and accepted journal authority. The bounded existing restoration reader is retained until these games drain. Never convert them to the new free defaults during recovery.
* A failed startup may return to waiting only through the existing zero-durable-authority guard. Its unstarted assignment snapshot is cleared so the corrected waiting roster can freeze again. Accepted game history is never cleared.
* Completed games and their evidence remain immutable and readable.

After migration, verify a waiting eight-seat fixture can freeze, restart its worker, and replay accepted calls; verify an old-manifest fixture resolves the same routes/caps. Verify independent contestant/House caps and episode lease fencing. Read the migration ledger and column defaults. Remove the old reader only after an environment inventory proves no recoverable game needs it, in a separate explicit change.

Rollback is a coordinated application rollback before any new-format game starts. Once new-format games have started, do not run an old worker against them or drop the new columns: restore the current worker or repair forward while retaining sealed routes and journals. No automatic live House-character edits occur in this release.
