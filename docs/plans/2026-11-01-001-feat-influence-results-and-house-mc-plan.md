---
title: Influence result scenery and House MC announcements
type: feat
status: implemented
date: 2026-11-01
---

# Influence result scenery and House MC announcements

## Outcome

Make Influence results feel like a hosted show. Every viewer beat has visible scenery; results use relevant player imagery; the House announces the result in distinctive LLM-authored speech while the corresponding outcome is displayed. Viewers have enough time to understand the facts at 1× playback.

Implementation was subsequently authorized in this conversation. Deployment and paid/provider evaluation remain separate; deployment requires all in-progress games to drain first.

## Product decisions

- The House is the MC. Use the existing summary author and voice pipeline, not a second commentary generator.
- At a resolved outcome, lead with the decisive facts and add one short, grounded sentence about their significance. Encourage natural variation without templates, mandatory catchphrases, invented motives, or uniqueness retries.
- Present results and their announcement as one sequence. Do not finish a silent result screen and then cut to a separate House summary screen.
- Use a result-led layout for tallies and rules, with greater cast emphasis for an eliminated player or winner. Keep the relevant result visible through commentary.
- Black panels are allowed. Full black stages and empty scenery during speech or transitions are not.
- Reuse applicable accepted scenery or bundled rooms and frozen player art before commissioning any new images.
- Timing follows the shared presentation director and playback speed. Deployment is the release gate; no feature flag.
- Keep accepted historical dialogue, recordings, game events, provider evidence, and frozen exports unchanged. New authoring uses the new prompt; accepted old speech can receive better scenery without being rewritten or presented as newly authored.

## Current sources and findings

| Area | Owning source | Change needed |
| --- | --- | --- |
| House authoring | `packages/engine/src/house-interviewer.ts` | Current prompt invites broad arcs/private threads without a result-first requirement. Retain exact structured output and direct House invocation. |
| House facts | `packages/engine/src/house-summary-frontier.ts` | Existing canonical mappings carry Empower and jury counts, but format/Council/endgame elimination mappings omit decisive tally detail. Add focused result facts derived from canonical authority. |
| Cadence and publication | `packages/engine/src/game-runner.ts` | Existing boundaries already cover results. Preserve durable acceptance, one-attempt policy, private notebook, and nonfatal failure. Carry explicit presentation association through publication. |
| Source ordering | `packages/engine/src/production-moments/influence-source.ts` | Summaries are independent classic-lane sources. Preserve source identity while composing eligible announcements with their result. |
| Viewer composition | `influence-presentation.ts`, `visual-watch-model.ts`, `visual-presentation.tsx`, `house-story.ts` under the game component directory | House beats lose result context; hiding duplicate narration currently removes the House segment. Keep scenery independent of text/audio visibility. |
| Results | `format-presentation.tsx`, `format-resolution-stage.tsx`, `format-empower-vote-stage.tsx`, `endgame-presentation.ts`, `winner-scene.tsx` | Cover generic and specialized results, including endgame exits currently reduced to House text. |
| Playback and export | `packages/web/src/components/watch/`, `packages/web/src/lib/replay-export/`, `packages/web/src/remotion/house-replay/` | Share picture composition, speech identity, reveal boundaries, and timing. |

Component paths above are relative to `packages/web/src/app/games/[slug]/components/` where shortened. Follow [House narrative lessons](../solutions/architecture-patterns/bound-phase-cadence-narration-with-selective-fact-frontiers.md): creative prose is not game authority. Do not restore claim catalogs, model-authored evidence receipts, semantic graders, or prose-based result parsing.

## House announcement contract

### Authoring

Use this instruction as the editorial baseline:

> You are the House MC announcing the result the audience is seeing. Lead with the resolved outcome and the decisive facts supplied in the result focus. Then add one short, grounded sentence about what makes this outcome matter. Use your own voice and vary the phrasing naturally. Do not bury the result beneath a recap, invent motives or alliances, predict an unresolved outcome, or repeat a stock opening. Earlier dialogue and your notebook may inform the additional sentence only when directly relevant to this result.

