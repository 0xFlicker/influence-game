import type { CanonicalGameEvent, CanonicalGameEventType } from "./canonical-events";
import type { CanonicalGameProjection } from "./game-projection";
import type { Phase, UUID } from "./types";

export const HOUSE_SUMMARY_FRONTIER_VERSION = 1 as const;

export const HOUSE_FACT_CATEGORIES = [
  "canonical_phase_facts",
  "player_projection_facts",
  "audience_dialogue_quotes",
] as const;

export const HOUSE_SUMMARY_ACTOR_COORDINATES = [
  "introduction",
  "lobby",
  "vote",
  "format_menu",
  "format_pick",
  "format_mingle",
  "format_resolve",
  "post_vote_mingle",
  "power",
  "reveal",
  "pre_council_huddle",
  "council",
  "reckoning_lobby",
  "reckoning_plea",
  "reckoning_vote",
  "tribunal_lobby",
  "tribunal_accusation",
  "tribunal_defense",
  "tribunal_vote",
  "judgment_opening",
  "judgment_jury_questions",
  "judgment_closing",
  "judgment_jury_vote",
] as const;

export type HouseFactCategory = (typeof HOUSE_FACT_CATEGORIES)[number];
export type HouseSummaryActorCoordinate = (typeof HOUSE_SUMMARY_ACTOR_COORDINATES)[number];
export type HouseBeatClass = "ordinary" | "milestone";
export type HouseBeatStatus = "emitted" | "preflight_skipped" | "model_skipped" | "failed";

export interface HouseSummaryBoundary {
  version: typeof HOUSE_SUMMARY_FRONTIER_VERSION;
  id: string;
  gameId: UUID;
  actorCoordinate: HouseSummaryActorCoordinate;
  round: number;
  phase: Phase;
  beatClass: HouseBeatClass;
  canonicalHead: number;
  dialogueHead: number;
}

export type HouseSourceCoordinate =
  | {
      kind: "canonical_event";
      sequence: number;
      type: CanonicalGameEventType;
      round: number;
      phase: Phase | null;
    }
  | {
      kind: "canonical_projection";
      headSequence: number;
      projection: string;
      round: number;
      phase: Phase | null;
    }
  | {
      kind: "transcript_entry";
      sequence: number;
      round: number;
      phase: Phase;
      dialogueKind: string;
    };

export type HouseFactAuthority = "canonical_event" | "canonical_projection" | "dialogue_non_authoritative";

export interface HouseFactRow {
  alias: string;
  category: HouseFactCategory;
  authority: HouseFactAuthority;
  label: string;
  data: Record<string, unknown>;
  source: HouseSourceCoordinate;
}

export interface HouseSalienceItem {
  alias: string;
  category: HouseFactCategory;
  authority: HouseFactAuthority;
  label: string;
  /** Bounded audience-safe headline; fuller typed rows remain requestable. */
  data?: Record<string, unknown>;
  source: HouseSourceCoordinate;
}

export interface HouseSummaryFrontier {
  version: typeof HOUSE_SUMMARY_FRONTIER_VERSION;
  boundary: HouseSummaryBoundary;
  material: boolean;
  catalog: HouseSalienceItem[];
  categoryCounts: Record<HouseFactCategory, number>;
  /** Runner-private fact bodies. Prompt construction must use catalog, not this store. */
  factStore: Record<HouseFactCategory, HouseFactRow[]>;
}

export interface HouseNarrativeContinuity {
  version: typeof HOUSE_SUMMARY_FRONTIER_VERSION;
  lastBoundaryId: string | null;
  lastSummary: string | null;
  /**
   * Last emitted prose at each approved cadence coordinate. This is narrative
   * style context only; it is never authoritative game evidence.
   */
  lastSummaryByActorCoordinate: Partial<Record<HouseSummaryActorCoordinate, string>>;
  openQuestions: string[];
  threadIds: string[];
  supportingSources: HouseSourceCoordinate[];
  examinedCanonicalHead: number;
  examinedDialogueHead: number;
  emittedCanonicalHead: number;
  emittedDialogueHead: number;
  pendingDeltaCarry: 0 | 1;
}

