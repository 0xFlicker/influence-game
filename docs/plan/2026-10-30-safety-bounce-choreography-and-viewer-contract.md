---
title: Safety Bounce choreography, post-classification Mingle, and strict viewer coverage
date: 2026-10-30
status: implemented
---

# Safety Bounce choreography and viewer contract

## Outcome and scope

Make Safety Bounce a continuous, visually engaging chain: a full-body chooser speaks, selects someone from the crowd, takes their place in a Safe or Vulnerable headshot pool, and hands the stage to the selected player. Keep both pools legible throughout. Attach each accepted speech and any permitted thinking to its own decision rather than replaying them after resolution.

For newly created games, the round becomes **format selection → Safety Bounce classification → Mingle (and its existing huddles) → sealed vote/reveal → empowered tiebreak speech and choice if needed → elimination/farewell**. Historical games retain their frozen execution order; their accepted speeches should still receive correct presentation placement. Other formats keep their existing social windows.

The plan was approved and committed as `9f00ca5e`; implementation is in progress. The findings below describe the pre-change research baseline. Repository source and read-only staging records for `hard-violet-reef` were inspected. Browser playback has not been reproduced. Findings below distinguish saved evidence from playback proof.

### Accepted follow-up requirements

- New-game empowered format tiebreaks require private thinking plus public speech, including the shared format tiebreak and Two Names tiebreak. Show thinking only when enabled, then speech, then target reveal. Sealed ballots remain speech-only.
- Sealed voting is a private conversation with the House: agents may briefly explain why they are voting that way. Remove the instruction prohibiting explanation/private reasoning and the name-only framing. Ask for a short, natural vote explanation to the House, without requiring a separate thinking field or mechanically rejecting a terse answer. This applies to empower and Safety Bounce ballots and the shared Influence sealed-ballot policy.
- Safety Bounce and empowered pre-pick speeches belong in the durable public speaking record, not merely viewer metadata. Other agents can encounter them through authorized dialogue and choose to retain them through existing memory/strategy mechanisms. Do not force a memory entry or treat a spoken claim as a canonical fact. This includes empowered format-selection announcements as well as tiebreak announcements; adding thinking here applies to tiebreaks.
- Supply both complete pools and seat-specific strategic guidance **before the first Mingle decision** and throughout that window.
- Strict event/viewer completeness begins at a new frozen root game schema revision. Do not make auditing every historical oddity a prerequisite for shipping the new contract.
- **Do not break viewability of old games.** All previously viewable games must remain viewable. Old Safety Bounce games can use the new scene without thinking/speech stages when those records are absent. Historical data must never be rejected for failing a newly introduced requirement.
- Public decision speeches are required in recent context under the existing recency policy, then remain available in the authorized recall candidate set. Do not introduce an always-included full-chain archive or bypass context refinement.
- Image overlap is allowed. Do not add overlap detection, non-overlap assertions, collision avoidance, or special layout work for the rare ordinary non-transparent full-body case; render it like transparent full-body art.

## Findings from current source

Paths below are repository-relative.

