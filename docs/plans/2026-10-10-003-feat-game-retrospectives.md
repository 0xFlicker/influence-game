---
title: Postgame contestant retrospectives across Influence and Werewolf
type: feat
status: in_progress
date: 2026-10-10
---

# Postgame contestant retrospectives

The operator agreed on 2026-10-10 that retrospective completion becomes the new final execution boundary, driven by the core engine and existing game worker. The [integration research](../research/2026-10-10-game-retrospectives-research.md) and [implementation task plan](2026-10-10-004-feat-game-retrospectives-implementation-plan.md) record the researched contracts, dependencies and proof. RT-01–14 are implemented and locally verified on `codex/game-retrospectives`, covering the [exact contract](../game-retrospective-contract.md), [frozen context/order](../game-retrospective-context.md), runtime, API/MCP, replay, Studio, export and simulation artifacts. Real-model quality and deployed acceptance remain RT-15 operator work.

## Goal and scope

After a game finishes, every seated contestant receives the whole game's story and gives a final statement about their part in it. Replay shows the established results first, then continues through these statements using the game's introduction-style contestant presentation. The feature includes durable generation, API delivery, MCP inspection and recovery, public playback, Production Studio editing, and local video export for both Influence and Werewolf.

This is a contestant-authored epilogue, distinct from elimination last words, House narration, and the Owner Learning review. An eliminated contestant learns what happened after their departure. A statement may acknowledge mistakes, explain intentions, react to revelations, congratulate or challenge others, and answer earlier statements. It cannot change any game result or automatically update an Agent Profile.

Automatically enter the retrospective after every new game's canonical outcome, including Werewolf draws and both Influence kernels and their supported formats. Waiting, pre-outcome cancelled, or failed games do not qualify. A suspended retrospective resumes its own accepted prefix. Historical backfill was not requested and is outside the first implementation; reads never initiate generation.

This document is a high-level implementation plan. No implementation, provider spending, backfill, or deployment is performed by creating it.

## Product contract

| Area | Required behavior |
| --- | --- |
| Coverage | Every original contestant appears exactly once, including eliminated players, finalists, winners, and eliminated members of a winning Werewolf faction. The House is not an additional contestant. |
| Context | Every contestant receives a complete chronological account from introductions to final results, including events after their own exit. A comprehensive summary is acceptable; a highlights-only account is not. |
| Influence order | Earliest exit first, through the last exit; remaining nonwinning finalists follow, with the winner last. Derive exits and final outcomes from canonical facts. |
| Werewolf order | Eliminated contestants in canonical elimination order, counting both night deaths and day eliminations, then all survivors in a random order frozen once. Faction victory does not change this order. |
| Prior statements | Influence speaker N receives the exact accepted statements from speakers 1 through N−1. Proposed shared behavior: give Werewolf speakers the same prior-statement context. |
| Generation | Generate and durably accept one statement before preparing the next speaker's request. Do not batch calls against an empty or stale prior-statement prefix. |
| Playback | Results reveal → retrospective chapter → one introduction-style player segment per accepted statement → end of replay. Autoplay continues after the result's existing readable hold. |
| Authority | Game facts and ordering come from canonical game projections. Statements are untrusted contestant speech and never establish game facts. |
| Availability | Results remain final and accessible while the retrospective is pending or failed. Public readers and exporters report incomplete retrospective availability explicitly. |

For Influence contestants without distinct canonical final placements, use frozen initial seat order to resolve an otherwise equal final position, keeping the winner last. Do not manufacture an elimination event for a finalist. Where several exits share a source boundary, use the source's explicit ordering and then frozen seat order. Werewolf games with no elimination start directly with the frozen survivor permutation; draws use the same rule.

## Complete game context and final-statement prompt

Build a frozen, game-owned postgame dossier at the canonical outcome boundary, before retrospective generation. Prefer a complete compact factual summary with relevant dialogue, rather than relying on a potentially oversized transcript. Full eligible dialogue can be included when it fits the model's context window.