export interface HouseProviderUsage {
  callId: string;
  responseId: string | null;
  serviceTier: string | null;
  promptTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
}

export interface HouseSummaryPhaseReceipt {
  version: typeof HOUSE_SUMMARY_FRONTIER_VERSION;
  boundaryId: string;
  actorCoordinate: HouseSummaryActorCoordinate;
  round: number;
  phase: Phase;
  beatClass: HouseBeatClass;
  status: HouseBeatStatus;
  providerCalls: number;
  factCalls: number;
  requestedCategories: HouseFactCategory[];
  returnedBytes: number;
  selectedSourceCount: number;
  usageAvailable: boolean;
  usage: HouseProviderUsage[];
  pendingDelta: "none" | "carried" | "dropped";
}

export interface HouseFactSlice {
  status: "ok" | "too_large";
  categories: HouseFactCategory[];
  facts: HouseFactRow[];
  returnedBytes: number;
  omittedCounts: Partial<Record<HouseFactCategory, number>>;
}

export interface HouseFrontierDialogueEntry {
  round: number;
  phase: Phase;
  from: string;
  scope: string;
  text: string;
  anonymous?: boolean;
  speakerPlayerId?: string | null;
  entrySequence?: number;
  dialogueKind?: string;
}

export interface CompileHouseSummaryFrontierInput {
  actorCoordinate: HouseSummaryActorCoordinate;
  round: number;
  phase: Phase;
  beatClass: HouseBeatClass;
  events: readonly CanonicalGameEvent[];
  projection: CanonicalGameProjection;
  transcript: readonly HouseFrontierDialogueEntry[];
  afterCanonicalSequence: number;
  afterDialogueSequence: number;
}

export interface HouseFactSliceLimits {
  maxCategories: number;
  maxBytesPerCategory: number;
  maxTotalBytes: number;
}

const MAX_FACT_ROWS_PER_CATEGORY = 24;
const MAX_FACT_STRING_CHARS = 280;

const CANONICAL_NARRATION_TYPES = new Set<CanonicalGameEventType>([
  "game.roster_initialized",
  "round.started",
  "shields.expired",
  "vote.empower_tally_resolved",
  "vote.empowered_set",
  "format.menu_offered",
  "format.selected",
  "format.resolved",
  "power.action_set",
  "power.candidates_resolved",
  "council.elimination_resolved",
  "player.eliminated",
  "endgame.stage_set",
  "endgame.elimination_resolved",
  "jury.winner_determined",
  "round.result_recorded",
]);

const PROJECTION_TRIGGER_TYPES = new Set<CanonicalGameEventType>([
  "game.roster_initialized",
  "mingle.rooms_allocated",
  "vote.empowered_set",
  "format.menu_offered",
  "format.selected",
  "format.resolved",
  "power.action_set",
  "power.candidates_resolved",
  "alliance.activated",
  "alliance.amendment_resolved",
  "alliance.closed",
  "alliance.archived",
  "council.elimination_resolved",
  "player.eliminated",
  "endgame.stage_set",
  "endgame.elimination_resolved",
  "jury.winner_determined",
]);

function normalizeProviderString(value: string, maxChars = MAX_FACT_STRING_CHARS): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function playerName(projection: CanonicalGameProjection, id: string | null | undefined): string | null {
  if (!id) return null;
  const name = projection.players[id]?.name;
  return name ? normalizeProviderString(name, 80) : "Unknown player";
}

function namedCounts(projection: CanonicalGameProjection, counts: Record<string, number>): Array<{ player: string; value: number }> {
  return Object.entries(counts)
    .map(([id, value]) => ({ player: playerName(projection, id) ?? "Unknown player", value }))
    .sort((left, right) => left.player.localeCompare(right.player));
}

function sourceForEvent(event: CanonicalGameEvent): HouseSourceCoordinate {
  return {
    kind: "canonical_event",
    sequence: event.sequence,
    type: event.type,
    round: event.round,
    phase: event.phase,
  };
}