| Area | Evidence | Implication |
| --- | --- | --- |
| Rules | `packages/engine/src/formats/safety-bounce.ts`: `createBounceBoard`, `applyBouncePointer` | Starter is already Safe. A Safe actor makes the target Vulnerable; a Vulnerable actor makes the target Safe. Selection classifies the target immediately. The animation must not suggest the outgoing actor acquires a new classification. |
| Execution | `packages/engine/src/phases/format-kernel.ts`: `resolveSafetyBounceRound` | Chooses starter, loops pointers, then collects votes and resolves. It prepares a fresh context for each actor and emits the preceding public decision speech before the next iteration. |
| Durability | `packages/engine/src/game-runner.ts`: generic `format-resolve` durable turn; `packages/engine/src/durable-game-turn.ts` | Safety Bounce lacks the staged cursor used by Two Names; the whole resolver currently sits inside one logical turn. A visual reorder alone cannot implement the requested intervening Mingle. |
| Phase order | `packages/engine/src/phase-machine.ts`: `format_pick → format_mingle → format_resolve` | New ordering needs explicit versioned lifecycle routing, not a transcript sort adjustment. |
| Speech contracts | `packages/engine/src/influence-decision-speech.ts` | Currently Bounce requests thinking plus speech, tiebreaks speech only, and ballots very short speech without thinking. Change new-game tiebreak contracts to thinking plus speech; preserve historical accepted outputs. Ensure ballot speech is actually visible at reveal. |
| Speech persistence | `packages/engine/src/transcript-logger.ts`: `emitAgentTurn`, `logDecisionSpeech` | Public decision speech is already recorded with typed action/actor and optional decision ID. Sealed ballot speech stays out of contestant dialogue during collection. |
| Composition | `packages/web/src/app/games/[slug]/components/influence-presentation.ts`: `withBallotSpeech` | Source implements ballot attachment, not Bounce pointers or empowered format tiebreaks. This is not proof that deployed browser playback displays saved ballot text correctly. |
| Ordering | `.../influence-replay-cues.ts`: `buildClassicPresentationCues`, `mergeFormatAndSocialCues`, `comparePresentationCues` | Non-ballot decision speeches enter the social transcript stream, ordered by durable sequence or timestamp-derived frame association. They are not bound to the owning decision beat. This is a concrete integration gap consistent with the report; reproduce exact late placement with persisted DTOs before calling the diagnosis complete. |
| Existing visuals | `.../safety-bounce-stage.tsx`, `.../safety-bounce-scene.tsx`, `.../safety-bounce-scene-model.ts` | A text classification board and saved group-lobby-image overlay already exist. Neither provides the requested independent full-body crowd/chooser/pool rotation. The old scene path requires a prior lobby dialogue/image binding. |
| Resolution cues | `.../format-presentation-compiler-helpers.ts`: `applyResolution` | One resolution produces roll calls, aggregate, tiebreak, deciding vote, elimination. Speech must attach inside these stages, before target reveal, not merely to the resolution sequence. |
| Coverage holes | `.../format-presentation-model.ts` has a default no-op; `.../format-presentation.tsx` ends with `return null` | Audit the ownership of every event/cue before replacing these with exhaustive handling. Some events legitimately belong to other compilers; silent default handling is not a contract. |

Relevant existing learning: `docs/solutions/design-patterns/influence-decision-speech-and-sealed-reveals.md`, `canonical-safety-bounce-lobby-overlays.md`, and `docs/solutions/runtime-errors/api-startup-recovery-resumes-interrupted-games.md`. Reuse the catalog's existing `public_chain` capability rather than inventing a second format identity. Follow `.agents/skills/add-custom-format/` for canonical, durability, and verification requirements; deployment is the activation gate, with no new feature flag.

### Staging evidence: hard-violet-reef

Read-only staging MCP inspection identified game `d6b97826-fa0b-4872-82a7-c61d8ac381d3`, inspected through event 123 / transcript entry 218. Round-one `FORMAT_RESOLVE` dialogue contains five public Bounce speeches at entries 77, 79, 81, 83, and 85; six saved system-scoped ballot utterances at entries 87–92; and Rune's public tiebreak speech at entry 94. The ballot utterances are Vex → “Finn”, Rune → “Finn”, Sage → “Vex.”, Wren → “Vex.”, Rex → “Sage”, Finn → “Sage”. These are accepted dialogue records with decision IDs, not inferred from the prose tally. No private thinking was requested for this inspection.

Round-one empower voting also has six saved name-only utterances at entries 29, 31, 33, 35, 37, and 39. The first six Studio ballot moments expose matching name-only text. Consequently, saved ballot speech exists in this game, but name-only speech can visually resemble a target-label substitution. Browser inspection must distinguish exact accepted-text rendering from fallback target rendering, including punctuation, timing, and audio. Do not claim deployment playback is proven from these reads. Use this game as the concrete regression source, with a non-name-only synthetic utterance to ensure tests cannot pass by displaying a target name instead.

Subsequent raw-provider verification checked all twelve round-one empower/Safety Bounce ballot responses: each explicitly returned the saved name-only `message`; these messages were not synthesized from vote targets. Their schema instruction said the chosen name alone was enough and prohibited explanation/private reasoning. That instruction is now a confirmed prompt defect to change. None of the twelve responses had an explicit `thinking` field; all recorded native reasoning-token usage and encrypted reasoning, with readable native summaries on Rune's two ballots. The five chain-pointer responses had both explicit thinking and full-sentence speech. Rune's tiebreak had full-sentence speech but no explicit thinking. Native provider reasoning remains separately retained evidence, not the spoken ballot explanation.

