---
title: Keep House episode presentation shared and game evidence explicit
date: 2026-10-05
module: House episode presentation
problem_type: architecture_pattern
category: architecture-patterns
tags: [house, werewolf, influence, episodes, routing, privacy, artwork]
---

# Shared episode packaging across games

W7B adds Werewolf read adapters to the existing House episode presentation. Reuse the stored title, teaser, cover, revision and lock contract. The initial canonical Werewolf event supplies a whitelisted public cast; never scan the latest surviving roster, private pack scenes or transcript prose for generic episode packaging.

## Integration lessons

1. Test through the outer router. Service-level tests passed while `/api/games/:id/episode` still sat behind an Influence-only guard and returned 409 for Werewolf. Shared House endpoints must run before that guard and retain their own visibility checks. Browser tests caught this; the API regression now includes the real router.
2. Separate display identity from route identity. Generated/operator titles belong in headings, cards and metadata. Every URL continues to use the stored slug.
3. Read paths must stay free of generation. A stored title in a fixture proves display plumbing, not a functioning naming worker. Automatic queues, model inputs, producer backfills and locks need separate proof and authorization.
4. Public initial cast is an explicit allowlist. Map identity fields from `werewolf.started`; never spread frozen player objects into public episode payloads. Roles and strategies are present in the canonical source and must remain excluded.
5. Cover eligibility is game-specific. Influence can use an initial full-roster lobby. Werewolf generic covers use the approved neutral village or an explicit operator choice. A later village/pack scene can disclose survivors or wolf identities even when it contains a plausible number of people.
6. Saved episode copy belongs in new immutable media snapshots. Existing published videos/posters do not change when HTML does. Validate bounded text in the manifest instead of hardcoding one teaser string; keep strict field allowlists, audience and quote-source policy.
7. Regenerate strict MCP output schemas after shared service DTO changes. Adding episode presentation to results also changes `read_game_results`. Run the pinned `generate-house-mcp-schemas.cjs` workflow and real output fixtures; do not weaken `additionalProperties: false` to conceal the mismatch.
8. Audit the complete journey without conflating surfaces. Werewolf owner-review selection exists, but public competition history is still Influence-only. Production discovery also differs between producer/sysop and admin-only access. Record these as concrete gaps rather than claiming parity from one working page.

For a third game, add its canonical initial public cast adapter and safe default art/premise; preserve shared presentation storage, House routes and controls. A new plugin registry or parallel episode job system is unnecessary.

## Collection navigation — 2026-10-06

Game-type shelves open `/games/type/[kind]` through the shared collection page, alongside `/games/public` and `/games/season/[seasonSlug]`. The collection scope comes directly from the route. Previously, Werewolf's query parameter was copied into a `useState` initializer; Next preserved the mounted browser during navigation, so the URL changed without updating the shelf until reload. Keep transient toolbar filters local, but derive fixed collection scope from props. Browser coverage must click View all from the shelf and exercise Back, not merely load the destination URL.

## Naming lifecycle follow-through — 2026-10-06

Queue the shared naming job in the transaction that freezes the cast and starts the game. Polling for unnamed running games loses fast completions and makes game-kind omissions easy. The worker consumes the durable queue after restart, and historical games enter only through explicit producer selection. Each game supplies an allowlisted initial cast and premise; never send the entire canonical player object to the provider.

An upsert rechecks protection, existing copy and active job status atomically. Batch previews are estimates, not authorization to bypass changed state. Return the actual queued IDs after the mutation. Keep generation completion fenced by revision and lease so manual edits win. A missing canonical opening is a visible failure, not permission to reconstruct identity from current profiles or transcript text.
