---
title: "Werewolf music exploration — Lantern Village"
date: 2026-10-04
status: audition
---

# Werewolf music — first phase studies

The operator authorized local MiniMax-Music3 generation and asked to explore a whole-game soundtrack, including the trailer. This is a listening session, not implementation of game audio or approval of a production score.

## Direction and source

Rustic chamber folk: plucked lute/dulcimer, bowed viola/low strings and restrained wooden/frame-drum percussion. Warm social spaces become sparse and cold at night. Instrumental prompts request no vocals. A descending three-note minor motif is requested across cues, but text prompting alone does not guarantee a shared melody; audition continuity before claiming thematic consistency.

Runtime: `/Users/user/Development/minimax-music3-mlx`, existing Python virtual environment and converted `weights/mlx` (approximately 22 GB). Uses local MLX inference with the existing weights, offline Hugging Face/Transformers mode, 30 flow-matching steps, one model loaded and sequential cues. No remote model service or Suno operation.

Artifacts, exact prompts, seeds, runner, per-cue receipts and log:
`.renders/werewolf-music/lantern-village-v1/`.
Original WAVs remain intact. Listening previews use common loudness treatment and a short end fade; those are not final loop masters.

## Cue map

| Study | Intended moment | Musical brief |
| --- | --- | --- |
| Lanterns at the Door | Casting / introductions | Warm, curious, gently uneasy arrival |
| Around the Table | Day discussion | Sparse, steady accompaniment with space beneath words |
| Names on the Table | Voting / decision | Measured pulse and restrained mounting pressure |
| Behind the Shutters | Pack / night actions | Low intimate tension; no literal howls or identity signals |
| The Unopened Door | Dawn / night resolution; possible neutral draw treatment | Fragile uncertainty without prematurely signalling survival or loss |
| Lanterns Still Burning | Village victory | Earned relief; modest warm resolution |
| No Lights in the Square | Wolf victory | Quiet dark resolution rather than cartoon villain fanfare |
| Before the Last Lantern | Trailer | Exposed motif, build, brief breath and concise ending |

Seven requested 12-second sketches and one 20-second trailer sketch. Actual durations and processing statistics are recorded from generated waveforms, rather than inferred from the requested limit.

## Listening questions

- Does the palette feel like a rustic village rather than fantasy spectacle or a resort?
- Does discussion music support reading instead of demanding attention?
- Does voting add pressure without becoming tiring over a long phase?
- Is night distinct without jump scares, howls, vocals or premature outcome signals?
- Are both endings satisfying while still belonging to the same world?
- Which short motifs deserve longer variations, and which should be discarded?

Prompt descriptions and signal checks are not perceptual approval. The operator listening review decides quality, unwanted vocals and direction. No claim of in-picture audition until the cues are actually paired with a rough cut.

## Future player integration constraints

- One music transport follows canonical phase/outcome boundaries; do not restart music for every speaker, dialogue page or thinking beat.
- Mystery and Omniscient can have audience-appropriate mappings. Mystery must not learn pack actions, protection or attack success from cue selection before those facts are available.
- Keep dawn ambiguous until the public result. Victory cues require a known terminal result. Draw/cancellation must not imply a faction win.
- Build longer loopable phase beds, separate transition/end stings, and intentional crossfades after selecting the musical direction. These short samples are not certified seamless loops.
- Audio controls, mute/volume persistence, browser autoplay handling and seek/resume semantics require a focused implementation pass. Do not introduce surprise autoplay sound as part of these experiments.
- W5 should audition the trailer cue to actual picture, then approve the selected music/version with its source/use provenance. Local MiniMax and human-operated Suno remain distinct available lanes.

## First batch receipt

All eight local generations completed. Seven clips are 12.005 seconds and the trailer is 20.016 seconds; the listening reel is 111.049 seconds including one-second gaps. Summed inference time was 402.52 seconds. Peak MLX allocation was 28.79 GB for the short cues and 33.68 GB for the trailer; the generation process exited and released the model.

All sources are finite, non-silent, stereo 44.1 kHz audio. Several original exports contain a very small fraction of full-scale samples (maximum 0.00482%); normalization cannot undo original saturation, so listen for transient distortion before promoting these sketches. Preview WAVs have no full-scale samples. Loudness-targeted previews aim for -20 LUFS with short fades; actual measurements are in `audio-checks.json`. These are signal checks, not a listening-quality verdict.

Open `.renders/werewolf-music/lantern-village-v1/index.html` for the full reel and individual players. `audition-reel.mp3` runs arrival, discussion, vote, night, dawn, village victory, wolf victory, then trailer. Original WAVs and preview MP3s are retained beside their prompt/seed receipts.

## Operator listening review and second panel

The first panel established contrasts, but not a finished musical identity. Arrival had shrill flute and punchy horns. Discussion had unwanted vocalizations. Voting was too light; the operator wants consequential transition variants. Night sounded better suited to pleasant daytime listening. Dawn had a promising opening swell but too much continuation, with no strings preferred. Village victory was directionally right, including pan flute. Wolf victory and the TV-like trailer missed the intended direction.