The dossier contains the original cast and rules, a chronological section for every played round or day/night and meaningful phase, accepted decisions and their resolutions, eliminations, and the final outcome. Preserve consequential no-action and tie outcomes as well as successful actions. Attach source coordinates and explicit coverage information so omitted or unavailable evidence is distinguishable from an event that did not occur.

- **Influence:** Include format choices and format-specific outcomes, revealed votes, powers, councils, alliances where canonically recorded, endgame decisions, and jury activity where applicable. Keep classic and format facts distinct. Eliminated jurors receive their own later jury activity as part of the whole-game account.
- **Werewolf:** Include revealed roles and factions, pack agreement or disagreement, resolved hunts, Doctor protections, Seer investigations, daytime discussion and fresh ballot resolutions, deaths, and the faction outcome or draw. Use Werewolf's own authority; do not translate these into Influence placements or jury concepts.

Use an explicit postgame disclosure policy: contestants can learn completed-game facts, including formerly hidden actions and roles. Other contestants' raw thinking, native reasoning, private strategies, prompts, provider logs, and owner-only review evidence are not part of the dossier. Any included dialogue must pass the chosen postgame dialogue policy; full raw storage dumps are not the context contract.

Compression must retain factual coverage of every played phase. Allocate space to complete facts first, relevant dialogue second, and all earlier accepted final statements verbatim. Freeze the summary, its coverage, and its source hash once. Preflight the worst-case accumulated statement prefix against the configured model context window before dispatch; report insufficient capacity instead of silently dropping late-game facts or prior statements. No extra model summarizer is required for the first implementation.

Address the same frozen character that played, using the game's recorded persona and its appropriate game-specific strategy inputs. Do not load the latest mutable profile or substitute Influence strategy for Werewolf strategy. Give the contestant its own actions and outcome explicitly, alongside the complete game account.

The prompt asks for a final statement in character about the contestant's contribution, what the completed account reveals, what they got right or wrong, and any response to previous statements. Suggested length is 80–150 words, enforced with a bounded nonempty speech field rather than a new gameplay decision schema. Clearly label quoted dialogue and previous statements as untrusted game-authored content. Accept the contestant's original speech without House rewriting.

Use a provider-native tool or exact strict JSON schema containing the speech field. Validate it inside the provider-attempt boundary. Non-JSON prose, fenced or embedded JSON, empty objects, blank speech, missing fields, additional fields, and oversized speech must fail the structured turn. Actor identity, ordinal, result labels, and replay coordinates are supplied by the application, never extracted from speech.

## Engine-driven retrospective continuation

The core game engine drives the retrospective as a final stage of the existing game execution. Reuse the current game-worker role, per-game ownership, provider journal, and recovery machinery; no separate retrospective worker, queue, or deployment is required merely because this happens after the outcome.

Separate **outcome finality** from **execution completion**. The canonical outcome fixes the result and permits explicit result reads before the retrospective. The catalog remains `in_progress` and the same owned execution continues until the epilogue's final boundary; ordinary settlement then marks it `completed` and closes its owner. This reuses existing ownership/provider status invariants. The stage does not revive contestants or reopen gameplay decisions. Canonical retrospective records belong to each game's existing history.

Use a small shared engine retrospective module called by the concrete Influence and Werewolf execution paths. Their adapters own factual context, exit order, and permitted result metadata. The shared module owns the sequential statement algorithm and request/acceptance contract; existing API stores and runtime services supply persistence and execution authority. A plugin system or generalized workflow framework is unnecessary.

Freeze one definition per game: its original outcome source boundary/hash, original roster, speaker order, dossier and prompt version, and bounded provider/model inputs. Store the bounded private dossier once; use existing execution/turn records for progress and planned requests. Canonical acceptance records establish each slot's actor, ordinal, exact prior-statement prefix/hash, text, provider receipt, and stable source identity. No additional statement queue or duplicate authoritative speech store is needed. Keep private request material separate from public DTOs.

