---
title: Emotional performance cues — interpretation without changing game facts
type: brainstorm
status: exploring
date: 2026-09-30
---

# Emotional performance cues

Follow-up to the user's review of [Werewolf public visual replay](../plans/2026-09-30-004-feat-werewolf-public-visual-replay.md). The user wants prose, performance notes and scene labels to be useful inputs to future emotional staging. A blanket prohibition on parsing those inputs is not the intended architecture. This note explores the extension; it does not add it to the initial replay implementation.

## The boundary is authority, not interpretation

Game facts—who is present, who spoke, accepted vote/attack/protection targets, deaths, phases and results—come from canonical records. Performance interpretation may turn prose into expression, gaze, gesture, tone and visual composition. It may resolve a mentioned name against the known roster to propose an attention target. It cannot introduce a participant, turn a gesture into a vote, infer a hidden role or replace accepted dialogue.

Example: “Mira looks sharply at Riven” can propose `look_at(Riven)`. It is not evidence that Mira voted for Riven, nor a claim about how Riven feels. “I know you're the wolf” may justify an emphatic delivery; it never establishes the accused player's role.

Scene labels are also useful input. A label such as “A tense exchange by the fireplace” may suggest atmosphere or composition. Resolve any cast/room references against structured scene context; keep IDs as the binding authority. A label can change editorially without silently changing participants, audience, chronology or the scene's identity. If we introduce a machine-readable label syntax, make it an explicit validated contract rather than a convention guessed from display text.

## Existing footholds

- Werewolf speech/opening contracts already include optional `cue: string | null`, capped at 240 characters; passes can carry a cue. See `packages/engine/src/werewolf/agent.ts` and `types.ts`.
- `PerformanceCue` is presently opaque text in `packages/engine/src/visual-mode.ts`. `ScenePerformanceCue` already binds accepted cues to a player, scene and turn.
- `VisualScenePlan.cues` carries performance notes. `sameVisualArrangement` intentionally excludes cues from arrangement identity: an expression change should not cause another expensive room render. Preserve that property.
- `VisualSceneView` has verified character anchors/pointers, camera framing, speech timing and bounded image layers. It does not have a structured facial-expression or gaze-animation track.
- Werewolf production currently captures a cue when creating a scene boundary. A scene can cover many later contributions, so per-turn emotion cannot be recovered merely by reading the scene's initial cue. Bind the future performance track to accepted contributions/moments.

## Smallest useful vocabulary

Treat this as observable/acted performance, not a trustworthy readout of inner emotion. A wolf can perform innocence or confusion. Do not label output as detected truth.

Proposed first version, to evaluate before freezing:

- Expression: `sad`, `confused`, `angry`, `alert`, `amused`, `uneasy`; `null` means no explicit signal, not proof of neutrality.
- Directed action: `look_at` or `point_at`, with one validated target player ID; `null` means none.
- At most one expression and one directed action per contribution. A pass has the same allowance.
- No model-specified pixels, CSS, timing curves, asset URLs, arbitrary commands or extra dialogue.

Example interpreted payload:

```json
{
  "expression": "confused",
  "action": { "kind": "look_at", "targetPlayerId": "riven" }
}
```

The owning contribution supplies actor and moment identity. The interpreter does not choose another actor to perform for. Target IDs must belong to the visible, permitted cast at that moment; an ambiguous name gets no target. Validate an exact schema and semantic constraints before accepting the artifact. Unknown actions are recorded as unavailable/unsupported, not coerced into a different meaning.

Keep the vocabulary in one small versioned catalog mapping supported semantics to presentation treatments. Initially this can be code/config, not an elaborate operator configuration screen. Emoji selection belongs to the visual theme, so models choose `confused` rather than spelling a particular emoji. Add intensity, nodding, directed expressions or multistep acting only after this limited set produces a useful result.

## Three ways to supply the track

| Approach | Benefits | Costs / risks |
| --- | --- | --- |
| Player authors a small structured performance field in the existing Speak/Pass call | Deliberate self-performance; zero additional model invocations; naturally has only the player's current context | Adds schema/prompt/output tokens; may increase retry rate or compete with dialogue quality; needs versioned accepted-output handling |
| Production interpreter converts existing cue text into structured performance | Works on existing games; player/game contracts unchanged; independent rerender/review | Extra metered calls and latency; interpretation can be wrong; needs provenance, validation and saved output |
| Curated deterministic cue syntax/catalog | Zero extra inference and predictable behavior | Only dependable for explicitly supported syntax; keyword matching cannot reliably interpret negation, sarcasm or free prose |

Recommendation: use an optional production interpreter to evaluate the idea on existing accepted cues; prefer actor-authored structured performance if the vocabulary proves worthwhile for new games. Keep raw cue text for richer future production and keep accepted dialogue untouched. Do not run both on every contribution by default. Direct authored values win over inferred values; a conflicting interpretation does not silently replace them.

Start interpretation with explicit cue text. Extend to the spoken line and scene label when there is evidence that it helps. A plain line with no cue should not automatically gain an invented feeling or reaction. Director-authored reactions for other players would be a separate editorial capability, not silently attributed to those players.