### Context refinement: existing behavior to preserve

`context-builder.ts` supplies the normal contestant phase context with public messages. `agent.ts:buildVisibleTranscriptSection` includes non-endgame public messages from the current round and previous two rounds directly in Recent Public Messages; these do not compete for ranked historical recall. Endgame uses a different active-conversation boundary: current phase and current round. `buildUserPrompt` also includes current room conversation and recent authorized huddle dialogue.

`context-recall-plan.ts` separately authorizes historical candidates, ranks them deterministically using current board/alliance/receipt relevance, priority speakers and recency, and selects history within the prompt-class allowance. Ordinary speech has no additional ranked archive lane; strategic decisions do. Board facts, compact retained strategy, and authorized official huddle outcomes are protected separately. This selector makes no additional LLM call. An agent can update its retained strategy through existing accepted strategy changes; it need not memorize every utterance.

Therefore the requirement is: commit public Bounce/empowered speeches into the existing speaking record and public-message projection; include them mandatorily while they qualify as recent; keep them eligible for authorized historical recall afterward. Verify the actual next-picker and Mingle requests, including restart restoration, rather than adding a parallel chain-context subsystem. Context-limit adaptation remains a separate continuity mechanism and must preserve required meaning, never silently drop recent speech because archive ranking omitted it.

## Product and visual contract

1. Establish the room using the existing background-image infrastructure. Show all living participants; place the starter separately as the active full-body chooser. Show Safe and Vulnerable pool headings/counts from the canonical board, including the active chooser's classification, without drawing that person twice.
2. Render each standing participant with transparent full-body art first, ordinary full-body art in the same placement second, then a headshot. Missing/loading/failed art must not change the gameplay scene or hide the participant. Use established asset resolution and head geometry; do not introduce a new asset storage path.
3. For each accepted pointer: optional saved thinking when Show thinking is enabled → public speech → structured target reveal → handoff. Keep the crowd and pools visible during speech. Speech may itself name the target; do not parse, redact, or rewrite it. Visual highlighting waits for the reveal stage.
4. Move the chosen player from the unclassified crowd into the chooser position. Move the outgoing chooser into the pool matching their existing classification, transitioning from full-body to headshot using the voting animation's geometry/timing primitives. Distinguish pools with text/icons as well as color.
5. Pool membership is canonical immediately; display placement is presentation state. Track each participant's logical role as crowd, chooser, or pool, while allowing overlapping artwork and transient layers during transitions. Do not test image overlap or introduce collision avoidance. Do not derive board membership from completed CSS transitions, and do not reveal future classifications through pool badges/counts before their reveal stage.
6. The last selected player has nobody left to choose. Complete their classification and move them into their pool without inventing a speech, decision, or extra turn. Show the final pools before Mingle.
7. Before Mingle begins, every agent receives the complete finalized pools and their own status-specific guidance. After Mingle, preserve that board through voting. Display each saved sealed-ballot utterance once at its reveal, without thinking and without exposing it during collection. Show the empowered tiebreak's saved thinking when enabled, then speech, then the existing deciding-vote target reveal and elimination/farewell. No repeated speech after the vote. Apply tiebreak attachment to the shared format path, including Two Names where it uses its distinct action.
8. Use one semantic cue stream for live viewing, reconnect, replay, Studio, and export. Pause, seek, speed, audio, and Show thinking use the existing director clock. Reduced motion preserves order and readable dwell while replacing flights with simple transitions. Narrow layouts keep names, chooser, speech, and both pool counts visible.

Use the new dedicated scene for Safety Bounce, including historical games whose accepted chain events already supply the board. Historical games without thinking/messages skip those stages and still play the chain and results. Historical games with saved, reliably associated speech retain it. Reuse background and cast components. Remove a superseded renderer only after its previously supported inputs are covered by the replacement; keep the existing historical read/render route wherever necessary to preserve viewability. This changes presentation, not historical rules or stored game data.

## Implementation sequence

### 1. Capture a regression before changing behavior