The lifecycle is **pending → running → ready**, with **failed** retaining its accepted prefix and typed failure. Missing or ineligible historical runs have explicit read availability; they are not empty successful retrospectives.

1. The canonical outcome commit durably establishes the retrospective frontier. Expose the result through canonical outcome reads/presentation before requesting any final statement, while retaining operational `in_progress`. Do not prematurely emit transport completion or seal the transcript/accounting.
2. The existing game execution retains its owner and advances into the retrospective stage. Extend the closed cursor and prepared-slot validators, plus recovery predicates that currently assume an outcome means execution has stopped. A restarted worker resumes this stage through existing adoption without rerunning gameplay. Deployment drain keeps counting its active ownership; no discovery of completed historical games is introduced.
3. Prepare and persist the next request from the frozen dossier and committed statement prefix before provider dispatch.
4. Validate the response and atomically commit that slot under the owner fence, expected ordinal, and expected input hash. Publish it only after commit.
5. Prepare the next speaker only after that commit. Mark the retrospective ready once every contestant has one accepted statement, then enter the ordinary terminal settlement, seal the full transcript/cost, mark the game completed, and close its lease.

Recover accepted provider values after a crash before slot commit without dispatching the same logical request again. A restart must preserve both Werewolf's survivor permutation and the exact earlier speeches. Stale owners cannot commit, and duplicate scheduling cannot create another run.

After shared retries are exhausted, checkpoint failure, suspend/release the owned execution through a typed recovery path, and expose the accepted prefix while preserving the canonical result. Do not invent a statement, silently skip the contestant, or generate downstream speeches that would later acquire a different prior context. Explicit producer recovery re-enters the same existing execution path at the first unfinished slot; accepted statements and their inputs remain immutable. Replacing an accepted speech or rebuilding a completed run is outside the initial scope.

The current code does not yet support this distinction: Influence routes outcome exits to its terminal cursor and hides final facts before settlement; Werewolf stops when an outcome exists, and its API store closes the owner when that outcome commits. Refactor those termination boundaries deliberately. A result must not close statement delivery, discard original contestant inputs, invalidate provider commits, or cause worker drain to overlook continuing execution. Local simulation invokes the same engine stage after its result boundary, using its local store.

Record retrospective token usage, attempts, model, duration, and cost separately from gameplay turns in the existing accounting surfaces. One sequential speech turn per contestant is the baseline; perform capacity and spending preflight. Ordinary rewards, ratings, learning entitlements, final accounting and automatic postgame jobs remain at the new final boundary. A stalled epilogue delays those completion effects and full-export readiness, while viewers can already see the immutable outcome. Splitting settlement is outside this plan.

## API and MCP

Provide one shared House retrospective read boundary with game-specific projections. Return identity, source boundary, availability/completeness, frozen order, accepted statements, safe player/result metadata, and stable replay links. Use bounded pages and consistent snapshot reads. A growing accepted prefix must not shift earlier positions or silently change a reader's pinned head.

The browser can observe committed statement progress through existing delivery mechanisms or bounded refresh. It must continue observing postgame work after the canonical outcome is available. Reconnecting fetches the persisted prefix; opening a replay or results page never causes a provider call.

Extend the shared House MCP contract with a proposed `read_game_retrospective` tool for both games. It supports bounded pagination and optional player filtering, reports incomplete coverage, and labels speech `untrusted_game_authored`. `read_game_results` and game inspection supply typed follow-ups to it. Relevant transcript/timeline inspection exposes the same accepted speeches through an explicitly identified postgame lane, without pretending they are in-game decisions.

Provide a producer-authorized MCP resume action matching the admin recovery control, using one guarded runtime service and idempotency boundary. It resumes the failed next slot and never overwrites accepted statements. Define current role, OAuth scope and mutation-permission checks explicitly; present producer diagnostics do not imply an existing generation capability. No historical start/backfill workflow is added. Ordinary `games:read` access must not gain generation or recovery permission.

