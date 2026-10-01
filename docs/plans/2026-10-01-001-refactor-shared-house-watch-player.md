---
title: Integrate Werewolf into the House watch player
type: refactor
status: reviewed
date: 2026-10-01
source_commit: 80c74708
---

# Integrate Werewolf into the House watch player

## Decision and scope correction

The user considers the separate Werewolf viewer a disposable prototype. Keep the production/publication work. Build from the existing House Influence watch experience, extracting shared playback and layout where the existing implementation couples them to Influence. Do not continue filling out a second viewer with copied controls and panels.

This document is a code audit and implementation proposal, not implementation authorization. The prior [visual replay plan](2026-09-30-004-feat-werewolf-public-visual-replay.md) proved a working prototype, not House-player parity. Its green tests did not test that product requirement. Plan review is complete with the 2026-10-01 scope decisions below; shared-player implementation has not begun. The user separately authorized enabling Werewolf `thinking` on all model turns, with an Omniscient-only toggle; that narrow slice is implemented alongside this review.

The shared product is the watch shell, theater, cast, inspector, transport, fullscreen, and live/replay behavior. Game adapters own rules, phase vocabulary, canonical snapshots, chapter boundaries, accepted contributions, room membership, results, and permitted information. Keep Influence classic/format differences inside the Influence adapter. Werewolf is not another Influence elimination format.

## Confirmed gaps and source map

All paths below are relative to this worktree. Line references are audit anchors at the source commit, not permanent API contracts.

| Area | Existing House code | Prototype / integration gap |
| --- | --- | --- |
| Watch shell | `packages/web/src/app/games/[slug]/components/match-watch-shell.tsx` owns fixed desktop/mobile layout, cast selection, inspector, MCP banner, theater and replay dock. | Werewolf routes render their own page, cast chips and transport. No shell reuse. Extract presentational components from this implementation and use them for both games. |
| Playback | `dramatic-replay-viewer.tsx` owns theater, fullscreen, transport, shortcuts, navigation, hydration and director bindings. `format-presentation-director.ts` owns timing, append/hydrate, seeking, speed, follow-tail and animation control. | `werewolf-player.tsx` adds a separate RAF clock; `werewolf-viewer.tsx` adds a separate polling/transport controller. Sharing `VisualSceneView` and `TimedSpeech` alone does not share playback. |
| Domain coupling | `match-watch-model.ts` requires `GamePlayer`, `PhaseKey`, Influence pressure tags and format snapshots. `types.ts:311` closes `PresentationCue` over classic/format/House/endgame. | Cannot pass a Werewolf DTO to the current shell. Remove rule assumptions from its presentation-facing props; do not fabricate Influence game rows/phases/jury membership. |
| Navigation | Existing scene/room navigation uses `findCueForAdjacentScene`, `findPreviousMingleRoomCue`; `[` separately uses `findPreviousRoundCue`. | Prototype Previous/Next changes the raw audience cursor by one. Existing House navigation is itself asymmetric; make the chapter/scene distinction explicit rather than assuming all existing buttons already mean round. |
| Player inspector | `InspectorPanel` has Overview, Thinking, Strategy, Alliance and Diary. Selected player and replay state feed the panels. | Werewolf has no inspector and its public DTO omits backstory/personality/strategy. Add an intentional player projection from frozen roster data. Omit unsupported Alliance/Diary surfaces rather than creating empty features. |
| Intelligence | `services/public-watch-intelligence.ts` and `match-watch-intelligence-model.ts` consume cognitive artifacts/transcript thinking and Influence round/phase. Shell request at `match-watch-shell.tsx:150` has no exact replay cursor. | Werewolf accepted decisions live elsewhere. Add an audience- and exact-cursor-bound projection; round/day alone cannot stop later same-day evidence from appearing on rewind. Do not blindly reuse the existing fetch contract. |
| Strategy updates | Influence's agent has compact strategy state, candidate/delta validation and reconciliation. Its public intelligence service currently initializes `strategyCards` to an empty array. | Werewolf only freezes starting guidance and supplies it to prompts. No strategy delta/revision/reconciliation events. Reusing a Strategy tab cannot produce an evolving strategy history. |
| MCP | `packages/api/src/game-mcp/read-model.ts:551,601,607` explicitly filters to Influence. Profile tools do include Werewolf strategy fields. | Reuse the existing House MCP banner verbatim. Werewolf discovery/inspection remains pending under A4-MCP in the pillar document; it is not a dependency of this viewer integration. |
| Production | `werewolf-production.ts`, `werewolf-presentation.ts`, migration 0105 and shared production controls already provide frozen references, reviewed versions, public publication, audience/cast checks and publication pinning. | Preserve these. Adapt their safe outputs to the shared theater. No renderer rewrite, new art or production-studio redesign is needed to establish player parity. |

