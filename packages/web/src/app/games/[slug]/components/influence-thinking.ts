import type { PublicWatchIntelligenceCard } from "@/lib/api";
import type { PresentationCue } from "./types";
import type { VisualPresentationBeat } from "./visual-presentation";

const TIEBREAK_ACTIONS = new Set(["format-tiebreak", "format-two-names-tiebreak"]);

/** A resolution reveals several decisions; the cue owns which one is thinking. */
export function influenceThinkingActor(cue: PresentationCue | null, beat: VisualPresentationBeat | null): string | null {
  if (beat?.kind === "portrait" && (beat.purpose === "Ballot" || beat.thinkingAllowed === false)) return null;
  if (cue?.source === "format") {
    if (cue.kind === "format_tiebreak" && !cue.decisionSpeechEntry) return null;
    if (cue.kind === "format_deciding_vote" || cue.voteSummary) return null;
  }
  return beat && "speech" in beat ? beat.speech?.playerId ?? null : null;
}

export function influenceThinkingText(cards: readonly PublicWatchIntelligenceCard[], cue: PresentationCue, actorId: string, messageId?: string | number): string | null {
  const tiebreak = cue.source === "format" && cue.kind === "format_tiebreak";
  if (cue.decisionSpeechEntry) return cards.filter(card => card.actorPlayerId === actorId && card.id === `transcript:${cue.decisionSpeechEntry!.id}`).map(card => card.text).join("\n\n") || null;
  return cards.filter(card => card.actorPlayerId === actorId && (cue.source === "classic"
    ? card.id === `transcript:${messageId}`
    : card.eventSequence === cue.canonicalSequence
      && (tiebreak ? TIEBREAK_ACTIONS.has(card.action ?? "") : !TIEBREAK_ACTIONS.has(card.action ?? ""))))
    .map(card => card.text).join("\n\n") || null;
}