Apply current Public/Unlisted/hidden access rules to direct APIs, MCP reads, statement links, and media. Public DTOs exclude dossiers, strategy, native reasoning, private trace pointers, credentials, and raw provider payloads. Reads are spoiler-explicit, like completed results. Thinking remains a separately authorized lane if captured; it is not required for this feature.

Update registered input/output schemas, generated House MCP schemas, authorization, response-size validation, follow-ups, and documentation together. Local simulation/MCP inspection should expose recorded retrospective artifacts for each supported game without routing Werewolf through Influence's local fact reducer.

## Replay presentation and Production Studio

Add a **Retrospective** chapter after the result reveal. Give each contestant a segment containing frozen name/portrait, a concise canonical label for their part or outcome, and their accepted final statement. The contestant's speech is the recap; no second House-authored recap generation is needed.

Reuse the existing introduction portrait/solo presentation, camera, speech timing, and portrait assets where available. Use a Retrospective heading/caption and explicit semantic type, even when the visual treatment matches introductions. Werewolf already has contestant introduction presentation and an authored opening; reuse the contestant treatment without replaying the entire opening montage. An eliminated contestant's segment must not restore them to the living game roster.

Normal playback and autoplay proceed through the result's existing readable duration into the retrospective. Pause, next/previous scene, chapter navigation, scrubbing, restart, fullscreen, reduced motion, captions, and share links must all reach these segments. Direct retrospective links resolve before autoplay and use the accepted event's existing Influence sequence or Werewolf audience/cursor coordinate, not a cue-array index or elapsed time. No new replay-route namespace is needed.

Preserve historical disclosure boundaries. Seeking back before results removes final outcome and retrospective data from the active frame. Werewolf Mystery can show the accepted public epilogue after results; it must not reveal its full postgame dossier, raw night-action evidence, or future statements in earlier windows. Switching audience clears stale buffers under the existing policy. A deliberately selected retrospective-only cut is an explicit ending disclosure.

When generation is still running, playback can consume the accepted prefix and show a clear waiting state at its end. New statements append without resetting position or overriding a user pause. An exhausted failure offers the results and accepted prefix with an understandable unavailable continuation. The results page keeps results accessible and supplies a link to the retrospective and its generation status.

Extend the Production Studio catalog with accepted retrospective speech moments, stable provenance, actor identity, and an explicit retrospective chapter/segment distinction. Reuse ordinary speech labels and selection controls. Include these speeches in newly compiled full episodes and allow individual statements or a retrospective-only selection. Optional result inclusion stays an explicit cut choice; do not add an omitted result merely to precede a selected speech.

The current shared renderer/compiler and presentation clock must own timing for web playback, Studio Source, Selected cut, and export. Do not create a separate epilogue timer. Reuse frozen portraits; the retrospective must work without new generated artwork.

## Export and editorial integration

New full exports include **gameplay → results → complete retrospective**. Keep the existing completed-game requirement: a pending or failed epilogue cannot silently produce a supposedly complete episode. Its accepted prefix remains watchable/inspectable while completion awaits recovery. Finalized games support deliberate gameplay-only or retrospective-only cuts. Historical games without captured statements expose that absence; export never generates them.

The production source snapshot and prepared bundle pin the retrospective definition/source hash, exact statement IDs and text, order, safe result metadata, portraits/media versions, timing, and audio references. A frozen selected export or prepared bundle cannot silently acquire later source content or reorder survivors. Refreshing source is an explicit review step; export itself remains read-only and performs no text, image, or voice generation.

Use the shared speech/audio schedule for captions, reading duration, existing music and ducking, and optional local recordings. Recording metadata must match the exact actor, speech text, and hash. Unselected statements contribute no duration or audio. Support range inspection, a result-to-retrospective excerpt, retrospective-only export, offline bundle rendering, and repeatable arbitrary-frame rendering through the existing CLI.

House Cuts/highlight discovery must recognize the new postgame lane as ending-spoiler material. A Mystery discovery window before results cannot ingest later statements or use them to characterize earlier play. Selected cuts may intentionally include accepted statements with explicit provenance and disclosure; the existing trailer need not automatically acquire a retrospective section.

