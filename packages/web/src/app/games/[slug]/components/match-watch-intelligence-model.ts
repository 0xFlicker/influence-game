import type {
  PhaseKey,
  PublicWatchIntelligenceCard,
  PublicWatchIntelligenceCardContext,
  PublicWatchIntelligenceReceipts,
  PublicWatchIntelligenceResult,
  PublicWatchIntelligenceSectionStatus,
  RevealedFactsStatus,
  TranscriptEntry,
} from "@/lib/api";
import { PHASE_LABELS } from "./constants";
import type { MatchWatchModel } from "./match-watch-model";

export type MatchWatchIntelligenceLoadState = "idle" | "loading" | "ready" | "error";

export interface MatchWatchIntelligenceCardModel {
  id: string;
  title: string;
  body: string;
  meta: string;
  context: PublicWatchIntelligenceCardContext;
}

export interface MatchWatchIntelligenceSectionModel {
  status: PublicWatchIntelligenceSectionStatus;
  cards: MatchWatchIntelligenceCardModel[];
  reason?: string;
}

export interface MatchWatchReceiptLine {
  label: string;
  value: string;
}

export interface MatchWatchReceiptsModel {
  status: "available" | "unavailable";
  lines: MatchWatchReceiptLine[];
  reason?: string;
}

export interface MatchWatchIntelligenceModel {
  loadState: MatchWatchIntelligenceLoadState;
  overview: MatchWatchIntelligenceSectionModel;
  thinking: MatchWatchIntelligenceSectionModel;
  strategy: MatchWatchIntelligenceSectionModel;
  receipts: MatchWatchReceiptsModel;
}

const INTELLIGENCE_PHASE_ORDER: readonly PhaseKey[] = [
  "INIT",
  "INTRODUCTION",
  "LOBBY",
  "MINGLE_I",
  "PRE_VOTE_HUDDLE",
  "VOTE",
  "MINGLE",
  "POST_VOTE_MINGLE",
  "WHISPER",
  "RUMOR",
  "POWER",
  "REVEAL",
  "PRE_COUNCIL_HUDDLE",
  "COUNCIL",
  "DIARY_ROOM",
  "PLEA",
  "ACCUSATION",
  "DEFENSE",
  "OPENING_STATEMENTS",
  "JURY_QUESTIONS",
  "CLOSING_ARGUMENTS",
  "JURY_VOTE",
  "SUSPENDED",
  "END",
];

const INTELLIGENCE_PHASE_RANKS = new Map(
  INTELLIGENCE_PHASE_ORDER.map((phase, index) => [phase, index]),
);

const STRATEGIC_LENS_LABELS: Readonly<Record<string, string>> = {
  vote_math: "Vote Math",
  room_traffic: "Room Traffic",
  promise_debt: "Promise Debt",
  power_position: "Power Position",
  private_inconsistency: "Private Inconsistency",
  coalition_geometry: "Coalition Geometry",
  information_control: "Information Control",
  jury_threat: "Jury Threat",
  loyalty_stress: "Loyalty Stress",
  retaliation_risk: "Retaliation Risk",
  social_cover: "Social Cover",
  timing_pattern: "Timing Pattern",
  presentation_read: "Presentation Read",
  relationship_repair: "Relationship Repair",
  broad_read: "Broad Read",
};