- Extend the existing `safety_bounce_tie` fixture in `packages/engine/src/fixtures/format-kernel-viewer.ts` with real serialized transcript metadata and distinct speech sentinels for every pointer and the empowered tiebreak. Include one actor appearing in both roles.
- Exercise the full composition path, not only `SafetyBounceStage` or the format compiler. Assert each speech is adjacent to its owning decision, before that decision's reveal, and appears once. Assert no pointer/tiebreak speech remains in the post-vote social tail.
- Reproduce with the durable sequence associations produced by the API; do not hand-assign ideal cue sequences that mask the bug. Retain a sanitized fixture from staging `hard-violet-reef` without copying private provider evidence into public fixtures. Add a ballot whose accepted message is more than the target name; verify exact text, punctuation, readable duration, and audio delivery in the browser.

### 2. Freeze the new lifecycle at game creation

- Establish a frozen root Influence game schema revision (proposed field `gameSchemaVersion`; inventory existing root authority before choosing the next unused revision). It selects the complete new contract: classify-before-Mingle, tiebreak thinking plus speech, exact durable speech identity, and exhaustive supported-event/viewer coverage. Reuse an existing root version if it already owns these semantics; do not confuse watch projection schema versions with the game's frozen schema.
- Wire the root revision through engine config, canonical creation authority, all new-game creation paths (including free queue and waiting games), stored config, lifecycle restoration, watch DTOs, Studio/export, and fixtures. New waiting games freeze the new revision when created; already-created games retain their original contract. Missing/pre-boundary revision selects the existing historical path. Unknown future revisions fail explicitly. Never infer from timestamps or event contents.
- Advance the existing `decisionContractVersion` for the newly required tiebreak thinking field and bind that contract to the new root revision. Validate legal version combinations at creation/restoration; avoid independently selectable contradictory switches. Preserve old provider contracts for existing games and accepted receipts. The root revision supersedes the earlier proposal for an independent `safetyBounceVersion` switch.
- In that new decision contract, revise the shared sealed-ballot message instruction to: “You are speaking privately to the House. State your vote and briefly explain why, in one sentence or less.” Permit candid strategic explanation; do not require public-facing justification or prohibit revealing strategy to the House. Use the existing 320 UTF-8-byte short-speech allowance instead of the 120-byte name-oriented allowance, updating drafting guidance and exact schema validation together. No additional model call or separate thinking field is needed. Preserve original accepted historical utterances without regeneration.
- Update phase-machine routing and both durable/non-durable orchestration around one shared implementation of the rules. Use explicit classification and post-classification Mingle boundaries so progress indicators, diary hooks, House beats, and replay do not assume phase enum order is chronology.

### 3. Make the chain durable and context-correct

- Add typed Safety Bounce cursor stages: starter draw, next pointer, post-classification Mingle, ballots, optional tiebreak, resolution. Derive board state from the canonical prefix rather than serializing a second authoritative board.
- Commit the starter draw once using durable randomness. Commit each pointer's canonical event, accepted speech, continuity, provider receipt, and next cursor atomically before preparing the following actor's context. Preserve ordered provider slots, including an actor who later breaks a tie.
- Finish classification before beginning the single existing Mingle/huddle window. Carry the finalized board into contestant context, House context, voting legality, and read models. Do not accidentally schedule both the old and new Mingle windows.
- Before preparing the first Mingle provider request, construct a canonical status block containing both named pools, the receiving player's classification, legal voters/targets, and the elimination-vote direction. Vulnerable guidance: “You are vulnerable and can exit this round. Use Mingle to build support, discourage elimination votes against you, and coordinate alternatives.” Safe guidance: “You are safe from elimination this round. The vulnerable players are [canonical list]; use Mingle to decide whom to vote against and negotiate support or commitments.” Adapt wording for the sole-vulnerable automatic-resolution rule rather than promising nonexistent voting agency. Keep this block available to every Mingle speech/movement/huddle decision and clear it at round completion. Do not wait until the vote to inject it.
- Make every accepted public Bounce/empowered speech eligible for authorized recall and required while recent under the existing public-conversation policy. For a current-round chain, all preceding pointer speeches qualify as recent and must reach the next picker. After aging out, they may be selected by historical recall or retained through the agent's own strategy updates; do not permanently pin them. Verify actual prepared provider requests and restart restoration, not only transcript presence. Preserve context adaptation and private-thinking boundaries; never impose a size-only game failure.
- Persist Bounce, empowered format-choice, and empowered tiebreak speech with exact actor/action/decision coordinates in the durable public speaking record in the owning atomic commit. Keep it available to subsequent authorized dialogue reads and agent memory/strategy updates after restart. The public words remain durable even if an agent chooses not to remember them. Tiebreak thinking is private cognition; never append it to other contestants' speaking record. Test recall availability independently of spectator rendering.
- Persist sealed-ballot explanations with their exact ballot identity and House-facing audience. Spectators see/hear them at the ballot reveal. They must not leak to other contestants during collection or become public contestant dialogue afterward merely because spectator playback reveals them. Keep author/House access within existing authorized context rules; ballot outcome disclosure does not itself authorize sharing the private explanation with opponents.
- Keep sealed voting sealed and existing voter/target rules unchanged. Preserve the sole-vulnerable edge case: under the new root revision, classify, run the post-classification social window, then resolve automatically without a fabricated ballot; confirm availability boundaries in pure tests. Historical games retain their existing order.
- Extend canonical prefix validation to reject voting/Mingle at the wrong lifecycle boundary, duplicate pointers, invalid actor/target/classification, and mismatched terminal pools. Preserve all valid partial prefixes and historical event meaning.