function safeEventData(event: CanonicalGameEvent, projection: CanonicalGameProjection): Record<string, unknown> | null {
  switch (event.type) {
    case "game.roster_initialized":
      return { players: event.payload.players.map((player) => normalizeProviderString(player.name, 80)) };
    case "round.started":
      return { round: event.payload.round };
    case "shields.expired":
      return { players: event.payload.expiredPlayerIds.map((id) => playerName(projection, id)) };
    case "vote.empower_tally_resolved":
      return {
        counts: namedCounts(projection, event.payload.counts),
        empowered: playerName(projection, event.payload.empowered),
        tied: event.payload.tied?.map((id) => playerName(projection, id)) ?? [],
        method: event.payload.method,
      };
    case "vote.empowered_set":
      return { empowered: playerName(projection, event.payload.empowered), method: event.payload.method };
    case "format.menu_offered":
      return {
        empowered: playerName(projection, event.payload.empoweredId),
        offeredFormats: [...event.payload.offeredFormatIds],
      };
    case "format.selected":
      return {
        empowered: playerName(projection, event.payload.empoweredId),
        selectedFormat: event.payload.formatId,
      };
    case "format.resolved":
      return {
        selectedFormat: event.payload.formatId,
        empowered: playerName(projection, event.payload.empoweredId),
        eliminated: playerName(projection, event.payload.eliminatedId),
        resolutionKind: event.payload.resolutionKind,
        tied: event.payload.tiedPlayerIds.map((id) => playerName(projection, id)),
        tiebreaker: playerName(projection, event.payload.tiebreakerId),
      };
    case "power.action_set":
      return {
        action: event.payload.action.action,
        target: playerName(projection, event.payload.action.target),
      };
    case "power.candidates_resolved":
      return {
        candidates: event.payload.candidates?.map((id) => playerName(projection, id)) ?? [],
        autoEliminated: playerName(projection, event.payload.autoEliminated),
        shieldGranted: playerName(projection, event.payload.shieldGranted),
        method: event.payload.method,
      };
    case "council.elimination_resolved":
      return {
        candidates: event.payload.candidates.map((id) => playerName(projection, id)),
        eliminated: playerName(projection, event.payload.eliminated),
        method: event.payload.method,
      };
    case "player.eliminated":
      return { player: normalizeProviderString(event.payload.playerName, 80), eliminatedRound: event.payload.eliminatedRound };
    case "endgame.stage_set":
      return { stage: event.payload.stage };
    case "endgame.elimination_resolved":
      return {
        stage: event.payload.stage,
        eliminated: playerName(projection, event.payload.eliminated),
        method: event.payload.method,
      };
    case "jury.winner_determined":
      return {
        winner: playerName(projection, event.payload.winnerId),
        voteCounts: event.payload.voteCounts.map((count) => ({
          player: normalizeProviderString(count.name, 80),
          votes: count.votes,
        })),
        method: event.payload.method,
      };
    case "round.result_recorded":
      return {
        round: event.payload.result.round,
        eliminated: playerName(projection, event.payload.result.eliminated),
        empowered: playerName(projection, event.payload.result.empoweredId),
      };
    default:
      return null;
  }
}

function projectionRows(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
): Array<Omit<HouseFactRow, "alias">> {
  if (!events.some((event) => PROJECTION_TRIGGER_TYPES.has(event.type))) return [];
  const source: HouseSourceCoordinate = {
    kind: "canonical_projection",
    headSequence: projection.lastSequence,
    projection: "public_house_frontier_v1",
    round: projection.round,
    phase: projection.phase,
  };
  const alive = projection.playerOrder
    .map((id) => projection.players[id])
    .filter((player) => player?.status === "alive")
    .map((player) => normalizeProviderString(player!.name, 80));
  const eliminated = projection.playerOrder
    .map((id) => projection.players[id])
    .filter((player) => player?.status === "eliminated")
    .map((player) => normalizeProviderString(player!.name, 80));
  const rows: Array<Omit<HouseFactRow, "alias">> = [{
    category: "player_projection_facts",
    authority: "canonical_projection",
    label: "Current public player board",
    data: {
      alive,
      eliminated,
      empowered: playerName(projection, projection.empoweredId),
      selectedFormat: projection.selectedFormatId,
      councilCandidates: projection.councilCandidates?.map((id) => playerName(projection, id)) ?? [],
      endgameStage: projection.endgameStage,
    },
    source,
  }];

  if (events.some((event) => event.type === "mingle.rooms_allocated")) {
    const allocation = projection.roomAllocations[projection.round];
    if (allocation) {
      rows.push({
        category: "player_projection_facts",
        authority: "canonical_projection",
        label: "Current public room allocation",
        data: {
          rooms: allocation.rooms.map((room) => ({
            roomId: room.roomId,
            players: room.playerIds.map((id) => playerName(projection, id)),
          })),
          excluded: allocation.excluded.map((id) => playerName(projection, id)),
        },
        source,
      });
    }
  }

  if (events.some((event) => event.type.startsWith("alliance."))) {
    const alliances = projection.allianceOrder
      .map((id) => projection.alliances[id])
      .filter(Boolean)
      .map((alliance) => ({
        name: normalizeProviderString(alliance!.name, 100),
        status: alliance!.status,
        members: alliance!.memberIds.map((id) => playerName(projection, id)),
      }));
    rows.push({
      category: "player_projection_facts",
      authority: "canonical_projection",
      label: "Audience-safe alliance projection",
      data: { alliances },
      source,
    });
  }

  return rows;
}