Relevant precedents: `docs/solutions/architecture-patterns/separate-werewolf-game-authority.md`, `docs/solutions/logic-errors/two-names-context-and-live-catch-up.md`, and `docs/solutions/design-patterns/canonical-safety-bounce-lobby-overlays.md`. They establish separate game authority, cursor-owned live/replay state, and retaining the common lobby renderer for canonical overlays.

## What reasoning and strategy actually exist

- **Target-action thinking exists.** `WerewolfDecision` has `{kind:"target", targetId, thinking}`. `createWerewolfStore.append` persists the complete accepted event in `werewolf_events`. The public projection deliberately omits that private field; the prototype did not delete it.
- **At the audited commit, speech/pass thinking was not requested.** Speech returns text/cue; an opening also returns recipient IDs. There is no structured `thinking` field on those turns. A cue is an observable performance note, not hidden intent.
- **Provider evidence is a different source.** Werewolf uses shared provider hooks and the private attempt-evidence path. Optional native reasoning depends on provider output, configured capture and retained evidence. Do not promise it exists on every speech, or expose raw attempt records as the Thinking panel. Failed/uncommitted attempts must never masquerade as accepted decisions.
- **Starting strategy survives.** Selected Werewolf guidance or its archetype default is frozen in the start roster and supplied in `observation.self.strategy` alongside identity and role coaching.
- **Evolving strategy is absent.** There is no Werewolf equivalent of Influence's compact-strategy lifecycle. Implementing it is a gameplay/context change, with schema validation, durable state and prompt consequences, not a viewer adapter fix. No historical strategy updates can be recovered by parsing conversation or asking a new model to invent them.
- **Influence's public Strategy tab is not proof of public update delivery.** `public-watch-intelligence.ts:223` returns no strategy cards even though Influence has private compact strategy machinery. Record this gap in pending work. It does not call for Werewolf-specific warning copy, disabled controls, or a separate reduced-capability UI during feature-worktree iteration.

Read-only local evidence on 2026-10-01: `young-tan-frost` has thinking on all 25 accepted votes, its attack and its investigation. Its 49 introduction/opening/discussion actions have no thinking field. `bare-ruby-tower` has thinking on all 76 votes, five attacks, three protections and three investigations; its 151 conversational actions have no separate thinking field. Only aggregate counts were read; no private text was published or generated.

**Confirmed disclosure decision (2026-10-01):** the user rejected the term “decision explanations.” Use the established `thinking` field. Enable it for every Werewolf model turn, including speech and passes. Omniscient has a separate, initially-off Thinking toggle; Mystery never receives thinking, including after completion. Keep native provider reasoning traces distinct and in authorized diagnostics. The narrow implementation journals speech thinking alongside the accepted provider result, keeps it out of gameplay decisions/player observations, and binds display to committed replay moments. Sealed target thinking releases at its canonical pack/day/night resolution. Historical conversations with no captured thinking remain unavailable. Frozen owner strategy still needs an explicit publication policy; this decision does not publish it. No rules-version change or migration is needed.

## Shared playback boundary

Extract from the House code in place, with the existing Influence viewer as the first consumer throughout. Suggested module names are implementation targets, not a plugin framework:

1. **Shared watch layout and panels.** Extract the existing shell chrome, responsive cast/inspector layout and theater container. They receive display models and explicit supported panels. The Influence adapter continues to provide pressure/alliances/diary; Werewolf provides role-aware player information, day/night status and faction results. Keep existing profile inspection interactions where the frozen roster supports them.
2. **One director and one transport.** Extract the existing director's scheduling core and the existing transport/fullscreen/keyboard components. The clock consumes stable cue keys, duration, timeline position and chapter/scene identity. Influence-specific animation logic (for example Safety Bounce and House bridges) stays with its presentation adapter. Preserve tested hydration, pause, image readiness, reduced-motion and follow-tail semantics; delete the prototype RAF clock after both games use this path.
3. **Two explicit timeline adapters.** Influence compiles existing transcript/canonical frames as today. Werewolf compiles audience-safe canonical prefixes into speech, phase, resolved vote, night outcome and faction-result cues. Pass/unavailable records remain in raw history but produce no standalone player frame. Engine/game events are unchanged. No parsing of dialogue to infer state, no fake `PhaseKey` or conversion into an Influence format.
4. **One active presentation position.** Theater title, visible cast, selected-player evidence, transcript cutoff, media binding and inspector context all follow the director's active position, including during live rewind. Polling/streaming updates the available head separately. No panel reads the final game state while the theater shows an earlier prefix.
5. **Transport-independent data loading.** Werewolf can initially keep its existing committed polling feed and publication snapshot. A shared controller must accept append/hydrate updates without requiring Werewolf to copy Influence's WebSocket protocol in this slice. Use a bounded window/next-cue buffer; avoid clearing the theater on every forward fetch. Audience changes clear incompatible content synchronously and invalidate old requests/caches.

Minimal presentation data needs: stable cue identity; audience-local source position and release boundary; chapter and scene IDs/labels; original dialogue and optional cue; cursor-correct cast/status; a game-specific outcome payload; exact published media binding. Game-specific payloads remain a typed Influence/Werewolf union. Do not design a universal game-state schema or introduce dynamic registration/configuration for hypothetical games.

## Navigation and the reported defects

- **Pass:** omit it from the playable timeline, not from canonical history. This includes no headshot, no bubble saying “Pass”, and no timed pause card. Preserve its cue in transcript/production data for later expressive overlays. A run of passes must advance to the next visible cue or wait at the live frontier without a loop. An all-pass opening must not produce an empty conversation scene.
- **Speech capacity:** preserve the prototype's improved headshot composition, but give the shared bubble room for roughly 4–6 readable lines before pagination. Measure available viewport height and actual line height; smaller screens may require fewer lines to avoid covering the face or controls. Retain measured pagination and full reading duration for genuinely long lines. Test 4–6-line examples, long words, narrow screens and changing fonts/layout, not just whether a bubble exists.
- **Title glitch:** user-observed, not yet independently reproduced in this audit. Code risk: the prototype key-remounts the whole player for every raw cursor, substitutes a loading stage, and has a wrapping absolute-positioned context label. These facts do not prove the exact double-title cause. Put one stable context header in the existing theater chrome, bound to the active cue; capture slow-frame transitions, wrapping and delayed loads to verify only one title is visible.
- **Separate message, scene and round navigation.** Keep scrub/step for fine movement. Proposed Werewolf round grouping: introduction; cycle N containing Night N and Day N; ending. Provide explicit previous/next cycle navigation and scene navigation for public threads and night blocks, labeled in Werewolf vocabulary. House's current previous-room/next-scene and `[` behavior must be mapped deliberately; they are not interchangeable. Reuse the control component, fix semantic asymmetry once, and test Influence alongside Werewolf.
- **Fullscreen and mobile:** use `use-player-fullscreen.ts`, the existing transport placement and desktop/mobile shell. Cast/inspector access must work on mobile rather than merely being hidden at small widths. Controls and labels must not move as optional details appear.

## Implementation sequence and completion gates

### 1. Extract the existing shell/transport with Influence still working

Files: `match-watch-shell.tsx`, `match-watch-model.ts`, `dramatic-replay-viewer.tsx`, `format-presentation-director.ts`, `types.ts`, `use-player-fullscreen.ts`, existing watch/director/browser tests.

Separate rendering props from Influence data fetching and rule interpretation. Extract existing components instead of recreating their styling. Introduce the small shared scheduling contract, keeping Influence cue compilation and animation policies outside it. Gate: Influence replay, live follow/rewind, inspector, room/round navigation, fullscreen and mobile work with the extracted components before adding Werewolf.

### 2. Integrate Werewolf through the shared player

Files: `werewolf/presentation.ts`, API `werewolf-presentation.ts`/`routes/werewolf.ts`, the new Werewolf adapter and `/werewolf/[slug]/page.tsx`.

Preserve canonical audience positions and public asset rules while compiling a separate playable timeline that filters passes. Supply chapter/scene boundaries, frozen cast information and faction result cards. Keep the current publication selection and character reference endpoints. Add headshot/bubble treatment to the shared presentation path. Gate: complete six/eight-player replays in the actual House shell, all controls and cast selection present, no fake Influence statuses or jury/winner assumptions.