### 4. Bind speech to decisions explicitly

- Join accepted speech to canonical decision identity/source pointers and action/actor/round. Carry an exact small reference (decision ID, transcript entry sequence, or an explicit ordered action slot) through sanitized DTOs where the current surface loses it. Never use timestamps or the next speech by the same actor as identity.
- For older stored speeches, use only their existing structured coordinates/source pointers and uniquely provable associations. Keep existing legacy presentation for ambiguous historical records, with diagnostics rather than new strict rejection; never guess or parse prose. Historical contracts may legitimately lack speech or tiebreak thinking. New-revision model-authored speech must not silently disappear. Engine fallback decisions legitimately have no fabricated speech.
- Compile thinking/speech/reveal/handoff substages with stable keys and prefix-appropriate snapshots. A future target, eliminated status, or later pool must not leak into an earlier beat merely because all stages share one committed resolution.
- Consume each attached speech once and exclude it from generic social composition. Ordinary public conversation remains a deliberately supported viewer category. Audit format selection and other decision-speech actions too so the fix does not leave the same hole elsewhere.
- Keep timing tied to actual speech/audio and saved thinking, using existing solo/director primitives. Update production-moment/audio/watch references where composition identity changes so Studio/export and deep links reach the same semantic moment.

### 5. Implement the scene and retire obsolete paths

- Add the full-body chain scene over the shared backdrop, driven exclusively by the cue's trusted before/after board and stage. Reuse `vote-presentation.tsx`, `vote-ledger-model.ts`, solo layout, and cast asset selection where their contracts fit.
- Replace the text board/group-lobby overlay only where the new scene preserves existing game viewability. Keep historical regression tests, updating their presentation expectations rather than deleting proof that old games work. Do not require a prior generated lobby image to display the new scene.
- Verify transparent-full-body/headshot selection and image loading failure using the existing asset behavior. Ordinary non-transparent full-body art uses the same placement as transparent art; no special composition, collision checks, or elaborate test matrix for this rare intermediate state. Freeze media selection for an active beat to avoid a newly generated cutout causing a mid-speech jump.

### 6. Fail fast on unsupported presentation

Build a small exhaustive ownership contract at the canonical-event → sanitized viewer-event → cue → renderer boundaries, mandatory from the new root game schema revision onward. Extend the existing catalog/presentation metadata rather than creating a competing format allowlist. This is a frozen schema boundary, not a runtime feature flag.

- Keep pre-boundary games on their existing historical rendering contract. Do not retroactively require all old data to satisfy new speech/event invariants, rewrite old games, or inventory every historical anomaly before activation. Isolate legacy tolerance at root dispatch; new-revision games must never fall through into it. Shared rendering improvements may benefit old games where their structured records support them.

