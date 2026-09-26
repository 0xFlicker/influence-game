# Optional Visual Mode

Portraits and timed speech bubbles are the standard presentation for every live game and replay. Visual Mode controls generated media, agent imagery and performance cues; it is selected at game creation and defaults off. A visual game always has a complete portrait-and-speech presentation. Generated images improve that presentation. Best effort is the default failure policy; Require visuals is an explicit championship setting. Cue content never causes suspension.

## Availability contract

`openai:gpt-6-luna` is an explicit image-capable choice for Visual Mode, including fallback slots. Provider inventory uses the shared model catalog; newly discovered unknown IDs remain text-only until their capabilities are registered. GPT-6 Luna uses Responses for image input, strict tools and reasoning, with the existing Adaptive/Low/Medium/High controls and prompt-cache options. GPT-6 Luna is the shared default for new selections; existing sealed game manifests remain unchanged. Model support and Standard/Flex pricing were checked against the [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna) on September 22, 2026; published rates include the input-only long-context threshold above 272K tokens. Provider-free tests verify transport, inventory and creation UI; they do not prove a deployment's account access or model quality.

At a committed conversational boundary, gameplay waits for pending visual preparation within a bounded timeout. A failed arrangement receives at most one best-effort repair. Under Best effort, once that allowance is exhausted, gameplay and timers proceed with portraits. Under Require visuals, unavailable required imagery stops advancement at the committed boundary for admin repair. A provider fallback consumes the repair allowance; it does not create another retry chain. Uncertain paid requests are recorded and never blindly repeated. Later changed arrangements get their own bounded preparation. Unchanged arrangements reuse their accepted scene or exhausted fallback decision, including after restart.

Each scene attempt is bounded to 180 seconds. Abort and owner/turn guards prevent late work from publishing after the boundary has changed. Successful paid outputs and receipts remain durable even when publication is no longer permitted. Generation runs outside game transactions; only short reservation and acceptance transactions hold locks.

The policy is explicit at creation (`visualFailurePolicy: best_effort | require_visuals`) and can be changed by an admin. Both policies retain the same evidence. Best effort never waits for operator recovery; future arrangements still generate. Require visuals needs full-body references, room backgrounds, verified composition and agent-facing annotations. An unanchored viewer image alone does not satisfy it. A policy change does not itself resume a paused game.

A visual pause preserves the committed execution cursor and transcripts, expires only the fenced current owner, and is stored as `suspended` with a `visualPause` reason in game configuration. Resume clears only that visual pause and returns the game to the existing durable worker adoption path. It does not reset the game, rewind accepted dialogue, or resume unrelated suspensions. The public watch retains its current presentation during visual repair, shows a concise paused status, and refreshes operational status to reconnect automatically after resume.

The observer publication connection stays active in both `in_progress` and `suspended`. Joining a paused game still hydrates accepted dialogue and its saved scene references; structured replay frames alone do not contain conversational speech. Publication materialization selects the stored safe context and emits only its public presentation fields (scene reference, accepted ballot, farewell purpose and anonymity), without exposing private decision IDs. Paused scrubbing displays a bubble immediately at the start of its beat; this does not advance the playback clock or revive expired speech.

Explicitly marked farewell dialogue remains in the presentation sequence during `FORMAT_RESOLVE`. The resolution-phase transcript filter suppresses result prose, but preserves these accepted farewell portrait beats; it never identifies farewells by their wording.

## Presentation and rooms

The common style uses simple contemporary architecture, warm light, recognizable furniture, minimal clutter and natural conversation. Eight versioned settings are supported:

| Setting | Direction |
| --- | --- |
| Lobby | Ivory plaster, oak, rust couch, cream chairs, kitchen bar, dark garden windows |
| Mingle 1 — Garden nook | Muted green upholstery, pale stone, garden windows |
| Mingle 2 — Kitchen corner | Terracotta, oak cabinets, pale counter, stools |
| Mingle 3 — Reading lounge | Muted blue upholstery, dark wood, sparse shelves |
| Mingle 4 — Music room | Ochre upholstery, warm wood, upright piano |
| Mingle 5 — Den | Muted plum upholstery, warm grey plaster, walnut, sconces |
| Tribunal | Charcoal walls, dark wood, restrained overhead light; not a courtroom |
| Finals | Pale stone, warm brass, symmetrical finalist/jury staging |

Finals scene membership is the two finalists plus the active jury, using the same `selectActiveJury` helper as agent context. The active jury consists of the last eligible eliminations in canonical order: three jurors for 5–6 players, five for 7–9, and seven for 10–12. Early eliminations outside that jury are not staged in Finals. This applies to openings, jury questions/answers and closing arguments. Stored scenes still require exact participant matching before agents receive their annotations; correcting the planner does not silently rewrite an already stored incorrect plan.