## Delivery sequence and owning surfaces

| Slice | Concrete outcome | Main existing surfaces to extend |
| --- | --- | --- |
| 1. Contract and context | Provider-free fixtures prove complete context, all contestants, both orders, source identity, and strict speech validation. | Engine results/projections, Werewolf modules, provider contracts; small shared retrospective module with explicit adapters. |
| 2. Engine continuation | Outcome settlement advances the existing owned run into retrospective statements; recovery and drain cover both stages; local simulation records the same artifacts. | Engine runners, API completion/worker/store services, DB schema, provider execution hooks/accounting, engine/API simulation paths. |
| 3. Reads and recovery | Web and MCP read the same accepted prefix; producers resume failed work through one guarded existing runtime. | House inspection/results services, API routes, admin, MCP contracts/authorization/generated schemas, simulation inspection. |
| 4. Watchable epilogue | Both games play from results into introduction-style statements with working transport and stable links. | Shared House watch transport, Influence visual presentation, Werewolf watch modules, game-links, results views. |
| 5. Studio and export | Statements can be labeled, selected, previewed, recorded, frozen, and rendered with web/export parity. | Production source services and engine catalog, Studio, replay-export compiler/source/manifest/audio, CLI verification. |
| 6. Acceptance and deployment | Complete deterministic journey plus separately authorized model-quality and staging acceptance. | Browser fixtures, PostgreSQL tests, operational docs, local-model examples and release workflow. |

Each slice builds on a working previous slice. Deployment is the feature gate; do not add speculative flags or a public disabled feature. Stage the complete vertical feature before release, with both games covered.

## Acceptance and validation

The checked items below are local deterministic evidence, recorded by task in the implementation plan. Encoded proof covers one frozen retrospective speech per game; full-tail composition and recording alignment are compiler/attachment tests, rather than an encoded long-episode quality trial.

- [x] Canonical outcome projection publishes results before retrospective generation while the catalog remains active; final settlement waits for retrospective completion. Restart resumes only the unfinished stage, and deployment drain counts its active ownership.
- [x] Influence classic and format fixtures include every contestant in exit order, remaining finalists, winner last, and exact earlier speeches in each later request.
- [x] Werewolf fixtures cover night deaths, day eliminations, no-elimination games, dead faction winners, surviving losers, and draws. Survivor order is identical across retry, reload, web, MCP, Studio, and export.
- [x] An early-eliminated player receives the remainder of the game. Long-game context retains every played phase and outcome, including no-attack nights, tied votes, and jury activity where applicable.
- [x] A speech cannot alter canonical state, final outcomes, faction winners, placements, profiles, or earlier statements. Neither ordering nor factual labels are inferred from prose.
- [x] Malformed structured output is retried or fails explicitly and cannot become accepted speech. Include non-JSON text, fenced/embedded JSON, `{}`, missing/extra fields, blank/oversized speech, and exhausted retries.
- [x] Crash tests cover outcome commit before retrospective initialization, before dispatch, accepted provider response before slot commit, after commit before next preparation, duplicate outcome handling, lease expiry, and stale-owner rejection. Recovery preserves accepted inputs, avoids redispatching an accepted logical response, and never repeats result side effects.
- [x] A failed slot blocks downstream generation; retry uses the exact frozen dossier and accepted prefix. Results and ordinary game reads remain available throughout.
- [x] Public API and authenticated MCP transport tests prove shared content, schema/byte bounds, pinned pagination, permissions, spoiler-explicit access, hidden-game denial, producer recovery authorization, and private-field exclusion.
- [x] Browser tests play both games from final result into retrospectives, seek backward/forward, open a shared retrospective link, switch Werewolf audience, reconnect during generation, and preserve pause when new statements arrive.
- [x] Local screenshots and browser checks cover introduction visual reuse, eliminated-player identity, readable fixture statements, narrow/fullscreen layouts and absent generated visuals. Real-model statement length and watchability remain below.
- [x] Studio and export tests cover individual and retrospective-only selections, explicit result inclusion, completed-game gating, range output, exact audio/recording alignment, arbitrary-frame parity, and frozen IDs/media that cannot silently expand or change.
- [ ] Separately authorized real-model trials establish whole-game accuracy, character voice, responses to priors, repetition and enjoyable episode length.
- [ ] Staging establishes real worker continuation/recovery/drain, web/MCP delivery and export preparation for both games; production retains manual deployment approval.