- Every typed event is explicitly owned by a presentation handler, state-only handler, or private/non-viewable classification with a reason. Every cue kind has a renderer. Use exhaustive TypeScript switches/records so adding an event/cue breaks checking until its ownership is decided.
- Validate runtime data too: in new-revision games, unknown event version/type, unsupported format combination, ambiguous speech association, or unconsumed required speech yields a typed presentation error. Remove catch-all event cards and silent `null`/drop behavior from this strict path. Enforce event schema membership and payload validation at canonical write/commit boundaries too; viewers independently validate received data.
- The player error boundary stops advancement at the last trusted prefix and shows a clear unsupported-playback error with a safe diagnostic identifier. This is not a generic event viewer. Record useful event/version/sequence details without exposing private content.
- Distinguish incomplete live delivery from invalid data. Buffer an unfinished committed-publication batch; only require its speech associations once its completeness boundary is known. A valid chain prefix waiting for its next action is not an error. Do not fail the underlying game because a viewer cannot render it.
- Retain intentional art fallback, optional thinking absence, explicitly supported old versions, and legitimate social/House renderers. These are not unknown-event fallbacks.

## Automated proof and acceptance gates

| Layer | Required proof |
| --- | --- |
| Original regression | Full composed historical-order fixture fails before the speech-binding fix and passes after it; distinct pointer and tiebreak speeches occur exactly once in the correct places. |
| Lifecycle | New-root selection → all pointers → Mingle/huddles → ballots → optional tie → result; historical order unchanged; other formats unchanged. Test creation, waiting-game start, and restoration. |
| Context and memory | Verify recent public speeches are included in actual next-picker/Mingle prompts, in order, with no future speech or other player's thinking. Verify aged-out speeches remain authorized recall candidates without requiring permanent inclusion. Test the existing non-endgame recency boundary and endgame boundary separately. Assert both pools and correct Safe/Vulnerable guidance before the first Mingle decision. Verify public-message projection and recall eligibility survive restart, and agent retention remains optional. |
| Durability/PostgreSQL | Restart after starter, each pointer, Mingle completion, ballots, tie, and final resolution; compare with uninterrupted output. Retry before/after commit cannot redraw, repeat speech, overwrite evidence, or skip a picker. Same-actor multi-slot receipts remain distinct. Use `setupTestDB()` and sequential shared-DB tests. |
| Canonical reducer | Every valid prefix; invalid order, duplicate/unknown player, repeated target, incorrect alternation, incomplete final board, aggregate mismatch; minimum/maximum supported rosters and sole-vulnerable historical fixture. |
| Contracts | Preserve malformed-output suite: non-JSON, broken/ambiguous JSON, missing/extra fields, invalid targets, exhausted retries. New tiebreaks require thinking plus speech; missing thinking fails validation. Old receipts remain valid under their original contract. Sealed ballots require speech without thinking. Legal fallback remains marked and speechless. |
| Ballot explanations | New empower and Safety Bounce requests invite a brief candid explanation to the House and contain no conflicting name-only/no-explanation instruction. Accept a valid explanation longer than the old 120-byte cap within the new 320-byte allowance; retain exact text through commit/restart/DTO/reveal/audio. Verify opponents cannot read the explanation during collection or through later public recall. Do not test explanation quality by parsing prose or require a separate thinking field. |
| Viewer coverage | Enumerate catalog formats, supported event versions, and all cue variants from authoritative types/registries. Require representative branch fixtures; compile every valid prefix through the real composition and render paths. New registrations without fixtures fail CI. |
| Semantic consumption | Every required speech is consumed once by the correct actor/action/slot; no orphan, duplication, wrong-round attachment, or post-resolution tail. Empty or generic output cannot satisfy coverage. |
| Negative coverage | Inject an unknown runtime event, missing renderer, ambiguous association, and an orphan speech into otherwise valid fixtures; each must produce the expected typed failure. Assert the coverage harness itself catches deliberate missing ownership. |
| Browser | Extend `e2e/format-aware-game-viewer.spec.ts`: full-body crowd and starter, each thinking/speech/reveal/handoff stage, terminal target, pools during vote, tie speech, mobile, reduced motion, full-body/headshot fallback, pause/seek/reconnect, Show thinking on/off, and audio timing. Assert semantic identity/order and capture visual checkpoints. Do not assert non-overlap or add collision detection; no special ordinary-full-body layout qualification. |
| Root boundary and historical replay | Old games must remain viewable. Explicitly replay old Safety Bounce fixtures without thinking/messages through the new scene to completion; preserve present speeches where supported. Retain the existing historical regression suite and cover relevant no-frame/legacy entry routes before removing any renderer. Strict rejection applies only to new-root games; old records must not be reclassified into that path. Unknown future root revisions fail without affecting supported old revisions. Exhaustive archaeology is not required, but a known old-game viewability regression blocks release. |
| Shared consumers | Live-prefix/replay equality, completed entry, deep links, Studio/export cue identity and timing, production audio references. |