export function buildMatchWatchIntelligenceModel({
  model,
  intelligence,
  visibleMessages,
  loadState,
  error,
}: {
  model: MatchWatchModel;
  intelligence: PublicWatchIntelligenceResult | null;
  visibleMessages: readonly TranscriptEntry[];
  loadState: MatchWatchIntelligenceLoadState;
  error?: string | null;
}): MatchWatchIntelligenceModel {
  const selected = model.selectedPlayer;
  const server = isCurrentIntelligence(intelligence, model) ? intelligence : null;
  const serverThinking = server?.intelligence.thinking.cards ?? [];
  const serverStrategy = server?.intelligence.strategy.cards ?? [];
  const localThinking = selected
    ? transcriptThinkingCards(visibleMessages, selected.player.id, model.round, model.phase)
    : [];

  const thinkingCards = dedupeCards([...serverThinking, ...localThinking]);
  const strategyCards = dedupeCards(serverStrategy);
  const overviewCards = buildOverviewCards(model);

  return {
    loadState,
    overview: {
      status: selected ? "available" : "select_player",
      cards: overviewCards,
      ...(!selected && { reason: "Select a player to inspect their read." }),
    },
    thinking: cardsSection({
      cards: thinkingCards,
      fallbackStatus: server?.intelligence.thinking.status,
      fallbackReason: server?.intelligence.thinking.reason,
      emptyReason: selected
        ? loadState === "loading"
          ? "Loading thinking..."
          : error ?? "No thinking has been captured for this player yet."
        : "Select a player to inspect their thinking.",
    }),
    strategy: cardsSection({
      cards: strategyCards,
      fallbackStatus: server?.intelligence.strategy.status,
      fallbackReason: server?.intelligence.strategy.reason,
      emptyReason: selected
        ? loadState === "loading"
          ? "Loading strategy..."
          : error ?? "No strategy notes have been captured for this player yet."
        : "Select a player to inspect their strategy.",
    }),
    receipts: buildReceiptsModel(server?.intelligence.receipts, loadState, error),
  };
}

function isCurrentIntelligence(
  intelligence: PublicWatchIntelligenceResult | null,
  model: MatchWatchModel,
): intelligence is Extract<PublicWatchIntelligenceResult, { ok: true }> {
  if (!intelligence?.ok || !model.selectedPlayerId) return false;
  return (
    intelligence.context.selectedPlayerId === model.selectedPlayerId &&
    intelligence.context.round === model.round &&
    intelligence.context.phase === model.phase
  );
}

function buildOverviewCards(model: MatchWatchModel): MatchWatchIntelligenceCardModel[] {
  const selected = model.selectedPlayer;
  return [
    {
      id: "selected-state",
      title: selected ? selected.player.name : "No Agent Selected",
      body: selected
        ? `${selected.player.name} is ${selected.statusLabel.toLowerCase()} in ${model.roundLabel.toLowerCase()}.`
        : "Select an agent from the cast to inspect their thinking, strategy, and receipts.",
      meta: model.phaseLabel,
      context: "current_phase",
    },
    {
      id: "latest-message",
      title: "Visible Beat",
      body: model.latestPublicMessage?.text ?? "No visible messages yet.",
      meta: model.phaseLabel,
      context: "recent",
    },
  ];
}

function transcriptThinkingCards(
  messages: readonly TranscriptEntry[],
  actorPlayerId: string,
  round: number,
  phase: PhaseKey,
): PublicWatchIntelligenceCard[] {
  return messages
    .filter((message) => {
      const thinking = typeof message.thinking === "string" ? message.thinking.trim() : "";
      return (
        message.fromPlayerId === actorPlayerId &&
        message.scope !== "thinking" &&
        thinking.length > 0 &&
        isAtOrBeforeReplayContext(message.round, message.phase, round, phase)
      );
    })
    .map((message) => ({
      id: `visible-transcript:${message.id}`,
      kind: "thinking" as const,
      source: "transcript" as const,
      actorPlayerId,
      title: "Visible Thought",
      text: message.thinking?.trim() ?? "",
      context: contextPrecision(message.round, message.phase, round, phase),
      round: message.round,
      phase: message.phase,
      action: "message",
    }));
}