function nextAlias(index: number): string {
  return `S${index + 1}`;
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function salienceData(row: HouseFactRow): Record<string, unknown> {
  if (row.authority !== "dialogue_non_authoritative") return row.data;
  return {
    speaker: row.data.speaker,
    excerpt: typeof row.data.quote === "string" ? row.data.quote.slice(0, 160) : "",
    anonymous: row.data.anonymous,
  };
}

export function createEmptyHouseNarrativeContinuity(): HouseNarrativeContinuity {
  return {
    version: HOUSE_SUMMARY_FRONTIER_VERSION,
    lastBoundaryId: null,
    lastSummary: null,
    lastSummaryByActorCoordinate: {},
    openQuestions: [],
    threadIds: [],
    supportingSources: [],
    examinedCanonicalHead: 0,
    examinedDialogueHead: 0,
    emittedCanonicalHead: 0,
    emittedDialogueHead: 0,
    pendingDeltaCarry: 0,
  };
}

/**
 * Retain one summary per approved cadence coordinate and discard any keys
 * outside the authoritative coordinate tuple.
 */
export function retainHouseSummaryAtActorCoordinate(
  previous: HouseNarrativeContinuity["lastSummaryByActorCoordinate"],
  actorCoordinate: HouseSummaryActorCoordinate,
  summary: string,
): HouseNarrativeContinuity["lastSummaryByActorCoordinate"] {
  const retained: HouseNarrativeContinuity["lastSummaryByActorCoordinate"] = {};
  for (const coordinate of HOUSE_SUMMARY_ACTOR_COORDINATES) {
    const value = coordinate === actorCoordinate ? summary : previous[coordinate];
    if (typeof value === "string" && value.length > 0) retained[coordinate] = value;
  }
  return retained;
}

export function compileHouseSummaryFrontier(input: CompileHouseSummaryFrontierInput): HouseSummaryFrontier {
  const canonicalHead = input.events.at(-1)?.sequence ?? input.projection.lastSequence;
  const dialogueHead = input.transcript.reduce(
    (head, entry) => Math.max(head, entry.entrySequence ?? 0),
    input.afterDialogueSequence,
  );
  const boundary: HouseSummaryBoundary = {
    version: HOUSE_SUMMARY_FRONTIER_VERSION,
    id: `house-beat/v1:${input.round}:${input.actorCoordinate}:${canonicalHead}:${dialogueHead}`,
    gameId: input.projection.gameId,
    actorCoordinate: input.actorCoordinate,
    round: input.round,
    phase: input.phase,
    beatClass: input.beatClass,
    canonicalHead,
    dialogueHead,
  };
  const factStore: Record<HouseFactCategory, HouseFactRow[]> = {
    canonical_phase_facts: [],
    player_projection_facts: [],
    audience_dialogue_quotes: [],
  };
  let nextAliasIndex = 0;
  const addFact = (row: Omit<HouseFactRow, "alias">): void => {
    const categoryFacts = factStore[row.category];
    if (categoryFacts.length >= MAX_FACT_ROWS_PER_CATEGORY) return;
    categoryFacts.push({ ...row, alias: nextAlias(nextAliasIndex) });
    nextAliasIndex += 1;
  };
  const deltaEvents: CanonicalGameEvent[] = [];

  for (const event of input.events) {
    if (event.sequence <= input.afterCanonicalSequence) continue;
    deltaEvents.push(event);
    if (event.visibility !== "public" && event.visibility !== "system") continue;
    if (!CANONICAL_NARRATION_TYPES.has(event.type)) continue;
    const data = safeEventData(event, input.projection);
    if (!data) continue;
    addFact({
      category: "canonical_phase_facts",
      authority: "canonical_event",
      label: event.type,
      data,
      source: sourceForEvent(event),
    });
  }

  for (const row of projectionRows(deltaEvents, input.projection)) addFact(row);

  for (const entry of input.transcript) {
    if (
      entry.scope !== "public"
      || typeof entry.entrySequence !== "number"
      || entry.entrySequence <= input.afterDialogueSequence
      || entry.from === "House"
    ) {
      continue;
    }
    addFact({
      category: "audience_dialogue_quotes",
      authority: "dialogue_non_authoritative",
      label: "Accepted public player dialogue",
      data: {
        speaker: entry.anonymous ? "Anonymous" : normalizeProviderString(entry.from, 80),
        quote: normalizeProviderString(entry.text),
        anonymous: entry.anonymous === true,
        trust: "dialogue_non_authoritative",
      },
      source: {
        kind: "transcript_entry",
        sequence: entry.entrySequence,
        round: entry.round,
        phase: entry.phase,
        dialogueKind: entry.dialogueKind ?? "public_speech",
      },
    });
  }

  const catalogRows = [
    ...factStore.canonical_phase_facts,
    ...(factStore.canonical_phase_facts.length === 0
      || factStore.canonical_phase_facts.some((fact) => fact.label === "endgame.stage_set")
      ? factStore.player_projection_facts.slice(0, 1)
      : []),
    ...factStore.audience_dialogue_quotes.slice(0, 2),
  ];
  const catalog = catalogRows.map((row) => ({
    alias: row.alias,
    category: row.category,
    authority: row.authority,
    label: row.label,
    data: salienceData(row),
    source: row.source,
  }));
  return {
    version: HOUSE_SUMMARY_FRONTIER_VERSION,
    boundary,
    material: catalog.length > 0,
    catalog,
    categoryCounts: Object.fromEntries(
      HOUSE_FACT_CATEGORIES.map((category) => [category, factStore[category].length]),
    ) as Record<HouseFactCategory, number>,
    factStore,
  };
}

export function readHouseFactSlice(
  frontier: HouseSummaryFrontier,
  requestedCategories: readonly HouseFactCategory[],
  limits: HouseFactSliceLimits,
): HouseFactSlice {
  const categories = [...new Set(requestedCategories)].slice(0, limits.maxCategories);
  const facts: HouseFactRow[] = [];
  const omittedCounts: Partial<Record<HouseFactCategory, number>> = {};
  let returnedBytes = 0;

  for (const category of categories) {
    const categoryFacts = frontier.factStore[category];
    const categoryBytes = bytes(categoryFacts);
    if (categoryBytes > limits.maxBytesPerCategory || returnedBytes + categoryBytes > limits.maxTotalBytes) {
      omittedCounts[category] = categoryFacts.length;
      continue;
    }
    facts.push(...categoryFacts);
    returnedBytes += categoryBytes;
  }

  return {
    status: Object.keys(omittedCounts).length > 0 ? "too_large" : "ok",
    categories,
    facts,
    returnedBytes,
    omittedCounts,
  };
}

export function isHouseFactCategory(value: unknown): value is HouseFactCategory {
  return typeof value === "string" && (HOUSE_FACT_CATEGORIES as readonly string[]).includes(value);
}

export function isHouseSummaryActorCoordinate(value: unknown): value is HouseSummaryActorCoordinate {
  return typeof value === "string" && (HOUSE_SUMMARY_ACTOR_COORDINATES as readonly string[]).includes(value);
}
