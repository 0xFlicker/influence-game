---
title: Share owner learning while keeping game knowledge and strategy separate
date: 2026-10-03
module: House owner learning
problem_type: architecture_pattern
category: architecture-patterns
tags: [house, werewolf, influence, owner-learning, evidence, strategy, mcp, moderation]
---

# House owner learning across game kinds

W3 extends the existing owner workflow to Werewolf. Reuse credit admission, one unresolved review per owner, durable calls/checkpoints, receipts, retry, resolution, dashboard and MCP. Game rules supply the evidence and judgment; they do not acquire a second job system.

## The boundary

`owner-learning-game.ts` owns the closed game-kind dispatch for strategy field and review identity. `owner-learning-werewolf.ts` projects canonical history into actor-time evidence and provides Werewolf instructions. The existing Influence projector keeps its action ledger, authorized narrative, and early-exit health-check policy. `owner-learning-provider-context.ts` supplies each game's bounded moment context to the same strict harness. No plugin registry, generic event vocabulary or separate Werewolf review tables are needed.

The persisted review/evidence discriminator is explicit. Migration 0107 normalizes existing rows as Influence, stores the reviewed editable strategy, and removes four review-only foreign keys to Influence analytical revisions. These columns now contain opaque review identities: historical Influence revision IDs or versioned Werewolf fingerprints. Profile/game/review ownership relationships and application uniqueness remain database constraints. Application code revalidates the current identity under the existing profile/review locks.

## Lessons for another game

1. **Review identity is not rating identity.** Hash the executed behavioral inputs relevant to that game's decisions. Werewolf uses name, personality, backstory, archetype and resolved Werewolf strategy. Image edits and Influence strategy edits do not invalidate it. Model/rules/provider configuration belongs in evidence context. Preserve both the raw editable override and the resolved starting strategy; applying to a default creates an override.
2. **Spectator permission is not coaching permission.** Even an owner of the whole cast receives only the reviewed actor's private knowledge and thinking. Reconstruct the exact pre-decision observation and verify planned request/observation hashes. Verify accepted provider artifacts against the canonical decision before exposing thinking. Do not obtain an Omniscient snapshot and try to subtract secrets afterward.
3. **Separate time and authority.** Canonical action, knowledge at that action, and later public outcomes are different fields. An outcome can help explain consequences but cannot justify attributing future knowledge to an earlier decision. Neither death nor faction victory establishes decision quality. Unavailable decisions remain distinct from intentional abstentions.
4. **Reuse lifecycle, specialize interpretation.** Werewolf does not inherit Influence's sparse early-exit health-check rule. Missing thinking remains missing; no-change and gather-more-evidence are valid. Thread windows use canonical thread/day boundaries; omitted context is counted. Selected investigations fail clearly if they cannot fit the input budget rather than silently discarding their thread.
5. **The server owns mutation scope.** The model supplies proposed text, while the server assigns the strategy field and exact prior text. Apply locks/rechecks owner, kind, fingerprint, current relevant identity, raw field and pending moderation. A held submission cannot be marked applied. Reuse saved image evidence for text-only updates. Manual edits use the same identity and resolution hooks; changing the other game's strategy cannot resolve this game's review.
6. **Keep product entry shared.** Results offers the same owner-review activation for both games. The review workspace selects a kind, then a profile and one-to-three eligible games. Preserve that selection in the URL. Detailed decisions are disclosures, not a wall of JSON. Evidence links open their disclosure and lead to the game-owned replay coordinate. Nothing fetches private review evidence as a side effect of Mystery playback.
7. **Model changes include persistence policy.** Use `OWNER_LEARNING_MODEL_ID` in request construction and input fingerprints. A stale hardcoded model in hashing can make a durable request disagree with its provider call. Version the prompt/schema/provider policy so old checkpoints cannot silently continue under new semantics.
8. **Test apparatus separately from coaching quality.** Scripted legal games cover privacy, Seer/Doctor/pack observations, credit deduplication, exact apply, manual edits and MCP parity. Browser tests use isolated databases and no provider key. Real coaching quality requires an operator-approved packet, model cost budget and human review of both accepted and rejected suggestions.

## W3 follow-up: reviews missing from the admin ledger

A real Werewolf review completed successfully but never appeared in the admin ledger. The worker, owner dashboard and call records were correct. `owner-learning-admin.ts` still used an inner join from the opaque review identity to Influence's `agent_revisions`, silently dropping Werewolf reviews from both list and detail reads and their aggregate totals.

The fix uses an optional, Influence-only revision join. Shared admin responses carry `gameKind`; a revision ordinal is nullable, while the persisted review identity is retained. The ledger labels the game and displays a Werewolf strategy identity without inventing an Influence revision number. No migration, regeneration or paid retry is needed for existing reviews.

**Lesson:** removing a game-specific foreign key is only half the integration. Audit read-model joins, admin diagnostics, aggregate accounting and UI identity labels wherever that identity is consumed. A successful owner/MCP workflow does not establish operator visibility. Regression coverage must exercise running and completed reviews without an Influence revision, list/detail inclusion, call receipts and costs, alongside existing Influence and admin authorization tests.

## Verification and limits

See [W3 implementation proof](../../reviews/2026-10-03-w3-owner-learning-implementation.md). The shared local test DB had migration history from another branch, so a fresh disposable database verified the full branch migration chain and API baseline. Never repair the operator's DB merely to make a branch test suite run.

Werewolf evidence persists complete actor observations for auditability. Model requests are bounded and explicitly report omissions; snapshots and owner read responses can grow with long games. Profile eligibility currently scans completed Werewolf starting rosters. Measure long-game response sizes and selection latency during calibration before adding indexes, paging or another retrieval layer. Do not confuse deterministic correctness with calibrated strategic advice.

## New-game owner-review checklist

- Decide eligible completion/visibility and funding explicitly; do not change existing game eligibility implicitly.
- Freeze strategy identity separately from ratings, and define raw/default strategy behavior.
- Identify canonical decisions, exact actor observations, source coordinates and captured thinking.
- Specify later-outcome disclosure independently of actor knowledge and other actors' private lanes.
- Define sufficiency, bounded context and honest no-change behavior for the game's objectives.
- Add the strategy target to shared proposal, apply, retry, supersession, moderation and manual-edit paths.
- Extend existing web/MCP contracts and owner-only source links; reuse common jobs, credit and receipts.
- Verify operator list/detail queries, diagnostics and totals with a real game-specific identity; audit joins to other games’ revision tables and avoid fabricated revision labels.
- Prove malformed output, source drift, wrong owner, stale proposal, pending moderation and idempotency.
- Run provider-free, isolated PostgreSQL and browser checks; then obtain a separate paid calibration budget and quality approval.
