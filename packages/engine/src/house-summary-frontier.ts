import type { CanonicalGameEvent, CanonicalGameEventType } from "./canonical-events";
import { displayNameForFormat } from "./format-presentation-metadata";
import { formatSurfaceId, type FormatSurfaceId } from "./format-vocabulary";
import type { CanonicalGameProjection } from "./game-projection";
import type { StructuredDomainDecodeResult } from "./structured-output";
import { Phase, type UUID } from "./types";

/** House narrative state is presentation continuity, never game-state authority. */
export const HOUSE_NARRATIVE_CONTINUITY_VERSION = 2 as const;

export const HOUSE_SUMMARY_ACTOR_COORDINATES = [
  "introduction", "lobby", "vote", "format_menu", "format_pick", "format_mingle",
  "format_resolve", "post_vote_mingle", "power", "reveal", "pre_council_huddle",
  "council", "reckoning_lobby", "reckoning_plea", "reckoning_vote", "tribunal_lobby",
  "tribunal_accusation", "tribunal_defense", "tribunal_vote", "judgment_opening",
  "judgment_jury_questions", "judgment_closing", "judgment_jury_vote",
] as const;

export type HouseSummaryActorCoordinate = (typeof HOUSE_SUMMARY_ACTOR_COORDINATES)[number];
export type HouseBeatClass = "ordinary" | "milestone";
export type HouseBeatStatus = "emitted" | "preflight_skipped" | "model_skipped" | "failed";

export interface HouseSummaryBoundary {
  version: typeof HOUSE_NARRATIVE_CONTINUITY_VERSION;
  id: string;
  gameId: UUID;
  actorCoordinate: HouseSummaryActorCoordinate;
  round: number;
  phase: Phase;
  beatClass: HouseBeatClass;
  canonicalHead: number;
  dialogueHead: number;
}

export interface HouseNarrativeBeat {
  version: typeof HOUSE_NARRATIVE_CONTINUITY_VERSION;
  boundary: HouseSummaryBoundary;
  /** House-authored viewer copy. Presentation only; never parse for game facts. */
  publicSummary: string;
}

