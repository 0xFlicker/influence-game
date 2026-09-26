---
name: manage-game-assets
description: Upload, inspect, download, update, replace, or delete editorial game images through the Influence asset CLI, using scoped browser OAuth against a named local or deployed API.
---

# Manage game assets

Use `bun run game-assets` from the repository root. Read [the operating guide](../../../docs/game-assets.md) for endpoint contracts, MinIO setup, and cleanup outcomes. These images are editorial assets, independent of gameplay scenes and canonical events.

Select the user's API origin explicitly with `--api` or `INFLUENCE_GAME_ASSETS_API_URL`. Login requires the corresponding `--web` origin. Local and deployed token files are separate and bound to the exact API origin/resource. HTTPS is required outside loopback. Do not print tokens or use database/bucket credentials in the CLI.

The existing producer and sysop roles receive `manage_game_assets`. Login requests explicit `assets:manage`; producer trace scope alone cannot authorize image CRUD. Check current server authority with `whoami` rather than assuming a saved token proves access. Access tokens last one hour; rerun login after expiry.

```sh
bun run game-assets login --api http://127.0.0.1:3000 --web http://127.0.0.1:3001
bun run game-assets whoami --api http://127.0.0.1:3000
bun run game-assets upload --api http://127.0.0.1:3000 --game GAME_SLUG --file /absolute/banner.png --label banner --visibility spoiler --alt "Result teaser" --request-id WORKFLOW_RUN_ID
bun run game-assets list --api http://127.0.0.1:3000 --game GAME_SLUG
```

Uploads default to `visibility=spoiler`; `public` is the other presentation classification. `private` is not an asset value. Neither classification changes read access: public-game metadata and pixels are available anonymously. Roles control management only. Existing private/hidden game access remains unchanged. `banner` renders only on `/games/[slug]/results`; other labels have no automatic placement. Spoilers are allowed and never become canonical game state.

`list`, `show`, and `download` use anonymous reads by default, without login. An explicit `--token-file` authenticates reads when needed for existing game access. Management commands use the selected origin's saved token. Use `--visibility spoiler` or `--visibility public` on upload/update, or as an explicit list filter. These are metadata filters, never privacy filters.

Operate on the user's named game and environment. Use `show` to obtain the current revision before `update`, `replace`, or `delete`; supply that revision explicitly. Preserve request IDs and identical inputs across retries. On a lost response, use `receipt --request-id ID` before issuing a different mutation. A 409 requires inspection, not automatic revision advancement.

A deletion hides the image immediately even when object cleanup is pending. Use `cleanup --request-id ID` for that receipt; it cannot delete a live image or an active upload. Never remove the shared MinIO bucket or unrelated trace objects. Source fields may be cleared using `--source-workflow null` or `--source-run-id null`.

Use `download --out /absolute/file.png`; existing files require explicit `--overwrite`. `logout` revokes remotely before removing the credential. If the server is unreachable, `--local-only` removes the file and reports unconfirmed revocation.

Use `<command> --help` for exact options. Local MinIO is bootstrapped with `bun run s3:bootstrap`; source `.env.private-trace.local` into the API environment. Deployed smoke testing belongs on an ephemeral environment or staging and is described in the [operator review](../../../docs/deployment/game-assets-operator-review.md).
