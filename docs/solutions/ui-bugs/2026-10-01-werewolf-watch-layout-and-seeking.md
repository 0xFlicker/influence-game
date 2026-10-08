---
module: House watch player
problem_type: ui_bug
tags: [werewolf, playback, responsive-layout, thinking, votes]
---

# Full-body composition and persistent playback intent

Full-body solo presentation reserves independent image, speech, and thinking regions. Wide stages place thinking left, art in the middle, and speech right. Portrait stages pair smaller body art with thinking above full-width speech. Both obey the controls/ledger inset. Thought trails scale their circle count with the distance to the character, grow toward the thought bubble, and let the largest circle overlap its edge. The two smallest circles nearest the character are omitted; full-body trails aim beside the upper head using the recorded head bounds, leaving the face clear. Bubble pagination and thought visibility do not resize the reserved art region. Shared Influence solo reveals use this same layout.

Werewolf seeks retain the viewer's play/pause intent independently of the director's temporary pause during network preparation. A newer seek supersedes older requests; toggling pause while preparing changes the eventual playback state. Explicit Go Live still opts into following. Hiding the page pauses intent.

The vote result card is centered. Deliberate null ballots remain **Hear more** in the visual tally and **Abstain (hear more)** in the receipt. A provider failure remains **Unavailable**; never reinterpret it as a player choice.

Read-only diagnosis of `wild-lemon-sun` found repeated `max_output_tokens` failures in vote attempts, consistent with its canonical unavailable ballots. This is a model-output budget issue, not a tally-label bug. Existing history is unchanged. Model budgeting is outside this presentation fix; any follow-up must preserve exact structured ballot validation.

Validation: geometry tests cover wide, portrait, short landscape and ledger layouts; browser journeys cover seek while playing/paused, overlapping seeks and silent live windows. The mobile site footer uses two columns for its four link sections.

Verified locally: 2,183 provider-free tests passed (5 skipped), 1,827 PostgreSQL tests passed, all six Werewolf browser journeys passed, and the final delayed-seek refinement passed its two selected browser journeys. Repository typecheck/lint passed. Manual browser checks covered full-body thinking plus speech on wide and mobile screens, both scrub playback states, and the 2×2 mobile footer. No paid provider calls were made and no development game records were altered.

The shared transport is one responsive row with play/pause, previous/next group, position, optional Go Live, settings and fullscreen. Its scrubber sits directly below for both games. Speed, thinking, and thinking order move progressively from settings into the bar at 780px, 1020px, and 1280px of actual player width; each control has one visible location. Restart/end actions and shortcut help stay in settings. Contribution stepping remains on the arrow keys and scene click; it no longer consumes toolbar space.

Werewolf no longer has a separate control strip above the scene. Settings owns its fixed viewing-mode label, Transcript action, and permission-gated Stop game action. Thinking uses the same adaptive transport controls as Influence.

Compact-control verification: 2,183 provider-free tests passed (5 skipped), and repository typecheck/lint passed. Five browser journeys passed together; the pack audience-switch check timed out once and passed in isolation on rerun. Manual checks confirmed mobile has one 40px control row with no horizontal overflow, fullscreen exposes all three adaptive options, settings retains choices after resizing, Transcript opens inside fullscreen, and Influence scrubbing retains a paused state. Restored only browser-generated Next configuration files after the harness run.

## Browser coverage after the opening sequence (2026-10-08)

Recorded Werewolf cursors and player scrub positions are different coordinates. The opening adds House, title, one stop per cast member, and door stops before the recorded moments. Browser helpers must include that offset when seeking and checking the slider range. A deep link into a later window has no opening until window 1 is loaded, so the helper checks the windows actually requested by that viewer session. Do not derive the offset from the slider's current maximum: that would hide an incorrect range.

Tests of recorded gameplay should explicitly skip the opening instead of waiting for it to finish; its duration grows with the cast. Opening coverage separately checks Mystery role suppression, Omniscient role labels, paused title/cast/door stops, skipping, and Previous returning from the first recorded moment to the door. Delayed-seek tests must keep their requests in recorded play rather than accidentally seeking back into the opening and mistaking the intentional stage switch for a remount regression.

Producer fixtures must select the intended scene preview. The first expandable control can belong to a pack scene with no published panels; it is not necessarily the fixture's village scene.