export interface HouseNarrativeContinuityV2 {
  version: typeof HOUSE_NARRATIVE_CONTINUITY_VERSION;
  /** Binds the opaque producer notebook and every retained beat to one game. */
  gameId: UUID;
  recentBeats: HouseNarrativeBeat[];
  /** Opaque House-only showrunner notes. Never expose to contestants or parse for facts. */
  privateNarrativeNotebook: string | null;
  examinedCanonicalHead: number;
  examinedDialogueHead: number;
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

/** Engine-generated provider/cadence telemetry. It is not a model-authored receipt. */
export interface HouseSummaryPhaseTelemetry {
  version: typeof HOUSE_NARRATIVE_CONTINUITY_VERSION;
  boundaryId: string;
  actorCoordinate: HouseSummaryActorCoordinate;
  round: number;
  phase: Phase;
  beatClass: HouseBeatClass;
  status: HouseBeatStatus;
  providerCalls: number;
  usageAvailable: boolean;
  usage: HouseProviderUsage[];
  pendingDelta: "none" | "carried" | "dropped";
}

export interface HouseNarrationTranscriptEntry {
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

export interface HouseNarrationCanonicalEvent {
  sequence: number;
  type: HouseNarrationEventKind;
  round: number;
  phase: Phase | null;
  data: Record<string, unknown>;
}

export type HouseNarrationEventKind =
  | "game.roster_initialized"
  | "round.started"
  | "shields.expired"
  | "vote.empower_tally_resolved"
  | "vote.empowered_set"
  | "format.menu_offered"
  | "format.selected"
  | "format.ballot_cast"
  | "format.ballot_forfeited"
  | "format.resolved"
  | "power.action_set"
  | "power.candidates_resolved"
  | "council.exit_resolved"
  | "player.exited"
  | "endgame.stage_set"
  | "endgame.exit_resolved"
  | "jury.winner_determined"
  | "round.result_recorded";

export interface HouseNarrationFormat {
  id: FormatSurfaceId;
  name: string;
}

export interface HouseNarrationProjection {
  headSequence: number;
  round: number;
  phase: Phase | null;
  remainingPlayers: string[];
  exitedPlayers: string[];
  empowered: string | null;
  selectedFormat: HouseNarrationFormat | null;
  councilCandidates: string[];
  endgameStage: string | null;
}

export interface HouseNarrationDialogue {
  sequence: number;
  round: number;
  phase: Phase;
  speaker: string;
  text: string;
  anonymous: boolean;
  dialogueKind: string;
}

export interface HouseNarrationDiaryEntry {
  round: number;
  precedingPhase: Phase;
  player: string;
  question: string;
  answer: string;
}

/** Direct, bounded creative context. No aliases, source maps, claims, or fact reads. */
export interface HouseNarrationContext {
  version: typeof HOUSE_NARRATIVE_CONTINUITY_VERSION;
  boundary: HouseSummaryBoundary;
  material: boolean;
  /** One roster lookup for any canonical payload fields that still carry player IDs. */
  playerNamesById: Record<string, string>;
  canonicalEvents: HouseNarrationCanonicalEvent[];
  projection: HouseNarrationProjection | null;
  publicDialogue: HouseNarrationDialogue[];
  /** Omniscient producer context, supplied to milestone House turns only. */
  privateDialogueAndDecisions: HouseNarrationDialogue[];
  diaryEntries: HouseNarrationDiaryEntry[];
}

export interface CompileHouseNarrationContextInput {
  actorCoordinate: HouseSummaryActorCoordinate;
  round: number;
  phase: Phase;
  beatClass: HouseBeatClass;
  events: readonly CanonicalGameEvent[];
  projection: CanonicalGameProjection;
  transcript: readonly HouseNarrationTranscriptEntry[];
  diaryEntries: readonly {
    round: number;
    precedingPhase: Phase;
    agentName: string;
    question: string;
    answer: string;
  }[];
  afterCanonicalSequence: number;
  afterDialogueSequence: number;
}

const MAX_EVENT_ROWS = 24;
const MAX_DIALOGUE_ROWS = 12;
const MAX_CONTEXT_LABEL_CHARS = 80;
const MAX_RECENT_BEATS = 8;
export const HOUSE_PRIVATE_NARRATIVE_NOTEBOOK_MAX_CHARACTERS = 1_200;

export function houseSummaryCharacterLimit(beatClass: HouseBeatClass): number {
  return beatClass === "ordinary" ? 180 : 360;
}

export function isBoundedHouseAuthoredText(
  value: unknown,
  maxCharacters: number,
): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxCharacters
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value);
}

const PROJECTION_TRIGGER_TYPES = new Set<CanonicalGameEventType>([
  "game.roster_initialized", "mingle.rooms_allocated", "vote.empowered_set",
  "format.menu_offered", "format.selected", "format.resolved", "power.action_set",
  "power.candidates_resolved", "alliance.activated", "alliance.amendment_resolved",
  "alliance.closed", "alliance.archived", "council.elimination_resolved",
  "player.eliminated", "endgame.stage_set", "endgame.elimination_resolved",
  "jury.winner_determined",
]);

function normalizeContextLabel(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTEXT_LABEL_CHARS);
}

function playerName(projection: CanonicalGameProjection, id: string | null | undefined): string | null {
  if (!id) return null;
  const name = projection.players[id]?.name;
  return name ? normalizeContextLabel(name) : "Unknown player";
}

function namedCounts(projection: CanonicalGameProjection, counts: Record<string, number>): Array<{ player: string; value: number }> {
  return Object.entries(counts)
    .map(([id, value]) => ({ player: playerName(projection, id) ?? "Unknown player", value }))
    .sort((left, right) => left.player.localeCompare(right.player));
}

