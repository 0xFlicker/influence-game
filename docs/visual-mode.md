# Optional Visual Mode

Portraits and timed speech bubbles are the standard presentation for every live game and replay. Visual Mode controls generated media, agent imagery and performance cues; it is selected at game creation and defaults off. A visual game always has a complete portrait-and-speech presentation. Generated images improve that presentation. Best effort is the default failure policy; Require visuals is an explicit championship setting. Cue content never causes suspension.

## Availability contract

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

Bubbles use a reading duration of 200 words/minute plus one second, at least three seconds, with 200 ms fades and no upper cap. Their clock follows playback pause, speed and seeking. A visual becoming available cannot switch the active speech beat away from its chosen presentation. The scene fits the available watch frame and measures the complete rendered bubble: prefer above the verified head when it fits, otherwise below when that fits. If neither fits, reserve headroom by moving the image down and reducing it proportionally. Speech has no internal scrollbar or truncation; exceptionally tall speech remains accessible through the outer scene scroll. Narrow frames and scenes without reliable anchors use a named speech panel below the image. Replay only reads saved artifacts and canonical speech bindings; it never generates media.

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

For Require visuals games:

1. Diagnose the failure; fix provider configuration or availability as needed.
2. Reconcile uncertain paid requests using provider billing/request evidence. Unknown charges are never treated as zero.
3. Choose **Recheck existing image** to pay only for verification, or **Regenerate scene** for a new image revision. **Prepare asset repair** retries missing references/backgrounds while keeping successful assets. These actions only prepare work; they do not dispatch paid calls until resume.
4. **Resume game** queues the unchanged cursor for worker adoption. A repair gets one explicit new scene revision; a failed repair pauses again under Require visuals.
5. To finish with portraits instead, select Best effort and resume. Future arrangements remain eligible for generation.

Manual actions are permission checked, audited and guarded against stale revisions. An old owner or obsolete arrangement cannot publish results. Late paid completions remain journal evidence even when publication is no longer allowed. Image fallback consumes a shared per-scene repair allowance; a transport failure with no response does not authorize a second paid request.

## Verification and operator review

Provider-free checks cover opaque cue preservation with strict gameplay validation, timed bubbles, anonymous presentation and replay selection. PostgreSQL checks cover scene identity acceptance, movement reuse, durable attempts, restart budgets, bounded failures, hanging providers, uncertain charges and late completions. Browser checks must cover portraits, generated scenes, pause/speed/seek, mobile overflow and room selection.

Use Doppler dev for explicitly authorized bounded live-provider tests. Local review servers must use the local development database, never an implicit remote Doppler database. The earlier live rehearsal exposed duplicate occupants and overlapping model-estimated anchors; those cases now have explicit rejection and fallback coverage. A synthetic primary rate limit followed by a real xAI edit succeeded. Current verification results belong in the operator handoff; historical green results do not prove later changes.

Research scripts are archived on `codex/visual-research` (`089a91db`). Generated samples and temporary rehearsal scripts are not feature-branch dependencies. Video rendering, new format-specific environments, camera-angle changes and agent-controlled visual movement remain outside scope.

Performance cues are `string | null`. Trim surrounding whitespace only. Preserve the cue content, including `"37"` and empty strings. Do not classify, text-match, infer meaning, or filter cue content. Null means no cue. The provider is prompted for free-form performance text; non-string optional metadata supplies no cue without rejecting otherwise valid gameplay. Strict gameplay validation remains separate; cues cannot execute game actions.

## Removed presentation paths

The replay theater no longer branches on Visual Mode to render scrolling chat feeds, stacked diary/whisper conversations, or typing/typewriter spotlights. Both live and recorded playback use the same portrait/scene presentation and reading-time clock; structured format results keep their dedicated choreography. Live playback reports its cursor to the surrounding phase navigation just as recorded playback does. Newly published first speech receives its full reading time; historical catch-up does not replay old introductions. The duplicate House intro and floating phase-ending overlays were removed; a single in-flow waiting status sits above playback controls. The transcript inspector remains available.

For historical reference, the removed theater branches are in `packages/web/src/app/games/[slug]/components/dramatic-replay-viewer.tsx` at commit `d2e11ad8548bba6c0329f6b52b1a8a64189cb9e4` (`git show <commit>:<path>`). They are not an alternate replay mode to restore.

Visual admission checks every provider slot, including fallbacks. Katana GLM 5.2 is configured as text-only; the creation UI names incompatible slots before submission. Portrait playback does not require vision-capable models.

## Character submissions

Profile generation and uploads edit a current-tab draft. Final submission atomically saves the selected content and creates durable moderation evidence; pending generation never attaches images after saving. See [Character drafts and moderation evidence](agent-content-submissions.md) for timeouts, cancellation, content revisions, review receipts and operator inspection. Pending moderation does not gate visual games.

### Incorrect Finals cast at a suspended boundary

The current-problem panel compares the saved Finals plan with canonical eligible jurors. It distinguishes a verified image from an image applicable to an agent turn, and lists missing/extra participants. Context rejection events retain the room, scene revision, agent, expected cast and scene cast; provider failure counts remain separate.

Choose **Rebuild scene from current game state** after reviewing that cast preview, then **Resume game**. Rebuild changes only the unused Finals scene at the current suspended boundary. It grants one render revision and saves the complete prior scene and replacement plan in the repair audit; it makes no provider calls itself. It rejects stale previews, uncertain paid attempts, earlier boundaries and scenes already used by accepted dialogue. The worker recomputes the same plan after restart and fences late completions from the old revision. Recheck/regenerate of an unchanged incorrect plan is not the appropriate repair.

The admin export includes `rebuildPreview`, `rebuildError` and `contextFailures`. The existing `repair_scene` control accepts `mode: "rebuild"` with the preview's `sceneId`, `expectedRevision` and `previewHash`; it does not accept a caller-authored cast or plan. This targeted rebuild is supported for Finals. Other scene repairs retain their existing verification/regeneration controls. Neither this control nor its diagnostics introduces new game pause conditions.
