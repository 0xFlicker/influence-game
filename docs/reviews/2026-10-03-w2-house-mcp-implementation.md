# W2 implementation and verification

Plan: [House MCP discovery and game inspection](../plans/2026-10-02-005-feat-house-mcp-game-inspection.md). Implemented in the Werewolf feature checkout from `d4d2afaf`. This report describes local proof, including authenticated reads through the attached Codex MCP connector. It does not establish deployment or acceptance inside the separate ChatGPT web app.

## Delivered

- One existing authenticated `/mcp` endpoint and OAuth resource. Shared `list_games`, `read_game`, `read_game_results`, `read_game_thinking`, game-tagged rules/search, and archetype strategy hints for both games. The MCP App consumes the new mixed catalog without legacy shape fallbacks. The viewer banner is unchanged.
- Public discovery; known Public/Unlisted ID or slug reads; Hidden/invalid visibility denied through spectator tools. `mine` includes creator/participant claims and Werewolf casting/frozen profile ownership. Producer collection and operational evidence retain producer authorization. Spectator reads never inherit broader producer access.
- Concrete adapters preserve native coordinates: Werewolf audience-local source cursors, Influence separate canonical and transcript positions. Repeatable-read transactions pin replay bounds; polling admits later entries only after draining that prefix. Current view intentionally has a latest board and bounded recent tail.
- Explicit thinking uses accepted Werewolf artifacts and the existing Influence public-watch eligibility. Mystery cannot request thinking. Ordinary history contains no thinking or frozen strategy. Results reuse W1, without generating summaries or treating a stopped game as a victory.
- Closed input/output schemas, runtime validation, grant mirrors, read-only annotations, typed failures and validated follow-up arguments. History/thinking limits are 20 whole entries and 64 KiB; Influence thinking retains its eight-card cap. Results have a separate 256 KiB ceiling. Long entries fail explicitly rather than disappear.
- Influence-only evidence tools reject Werewolf after their access checks and offer a safe shared-reader follow-up where permitted. Cost and trace tools remain shared producer evidence. Local artifact MCP remains the separate Influence simulation surface.

## Adversarial checks

Tests exercise hidden/unknown equivalence, unrelated users, Unlisted discovery exclusion, visibility changes between reads, producer role removal and token revocation. They also exercise wrong game/audience/cutoff cursors, fractional/future positions, live append/poll stability, partial casting, corrupt/missing terminal history, private pack isolation, accepted-thinking hash/actor/action mismatches, and maximum-duration results.

The final audit excluded private Influence bookkeeping frames from the spectator timeline. Only public/system source events or the existing sanitized viewer-decision projection can create a facts entry. Native canonical sequences may have gaps; pagination counts eligible entries rather than all underlying rows. Dialogue uses typed public scope eligibility; private huddles and untyped legacy system prose cannot enter it. Unbound legacy dialogue remains readable without a fabricated exact replay link.

Public visibility does not widen owner cognition, private transcript, narrative or producer access. Input/output validators and follow-up argument validators run at actual dispatch. User-authored dialogue stays untrusted presentation data. Producer inventory deliberately omits spectator follow-ups because it may contain Hidden games. The MCP App test now supplies the real validated structured tool response instead of a legacy JSON-text fixture.

## Local proof

- `bun run test`: **2,212 passed, 5 skipped, 0 failed**; test classification passed.
- `bun run test:postgres`: **1,844 passed, 0 failed**, across 157 files, in a disposable local database. Existing owner/private evidence, OAuth, producer and both game integrations are included.
- Final focused PostgreSQL regression after the audit: **118 passed, 0 failed**, including shared inspection, Werewolf accepted thinking, MCP server and real authenticated HTTP transport.
- `bun run check`: all package type checks and lint passed. The final-source rerun also passed.
- Real isolated browser/API check follows a shared-reader Werewolf Mystery moment link, checks the exact source cursor, Unlisted noindex, desktop/mobile entry, and absence of obsolete Werewolf entry routes. **1 passed**. The additional Influence link check opened its emitted canonical replay path at a later playable position: **1 passed**.
- HTTP proof uses a real ephemeral Bun server and bearer-token validation: initialize, tools, strict inputs, mixed discovery, direct Unlisted read, executable follow-up and revoked-token denial. No real Clerk or external provider calls.

The broad suite ran before the final private-bookkeeping filter, integrity assertions and structured MCP App response correction; the final focused suite covers those changes. This is not a claim that tests were run against production or a real MCP host connection.

## Integration notes and remaining work