Exhaustive registration catches missing integration; behavioral fixtures catch wrong integration. Neither alone can prove visual quality. The browser choreography checks and a human viewing pass remain necessary.

Run focused suites during implementation, then `bun run test`, `bun run test:postgres`, and `bun run check`, plus the classified deterministic format-viewer Playwright suite. No paid provider runs or external writes are required for this proof. If later authorized, paid qualification must use the localhost API and retain game IDs and complete sanitized evidence.

## Documentation and completion

Update format rules/MCP wording, `CONCEPTS.md`, the Safety Bounce section of `docs/visual-mode.md`, and the prior overlay learning to describe the replacement. Because decision/context surfaces change, update `docs/reasoning-transcript-observability.md`, relevant examples in `docs/local-model-evaluation.md` / `DEVELOPMENT.md` / `README.md`, and simulator JSDoc. Document viewer ownership and fixture requirements in the custom-format skill so future formats inherit the gate. Keep no-`as any` and direct-House-call disciplines explicit.

Completion requires the original late-speech regression reproduced and fixed, saved ballot speech visible at reveal, new tiebreak thinking, durable public speech recall, status-specific pre-Mingle context, the new frozen lifecycle proven across restart, the full-body scene verified, and exhaustive plus semantic viewer tests in required CI. New-root games have no unsupported-event fallback; historical tolerance stays isolated. Report local/CI/browser evidence separately; deployment remains a separate action.

## Research limits and decisions to verify during implementation

- Staging saved speech is verified for `hard-violet-reef`; exact browser ordering and ballot text/audio rendering still need a faithful persisted fixture and playback inspection. Source and MCP records alone do not prove browser behavior.
- Inventory all runtime generic event-rendering paths before deleting them. A compiler's default branch may represent deliberate ownership by another compiler; replace it with explicit classification, not an indiscriminate throw.
- Inspect the current asset DTO/resolver end to end before selecting fields for transparent versus ordinary full-body art. The visual model already consumes resolved full-body URLs; preserve that abstraction where possible.
- Confirm speech identity survives current API serialization. Add only missing small coordinates; keep large speech/evidence payloads in the existing bucket-backed storage. No historical content regeneration or broad storage refactor is part of this story.


## Implementation verification — 2026-10-30

Implemented on `codex/safety-bounce-choreography`, following plan commit `9f00ca5e`.

- New games freeze root schema v2 and decision contract v3. Safety Bounce commits the starter and each public pick before the existing Mingle window; finalized pools and personal guidance survive restoration. Ballots remain sealed contestant-private speech. Both format tiebreak actions request thinking and public speech.
- Playback attaches public thinking/speech to chain and tie decisions, retains ballot explanations at reveal, animates full-body handoffs into avatar pools, and keeps the pools during voting. Existing historical chains remain playable without speech or generated lobby media.
- New-root event projection and renderer ownership is exhaustive, with runtime diagnostics and incomplete-delivery buffering. Catalog fixtures exercise every valid prefix and reject missing ownership, missing/ambiguous speech, and orphan speech.
- Historical projections retain absent version fields to preserve checkpoint hashes. Existing pinned production v3 snapshots keep their source identities; new v4 snapshots attach speech to decisions. Studio, export, audio, and MCP contracts support the same boundary.
- `bun run test`: **3,165 passed, 5 existing skips, 0 failed** (333 files).
- `bun run check`: all packages passed typechecking and lint.
- `bun run test:e2e:format-viewer --trace=off`: **64 passed**. Desktop/mobile screenshots were inspected; assertions cover thinking/speech/reveal, pools, art fallback, historical replay, reduced motion, seek and reconnect. Browser fixtures are deterministic; this is local proof, not a deployed staging verification.
- `bun run test:postgres`: **2,276 passed, 4 failed** in the full run. All four failures identified the MCP snapshot schema still requiring production v3. After updating it to admit v3/v4, the sequential rerun of editorial MCP, production source, audio annotations, durable store, game API and free queue passed **177 tests, 0 failed**. The full PostgreSQL suite was not repeated after that focused schema correction.
- Skill structure validation passed; browser-generated Next configuration changes were removed. No deployment, paid simulation, or historical data rewrite was performed.