function narrationFormat(formatId: Parameters<typeof formatSurfaceId>[0]): HouseNarrationFormat {
  return {
    id: formatSurfaceId(formatId),
    name: displayNameForFormat(formatId),
  };
}

function providerPowerAction(action: string): string {
  return action === "eliminate" ? "exit" : action;
}

function providerResolutionMethod(method: string): string {
  return method === "auto_eliminate" ? "automatic_exit" : method;
}

/**
 * Explicit producer projection. Canonical payloads never cross the provider
 * boundary by default; an event is either mapped here or omitted.
 */
function narrationEvent(
  event: CanonicalGameEvent,
  projection: CanonicalGameProjection,
): HouseNarrationCanonicalEvent | null {
  const base = {
    sequence: event.sequence,
    round: event.round,
    phase: event.phase,
  };
  switch (event.type) {
    case "game.roster_initialized": return {
      ...base,
      type: "game.roster_initialized",
      data: { players: event.payload.players.map((player) => normalizeContextLabel(player.name)) },
    };
    case "round.started": return { ...base, type: "round.started", data: { round: event.payload.round } };
    case "shields.expired": return {
      ...base,
      type: "shields.expired",
      data: { players: event.payload.expiredPlayerIds.map((id) => playerName(projection, id)) },
    };
    case "vote.empower_tally_resolved": return {
      ...base,
      type: "vote.empower_tally_resolved",
      data: {
        counts: namedCounts(projection, event.payload.counts),
        empowered: playerName(projection, event.payload.empowered),
        tied: event.payload.tied?.map((id) => playerName(projection, id)) ?? [],
        method: event.payload.method,
      },
    };
    case "vote.empowered_set": return {
      ...base,
      type: "vote.empowered_set",
      data: { empowered: playerName(projection, event.payload.empowered), method: event.payload.method },
    };
    case "format.menu_offered": return {
      ...base,
      type: "format.menu_offered",
      data: {
        empowered: playerName(projection, event.payload.empoweredId),
        offeredFormats: event.payload.offeredFormatIds.map(narrationFormat),
      },
    };
    case "format.selected": return {
      ...base,
      type: "format.selected",
      data: {
        empowered: playerName(projection, event.payload.empoweredId),
        selectedFormat: narrationFormat(event.payload.formatId),
      },
    };
    case "format.ballot_cast": return {
      ...base,
      type: "format.ballot_cast",
      data: {
        format: narrationFormat(event.payload.formatId),
        voter: playerName(projection, event.payload.voterId),
        target: playerName(projection, event.payload.targetId),
        polarity: event.payload.polarity === "eliminate" ? "exit" : event.payload.polarity,
      },
    };
    case "format.ballot_forfeited": return {
      ...base,
      type: "format.ballot_forfeited",
      data: {
        format: narrationFormat(event.payload.formatId),
        voter: playerName(projection, event.payload.voterId),
        reason: event.payload.reason,
      },
    };
    case "format.resolved": return {
      ...base,
      type: "format.resolved",
      data: {
        selectedFormat: narrationFormat(event.payload.formatId),
        empowered: playerName(projection, event.payload.empoweredId),
        exitedPlayer: playerName(projection, event.payload.eliminatedId),
        resolutionKind: event.payload.resolutionKind,
        tied: event.payload.tiedPlayerIds.map((id) => playerName(projection, id)),
        tiebreaker: playerName(projection, event.payload.tiebreakerId),
      },
    };
    case "power.action_set": return {
      ...base,
      type: "power.action_set",
      data: {
        action: providerPowerAction(event.payload.action.action),
        target: playerName(projection, event.payload.action.target),
      },
    };
    case "power.candidates_resolved": return {
      ...base,
      type: "power.candidates_resolved",
      data: {
        candidates: event.payload.candidates?.map((id) => playerName(projection, id)) ?? [],
        automaticExit: playerName(projection, event.payload.autoEliminated),
        shieldGranted: playerName(projection, event.payload.shieldGranted),
        method: providerResolutionMethod(event.payload.method),
      },
    };
    case "council.elimination_resolved": return {
      ...base,
      type: "council.exit_resolved",
      data: {
        candidates: event.payload.candidates.map((id) => playerName(projection, id)),
        exitedPlayer: playerName(projection, event.payload.eliminated),
        method: event.payload.method,
      },
    };
    case "player.eliminated": return {
      ...base,
      type: "player.exited",
      data: {
        exitedPlayer: normalizeContextLabel(event.payload.playerName),
        exitRound: event.payload.eliminatedRound,
      },
    };
    case "endgame.stage_set": return {
      ...base,
      type: "endgame.stage_set",
      data: { stage: event.payload.stage },
    };
    case "endgame.elimination_resolved": return {
      ...base,
      type: "endgame.exit_resolved",
      data: {
        stage: event.payload.stage,
        exitedPlayer: playerName(projection, event.payload.eliminated),
        method: event.payload.method,
      },
    };
    case "jury.winner_determined": return {
      ...base,
      type: "jury.winner_determined",
      data: {
        winner: playerName(projection, event.payload.winnerId),
        voteCounts: event.payload.voteCounts.map((count) => ({
          player: normalizeContextLabel(count.name),
          votes: count.votes,
        })),
        method: event.payload.method,
      },
    };
    case "round.result_recorded": return {
      ...base,
      type: "round.result_recorded",
      data: {
        round: event.payload.result.round,
        exitedPlayer: playerName(projection, event.payload.result.eliminated),
        empowered: playerName(projection, event.payload.result.empoweredId),
      },
    };
    default: return null;
  }
}