Existing Mingle room-count rules remain authoritative. Position inventories do not impose capacity limits. Scenes use canonical participants, explicit House alliance groups and furniture-relative staging; transcript prose never determines membership or game facts.

Introductions, accepted ballots, diaries and farewells use framed PFPs. Conversations use a matching verified scene when available, otherwise the same portrait treatment. Format results retain canonical choreography. Ballot wording comes from accepted structured facts at existing reveal points, without a model call or invented quotation. House text appears separately. Anonymous speech remains unidentified.

Bubbles use a reading duration of 200 words/minute plus one second, at least three seconds, with no upper cap. Room speech reserves 650 ms for camera settling before its 200 ms fade-in, retains the complete reading duration, then fades out over 200 ms and holds the unobstructed scene for 400 ms. Their clock follows playback pause, speed and seeking. A visual becoming available cannot switch the active speech beat away from its chosen presentation. The scene fits the available watch frame and measures the complete rendered bubble: prefer above the verified head when it fits, otherwise below when that fits. If neither fits, reserve headroom by moving the image down and reducing it proportionally. Speech has no internal scrollbar or truncation; exceptionally tall speech remains accessible through the outer scene scroll. Narrow frames and scenes without reliable anchors use a named speech panel below the image. Replay only reads saved artifacts and canonical speech bindings; it never generates media.

## House-hosted playback

The content frame plays accepted conversation, portrait beats, canonical format decisions/results and saved House narration. REST and live publications carry `dialogueKind` and `firstDurableEventSequence`; the viewer never recognizes banners, summaries or allocations by matching their text. Operational transcript rows remain available through transcript/producer access but consume no presentation time. Diaries retain their separate inspector archive.

`house-story.ts` builds chronological conversation scenes without allocation overviews or prose-based room reconstruction. `house_summary` entries remain in voting, menu, selection and resolution phases; at an equal event sequence their cue follows the canonical reveal stages. An outgoing phase's summary serves as its bridge. A closed phase without narration gets one two-second logo/title cue before the next phase's first content. Room movement inside Mingle adds no bridge.

`house-segment.tsx` presents the existing logo, gold accents and complete saved text. Reading duration uses the speech clock; entrance and exit take approximately 300 ms. Pause, speed, reduced motion and seeking use the same presentation director as dialogue. Stable dialogue-sequence keys survive REST/live identity changes. Reconnect preserves elapsed time; backfilled summaries cannot interrupt an on-air title. Seeking an operational-only event lands on the next presentable cue. No playback operation generates narration or media.

Finished House segments stay faded out while waiting for new live content, including with reduced motion. Pausing mid-fade freezes opacity; a paused seek to the start remains readable. Resuming or reconnecting at the live tail preserves the completed cue instead of replaying its animation; new content advances the director normally.

The old `phase-transition.tsx`, `endgame-entry.tsx`, random flavor copy and `buildReplayScenes` allocation/parser path were removed. Their last version is available at git commit `c7f7b48f` under `packages/web/src/app/games/[slug]/components/`. Phase/format context stays in watch chrome and playback controls, not an independent overlay. Provider execution and visual failure policy are unchanged.

## Profiles, identity and agent context

Profile editing and agent tools support full-body references and performance instructions. Selected profile values are frozen for the game. Missing full-body references receive bounded generation; if unavailable, the frozen PFP remains a usable identity reference. Missing room backgrounds do not prohibit later scene generation from the room specification and character references.

Identity/composition verification is separate from head localization. Composition must establish exactly one of each canonical participant, without extra, missing, duplicate or ambiguous identities. Invalid composition remains unpublished. Verified composition with unavailable or invalid geometry may publish a clean image with unanchored named speech panels. Overlapping head anchors are rejected. Only fully verified identity-to-anchor mappings produce agent-facing numbered imagery.

Before each agent call, the context reader checks the current canonical audience, frozen profile and committed boundary. A matching verified annotated image may accompany the turn; otherwise the agent receives canonical participants and applicable observable cues as text. Ballots and diaries receive no room imagery. Visual cues continue when imagery is unavailable, cannot execute actions or movement, and remain separate from private cognition. Diary cues are producer-only. Cue strings have surrounding whitespace trimmed and are otherwise preserved without text matching, filtering or interpretation; malformed game actions remain invalid.

## Durable implementation

