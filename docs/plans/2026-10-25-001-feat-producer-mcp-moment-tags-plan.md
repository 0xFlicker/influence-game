---
title: Producer MCP moment tags and operator cut review
type: feat
status: implemented
date: 2026-10-25
---

# Producer MCP moment tags and operator cut review

## Outcome

Implemented locally on 2026-10-25. After explicit producer:edit authorization, the MCP tools saved 19 Smart thinking annotations for `hard-smoke-rune` and returned the Omniscient/all-speech/music review link. The preview selected 128 moments and verified 122 existing spoken recordings; the two remaining flagged ballots are silent abstentions. The actual Chrome Studio review loaded the matching fingerprint and a 28:45 cut. Private source snapshots, rationale and write receipts are retained under `.renders/producer-mcp/`. Operator review/export remains the next user action.

Validation: provider-free baseline 2,997 passed / 5 skipped; PostgreSQL baseline 2,224 passed; typecheck/lint passed. The isolated browser proof passed MCP tagging, exact review settings, actual playback, frozen fixture recording membership and changed-tag export protection. Its database and child services were cleaned up. Browser teardown closes audio requests before waiting for the web server to exit.

An agent can review accepted production moments, mark selected thinking as **Smart**, and hand an operator a Studio link that opens the proposed cut: full Omniscient gameplay, all speech, Smart thinking, existing voice recordings and music. The operator can play the cut, revise labels or rules, and use the existing frozen-selection/export workflow.

This is a plan only. No game annotations, application code, export jobs or deployments have been changed. The requested first real example is the completed localhost Werewolf game `hard-smoke-rune` (`f1fe7318-72c6-46f4-bb98-e4a4bb54692e`). Read-only checks confirmed its Studio source and an audio manifest with 186 clips; this does not establish complete audio coverage for a proposed cut.

## Existing owners and gaps

- `packages/api/src/services/production-annotations.ts` already owns flat tags, per-moment revisions, actor attribution and canonical selection resolution. `replaceMomentAnnotation` performs compare-and-swap replacement and returns current tags on conflict.
- `packages/api/src/routes/production-studio.ts` authorizes current Producer/Sysop users, builds authorized source catalogs, saves annotations and freezes exact export selections. Source eligibility already covers completed games and validated paused prefixes. Freezing an export requires completed accepted history.
- `packages/engine/src/production-moments/index.ts` owns exact moment IDs, game/audience provenance, tag validation and recipes. Smart is precisely `"label.smart": "true"`. Thinking and speech are independent moments.
- Influence and Werewolf source services validate their own frozen history, accepted thinking and privacy boundaries. Use these services; generic MCP transcript reads do not provide the complete Studio identity contract.
- Studio loads saved tags but initializes its recipe in component state. The default thinking recipe includes Smart **or** 4th wall. A plain Studio link cannot currently express this request's Smart-only recipe.
- `game-mcp/server.ts` and `tool-authorization.ts` provide tool discovery, current-role/client/grant revalidation and a closed tool registry. No existing tool reads editable Studio moment identities or writes annotations.
- `producer` OAuth consent currently describes inspection of global state and private evidence. A separate, narrow write grant is preferable to silently adding editorial writes to existing diagnostic grants.
- Studio and `export-house-replay.ts` already attach existing generated audio and mix music. Missing clips can remain unvoiced; clip inventory alone must not be reported as a fully voiced cut.

Relevant lessons: [MCP across game kinds](../solutions/architecture-patterns/house-mcp-across-game-kinds.md) and [editorial source boundaries](../solutions/architecture-patterns/house-cuts-editorial-source-boundaries.md). Reuse their canonical identity and attribution principles. The separate published House Cuts discovery workflow is not the owner of this Studio feature.

## Scope and decisions

