---
name: game-mine
description: Run and assess House games until one matches the operator's desired cast, game setup, and gameplay story, then construct its narrative, select interesting thinking, generate requested media, publish visual generations, and start a Studio video export by default. Use for finding dramatic, strategic, surprising, or otherwise specifically requested games; supports a handoff to game-video-package for cinematic and social versions.
---

# Game Mine

Find a game worth watching according to the operator's brief. Run real games through supported House tools or an authorized API; assess the actual outcome and accepted thinking; produce a Studio cut. **Default endpoint: the selected game's video export has actually started**, unless the operator asks not to export or sets an earlier endpoint. A skill invocation does not itself create a persistent goal; create a goal only when explicitly requested.

## Understand the mining brief

Resolve these fields from the current request and relevant session context before creating games. Briefly state the resolved brief and any reasonable defaults. Do not ask the operator to repeat settled choices. Bundle genuinely missing, consequential questions; continue independent read-only discovery while waiting. “Pick anyone” is an intentional roster policy, not a missing answer.

| Field | What to establish |
| --- | --- |
| Desired game | Write a short description of the viewing experience being sought, in the operator's terms. Examples: a close strategic duel, an underdog recovery, social betrayal, hilarious overconfidence, dramatic village infighting. |
| Game type | Influence, Werewolf, or another currently supported game. Do not conflate The House venue with a game type. If unknown, ask rather than silently choosing Werewolf. |
| Format and rules | Applicable format/preset, custom roles or powers, faction counts, voting/discussion policy and relevant limits. Verify supported current rules. Do not translate one game's settings into another game's kernel. |
| Size | Exact player count or an explicitly delegated range. Ask if unresolved. |
| Roster policy | Required competitors, exclusions, fixed complete cast, or permission to choose/mix anyone. Resolve names to owned reusable Agent Profiles and current model routing; distinguish profile identity from model identity. |
| Media | Whether audio and visuals should be generated, and whether those are gameplay input modes or postgame production. Explicit choices override defaults. Otherwise default to cheap mining without gameplay audio/visual generation, then generate audio and visuals for the selected candidate. State that default before spending. |
| Gameplay criteria | Must-haves, positive signals, disqualifiers and acceptable tradeoffs. A named rivalry, particular role, desired winner or desired outcome must be explicit if required; never assume a favorite must win. |
| Operations | Environment, visibility, audience/spoilers, budget/game-count/time limits and any review cadence. Use the established environment; resolve ambiguity before writing to the wrong deployment. Default new mining games to unlisted. |
| Endpoint | Export by default; honor “no export,” “analysis only,” “find a game,” planning-only or another explicit stop. Do not infer a request to publish socially or make a game public. |

Turn the description into a practical acceptance rubric, not a numeric score invented to look objective. Example: “A close eight-player Werewolf game with a convincing reversal; keep Astra and Opus, choose the rest; reject an immediate wolf giveaway or routine sweep.” This example does not establish defaults for other runs. Keep hard requirements separate from editorial preferences.

When cast choice is delegated, choose a varied set that suits the brief and current provider availability. Balance price/capability where useful, avoid accidental duplicate identities, and record the selected roster. Rotate permitted seats between rejected candidates. Do not alter existing character personalities or routing just to manufacture drama.

## Run candidates sequentially

Read [operations.md](references/operations.md) for House production mechanics and resuming long runs.

1. Recover the current run's ledger and check known running candidates first. Do not start another merely because a previous observation timed out. Resume or repair only through supported controls and within the operator's scope.
2. Create the configured unlisted game, enroll the chosen profiles, read back the full lobby, and verify type, format/setup, size, required cast and visibility before starting. Preserve the actual frozen rule version. Do not rely solely on the request payload as proof.
3. Wait for that game to finish. Sleep between authoritative status checks when nothing else is needed. Keep status communication concise; do useful preparation without interfering with contestant decisions. Do not coach players, choose ballots or change rules mid-game to obtain a story.
4. Assess the completed game against the rubric. Use canonical events/projections for facts and accepted speech/thinking for reasoning and claims. Record a keep/reject judgment, pivotal evidence and limitations. A win by a favorite is not sufficient; a loss can be excellent material.
5. If rejected, retain the evidence and a short reason, then run another within the brief. Continue until a match or an operator limit is reached. Do not silently relax requirements to declare success. At a limit, report the best candidate and the unmet criteria; do not claim a match or continue spending beyond the limit.