- `visual_game_assets` freezes profiles, references and room assets.
- `visual_scenes` stores canonical arrangement plans, boundary/dialogue sequence, render revision, artifacts, localization and diagnostics.
- `visual_operation_events` is an idempotent, durable operational journal, written atomically with provider reservations and completions. It retains failures and presentation decisions even when a turn cannot commit. Pending records are copied as producer-visible `visual.operation_recorded` canonical events in the next committed turn, without changing rules or agent context. Paused-game diagnostics are available immediately from the journal; canonical promotion occurs on resume.
- `visual_render_operations` reserves immutable input hashes and request descriptions; `visual_render_attempts` retains provider dispatches, outputs, receipts, costs and reconciliation.
- `visual-best-effort.ts` owns the per-arrangement initial/repair policy and timeout. Repeated unchanged turns cannot reset the budget.
- `visual-turn-context.ts` supplies image or text context without generating media.
- Accepted transcript metadata records the chosen scene and structured ballot facts. Producer exports include frozen profiles, cues, plans, observed anchors and accounting.

OpenAI generates images; xAI is the availability fallback within the same bounded allowance. GPT-5.6 Sol verifies composition and localization. Pricing records known costs and explicitly retains unpriced/uncertain receipts. There is no spending cap. The admin visual-production page exposes diagnostics, saved images, exports and accounting reconciliation with policy, repair and resume controls. Provider error bodies and rejected verification responses are retained with typed failure evidence (response evidence bounded to 64 KiB, with truncation indicated). Credentials and request authorization headers are never stored.

## Operator workflow

Open `/admin/games/<id>/visual`. Inspect the timeline, scene revision, candidate image, exact rejected verifier response, provider request ID, duration, cost and uncertainty before authorizing repair. Provider P50/P95 timings are per request, not total boundary wait. The production export includes this evidence and the immutable request description. Private evidence endpoints require admin access and cannot publish an unverified image to viewers.

Click a scene thumbnail to view the complete image full-screen. Escape or Close returns to the same grid position; Open original opens the source image separately. Candidate and provider-attempt images open in the same viewer with distinct labels, without duplicating images inside scene cards.

For Require visuals games:

1. Diagnose the failure; fix provider configuration or availability as needed.
2. Reconcile uncertain paid requests using provider billing/request evidence. Unknown charges are never treated as zero.
3. Choose **Prepare game recovery** at the paused scene (or missing assets). This prepares agent-execution recovery and still requires Resume. The independent **Regenerate scene** / **Recheck image** controls dispatch media jobs immediately and never repair agent execution.
4. **Resume game** queues the unchanged cursor for worker adoption. A repair gets one explicit new scene revision; a failed repair pauses again under Require visuals.
5. To finish with portraits instead, select Best effort and resume. Future arrangements remain eligible for generation.

Manual actions are permission checked, audited and guarded against stale revisions. An old owner or obsolete arrangement cannot publish results. Late paid completions remain journal evidence even when publication is no longer allowed. Image fallback consumes a shared per-scene repair allowance; a transport failure with no response does not authorize a second paid request.

## Verification and operator review

Provider-free checks cover opaque cue preservation with strict gameplay validation, timed bubbles, anonymous presentation and replay selection. PostgreSQL checks cover scene identity acceptance, movement reuse, durable attempts, restart budgets, bounded failures, hanging providers, uncertain charges and late completions. Browser checks must cover portraits, generated scenes, pause/speed/seek, mobile overflow and room selection.

Use Doppler dev for explicitly authorized bounded live-provider tests. Local review servers must use the local development database, never an implicit remote Doppler database. The earlier live rehearsal exposed duplicate occupants and overlapping model-estimated anchors; those cases now have explicit rejection and fallback coverage. A synthetic primary rate limit followed by a real xAI edit succeeded. Current verification results belong in the operator handoff; historical green results do not prove later changes.

Research scripts are archived on `codex/visual-research` (`089a91db`). Generated samples and temporary rehearsal scripts are not feature-branch dependencies. Video rendering, new format-specific environments, camera-angle changes and agent-controlled visual movement remain outside scope.

Performance cues are `string | null`. Trim surrounding whitespace only. Preserve the cue content, including `"37"` and empty strings. Do not classify, text-match, infer meaning, or filter cue content. Null means no cue. The provider is prompted for free-form performance text; non-string optional metadata supplies no cue without rejecting otherwise valid gameplay. Strict gameplay validation remains separate; cues cannot execute game actions.

## Removed presentation paths

The replay theater no longer branches on Visual Mode to render scrolling chat feeds, stacked diary/whisper conversations, or typing/typewriter spotlights. Both live and recorded playback use the same portrait/scene presentation and reading-time clock; structured format results keep their dedicated choreography. Live playback reports its cursor to the current phase labels and bottom progress dock just as recorded playback does. The redundant top phase rail and Strategy Lens label are removed; the inspector remains directly available. Newly published first speech receives its full reading time; historical catch-up does not replay old introductions. The duplicate House intro and floating phase-ending overlays were removed; a single in-flow waiting status sits above playback controls. The transcript inspector remains available.