## Production contract and causal context

Input: accepted contribution, its optional cue, allowed roster/targets, relevant scene metadata, and a bounded audience-visible prefix. Output: the exact supported performance object or no signal. Store its source moment/hash, vocabulary version, interpreter/prompt/model version and cost receipt as separate production metadata. Preserve source text. Reuse the accepted artifact across playback and render attempts; seeking never calls the model.

Interpretation failures must be typed and visible to production. The game/player remains watchable without enrichment; failure does not become an authored pass or silently mark the production job successful. Bound retries/cost and run enrichment outside the game decision path.

Only provide context available at the displayed moment. Do not give a public interpreter secret roles, private reasoning, future votes or the final outcome and hope output filtering removes their influence. Even a harmless-looking expression can leak hidden information. Public performance can be reused in both audience modes; pack performance stays on its pack track. Audience changes must clear ineligible overlays as well as images and dialogue.

Batching is not automatically safe: generating earlier emotions with a whole future day's conversation in context can introduce hindsight. Independent per-contribution requests can share a background job, but a single model call containing later dialogue needs a separately justified causal contract. Start with cue-bearing moments and small bounded prefix contexts; do not assume one full-day rewrite call is equivalent.

The new production track does not automatically enter agent observations. Existing accepted actor-authored cues retain their current semantics. Feeding inferred performance back to players would change what they know and deserves a separate explicit decision.

## What the renderer can honestly do

**Modest first step:** a short expression mark near a verified head or the speaker's portrait, plus an attention treatment identifying a target. These are rendered performance signals. They do not make a baked image's eyes or arm move. A target cue can remain legible through a portrait inset when characters occupy different panels; do not require stitching or a room regeneration.

**Richer reusable art:** approved expression/pose variants or character cutouts can make the actor actually look sad, turn or point. That needs identity-consistent assets, masks/layers, attachment points and transition rules. Pointing toward arbitrary targets is harder than showing a stock pointing pose. These changes are substantial art/render work, even if cue extraction is cheap.

**Generated motion/video per moment:** potentially expressive, but introduces many paid generations, latency, identity drift and more review. It should not be the first delivery path.

Timing should initially be deterministic: enter with the contribution, last for a bounded readable interval, then clear. Passes can show a brief performance moment without an empty bubble. Pause/seek/reduced motion use the existing player clock. Seek derives the current cue from accepted moment state instead of replaying old timers. Expressions must not linger through an unrelated turn or survive an audience switch. A later timed track can support multiple expressions within a line, but is unnecessary for the first experiment.

## Relative expense

These are workload estimates, not measured prices or latency promises:

- Native structured cues: **zero additional calls**, but more schema/prompt/output tokens and possibly retries. Illustratively, 500 contributions with 20–60 extra output tokens each add 10,000–30,000 output tokens; prompt additions must be counted too.
- Interpreter: **one additional call per selected contribution** in the simple causal design. If only 100 of 500 turns have meaningful cues, interpreting those 100 is materially smaller than processing every line. Latency stays off the game path; viewers can play without the optional result.
- Runtime expression/attention overlays: **no model or image-generation charge during playback**. Engineering scope is moderate because of anchors, panel fallback, timing and access/seek correctness, rather than expensive rendering.
- Actual pose/expression changes: separate asset production cost. Eight characters with six reusable expression variants would be 48 candidate outputs before retries/review; that is a scale illustration, not an assertion every game needs 48 assets. Per-line image/video generation can grow with the full conversation length.

Compute a dollar estimate after selecting a supported model and measuring representative inputs/outputs: `input_tokens × input_rate + output_tokens × output_rate`, with rate units converted consistently, plus retries and any image generation. Use the existing provider accounting so experiment costs remain visible. No paid inference or image work was run for this brainstorm.

## Suggested experiment after the basic player works

Use a small hand-reviewed set of existing accepted Speak/Pass cues: direct emotion, negation, ambiguous names, sarcasm, cross-panel attention, a dead/absent target, pack-only material and backward/audience seeks. Compare human-expected supported signals to the compiler's output. Preview the overlay treatment before paying for expression art.

Evaluate: target accuracy, unsupported/invented emotion rate, author intent preservation, clutter/comfort, correct silence, token/retry cost and whether watching is more enjoyable. Judge three things separately: interpretation quality, rendering quality and strategic information leakage. Let results determine whether to adopt direct structured player cues and which additional gestures deserve support.

## Impact on the public replay plan now

Keep original cues attached to their moments and keep timing/audience ownership clear. Do not build a cue interpreter, an emotion settings console, an asset-variant generator or a feedback loop into players in the first public replay milestone. That is sequencing, not a permanent prohibition on interpreting prose or cues.


## User clarification for v1 direction

Physical image editing is not required for directed gestures. The user proposes framing source and target in the left/right halves, then moving a looking-eyes emoji between their verified heads. Framing itself communicates attention; this builds on existing pointing/panel language. Keep this as the intended lightweight direction, rather than assuming looking/pointing requires regenerated poses. The public replay v1 remains the current implementation task; the structured cue interpreter is separate.
