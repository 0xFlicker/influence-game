import type { PostgameAnalysisProjection } from "../postgame-analysis";
import type { HouseHighlightDeepLink } from "./types";

export function fallbackProofLinks(analysis: PostgameAnalysisProjection): HouseHighlightDeepLink[] {
  return [
    {
      surface: "results",
      label: "Open full results",
      round: null,
      anchor: "results",
    },
    ...(analysis.summary.roundCount > 0
      ? [{
        surface: "replay" as const,
        label: "Open replay",
        round: 1,
        anchor: "replay",
      }]
      : []),
  ];
}

export function resultsLink(round: number | null, label: string, anchor?: string): HouseHighlightDeepLink {
  return {
    surface: "results",
    label,
    round,
    anchor: anchor ?? (round === null ? "jury" : `round-${round}`),
  };
}