For historical reference, the removed theater branches are in `packages/web/src/app/games/[slug]/components/dramatic-replay-viewer.tsx` at commit `d2e11ad8548bba6c0329f6b52b1a8a64189cb9e4` (`git show <commit>:<path>`). They are not an alternate replay mode to restore.

Visual admission checks every provider slot, including fallbacks. The create-game form marks image-incompatible slots as Skipped and excludes them from the submitted manifest while keeping model selection and removal available. It promotes the first compatible slot to Primary without a fallback call cap. If every selected slot is incompatible, it visibly chooses an available image-capable primary, preferring GPT-6 Luna. Turning Visual Mode off restores the selected route and budgets. If no image-capable provider is configured, creation shows an actionable configuration error. The API still rejects incompatible submitted manifests. Portrait playback does not require vision-capable models.

## Character submissions

Profile generation and uploads edit a current-tab draft. Final submission atomically saves the selected content and creates durable moderation evidence; pending generation never attaches images after saving. See [Character drafts and moderation evidence](agent-content-submissions.md) for timeouts, cancellation, content revisions, review receipts and operator inspection. Pending moderation does not gate visual games.

### Incorrect Finals cast at a suspended boundary

The current-problem panel compares the saved Finals plan with canonical eligible jurors. It distinguishes a verified image from an image applicable to an agent turn, and lists missing/extra participants. Context rejection events retain the room, scene revision, agent, expected cast and scene cast; provider failure counts remain separate.

Choose **Rebuild scene from current game state** after reviewing that cast preview, then **Resume game**. Rebuild changes only the unused Finals scene at the current suspended boundary. It grants one render revision and saves the complete prior scene and replacement plan in the repair audit; it makes no provider calls itself. It rejects stale previews, uncertain paid attempts, earlier boundaries and scenes already used by accepted dialogue. The worker recomputes the same plan after restart and fences late completions from the old revision. Recheck/regenerate of an unchanged incorrect plan is not the appropriate repair.

The admin export includes `rebuildPreview`, `rebuildError` and `contextFailures`. The existing `repair_scene` control accepts `mode: "rebuild"` with the preview's `sceneId`, `expectedRevision` and `previewHash`; it does not accept a caller-authored cast or plan. This targeted rebuild is supported for Finals. Other scene repairs retain their existing verification/regeneration controls. Neither this control nor its diagnostics introduces new game pause conditions.


## Independent scene repair and reviewed publication

### Backfill a completed replay from Production

Open `/admin/production` as **Producer** or **Sysop** and use **Replay images** on a completed game's existing row. Its controls expand inside that row, including for games played with Visual Mode off. Producer-only accounts see the same list layout with completed games. Ordinary admin permissions do not grant access to this panel's API. Every read, render, evidence and reconciliation request checks current database role assignments; revoking a role invalidates an existing session's access.

1. Click **Replay images** on the game you want. Opening its controls does not generate images or create plans.
2. Review the missing scene's room, round and recorded participants. Click **Render missing image** on one scene. Another render for that game is blocked while a job is queued, rendering or verifying; the existing worker renders one job globally at a time.
3. Open **Versions and review**, inspect the clean candidate and numbered annotations, then **Publish for viewers**. Failed candidates stay private. Use **Continue failed repair** or **Recheck image** when appropriate.
4. If a response is lost, **Check render request** / **Check request** resends the same request ID. It does not authorize another paid job. Progress and provider receipts remain available after reload.
5. Review uncertain attempts under **Provider receipts** and record externally confirmed billing evidence before another paid request. Missing or unpriced receipts never count as free inference.

Missing plans are reconstructed from trusted canonical event prefixes at committed dialogue turns, stored room IDs and exact private audiences. Lobby casts follow the surviving roster; Finals include the active jury. Transcript prose never supplies participants, room assignments or outcomes. Missing canonical evidence leaves portraits and reports unsupported beats. Introductions, ballots, diaries and farewells keep portrait presentation.

Backfill copies existing game-start character references or saved portraits; it does not generate a batch of full-body references or room backgrounds. A missing background uses the renderer's room direction. Plans, jobs, verified versions, publications and provider receipts use existing tables: **no database migration is required**. The original game configuration, accepted events, turns, transcripts and agent context remain unchanged. Published images are exposed by the normal visual viewer endpoint even when the game was played with Visual Mode off, and are adopted at the next playback beat.

Production endpoints live under `/api/admin/production`: `GET /games` (completed game row summaries for Producer-only accounts), `GET /games/:id/visual`, `POST /games/:id/visual/missing` (`key`, `previewHash`, `requestId`), and `POST /games/:id/visual/media` (the existing media control contract). The server recomputes the preview before accepting a missing scene and never accepts a caller-authored cast or plan. Private artifact and attempt reconciliation endpoints use the same role gate. Tests: `visual-replay-production.test.ts`, `replay-visual-production.test.tsx`, and `replay-visual-production.e2e.test.ts`.