function dedupeCards(cards: PublicWatchIntelligenceCard[]): MatchWatchIntelligenceCardModel[] {
  const seen = new Set<string>();
  return cards
    .filter((card) => {
      const key = `${card.kind}:${card.actorPlayerId}:${card.round ?? ""}:${card.phase ?? ""}:${card.text.trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const contextDiff = contextRank(a.context) - contextRank(b.context);
      if (contextDiff !== 0) return contextDiff;
      return (b.eventSequence ?? 0) - (a.eventSequence ?? 0);
    })
    .map(cardModel);
}

function cardModel(card: PublicWatchIntelligenceCard): MatchWatchIntelligenceCardModel {
  return {
    id: card.id,
    title: card.title,
    body: cardBody(card),
    meta: cardMeta(card),
    context: card.context,
  };
}

function cardBody(card: PublicWatchIntelligenceCard): string {
  if (card.title === "Strategic Lens") {
    return strategicLensLabel(card.text);
  }
  return card.text;
}

function strategicLensLabel(value: string): string {
  const trimmed = value.trim();
  return STRATEGIC_LENS_LABELS[trimmed] ?? titleCaseIdentifier(trimmed);
}

function titleCaseIdentifier(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function cardMeta(card: PublicWatchIntelligenceCard): string {
  const parts = [
    card.round !== undefined ? `R${card.round}` : null,
    card.phase ? phaseLabel(card.phase) : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" / ");
}

function phaseLabel(phase: string): string {
  return phase in PHASE_LABELS ? PHASE_LABELS[phase as PhaseKey] : phase;
}

function contextPrecision(
  rowRound: number,
  rowPhase: PhaseKey,
  round: number,
  phase: PhaseKey,
): PublicWatchIntelligenceCardContext {
  if (rowRound === round && rowPhase === phase) return "current_phase";
  if (rowRound === round) return "current_round";
  return "recent";
}

function isAtOrBeforeReplayContext(
  rowRound: number,
  rowPhase: PhaseKey,
  contextRound: number,
  contextPhase: PhaseKey,
): boolean {
  if (rowRound < contextRound) return true;
  if (rowRound > contextRound) return false;
  if (rowPhase === contextPhase) return true;
  return phaseRank(rowPhase) <= phaseRank(contextPhase);
}

function phaseRank(phase: PhaseKey): number {
  return INTELLIGENCE_PHASE_RANKS.get(phase) ?? Number.POSITIVE_INFINITY;
}

function contextRank(context: PublicWatchIntelligenceCardContext): number {
  switch (context) {
    case "current_phase":
      return 0;
    case "current_round":
      return 1;
    case "recent":
      return 2;
  }
}

function cardsSection({
  cards,
  fallbackStatus,
  fallbackReason,
  emptyReason,
}: {
  cards: MatchWatchIntelligenceCardModel[];
  fallbackStatus?: PublicWatchIntelligenceSectionStatus;
  fallbackReason?: string;
  emptyReason: string;
}): MatchWatchIntelligenceSectionModel {
  if (cards.length > 0) {
    return {
      status: "available",
      cards,
    };
  }
  return {
    status: fallbackStatus ?? "unavailable",
    cards: [],
    reason: fallbackReason ?? emptyReason,
  };
}

function buildReceiptsModel(
  receipts: PublicWatchIntelligenceReceipts | undefined,
  loadState: MatchWatchIntelligenceLoadState,
  error?: string | null,
): MatchWatchReceiptsModel {
  if (!receipts) {
    return {
      status: "unavailable",
      lines: [],
      reason: loadState === "loading"
        ? "Loading canonical receipts..."
        : error ?? "Canonical receipts are not available yet.",
    };
  }

  const facts = receipts.canonicalGameFacts.roundFacts;
  const availability = receipts.canonicalGameFacts.availability;
  return {
    status: receipts.status,
    lines: [
      { label: "Canonical Facts", value: titleCaseStatus(availability.canonicalFactsStatus) },
      { label: "Standard Vote", value: titleCaseStatus(facts.standardVote.status) },
      { label: "Power", value: titleCaseStatus(facts.power.status) },
      { label: "Council", value: titleCaseStatus(facts.council.status) },
    ],
    ...(receipts.reason && { reason: receipts.reason }),
  };
}

function titleCaseStatus(status: RevealedFactsStatus | string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
