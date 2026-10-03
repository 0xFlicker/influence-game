# W2 planning consistency and simplification pass

Plan: [House MCP discovery and game inspection](../plans/2026-10-02-005-feat-house-mcp-game-inspection.md). Reviewed against `ca0e04dc`, including W1 results. This is a source/document review, not runtime verification.

## Decisions retained

- One production MCP endpoint and resource identity; shared House names and spectator workflow, concrete game adapters underneath.
- Three small spectator reads distinguish ordinary history, explicit ending spoilers, and opt-in thinking. This avoids a single reader with incompatible permission, size and disclosure modes.
- Preserve existing private owner and producer tools. Public game visibility is not permission to remove their ownership checks.
- Reuse v7 history, W1 results and existing thinking eligibility instead of rebuilding game facts or interpreting prose.
- Keep game-native coordinates and typed links. Do not reuse Werewolf cursors across audiences or label Influence transcript IDs as replay sequences.
- Supersede the 2026-09-27 draft rather than leave competing implementation specifications. No new generic registry, database schema, OAuth resource or compatibility aliases.

## Failure scenarios addressed in the plan

1. A public spectator reaches private Influence dialogue through an owner tool: separate spectator access/serialization; unchanged owner grants; test the actual dispatch.
2. Opening the catalog spoils completed Werewolf: catalog excludes endings/roles for both games; current/results reads are explicit spoiler operations.
3. Early replay pages contain the final board: captured head, source-specific delivered bounds and prefix snapshots; separate Influence facts/dialogue lanes when no total order is established.
4. A live append skips or duplicates a page: drain pinned head first, then explicit polling; cursor bound to game/audience/filter/position.
5. A thinking request reveals an unresolved target or provider trace: reuse committed action eligibility and artifact integrity; Mystery denied even at completion; no native reasoning or strategy.
6. A waiting game looks corrupt: casting is a typed lifecycle result without a synthetic role assignment or missing-log error.
7. An unsupported game silently gets Influence defaults: explicit authorized wrong-kind responses for every specialized tool, including methods bypassing the central resolver.
8. A compact page still causes expensive full-history thinking scans: measure the maximum fixture; reuse traversal where justified, without making an optimization framework a prerequisite.
9. Private cursor/trace metadata leaks through a shared envelope: no owner/producer cursor reuse, raw event counts or broad DTO spread; exact output validation.
10. Results become unbounded or lose ballots: distinct result-size budget backed by the W1 maximum fixture; whole entries and explicit size failures.

## Access decision — resolved 2026-10-03

The operator approved Public discovery and direct lookup of known Unlisted games through the authenticated MCP. The shared predicate applies to both games; independent private-owner and producer permissions remain intact. See the [implementation review](2026-10-03-w2-house-mcp-implementation.md) for local proof.

## Implementation stop point

If Influence's public dialogue ordering/eligibility cannot be reused without a substantial refactor, report the concrete missing dependency before widening W2. Do not silently deliver a Werewolf-only external workflow or open the owner transcript API. W3–W7 and the production studio remain separate work.

No code tests were run for this documentation-only change. Local Markdown links and `git diff --check` were checked. The implementation plan specifies required unit, PostgreSQL, MCP-route, browser-link and host-acceptance proof separately.