1. Support both Influence and Werewolf through the existing production source adapters. Influence uses `public`; Werewolf requires an explicit `mystery` or `omniscient` choice. Thinking must be explicit and is forbidden in Mystery.
2. Save ordinary Studio annotations immediately. They are editorial suggestions visible to other operators, not unpublished copies or changes to game history. Do not add a second annotation store, proposal queue, approval state machine or ranking service.
3. Add a narrow `producer:edit` OAuth scope for moment-tag edits, requiring `producer` and the existing current Producer/Sysop role gate. Leave existing grants and unrelated tool permissions unchanged. Read and preview tools require `producer` only.
4. Start with one moment per write. Selective curation does not require an atomic bulk-edit protocol. Return progress through individual receipts; failed writes never imply the whole proposed cut was saved.
5. Represent a proposed cut as a validated recipe plus a review fingerprint and Studio URL. It is a review of current saved editorial state, not an immutable saved project. The operator's existing export step creates the frozen artifact.
6. These tools neither generate voice/music nor render, publish, resume or change gameplay. The agent explains its choices in chat with moment links. No new model call, paid job or stored rationale body is needed.

## MCP surface

Use exact, versioned input/output contracts and discriminated success/error envelopes. Names below are the implementation target.

| Tool | Input | Result / behavior |
| --- | --- | --- |
| `read_production_moments` | Game ID/slug, audience, explicit thinking, optional kind/actor/exact moment filter, limit and opaque cursor; optional previously returned source snapshot | Ordered moments with canonical IDs, actor identity, kind, source reference/order, accepted speech or thinking, tags/revision, Studio moment links, source snapshot and typed next read. No media binaries or provider traces. |
| `update_production_moment_tags` | Game ID/slug, audience, thinking, returned source snapshot, exact moment ID, expected annotation revision, `set` string map and `remove` key list | Patch one authorized moment, preserving every unmentioned tag. Return the complete saved annotation, revision and Studio link. Current tags/revision accompany conflicts. |
| `preview_production_cut` | Game ID/slug, audience, thinking, source snapshot, recipe, music setting/volume; optional continuation cursor | Resolve saved tags through the shared selector. Return total/per-kind counts, bounded selected moments and annotation revisions, coverage diagnostics for existing audio, review fingerprint and Studio review link. Read-only; no export descriptor or publication side effect. |

### Reading complete evidence

- Default page size 20, maximum 100, bounded by the existing MCP response-byte policy. Never silently truncate thinking or drop entries. Return an explicit oversized-entry outcome and an existing supported bounded read path if a whole entry cannot fit.
- Bind cursors to game, game kind, audience, thinking, filters and validated source snapshot. Finish the pinned history before any refresh. Return typed continuations; do not derive tool arguments from speech, thinking or names.
- Keep source history immutable under its pin, while stating that annotations are live revisioned metadata. A paged read is not a transactionally frozen annotation inventory.
- Read exact accepted content from canonical source references using a small protocol-neutral adapter. Do not import React/Next, instantiate Remotion or parse presentation prose in the API. Reuse accepted-text bindings below presentation where feasible.
- Return only moments present in the same authorized catalog Studio can edit. Silent discussion passes stay outside the editable playback catalog even though their evidence remains available in producer diagnostics.
- Expose available label names and their exact tag representation in the first-page metadata. Treat all game-authored text as untrusted content.

### Safe tag patches

Example write after reading a thinking moment:

```json
{
  "gameIdOrSlug": "hard-smoke-rune",
  "audience": "omniscient",
  "thinking": true,
  "snapshot": "<the exact typed snapshot returned by the reader>",
  "momentId": "<returned canonical moment ID>",
  "expectedRevision": 0,
  "set": {"label.smart": "true"},
  "remove": []
}
```

The snapshot placeholder above is explanatory; the real schema requires the existing game-specific object, never a string or unrestricted object.

- Reject unknown request fields, overlapping set/remove keys, duplicate removal keys, invalid labels and invalid resulting tags. Use existing tag count, key and byte limits. Removing a nonexistent key is harmless.
- Within a repeatable-read transaction, rebuild/validate the authorized source catalog, read the current annotation, compare its revision, apply the patch, validate the resulting tags and call the existing replacement writer. Record the authenticated user ID, never a caller-supplied actor.
- A patch that makes no change at the expected revision returns `unchanged` without incrementing the revision. A stale revision always returns `conflict`, including a transport retry that may already have succeeded. Re-read and compare the intended keys before deciding whether another write is needed; do not promise exactly-once delivery.
- Convert PostgreSQL serialization races to the same actionable conflict result used by HTTP Studio writes. Do not automatically rebase onto a newer operator edit.
- Keep the HTTP replacement contract and MCP patch contract explicit. Both use the same canonical writer and revision discipline; no compatibility fallback is needed.