- A 20-day Werewolf fixture measured roughly **four seconds** for a bounded thinking read because the existing history/evidence validators still walk the complete history. Output size is bounded; projection work is not. Avoid per-turn high-frequency polling of this explicit evidence tool. A later optimization should reuse validated traversal without weakening artifact integrity or audience cutoffs.
- Public catalog filtering currently precedes the response limit in memory. `mine` also scans casting/start ownership rows. This is correct for current data and deliberately simple, but database-side filtering and indexes deserve measurement as catalog size grows.
- No new migrations, gameplay behavior, providers, feature flags, production studio, review/learning, House Cuts or trailer work. W3 onward retain their own approval and design gates.
- The attached local Codex host connection is verified below. Deployment, separate ChatGPT web-app acceptance and operator acceptance remain release checks. The legacy machine resource URIs remain stable; this is one House MCP service.

See [cross-game integration lessons](../solutions/architecture-patterns/house-mcp-across-game-kinds.md).

## Regenerating output contracts

`house-output-schemas.json` is generated from inferred service DTOs and the closed follow-up union. Runtime does not depend on the generator. The committed generator ran successfully against the final service contracts. Use a disposable pinned development install:

```sh
toolDir=$(mktemp -d /tmp/house-schema.XXXXXX)
bun add --cwd "$toolDir" --exact typescript-json-schema@0.65.1
bun scripts/generate-house-mcp-schemas.cjs "$toolDir/node_modules/typescript-json-schema"
```

The generator first requires the repository API typecheck. Its bundled older TypeScript parser is used only for schema emission; actual fixture outputs must still pass runtime validation. The script preserves typed string/number index signatures while closing fixed objects. Regenerate and run contract fixtures whenever a service DTO changes; do not hand-maintain a second DTO tree.

## Live local MCP connector validation — 2026-10-03

Validated committed implementation `adc46711` through the attached `the-house-localhost` tools against the running API on port 3000. The preceding OAuth fix advertises issuer-bound authorization responses and returns `iss` on success/error callbacks; real browser authorization completed and the connector attached successfully. These checks used the existing agents:read, agents:write, games:read and producer grant, but invoked read-only tools only. No games, agent profiles, visibility settings or production assets were changed.

| Surface | Observed result |
| --- | --- |
| Discovery | Shared Public catalog returns both formats and canonical `/games/:slug` links, without ending fields. Influence filtering and producer inventory work. |
| Werewolf replay | Drained `hazy-ruby-sand` in five pages per audience: 78 Mystery entries and 82 Omniscient entries. Audience-local cursors were consecutive without omissions or duplicates. Largest sampled serialized page was below 46 KiB. |
| Audience boundary | Mystery contained no pack speech or role fields before the outcome. Omniscient included both pack-dialogue entries and role fields. Neither ordinary history contained thinking, reasoning context or frozen strategy fields. |
| Explicit thinking | Introduction cutoff `[3]` returned only the two eligible introduction records. Cutoff `[82]` drained 94 records across five pages, all within the cutoff with no duplicate cursor/actor/action keys. Includes pack, night actions, discussion and votes. |
| Results | Werewolf results contain six cast members, two night receipts and five vote receipts; outcome matches both complete audience traversals. Influence `young-olive-oak` results also succeed. |
| Influence continuity | Initial replay and its returned continuation execute successfully using separate canonical/transcript positions. A returned player-thinking follow-up gives an explicit unavailable result at the early position where that player has no captured thinking. |
| Waiting game | `warm-plum-song` returns empty history, no results link and `manualReread: true`, with valid reread follow-ups. Results return `not_completed`. There is no poll cursor for this historical waiting record; passing null is rejected by the input schema. |
| Visibility | Existing Unlisted `visual-operations-review` is absent from Public discovery and readable by known slug. Local read-only configuration inspection confirmed its Unlisted status. Existing Hidden `cold-wine-vale` is rejected by both shared game/results tools despite the producer grant, identically to an unknown game within each tool. |
| Invalid requests | Reusing a cursor for another game or audience returns `invalid_cursor`; a future thinking position is rejected; Werewolf thinking with public audience returns `invalid_input`. |
| Format boundary | Influence-specific `read_projection` rejects Werewolf with `unsupported_game_kind` and a shared `read_game` follow-up. |
| Rules | Both game kinds return their rules; Werewolf doctor search succeeds. |

No unexpected failures were observed. Negative cases above intentionally produce errors. This live pass does not test an in-progress append, token expiry/refresh, revocation, grants without producer, or the separate ChatGPT web UI; those authorization and append scenarios retain the isolated test evidence above. OAuth/HTTP regression immediately preceding this pass: 60 tests passed, with package typecheck and lint passing.