Agreed signature palette: low breathy wooden/pan flute, plucked lute, sparse hammered dulcimer, frame/low hand drums and wooden knocks. Low bowed strings are reserved for danger; electric violin provides the wolves' amplified folk/metal edge. Exclude vocals, brass, shrill flute, orchestral sweeps and trailer booms. Hold electric guitar back for this audition.

Second panel: three 16-second studies in `.renders/werewolf-music/lantern-village-v2/` — village warmth, haunting night, and wolf celebration. Prompts request the same D–F–E–D phrase, but this is text conditioning, not a melody reference or a guarantee of identical notes. Listen before approving motif continuity. No player audio integration or production replacement.

Voting direction should distinguish continued discussion, elimination and subsequent night/end transitions using canonical results. Any anticipatory music must respect the audience's disclosure timing rather than spoil an unrevealed outcome.

Second-panel receipt: all three cues completed locally, each 16.010 seconds; reel 50.030 seconds including gaps. Summed inference time 217.66 seconds. All preview WAVs passed finite, non-silent, stereo 44.1 kHz checks with peaks below full scale. Original village and wolf exports contain small fractions of saturated samples (0.00779% and 0.03059%); audition for distortion before promoting either. No perceptual approval is implied by these checks. Model process has exited.

## Trailer audition — third panel

Operator requested 30-second local generations to seek trailer hooks, with selected WAVs potentially taken into human-operated Suno later. Three candidates in `.renders/werewolf-music/trailer-v3/`: **Lantern to Fang** (warm folk melody transforms into electric violin), **The Circle Closes** (haunting dulcimer and ritual percussion), and **Wolves at the Festival** (electric folk/metal energy from the opening). Each prompt asks for a complete thirty-second arc, a recurring hook, a contrasting passage and a deliberate ending.

Uses structured captions and instrumental section tags, with 30 diffusion steps unchanged. Longer duration gives more musical development; it does not increase denoising steps per window. Textual timestamps and motif instructions remain approximate conditioning. Exact prompts, seeds and original WAVs are preserved for selection and further development. No Suno operation or upload is performed.

The artifact runner materializes each vocoder window immediately using `mx.eval`, so longer clips need not retain all lazy waveform graphs until the final concatenation. It retains the installed pipeline's synthesis, carry and stitching behavior; no model repository or weights are modified. Signal validation and operator listening remain separate.

Third-panel receipt: three completed clips of 30.023 seconds, plus a 92.070-second reel with gaps. Summed inference time 382.09 seconds; peak MLX allocation 28.15 GB. All previews passed finite, non-silent stereo 44.1 kHz checks and have peaks below full scale. The first two source WAVs have no full-scale samples; the third has a 0.000982% full-scale sample fraction. These are signal checks only, not confirmation of prompt adherence or musical quality. Generation and preview processes exited successfully.

## One-minute development studies — fourth panel

Operator hearing of panel 03: Lantern to Fang suits introductions because both village and wolf feelings are present. The Circle Closes is closer to suspicious daytime. Wolves at the Festival heads in the right direction, but modern/electric drums intruded. Refine the violin's energy separately from percussion: acoustic skin-headed frame/hand drums, wooden rim knocks and foot stamps; violin carries the fast rhythm. Avoid power-metal genre wording that may invite a modern drum kit.

Operator requested four one-minute samples and exact style/lyrics prompts, explicitly as development studies rather than release candidates. Panel 04 is `.renders/werewolf-music/development-v4/index.html`: introductions (balanced folk/electric fusion), daytime (restrained suspicious groove), wolves (electric violin with acoustic skin percussion), and village victory (warm flute-led relief, a restrained clean-violin reply, no horror drone). Each card exposes both exact inputs, individual text downloads, original WAV and listening MP3. `prompts.md` collects the inputs; `prompts.json` and generation receipts retain seeds and settings.

The official model card documents up to five-minute songs: https://huggingface.co/MiniMaxAI/MiniMax-Music3 . The local config declares 9,000 frames (six minutes at 25 fps), but the local generation loop does not enforce that constant; neither fact proves five/six-minute viability on this Mac. Panel 04 requests 60 seconds (1,500 frames) per sample. EOS may end generation early. Per-window materialization from panel 03 is retained, with no source-model changes. Musical continuity across independently generated variants remains an audition question; a reused seed is not an audio reference.

Panel 04 completed: Lantern to Fang 60.070s, The Circle Closes 60.070s, Wolves at the Festival 59.350s, Lanterns Still Burning 60.070s. Full reel 242.560s with one-second gaps. Summed inference 1087.76s, peak MLX allocation 27.07 GB. All preview WAVs are finite, non-silent stereo 44.1 kHz with sample peaks below full scale; all local page links resolve. Original full-scale sample percentages: 01-lantern-to-fang 0.000000%, 02-the-circle-closes 0.002435%, 03-wolves-at-the-festival 0.001509%, 04-lanterns-still-burning 0.000151%. This does not establish listening quality or absence of audible artifacts. Both processes exited successfully; model memory released. One-minute local operation is now demonstrated, not the full five-minute model limit.

## Selected v1 cuts and regeneration — fifth panel