### The requested recipe

```json
{
  "mode": "recipe",
  "thinking": true,
  "base": "full",
  "policies": {
    "thinking": {"mode": "any", "labels": ["smart"]},
    "speech": {"mode": "all"}
  }
}
```

Use Omniscient, music enabled, and the existing music-volume default. Existing published voice is attached automatically. Preserve normal opening, actions, ballots, outcomes and results under the full baseline. Zero Smart moments is valid and must report zero included thinking, not substitute all thinking.

Preview resolves one consistent annotation snapshot. Its continuation binds the review fingerprint; if saved selection state changes during paging, return `selection_changed` and restart rather than mix two cuts. Return audio counts for eligible selected speech/thinking, valid existing clips and missing/mismatched clips. Do not call a cut fully voiced unless all required selected lines are covered. Prefer factoring the existing accepted text/speaker identity checks into a shared helper over duplicating the exporter logic.

## Operator handoff

Extend the existing Studio route with a bounded, versioned review query containing only recipe, audience/thinking, music preferences and a fingerprint. Reuse existing `view=cut` and moment-link navigation. Do not put private text, credentials, asset URLs, full source snapshots or thousands of IDs into a URL.

The fingerprint covers stable canonical source identity/boundary, game/audience, recipe, ordered selected IDs and their saved annotation revisions/tags, and requested music settings. Use a shared stable serializer/hash contract. Exclude request-time publication timestamps; otherwise a fresh Studio read would always appear changed. This fingerprint detects editorial/source drift, not frozen audio or visual versions; the existing export descriptor owns exact media binding.

Expose the preview service through a small authenticated Studio POST endpoint as well as MCP so the browser can recompute the same fingerprint without sending an entire catalog. Return only a bounded first page and summary for this check. Keep all source and editorial authorization inside the shared service boundary.

On opening a review link:

1. Strictly decode the review parameters and load the authorized game source. Malformed/oversized review links show an actionable error; do not silently open a different default cut.
2. Initialize the exact recipe and music preferences, open **Selected cut**, and load existing audio through the normal Studio path. Browser autoplay/mute behavior stays under the operator's control.
3. Recompute the fingerprint. If the saved tags, selection or canonical source changed, say **“This cut changed since it was proposed”**, show the current cut and use the existing review-needed/export guard. Never label the current selection as the original proposal.
4. Let the operator inspect thinking, change tags/rules and review audio coverage. Existing Smart tags from other editors are included by the recipe and must be visible in the agent's preview summary; do not erase them to isolate the agent's suggestions.
5. Operator review and the existing freeze/export flow remain the completion step. This feature adds no MCP tool to acknowledge human review or bypass that flow.

A review URL is untrusted navigation state and never authorization or proof of human approval. Copying it does not grant access. For paused sources, retain Studio's existing preview-only behavior; a completed-game export remains mandatory.

## Implementation sequence

### 1. Shared services and contracts

- Extract source resolution/authorization and annotation transaction handling from `routes/production-studio.ts` into a focused production-editorial service used by HTTP and MCP. Preserve current source validation, privacy, error mapping and annotation semantics.
- Implement the bounded moment reader, single-moment patch and recipe preview using `production-annotations.ts` and engine selectors. Keep explicit game-kind dispatch; do not build a generic adapter registry.
- Add a small shared review-link/fingerprint contract in a dependency-neutral module. Keep review settings limited to the supported recipe/music handoff.

### 2. OAuth and MCP wiring