### Existing scene controls

Every existing scene has independent media controls in running, suspended and completed games. Game state and visual failure policy do not gate them. **Regenerate scene** queues one durable job using the saved cast, reference artifacts, background, placements and cues. The job also freezes room/style directions. It runs sections, optional harmonization, composition verification, head localization and identity matching. Rejected composition never causes automatic regeneration. Empty rooms verify zero occupants.

**Versions and review** compares the published clean image with a selected candidate. Numbered annotations, verified identities, anchors, errors and publication history are available here. **Recheck image** uses the selected original, verified version or failed candidate image and only invokes verification. **Continue failed repair** follows the selected failed job's immutable source chain, reusing successful exact-input steps. Successful sections survive a failed harmonizing step, further continuations and worker restarts. Original failed gameplay attempts can be continued through the same journal reuse path.

Each scene shows its own accepted/rejected receipt, job ID, candidate number, step, elapsed time and known/unpriced cost. Active status is polled; refresh failures retain the last content and review selection. A lost request response exposes **Check request**, which repeats the same idempotency key rather than dispatching a new operation. Rejected requests retain reason codes and do not consume candidate numbers. Request inputs and accepted candidate versions are immutable; job inputs are immutable while lease/progress fields remain mutable.

A repair's provider attempt without a receipt is **pending** while its current job has a live rendering/verifying lease. It does not show a reconciliation warning or form, and the API refuses to reconcile it while in progress. An expired/interrupted dispatch or a receipt with uncertain charges remains **needs reconciliation**. HTTP errors and failed identity verification are shown separately from accounting uncertainty; a successful HTTP response can still produce an unusable image. Future scene renders require visible front or three-quarter faces for every character. Identity failures name the participants from strict verification output, retain the candidate for review, and never trigger automatic regeneration.

**Publish for viewers** explicitly selects a verified version. **Restore for viewers** uses the same audited publication action for an earlier selection or the original image. Publication requires verified composition and identities. Uncertain geometry yields no anchors, and the viewer shows a named speech panel; it never guesses a head position. An uncertain paid attempt must be reconciled before a candidate becomes ready. No candidate becomes agent context or changes game policy, status, timers, decisions, transcript or results.

Public `/api/games/:id/visual` returns `publicationSnapshot` (a scene-to-publication-revision map), selected clean images, publication revisions and canonical dialogue bindings. Live and completed-game viewers poll the latest published selection automatically. Updates are adopted at the next beat; the entire active beat's media is pinned and the director clock is untouched. Refresh failures retain cached images and retry in the background, without adding maintenance controls or notices to the viewer. A new session starts with current publications. Previously published clean URLs remain accessible; unpublished candidates and numbered artifacts require admin authorization.

Historical portrait-fallback dialogue can acquire viewer media without rewriting transcript/agent-context artifacts. Bindings use stored committed turns, scene boundaries, dialogue sequences, canonical endgame stages and private-room audience membership. Missing or contradictory evidence leaves portraits. Individual introductions, ballots, diaries and farewells retain portrait presentation. Scene publication is not a mechanism for rewriting which characters were present.

Admin POST `/api/admin/games/:id/visual/media` accepts `requestId`, `sceneId`, `expectedVersion` and one action: `regenerate`, `verify` (`sourceVersionId`), `continue` (`sourceJobId`, omitted for the failed original), or `publish` (`versionId`, `expectedPublication`). Accepted queue receipts contain job/version IDs immediately; failed authorization is rejected before control execution. Expected-version conflicts and other authorized control rejections are durable receipts. One active repair per scene is enforced in PostgreSQL. Producer exports keep original `scenes` and separate `media.jobs`, `media.versions`, `media.publications` and `media.requests`; provider attempts remain linked to their durable operations.

Exports also include `selectedViewerMedia`, with the current publication snapshot and canonical dialogue bindings. Request-ID reuse with different inputs and malformed authorized controls are audited as diagnostic rejections; the original request receipt remains immutable.

Provider-free regression coverage lives in `visual-media-repair.test.ts`, `scene-repair-panel.test.tsx` and `visual-watch-model.test.ts`. The PostgreSQL fixtures exercise all game states, duplicate requests, historical room acceptance, repeated failed-harmonization continuation, lease loss, uncertain attempts, immutable records, publication conflicts, restoration and canonical fallback-dialogue binding. UI tests cover inline feedback, reconnect, comparison, explicit publication and preserving media on refresh failure.