Differentiate gameplay quality from operational failures. A suspended/provider-failed game is not a dull completed game. Check current state before retrying, preserve request IDs, and avoid duplicate spend. If repeated infrastructure failures prevent meaningful progress, report the concrete blocker rather than creating a procession of failing games.

## Select the story and thinking

For a candidate that passes:

- Write a concise thesis and narrative arc: setup, competing plans, turning point, decisive choice and consequence. Tie every factual claim to canonical coordinates. Include counterevidence so the story does not become a selective claim of model superiority.
- Find accepted thinking that makes the thesis visible: a plan before its result, a mistaken assumption, a sincere change of mind, conflicting reads, an intentional bluff, or the deciding vote. Select the most revealing moments, not all thinking indiscriminately. Include the opposing case and enough surrounding speech/results to make the choice understandable.
- Preserve exact text and identities. Do not rewrite thinking, fabricate internal motives or treat a player's claim as a confirmed fact. Exclude execution-only passes and private operational metadata from the movie according to the game's presentation rules.
- Save exact moment IDs, canonical event sequences, presentation cursors, speaker, excerpt, purpose and selection rationale. These coordinates are distinct; map them through the current catalog rather than comparing unlike numbers.
- Tag selected thoughts Smart (`label.smart=true`) in Studio when supported. Preserve unrelated tags and use current revision checks. Preview the recipe and compare its exact selected IDs with the intended selection; a tag count alone does not prove the right moments were chosen.
- Choose an appropriate audience. Thinking requires authorized omniscient production for Werewolf; Mystery must not reveal private thinking. Preserve game and asset visibility boundaries.

## Produce media and start the export

Honor the media choices in the brief. Reuse valid existing audio/visuals first. Generate requested missing media only for the selected candidate unless the operator chose live media during mining. Verify speech coverage for the selected thinking as well as dialogue.

**Generated visuals must be published to the game before claiming they are visible or included in the export.** A ready generation/version is only a candidate. Inspect identity/cast/composition, use the supported review/verification path where needed, publish the accepted version with appropriate audience permissions, and verify the actual publication and viewer/Studio availability. Publication is not the same as making the game public. Do not assume a private producer-only publication appears in the operator's ordinary viewer: verify the intended surface and correct the publication audience within existing access rules. Never widen access to hidden roles or private assets just to make an image appear.

After publication, refresh Studio's published visuals or reload the source deliberately. Previously pinned previews and bundles can retain the old assets. Freeze a **fresh** selection containing the exact chosen thinking, speech/results, generated recordings and published visuals. Preserve source ordering, audience and asset identities. Check text/speaker/hash bindings, missing media, rendering geometry and requested settings.

Submit the export through the supported production path with an idempotent request key. Retain the selection hash, render job ID and execution ID. Poll the same job until authoritative state proves the worker started (rendering or a later successful stage); an accepted/queued response alone is not proof of worker execution. Do not submit duplicate exports while the first is queued. If the render fails before starting, diagnose the concrete failure and repair within scope.

By default stop once export start is verified. Do not wait for download or expand into cinematic shorts, thumbnails or social publication unless requested. If the operator opts out of export, stop at their requested endpoint with the narrative, thinking selection and requested media ready.

## Deliver and chain

Retain a compact run ledger: brief/rubric, each candidate's ID/configuration/roster/status/judgment, selected game's narrative and evidence, chosen thinking IDs, media generation and publication receipts, frozen selection/hash, Studio link and export job/state. Store no credentials in the ledger.

Report the chosen game, why it fits, narrative thesis, selected-thinking count, media/publication state, Studio cut link and verified export state. State limitations honestly. Preserve the distinction between “export started” and “finished MP4.”

If chaining into `$game-video-package`, pass the ledger/handoff path plus game ID/slug, audience, thesis, canonical evidence, exact thinking moments, character references, media/publication identities, Studio selection and export job. That skill handles storyboard, cinematic generation, composition, YouTube/TikTok packaging and delivery; do not rerun mining or regenerate accepted assets without a reason. Follow the operator's requested chain, and do not silently launch that larger task from a mining-only request.