Operator feedback on panel 04: Lantern to Fang needs another attempt; Circle should return to the exact panel-03 dark ritual prompt (92 BPM, low dulcimer and bowed-string tension). Keep the first 16 seconds of Wolves at the Festival as a v1 cut and the first 25 seconds of Lanterns Still Burning; the latter becomes excessive and develops audible generation artifacts afterward.

The two selected masters are in `.renders/werewolf-music/selected-v1/`, with cut ranges, source file hashes, original prompts and sample counts. Cuts preserve original PCM samples exactly, with no regeneration or modification to the full source files. Listening previews may apply fades/loudness processing; the WAV masters remain exact edits.

Panel 05 `.renders/werewolf-music/development-v5/index.html` combines those cuts with two new generations. Lantern gets a revised simpler folk/electric introduction prompt and new seed. Circle restores panel 03 exact style prompt, lyrics tags and seed, changing only the duration ceiling from 30 to 60 seconds. The old thirty-second arrangement remains in the prompt intentionally, honoring the operator's pasted preferred prompt. End-of-audio may still stop early. This is a text/seed reuse, not waveform-reference conditioning. Preserve exact inputs and assess the rendered result.

Panel 05 completed. Lantern to Fang ended at 49.459 seconds; Circle reached 60.070 seconds. The selected cuts are exactly 16 and 25 seconds. Source PCM16 verification proves both masters and page WAV copies equal the requested panel-04 opening samples. Circle's first 20 seconds equal the preferred panel-03 original PCM16 samples exactly (correlation 1.0, RMSE 0); `circle-reference-check.json` records the check. This establishes opening continuity, not a listening verdict for the rest. Full reel is 153.529 seconds including gaps. All previews passed finite, non-silent stereo 44.1 kHz and below-full-scale peak checks. Original Circle has a tiny full-scale sample fraction, recorded in `audio-checks.json`; the other three sources do not. All page references resolve. Generation and preview processes exited successfully.

## Four selected v1 cuts

Operator selected panel-05 Lantern to Fang 0–31 seconds and The Circle Closes 0–24 seconds. These join the existing panel-04 Wolves at the Festival 0–16 seconds and Lanterns Still Burning 0–25 seconds in `.renders/werewolf-music/selected-v1/index.html`. No model generation was run. All four WAV cuts were verified sample-for-sample against their source openings; existing wolves/victory masters retained their hashes. Source hashes, ranges, frame counts, style/lyrics prompts, previews and the combined 99-second reel are retained in the selected folder. Listening previews have fades and loudness treatment; exact cut WAVs do not. This selection does not imply release-candidate status or game audio integration.

## Operator's Suno best picks

The operator supplied `.renders/werewolf-music/suno-results-v1/` as the current best picks: Lantern to Fang (introductions), The Circle Closes (daytime/suspicion), Wolves at the Festival (wolf theme), and Lanterns Still Burning (village victory). These Suno files are preferred source selections beyond the local MiniMax audition cuts. They remain unchanged. All four are 48 kHz stereo PCM16 WAVs with embedded Suno creation IDs. Exact Suno generation prompts/settings were not supplied; earlier local prompts must not be represented as those final prompts.

`.renders/werewolf-music/suno-picks-v1/index.html` collects the supplied files; its manifest records hashes, durations and embedded metadata. The operator explicitly confirms **we do not have a trailer**. Earlier trailer experiments became gameplay themes; W5 trailer music remains open. Proposed next composition: one motif moving from village welcome through suspicion into a controlled electric-violin wolf reveal, steady acoustic percussion, and an unresolved ending. This proposal has no generated or approved trailer attached. No game integration or publication occurred.

## Suno trailer source supplied

The operator added `.renders/werewolf-music/suno-picks-v1/trailer-v1.wav`. This supersedes the missing-trailer-source status above: a 177.96-second (2:58), 48 kHz stereo PCM16 Suno source is now available on the listening page beside the four game themes. Embedded Suno ID: `3bbd6b54-06d5-45a0-855a-d462b4b3b862`. The manifest records its hash and metadata; the original WAV is unchanged. Exact generation inputs remain unknown. Selecting the trailer excerpt and editing it to picture remain W5 work; source availability is not a finished trailer or game integration.

## Initial trailer front cut

Operator requested a lightweight first implementation cut from the front. The initial music edit uses source seconds 0–45, with a 1.5-second fade out, in `suno-picks-v1/trailer-front-45s-v1.wav`. The listening page now plays this edit and retains a download of the full original. Verified exact 45-second stereo 48 kHz output, unchanged PCM through the first 43 seconds, and unchanged source hash. No rearrangement, generation, or game integration; editing to picture remains outstanding.

## Source-use correction and W5 handoff

The operator clarified that “cut from the front” means using the supplied full songs from time zero and trimming as needed by the consuming trailer or scene. The 45-second export was an assistant-chosen exploration, not an approved required length or integration source. Use the original `suno-picks-v1/trailer-v1.wav` for W5 and let the picture determine duration. The full four game themes remain available for a subsequent shared-player music slice. See [the focused W5 plan](../plans/2026-10-05-001-feat-werewolf-trailers-release-assets.md).