Aim for one factual sentence plus one additional sentence; use a second factual sentence only when a rule or tiebreak needs it. This is an editorial instruction, not punctuation counting or runtime prose inspection. Preserve the current bounded ordinary/milestone lengths (180/360 UTF-16 units) and completion/reasoning allowance; identify the decisive facts rather than reading every ledger row aloud.

Illustrative outcome: “Four votes send Veyra out; Marlow and Marnie draw one apiece. This decision wasn’t close.” The extra sentence can simply explain the margin or rule when a strategic consequence is unsupported. Human review should judge variation across a sequence of announcements, not require every phrase to be globally unique.

At a material result boundary, request an announcement by default. Null remains a valid typed response; provider refusal, malformed output, explicit skip, or timeout leaves a readable result and no fabricated House speech. Preserve the existing one-attempt/deadline policy and failure telemetry. There is no new LLM call per tally row, animation, or visual sub-beat.

For Lobby/Mingle and other non-result boundaries, retain concise scene-relevant hosting or silence. Do not force an outcome when none exists. Keep introductions, contestant speech, diary interviews, retrospectives, and private long-form producer analysis outside the result-authoring rewrite.

### Focus supplied to the existing author

Compile a small typed result focus from the accepted event/projection at the existing actor boundary. Include result kind, round, stable event coordinate, relevant player IDs/names, decisive counts or aggregate fields, resolution method, and applicable scoring rule. Cover Empower/revotes/wheel resolution, selected format, format elimination, automatic exits, Council, Reckoning, Tribunal, and jury winner results.

Use the canonical resolved aggregate, not a recount of dialogue or guessed totals. Rule-specific focus must distinguish highest total, fewest positive, highest even, save/exit net, Two Names, and Safety Bounce. Forfeits, abstentions, automatic exits, and tiebreaks must not be described as ordinary majorities. Preserve the focal result even when older contextual event rows are bounded or the narrative delta was carried from an earlier failure.

The existing notebook and milestone context remain available to the House under their current private boundaries. The focal result takes editorial priority. No notebook, private provider evidence, or omniscient House summary enters contestant observations.

### Presentation association

The engine selects the result association, not the model. Carry a small metadata reference from the accepted summary to the exact result event and intended result stage. Preserve the transcript/speech ID used by recordings, subtitles, Studio selections, and production sources. Reuse an existing durable coordinate where it provides the exact association; if the public transcript omits that association, expose minimal metadata through its typed projection rather than relying on round/phase alone. Treat this as a typed API/publication change and prove propagation through persistence, watch responses, Studio snapshots, and export inputs. Freeze the new composition semantics through the existing production snapshot/version mechanism; do not reinterpret an old frozen snapshot under the new pairing rules.

For new output, the exact creative schema remains `publicSummary` and `privateNarrativeNotebook`; no model-authored timestamps, player selections, facts, or cue references are needed. Both fields retain their existing validation and publication semantics. House prose never controls a tally, participant choice, result, or reveal.

For existing speech, actively recover exact associations from existing durable evidence as described below; a missing new metadata field is not sufficient reason to leave a result unpaired. When no exact association is provable, keep speech at its existing sequence position over appropriate room scenery. Do not attach it to the nearest result by text, arbitrary proximity, or round/phase alone. No mass speech regeneration, mutation of accepted historical records, new compatibility framework, or history rewrite is required.

## Existing games and deployment cutover

Existing games are first-class acceptance targets, not a reduced-quality legacy lane. Apply the new scenery, relevant cast staging, readability, and speed-scaled result holds to ordinary playback of both completed and running games wherever existing authoritative data supports them. Preserve the frozen version-specific game reducer and rules; presentation improvements must never reinterpret how an old result was decided. Keep the existing classic presentation parser frozen: add no new prose patterns or format-game consumers.

### Completed games and already accepted speech

Before implementation is considered complete, inventory representative existing games across classic/format kernels, result families, narration availability, and older publication shapes. Inspect canonical events/projections, accepted summary boundaries, transcript anchors, and durable turn/publication coordinates to establish what exact associations can be recovered. Use deterministic fixtures from that inventory to prove improved playback, not just newly created game fixtures.

