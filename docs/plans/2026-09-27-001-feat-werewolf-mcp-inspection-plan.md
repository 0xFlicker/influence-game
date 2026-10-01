---
title: "feat: Werewolf discovery and spectator inspection through MCP"
type: feat
status: deferred
date: 2026-09-27
scope: implementation-plan
source_commit: d9aea15f
---

# Werewolf discovery and spectator inspection through MCP

Follow-up contract note: rules version 3 adds unanimous pack negotiation and `pack_vote` audience entries. The planned reader must include whole resolved pack ballots in Omniscient, omit them in Mystery, and preserve audience-local cursors. Pending ballots and private rationale remain excluded. See [pack negotiation plan](2026-09-27-002-feat-werewolf-pack-negotiation-plan.md).

2026-10-01 disclosure update: the separate browser/API Thinking surface is Omniscient-only and explicitly opt-in, tied to committed replay positions. Mystery never receives thinking, even at completion. The default MCP spectator view in this plan remains free of thinking; a future explicit MCP thinking tool must use that same policy. Native provider reasoning traces and owner strategy remain separate private evidence. See [shared player integration](2026-10-01-001-refactor-shared-house-watch-player.md).

## Scheduling decision — 2026-10-01

Deferred as **A4-MCP** in [the pillar task map](../ideation/2026-09-30-house-admin-and-production.md#pending-work-and-ui-surface-map). Implement this frozen external contract after the gameplay/event iteration phase is ready for that commitment; refresh historical rules assumptions at that time. This work does not block shared House player integration. Reuse the existing MCP banner verbatim in Werewolf now, without capability qualifications or gating. UI surface locations and a future release-review checkpoint are recorded in the pillar document.

## Goal and execution boundary

An MCP client can find an accessible Werewolf game, understand its rules, see what is happening now, and read the match from the beginning or follow new discussion beats through the result. It can choose Mystery or Omniscient explicitly. The same authenticated MCP connection continues to inspect Influence correctly.

This is a plan, not authorization to implement it in this turn. The first implementation task is the small, persistent agent guideline below. Complete that task before implementation of the MCP feature. All implementation belongs in the existing `codex/werewolf` worktree; do not change the primary development checkout or create another worktree for this continuation.

Research inspected the clean Werewolf worktree at `d9aea15f`. That commit includes the Werewolf engine, API, browser viewer, separate strategy notes, and API simulation/report CLI. No runtime code, OAuth grants, game records, or live simulations change as part of writing this plan.

## Task 1 — retain the planning habit in AGENTS.md

Add this compact guideline under **Current Operating Context** in the repository's `AGENTS.md`, and retain it after the feature ships:

> Before implementing a cross-cutting change, trace the real call paths and write or update a plan in `docs/plans` covering affected producers and consumers, authority and access boundaries, contracts, dependencies, files, and verification. For game changes, explicitly audit API, CLI, web, and MCP discovery/inspection parity; identify unsupported surfaces instead of inheriting Influence defaults. Put reusable lessons in a short agent guideline when they will prevent the same omission.

This applies to changes crossing game/API/MCP boundaries; it does not require a new planning document for every small copy edit. The completed plan should supply concrete decisions and testable outcomes rather than leave implementers to rediscover the architecture.

**Done when:** the exact intent above is present in `AGENTS.md`, linked to this plan if useful, without copying the whole plan into the guide. This task is deliberately first and remains unchecked until implementation starts.

## What the code currently does

| Surface | Current behavior and consequence |
| --- | --- |
| MCP `list_games` / `resolveGame` | `game-mcp/read-model.ts` filters `games.gameKind = influence`. Its identity requires `gameKernel`, and list summaries assume Influence projections and individual winners. Removing the SQL predicate alone would misclassify Werewolf. |
| Ownership | `match-access-context.ts` authorizes creators or participating owners using `game_players` and `agent_profiles`. Werewolf creation writes the roster into the sequence-1 `werewolf.started` event, without Influence `game_players` rows. Creator claims already include Werewolf IDs, but participant roster resolution does not. |
| Werewolf spectators | `routes/werewolf.ts` serves both audiences for visible games. `readWerewolfView` replays the canonical log to an audience-local entry cursor. `projectWerewolfView` allowlists speech, whole discussion reveals, night/vote resolutions, and results. Roles appear in Mystery only at completion. Neither audience includes strategy or `thinking`. |
| Discussion | A shared reveal is one public entry. Individual accepted actions and partially committed beats remain private. A pass is typed `text: null`; provider unavailability is separate. Six beats, four messages, and the opening all-pass grace beat are already implemented. |
| MCP rules and archetypes | `get_rules` / `search_rules` know only Influence. Their DTOs assume Influence rating provenance; `list_archetypes` optionally returns an unqualified Influence `strategyHint`. |
| Agent management | `create_agent` / `update_agent` already accept `werewolfStrategyStyle`; owned-agent serialization returns it. Shared identity and game-specific notes must remain separate. This feature does not redesign the editor or introduce learning for Werewolf. |
| MCP discovery | Tool dispatch and schemas live in `server.ts`; a separate closed registry in `tool-authorization.ts` controls eligibility and invocation. Initialization instructions, game resources, and the MCP App call the surface Influence-only. Updating just the handler does not make a tool discoverable. |
| Inspection bypasses | Match manifest/transcript/cognition/narrative methods call Influence services directly rather than `requireGame`. `inspect_durable_run` also calls an Influence-specific service directly. These need explicit kind boundaries. |
| Shared producer reads | Cost reads use the shared provider spend ledger; private trace reads resolve any game ID/slug. They do not all pass through the Influence-only resolver. Their existing scope/role gates must remain intact; do not assume every producer tool is unavailable for Werewolf. |
| Local stdio MCP | `packages/engine/src/game-mcp/` reads Influence simulation artifacts. The API-backed CLI uses HTTP plus the shared login, not that artifact reader. Extending local artifact MCP is a separate task. |

## Selected product and contract decisions

### 1. One endpoint, explicit game kinds

Keep the existing `/mcp` endpoint, OAuth resource, and deployed game resource address. Update user-facing names and instructions to **The House**, with explicit Influence/Werewolf labels. Existing machine addresses are the active resource, not a second compatibility route; add no aliases or parallel MCP server.

Extend `list_games` with optional `gameKind: "influence" | "werewolf"`. Omission lists both. Keep the bounded recent-game purpose: default 20, maximum 100, newest first with a deterministic ID tie-break. Apply the kind and access predicates **before** the global sort/limit; do not take separate per-game quotas and concatenate them.

Return schema version 2 with a closed discriminated union of list entries:

- Common catalog identity: `id`, `slug`, `gameKind`, catalog status, player count, track/rating labels, creation/start/end timestamps, and typed next-read arguments.
- Influence variant: its existing classic/format kernel and projection diagnostics remain Influence-owned.
- Werewolf variant: preset, rules version, projected day/phase, living count, and a safe read-status indicator. Never invent `gameKernel: classic`, an individual winner, a jury, or an Influence event-log status.
- Werewolf listing is spoiler-free in both subject and producer discovery: no roles, wolf count remaining, winning faction, private action counts, raw event sequence, or full dialogue. The preset itself legitimately identifies the initial role composition.
- A missing, corrupt, or unsupported Werewolf log produces an unavailable summary for that authorized row, without failing all other games or silently reporting a healthy empty history. Keep internal error details in server diagnostics.

Use a separate catalog/list union rather than widening the Influence identity and then forcing every Influence consumer to accept Werewolf. Name the Influence-only resolver/identity explicitly. Update all consumers of the list envelope in the same change; do not serve the obsolete list shape alongside version 2.

### 2. Preserve MCP access semantics; audience is a viewing choice

Use existing `games:read` access for a subject's created or participating games, and the existing `producer` alternative for global inspection. Do not turn `list_games` into public discovery of every Werewolf game for ordinary users merely because the browser viewer is public.

Add a small Werewolf spectator-access helper shared by list and direct read. It resolves creator access from `games.created_by_id` and participating profile ownership from the frozen start-event roster's `agentProfileId` joined to current profile ownership. In today's creation flow, selected profiles must already belong to the creator, so creator access covers all normal games; the roster check preserves the existing participant semantics without inventing Influence player rows.

- Use only the sequence-1, correctly typed start roster for membership checks, never model prose or a full private-log scan for discovery. Query authorization before counts/limits; use database `EXISTS`/joins or a bounded equivalent over the start rows, not per-game application scans of the entire corpus.
- Recheck access for every page/poll. Hidden Werewolf games are excluded from ordinary spectator listing/reading, matching the web visibility boundary. Producer access may inspect them explicitly through its existing global gate; the result remains a spectator allowlist.
- Unknown IDs/slugs and inaccessible games have the same subject-facing failure. Only an authorized caller receives a wrong-game-kind hint.
- Both **Mystery** and **Omniscient** are spectator views under the same game-access permission. Omniscient is already public in the Werewolf product; it does not require a producer grant.
- Neither view returns frozen strategy notes, seed, private `thinking`, prompts, provider payloads, raw `werewolf.action_accepted` events, or observation hashes. Having producer credentials does not silently change the requested audience or add private fields to this reader.
- Preserve the owner-only nature of existing owned-cognition/narrative tools, even when the bearer also has producer scope. Do not route them through a generic producer bypass while adding kind checks.

There is no new OAuth scope, role, consent screen, bearer exchange, or credential requirement in this feature. Add the reader to the existing shared game-read catalog alternative and retain current role/client/grant revalidation and challenge behavior.

### 3. One Werewolf tool for current inspection and replay

Add `read_werewolf_game`, backed by a protocol-neutral spectator page builder and the existing rules/projection authority.

| Input | Contract |
| --- | --- |
| `gameIdOrSlug` | Required non-empty bounded string. Resolve to canonical ID before reading/cursor checks. |
| `audience` | `mystery` by default, or explicit `omniscient`. |
| `mode` | `current` by default, or `replay`. |
| `limit` | Integer 1–20, default 10, counting whole audience entries. |
| `cursor` | Optional versioned continuation object; allowed only with `mode: replay`. Bound to canonical game ID and audience. |

**Current mode:** return the current board plus the most recent bounded window of visible entries. This answers “what is happening?” in one call after discovery. State and recent history come from one captured ledger snapshot. Read catalog status, access metadata, and that ledger in one read-only repeatable-read transaction (or an equivalent single database snapshot), then close it before formatting. A completed current view includes its result and role reveal; the descriptor must say so. Return typed starters for replay-from-start and follow-from-this-position.

**Replay mode:** no cursor means start at the beginning. Pin the audience's visible head for the page traversal. Return the next bounded slice and a board rebuilt at that slice's **ending** cursor. Never attach the final game's roster roles, living status, votes, or outcome to an earlier page. This also applies to readback of a game that has already completed.

Use a small public cursor object, for example `{ version: 1, gameId, audience, after, through }`. Positions count allowlisted audience entries, not raw event sequences. `through` is a pinned visible boundary for pagination; `null` requests a fresh head for catch-up. These are public offsets, not credentials or private ownership claims, so do not add a new encrypted cursor framework or modify Influence's `mr2` codec.

- Validate every field and cross-field relationship at runtime: game/audience match, safe non-negative integers, `after <= through <= visibleHead`, supported version, and no unknown fields. Reject mixing `current` with a cursor. Return a typed invalid-cursor/input result; do not silently clamp it to the live ending.
- Zero is the initial entry offset, not a fabricated pre-game board. The first page includes the initial introduction entry; a pinned `through` must be an actual published view boundary. Reject a forged empty boundary before that first view rather than copying the REST helper's lower-bound clamping into the MCP contract.
- `nextCursor` continues a pinned page traversal. When caught up and the game remains active, `pollCursor` starts after the delivered boundary with `through: null`. If a poll finds nothing new, return an empty entry list and the same public position. Do not emit a partial beat, duplicate previous speech, or infer provider progress.
- Completed/cancelled/suspended games can still drain their accepted visible history. Once drained, no poll cursor is offered. Only a canonical Werewolf result establishes a faction win or day-limit draw; a catalog stop status does not.
- Switching audiences starts a fresh traversal. A Mystery cursor cannot be reused for Omniscient, since their visible histories have different positions.
- Enforce a 64 KiB serialized structured-payload budget as well as the entry limit. Stop before an entry that would exceed the budget; never split a discussion beat or silently truncate speech. Verify that the maximum legal eight-player reveal fits as a single entry; return a typed size error rather than dropping data if an exceptional entry cannot fit.

The success output has a closed schema: `schemaVersion`, `gameKind: werewolf`, safe catalog identity/status, audience, mode, projected board at `viewCursor`, whole typed entries with audience-local positions, visible through/latest positions, continuation/poll cursors, and schema-valid follow-ups. Reuse the engine's role/phase/preset/result vocabulary. Keep catalog status distinct from historical board phase/outcome.

An entry contains only the existing audience projection facts: introductions/pack speech when allowed, a complete discussion beat with null passes and unavailable markers, message budgets/end reason, resolved night outcomes, individual day ballots/totals/elimination, and faction result including dead teammates. Include all eliminated players in the roster for name resolution.

Provide a compact deterministic text summary with the structured result, following the existing postgame response pattern rather than copying the entire JSON twice. Reuse `werewolfReportEntry` when formatting returned entries, never an LLM summarizer. Mark dialogue and names as untrusted game-authored content; derive executable follow-ups exclusively from typed server state. A spoken “I am the Seer” is dialogue, not a role fact.

Declare exact `inputSchema` **and** `outputSchema`, validate the decoded inputs and emitted result, and cover the success and typed failure variants. JSON-schema descriptors alone do not validate runtime arguments. Do not add permissive `any` object contracts or `as any` casts.

### 4. Rules and defaults must describe the selected game

- Make `gameKind` required for `get_rules` and `search_rules`; remove the implicit Influence selection and update first-party callers/examples/tests. Both results advance to schema version 3 with an explicit game tag. Missing/unknown game kind is an input error.
- Keep Influence sections, formats, competition/rating provenance, and endgame rules inside the Influence variant.
- Add Werewolf sections for the six/eight-seat presets, faction victory, Seer/Doctor/pack knowledge, simultaneous night actions, public discussion, six beats/four messages, opening all-pass grace, legal votes/ties, death, day-limit draws, role visibility, and distinct strategy notes. State that Werewolf does not have Influence Mingle, formal alliances/huddles, jury, ratings, or owner-learning reviews.
- Source factual constants and default strategies from `werewolf/rules.ts` and `werewolf/strategy.ts`; do not create another balance/config authority or mutate gameplay prompts as part of this work.
- Keep `list_archetypes` a shared-character discovery tool. Its result advances to schema version 2. When strategy hints are requested, replace its ambiguous single `strategyHint` with game-keyed `strategyHints` for Influence and Werewolf, reusing the existing defaults. Preserve the selectable-archetype restriction; do not make `broker` selectable merely because the House can use it.
- Clarify `strategyStyle` and `werewolfStrategyStyle` descriptions in agent create/update schemas. Verify existing get/update receipts preserve the other block and immutable character identity; do not add new profile columns or an editor flow.
- Label existing enrollment, Analytical Revision, rating and learning metadata as Influence-specific. Werewolf freezes its content/strategy in the start event; an Influence-only `activeEnrollment` or `frozenSeats` receipt is not evidence about whether a Werewolf character is currently playing. Adding Werewolf career/enrollment receipts is outside this spectator slice.
- Make game rules available to the same existing game-read alternatives as the new reader, including producer-only grants. This requires updating both rule descriptors and their closed registry entries/dispatch guards; it does not make producer scope implicit in an ordinary grant.

### 5. Unsupported tools must fail accurately

Audit every route accepting a game ID, including methods that bypass `requireGame`. After access has been established, an Influence-only tool called with Werewolf returns a typed `unsupported_game_kind` error with a safe `read_werewolf_game` follow-up. Do not describe an accessible Werewolf match as missing/corrupt merely because it has no Influence rows.

| Family | Decision for this slice |
| --- | --- |
| `list_games`, game resource, MCP App | Both games, tagged, bounded, correct next reader. |
| `read_werewolf_game` | New audience-safe current/replay reader. |
| `get_rules`, `search_rules`, archetype hints | Explicit game context and correct defaults. |
| `read_projection`, `read_round_facts`, `filter_events`, `player_timeline`, alliance reads | Remain Influence-only; explicit authorized wrong-kind response. Raw Werewolf events are not safe substitutes for these DTOs. |
| `read_game_brief`, jury/player summaries, turning points, producer postgame analysis | Remain Influence-only; Werewolf result comes from its reader. |
| Match manifest/transcript/owned cognition/owned and producer narratives; cognitive artifact tools | Remain Influence-only. Guard direct service dispatch; no fabricated empty Werewolf transcript/cognition health. Owner-only authorization remains owner-only. |
| `inspect_durable_run` | Guard as Influence-only in MCP. Werewolf does not use Influence XState snapshots/checkpoint passports. Its true durable inspector is a separately scoped follow-up, not a fake successful inspection here. |
| Cost detail and trace/provider-evidence reads | Preserve shared producer-only behavior. Add Werewolf fixtures proving the shared spend/evidence path and current role checks. No new public cost/thinking fields or a second accounting implementation. |
| Seasons, queue/open-game enrollment, agent game/season history, learning, visual production | Explicitly Influence features where applicable. Keep queries/exclusions and descriptors aligned; do not add Werewolf competition history or global enrollment through this change. |
| New game/start/stop/speak/pass/vote/night-action tools | Not added. MCP's active-match control prohibition remains. API simulation/game creation are separate authorized flows. |

Some of the existing typed service result unions cannot express `unsupported_game_kind`. Handle the new error at the MCP adapter boundary with a consistent JSON-RPC error-data shape, rather than widening unrelated domain result contracts merely to redirect a tool. Authorization must run first, and malformed inputs retain their input-error behavior.

## Module and dependency map

Paths below are repository-relative. **New** indicates a proposed file, not an existing implementation.

| Files/modules | Planned responsibility |
| --- | --- |
| `AGENTS.md` | Task 1 guideline, retained after delivery. |
| `packages/api/src/game-mcp/read-model.ts` | Split catalog identity from Influence inspection identity; mixed list dispatch; new Werewolf reader adapter; authorized wrong-kind guards at all direct/indirect entry points. |
| `packages/api/src/game-mcp/server.ts` | Tool dispatch/descriptors, initialization instructions, resource labels and payloads, strict argument parsing, result validation/text rendering, typed wrong-kind error mapping. |
| `packages/api/src/game-mcp/tool-authorization.ts` | Register Werewolf read and shared rules alternatives; retain request-local catalog eligibility and invocation scope/role enforcement. |
| `packages/api/src/game-mcp/werewolf-contracts.ts` **new** | Closed spectator/cursor/result schemas, parsers/assertions, and typed follow-up mapping. Keep Werewolf fields out of Influence match contracts. |
| `packages/api/src/game-mcp/contracts.ts` | Existing exports/shared conventions only where needed; do not attach Werewolf to Influence match-completeness or cognitive schemas. |
| `packages/api/src/services/werewolf-read-access.ts` **new** | Subject/producer spectator access and matching SQL discovery predicate, including visible/hidden handling and frozen-roster profile membership. No private cognition grant. |
| `packages/api/src/services/werewolf-spectator-read.ts` **new** | Captured-ledger current/replay pages, whole-entry/byte bounds, prefix board, cursor validation and terminal/live continuation. Protocol-neutral, no MCP tool names. |
| `packages/api/src/services/werewolf-games.ts` | Reuse/factor existing event loading and prefix-view logic so REST and MCP retain one interpretation. Expand narrow DB parameter types if a read transaction requires it. |
| `packages/engine/src/werewolf/observation.ts`, `types.ts`, `rules.ts` | Existing authority reused as-is where possible; only a small reusable projection helper if necessary. No rules/version/gameplay change. |
| `packages/engine/src/werewolf/report.ts` | Reuse deterministic audience-entry rendering; no new model calls or prose parsing. |
| `packages/api/src/game-mcp/rules.ts` | Game-tagged rule variants/search and game-keyed archetype strategy hints. |
| `packages/engine/src/werewolf/strategy.ts`, `packages/api/src/services/agent-archetypes.ts` | Existing sources of Werewolf defaults and valid shared archetypes. |
| `packages/api/src/game-mcp/agent-tool-schemas.ts`, `server.ts`, `services/agent-profile-management.ts` | Audit both strategy blocks in descriptors/owned responses; change only missing contract declarations/copy, not profile semantics. |
| `packages/api/src/game-mcp/app-resource.ts` | House/game-kind labels, mixed-list envelope consumption, no assumption of a single winner or classic/format on every entry. Consume the new declared list shape consistently from structured content or its text encoding; remove obsolete list-shape fallbacks. Keep the app a small discovery surface. |
| `packages/api/src/game-mcp/claims.ts`, `services/match-access-context.ts` | Existing Influence creator/owner policy to preserve. Do not insert Werewolf seats into this Influence private-lane context to make listing work. |
| `services/game-durable-run.ts`, `match-completeness.ts`, `match-*-read-model.ts`, `postgame-analysis.ts`, `cognitive-artifact-read-model.ts` | Audit direct entry points and preserve domain ownership. MCP guards prevent unsupported invocation; do not rewrite these services for Werewolf. |
| `services/admin-game-cost-detail.ts`, `provider-cost-accounting.ts`, `private-trace-read-model.ts`, `provider-call-journal.ts` | Shared operational evidence dependencies. Verify Werewolf IDs/actions stay readable under producer authorization; retain existing accounting/capture behavior. |
| `packages/api/src/routes/werewolf.ts`, `packages/web/src/lib/werewolf-api.ts`, `packages/engine/src/werewolf/api-simulate.ts` | Existing HTTP/viewer/CLI consumers for projection regression comparison. No new UI/game-creation feature or CLI auth change. |
| `packages/engine/src/game-mcp/` | Influence local artifact reader remains outside scope; document the distinction from Production MCP. |

No new package, database migration/backfill, event capture, feature flag, transport, provider call, or deployment service is required. Use existing Bun/TypeScript, Drizzle/PostgreSQL, projection types, and MCP schema/test utilities. Authorization reads the existing frozen start roster; a new generic game-plugin or cursor framework would add work without serving this slice.

## Ordered implementation tasks

1. **Persist the agent guideline.** Apply the exact intent in Task 1 before feature edits.
2. **Define and test the contracts/access boundary.** Add catalog discriminants, the small spectator access helper, closed Werewolf DTO/cursor/error schemas, and role/kind/visibility fixtures. Settle these shapes before wiring handlers.
3. **Build and prove the spectator page service.** Current view, historical prefix state, shared-beat pagination, catch-up and terminal behavior, output budgets, missing/corrupt/version errors. Use scripted Werewolf events and shared projection assertions; no provider calls.
4. **Wire discovery and the reader end to end.** Mixed `list_games`, new tool registry/descriptor/dispatch, resource payload, safe typed next reads, and MCP App consumption. At this point list → read → follow works locally under normal `games:read`.
5. **Complete containment and rules parity.** Explicit rules selection, strategy hints, initialization guidance, Influence-only guards, producer shared-evidence regression checks. Recheck every tool family in the table, not just methods using `requireGame`.
6. **Update docs and validate the complete path.** Run focused tests and required checks; perform a read-only local MCP smoke against an existing game when an appropriate token is available. Record actual evidence boundaries, update this plan's checklist, and retain the guideline.

Tasks 2–3 are prerequisites for 4; 4–5 are prerequisites for the final smoke. Keep each increment working; do not publish a descriptor before its handler, registry, scope checks, and valid output are wired. Deployment is the release gate.

## Verification plan

### Focused regression files

- Add `packages/api/src/__tests__/werewolf-mcp.test.ts` for scripted Werewolf fixtures, reader paging/access, cross-game dispatch and schema-valid results. Use `setupTestDB()` before mutations and sequential tests.
- Extend `production-game-mcp-read-model.test.ts`: mixed global ordering/limit, kind filters, Influence projection parity, creator/participant discovery, unrelated subjects, hidden rows, bad Werewolf log isolation, and explicit redirects from unsupported tools.
- Extend `production-game-mcp-server.test.ts`: new/changed catalog descriptors and schema versions, runtime malformed-input rejection, scope mirrors, annotations, eligibility/grant distinction, typed next-read/error arguments, resource response and app labels. Reuse its schema assertion helpers and test actual handler output, not only handcrafted schema examples.
- Extend `mcp-http-route.test.ts` and the relevant authorization tests: valid `games:read`, producer-only, eligible missing grant, ineligible client/role, role revocation, unknown tool, and active-match action denial. Ensure no read model runs before authorization.
- Extend `game-mcp-rules.test.ts`: required game selector, isolated search, exact Werewolf budgets/grace/ties/presets, no Influence jury/ELO in Werewolf, valid selectable archetypes and independent hints.
- Extend `producer-game-cost-mcp.test.ts` and existing trace tests with Werewolf-tagged spend/evidence fixtures; no real provider/storage calls.
- Reuse `werewolf.test.ts` (API and engine), `werewolf-api-simulate.test.ts`, and `werewolf.e2e.test.ts` if shared prefix/projection code changes. Their REST/CLI/web contracts must remain correct.

### Required behavioral cases

1. A six-seat all-House game created by the subject is discoverable without any `game_players` rows; a selected owned-profile game is also discoverable. Another subject cannot enumerate either via list, slug, guessed ID, error detail or cursor. Producer discovery covers both under its actual grant.
2. Mixed Influence classic/format and Werewolf results retain correct game-specific identities. Selecting one kind applies before the shared limit. Listing does not reveal Werewolf roles or winner.
3. Same canonical game in both audiences: Mystery excludes live roles, pack speech, attack/protect/check targets and rationale; Omniscient includes authorized role facts/pack dialogue but still excludes rationale, strategy, seed and provider evidence.
4. Completed-game replay page 1 has prefix-correct roles/alive status/outcome. Only the page reaching the result reveals Mystery roles. Current mode explicitly returns the completed ending.
5. A shared beat at a page boundary stays whole; partial accepted actions advance neither audience's public cursor. Null passes, unavailable responses, message budgets, quiet-opening grace, and discussion end reason survive serialization exactly.
6. Small pages reconstruct the same audience timeline as one existing REST projection: no duplicate/omitted entries, no reordering, and no final-state leakage. A growing live game drains a pinned prefix before catch-up; repeated empty polls remain stable.
7. Reject negative/fractional/future positions, wrong game or audience, contradictory cursor bounds, unknown properties, wrong cursor version, invalid limit/mode and oversized payloads. Validate runtime output against advertised schema.
8. Day-vote ties, no night death, village victory, wolf parity, dead faction winners, day-cap draws, cancellation and suspension produce accurate distinct results. No Influence settlement or jury assumptions apply.
9. Missing/corrupt/unsupported-rule logs report an honest read error; no mutation, hidden-data fallback, zero-event “healthy” report, or inferred result from prose.
10. Creator-only access never becomes owner-private cognition access. Every unsupported Influence reader and `inspect_durable_run` returns an authorized wrong-kind response instead of a false empty/invalid Influence view. Shared producer cost/trace reads still require their original gates.
11. Dialogue containing fake roles, fake vote counts, MCP tool names, or instructions changes no structured facts, cursor, access decision, or follow-up tool arguments.

Run the repository baselines from the worktree with Bun:

```sh
bun run test
TEST_DATABASE_URL=postgresql://influence:influence@127.0.0.1:54320/influence_werewolf_test bun run test:postgres
bun run check
```

Use the existing dedicated test database, not `influence_dev`. Restore only harness-generated Next type/config changes if a browser run produces them. Do not generate a fresh paid match as a substitute for deterministic tests.

For the final read-only local smoke, use the existing game and a legitimate token with `games:read`: initialize → discover descriptors → `list_games({ gameKind: "werewolf" })` → current reader → replay pages → one catch-up → explicit Omniscient read → rules for Werewolf. Compare to that same game's API viewer. Separately prove producer-only diagnostics with an authorized producer token, if available. Token availability is a smoke-test prerequisite, not a reason to broaden scopes or bypass consent. Verify fresh `tools/list`; a host's cached connector catalog is not proof that the server omitted a tool.

### Documentation that ships with the implementation

- `docs/werewolf.md`: replace the blanket MCP exclusion with actual supported and unsupported surfaces, current/replay examples, audience/cursor behavior, access boundary, and preserved management prohibition.
- `docs/game-mcp-production-oauth.md`: game-kind listing, reader/rules contracts, existing scope alternatives, shared-versus-Influence diagnostics, mixed game resource/App, no new grant requirement.
- `CONCEPTS.md`: Production Game MCP now covers both game kinds; define spectator audience versus producer access and audience-local read cursor.
- `README.md`, `DEVELOPMENT.md`, `docs/local-model-evaluation.md`, `docs/reasoning-transcript-observability.md`: concise MCP follow-along/readback examples, no extra inference, no private thinking through the spectator reader.
- `packages/engine/src/simulate.ts` JSDoc: update the inspection pointers if reporting paths change; keep direct House calls and no-`as any` discipline visible. Do not imply the Influence artifact MCP now reads standalone Werewolf logs.
- `docs/solutions/architecture-patterns/separate-werewolf-game-authority.md`: replace the blanket MCP exclusion with explicit game-kind dispatch and retained Influence-only tools.
- `docs/solutions/architecture-patterns/production-mcp-role-resource-split.md`: retain the existing scope/resource/management boundaries and add the spectator-audience distinction.
- Original Werewolf plan plus this plan: record the new supported surface and real validation, without rewriting earlier proof as live/deployed evidence.

## Acceptance and limits

- [ ] Task 1 guideline is in `AGENTS.md` and retained.
- [ ] List → current inspection takes two MCP calls and clearly identifies Werewolf/player count.
- [ ] Full replay and live catch-up are bounded, complete, audience-correct, and restartable from returned cursors.
- [ ] Rules and default strategy guidance match the selected game.
- [ ] Existing Influence reads and ownership/private-data boundaries still pass.
- [ ] Every game-ID tool is supported or explicitly contained; shared producer tools are not accidentally disabled.
- [ ] Schemas, descriptors, resources/App, docs and runtime outputs agree.
- [ ] Deterministic checks pass; local MCP smoke status is recorded separately from deployment and live-model quality.

This slice does not add Werewolf MCP game creation/control, owner thinking/learning, individual career/season statistics, a new durable inspector, standalone artifact MCP support, or changes to agents' willingness to speak. Those are distinct product/implementation decisions. No balance or dialogue-quality claim follows from MCP readback working.

## Relevant prior designs

- [Werewolf rules and operations](../werewolf.md) and [original Werewolf plan](2026-09-26-001-feat-werewolf-game-mode-plan.md).
- [MCP role/resource boundary](../solutions/architecture-patterns/production-mcp-role-resource-split.md) and [production OAuth contract](../game-mcp-production-oauth.md).
- [MCP match completeness](2026-07-20-002-feat-mcp-match-completeness-plan.md): separate facts, dialogue, owner cognition, and producer evidence; authorize before pagination.
- [Format-kernel MCP readability](2026-07-24-002-feat-format-kernel-mcp-readability-plan.md): typed identities and game-specific output, without importing its Influence kernel or compatibility assumptions into Werewolf.
- [Werewolf authority separation](../solutions/architecture-patterns/separate-werewolf-game-authority.md): frozen strategy/roster, whole-beat publication, and spectator allowlists.