## Follow-up TODO: speech ownership across every format and phase

- [ ] Extend the same semantic coverage beyond Safety Bounce and Two Names to every game format, phase, decision action, and speech-bearing event. Inventory ownership; verify thinking → speech → canonical reveal, exactly-once consumption, correct actor/slot, live buffering, replay, audio, Studio/export, and no delayed speech tail. Add negative tests that prove missing integrations fail rather than accepting a generic viewer.
- **THOU SHALT NOT BREAK AN OLD GAME.** Preserve viewability and frozen execution/source contracts for all supported historical games. Test old versions, absent speech/thinking, existing recorded speeches, and pinned production snapshots. New strict requirements must never retroactively invalidate old recordings. Historical regression tests are release blockers.

### Two Names follow-through

Connect existing initial-nomination, override (used/declined), and replacement deliveries to their canonical cues. Reuse the portrait thinking/speech scene before the existing result display, hold sidebar facts at the pre-decision snapshot until reveal, and preserve silent historical cues. Newly captured source pointers require their accepted speech under the new-root viewer contract. Production snapshot v5 adds these attachments; pinned v3/v4 snapshots retain their original source identities and separate speeches.

Two Names verification:

- Provider-free baseline: **3,170 passed, 5 skipped**. After the final projector and distinct-role corrections, the focused engine/viewer/export suite passed **40 tests**.
- Full browser suite: **65 passed, 2 failed** (live share-link pause state and Safety Bounce reveal timing). An unchanged focused rerun passed **all 3 tests**, including both failures. Both new Two Names browser stories passed in the full run; mobile and desktop speech screenshots were inspected.
- Coverage includes absent historical deliveries, pinned v3/v4 snapshots, v5 speech ownership, same/different empowered and override actors, required-speech projection, missing/ambiguous/unconsumed delivery failures, live-prefix buffering, and speech before result reveal.
- `bun run test:postgres`: **2,281 passed, 0 failed** across 206 files, including the new production-content test.
- Final `bun run check`: typechecking and lint passed. Browser-generated Next configuration changes were removed; no deployment or paid simulation was performed.

### Two Names artwork follow-through

Role introductions and nominee/replacement reveals now consume the frozen full-body assets over the council-room background, including the reveal after a spoken decision. Compact role badges remain headshots. Missing or failed full-body images fall back to portraits, preserving old-game viewability. Desktop/mobile browser stories exercise all five reveal stages and failed-image fallback; the reported `bare-sand-nest` Empowered introduction was also checked against its actual transparent cutout locally.

The adjacent thinking/speech beat also now receives the council-room background rather than falling back to the gray solo studio. Saved head calibration accompanies its cutout. The actual `bare-sand-nest` thinking frame was inspected locally, and the speech tests assert the room backdrop.

The follow-up fullscreen review exposed the old fixed-width card wrapper. Two Names reveals now use the shared full-stage visual path, with side-by-side characters, labels below, no nested dossier borders, and reserved playback-control space. Desktop/mobile fullscreen tests assert stage width and height, in addition to image presence and historical fallback.

Artwork/layout verification: provider-free baseline **3,174 passed, 5 skipped** after rerunning outside the port-restricted sandbox; final focused viewer/export tests **78 passed**; final Two Names browser run **11 passed**, including mobile/desktop fullscreen sizing, missing-art fallback, historical replay and both speech branches. `bun run check` passed. The new fullscreen assertions initially caught duplicated player-shell padding; the final run passed after removing it. No API or game-state behavior changed in this presentation-only follow-up.


### Follow-up: viewer coverage and room backgrounds

New root schema v3 extends the existing ownership checks with event-to-cue delivery checks and rejects invalid format presentation instead of leaving an incomplete result panel. Existing root versions remain frozen: **THOU SHALT NOT BREAK AN OLD GAME.** Every format cue is required in executable prefix/render coverage across historical and current versions; Empower tie/revote fixtures supplement the format scenarios. All remaining solo/decorative studio gray backgrounds now select existing House room artwork. Diary visibility is unchanged.
