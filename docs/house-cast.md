# Default House cast

`HOUSE_CAST` in `packages/engine/src/house-personas.ts` is the single casting authority. The original map survived in the simulation `FULL_CAST`, agent factory and portrait-generation script. API fills had instead paired independent name and archetype pools; that path is removed.

| Name | Archetype / portrait key | Gender |
| --- | --- | --- |
| Atlas | strategic | male |
| Vera | deceptive | female |
| Finn | honest | male |
| Mira | social | female |
| Rex | aggressive | male |
| Lyra | paranoid | female |
| Kael | loyalist | male |
| Echo | observer | female |
| Sage | diplomat | female |
| Jace | wildcard | male |
| Rune | provocateur | male |
| Wren | martyr | female |
| Nyx | contrarian | female |
| Vex | broker | female |

Cast selection shuffles whole identities, excluding names already seated. Balanced casting prefers archetypes not already represented; random casting samples the available characters. Each House character appears at most once. A restricted Werewolf archetype pool must contain enough available identities for the open House seats; an undersized pool returns an actionable error without partially filling or starting the game.

New House fills use this map in custom Influence, Daily Free, and Werewolf. `createAgentCast` and both offline simulation entrypoints share it too. Existing waiting House seats reconcile before the immutable roster is frozen: preserve distinct requested archetypes first, replace duplicates with unused canonical characters, and preserve owned identities. Running/completed rosters, accepted evidence, recordings and current owned Agent Profiles are unchanged. Older spare filler names such as Thane are no longer drawn for new default casts. Existing Agent Profile name-reservation policy remains a separate validation contract.

Portraits live in `packages/web/public/avatars/personas/`. The original thirteen portraits remain unchanged. Vex has a dedicated regenerated cyberpunk broker headshot matching her new full-body render. The user approved all fourteen background-removed bodies and Vex's neon headshot. Only the served portrait and lossless transparent WebP assets are retained; temporary originals, duplicate PNG cutouts and review files are excluded from the branch history.

New House rosters freeze `/avatars/personas/full-body-v1/<archetype>.webp` into `fullBodyReferenceUrl`. `house-character-art.ts` pins the exact content hashes. API readers accept only catalog URLs, verify the packaged bytes, and reuse existing private visual-artifact storage for scene preparation. Werewolf playback and export bind to these frozen references; older started rosters without them remain portraits. Bundled images are already transparent, so playback and backfill skip redundant cutout jobs. The API image's visual-runtime check decodes every bundled portrait and verifies every full-body hash and alpha channel before deployment.
