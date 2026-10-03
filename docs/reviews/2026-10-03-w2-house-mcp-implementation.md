# W2 implementation and verification

Plan: [House MCP discovery and game inspection](../plans/2026-10-02-005-feat-house-mcp-game-inspection.md). Implemented in the Werewolf feature checkout from `d4d2afaf`. This report describes local proof, not deployment or acceptance inside a hosted MCP client.

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
- A real host connection, deployment and operator acceptance remain release checks. The legacy machine resource URIs remain stable; this is one House MCP service.

See [cross-game integration lessons](../solutions/architecture-patterns/house-mcp-across-game-kinds.md).

## Regenerating output contracts

`house-output-schemas.json` is generated from inferred service DTOs and the closed follow-up union. Runtime does not depend on the generator. The committed generator ran successfully against the final service contracts. Use a disposable pinned development install:

```sh
toolDir=$(mktemp -d /tmp/house-schema.XXXXXX)
bun add --cwd "$toolDir" --exact typescript-json-schema@0.65.1
bun scripts/generate-house-mcp-schemas.cjs "$toolDir/node_modules/typescript-json-schema"
```

The generator first requires the repository API typecheck. Its bundled older TypeScript parser is used only for schema emission; actual fixture outputs must still pass runtime validation. The script preserves typed string/number index signatures while closing fixed objects. Regenerate and run contract fixtures whenever a service DTO changes; do not hand-maintain a second DTO tree.
