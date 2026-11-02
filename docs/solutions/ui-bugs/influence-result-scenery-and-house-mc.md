---
module: Influence viewer
problem_type: ui_bug
tags: [replay, house-narration, results, studio, backwards-compatibility]
---

# Keep House announcements on the result stage

House summary text used to replace the result with a separate dark stage. Hiding that text when a recording supplied captions could remove the entire visual segment.

Keep scenery independent of caption visibility. The new result composition attaches the exact resolved result to the summary's existing cue, retaining transcript/audio identity. Only an adjacent newly authored MC announcement shortens its preceding result to an entrance; historical speech stays at its accepted position. Active live cues retain their duration when metadata arrives. A result selected alone in Studio regains its reading minimum.

The House receives canonical `resultFocus`, including the format's scoring rule, at the existing summary boundary. The prompt requests decisive facts plus one grounded sentence, with natural variation. The existing strict response schema, null outcome, provider policy, and private notebook are unchanged. Do not infer facts from prose or add a second commentary call.

Historical association recovery requires the summary's committing turn, its accepted narrative boundary, its exact dialogue sequence, and one matching canonical result in that turn. A canonical head or shared round alone is insufficient. Only the small association reaches the public DTO; private turn state does not. No accepted transcript, recording, event, or provider body is rewritten.

Production snapshot version 6 opts fresh cuts into the composition. Versions 3–5 retain their original timing and visuals. The [deployment runbook](../../deployment/influence-results-mc-cutover.md) requires all in-progress games to finish before the prompt update.

Text panels must provide an actual reading height to `TimedSpeech`. An unconstrained content-height panel collapses its measurement allowance and can paginate a short sentence into individual characters. Keep a bounded responsive reading area and verify the rendered layout in a browser, not only with DOM tests.

Validation covers exact and ambiguous associations, historical speech, recorded minimums, Studio result-only selection, frozen composition versions, scenery with suppressed captions, image failure, and explicit text recovery. Real LLM voice quality remains a separate authorized localhost API evaluation.

## Compact Empower follow-up

Ballot expansion copies the tally cue's kind and canonical sequence into individual vote shots and the ballot-complete frame. Matching by event and kind alone therefore made a legitimate Empower result association ambiguous. Current composition excludes `visualBallot` and `voteSummary` copies when selecting the result; it keeps their preceding ballot evidence intact. A browser regression follows initial votes, the compact tie, its House speech, runoff ballots, and the compact winner at desktop and mobile widths.

Result cards show only the winner/tied cast, their counts, and combined other votes. The separate `empower_runoff` House boundary commits after the initial tie and before runoff ballots. Its facts include eligible revoters and the applicable next step; final narration still uses the frozen revote counting rule. Old games gain compact playback but no fabricated retrospective speech. Fresh exports use composition v7; pinned v3–v6 remain unchanged.

Current House result messages use a bounded in-flow box with a centered overlapping logo and at least one text line. Native wrapping determines page boundaries, and pages follow the playback speech clock. The same box remains during recorded audio without a duplicate floating caption. A 12-way tie uses one portrait/name grid with a shared count instead of repeated portrait and total lists. Wide short stages place the caption beside the grid; portrait stages place it below. Short watch pages hide the redundant banner, outside cast strip, and footer while this result is visible. Desktop/mobile browser tests cover eight sizes in inline and theater modes, including 320×568, 480×480, and 1280×400, and verify page advancement without hiding the cast. Frozen v3–v6 export layouts retain their original caption treatment.


## Shared layout audit (November 1 follow-up)

- `HouseResultLayout` owns the measured stacked/side-by-side split for current Influence result speech and live Werewolf House cues. `HouseMessage` owns the overlapping logo, readable minimum, native wrapping and pagination. Recorded Werewolf speech supplies recording progress; unrecorded speech uses the director's normalized reading clock. Caption visibility does not remount the scene at audio start/end.
- Standalone current Influence House speech also uses that message box and a lobby backdrop when the beat has no saved scenery. The remaining live recorded overlay uses the same box. Title-only entrances retain their animation.
- Generic current format result casts and canonical result casts use compact portrait/name cells. Empower retains its winner/tied-only counts; ballot evidence remains in the preceding reveal. Two Names and Safety Bounce retain their dedicated semantic boards and actor choreography.
- Werewolf vote/night outcomes retain the victim identity above the shared caption, including when artwork is absent. Night-action scenes no longer reserve space twice for the former floating narration. The live final cast uses one compact grid with each audience-permitted role, winner status and survival/elimination day instead of shrinking two long lists. Frozen exports retain the historical renderer.
- Influence's winner tableau already uses container-responsive artwork and standings. Its desktop/mobile regression remains covered; its secondary jury list can still scroll. This follow-up does not claim that every detailed ballot ledger or final standings panel fits arbitrary heights without scrolling.

Validation covers the twelve-way Empower tie at eight sizes in inline/theater modes, Werewolf vote results at four small/short sizes in both modes, the Werewolf closing cast, and existing Influence final-tableau desktop/mobile checks. Keep the tests measuring rendered bounds after ResizeObserver settles; static markup cannot prove fit.