Local browser review on 2026-09-22 verified the completed `odd-lime-vine` controls, original lobby clean/numbered comparison, and inline Finals harmonization uncertainty. No paid requests or publication changes were made to that game. Publication/restoration execution was verified with provider-free fixtures. The unresolved original Finals attempt requires actual provider evidence before another paid request.

See [game-worker operations](deployment/game-worker-operations.md#independent-visual-media-queue) for leases, shutdown and reconciliation. This feature adds no prompt editor, manual anchor editor, new rooms, video generation or automatic publication.

### Fullscreen player and responsive speech

`DramaticReplayViewer` owns fullscreen on the existing content-player element.
Browser fullscreen falls back to a top-layer viewport presentation; neither path
remounts the director. Escape restores the trigger focus and page scroll. Cast,
inspector, navigation and surrounding progress stay outside. Playback controls
float over a gradient, hide after three idle seconds while playing, and remain
available on pointer, touch, keyboard, focus or pause. Content clicks use the same
speech staging inside and outside fullscreen. While playing, the first click when
controls are hidden reveals controls; subsequent clicks advance the speech stage.
While paused, each click shows or hides speech. Fullscreen Mingle temporarily follows the active
speaker; leaving restores the normal pinned-room selection.

Cast and inspector badges follow the director's last revealed format snapshot in
the current round. Two Names shows Empowered, current Nominees and the Override
holder, allowing multiple roles on one player. Removing a nominee clears that
badge immediately; the replacement appears at its reveal. Safety Bounce shows
Safe and Vulnerable only after classification, with no safety inference for
unclassified players or other formats. Backward seeks rewind badges, including
reveals sharing one canonical event; new rounds and endgame clear old roles.

Cast status uses IN/OUT. Each published dialogue boundary refreshes missing
canonical frames, including endgame phases whose WebSocket notifications use
dedicated phase/elimination messages. Displayed status follows the active cue,
not the latest server head. Final 4 and Final 3 vote resolutions supply accepted
ballots for solo vote segments, followed by the canonical elimination; jury
ballots precede the winner. These segments never parse system transcript prose.

The winner reveal becomes a persistent final standings scene: the winner's frozen
full-body reference is contained without cropping, alongside saved headshots for
the remaining cast in placement order (runner-up at 2, followed by reverse
elimination order). Placements come from canonical `player.eliminated` events and
the winner frame's surviving finalist, never narration or image membership.
Missing placement evidence is labeled unavailable. Missing or failed full-body
art uses the winner's portrait. Closing narration and elapsed playback cannot
fade this final scene to black; seeking before the winner reveal hides it again.
The winner occupies 46% of the wide stage (half on narrow screens). Places 2–4
form a descending portrait group, while places 5 onward use separate compact
Jury and Rest of the cast groups. Jury participation comes from the accepted
voters in `jury.winner_determined`, not elimination order. Final-four jurors carry
a Jury caption and are not duplicated in the lower groups. Container-based
layout supports mobile, fullscreen and rotation, with scrolling for a large
cast. Deterministic browser checks cover the final vote, backward seeking,
closing narration and the stopped final frame.

Final 4 Reckoning pleas share the exact surviving cast's lobby image. Boundary
preparation reuses a matching arrangement or generates it before the step;
historical viewer binding selects only an image with exactly those participants.
Without a match, portraits remain available. Finals images intentionally include
both finalists and the active jury; appearing in that image does not mean IN.

Scene framing measures the loaded immutable image and actual frame. Wide frames
contain the whole scene; narrow frames cover and center on that version's clear
head anchor. Unknown, uncertain and anonymous speakers retain the whole image.
`visual-scene-layout.ts` owns pure framing, coordinate transforms, bounded bubble
placement and the 450 ms pan interpolation. Same-image automatic and click-driven
speech changes pan on director time while bubbles are absent; explicit seeks and resizing set framing directly.
Room and scene-image changes crossfade over 250 ms in independently framed layers,
without carrying the outgoing camera position into the incoming room. Reduced
motion switches immediately. No provider inference or transcript parsing supplies anchors.

Speech stays in named bubbles. `TimedSpeech` measures at the rendered font size,
prefers sentence boundaries then word boundaries, and preserves the entire text.
Pages divide the existing reading interval by word count, so pause/speed/seek and
rotation share the same reading position instead of starting separate timers.
Clicking to hide a paginated line preserves its visible page throughout fade-out;
skipping the remaining reading interval never flashes its final page.
Fullscreen portraits and House summaries use the same bounded pages. Scene
bubbles reserve room for controls and prefer above the head, then below; extreme
close-ups without room for readable speech use an unanchored panel. Published
media remains pinned to the active beat through `useVisualWatch`.

Provider-free fullscreen browser regression (portrait-only live fixture):
`bun run test:e2e:format-viewer --grep 'fullscreen portrait player'`.
Before updating the PR, run the complete `bun run test:e2e:format-viewer` suite:
the fullscreen subset does not cover reconnects, format pleas, individual sealed
votes, or persisted replay/results. Stories run with one worker and independent
pages; a failing story does not skip the remaining stories. Vote assertions use
canonical fixture speakers and targets in solo bubbles and check compact
totals at their existing reveal position. Long pleas must fit their measured
pages rather than an internal transcript scrollbar.
When the usual dev server already owns `.next/dev`, run this route-mocked test
with `PLAYWRIGHT_VIEWER_FIXTURE_WEB_URL=http://127.0.0.1:3001` to reuse that web
server. Other tests that require seeded backend data still use the isolated
harness. The fixture checks fallback fullscreen, unchanged speech, paged long
text, rotation, control visibility, Escape focus and scroll restoration.

### Safety Bounce on the lobby image

Safety Bounce reuses the saved lobby from the current round's preceding dialogue when its participant set exactly matches the canonical chain. An explicit dialogue scene binding selects that image version; later publications and future dialogue cannot substitute a different room while seeking backward. Games without an applicable lobby keep the existing classification picker. A failed image also returns to the picker without changing the presentation cursor.

The lobby stays fully in view, including on narrow screens. Saved, clear head rectangles anchor small badges below each face: a green check for Safe, an amber warning triangle for Vulnerable, and a neutral dotted circle for Unclassified. A white ring identifies the chooser. Numbered chain positions match the named strip below the scene. Uncertain or missing head rectangles remain represented in that strip and never receive invented coordinates or arrows.

Each accepted pointer adds a directed arrow, colored by the target's new classification: Safe chooses Vulnerable; Vulnerable chooses Safe. The latest link is emphasized and draws over 450 ms on the director clock; earlier links remain subdued. Paused seeks, reduced motion and live current-state hydration show settled links. Only the trusted pointer prefix is retained in presentation snapshots, so backward seeks remove later links and classifications. This is a visualization of accepted choices, not a simulation of candidate selection.

The completed chain remains on the lobby for the vote tally and tie announcement. Vote totals appear only at the canonical aggregate reveal; automatic sole-vulnerable elimination does not invent a vote total. Elimination uses the existing result presentation; the lobby never marks someone eliminated. Individual ballot and deciding-vote speech retains the existing portrait treatment. No new images, model calls, game rules or event types are introduced.

Browser coverage verifies desktop/mobile geometry against the loaded image, alternating Safe/Vulnerable arrows, backward seeking, tally/tie reveals, the transition to the existing elimination presentation, uncertain anchors and failed-image fallback. The existing viewer suite continues to cover games without lobby media.

### Solo character presentation

Introductions, accepted ballot reveals, diaries, farewells and isolated dialogue use saved full-body art with a speech bubble. The image fills the content frame vertically, with black side bars on wide frames. Narrow frames trim the image's sides while preserving its full height. Speech overlays the image below the head region, with its tail pointing upward. It never becomes a talking-head clip or a separate image/text column. A missing or failed full-body image uses the static portrait with speech below it. Both use measured, director-timed text pages, including outside fullscreen; fullscreen controls reserve bubble space without shrinking the image.

Existing upright single-character references, including `odd-lime-vine`, do not carry saved head rectangles. Their temporary presentation-only fallback reserves the top 22% of the source for the head. This is not localization evidence, must not be used for room scenes, and does not change historical assets or game state. New selections now use [confirmed character head positions](plans/2026-09-22-confirmed-character-head-positions.md). Historical games are not backfilled from current profiles.

Solo shots use the director's base clock: 350 ms image fade-in, 650 ms settling hold, 250 ms speech fade-in, the complete existing reading duration, 250 ms speech fade-out, a 400 ms unobstructed-image hold, then 350 ms image fade-out to black. The next shot starts from black. Bubble pages consume only the reading interval. Cue duration and speech staging come from committed dialogue/ballot metadata, so media loading and publication refreshes cannot restart or resize the active clock. A historical portrait beat later published as a room scene, or a room beat displayed with a fallback portrait, retains its original speech timing.

Room dialogue (including Lobby, Mingle and Finals), anonymous dialogue, and solo speech/ballots share a show/hide interaction. During playback, clicking before speech starts begins its fade-in; clicking readable speech begins its fade-out. Repeated clicks cannot skip a running fade or the clear interval. Pausing freezes automatic playback. A subsequent click runs only the requested fade on the director clock, then holds: show the current line, hide it while retaining the fully visible image, then transition and show the next line on the following click. The final hidden image remains available while paused, including while live dialogue buffers. Seeking cancels a pending click transition and lands on an unobstructed image; speech needs a reveal click when paused. Resume continues normal playback from the current position. Speed scales transitions, and reduced motion preserves clear intervals and reading time without intermediate opacity. No independent bubble timer or gameplay events are introduced. These clear image states prepare the viewer for a future scene-sharing control; this change adds no export or share action.

The visual endpoint supplies `fullBodies` for every game, including games without generated room scenes. It selects immutable prepared cast artifacts (excluding references marked as portrait fallbacks), then game-start profile references. Current agent edits never supply these images. The public artifact handler allows these cast images but still excludes private annotations, unpublished scene candidates and performance instructions. Initial media hydration fills an empty selection once; subsequent refreshes remain pinned until the next beat.

Sealed ballots remain at their canonical reveal position. Each voter says the target's name only; the caption identifies the ballot's purpose/polarity. Private thinking is never presented as an invented spoken justification. Existing roll-call order, forfeits and result authority are unchanged. Totals use compact unboxed layouts. House segments align their logo to the bottom of the upper half and summary to the top of the lower half, with timed pages for overflow. Fullscreen has a 48-pixel corner-icon control with a 32-pixel glyph and accessible entry/exit labels.

Confirmed head geometry is frozen at game start and bound to the selected full-body image. `fullBodyHeads` accompanies `fullBodies`; prepared cast artifacts override both together, dropping unmatched geometry. Solo framing centers an edge-positioned confirmed head within narrow crops. Speech sits below the head, or above a low head when that gives more reading room, with the tail transformed through the same image coordinates. Missing geometry retains the existing single-person fallback. This does not affect room-scene localization, publication timing or director duration.

## Deployment runtime verification

The API gateway and game-worker use the same API image. Sharp is external to the JavaScript bundle; the image includes its locked, platform-specific native dependency closure from the isolated Bun install. Default persona PNGs are packaged locally under `/app/assets/personas`, selected by `INFLUENCE_PERSONA_ASSET_DIR`. Local source execution uses the web public asset directory. No public HTTPS origin or extra storage secret is needed to read default portraits.

All three Dockerfiles include every workspace manifest when installing the frozen lockfile, including the private producer workspace manifest; this does not add its source code to the API/web bundle. The final API build runs `dist/check-visual-runtime.js` to decode all 13 defaults and resize them with Sharp. PR checks, ephemeral builds and staging builds also run `bash scripts/test-api-image.sh <image>` before publication. That check starts both API roles in validation mode against a disposable PostgreSQL container on an internal network, verifies health, and removes its containers/network. It uses fixture credentials only, makes no provider calls and does not activate job claims.

Ephemeral QA still needs the environment's existing database, authentication, object-storage and worker configuration, plus OpenAI credentials and `XAI_API_KEY` for the xAI availability fallback. The asset-directory setting is supplied by the image, not Doppler. Apply the branch's migrations and restart both API roles using the same candidate image. Container smoke checks are provider-free deployment evidence; they do not prove live generation or fallback credentials.

Fullscreen browser coverage separates native entry/exit from responsive rotation. Chromium forbids resizing a native fullscreen window through its automation protocol; rotation/layout cases use the viewport fullscreen fallback. Both paths retain the same player and paused speech.

### Empower ties and deciding votes

An accepted `vote.empower_tally_resolved` with `tie_pending` reveals the original named votes, then one compact tie beat with the original totals and tied nominees. It never names the placeholder as Empowered. The accepted `vote.empowered_set` reveals only the non-nominees' revotes, followed by the final revote totals and winner. A remaining tie labels the accepted wheel decision; a manual resolution labels its original totals explicitly. Original ballots are not replayed before the final result. Tally beats show compact totals rather than repeating the named receipt list beneath the solo vote sequence.

A format elimination tiebreak has two beats before elimination: a compact explanation naming the tied nominees and empowered decision-maker, then the decision-maker's saved full-body shot with a speech bubble saying the eliminated player's name. The caption reads “Deciding vote · Vote to eliminate”. Missing full-body art retains the static portrait treatment. The chosen target comes from the validated canonical resolution, never from thinking or transcript prose. Solo timing, click-to-reveal, pause, speed and seeking use the existing director.

Both tie and final beats have stable keys at their committed event sequences. A pending tie stays in the same position when a live revote result arrives or a connection reloads; no new transition or repeated original vote is inserted. Provider-free browser fixtures cover the original-vote/tie/revote/result sequence and the full-body deciding-vote/elimination sequence.

Jury winner ballots are presented only from `jury.winner_determined`, in roster order before the winner and saved House summary. Transcript entries carrying `acceptedBallot.purpose = winner` stay in the transcript archive but do not produce additional story beats. This rule also applies before winner-event hydration, so live append/reconnect cannot replay votes first as transcript speech and then as canonical ballots. Ordinary jury dialogue is unaffected; the viewer never deduplicates by matching prose.
