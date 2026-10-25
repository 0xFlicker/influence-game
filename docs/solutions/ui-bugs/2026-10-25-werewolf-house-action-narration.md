---
module: Werewolf playback and audio
problem_type: ui_bug
tags: [werewolf, house, narration, audio, privacy, replay]
---

# Give recorded actions a House voice

Pack results and resolved role actions had visual scenes but no House audio source or playback coordinate. Night subscenes reused the dawn presentation text, and backdrop-only announcements used the small audio caption.

Shared canonical copy now covers the permitted action/result, with short atmosphere after the facts. A role's private explanation and its House result use different speaker coordinates. Night actions carry an explicit action discriminator, including hunts, so Doctor, Seer and dawn recordings cannot collide. Server durations, browser cues and exports use the same copy. Backdrop-only narration centers the logo and scales text to the stage; character/action scenes retain captions.

Never reuse Omniscient dawn text for Mystery merely because both catalog moments have the same canonical event ID. Project each audience separately, share a clip only when text matches, and preserve the production moment ID separately from any audience-specific audio clip ID. Otherwise a Doctor save leaks through audio even when the screen projection is safe.

Completed-game House refresh creates a successor track, verifies reused objects, and refuses any contestant audio change. The prior active track remains available until the worker transaction accepts every new clip and switches publication. A failed refresh is retryable without rewriting events, old manifests or audio bytes.

The viewer's audio readiness lookup must also recognize the ready replacement track. Looking only for an active `live` track after publishing a `backfill` successor hides every replay moment in an Audio Mode game. Regression coverage reads the actual watch projection after cutover, in addition to checking audio publication.

Studio export originally duplicated speech eligibility with a moment-kind allowlist and compared the catalog actor with the recording speaker. That blocked valid House narration: night actions and pack results were absent from the list, and an action's actor is its performer, not its narrator. Export now checks recording membership in the authorized selected cut and verifies generated recordings against their published versions. Playback/audio preparation owns exact cue text and speaker identity, including local imports; the API does not infer it from catalog kinds. Regression coverage freezes and validates published House recordings in both audiences and still rejects altered generated speakers and recordings outside the cut.

Local verification on `hard-smoke-rune`: 29 House clips generated, 158 contestant clips reused, and all 141 canonical events retained with the same hash. The active successor is `cf0ddca3-1f7f-450c-bc68-81946fd56584`. Both audience watch windows and an MP3 range request returned successfully; browser playback advanced through the new night narration. Private preview, publication checks and screenshot evidence remain under `packages/engine/docs/simulations/2026-10-25-hard-smoke-rune-house-audio/`.
