---
name: game-video-package
description: Turn a completed game and an editorial thesis into a factual storyboard, generated or Studio-based footage, edited YouTube and TikTok videos, thumbnail, titles, descriptions, and timed subtitles. Use for game highlight packages and cinematic reenactments, including revisions to an existing package; not for gameplay engine changes or automatic social publishing.
---

# Game Video Package

Produce a watchable story supported by the actual game. Deliver finished files, not just prompts or a generation receipt. Respect planning-only requests and existing approvals; advance through authorized production without repeatedly asking for permission. Publishing, changing game visibility, attaching assets to a game, and creating new games are separate actions, not implied by making a local video package.

## Establish the brief and source

Use the supplied game and thesis. Recover existing project artifacts before starting another render. Resolve from context where possible: audience/spoilers, Studio cut versus cinematic reenactment, length/aspect, channels, reference style, provider, music direction, and any spend or review limits. Ask only for information that materially blocks the task. Do not impose a fixed number of scenes or require another approval when the user has already approved the storyboard.

- Read the game via available House tools or authorized API. Pin game ID, rule version, audience, accepted outcome, event coordinates and asset identities. Fetch only the evidence needed for the story.
- Use canonical events/projections for roles, votes, actions, saves, deaths, and outcomes. Dialogue can establish what someone said or claimed; it cannot establish that their claim was true. Do not infer votes or rules from transcript prose.
- Test the thesis against those facts. A single clever win supports a story about that game, not a general model-ranking claim. Distinguish accepted thinking, observable behavior, and editorial interpretation. Offer a grounded angle if the proposed one is unsupported.
- For Studio footage, preserve frozen source selection, audience boundaries and stable moment IDs. For reenactments, label visual actions as dramatized; never turn invented staging into a new game fact.
- Save source evidence and selected character reference images locally. Reuse the game's frozen identity assets rather than inventing replacement appearances.

## Build the story and storyboard

Structure around a hook, essential setup, escalating choices, reversal, consequence, and payoff. Make the human-readable causal connection between beats clear. Favor meaningful decisions, mistaken trust, changing alliances and surprising consequences over chronological completeness.

Each shot record needs:
- ID, narrative purpose, canonical evidence/quote and spoiler scope.
- Intended duration, visual action, camera/framing, blocking and continuity into/out of adjacent shots.
- Named cast and reference assets; who is visible, who speaks, and who must remain silent.
- Exact narration/dialogue, subtitle text, editorial headline, diegetic SFX, and intended music function in the final edit.
- Generation prompt, provider/model parameters, output status and review result.

For a loop, write the ending and beginning as one grammatical sentence, then split them. Example: end “And that's how…” → start “The villagers helped the wolf win.” Remove a competing end card or long silent tail. Do not claim a seamless loop until the actual end-to-start audiovisual boundary is checked.

Read [generation.md](references/generation.md) when prompting or generating footage. Keep production music out of generated scene audio: request narration/dialogue and SFX only, then add music in composition. Prefer silent character performances plus separately recorded offscreen narration when speaker attribution matters.

## Generate and review

Honor the chosen provider; for this workflow Katana IMGN H3 is a useful default when none is specified. Verify current capability, schema and pricing rather than relying on old examples. Record the request before submission and persist returned job IDs; resume by polling, not resubmitting.

Check one representative shot early when establishing a new style or reference workflow. Review against the actual references and storyboard before scaling up. A completed provider job is not an accepted shot.

Check identity, face/hair/costume, speaker assignment, screen direction, door sides, entrances/exits, prop handling, actions, factual meaning, intelligible complete words, and unwanted music/text. Correct the smallest faulty shot. Preserve accepted shots and archive rejected versions with reasons. Do not regenerate the entire package for one fix.

Bound paid retries: do not repeat an unchanged failing request; after two failed corrections for the same defect, change the method (simpler blocking, separate voiceover, existing footage, deterministic edit) or present the concrete tradeoff. Stay within the user's spend/review constraints. If a voice reference is needed, use an authorized synthetic narrator sample; retain explicit sample/destination approval when required. Do not silently switch to another external destination after an approval rejection.

## Edit, compose and render

Read [editing-and-delivery.md](references/editing-and-delivery.md). Work from an explicit edit manifest with source intervals, source hashes, video/audio clocks and output durations. Keep narration, SFX, music, headlines, subtitles and branding independently adjustable.

- Preserve complete spoken words. Shorten pauses without introducing a flash of the next source shot or an internal time jump. Split audio and picture edits when needed; source-video cuts must not dictate narration timing.
- Fit the requested geometry; do not stretch characters. Keep required action, faces, game labels and captions visible. Do not solve text fit by scrolling.
- Put House logo top left and `thehouse.game` top right for House packages unless the user requests otherwise. Use the actual brand asset. Make a separate TikTok layout with top-UI clearance. Check the composed picture shot by shot: lowering text globally can put it over a face. Move a headline, change its timing to an insert, or omit redundant editorial text while retaining spoken captions.
- Derive captions from actual final narration timing, not predicted prompt timings. Use sentence-aware phrases, sensible line breaks, sufficient reading holds, and non-overlapping intervals. Keep SRT and burned captions on the same clock.
- Prefer music already available in the game; next prefer local `minimax_music3_mlx` generation. Creative Commons music is fallback. Follow [music.md](references/music.md). Add and balance the selected music explicitly during final composition; “no music in generation” does not mean “no music in final.”
- Render separate YouTube and TikTok files. YouTube Shorts may use 9:16; do not assume every YouTube request is a Short or turn a portrait film into a landscape crop without considering composition.

## Verify and deliver

Inspect actual encoded output, not only an editor preview or contact sheet. Check:
1. Full decode, dimensions, aspect, frame rate, duration, audio stream, clipping and missing/black frames.
2. Full narration against the script, including names, final words and loop hook. Local transcription is useful; it does not prove voice quality or music balance. Listen to those directly when available; disclose what remains unverified.
3. Caption timing and readability, no simultaneous subtitle cues, no headline/subtitle or headline/face collisions. Inspect headline holds, shot boundaries, both sides of trims and both platform layouts. A few thumbnail samples do not prove every frame is clean.
4. Entire sequences plus individual changed shots. Watch the last seconds of each generated shot; unexpected inserts often occur there. For a loop, export a short tail+head preview and inspect/listen across the seam.
5. Music presence and narration intelligibility in the actual final file. Automated “music present” judgments are evidence to investigate, not grounds to override direct user listening.

Deliver the final MP4s, matching SRT (separate files if timing differs), thumbnail/cover, platform-appropriate title and description, and music credits/license information where needed. Titles should make the specific story compelling without exaggerating the evidence. Include a full-game link when available and describe cinematic reenactments honestly. Keep descriptions ready to paste, with relevant hashtags and any required music attribution.

Retain a small package manifest: source game/audience, thesis, storyboard, accepted/rejected assets, generation receipts, edit intervals, music provenance, output paths/hashes, and verification results. New edits get new output versions; preserve the last delivered package. Provide clickable artifact links. Do not claim a file exists until it is saved and checked. Do not publish unless explicitly instructed.