Resolve presentation context in this order:

1. Use an explicit accepted result association when present.
2. Otherwise derive a read-only association where an existing accepted summary boundary and durable publication/turn coordinates uniquely establish the resolved event and legal reveal stage. Require an unambiguous relationship; a canonical head merely limiting the visible prefix is not itself proof of the summary's subject. Keep only a small validated association and its provenance in the presentation read model. Do not expose private notebook/provider bodies or create an LLM classification pass.
3. If the relationship remains ambiguous or unavailable, preserve the original summary position with the applicable room and known cast. Keep the separate canonical result richly staged with its counts/method and affected player images. Lack of an association must never mean a black screen, a skipped summary, or an omitted result.

Use a single shared presentation path for these resolved inputs. Derived read models may be rebuilt from immutable sources; accepted events, transcript bytes, recording identities, hashes, and provider journals must not be edited to retrofit the new contract. A late-arriving derived association must not reorder an active playback prefix.

For an associated historical summary, retain the actual result behind the full original speech at its accepted sequence position. Do not assume that an older broad summary is already a concise MC announcement or move it earlier merely to imitate the new sequence. Preserve all words and use actual recording duration, or text-reading duration when unrecorded, plus a reading hold. A broad summary may remain broad; improved scenery and a persistent factual result make the sequence useful without inventing new narration. Do not remove, truncate, regenerate, or replace accepted speech to meet the new writing style.

Use saved historical player art and applicable scene versions where available. Otherwise provide bundled phase scenery and existing identity-preserving avatar fallbacks. Do not substitute the current House cast for a game's frozen roster or populate an early scene from final roster status. When old canonical data lacks a count or method, show the supported outcome without invented detail.

### Deployment requires all games drained

Stop admitting new games and let **all in-progress games finish on the old workers before deployment**. Verify there are no running, suspended, or recoverable unfinished games or provider calls before replacing workers. Do not resume an interrupted old-version game under the new MC prompt; recover and finish it on the old version first. This is an explicit deployment prerequisite approved by the user, not a rolling cutover.

The current provider journal does not retain a recoverable prepared request body before dispatch. Consequently, this change makes no cross-version in-flight recovery promise and does not add a provider-journal storage layer. Games started after deployment use `results-mc-v1`; accepted-value replay and same-version durable recovery retain existing behavior. Completed games receive presentation improvements without rewriting their accepted summaries, recordings, or canonical history.

### Studio and exports

Existing rendered videos, frozen production snapshots, and already prepared export jobs retain their exact inputs and composition version. Resuming or rerendering one must not silently apply new timing or scenery. To improve an older game's export, prepare a fresh snapshot using the updated composition and the same accepted historical speech/evidence, producing a separate output rather than overwriting the old artifact.

Newly prepared Studio previews/exports from existing games receive the same best-available result association, scenery, cast, and reading holds as ordinary replay. Preserve existing source IDs and editorial selections. Opening a frozen cut does not silently upgrade it; preparing a new cut makes the new composition explicit. Rendering improvements require a fresh export, not regenerated speech or a new game.

## Viewer coverage

| Screen or beat | Scenery | Cast and result treatment |
| --- | --- | --- |
| Empower tally, tie, revote, wheel/manual result | Applicable Empower scene or bundled Empower room | Empowered player or tied candidates; counts and method stay visible. |
| Format menu, selected format, rule reveal | Empower room retained across selection | Empowered player beside choices/rules. Do not infer the selected format before acceptance. |
| Format aggregate | Applicable result scene or Council room | Portraits in rows; focus on eligible/affected players; retain relevant rule explanation. |
| Tiebreak and deciding vote | Same Council scene | Tied players, chooser, then resolved outcome, each at its legal reveal. |
| Format/Council/endgame elimination | Same result scene | Eliminated player prominent; decisive counts/method retained. |
| Two Names and Safety Bounce | Existing specialized scene or Council room | Preserve cast, role anchors, chain, and outcome choreography; integrate announcement without replaying accepted actions. |
| House summary with associated result | Exact retained result scenery | Keep outcome and relevant players visible while the House speaks. |
| House summary without an associated result | Applicable current/past scene or phase room | Relevant known cast when useful; no unproven result tableau. |
| Phase ending, phase title, anonymous speech, waits | Outgoing applicable scenery until the next scene is ready; otherwise phase room | Never show a blank stage. Anonymous speech does not gain a guessed identity. |
| Winner and closing standings | Applicable finale scenery or Lobby | Winner emphasis with legible standings. Return to the closing result only after `retrospective.completed`. |

