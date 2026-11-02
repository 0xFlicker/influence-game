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
