# Proposed House character model assignments

Prepared for review; no profile writes have been made. These names come from the repository's House name pool, not a verified inventory of live saved profiles. Resolve a unique House-owned profile ID for each name and confirm ownership before applying. A name match alone must never authorize a player-profile mutation.

| Proposed character | Preferred model |
|---|---|
| Atlas | `openai:gpt-6-luna` (Flex) |
| Vera | Default (GLM Flash removed from free selection after repeated inference failures) |
| Finn | `katana:deepseek-v4-flash` |
| Lyra | `meta-muse:muse-spark-1.3-contributor` |
| Other House characters | Default |

For an approved saved profile, write only `modelPreference` through the owned-profile service/API/MCP using the House owner's authorized account. Do not change strategy, identity, moderation status or historical enrollment rows. Existing lobbies retain their snapshot; future enrollments inherit this proposal. Generated one-off filler names are not saved profiles and remain Default unless an admin overrides that game's cast. This proposal does not add name-based routing to the runtime.

Preview with a policy using Luna as contestant default: Atlas resolves to Luna Flex; Vera and other Default seats resolve to Luna; Finn to DeepSeek Flash; Lyra to Muse Contributor. The separate House narrator still uses the game creator's House route. Influence Visual Mode requires an explicit compatible alternative for Finn or text mode; never silently downgrade the preference.