Apply scenery to the full stage, not just a constrained card. Keep room architecture visible at normal brightness around legible dark panels. Use full-body cutouts when they fit, portraits when they improve reading space, and existing persona/avatar fallback art when images fail. Preserve frozen identities and use the living/affected roster at the current replay coordinate.

Only select saved scene versions visible at the active replay coordinate. Do not use a future beat image even for decorative continuity. A room fallback must work with no generated scenes, missing URLs, image load failure, deep links, embedded playback, and fullscreen. Resolve a deterministic outgoing scene from the replay prefix so seeking matches continuous playback.

On narrow screens, prioritize outcome and decisive counts, then compact player art and narration. Keep text at readable sizes through reflow/pagination rather than shrinking long summaries to arbitrarily small fonts. Pagination must use the shared speech timeline and preserve all accepted words.

## Sequence and timing

The final sequence supersedes the prototype’s separate result-then-summary timing. The prototype remains a layout study, not the timing or voice contract.

1. Keep the prior room visible through a short entrance (target 0.5 seconds).
2. At the result cue’s speech start, display the resolved headline, affected players, and decisive facts together. Start the House announcement at that same presentation boundary. Do not wait until the announcement ends to show the outcome.
3. Keep that tableau visible through the complete announcement and a two-second reading hold, then hand off directly to the next beat. Do not repeat the same summary as a separate House card.

This is cue-level synchronization, not guessed word-level alignment. Never parse speech or use name matching to choose an animation timestamp. Earlier ballots, ties, deciding votes, and sealed reveals retain their legal order. One post-resolution announcement does not move ahead of intermediate beats that have not been revealed.

Base timing at 1× starts with six seconds for a simple result, eight seconds for a dense aggregate, and three seconds for a phase title. Measure the result hold from its reveal: `max(reading minimum, announcement duration + 2 seconds)`, plus the entrance. A tally and its summary do not each add independent minimum holds. Distinct unresolved tally and later resolved outcome may remain separate when they convey different facts.

Use actual recorded duration when available and the existing text-reading estimator otherwise. Keep all new timing in base presentation time so 0.5×/1×/1.5×/2×, pause, seek, audio transport, and export agree. Muting audio does not remove captions or scenery. A summary without a recording uses accepted text and text pacing; absent summary uses the silent result minimum. An advertised recording that fails follows the existing visible paused/retry behavior while retaining the result. Add an explicit continue-with-text action for that announcement; do not silently skip audio. If buffering has not recovered after ten seconds of wall time, expose the same retry/continue choice over the retained tableau. This recovery interval is operational time, not a speed-scaled result hold. Export preparation must resolve missing required audio explicitly before rendering rather than silently differing from its frozen inputs.

During live delivery, do not wait indefinitely for a future summary or duplicate an announcement when it arrives. Compose only accepted speech at its ordered source boundary; retain an already revealed result while its accepted summary becomes available. Late metadata must not reset a viewer’s cursor, restart a heard announcement, or resurrect an earlier result over later gameplay. Deep links and paused entry show a readable state without requiring the entrance to run. Waiting at the tail retains the tableau.

## Implementation sequence

### 1. Complete one shared result and announcement path

Start with Empower as an end-to-end slice: canonical focus, existing House author prompt, durable association, retained scenery and cast, recorded/text speech, shared timing, viewer/Studio/export composition. Keep existing source IDs and selection semantics intact. This establishes the working path before extending formats.

### 2. Cover every result family and hosting beat

Extend focus mapping and composition to generic format results, rule-specific aggregates, Two Names, Safety Bounce, classic Council, and endgame. Finish full-stage scenery for non-result House summaries, phase transitions, anonymous speech, and winner/standings. Keep existing specialized choreography; remove obsolete duplicate House result screens when replaced.

