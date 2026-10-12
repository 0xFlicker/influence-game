---
title: Production studio — first-pass scope and workflow
type: brainstorm
status: first-pass-review
date: 2026-09-30
updated: 2026-10-09
pillar: A2
---

# Production studio — first-pass scope and workflow

Parent: [House admin and production pillars](2026-09-30-house-admin-and-production.md#a2--production-studio). This refresh replaces the pre-Werewolf source inventory with the current foundation. The [A2.1/A2.2 technical plan](../plans/2026-10-09-001-feat-production-studio-moment-editor.md) now defines architecture, early foundation tasks and validation; the concrete operator layout review remains pending. No provider calls, publication, new grants or application changes are authorized by this document.

## Why return now

Werewolf is integrated into The House. We have real scene generation, wolf forms, repair/publication, required-visual pauses, episode naming, Cuts, trailers, music, openings, a shared viewer and a local full-game exporter. The studio should organize these working tools rather than invent their lifecycles again.

The immediate failure is practical: an operator encounters a bad first image, enters a head-marking editor, feels forced to save it, then cannot easily request a replacement. The latest recovery changes separate rejecting pixels from settling an uncertain charge. A2 must make that distinction obvious without making ordinary repair an accounting exercise.

First-pass evidence: source inspection at `8a1f4975`, 2026-10-08. Bad-image recovery improvements belong to [PR #170](https://github.com/0xFlicker/influence-game/pull/170); present in this branch does not mean deployed. Earlier integration release evidence is in [House delivery learnings](../solutions/architecture-patterns/house-delivery-boundary-failures.md).

## Current delivery: A2.1 and A2.2 together

**Open a game → seek through its moments → repair scenes and tag moments → preview the selected cut and its duration → export.** Required-visual repair retains explicit publication and resume.

The first usable slice is a video-production workspace with an actual timeline, playhead, playable preview, scene tools and moment tagging. A static inspector plus export command does not meet A2.1/A2.2. Build in small working increments internally, but accept the slice only when the producer can repeatedly seek, select, watch and export the same cut. A2.1 covers shared production foundations and repair; A2.2 covers timeline playback, moment editing and selected export. Both are included in this coordinated delivery. Cross-game jobs and explicitly deferred refinements follow.

The library is the recommended default landing, with search, game-kind/status filters and Needs attention. This is a proposal for review, not a claim that the earlier landing-page question was answered. Do not add automatic last-game reopening or an attention-ranking algorithm in the first slice. Compute attention from explicit states already available: a visual pause, failed job, missing required asset, candidate awaiting review, or unresolved provider receipt. Keep those reasons distinct.

Completed games and supported visual-repair pauses belong in the workflow. The current Werewolf repair API accepts completed games or a validated visual pause; arbitrary live scene editing is not supported. Influence has its own visual repair surface. Preserve its supported operations and lifecycle constraints through the cutover rather than forcing both through a completed-game endpoint.

## A2.1/A2.2 review gates

### Simplification and consistency

Make this an explicit work item at the start of A2.1/A2.2, with a second review of the implementation before acceptance. Inspect Influence, Werewolf and House scene management, generation and modeling together. The deliverable is a short contract and disposition table: shared behavior, game-owned behavior, duplication to remove, intentional differences, and narrowly deferred issues with a reason.

Settle these terms and ownership before extracting UI:

| Term | Contract to settle |
| --- | --- |
| Scene | Reusable staged imagery with explicit purpose, cast and source boundary; may have multiple panels and many moment uses. House owns common lifecycle and inventory; the game supplies staging and valid boundaries. |
| Moment | Independently selectable presentation unit such as a thought, spoken contribution, ballot or outcome, with stable identity and typed source references. One response/event may produce several moments. Camera phases and text pages are internal parts of a moment, not separate tagging chores. |
| Asset/version | Immutable production output and provenance, including source panels, derived forms and composites; publication selects a version independently of generating or selecting it. |
| Producer metadata | Mutable editorial key/value annotations owned by a stable moment identity, with response/event references as provenance. Separate from accepted game events, engine observations and automatic editorial policy. |
| Generation/repair | Shared request, receipt, verification, version and publication behavior; game adapters provide exact cast, references, scene purpose, audience and recovery validation. |

Audit creation-time generation and producer regeneration together, including Influence format-specific scenes, Werewolf forms/hunts, harmonization, missing-scene recovery and no-image presentation. New formats should not need another editor or a copied repair lifecycle. Share only what is demonstrated common; do not flatten game-specific facts or add an abstract plugin system for hypothetical games.

Carry concrete simplifications into A2.1/A2.2 and remove replaced code at cutover. Keep broad transport redesign and unrelated engine work separately scoped. Known schema drift, including the queued harmonize constraint issue, needs an explicit disposition; do not silently absorb previously deferred work or describe it as fixed by moving UI.

### Operator UX design gate

Hold this gate **at the start of the combined A2.1/A2.2 effort, before workspace implementation**. Present a working interaction prototype with representative Influence and Werewolf material, plus desktop and narrow-screen layouts. The operator approves the workflow and visual hierarchy, not merely route names or component reuse.

The destination is an editor: source browser, large preview, timeline, visible playhead and contextual tooling. Show how scene selection, moment selection and playhead position relate; selecting an asset for comparison must not silently seek playback or publish it. Indicate whether the preview is a scene still, the current moment, or an unpublished candidate. Prototype these playback interactions now and integrate them in A2.1/A2.2. Review the source replay and the selected cut as two explicitly labeled views, with their own durations and a clear mapping back to source moments.

Required walkthroughs:

- Find a bad image, compare versions, regenerate, follow progress, publish and explicitly resume a visual pause.
- Select thinking and speech independently, even when both come from one response; edit moment tags and play the resulting export selection.
- Scrub or step to a moment, keep the playhead and preview coherent, pause to inspect it, and move between scene tools and moment tools without losing context.
- Review a multi-panel scene, switch Mystery/Omniscient deliberately, and understand what is permitted in the selected export.
- Complete the same essential tasks by keyboard and on a narrow display without tiny timelines or overflowing tool panels.

Record operator feedback and approved prototype states before fixing the layout/component boundaries. Recheck the implemented A2.1/A2.2 timeline, repair, tagging and export journeys with the operator before accepting the combined A2.1/A2.2 delivery; subsequent refinements must preserve that working editor. This is a product design gate, not a per-game asset publication gate.

## Workspace and navigation

Proposed routes: `/admin/production` for the library and `/admin/production/games/[id]` for the studio. Scene/version selection should be addressable; choose exact query names in the implementation plan after inspecting current identifiers. URLs contain identifiers, never signed asset URLs, private evidence or draft contents. Library filters and return context survive opening a game.

Game admin offers **Open in studio**; the studio offers **Game overview**. Replace the current embedded editor copies and update callers/tests together. Remove superseded editor routes once callers move; do not maintain a compatibility editor. Old implementation documents may retain historical paths as evidence.

Desktop has three working areas, with timeline and playhead beneath the preview in the design submitted for operator review:

- **Scene/moment browser:** ordered scenes, recognizable thumbnails, cast/location labels, panel counts and explicit attention reasons; select a scene to find its player responses and moments. Missing scenes and form-only repair work need entries too; an absent scene row cannot hide a paused game. Moment inspection/tagging works even when no image was generated.
- **Preview:** selected image/panel at useful size, framing preview and current-versus-candidate comparison. Every panel must be reachable. Label exactly which version is visible and whether it is published for viewers or only available in production.
- **Inspector:** scene repair/coverage/version tools or selected-moment thinking, speech and tag tools, according to selection; show the selected job's status. Put provider IDs, attempts and charge evidence in expandable details. Avoid duplicating the full control list under every image.

Mobile keeps preview and usable transport together, with Browser and Details available as linked views or sheets of the same selection. Preserve playhead, drafts, request state and scroll; no three-column squeeze or animated panel changes. Stable headings and focus restoration matter more than decorative navigation.

A game-level **Episode & release** area keeps existing episode copy, cover, trailer and poster tools reachable. Batch naming remains in the library. Reuse the existing tool bodies and authorization; their redesign is not a prerequisite. Do not replace automatic naming, Cuts or trailer publication with mandatory manual approval.

## The repair interaction

| Operator intent | Action and result |
| --- | --- |
| The generated picture is wrong | **Regenerate scene** directly from preview; **Reject and regenerate** from the framing editor. No head marking, review save or publication prerequisite. Rejection here is intent to make another candidate, not a new persistent rejection taxonomy. |
| The image is good but framing is wrong | **Correct framing** opens the existing head/identity review. Saving produces the supported reviewed candidate; publication stays explicit. |
| Saved panels are good but the composite is poor | **Harmonize existing panels** acts on the immutable selected version. Preserve original panels when composition fails verification. |
| A provider receipt is uncertain | Explain that another render may incur another charge and request the existing acknowledgement for those exact attempts. Keep old receipts unsettled; don't invent cost evidence or silently replay the old operation. |
| A render is queued or running | Show saved job identity and its actual state. Permit browsing; block conflicting writes according to backend rules. An accepted request does not mean the candidate already exists. |
| A render fails | Show the failure and supported next action. Do not wait forever for a version that failed to materialize. |
| The candidate is acceptable | **Publish** with the existing revision/audience guards. Explain the scene's reuse and that already-open viewers may retain their pinned publication. |
| A required-visual pause is repaired | **Resume game** explicitly. Publication or switching to Best effort does not resume; the game adapter revalidates the pending boundary. |

Normal regeneration reuses match-frozen wolf forms; the existing explicit form-regeneration option remains separate. Missing forms can require repair without a pack scene. Doctor saves keep their canonical no-image treatment; do not manufacture hunt renders merely to fill the browser.

## Moment metadata and producer cuts — A2.1/A2.2

**Product clarification, 2026-10-09:** the producer wants a deliberate release edit, such as the best dialogue and the most impactful thinking, rather than an entire thirty-minute Omniscient replay. Metadata belongs to the **moment** in the product and selection contract. A response is provenance, not the editorial unit: one response can generate multiple events and moments that the producer must control independently.

### Minimal metadata contract

Use a flat key/value map per stable moment identity, for example `cut=youtube`. Proposed first values are strings, without nested documents, a taxonomy service or a query language. Set/delete keys in the moment inspector and show saved state. The implementation plan chooses validation limits and conflict handling.

Store annotations separately from immutable gameplay. A physical association with a response/event is acceptable only if it includes a stable moment discriminator and supports multiple independently tagged moments. The game adapter supplies validated source references; no assumption that both games share one response table or that every moment has exactly one source. Reject nonexistent or cross-game targets.

A thought and the spoken contribution from the same response have distinct moment identities and tags. A thought's entrance, reading, pagination, fade and return stay inside that thought's presentation; they do not need individual editorial tags. Ballots, outcomes and other supported non-message moments use their actual canonical source references, not fabricated response events. Define and test the supported moment catalog for both games in A2.1/A2.2.

IDs must survive timing edits, text pagination, image regeneration and windowed loading. Do not key tags by text, elapsed seconds, array index or a transient audience-window position. Seek/link coordinates and moment identity must map explicitly; they need not be the same value. A presentation-contract change that cannot preserve an identity must surface unresolved annotations for deliberate operator handling, not silently attach them to another moment.

Producer metadata is private editorial data with authenticated read/write authorization, game access checks and conflict-safe updates. Reading Omniscient evidence and editing tags remain separate capabilities. Keep annotations out of game events, contestant observations and public responses. Record editor/time without adding a moderation system or crowdsourcing workflow.

### Selection behavior

The primary operation is **build a cut from matching moments**, retaining source chronology. Use simple exact key/value matching; multiple pairs all match, absent keys do not. A filter never interprets values as code or model instructions.

| Moment | Tags | In the `cut=youtube` export |
| --- | --- | --- |
| Strong spoken contribution | `cut=youtube` | Included |
| Impactful thought from that same response | `cut=youtube` | Included independently |
| Routine spoken contribution | No matching tag | Omitted |
| Vote or outcome the producer wants | `cut=youtube` | Included by the producer's choice |

The previous response-level rule (matching thinking included, matching speech excluded) is superseded. Moment metadata never implicitly affects sibling moments or flips meaning by content type. To keep a thought and omit its paired speech, select/tag only the thought. Keep any separate include/exclude filters explicit if needed in the implementation plan; they are not a prerequisite for this minimal selection workflow.

**Continuity is the producer's responsibility.** No frontier-model evaluator, heuristic continuity warnings, automatic context insertion, mandatory retention of votes/results, or judgments about whether a cut tells a good story. The UI shows objective selection, duration, source position and actual playback. Producers can return to the source replay to change their selections using their own judgment.

The full replay remains unchanged. The cut contains exactly the selected permitted moments plus explicitly selected opening/ending material; nothing is inserted for narrative reasons. Define opening/ending controls in the design gate rather than silently including them or losing them through a message-only filter. Technical asset/state dependencies may load to render a selected moment but may not introduce extra visible moments.

No-filter full exports preserve existing behavior. Selected thinking requires a permitted audience and explicit thinking selection/settings; never upgrade Mystery to Omniscient. Invalid selection configuration fails clearly. Zero matching moments produces an explicit empty-cut state and no render, rather than falling back to a full movie. Preview and export use one selection implementation.

### Timing, privacy and reproducibility

Apply audience projection before editorial selection. Reconstruct the canonical state at every selected source position from the complete authorized history or validated snapshots, **not** by reducing only selected events. Omitting a vote from the movie cannot undo its accepted effect on a later scene. The movie edit changes presentation, never game facts.

Compile the selected moments into a contiguous presentation timeline with recalculated duration and audio. Omitted moments leave no old-duration blank holds. Recompute camera entry/return, text pagination, transitions, music placement and ducking from the selected sequence; a thought must render correctly when its sibling speech is absent. Preserve moment IDs and source chronology while elapsed times change. Authored opening media keeps its internal audiovisual timing when selected.

The playable cut preview and local export consume the same selection, timing and sampled presentation contract. Studio audio follows that cut's presentation clock so seeking previews the intended export; the public player's existing ambient-music seeking policy can remain separate. Mute and volume stay top-level. No new speech generation is required; existing recording inputs must omit audio/captions for excluded speech and retain synchronization for included speech.

Freeze moment metadata revisions, resolved moment IDs, predicates, timing and chosen asset versions in the prepared export. Later edits require new preparation; they cannot change an existing bundle. Show when a prepared export differs from current studio selection instead of implying it is current. Reuse the local exporter with this frozen cut; hosted rendering/upload/publication remain separately scoped.

Authorized metadata access must fail explicitly when unavailable rather than treating hidden tags as absent. Mystery bundles never contain private thinking/pack evidence for the renderer to hide. Freeze only required permitted presentation data and selection provenance, not excluded private text in receipts. Any material changed by scene repair must be deliberately reflected in preview and newly prepared export; selecting a candidate does not publish it.

## Current source and capability inventory

Paths below are relative to the repository root. These are seams to reuse, not a new generic production framework.

| Capability | Existing implementation | Studio work |
| --- | --- | --- |
| Library/discovery | Web `packages/web/src/app/admin/production-panel.tsx`; API `packages/api/src/services/visual-replay-production.ts` | Replace expanding rows with studio links. The production query already includes both completed game kinds plus Werewolf visual pauses. Admin listing remains Influence-only, so admin-only Werewolf discovery still needs an explicit read contract. |
| Scene inventory and preview | `replay-visual-production-panel.tsx`; API `visual-replay-production.ts`, `werewolf-production.ts` | Extract scene selection, all-panel preview and attention summaries; distinguish a reusable scene from a moment. Reuse existing character-framing preview. |
| Repair/version/publication | Web `games/[id]/visual/scene-repair-panel.tsx`, `image-review-editor.tsx`; API `visual-media-repair.ts` | Move the existing operations into the inspector, preserving immutable versions, revision guards and exact request receipts. |
| Session continuity | Web `admin-session.tsx` | Reuse ownership of requests/drafts across navigation, auth generation fencing and stale-result handling. Moving a panel must not make the panel its mutation owner again. |
| Pause and recovery | API `werewolf-visual-policy.ts`, `visual-policy.ts`; current replay production controls and Influence visual editor | Preserve game-specific validated boundaries, form-only work and explicit resume. No generic game-state patch. |
| Episode and release | Web `episode-editor.tsx`, `admin-postgame-media.tsx`, Werewolf workspace; existing episode/postgame media routes | Give existing tools a consistent home; retain metadata locking, batch review and retry behavior. Account for each tool's actual read/write permissions. |
| Playback | Shared watch components, game presentation adapters and export timing compiler | A2.1/A2.2 integrates the timeline, playhead and playable source/cut preview. Fix encountered reducer/render state bugs at their shared owner. Candidate inspection never changes viewer publication or audience access. |
| Producer tags/export selection | New A2.1/A2.2 work; source/cue identities and export compiler are integration seams | Add stable moment identities and flat annotations, permissioned edits, live cut preview and frozen selected exports through one selection implementation. |
| Full-game video | `packages/web/src/lib/replay-export/`, Remotion replay composition, CLI | Already local, with prepared bundles, timing overrides and recording inputs. Hosted execution, storage/publication and studio UI are not implemented. |

Permission work needs its own small matrix in the A2.1/A2.2 plan. Replay production currently requires producer/sysop even for reads; policy/resume additionally require `start_game`. Episode reads require `view_admin` or `manage_roles`, while edits/backfill require `manage_postgame_media` or `manage_roles`. Other visual/media tools have their own existing grants. Library access is not permission for every action. Reconcile discovery using minimal metadata allowed by the caller's grants; do not widen private image access or paid generation to solve a missing link. Where product policy must change, state it explicitly before implementation.

The Needs attention filter may need a bounded summary read; current library rows do not expose every reason. Do not fetch full scene images or one complete production inventory per game just to render the library. Add only the narrow summary needed by the selected workflow, preserving authorization.

## A2.1/A2.2 timeline, preview and seek reliability

Scenes are reusable imagery; moments are independently selectable presentation units; asset versions are outputs. The source timeline exposes all audience-permitted moments. The cut timeline exposes the selected sequence at its actual edited duration. Clearly label which is active. Map the playhead to a moment plus local offset, and retain source references for jumping back to the original position.

Provide click-to-seek, continuous drag scrubbing, Previous/Next moment stepping, play/pause and readable time/duration. Seek updates must show the sampled picture while dragging, not only after release. Timeline zoom/scroll should make long games navigable; the operator prototype settles the smallest useful controls. Selecting an image for comparison and selecting a timeline moment are distinct actions. Keep a scene still/candidate comparison visibly separate from the playable cut preview.

Use the existing renderer, game reducers and shared presentation compiler. Coordinate with the [presentation-time scrubber follow-up](../refactor-queue.md#shared-presentation-time-scrubber--2026-10-07): A2.1/A2.2 needs this timing contract for studio preview/export, not a third private clock. Migrating every public-player transport can remain separate. Do not parse dialogue for game state or fork reducers into studio-only implementations.

**Constant seeking is a development and acceptance workflow.** Fix concrete shared reducer/renderer defects exposed by it within A2.1/A2.2, with focused regressions. Do not defer them to a later refinement pass or claim a working preview based only on uninterrupted forward playback. Bound fixes to reproducible presentation/state defects; broad unrelated transport redesign stays separately tracked.

The proof matrix includes both games, generated scenes and portraits, Mystery/Omniscient, source replay and selected cut, thinking/speech selection, long text pages, scene/version changes, ballots/tallies, role actions, transformations and opening/ending boundaries:

- Visit the same sampled time through forward playback, backward seek, random jumps and fresh mount. Facts, image/crop, thought/speech visibility and text page agree independent of navigation history.
- Drag rapidly across boundaries, reverse direction while assets load, and release while paused or playing. Latest seek wins; stale loads cannot repaint a prior scene or restart removed audio. Preserve play intent while the requested frame prepares.
- Seek across omitted moments, including a thought without its speech and a result whose preceding vote is omitted. Canonical state remains correct and no omitted dialogue/audio reappears.
- Edit tags/filter selection while paused. Rebuild duration and retain the same moment/local offset when it survives; when removed, choose a documented deterministic neighbor and visibly update selection. Stop playback before applying a changed cut so it does not jump unnoticed.
- Compare preview samples with exported frames and audio positions from the same frozen cut. Use the existing one-frame-plus-codec audio tolerance; do not claim MP4-byte equality.

Record representative seek sequences as repeatable tests, with deterministic fixtures for rare states and browser tests for real pointer dragging. Mechanical correctness checks do not assess story quality or add missing narrative context. Operator acceptance must include actually making and watching a shortened cut.

## A2.2: included editor scope and deferred refinements

A2.2 is part of this delivery: timeline, playhead, playable source/cut preview, independent moment editing and selected export. The shared foundations and repair workspace remain A2.1; their implementation tasks and acceptance are coordinated because scene selection, moment selection and preview depend on the same contracts. Richer scene-to-use navigation and private candidate-in-playback comparison are deferred refinements to scope from operator use. They do not stand in for A2.2. Do not invent a second timeline or grow this into general-purpose clip rearrangement.

Reuse the [local export contract](../local-replay-export.md) and shared content components. Exporter performance optimization remains its [separate plan](../plans/2026-10-08-001-perf-replay-export-readiness-and-concurrency.md). Voice generation, waveform/audio editing and hosted full-game rendering require later scoped decisions. Human review of the working interaction continues as those capabilities are added.

## A2.3: cross-game attention and jobs

After selected-game recovery is usable, aggregate existing jobs and receipts across games. Keep source-job links and actual retry/cancel/reconciliation capabilities; do not invent a universal state machine, scheduler or cancellation endpoint. Generated, reviewed, published and playable describe different facts.

A2.1/A2.2 needs selected-game status, not a full cross-game job console. Existing operational pages remain available during this staged implementation. Replace each duplicate surface when its replacement is usable; do not leave two active editors for the same action.

## Acceptance cases for the A2.1/A2.2 implementation plan

1. **Bad first generation:** direct regeneration from the image/editor, no fake head review, new candidate and explicit publication. Exercise both a known receipt and an uncertain charge acknowledgement; cancelling acknowledges nothing.
2. **Paused Werewolf:** repair the exact pending boundary, including a missing scene and form-only case; reject premature/stale resume; publish and explicitly resume without replaying accepted gameplay.
3. **Completed Influence:** browse multiple panels, correct framing or harmonize a selected version, retain good panels after a failed composite, compare and publish.
4. **Navigation and races:** queue work, leave/return, reload to read server evidence, switch games rapidly, fail a receipt read, expire authorization. Never duplicate paid requests or show one game's candidate under another title. Browser-session drafts and server-owned reload recovery remain distinct.
5. **Access:** producer, sysop, admin-only and unauthorized users each see only their permitted discovery/actions. Server enforcement survives direct URLs and stale UI permissions.
6. **Publication and audience:** an unpublished candidate stays private; Mystery never receives pack/role/thinking evidence; public delivery respects existing publication cutoffs. Verify delivery separately from job completion.
7. **Moments and exports:** independently tag thought/speech/action moments from the same response, persist across reload and timing/image changes, and export only matching moments. Cover empty selection, tag removal/conflicts, invalid/cross-game identities and denied reads. Prove frozen selection, unchanged full export, correct state after skipped events, no omitted audio/captions, and preview/export parity. No continuity evaluator or automatic context insertion.
8. **Review gates and seeking:** record simplification/consistency dispositions and the approved editor prototype; demonstrate repeated random/backward/drag seeks and a shortened cut in the delivered timeline/preview. Regressions found in shared reducers/renderers are fixed and covered. Static scene preview plus a CLI export alone does not pass.
9. **Desktop/mobile and tool retention:** keyboard-accessible selection, no overflow, useful preview sizes; episode editing, naming batches and trailer/poster recovery remain reachable after cutover.

Use existing deterministic browser/database fixtures to manufacture failed, uncertain and paused states; a recent real game is not required for each test. Run required repository checks for implementation. Real provider generation and publication are separate, explicitly scoped acceptance work; UI tests do not require paid calls.

## Next decision and deliverable

The [A2.1/A2.2 implementation plan](../plans/2026-10-09-001-feat-production-studio-moment-editor.md) orders the work from source provenance and independent moments through annotation storage, bounded production reads, a shared preview/export compiler and the actual editor. Current cues couple thinking and speech, Werewolf cursors are audience-local, and suspended Influence has distinct recovery operations; those are early contract tasks, not details to discover after moving panels.

Start with the simplification/disposition record, stable moment catalog and bounded Remotion Player host proof. Use those fixtures for the operator UX prototype gate before committing the workspace layout. Technical foundations may proceed before that gate. The plan specifies one sparse annotation table and frozen local-export descriptors, without a new cut database, job queue or narrative evaluator. Complete a second simplification/consistency review at cutover.

Later editorial candidate swapping, richer emotional performance tracks, soundtrack authoring and general-purpose clip rearrangement stay outside A2.1/A2.2. The video-editor interaction model is part of the initial design gate; it is not deferred with those advanced editing features. The historical [emotional cues exploration](2026-09-30-emotional-performance-cues.md) remains a separate proposal; it is not required to ship the studio.
