import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
} from "drizzle-orm";
import {
  buildRevealedRoundFacts,
  type RevealedRoundFactsRead,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { CognitiveArtifactType, GameStatus } from "../db/schema.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { getPersistedGameProjection } from "./game-projection-read-model.js";
import { getGameWatchState } from "./game-watch-state.js";

type PublicWatchIntelligenceDB = Pick<DrizzleDB, "select">;
type ArtifactRow = typeof schema.gameCognitiveArtifacts.$inferSelect;
type TranscriptRow = typeof schema.transcripts.$inferSelect;

export type PublicWatchIntelligenceSectionStatus =
  | "available"
  | "select_player"
  | "unavailable";

export type PublicWatchIntelligenceCardKind = "thinking" | "strategy";
export type PublicWatchIntelligenceCardSource = "cognitive_artifact" | "transcript";
export type PublicWatchIntelligenceCardContext = "current_phase" | "current_round" | "recent";

export interface PublicWatchIntelligenceCard {
  id: string;
  kind: PublicWatchIntelligenceCardKind;
  source: PublicWatchIntelligenceCardSource;
  actorPlayerId: string;
  title: string;
  text: string;
  context: PublicWatchIntelligenceCardContext;
  round?: number;
  phase?: string;
  action?: string;
  eventSequence?: number;
  createdAt?: string;
}

export interface PublicWatchIntelligenceSection {
  status: PublicWatchIntelligenceSectionStatus;
  cards: PublicWatchIntelligenceCard[];
  reason?: string;
}

export interface PublicWatchIntelligenceReceipts {
  status: "available" | "unavailable";
  canonicalGameFacts: RevealedRoundFactsRead;
  reason?: string;
}

export interface PublicWatchIntelligenceGame {
  id: string;
  slug?: string;
  status: GameStatus;
}

export interface PublicWatchIntelligenceContext {
  selectedPlayerId?: string;
  selectedPlayerName?: string;
  round: number;
  phase: string;
  source: string;
}

export type PublicWatchIntelligenceResult =
  | {
      ok: true;
      schemaVersion: 1;
      game: PublicWatchIntelligenceGame;
      context: PublicWatchIntelligenceContext;
      intelligence: {
        thinking: PublicWatchIntelligenceSection;
        strategy: PublicWatchIntelligenceSection;
        receipts: PublicWatchIntelligenceReceipts;
      };
    }
  | {
      ok: false;
      status: "not_found";
      error: string;
    };

export interface PublicWatchIntelligenceParams {
  gameIdOrSlug: string;
  actorPlayerId?: string;
  round?: number;
  phase?: string;
  limit?: number;
}

const DEFAULT_SECTION_CARD_LIMIT = 4;
const MAX_SECTION_CARD_LIMIT = 8;
const CARD_SCAN_MULTIPLIER = 12;
const MIN_CARD_SCAN_LIMIT = 48;
const PUBLIC_WATCH_PHASE_ORDER = [
  "INIT",
  "INTRODUCTION",
  "LOBBY",
  "MINGLE",
  "WHISPER",
  "RUMOR",
  "VOTE",
  "POWER",
  "REVEAL",
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
] as const;

const PUBLIC_WATCH_PHASE_RANKS = new Map(
  PUBLIC_WATCH_PHASE_ORDER.map((phase, index) => [phase, index]),
);

const STRATEGY_FIELDS: ReadonlyArray<{ key: string; title: string }> = [
  { key: "decisionLog", title: "Decision Log" },
  { key: "strategicLens", title: "Strategic Lens" },
  { key: "strategicLensRationale", title: "Lens Rationale" },
  { key: "strategyPacketSummary", title: "Strategy Packet" },
  { key: "strategicReflectionSummary", title: "Strategic Reflection" },
];

export async function getPublicWatchIntelligence(
  db: PublicWatchIntelligenceDB,
  params: PublicWatchIntelligenceParams,
): Promise<PublicWatchIntelligenceResult> {
  const watchState = await getGameWatchState(db, params.gameIdOrSlug);
  if (!watchState) {
    return {
      ok: false,
      status: "not_found",
      error: "Game not found",
    };
  }

  const selectedPlayer = params.actorPlayerId
    ? watchState.players.find((player) => player.id === params.actorPlayerId)
    : undefined;
  const contextRound = params.round ?? watchState.currentRound;
  const contextPhase = params.phase ?? watchState.currentPhase;
  const context: PublicWatchIntelligenceContext = {
    ...(params.actorPlayerId && { selectedPlayerId: params.actorPlayerId }),
    ...(selectedPlayer && { selectedPlayerName: selectedPlayer.name }),
    round: contextRound,
    phase: contextPhase,
    source: watchState.source,
  };

  const receipts = await buildPublicReceipts(db, watchState.gameId, contextRound);
  const limit = normalizeLimit(params.limit);

  if (!params.actorPlayerId) {
    return {
      ok: true,
      schemaVersion: 1,
      game: gameIdentity(watchState),
      context,
      intelligence: {
        thinking: selectPlayerSection(),
        strategy: selectPlayerSection(),
        receipts,
      },
    };
  }

  if (!selectedPlayer) {
    const reason = "Selected player is not in this game.";
    return {
      ok: true,
      schemaVersion: 1,
      game: gameIdentity(watchState),
      context,
      intelligence: {
        thinking: unavailableSection(reason),
        strategy: unavailableSection(reason),
        receipts,
      },
    };
  }

  const [artifactCards, transcriptCards] = await Promise.all([
    loadArtifactCards(db, {
      gameId: watchState.gameId,
      actorPlayerId: params.actorPlayerId,
      round: contextRound,
      phase: contextPhase,
      limit,
    }),
    loadTranscriptThinkingCards(db, {
      gameId: watchState.gameId,
      actorPlayerId: params.actorPlayerId,
      round: contextRound,
      phase: contextPhase,
      limit,
    }),
  ]);

  const thinkingCards = rankCards(
    [
      ...artifactCards.filter((card) => card.kind === "thinking"),
      ...transcriptCards,
    ],
    contextRound,
    contextPhase,
  ).slice(0, limit);
  const strategyCards = selectStrategyCards(
    artifactCards.filter((card) => card.kind === "strategy"),
    contextRound,
    contextPhase,
    limit,
  );

  return {
    ok: true,
    schemaVersion: 1,
    game: gameIdentity(watchState),
    context,
    intelligence: {
      thinking: cardsSection(thinkingCards, "No public thinking has been captured for this player yet."),
      strategy: cardsSection(strategyCards, "No public strategy notes have been captured for this player yet."),
      receipts,
    },
  };
}

async function buildPublicReceipts(
  db: PublicWatchIntelligenceDB,
  gameId: string,
  round: number,
): Promise<PublicWatchIntelligenceReceipts> {
  const events = await getPersistedGameEvents(db, gameId);
  const projection = getPersistedGameProjection(events);
  const canonicalGameFacts = buildRevealedRoundFacts({
    events: events.events.map((event) => event.envelope),
    round,
    eventLogStatus: events.status,
    projectionStatus: projection.status,
  });
  const available = canonicalGameFacts.availability.canonicalFactsStatus === "available";
  return {
    status: available ? "available" : "unavailable",
    canonicalGameFacts,
    ...(!available && { reason: "Canonical gameplay receipts are not available for this round yet." }),
  };
}

function gameIdentity(watchState: {
  gameId: string;
  slug?: string;
  status: GameStatus;
}): PublicWatchIntelligenceGame {
  return {
    id: watchState.gameId,
    ...(watchState.slug && { slug: watchState.slug }),
    status: watchState.status,
  };
}

async function loadArtifactCards(
  db: PublicWatchIntelligenceDB,
  params: {
    gameId: string;
    actorPlayerId: string;
    round: number;
    phase: string;
    limit: number;
  },
): Promise<PublicWatchIntelligenceCard[]> {
  const rows = await db
    .select()
    .from(schema.gameCognitiveArtifacts)
    .where(and(
      eq(schema.gameCognitiveArtifacts.gameId, params.gameId),
      eq(schema.gameCognitiveArtifacts.actorPlayerId, params.actorPlayerId),
      eq(schema.gameCognitiveArtifacts.visibilityStatus, "active"),
      eq(schema.gameCognitiveArtifacts.redactionStatus, "active"),
      inArray(schema.gameCognitiveArtifacts.artifactType, ["thinking", "strategy"] satisfies CognitiveArtifactType[]),
      inArray(schema.gameCognitiveArtifacts.actorRole, ["player", "juror"]),
      or(isNull(schema.gameCognitiveArtifacts.round), lte(schema.gameCognitiveArtifacts.round, params.round)),
    ))
    .orderBy(desc(schema.gameCognitiveArtifacts.eventSequence), desc(schema.gameCognitiveArtifacts.createdAt))
    .limit(cardScanLimit(params.limit));

  return rows
    .filter((row) => isAtOrBeforeReplayContext(row.round, row.phase, params.round, params.phase))
    .flatMap((row) => artifactCardsFromRow(row, params));
}

function artifactCardsFromRow(
  row: ArtifactRow,
  context: {
    actorPlayerId: string;
    round: number;
    phase: string;
  },
): PublicWatchIntelligenceCard[] {
  if (row.artifactType === "thinking") {
    const text = textFromPayloadField(row.payload, "thinking");
    if (!text) return [];
    return [{
      id: row.id,
      kind: "thinking",
      source: "cognitive_artifact",
      actorPlayerId: context.actorPlayerId,
      title: actionTitle(row.action, "Thinking"),
      text,
      context: contextPrecision(row.round, row.phase, context.round, context.phase),
      ...(row.round !== null && { round: row.round }),
      ...(row.phase && { phase: row.phase }),
      action: row.action,
      ...(row.eventSequence !== null && { eventSequence: row.eventSequence }),
      createdAt: row.createdAt,
    }];
  }

  if (row.artifactType !== "strategy") return [];

  return STRATEGY_FIELDS.flatMap((field) => {
    const text = textFromPayloadField(row.payload, field.key);
    if (!text) return [];
    return [{
      id: `${row.id}:${field.key}`,
      kind: "strategy" as const,
      source: "cognitive_artifact" as const,
      actorPlayerId: context.actorPlayerId,
      title: field.title,
      text,
      context: contextPrecision(row.round, row.phase, context.round, context.phase),
      ...(row.round !== null && { round: row.round }),
      ...(row.phase && { phase: row.phase }),
      action: row.action,
      ...(row.eventSequence !== null && { eventSequence: row.eventSequence }),
      createdAt: row.createdAt,
    }];
  });
}

async function loadTranscriptThinkingCards(
  db: PublicWatchIntelligenceDB,
  params: {
    gameId: string;
    actorPlayerId: string;
    round: number;
    phase: string;
    limit: number;
  },
): Promise<PublicWatchIntelligenceCard[]> {
  const rows = await db
    .select()
    .from(schema.transcripts)
    .where(and(
      eq(schema.transcripts.gameId, params.gameId),
      eq(schema.transcripts.fromPlayerId, params.actorPlayerId),
      isNotNull(schema.transcripts.thinking),
      ne(schema.transcripts.scope, "thinking"),
      lte(schema.transcripts.round, params.round),
    ))
    .orderBy(desc(schema.transcripts.timestamp), desc(schema.transcripts.id))
    .limit(cardScanLimit(params.limit));

  return rows
    .filter((row) => isAtOrBeforeReplayContext(row.round, row.phase, params.round, params.phase))
    .flatMap((row) => transcriptThinkingCardFromRow(row, params));
}

function transcriptThinkingCardFromRow(
  row: TranscriptRow,
  context: {
    actorPlayerId: string;
    round: number;
    phase: string;
  },
): PublicWatchIntelligenceCard[] {
  const text = normalizeText(row.thinking);
  if (!text) return [];
  return [{
    id: `transcript:${row.id}`,
    kind: "thinking",
    source: "transcript",
    actorPlayerId: context.actorPlayerId,
    title: "Message Thought",
    text,
    context: contextPrecision(row.round, row.phase, context.round, context.phase),
    round: row.round,
    phase: row.phase,
    action: "message",
    createdAt: row.createdAt,
  }];
}

function textFromPayloadField(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field];
  if (field === "strategyPacketSummary") {
    return textFromStrategyPacketSummary(value);
  }
  if (field === "strategicReflectionSummary") {
    return textFromStrategicReflectionSummary(value);
  }
  return textFromStringOrSummary(value);
}