### 3. Complete resilience and responsive behavior

Handle late/absent audio, skipped/failed summaries, stale or missing media, pause/seek/deep links, live-tail buffering, mobile layouts, long text, and large casts. Complete the existing-game inventory and read-only association recovery, and verify the drained-deployment prerequisite and same-version accepted-call recovery. Verify the new association stays within owner/public visibility boundaries and never changes contestant recall.

### 4. Validate and document

Add targeted tests below, run required repository checks, and visually review complete sequences. Update `docs/reasoning-transcript-observability.md`, relevant usage examples in `docs/local-model-evaluation.md`/`DEVELOPMENT.md`/`README.md`, and the JSDoc in `packages/engine/src/simulate.ts` where the changed authoring/observability surface applies. Document result focus and presentation association in `CONCEPTS.md` and the relevant viewer/Studio solution documentation. Keep direct House calls and no `as any` disciplines visible.

No new service, provider route, feature flag, generic scene framework, extra commentary call, or art-generation dependency is planned. Any new durable metadata is small and indexed/relational as appropriate. Reuse existing object-storage writers/readers for prompt/evidence/document bodies; do not introduce inline body storage.

## Acceptance and validation

- Every listed viewer beat displays scenery, including when narrated text is hidden to avoid duplication. Black panels have visible surroundings.
- Announcements lead with the exact resolved outcome and decisive facts, followed by one concise grounded sentence with varied natural delivery. This is a human content-quality gate, not a prose parser or model-authored proof system.
- Deterministic fixtures prove correct focus data for ordinary Empower, revote/wheel, format selection, highest-total/fewest-positive/highest-even/net scoring, tie/deciding vote, automatic exit, Two Names, Safety Bounce, Council, Reckoning, Tribunal, and jury winner. Include unavailable totals and no-result boundaries without fabricated values.
- Malformed structured outputs, ambiguous wrapped JSON, `{}`, missing/extra fields, refusal, skip, and exhausted one-attempt failure preserve typed absence and notebook behavior. No synthetic fallback House speech; gameplay and the result remain available.
- Prose variation cannot change result identity, counts, timing association, reveal order, cast, or game state. A summary for one boundary cannot attach to another, including multiple decisions in one phase and carried context deltas.
- Durable restart neither duplicates the House call nor loses accepted text/association. Accepted speech and metadata commit before publication; frozen recordings retain their identity.
- Existing-game fixtures cover explicit associations, uniquely recoverable old associations, ambiguous/missing associations, broad historical summaries, absent recordings, absent/generated/broken art, missing counts, and older classic rules. Every case receives readable scenery and the best supported result/cast treatment; before/after assertions preserve event/transcript/recording hashes and source IDs.
- Deployment requires all in-progress games and calls to finish on old workers. New games use the MC policy; same-version accepted-call recovery introduces no duplicate provider slot or speech. No interrupted old-version request may cross this deployment.
- Frozen-cut and pending-export fixtures retain their old inputs and composition. A fresh snapshot/export of the same historical game uses the improved presentation, unchanged accepted speech, and a separate output. Existing Studio selections continue to resolve.
- Actor privacy tests prove House notebook, omniscient context, raw evidence, and public House commentary remain excluded from contestant prompts under existing rules.
- Shared presentation tests compare viewer, Studio, and Remotion/export picture, speech, source references, timing, and retained scene. Explicit Studio selection of a summary retains its context without implicitly selecting unrelated speech; removing a result or summary leaves a legal readable sequence. Frozen exports remain frozen and fresh exports use the new composition contract.
- Browser checks cover desktop, 390px and 320px widths, fullscreen/embedded, narration on/off/muted/error, long summaries, large rosters, no images, failed images, reduced motion, controls visible/hidden, pause, seek, live waiting and late data, and all supported speeds. Check no clipping, overlap, unreadably reduced text, silent black intervals, or future-scene leakage.
- Audio tests prove cue-level reveal alignment, speed-scaled post-speech holds, actual-duration pacing, and no double announcement. Final results return after retrospective completion only.
- Run `bun run test`, `bun run test:postgres` sequentially against local PostgreSQL, and `bun run check` before implementation is merge-ready. Use isolated browser harness databases and existing cleanup rules.
- Before claiming authored delivery is validated, review a small sequence of real outputs with recordings across result families for accuracy, relevance, natural phrasing, and repetition. Paid/provider gameplay is opt-in and must run over the localhost API with a separately agreed budget, durable game IDs, sanitized request/response evidence, reasoning when available, usage, retries, and failures. This planning turn does not authorize that spend.

