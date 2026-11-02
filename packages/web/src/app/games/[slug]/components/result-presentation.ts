import type {PresentationCue, ReplayScene} from "./types";

/** Reading minimums are base-clock time, shared by viewer and exports. */
export function resultReadingMs(cue: PresentationCue): number | null {
  switch (cue.kind) {
    case "format_aggregate": return 8000;
    case "empowered_tally": case "empowered_tie": case "format_menu": case "format_selected":
    case "format_elimination": case "format_tiebreak": case "format_deciding_vote":
    case "endgame_elimination": case "endgame_winner": return 6000;
    case "house_bridge": return 3000;
    default: return null;
  }
}

/** Exact engine associations only. Historical unbound speech keeps its original position. */
export function withResultPresentation(cues: readonly PresentationCue[], scenes: readonly ReplayScene[], compactEmpower = true): PresentationCue[] {
  const result: PresentationCue[] = cues.map(cue => ({...cue, resultsPresentation: true, compactEmpower,
    baseDurationMs: Math.max(cue.baseDurationMs + (cue.source === "classic" && cue.houseSummary ? 2000 : 0), resultReadingMs(cue) ?? 0)}));
  for (let index = 0; index < result.length; index++) {
    const cue = result[index]!;
    if (cue.source !== "classic" || !cue.houseSummary) continue;
    const message = scenes[cue.sceneIndex]?.messages[cue.messageIndex];
    const association = message?.houseResult;
    if (!association) continue;
    const matches = result.slice(0,index).filter(candidate => (candidate.source === "endgame" ? candidate.resultEventSequence ?? candidate.canonicalSequence : candidate.canonicalSequence) === association.eventSequence
      && candidate.round === cue.round && (!compactEmpower || candidate.source !== "format" || !candidate.visualBallot && !candidate.voteSummary)
      && (candidate.source === "format" || candidate.source === "endgame")
      && ["empowered_tally", "empowered_tie", "format_selected", "format_elimination", "endgame_elimination", "endgame_winner"].includes(candidate.kind));
    // A rules-reveal stage is the final selected-format frame, not the preceding menu reveal.
    const candidates = matches.filter(candidate => candidate.kind !== "format_selected" || candidate.stage === "rules_reveal");
    if (candidates.length !== 1) continue;
    const target = candidates[0]!;
    if (target.source !== "format" && target.source !== "endgame") continue;
    result[index] = {...cue, houseResultCue: target, minimumDurationMs:resultReadingMs(target) ?? 6000, baseDurationMs: Math.max(resultReadingMs(target) ?? 6000, cue.baseDurationMs)};
    // Preserve both source keys. Only adjacent new MC speech shares the reveal entrance.
    if (association.authoringRevision === "results-mc-v1" && result[index-1]?.key === target.key) result[index-1] = {...target, baseDurationMs:500};
  }
  return result;
}