For implementation that will merge, run `bun run test`, `bun run test:postgres`, and `bun run check`. Shared PostgreSQL tests call `setupTestDB()` and remain sequential; browser harnesses use disposable databases and clean their children/databases. Do not run competing browser harnesses against the same Next build directory.

Deterministic fixtures prove contracts and recovery. Separately authorized local-model/provider trials judge whether contestants accurately reflect on the whole game, remain in character, and make the epilogue enjoyable to watch. Staging verifies the existing game worker's result-to-retrospective continuation, recovery, drain, delivery, authorization, and export preparation for one complete game of each kind. Production deployment retains its manual approval boundary; local tests do not establish deployed or paid-provider behavior.

Update `CONCEPTS.md`, `docs/werewolf.md`, `docs/replay-experience-spec.md`, `docs/production-studio.md`, `docs/local-replay-export.md`, `docs/game-mcp-production-oauth.md`, and operational/accounting documentation as their contracts change. Changes to contestant prompts, transcript artifacts, or simulation output also update `docs/reasoning-transcript-observability.md`, `docs/local-model-evaluation.md`, relevant `DEVELOPMENT.md`/`README.md` examples, and `simulate.ts` JSDoc. Keep direct House calls and no `as any` explicit; record new recovery/disclosure learnings in `docs/solutions/`.

## Repository grounding

Inspected the active development checkout on 2026-10-10. It contains ongoing Production Studio edits; this plan adds a document without modifying those changes. The following are integration points and current constraints, not claims that retrospectives already exist:

- [Influence completed results](../../packages/engine/src/completed-game-results.ts) derives elimination order from canonical `player.eliminated` events and separate finale/jury facts. Finalists therefore need an explicit terminal ordering rule.
- [Werewolf results](../../packages/engine/src/werewolf/results.ts) builds deaths, ballots, roles, faction outcomes, and completion source from validated history; [runner](../../packages/engine/src/werewolf/runner.ts) stops at the completed boundary.
- [House results](../../packages/api/src/services/house-game-results.ts), [House inspection](../../packages/api/src/services/house-game-inspection.ts), and [MCP contracts](../../packages/api/src/game-mcp/house-contracts.ts) share inspection while retaining game-specific authority.
- [Influence presentation](../../packages/web/src/app/games/[slug]/components/visual-presentation.tsx) and [Werewolf stage](../../packages/web/src/components/games/werewolf/werewolf-watch-stage.tsx) already provide introduction-style contestant portrait treatment.
- [Production moments](../../packages/engine/src/production-moments/index.ts), game-owned [Influence](../../packages/engine/src/production-moments/influence-source.ts)/[Werewolf](../../packages/engine/src/production-moments/werewolf-source.ts) source assemblers, and the [export source loader](../../packages/web/src/lib/replay-export/production-source.ts) establish accepted-source provenance and fixed snapshots.
- [House entry/replay learnings](../solutions/architecture-patterns/house-game-entry-and-replay-moments.md), [House MCP learnings](../solutions/architecture-patterns/house-mcp-across-game-kinds.md), and [separate Werewolf authority](../solutions/architecture-patterns/separate-werewolf-game-authority.md) establish stable links, disclosure boundaries, and explicit dispatch.
- [Studio plan](2026-10-09-001-feat-production-studio-moment-editor.md), [current editing refinements](2026-10-10-002-feat-production-studio-editing-refinements.md), and [local export contract](../local-replay-export.md) require source-order selection and frozen exports that do not silently expand.