function compileProjection(projection: CanonicalGameProjection): HouseNarrationProjection {
  const remainingPlayers = projection.playerOrder.map((id) => projection.players[id])
    .filter((player) => player?.status === "alive")
    .map((player) => normalizeContextLabel(player!.name));
  const exitedPlayers = projection.playerOrder.map((id) => projection.players[id])
    .filter((player) => player?.status === "eliminated")
    .map((player) => normalizeContextLabel(player!.name));
  return {
    headSequence: projection.lastSequence,
    round: projection.round,
    phase: projection.phase,
    remainingPlayers,
    exitedPlayers,
    empowered: playerName(projection, projection.empoweredId),
    selectedFormat: projection.selectedFormatId === null
      ? null
      : narrationFormat(projection.selectedFormatId),
    councilCandidates: projection.councilCandidates?.map((id) => playerName(projection, id) ?? "Unknown player") ?? [],
    endgameStage: projection.endgameStage,
  };
}

export function createEmptyHouseNarrativeContinuity(gameId: UUID): HouseNarrativeContinuityV2 {
  return {
    version: 2,
    gameId,
    recentBeats: [],
    privateNarrativeNotebook: null,
    examinedCanonicalHead: 0,
    examinedDialogueHead: 0,
    pendingDeltaCarry: 0,
  };
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => keys.includes(key)) ? record : null;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseBoundary(value: unknown): HouseSummaryBoundary | null {
  const boundary = exactRecord(value, ["version", "id", "gameId", "actorCoordinate", "round", "phase", "beatClass", "canonicalHead", "dialogueHead"]);
  if (!boundary || boundary.version !== 2 || typeof boundary.id !== "string" || !boundary.id
    || typeof boundary.gameId !== "string"
    || !HOUSE_SUMMARY_ACTOR_COORDINATES.includes(boundary.actorCoordinate as HouseSummaryActorCoordinate)
    || !nonNegativeInteger(boundary.round) || !Object.values(Phase).includes(boundary.phase as Phase)
    || (boundary.beatClass !== "ordinary" && boundary.beatClass !== "milestone")
    || !nonNegativeInteger(boundary.canonicalHead) || !nonNegativeInteger(boundary.dialogueHead)) return null;
  return structuredClone(value) as HouseSummaryBoundary;
}

