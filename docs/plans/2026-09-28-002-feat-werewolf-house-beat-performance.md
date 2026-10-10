---
title: Werewolf House beat performance
type: feat
status: superseded
date: 2026-09-28
---

# Werewolf House beat performance

Current experiment: [sequential original-line threads](2026-09-28-003-feat-werewolf-sequential-public-threads.md). House runtime rewriting has been removed; this document records prior exploration.

## Implemented scope

Each Werewolf speech/pass decision carries nullable speech, a free action/feeling cue and at most one structured gaze target. Exhausted speakers can still cue on remaining beats. Introduction and pack cues also survive, under their existing audience boundaries. Rules v4 requires new games, without another SQL migration.

After each public discussion reveal, `WerewolfModelHouse` calls `openai:gpt-6-luna` through the shared native structured executor. It transposes only that beat into short spoken lines, single emoji cues and pauses. Public character/history context precedes the new raw beat and task. Hidden roles, pack chat, strategies and private reasoning are excluded. Contestants still receive raw beats. Scene prose never establishes game facts.

Model-backed Werewolf always generates scenes. `--transcript` prints raw dialogue/cues, `--summaries` prints saved House performances, and both print both. Readback adds no inference. Provider-free simulations explicitly label their scripted scene fixture.

## Modules and durability

| Responsibility | Modules |
| --- | --- |
| Decisions, budgets, raw cue privacy | engine `werewolf/types.ts`, `agent.ts`, `rules.ts`, `observation.ts` |
| Exact performance schema and actor/gaze focus | engine `werewolf/scene.ts` |
| Luna direction and structured retries | engine `werewolf/house.ts` |
| Reveal → House disposition → next action | engine `werewolf/runner.ts` |
| Separate sealed model, ownership, accepted-result recovery | API `services/werewolf-games.ts`, `werewolf-runtime.ts`, `provider-call-journal.ts`; engine `provider-execution.ts` |
| CLI flags and saved readback | engine `werewolf/report.ts`, `simulate.ts`, `api-simulate.ts` |
| Basic ordered scene list | web `app/werewolf/werewolf-viewer.tsx` |

`werewolf.scene_recorded` persists source sequence, beat, status, model and ordered items. Its `werewolf_scene` provider coordinate is fenced to the next event sequence and active owner. Public projections omit the private source sequence. Accepted results survive owner replacement without redispatch. Three failed provider attempts record explicit unavailability and preserve raw discussion; cancellation and code errors propagate.

Validation covers exact fields, actor/gaze references, one emoji, missing speakers/cues, illegal pass speech, size limits and UUID leakage. Structural coverage is not proof of semantic fidelity. Keep exact schemas and direct House calls; no `as any`.

## Proof and live findings

- Required provider-free baseline: 2,100 passed, five skipped. Sandbox socket failures cleared with local access.
- Required PostgreSQL baseline: 1,775 passed. Final focused API suite: 13 passed, including independent House model policy and owner-replacement recovery.
- Final focused engine suite: 71 passed, including cue-only introductions, pack-cue privacy, malformed repair/exhaustion, pass cues and hidden source-sequence exclusion.
- Typecheck/lint and three deterministic browser/API journeys passed. Browser providers are fixtures, not live inference proof.
- A real Luna one-day game produced five House scenes, including four players passing with cues while one spoke. The first prompt fragmented speech and repeated clauses. A second pass improved pacing but added unsupported agreement. The final prompt forbids invented backchannels and produced all five scenes in a separate comparison (2.2–10.3 seconds per beat). It still added a small “Right” connective in beat one: presentation fidelity remains a review concern, despite passing structural validation. Originals remain unchanged. General fidelity and balance remain unproven by one short game; the one-day cap intentionally produced a draw.

Local private artifacts are under `packages/engine/docs/simulations/werewolf-house-live-2026-09-28*`: original canonical ledger/report, revised audition and final raw-versus-House comparison. The final comparison includes per-beat generation latency. These are local evaluation artifacts, not deployed game output.

## Next visual layer

`werewolfSceneFocus` supplies performer and optional gaze identities. A timed director should read one item at a time, retain emoji until changed, and derive bubble dwell from speech length. Image selection and geometry belong to that renderer.

If a multi-panel stitch fails, preserve usable original frames, crop required participants using verified localization, blur nonparticipants/backgrounds, and dissolve seams against a blurred background. Use a portrait if a required character cannot be located. Reuse existing asset/localization and fitting boundaries; never force a generated composite or parse speech to infer participants. This compositor and timed visual playback remain separate work; the current viewer shows an ordered text list.

## Compact continuation hint

Read `docs/werewolf.md#house-beat-performance`, `scene.ts`, `house.ts` and the final live comparison. Keep raw authority intact, House inputs public, and contestant memory raw. Use `simulate:werewolf:api --transcript --summaries` on a fresh v4 game. Evaluate omissions, invented consensus, speaker swaps, cue coverage and pacing independently of schema/recovery proof. Visual work must consume typed actor/gaze identities and verified source frames, not cue-text parsing.