- Add `producer:edit` to scope definitions, dependency validation, consent copy, client-envelope validation and token/grant handling. It is opt-in and does not appear in default grants.
- Update the four persisted OAuth scope CHECK constraints (clients, authorization codes, access tokens and refresh tokens) through the existing migration/release-policy process. Do not update existing grants to include the new scope. Extend the source-of-truth scope generator/policy and its migration coverage together.
- Register the three tools in the closed authorization registry and server dispatch. Both discovery and invocation revalidate current client envelope, granted scopes and current role. Failed eligibility lookup denies access.
- Publish exact schemas, structured follow-ups, matching security metadata and correct read/write annotations. The patch tool is a mutation and is not advertised as idempotent. Regenerate schema artifacts where the existing generator owns them.
- Update the MCP server instructions and OAuth documentation: producer reads can review source and cuts; the additional edit grant saves shared Studio annotations. No extra per-tag conversational confirmation is required when the user has authorized curation.

### 3. Studio review handoff

- Add the authenticated preview endpoint and strict review URL decoding.
- Initialize recipe/music settings from valid review links, verify the fingerprint, surface drift and coverage, and retain existing conflict/freeze protection.
- Preserve ordinary Studio navigation and manual tag editing. Refreshing/opening the same link reconstructs the same intent against current saved state and reports drift honestly.

### 4. Documentation and verification

- Update `docs/game-mcp-production-oauth.md`, Studio's README and the relevant MCP contract documentation with an end-to-end example and scope upgrade instructions.
- Add a focused solution note after implementation explaining the shared annotation owner, review-link semantics and concurrency handling. No change to contestant decision contracts or simulation logging is intended.

## Acceptance and tests

- **Authorization:** no scope, `games:read` alone, producer read without edit, revoked role, reduced client envelope and failed role lookup all deny writes without mutation. Current Producer/Sysop behavior matches Studio. Read-only connections retain read/preview access.
- **Source fidelity:** both game kinds return Studio's exact moment IDs and accepted content. Test mixed speech/thinking, standalone accepted thinking, private night speech, omitted passes, invalid/cross-game IDs, corrupt or mismatched snapshots, and Mystery privacy. No prose-derived identities or facts.
- **Paging:** pin source/filter/audience; walk every page without duplicates or omissions. Exercise whole-entry byte bounds, invalid cursor reuse and preview changes between pages. Oversized reads never fail or alter a game.
- **Mutation:** setting Smart on thinking leaves speech and unrelated custom tags unchanged; removal works; revision zero inserts; unchanged patches preserve revision; stale writers and serialization races return current annotation; retry after uncertain success is recoverable by read-back. Invalid final tag maps do not partially write.
- **Selection:** the requested recipe retains normal Omniscient gameplay and speech but only Smart thinking. Test no Smart tags, pre-existing operator tags, independent speech labels, tag changes and source changes. Audio reports missing/mismatched lines honestly without starting generation.
- **Operator flow:** in the isolated real Studio browser harness, write Smart through MCP, open the returned link, verify the same moment membership, play the cut with deterministic existing voice/music fixtures, edit a label and exercise drift/review protection. Freeze through the existing UI and verify exporter membership/recording settings match. No live provider credentials.
- **Schema/transport:** discovery and invocation match; exact schemas reject unknown fields and malformed values; tools are usable through real HTTP MCP, not only internal method calls.
- Use `setupTestDB()` for all shared-Postgres tests, with no same-database parallel execution. Browser harnesses own and clean their isolated databases/processes. Run focused tests, then required `bun run test`, `bun run test:postgres` and `bun run check`; run applicable classified browser proof and migration policy checks before merge.
- After deployment to localhost and an explicit `producer:edit` grant, perform the real `hard-smoke-rune` curation when requested, preserve the chosen IDs/receipts and return the operator review link. Completed under the subsequent implementation and localhost tag-edit authorization; no real-game export was run.

## Completion boundary

Complete when an authorized MCP client can read actual Studio moments, save Smart labels without losing other edits, and produce a link that an operator can open to review the intended voiced/music cut and finish the existing export flow. Merely exposing an annotation POST, or returning a generic Studio URL that resets the recipe, is incomplete.