function parseBeat(value: unknown): HouseNarrativeBeat | null {
  const beat = exactRecord(value, ["version", "boundary", "publicSummary"]);
  const boundary = beat ? parseBoundary(beat.boundary) : null;
  if (!beat || beat.version !== 2 || !boundary
    || !isBoundedHouseAuthoredText(beat.publicSummary, houseSummaryCharacterLimit(boundary.beatClass))) return null;
  return structuredClone(value) as HouseNarrativeBeat;
}

/** Fail-closed parser. The superseded version-1 narrative state is intentionally unsupported. */
export function parseHouseNarrativeContinuity(value: unknown): StructuredDomainDecodeResult<HouseNarrativeContinuityV2> {
  const continuity = exactRecord(value, [
    "version", "gameId", "recentBeats",
    "privateNarrativeNotebook", "examinedCanonicalHead", "examinedDialogueHead",
    "pendingDeltaCarry",
  ]);
  if (!continuity || continuity.version !== 2) return { status: "invalid", message: "House narrative continuity version is missing or unsupported." };
  if (typeof continuity.gameId !== "string" || !continuity.gameId) {
    return { status: "invalid", message: "House narrative continuity game ID is malformed." };
  }
  if (continuity.privateNarrativeNotebook !== null
      && !isBoundedHouseAuthoredText(
        continuity.privateNarrativeNotebook,
        HOUSE_PRIVATE_NARRATIVE_NOTEBOOK_MAX_CHARACTERS,
      )) {
    return { status: "invalid", message: "House private narrative notebook is malformed." };
  }
  if (!Array.isArray(continuity.recentBeats) || continuity.recentBeats.length > MAX_RECENT_BEATS) {
    return { status: "invalid", message: "House recent narrative beats are malformed." };
  }
  const recentBeats = continuity.recentBeats.map(parseBeat);
  if (recentBeats.some((beat) => beat === null)) {
    return { status: "invalid", message: "House recent narrative beats are malformed." };
  }
  const parsedRecentBeats = recentBeats as HouseNarrativeBeat[];
  if (parsedRecentBeats.some((beat) => beat.boundary.gameId !== continuity.gameId)) {
    return { status: "invalid", message: "House recent narrative beats belong to another game." };
  }
  const ids = parsedRecentBeats.map((beat) => beat.boundary.id);
  if (new Set(ids).size !== ids.length) return { status: "invalid", message: "House recent narrative beats contain duplicate boundaries." };
  for (const field of ["examinedCanonicalHead", "examinedDialogueHead"] as const) {
    if (!nonNegativeInteger(continuity[field])) return { status: "invalid", message: `House narrative continuity ${field} is malformed.` };
  }
  if (continuity.pendingDeltaCarry !== 0 && continuity.pendingDeltaCarry !== 1) return { status: "invalid", message: "House narrative continuity pending delta is malformed." };
  return {
    status: "valid",
    value: {
      ...structuredClone(value) as HouseNarrativeContinuityV2,
      recentBeats: parsedRecentBeats,
    },
  };
}

export function appendRecentHouseNarrativeBeat(previous: readonly HouseNarrativeBeat[], beat: HouseNarrativeBeat): HouseNarrativeBeat[] {
  return [...previous.filter((entry) => entry.boundary.id !== beat.boundary.id), beat]
    .slice(-MAX_RECENT_BEATS)
    .map((entry) => structuredClone(entry));
}