## Prototype evidence and review disposition

The conversation prototype compares Result-led and Cast-led layouts over six illustrative sequences: Empower, generic format elimination, tiebreak, Lobby hosting, Two Names, and finale. It reuses existing room and portrait images. Local browser checks covered 108 combinations (two layouts × six sequences × three steps × three widths), plus 2× advancement and pause. It contains no recorded audio and does not validate production integration, factual authoring, or export behavior.

Planning review resolves these issues explicitly:

- Results-first writing belongs in this change, using the current summary/voice pipeline.
- The House must announce the displayed result, replacing the earlier separate post-result commentary timing.
- “Facts plus one” must not reintroduce templated speech, prose parsing, claim catalogs, or an extra generation call.
- Same-round/phase matching is insufficient; exact canonical association is required for new merged result announcements.
- Provider or audio absence must leave the result readable without fabricated speech or indefinite waiting.
- Private narrative context may inform relevant human-facing commentary but never widens contestant access.
- Old accepted speech and frozen exports are preserved; the new authoring policy does not retroactively rewrite them.
- Existing games receive all supportable presentation improvements, including read-only recovery of exact old result associations. All in-progress games must drain before deployment; only games started afterward use the new MC policy. Fresh exports improve older games without overwriting frozen cuts.
- Finalization of this plan is not completion of implementation, provider evaluation, or deployment.

Review status: source-backed local consistency and feasibility review completed; relative document links and whitespace checked. A read-only Grok review inspected sources but reached its eight-turn limit without findings. Its follow-up did not return a conclusion and was stopped. No external review approval is claimed. The implementation validation and real-voice evaluation above remain required at their respective stages.

## Implementation evidence

Read-only producer inventory on November 1 confirmed a completed 12-player format game (`keen-ochre-wolf`) with canonical Two Names, Safety Bounce, Highest Count, Even Votes, Short List, endgame, and jury outcomes. It also still listed unfinished games; this change has not been deployed, and that inventory is not a drain acknowledgement. Classic and older publication behavior are covered by the repository's durable classic, production-source, and frozen snapshot fixtures.

The implementation preserves accepted source identity and uses production snapshot version 6 for fresh cuts. Tests cover exact historical turn/boundary recovery, unresolved associations, new and historical composition, recording holds, text recovery, and old frozen cuts. Browser review caught and fixed unconstrained text pagination and vertically clipped player art. Deterministic browser fixtures exercise summary scenery and combined result announcements at desktop, 390px, and 320px. Real authored voice quality has not been evaluated with paid providers.

Final local validation:

- `bun run test`: 3,253 passed, 5 skipped, zero failures; subsequent focused closing-speech tests also passed.
- `bun run test:postgres` on the task's isolated database: 2,295 passed initially. Four failures used the earlier MCP version enum and one exposed an incomplete new committed-turn fixture. After corrections, both affected files passed in a fresh run: 28 passed, zero failures.
- `bun run check`, `bun run mcp:schemas:check`, and `git diff --check` passed.
- Four deterministic Chromium checks passed for summary scenery, fullscreen art, combined result announcements, and aggregate staging. A further result-layout rerun passed after visual inspection corrected clipped player art; desktop, 390px, and 320px screenshots were inspected.
- Additional focused tests cover frozen revote rules, six format result families, live metadata arrival, short recorded announcements, text recovery, ten-second buffering recovery, retained winner speech, and frozen/fresh Studio selection.

No deployment, historical speech regeneration, image-generation spend, or paid provider evaluation was performed. The drain prerequisite and real-voice quality review remain deployment/evaluation responsibilities, respectively.
