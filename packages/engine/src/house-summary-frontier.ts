import type { CanonicalGameEvent, CanonicalGameEventType } from "./canonical-events";
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
  type: CanonicalGameEventType;
  round: number;
  phase: Phase | null;
  data: Record<string, unknown>;
}

export interface HouseNarrationProjection {
  headSequence: number;
  round: number;
  phase: Phase | null;
  alive: string[];
  eliminated: string[];
  empowered: string | null;
  selectedFormat: string | null;
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
const MAX_CONTEXT_STRING_CHARS = 280;
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

function normalizeContextString(value: string, maxChars = MAX_CONTEXT_STRING_CHARS): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function playerName(projection: CanonicalGameProjection, id: string | null | undefined): string | null {
  if (!id) return null;
  const name = projection.players[id]?.name;
  return name ? normalizeContextString(name, 80) : "Unknown player";
}

function namedCounts(projection: CanonicalGameProjection, counts: Record<string, number>): Array<{ player: string; value: number }> {
  return Object.entries(counts)
    .map(([id, value]) => ({ player: playerName(projection, id) ?? "Unknown player", value }))
    .sort((left, right) => left.player.localeCompare(right.player));
}

function narrationEventData(event: CanonicalGameEvent, projection: CanonicalGameProjection): Record<string, unknown> {
  switch (event.type) {
    case "game.roster_initialized": return { players: event.payload.players.map((player) => normalizeContextString(player.name, 80)) };
    case "round.started": return { round: event.payload.round };
    case "shields.expired": return { players: event.payload.expiredPlayerIds.map((id) => playerName(projection, id)) };
    case "vote.empower_tally_resolved": return {
      counts: namedCounts(projection, event.payload.counts),
      empowered: playerName(projection, event.payload.empowered),
      tied: event.payload.tied?.map((id) => playerName(projection, id)) ?? [],
      method: event.payload.method,
    };
    case "vote.empowered_set": return { empowered: playerName(projection, event.payload.empowered), method: event.payload.method };
    case "format.menu_offered": return { empowered: playerName(projection, event.payload.empoweredId), offeredFormats: [...event.payload.offeredFormatIds] };
    case "format.selected": return { empowered: playerName(projection, event.payload.empoweredId), selectedFormat: event.payload.formatId };
    case "format.ballot_cast": return {
      format: event.payload.formatId,
      voter: playerName(projection, event.payload.voterId),
      target: playerName(projection, event.payload.targetId),
      polarity: event.payload.polarity,
    };
    case "format.ballot_forfeited": return {
      format: event.payload.formatId,
      voter: playerName(projection, event.payload.voterId),
      reason: event.payload.reason,
    };
    case "format.resolved": return {
      selectedFormat: event.payload.formatId,
      empowered: playerName(projection, event.payload.empoweredId),
      eliminated: playerName(projection, event.payload.eliminatedId),
      resolutionKind: event.payload.resolutionKind,
      tied: event.payload.tiedPlayerIds.map((id) => playerName(projection, id)),
      tiebreaker: playerName(projection, event.payload.tiebreakerId),
    };
    case "power.action_set": return { action: event.payload.action.action, target: playerName(projection, event.payload.action.target) };
    case "power.candidates_resolved": return {
      candidates: event.payload.candidates?.map((id) => playerName(projection, id)) ?? [],
      autoEliminated: playerName(projection, event.payload.autoEliminated),
      shieldGranted: playerName(projection, event.payload.shieldGranted),
      method: event.payload.method,
    };
    case "council.elimination_resolved": return {
      candidates: event.payload.candidates.map((id) => playerName(projection, id)),
      eliminated: playerName(projection, event.payload.eliminated),
      method: event.payload.method,
    };
    case "player.eliminated": return { player: normalizeContextString(event.payload.playerName, 80), eliminatedRound: event.payload.eliminatedRound };
    case "endgame.stage_set": return { stage: event.payload.stage };
    case "endgame.elimination_resolved": return { stage: event.payload.stage, eliminated: playerName(projection, event.payload.eliminated), method: event.payload.method };
    case "jury.winner_determined": return {
      winner: playerName(projection, event.payload.winnerId),
      voteCounts: event.payload.voteCounts.map((count) => ({ player: normalizeContextString(count.name, 80), votes: count.votes })),
      method: event.payload.method,
    };
    case "round.result_recorded": return {
      round: event.payload.result.round,
      eliminated: playerName(projection, event.payload.result.eliminated),
      empowered: playerName(projection, event.payload.result.empoweredId),
    };
    default: return { payload: structuredClone(event.payload) };
  }
}

function compileProjection(projection: CanonicalGameProjection): HouseNarrationProjection {
  const alive = projection.playerOrder.map((id) => projection.players[id])
    .filter((player) => player?.status === "alive")
    .map((player) => normalizeContextString(player!.name, 80));
  const eliminated = projection.playerOrder.map((id) => projection.players[id])
    .filter((player) => player?.status === "eliminated")
    .map((player) => normalizeContextString(player!.name, 80));
  return {
    headSequence: projection.lastSequence,
    round: projection.round,
    phase: projection.phase,
    alive,
    eliminated,
    empowered: playerName(projection, projection.empoweredId),
    selectedFormat: projection.selectedFormatId,
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
    speaker: entry.anonymous ? "Anonymous" : normalizeContextString(entry.from, 80),
    text: normalizeContextString(entry.text),
    anonymous: entry.anonymous === true,
    dialogueKind: entry.dialogueKind ?? fallbackKind,
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
    .map((event): HouseNarrationCanonicalEvent => ({
      sequence: event.sequence,
      type: event.type,
      round: event.round,
      phase: event.phase,
      data: narrationEventData(event, input.projection),
    }))
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
        player: normalizeContextString(entry.agentName, 80),
        question: normalizeContextString(entry.question),
        answer: normalizeContextString(entry.answer),
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