function toNarrationDialogue(
  entry: HouseNarrationTranscriptEntry & { entrySequence: number },
  fallbackKind: string,
): HouseNarrationDialogue {
  return {
    sequence: entry.entrySequence,
    round: entry.round,
    phase: entry.phase,
    speaker: entry.anonymous ? "Anonymous" : normalizeContextLabel(entry.from),
    text: entry.text,
    anonymous: entry.anonymous === true,
    dialogueKind: entry.dialogueKind === "system_elimination"
      ? "system_exit"
      : entry.dialogueKind ?? fallbackKind,
  };
}

function hasDialogueSequence(
  entry: HouseNarrationTranscriptEntry,
): entry is HouseNarrationTranscriptEntry & { entrySequence: number } {
  return typeof entry.entrySequence === "number";
}

export function compileHouseNarrationContext(input: CompileHouseNarrationContextInput): HouseNarrationContext {
  const canonicalHead = input.events.at(-1)?.sequence ?? input.projection.lastSequence;
  const dialogueHead = input.transcript.reduce((head, entry) => Math.max(head, entry.entrySequence ?? 0), input.afterDialogueSequence);
  const boundary: HouseSummaryBoundary = {
    version: 2,
    id: `house-beat/v2:${input.round}:${input.actorCoordinate}:${canonicalHead}:${dialogueHead}`,
    gameId: input.projection.gameId,
    actorCoordinate: input.actorCoordinate,
    round: input.round,
    phase: input.phase,
    beatClass: input.beatClass,
    canonicalHead,
    dialogueHead,
  };
  const playerNamesById = Object.fromEntries(
    input.projection.playerOrder.map((id) => [id, playerName(input.projection, id) ?? "Unknown player"]),
  );
  const deltaEvents = input.events.filter((event) => event.sequence > input.afterCanonicalSequence);
  const canonicalEvents = deltaEvents
    .map((event) => narrationEvent(event, input.projection))
    .filter((event): event is HouseNarrationCanonicalEvent => event !== null)
    .slice(-MAX_EVENT_ROWS);
  const publicDialogue = input.transcript.filter((entry): entry is HouseNarrationTranscriptEntry & { entrySequence: number } => entry.scope === "public"
      && hasDialogueSequence(entry) && entry.entrySequence > input.afterDialogueSequence
      && entry.from !== "House" && entry.dialogueKind !== "house_summary")
    .slice(-MAX_DIALOGUE_ROWS)
    .map((entry) => toNarrationDialogue(entry, "public_speech"));
  const privateDialogueAndDecisions = input.beatClass === "milestone"
    ? input.transcript.filter((entry): entry is HouseNarrationTranscriptEntry & { entrySequence: number } => entry.scope !== "public"
        && hasDialogueSequence(entry) && entry.entrySequence > input.afterDialogueSequence
        && entry.from !== "House" && entry.dialogueKind !== "house_summary")
      .slice(-MAX_DIALOGUE_ROWS)
      .map((entry) => toNarrationDialogue(entry, entry.scope))
    : [];
  const diaryEntries = input.beatClass === "milestone"
    ? input.diaryEntries.slice(-8).map((entry): HouseNarrationDiaryEntry => ({
        round: entry.round,
        precedingPhase: entry.precedingPhase,
        player: normalizeContextLabel(entry.agentName),
        question: entry.question,
        answer: entry.answer,
      }))
    : [];
  const projection = deltaEvents.some((event) => PROJECTION_TRIGGER_TYPES.has(event.type)) ? compileProjection(input.projection) : null;
  return {
    version: 2,
    boundary,
    material: canonicalEvents.length > 0 || projection !== null || publicDialogue.length > 0
      || privateDialogueAndDecisions.length > 0 || diaryEntries.length > 0,
    playerNamesById,
    canonicalEvents,
    projection,
    publicDialogue,
    privateDialogueAndDecisions,
    diaryEntries,
  };
}

export function isHouseSummaryActorCoordinate(value: unknown): value is HouseSummaryActorCoordinate {
  return typeof value === "string" && (HOUSE_SUMMARY_ACTOR_COORDINATES as readonly string[]).includes(value);
}
