# Admin invite, import, and CLI boundaries

`view_admin` grants read access; it does not authorize invite policy changes, access to redeemable invite codes, or game imports. `manage_roles` alone does not grant these operations either. The startup RBAC seed grants `manage_invites` and `manage_game_imports` to admin and sysop; custom roles can delegate either capability independently. Request authentication reloads database permissions, so revocation applies to existing sessions.

- `manage_invites`: PATCH invite settings, GET/POST invite codes, POST refill. The boolean setting remains readable with `view_admin`, `manage_roles`, or `manage_invites`.
- `manage_game_imports`: POST direct game-export import.
- Ordinary exports retain their existing read authority.

Accounts delegated only `manage_invites` see the Admin link and land on Invites. Revoking that permission removes both navigation and API access.

## Remote import removed

Cross-environment browsing and importing have been removed. There is no Import Game admin panel, remote game-list route, source-configuration endpoint, or outbound game-import fetch. No import-source environment settings are needed. The API accepts a complete uploaded export at `POST /api/admin/import-game`, guarded by `manage_game_imports`; the former URL-and-slug payload is invalid. Existing imported games and ordinary game exports are unaffected.

## CLI sessions

`POST /api/auth/local-cli-session` is removed and returns 404, including with a forged loopback Host. Producer MCP grants cannot be exchanged into ordinary sessions. Ordinary-session CLIs use the existing `/auth/cli` browser handoff with exact web/API origin checks; game-assets retains scoped OAuth. Use matching production or staging origins; staging requires Tailscale. `simulate:werewolf:api` continues to require a loopback API.

## Rollout and exposure review

Ship the permission split, remote-import removal, and legacy CLI endpoint removal together. Run `bun run test`, `bun run test:postgres`, and `bun run check`. On staging, check the deployed revision, removed endpoints, permission denials, and a read-only browser CLI authorization. Repeat read-only smoke checks after the existing manual production approval gate. Local tests do not establish deployed sign-in or network behavior.

Review retained access logs and database records for invite reads, setting changes, imports, and unusual remote source requests. Decide separately whether evidence warrants code rotation or record repair. This patch does not revoke already redeemed codes or remove historical imports. No production changes or historical exposure conclusions are implied by local validation.