### 3. Connect inspector data

Files: Werewolf observation/presentation services, watch inspector display model, `public-watch-intelligence.ts` and related routes/contracts as appropriate.

Bind available evidence to the exact replay position and preserve audience rules, including the Omniscient-only thinking projection and separate toggle. Keep authored starting guidance, thinking, native provider reasoning traces and evolving strategy distinct. Track missing evolving-strategy delivery under A4-EVIDENCE in the pillar document; it is not a viewer-integration gate. Build toward the shared planned interface without adding Werewolf-specific incompleteness notices or capability disclaimers. Do not fabricate evidence to populate a panel; ordinary loading, empty and error handling still applies.

### 4. Reuse the MCP banner verbatim

Include the existing `McpBanner` from `match-watch-shell.tsx` unchanged: the same desktop/mobile copy, styling, behavior and `/get-mcp` link. Extract and reuse it if needed, but do not qualify its claims, hide it for Werewolf, disable it, or gate it on Werewolf MCP implementation.

Implementing the frozen MCP contract is deferred to **A4-MCP** in [the pillar document](../ideation/2026-09-30-house-admin-and-production.md#pending-work-and-ui-surface-map). The existing MCP plan supplies the future implementation specification. Gameplay and event versions are still iterating quickly; avoid tying this viewer work to a prematurely stabilized external inspection contract.

### 5. Remove the prototype and prove parity

Delete the standalone `werewolf-viewer.tsx` transport/clock shell and `werewolf-player.tsx` clock after route cutover; relocate only reusable headshot treatment and typed moment transformations into shared/game-adapter modules. Preserve production services, migration, publication tests and useful security/prefix fixtures. Update the prior plan and documentation rather than keeping two supported public players.

Run provider-free, isolated PostgreSQL, type/lint and actual browser acceptance for BOTH games. Tests must assert the scoped shared-playback behavior, not simply successful autoplay. Verify that the shared MCP banner remains unchanged; implementing MCP inspection and evolving-strategy delivery is pending work, not a gate for this slice. Exercise: round/scene/step differences; passes with/without cues and pass-only stretches; delayed images and narrow speech bubbles; title transitions; player selection and fullscreen; exact-cursor inspector fencing; Mystery/Omniscient/backward-seek races; hidden games; live detached rewind and explicit Go Live; publication pinning; incomplete/missing media. Verify no new model calls and no gameplay-state mutations from playback.

## Reviewed scope decisions — 2026-10-01

The user has completed plan review. The shared shell/director integration is the next change. Production studio redesign, animated emotional cue interpretation, generated imagery, the frozen MCP contract and new agent strategy machinery remain separately tracked work. MCP inspection and missing evidence capabilities do not block this viewer integration.

This isolated feature worktree is building toward the planned shared experience. Do not change UI copy or controls to imply Werewolf is not equivalent to Influence because pending work has not landed yet. Include the MCP banner verbatim. Record implementation gaps and their UI locations in the pillar document instead of creating temporary UI qualifications. If scope is later cut or pending work remains at release review, use that map to revisit the relevant surfaces then; this plan does not direct those UI changes now.

Reusable implementation guardrail: **When adding a game, audit the existing watch shell, timeline/director, controls, cast/inspector, evidence, live/replay and MCP paths before editing a renderer. Render reuse alone is not viewer integration.**


## Thinking slice implementation and validation

The separate shared-player refactor above is reviewed and awaiting implementation. The authorized thinking slice adds `werewolf/thinking.ts`, `services/werewolf-thinking.ts`, and a small Omniscient-only panel. Every provider turn supplies strict, non-empty `thinking`; speech evidence is journaled before being stripped from the gameplay decision. Readback requires a matching committed action and accepted-value integrity, then the audience-local release cursor. Existing target-action thinking remains readable. No backfilled/generated thoughts, additional inference calls, rules migration, or change to player observations.

Validation: provider-free baseline 2,152 passed / five skipped; 17 focused PostgreSQL integration tests passed, followed by the full isolated PostgreSQL baseline (1,812 passed); five browser scenarios passed on a clean rerun after an initial teardown-only timeout; final typecheck/lint passed. The existing local `young-tan-frost` returns zero thinking entries at cursors 1–2, two at cursor 12, and 27 at its ending cursor 69; Mystery is denied. Live-model dialogue quality and the full shared-player experience were not evaluated by this slice.
