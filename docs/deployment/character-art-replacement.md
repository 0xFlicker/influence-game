# Stage a character art replacement

Use a new full-body source and derive its portrait from the same pixels. Run the
local BiRefNet worker described in [character-cutouts.md](character-cutouts.md).
Inspect the source and select a normalized rectangle containing the entire head,
including crests, hair and ears. Stage a review bundle without publishing:

```sh
bun packages/api/src/scripts/stage-character-art.ts \
  --source /absolute/full-body.png --cutout /absolute/cutout.png \
  --head '{"x":0.4,"y":0.02,"width":0.2,"height":0.2}' \
  --out /absolute/new-review-bundle
```

The command verifies PNG dimensions and cutout alpha, uses the existing portrait
crop calculation, and writes the unchanged source, unchanged cutout, 512px portrait,
circular portrait preview, and a manifest of hashes and coordinates. It refuses
an existing destination. Review the circular preview for clipping before publication.
It performs no provider calls, uploads, database mutations, or profile updates.

For a future Agent Profile, upload the source and portrait to new application-owned
keys, verify their bytes, then use the supported profile update API. Translate both
coordinate records' `sourceUrl` to the uploaded source URL. The source hash remains
the hash of those exact uploaded bytes. The submission service assigns head-position
confirmation; the staging command does not fabricate it. Preserve the prior objects.

## Existing games

Current replay references intentionally freeze the submitted identity. Updating an
Agent Profile does not replace an already-started game's references. Do not rewrite
`werewolf.started`, `game_players.persona`, immutable content revisions/assets, or
original visual artifacts. Do not overwrite a cutout associated with the old source
hash with a different character: that would corrupt derivative identity globally.

A localhost-only editorial mapping is available through
`INFLUENCE_LOCAL_CHARACTER_ART_MANIFEST=/absolute/manifest.json` on the **gateway/API**.
Only that process needs restarting to enable it; game and audio workers do not.
It requires a loopback `DATABASE_URL`, no `INFLUENCE_DEPLOYMENT_ENVIRONMENT`, and
`NODE_ENV` other than `production` or `staging`. Misconfigured environments reject
the mapping instead of reading local files. Without this environment variable,
normal frozen-reference behavior is unchanged.

```json
{
  "version": 1,
  "entries": [{
    "gameId": "exact-game-id",
    "playerId": "exact-frozen-player-id",
    "publishedAt": "2026-10-25T06:45:00.000Z",
    "head": { "x": 0.4, "y": 0.02, "width": 0.2, "height": 0.2 },
    "assets": {
      "body": { "path": "/absolute/bundle/full-body.png", "sha256": "64-lowercase-hex-digits" },
      "cutout": { "path": "/absolute/bundle/cutout.png", "sha256": "64-lowercase-hex-digits" },
      "portrait": { "path": "/absolute/bundle/portrait.webp", "sha256": "64-lowercase-hex-digits" }
    }
  }]
}
```

Use actual hashes from the staged manifest. Maintain this file as an append-only
publication list: add a new timestamped entry for corrections and retain prior
entries and files. Replace the manifest atomically. Never backdate a new entry,
because old snapshots select their original publication cutoff. Paths may move
without changing asset identity; bytes and head coordinates may not.

Viewer projections select the latest matching publication within their cutoff.
New image URLs include a revision derived from the game/player binding, timestamp,
asset hashes and head coordinates. Asset reads verify SHA-256. Public reads enforce
game visibility and player membership; hidden export assets require current Producer
or Sysop authorization. No local file paths escape in viewer/export metadata.

Influence export media references and Werewolf export source hashes pin the selected
art. Old exports remain unchanged when later entries are appended. Use Studio's
visual refresh or a new export to adopt the replacement; reload an existing viewer
to obtain a new publication cutoff. Full-body art, portraits, head coordinates,
watch-window players and nested moment snapshots share the mapping. Selection happens
after canonical projection, outside contestant observations, reducers and provider
context. Existing composed scenes remain historical images unless separately rebuilt.

This local override is not a production publication system. Production replacements
need the normal durable object-storage and authorization boundaries; do not enable
this filesystem manifest on a deployed node.

For the 2026-10-25 local Gemini correction, the staged replacement targets only
Gemini Pro profile `8590e89f-d12e-436f-8f0b-fa56df9f4e2b`, with explicit presentation
bindings for games `ddfa4f77-ffd5-4191-85bb-4f4c67b97200` (Werewolf player
`2d842740-f28a-4eac-ad92-9c76f6a38157`) and `9437c80e-b028-47f6-83ae-e4bb6b0d2fed`
(Influence player `8890a6fa-12e4-4775-98a9-4164a48a0b70`). Resolve actual player IDs;
never select historical players by display name alone. The integration owner controls
publication and shared budget reconciliation. Other cast art remains unchanged.