function textFromStringOrSummary(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeText(value);
  }
  if (isRecord(value)) {
    return normalizeText(value.summary) ?? normalizeText(value.text);
  }
  return null;
}

function textFromStrategyPacketSummary(value: unknown): string | null {
  const directText = textFromStringOrSummary(value);
  if (directText) return directText;
  if (!isRecord(value)) return null;

  const parts = [
    labeledText("Objective", value.objective),
    labeledText("Coalition", value.coalitionPosture),
    labeledText("Target", value.targetPosture),
    labeledText("Next probe", value.nextSocialProbe),
    labeledText("Revise if", value.reviseTrigger),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

function textFromStrategicReflectionSummary(value: unknown): string | null {
  const directText = textFromStringOrSummary(value);
  if (directText) return directText;
  if (!isRecord(value)) return null;

  const parts = [
    labeledText("Plan", value.plan),
    labeledList("Allies", value.allies),
    labeledList("Threats", value.threats),
    labeledText("Lens", value.strategicLens),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}

function labeledText(label: string, value: unknown): string | null {
  const text = normalizeText(value);
  return text ? `${label}: ${punctuate(text)}` : null;
}

function labeledList(label: string, value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const text = value
    .map((item) => normalizeText(item))
    .filter((item): item is string => item !== null)
    .join(", ");
  return text ? `${label}: ${punctuate(text)}` : null;
}

function punctuate(text: string): string {
  return /[.!?](?:["')\]]|\u201d|\u2019)*$/.test(text) ? text : `${text}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function actionTitle(action: string, fallback: string): string {
  return action
    .split(/[_\s.-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || fallback;
}

function contextPrecision(
  rowRound: number | null,
  rowPhase: string | null,
  round: number,
  phase: string,
): PublicWatchIntelligenceCardContext {
  if (rowRound === round && rowPhase === phase) return "current_phase";
  if (rowRound === round) return "current_round";
  return "recent";
}

function isAtOrBeforeReplayContext(
  rowRound: number | null,
  rowPhase: string | null,
  contextRound: number,
  contextPhase: string,
): boolean {
  if (rowRound === null) return true;
  if (rowRound < contextRound) return true;
  if (rowRound > contextRound) return false;
  if (!rowPhase) return true;
  if (rowPhase === contextPhase) return true;

  const rowRank = phaseRank(rowPhase);
  const contextRank = phaseRank(contextPhase);
  if (rowRank === null || contextRank === null) return false;
  return rowRank <= contextRank;
}

function phaseRank(phase: string): number | null {
  return PUBLIC_WATCH_PHASE_RANKS.get(phase as typeof PUBLIC_WATCH_PHASE_ORDER[number]) ?? null;
}

function rankCards(
  cards: PublicWatchIntelligenceCard[],
  round: number,
  phase: string,
): PublicWatchIntelligenceCard[] {
  return [...cards].sort((a, b) => {
    const contextDiff = contextRank(a, round, phase) - contextRank(b, round, phase);
    if (contextDiff !== 0) return contextDiff;
    const sequenceDiff = (b.eventSequence ?? 0) - (a.eventSequence ?? 0);
    if (sequenceDiff !== 0) return sequenceDiff;
    return Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "");
  });
}

function selectStrategyCards(
  cards: PublicWatchIntelligenceCard[],
  round: number,
  phase: string,
  limit: number,
): PublicWatchIntelligenceCard[] {
  const ranked = rankCards(cards, round, phase);
  const selected: PublicWatchIntelligenceCard[] = [];
  const selectedIds = new Set<string>();
  const selectedTitles = new Set<string>();

  for (const card of ranked) {
    if (selectedTitles.has(card.title)) continue;
    selected.push(card);
    selectedIds.add(card.id);
    selectedTitles.add(card.title);
    if (selected.length === limit) return selected;
  }

  for (const card of ranked) {
    if (selectedIds.has(card.id)) continue;
    selected.push(card);
    if (selected.length === limit) return selected;
  }

  return selected;
}

function contextRank(
  card: PublicWatchIntelligenceCard,
  round: number,
  phase: string,
): number {
  if (card.round === round && card.phase === phase) return 0;
  if (card.round === round) return 1;
  return 2;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_SECTION_CARD_LIMIT;
  return Math.max(1, Math.min(MAX_SECTION_CARD_LIMIT, Math.floor(limit)));
}

function cardScanLimit(limit: number): number {
  return Math.max(MIN_CARD_SCAN_LIMIT, limit * CARD_SCAN_MULTIPLIER);
}

function selectPlayerSection(): PublicWatchIntelligenceSection {
  return {
    status: "select_player",
    cards: [],
    reason: "Select a player to inspect their public thinking and strategy.",
  };
}

function unavailableSection(reason: string): PublicWatchIntelligenceSection {
  return {
    status: "unavailable",
    cards: [],
    reason,
  };
}

function cardsSection(
  cards: PublicWatchIntelligenceCard[],
  emptyReason: string,
): PublicWatchIntelligenceSection {
  return cards.length > 0
    ? {
        status: "available",
        cards,
      }
    : unavailableSection(emptyReason);
}
