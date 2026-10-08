---
title: Shared House delivery failures exposed by Werewolf
date: 2026-10-07
category: architecture-patterns
module: House playback, production, review and release
problem_type: architecture_pattern
component: cross_system_lifecycle
severity: high
applies_when:
  - debugging replay glitches or asynchronous producer state
  - adding another game to shared review and media workflows
  - validating publication, migration or runtime recovery across services
tags: [werewolf, replay, lifecycle, race-conditions, visual-production, owner-learning, migrations, deployment]
---

# Shared House delivery failures exposed by Werewolf

## Scope and evidence

Werewolf exercised shared systems under new semantics: faction outcomes, private night actions, audience-local history, reusable transformed art and games without generated visuals. Many failures were mismatched ownership or identity across otherwise working components.

This retrospective is anchored to deployed application `f3f0f81bac3d345f0e485f6bfc04357f7590338f` and [PRs 163](https://github.com/0xFlicker/influence-game/pull/163), [164](https://github.com/0xFlicker/influence-game/pull/164) and [165](https://github.com/0xFlicker/influence-game/pull/165). Its companion, [adding a game through The House](adding-a-game-through-the-house.md), explains the integration boundaries and third-game checklist.

The implementation inherited durable execution, visual repair/publication, the Influence review workflow and the House media renderer. It did not invent all of them. Commit titles are also insufficient attribution: `2c1fd37d` is labelled Mingle hardening but changes Werewolf and documentation, not Influence's Mingle runtime.

Research inspected source and historical proof; it did not rerun tests, make provider calls or change deployment. Current exact-head CI, staging E2E, successful release receipts and matching live health were independently checked. Each is evidence of its own scope, not exhaustive acceptance of every UI or generated output.

## Playback: preserve the right identity

### Speaker changes remounted the camera

The viewer appeared to cut instantly between speakers instead of moving within a room. `SceneContent` was keyed by cue, so every contribution destroyed camera state. The fix keeps the scene subtree stable by scene/version or portrait identity, while readiness still belongs to the current cue and image. An old image load must not release a newer cue's readiness gate.

This distinction also preserves explicit-navigation behavior: keeping the camera mounted does not mean a seek should animate as ordinary forward playback.

Sources: [Werewolf stage](../../../packages/web/src/components/games/werewolf/werewolf-watch-stage.tsx), commit `89aad7af`, [watch ownership](share-watch-clock-with-game-owned-projections.md).

### Empty beats changed full-body geometry

With thinking enabled, a full-size portrait flashed between smaller thought/speech layouts. Geometry depended on whether a bubble happened to be visible at that instant. The fix reserves thinking-mode geometry during empty/loading intervals. Layout intent stays stable while individual bubbles appear and disappear.

Related fixes measure the actual responsive bubble width, center the bubble rather than just its tail, and scale the thought trail from its available span while stopping near the head. Original opaque full-body images remain supported; no transparent cutout assumption is required.

Sources: [solo presentation](../../../packages/web/src/app/games/[slug]/components/solo-presentation.tsx), [thinking presentation](../../../packages/web/src/components/watch/watch-thinking.tsx), [layout and seeking solution](../ui-bugs/2026-10-01-werewolf-watch-layout-and-seeking.md).

### Canonical entries and presentation stops are different coordinates

One vote event expands into individual ballots, a complete tally hold and its result. One night entry can expand into Doctor, Seer, Hunt and Dawn. These are meaningful presentation stops, not additional game events.

Arrows and the slider now use the same stop mapping and readable landing policy. Influence eligibility comes from validated format resolution; the nominee scene uses the recorded eligible pool and choice. It does not reconstruct eligibility from prose or randomly choose a dramatic elimination. The redundant Two Names ballot-collection pause was removed because the shared ballot collection already presents that work.

Transformation is sampled from the shared visual clock, including fixed human/wolf switches, bounce, stagger and reduced motion. Pausing and seeking therefore reproduce the same pose. Published art alone did not make the effect reachable: the lone-wolf fix also required resetting introduction eligibility per night and indexing the entrance on Previous/Next.

Sources: [Werewolf cue mapping](../../../packages/web/src/components/games/werewolf/werewolf-watch-model.ts), [watch projection](../../../packages/engine/src/werewolf/watch.ts), [vote ledger](../../../packages/web/src/app/games/[slug]/components/vote-ledger-model.ts), [nominee selection](../../../packages/web/src/app/games/[slug]/components/nominee-selection.tsx), [night motion tests](../../../packages/web/src/__tests__/werewolf-night-motion.test.ts).

### A sorted cache can still skip history

After seeking far away and rewinding, disconnected cached windows could be joined into sequential playback. Sorting entries did not prove that the intervening history was loaded. The repair feeds the director only a contiguous cached interval containing the active position and rejects conflicting immutable entries at the same coordinate.

Likewise, a prefetched snapshot is not the current board. Audience changes, access failure, seek intent and publication cutoff all constrain which response can update the active viewer. This was a bounded correctness repair, not a completed WebSocket/polling redesign.

Sources: [watch hook](../../../packages/web/src/components/games/werewolf/use-werewolf-watch.ts), [cache regressions](../../../packages/web/src/__tests__/werewolf-watch-cache.test.tsx), commit `03b2d3e2`.

### Successful seek calls did not prove dragging

The reported staging bug was precise: clicking the range track worked; dragging did not. API reads and both audience projections were healthy. There was no Visual Mode requirement. Those checks narrowed the cause but did not invalidate the browser report.

PR165 separates local thumb preview from asynchronous seek commitment. Pointer movement updates the preview; release commits the final position. Cancellation restores the current position, keyboard changes seek directly, and a generation fence prevents stale completion from clearing a newer interaction. Returning the Werewolf seek Promise keeps the preview visible while history loads.

Regression proof combines [component cases](../../../packages/web/src/__tests__/replay-scrubber.test.tsx) with an actual slow native drag exercised during implementation. An artificial change event alone cannot establish browser-native range behavior.

Source: [shared scrubber](../../../packages/web/src/components/watch/replay-scrubber.tsx), commit `b494a2b3`. The browser slider still represents stop ordinals; this fix did not implement duration-based scrubbing.

## Audio: stable ownership, explicit transport policy

The House audio engine owns two streaming decks, their crossfade and a single audio clock. A game adapter selects a semantic music section from the active audience-visible state. Speaker, speech-page, fullscreen and thought-layout changes do not recreate audio ownership.

The shipped policies are deliberate:

- Saved mute/volume intent is separate from permission to start sound. Browser unlock happens in a gesture; rejected or late `play`/AudioContext completion is fenced rather than retried every render.
- Same-section seeks preserve music time; section changes and replay restart begin from the source front. Scrubbing/loading suspends music and does not download every intermediate destination.
- Pause freezes both decks. Repeating beds loop with crossfade; victory may continue over the final frame until its track ends, while Pause still works.
- First-visit mute avoids allocating/downloading music. Mute and volume remain top-level controls. Viewer and producer preferences have separate device scopes.
- Music remains at its own playback rate when visual pacing changes. It is ambient accompaniment, not a frame-exact speech soundtrack.

The local export timeline, future voiced dialogue and dramatic thinking treatment remain separate, unmerged/deferred work at this release. Do not describe the browser director and audio engine as an already unified sampled media timeline.

See [shared replay music](shared-replay-music-transport.md), [music controller](../../../packages/web/src/components/watch/watch-music.ts), [music tests](../../../packages/web/src/__tests__/watch-music.test.ts), and the [refactor queue](../../refactor-queue.md).

## Review and producer UX: a successful backend operation can still look broken

| Symptom | Cause | Shipped fix and prevention |
| --- | --- | --- |
| A running/completed Werewolf review was absent from the admin ledger | Inner join to Influence `agent_revisions` excluded a valid Werewolf strategy identity | Optional game-scoped revision join, explicit game kind and nullable ordinal; test list, detail, calls and totals with a real non-Influence identity |
| Recommendation drafting failed before the fourth model call | Final-result requirement depended on the call-count limit, not the drafting stage | Drafting always uses the strict final-result contract; test early completion, valid no-change and missing final result |
| Waiting felt unresponsive despite working polling | Connection checks and analysis progress were not clearly distinguished | Compact successful-status-check timestamp and explicit sustained-failure retry; never label a successful poll as another completed analysis step |
| Strategy-only edit failed because an old image was unavailable in a worktree | Generic profile edit path loaded image evidence even when no art field changed | Preserve saved image evidence and unrelated fields; exercise strategy edits with missing local assets |
| An old receipt check cleared a newer producer operation | Async completion was not bound to the current session/operation | Capture exact operation, reject duplicate checks, fence success and failure against current identity |

Sources: [owner-learning solution](house-owner-learning-across-game-kinds.md), [admin regression tests](../../../packages/api/src/__tests__/owner-learning-admin.test.ts), [profile evidence fix](https://github.com/0xFlicker/influence-game/commit/a1a3eda0), [producer panel](../../../packages/web/src/app/admin/replay-visual-production-panel.tsx), [producer regressions](../../../packages/web/src/__tests__/replay-visual-production.test.tsx).

The broader rule is to bind completion to the entity and operation that requested it. A row ID, matching display name or current tab is not enough when proposals, receipts or jobs can be superseded.

## Production: keep accepted work, uncertainty and publication distinct

### Panels and harmonization are separate artifacts

The legacy primary image field could point to the first group, making a multi-panel scene look as though only one image existed. Producer inventory and playback must consume the complete shot collection. Harmonization is optional verified composition of saved usable panels; a rejected overview must not destroy the source panels.

Saved-panel harmonization binds to an immutable selected version. Normal scene regeneration and operator repair use the same game planner and House renderer. Wolf-form reuse binds game/player/frozen source/art revision/generation; explicit regeneration creates another derivative rather than mutating profile art.

These mechanisms partly predate Werewolf, including PR162's harmonization work. Werewolf extended them with game-specific night staging and forms. The current Drizzle omission of `harmonize` is still deferred schema debt; deployed SQL migrations support it.

Sources: [scene renderer](../../../packages/api/src/services/visual-scene-renderer.ts), [repair service](../../../packages/api/src/services/visual-media-repair.ts), [derived-art solution](werewolf-derived-art-and-producer-regeneration.md).

### Graceful shutdown must preserve replayable paid work

The Cuts worker originally marked an aborted job failed even when no dispatch was uncertain. That stranded work which could safely resume from its journal. The fix requeues shutdown-aborted work only when persisted attempts have terminal receipts; accepted results are reused. Unknown nonterminal dispatches remain held for inspection.

Retryability is an evidence question. Neither “the process stopped” nor “the request timed out” proves a paid request did not run. Repeating an uncertain call or resetting its budget would be a new side effect, not recovery.

Sources: [Cuts worker](../../../packages/api/src/services/house-cut-worker.ts), [shutdown/replay tests](../../../packages/api/src/__tests__/house-cut-worker.test.ts), [editorial source boundaries](house-cuts-editorial-source-boundaries.md).

### Require visuals must also check cached results

A cached Best effort fallback could bypass a later Require visuals policy. The fix distinguishes verified imagery from fallback and rechecks policy before reuse. A visual pause stores a canonical pending boundary and expires execution ownership atomically. Repair must match that purpose, cast and boundary; publication precedes explicit resume.

Night resolution may already be committed when hunt production pauses. Resume continues from accepted authority instead of emitting the night result again. A lone wolf can require form repair without a fake pack-scene row.

Sources: [visual runtime](../../../packages/api/src/services/werewolf-visual-runtime.ts), [visual policy](../../../packages/api/src/services/werewolf-visual-policy.ts), [recovery solution](werewolf-visual-recovery-at-canonical-boundaries.md).

### Rendering and uploading did not prove publication

A named Werewolf trailer rendered and uploaded but failed finalization because its playback metadata used hardcoded copy while the submitted preview used the frozen episode title/description. Finalization correctly rejected unequal public metadata. Both outputs now consume the same frozen manifest copy, with a nondefault-title regression.

The apparent CORS/ORB image failure during local rendering was a different problem: missing crop assets returned 404 JSON. Inspect status/content type and the upload-root identity before changing CORS or regenerating art. Worktrees can share database references without sharing binary upload directories.

Use the full proof chain: immutable snapshot → render → upload → finalize → ready read model → anonymous media delivery → browser playback. Each boundary can fail independently. Caption availability and caption default visibility also need separate checks.

Sources: [media bundle builder](../../../packages/web/src/lib/house-highlights-trailer-media-bundle.ts), [upload verifier](../../../packages/api/src/services/postgame-media-uploads.ts), [Werewolf trailer solution](werewolf-trailer-shared-renderer-and-spoiler-boundary.md), [shared media pipeline](house-highlights-postgame-media-pipeline.md).

### Small API responses can still cause large database reads

A bounded watch response was loading the entire frozen cast's binary art repeatedly, although the response needed only reference metadata. The cleanup batches metadata and limits binary reads to the requested character image. It does not prove constant-time history projection or complete the transport audit.

Likewise, independent source limits must remain independent: a supplied transcript-only cutoff must be enforced even when no event cutoff accompanies it. Event sequence, transcript sequence and audience-local viewer position are not interchangeable.

Sources: [presentation reads](../../../packages/api/src/services/werewolf-presentation.ts), [production references](../../../packages/api/src/services/werewolf-production.ts), [watch intelligence](../../../packages/api/src/services/public-watch-intelligence.ts), commit `03b2d3e2`.

## Migrations and deployment: three different acceptance checks

### Database execution is not release-policy acceptance

Migration `0108_house_owner_learning.sql` removes four review-only foreign keys into Influence rating revisions. Werewolf strategy identities cannot satisfy those references. The change preserves existing identity columns, rows, ownership and rating constraints; it adds the game-specific review contract.

PostgreSQL accepted the SQL, but the release checker correctly required explicit review of constraint removal. The fix pins the exception to the filename and complete SQL hash, and only to that policy rule. Editing the file or adding another drop fails again. Applied migration bytes were not rewritten and general destructive-change checks were not weakened.

Run the full migration diff through both database execution and release policy. A clean disposable database also does not prove a dirty cross-branch development database has the expected migration journal. Inspect it; do not reset operator data to make tests pass.

Sources: [migration](../../../packages/api/drizzle/0108_house_owner_learning.sql), [policy allowlist](../../../packages/api/src/db/migrate.ts), [migration regressions](../../../packages/api/src/__tests__/migration-release-compatibility.test.ts).

### Healthy containers are not an active accepted runtime

The first production attempt failed before creating a host transaction. The accepted SHA, API digest, migration set and running color matched, but the API reported runtime state `validation`. A secondary “unsupported release mode” error was fallout from failing before mode selection.

The operator recovered the accepted API using a guarded, API-only recreation from already-persisted active startup configuration. The command checked the release lock, absence of active host transactions, accepted identity, route, boot authority and image family. It did not edit the accepted record, bypass migration guards or restart game workers.

The old qualification had frozen the validation baseline and could not simply be reused. Requalifying the same exact candidate generated a new immutable approval request. After operator approval, the release succeeded.

Evidence: failed [execution 37700489895](https://github.com/0xFlicker/linode-iac/actions/runs/37700489895), [qualification attempt 2](https://github.com/0xFlicker/linode-iac/actions/runs/37699253078/attempts/2), [new approval](https://github.com/0xFlicker/influence-game/actions/runs/37703144869), successful [execution 37703271077](https://github.com/0xFlicker/linode-iac/actions/runs/37703271077). Its receipt records candidate `f3f0f81b`, blue color, terminal acceptance and exact API/web/render-worker digests.

**Remaining IaC issue:** controller `026d9e40c8b6a8adcdda71871e8aae00c42d9263` saves startup mode `active`, but its terminal predicate checks runtime state rather than container startup mode. It can therefore skip recreation of an activated container still configured to boot in validation mode. The new deployed API was observed as startup `validation`, runtime `active`. It was serving successfully, but a subsequent restart risks losing activation. The exact trigger of the prior incident was not proven, and no permanent controller repair was included in this documentation work.

Source: [terminal activation logic](https://github.com/0xFlicker/linode-iac/blob/026d9e40c8b6a8adcdda71871e8aae00c42d9263/scripts/production-release.sh#L1976-L1986) and its [acceptance predicate](https://github.com/0xFlicker/linode-iac/blob/026d9e40c8b6a8adcdda71871e8aae00c42d9263/scripts/production-release.sh#L781-L802). Record the IaC follow-up separately; do not infer a failed release from the startup label alone or remove the runtime guard.

## Verification that should survive the next game

| Layer | What it proves | What it does not prove |
| --- | --- | --- |
| Pure rules/projection fixtures | Legal outcomes, rare states, audience filtering, deterministic reconstruction | Model strategy quality or balance |
| PostgreSQL tests | Transactional identity, leases, races, persistence and policy integration | Native browser interaction or exact deployed image behavior |
| Component/director tests | State transitions, timing, stale completions and cue mapping | Native dragging, real media loading or subjective motion quality |
| Isolated browser tests | Actual route/UI/gesture behavior in the exercised scenarios | Every browser, physical device or external provider |
| Operator samples | Art, music, editorial and interaction acceptance for those samples | Broad calibration or all future generated outputs |
| Exact-head CI/staging | Tested candidate passed its configured checks | Exhaustive production journeys or rollback of database data |
| Production receipt plus health | Accepted immutable release identity is serving | Every publication, repair and future restart path |

At the recorded head, [CI](https://github.com/0xFlicker/influence-game/actions/runs/37697234885), [browser coverage](https://github.com/0xFlicker/influence-game/actions/runs/37697234883) and [staging E2E](https://github.com/0xFlicker/influence-game/actions/runs/37699139195) passed. Historical plan test counts describe their respective checkpoints; do not combine them into a new total or treat old “local only” statements as current deployment status.

## Documentation corrections and retained debt

The focused notes are useful, but these initial-slice claims require historical scoping or later correction:

| Document | Superseding shipped behavior |
| --- | --- |
| `werewolf-derived-art-and-producer-regeneration.md` | PR164 omits generated Doctor-save hunts and reverses alley positions; original-art save presentation remains |
| W7A visual failure plan's final migration instruction | Visual recovery/form-only jobs use migration 0112; 0111 provides character variants |
| Early shared-player plan/proof | Werewolf now autoplays with hydrated preferences; seeking preserves play intent while pausing for preparation |
| `separate-werewolf-game-authority.md` | Current shared MCP/postgame/public playback integration supersedes early exclusions; current migration is 0105 and current speech contracts include private thinking |
| Older replay-spec sections | Current shared controls and responsive scrubber supersede the old desktop-only description |

These are technical corrections, not permission to erase why historical rules or experiments changed.

The operator explicitly deferred harmonize schema alignment and the broader transport audit, and declined the review's specialized MCP denial-envelope and historical absent-Cuts backfill fixes for this release. Those are not resolved by this retrospective. Admin-only Production discovery, richer reveal decoration and broader editorial/coaching/device calibration remain separately tracked. See the [refactor queue](../../refactor-queue.md) and [journey audit](../../audits/2026-10-05-house-journey-parity.md).
