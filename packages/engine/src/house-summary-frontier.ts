import type { CanonicalGameEvent, CanonicalGameEventType } from "./canonical-events";
import type { CanonicalGameProjection } from "./game-projection";
import type { Phase, UUID } from "./types";
import type { StructuredDomainDecodeResult } from "./structured-output";

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

export type HouseAudienceClaimKind =
  | "canonical_event"
  | "projection_alive_count"
  | "dialogue_quote";

export interface HouseAudienceClaimSelection {
  kind: HouseAudienceClaimKind;
  sourceAlias: string;
}

export const CANONICAL_NARRATION_TYPES = [
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
] as const satisfies readonly CanonicalGameEventType[];

export type HouseNarratedCanonicalEvent = Extract<
  CanonicalGameEvent,
  { type: (typeof CANONICAL_NARRATION_TYPES)[number] }
>;

export type HouseSummarySourceValue =
  | {
      kind: "canonical_event";
      event: HouseNarratedCanonicalEvent;
      playerNamesById: Readonly<Record<UUID, string>>;
    }
  | {
      kind: "canonical_projection";
      headSequence: number;
      alivePlayerIds: readonly UUID[];
    }
  | {
      kind: "dialogue_non_authoritative";
      speakerPlayerId: UUID | null;
      speakerName: string;
      quote: string;
      anonymous: boolean;
      source: Extract<HouseSourceCoordinate, { kind: "transcript_entry" }>;
    };

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
  /**
   * Runner-private typed source snapshot. It is never serialized into a
   * provider prompt, accepted receipt, trace output, or viewer payload.
   */
  sourceValuesByAlias: ReadonlyMap<string, HouseSummarySourceValue>;
}

export interface HouseAudienceSummaryArtifact {
  version: typeof HOUSE_SUMMARY_FRONTIER_VERSION;
  boundary: HouseSummaryBoundary;
  claims: HouseAudienceClaimSelection[];
  sources: HouseSourceCoordinate[];
  renderedText: string;
}

export interface HouseNarrativeContinuity {
  version: typeof HOUSE_SUMMARY_FRONTIER_VERSION;
  lastBoundaryId: string | null;
  lastArtifact: HouseAudienceSummaryArtifact | null;
  /**
   * Last accepted artifact at each approved cadence coordinate. Claims and
   * sources are typed House evidence; renderedText is explicitly
   * non-authoritative narrative/style context.
   */
  lastArtifactByActorCoordinate: Partial<Record<HouseSummaryActorCoordinate, HouseAudienceSummaryArtifact>>;
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

const CANONICAL_NARRATION_TYPE_SET = new Set<CanonicalGameEventType>(CANONICAL_NARRATION_TYPES);

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

interface HouseProjectionRow {
  row: Omit<HouseFactRow, "alias">;
  sourceValue: Extract<HouseSummarySourceValue, { kind: "canonical_projection" }>;
}

function projectionRows(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
): HouseProjectionRow[] {
  if (!events.some((event) => PROJECTION_TRIGGER_TYPES.has(event.type))) return [];
  const source: HouseSourceCoordinate = {
    kind: "canonical_projection",
    headSequence: projection.lastSequence,
    projection: "public_house_frontier_v1",
    round: projection.round,
    phase: projection.phase,
  };
  const alivePlayerIds = projection.playerOrder.filter(
    (id) => projection.players[id]?.status === "alive",
  );
  const alive = alivePlayerIds
    .map((id) => projection.players[id])
    .map((player) => normalizeProviderString(player!.name, 80));
  const eliminated = projection.playerOrder
    .map((id) => projection.players[id])
    .filter((player) => player?.status === "eliminated")
    .map((player) => normalizeProviderString(player!.name, 80));
  return [{
    row: {
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
    },
    sourceValue: {
      kind: "canonical_projection",
      headSequence: projection.lastSequence,
      alivePlayerIds,
    },
  }];
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
    lastArtifact: null,
    lastArtifactByActorCoordinate: {},
    examinedCanonicalHead: 0,
    examinedDialogueHead: 0,
    emittedCanonicalHead: 0,
    emittedDialogueHead: 0,
    pendingDeltaCarry: 0,
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => keys.includes(key)) ? record : null;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseHouseSourceCoordinate(value: unknown): HouseSourceCoordinate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.kind !== "string" || !nonNegativeInteger(candidate.round)) return null;
  const keys = candidate.kind === "canonical_event"
    ? ["kind", "sequence", "type", "round", "phase"]
    : candidate.kind === "canonical_projection"
      ? ["kind", "headSequence", "projection", "round", "phase"]
      : candidate.kind === "transcript_entry"
        ? ["kind", "sequence", "round", "phase", "dialogueKind"]
        : [];
  const base = exactRecord(value, keys);
  if (!base) return null;
  if (base.kind === "canonical_event") {
    return nonNegativeInteger(base.sequence)
      && typeof base.type === "string"
      && (base.phase === null || typeof base.phase === "string")
      ? value as HouseSourceCoordinate
      : null;
  }
  if (base.kind === "canonical_projection") {
    return nonNegativeInteger(base.headSequence)
      && typeof base.projection === "string"
      && (base.phase === null || typeof base.phase === "string")
      ? value as HouseSourceCoordinate
      : null;
  }
  if (base.kind === "transcript_entry") {
    return nonNegativeInteger(base.sequence)
      && typeof base.phase === "string"
      && typeof base.dialogueKind === "string"
      ? value as HouseSourceCoordinate
      : null;
  }
  return null;
}

function parseHouseAudienceSummaryArtifact(
  value: unknown,
): HouseAudienceSummaryArtifact | null {
  const artifact = exactRecord(value, ["version", "boundary", "claims", "sources", "renderedText"]);
  if (!artifact || artifact.version !== HOUSE_SUMMARY_FRONTIER_VERSION) return null;
  const boundary = exactRecord(artifact.boundary, [
    "version",
    "id",
    "gameId",
    "actorCoordinate",
    "round",
    "phase",
    "beatClass",
    "canonicalHead",
    "dialogueHead",
  ]);
  if (
    !boundary
    || boundary.version !== HOUSE_SUMMARY_FRONTIER_VERSION
    || typeof boundary.id !== "string"
    || !boundary.id
    || typeof boundary.gameId !== "string"
    || !HOUSE_SUMMARY_ACTOR_COORDINATES.includes(boundary.actorCoordinate as HouseSummaryActorCoordinate)
    || !nonNegativeInteger(boundary.round)
    || typeof boundary.phase !== "string"
    || (boundary.beatClass !== "ordinary" && boundary.beatClass !== "milestone")
    || !nonNegativeInteger(boundary.canonicalHead)
    || !nonNegativeInteger(boundary.dialogueHead)
  ) return null;
  if (!Array.isArray(artifact.claims) || artifact.claims.length > 8) return null;
  const claims = artifact.claims.map((claim) => exactRecord(claim, ["kind", "sourceAlias"]));
  if (claims.some((claim) => !claim)) return null;
  const aliases = new Set<string>();
  for (const claim of claims as Record<string, unknown>[]) {
    if (
      !["canonical_event", "projection_alive_count", "dialogue_quote"].includes(String(claim.kind))
      || typeof claim.sourceAlias !== "string"
      || !claim.sourceAlias
      || aliases.has(claim.sourceAlias)
    ) return null;
    aliases.add(claim.sourceAlias);
  }
  if (!Array.isArray(artifact.sources) || artifact.sources.length !== artifact.claims.length) return null;
  const sources = artifact.sources.map(parseHouseSourceCoordinate);
  if (sources.some((source) => source === null)) return null;
  for (const [index, claim] of (claims as Record<string, unknown>[]).entries()) {
    const source = sources[index]!;
    const matches = (claim.kind === "canonical_event" && source!.kind === "canonical_event")
      || (claim.kind === "projection_alive_count" && source!.kind === "canonical_projection")
      || (claim.kind === "dialogue_quote" && source!.kind === "transcript_entry");
    if (!matches) return null;
  }
  if (typeof artifact.renderedText !== "string" || artifact.renderedText.length > 8_000) return null;
  return structuredClone(value) as HouseAudienceSummaryArtifact;
}

/** Fail-closed parser for checkpointed House/producer/viewer narrative state. */
export function parseHouseNarrativeContinuity(
  value: unknown,
): StructuredDomainDecodeResult<HouseNarrativeContinuity> {
  const continuity = exactRecord(value, [
    "version",
    "lastBoundaryId",
    "lastArtifact",
    "lastArtifactByActorCoordinate",
    "examinedCanonicalHead",
    "examinedDialogueHead",
    "emittedCanonicalHead",
    "emittedDialogueHead",
    "pendingDeltaCarry",
  ]);
  if (!continuity || continuity.version !== HOUSE_SUMMARY_FRONTIER_VERSION) {
    return { status: "invalid", message: "House narrative continuity version is missing or unsupported." };
  }
  if (continuity.lastBoundaryId !== null && typeof continuity.lastBoundaryId !== "string") {
    return { status: "invalid", message: "House narrative continuity boundary ID is malformed." };
  }
  const lastArtifact = continuity.lastArtifact === null
    ? null
    : parseHouseAudienceSummaryArtifact(continuity.lastArtifact);
  if (continuity.lastArtifact !== null && !lastArtifact) {
    return { status: "invalid", message: "House narrative continuity last artifact is malformed." };
  }
  const byCoordinate = exactRecord(
    continuity.lastArtifactByActorCoordinate,
    HOUSE_SUMMARY_ACTOR_COORDINATES,
  );
  if (!byCoordinate) {
    return { status: "invalid", message: "House narrative continuity coordinate map is malformed." };
  }
  for (const artifact of Object.values(byCoordinate)) {
    if (!parseHouseAudienceSummaryArtifact(artifact)) {
      return { status: "invalid", message: "House narrative continuity contains a malformed coordinate artifact." };
    }
  }
  for (const field of [
    "examinedCanonicalHead",
    "examinedDialogueHead",
    "emittedCanonicalHead",
    "emittedDialogueHead",
  ] as const) {
    if (!nonNegativeInteger(continuity[field])) {
      return { status: "invalid", message: `House narrative continuity ${field} is malformed.` };
    }
  }
  if (continuity.pendingDeltaCarry !== 0 && continuity.pendingDeltaCarry !== 1) {
    return { status: "invalid", message: "House narrative continuity pending delta is malformed." };
  }
  if (
    (continuity.emittedCanonicalHead as number) > (continuity.examinedCanonicalHead as number)
    || (continuity.emittedDialogueHead as number) > (continuity.examinedDialogueHead as number)
  ) {
    return { status: "invalid", message: "House narrative continuity emitted heads exceed examined heads." };
  }
  if ((lastArtifact?.boundary.id ?? null) !== continuity.lastBoundaryId) {
    return { status: "invalid", message: "House narrative continuity boundary and last artifact disagree." };
  }
  return {
    status: "valid",
    value: structuredClone(value) as HouseNarrativeContinuity,
  };
}

/**
 * Retain one artifact per approved cadence coordinate and discard any keys
 * outside the authoritative coordinate tuple.
 */
export function retainHouseArtifactAtActorCoordinate(
  previous: HouseNarrativeContinuity["lastArtifactByActorCoordinate"],
  actorCoordinate: HouseSummaryActorCoordinate,
  artifact: HouseAudienceSummaryArtifact,
): HouseNarrativeContinuity["lastArtifactByActorCoordinate"] {
  const retained: HouseNarrativeContinuity["lastArtifactByActorCoordinate"] = {};
  for (const coordinate of HOUSE_SUMMARY_ACTOR_COORDINATES) {
    const value = coordinate === actorCoordinate ? artifact : previous[coordinate];
    if (value) retained[coordinate] = value;
  }
  return retained;
}

type CanonicalNarrationType = (typeof CANONICAL_NARRATION_TYPES)[number];
type CanonicalEventRendererRegistry = {
  [TType in CanonicalNarrationType]: (
    event: Extract<HouseNarratedCanonicalEvent, { type: TType }>,
    playerNameById: (id: UUID) => string,
  ) => string;
};

function displayToken(value: string): string {
  return value.split("_").join(" ");
}

function joinedNames(names: readonly string[]): string {
  if (names.length === 0) return "no players";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/** Fixed, exhaustive viewer renderer for every canonical summary event kind. */
export const HOUSE_CANONICAL_EVENT_RENDERERS: CanonicalEventRendererRegistry = {
  "game.roster_initialized": (event) =>
    `${joinedNames(event.payload.players.map((player) => player.name))} enter the game.`,
  "round.started": (event) => `Round ${event.payload.round} begins.`,
  "shields.expired": (event, name) => event.payload.expiredPlayerIds.length > 0
    ? `The shields expire for ${joinedNames(event.payload.expiredPlayerIds.map(name))}.`
    : "No shields carry into this round.",
  "vote.empower_tally_resolved": (event, name) =>
    `${name(event.payload.empowered)} wins Empowerment by ${displayToken(event.payload.method)}.`,
  "vote.empowered_set": (event, name) =>
    `${name(event.payload.empowered)} is Empowered by ${displayToken(event.payload.method)}.`,
  "format.menu_offered": (event, name) =>
    `${name(event.payload.empoweredId)} receives ${joinedNames(event.payload.offeredFormatIds.map(displayToken))} as format options.`,
  "format.selected": (event, name) =>
    `${name(event.payload.empoweredId)} selects ${displayToken(event.payload.formatId)}.`,
  "format.resolved": (event, name) =>
    `${displayToken(event.payload.formatId)} resolves, eliminating ${name(event.payload.eliminatedId)}.`,
  "power.action_set": (event, name) => event.payload.action.action === "pass"
    ? "The Empowered player passes on using the power."
    : `The Empowered player chooses to ${event.payload.action.action} ${name(event.payload.action.target)}.`,
  "power.candidates_resolved": (event, name) => event.payload.autoEliminated
    ? `${name(event.payload.autoEliminated)} is automatically eliminated by ${displayToken(event.payload.method)}.`
    : event.payload.candidates
      ? `${joinedNames(event.payload.candidates.map(name))} become the Council candidates.`
      : `Power resolves by ${displayToken(event.payload.method)} without Council candidates.`,
  "council.elimination_resolved": (event, name) =>
    `${name(event.payload.eliminated)} is eliminated by ${displayToken(event.payload.method)} at Council.`,
  "player.eliminated": (event) =>
    `${event.payload.playerName} leaves the game in round ${event.payload.eliminatedRound}.`,
  "endgame.stage_set": (event) =>
    `The endgame advances to ${displayToken(event.payload.stage)}.`,
  "endgame.elimination_resolved": (event, name) =>
    `${name(event.payload.eliminated)} is eliminated from ${displayToken(event.payload.stage ?? "endgame")}.`,
  "jury.winner_determined": (event, name) => {
    const winner = event.payload.voteCounts.find((count) => count.id === event.payload.winnerId);
    return `${name(event.payload.winnerId)} wins Influence${winner ? ` with ${winner.votes} jury vote${winner.votes === 1 ? "" : "s"}` : ""}.`;
  },
  "round.result_recorded": (event, name) =>
    `Round ${event.payload.result.round} ends with ${name(event.payload.result.eliminated)} eliminated.`,
};

export function expectedHouseAudienceClaimKind(
  source: HouseSummarySourceValue,
): HouseAudienceClaimKind {
  switch (source.kind) {
    case "canonical_event":
      return "canonical_event";
    case "canonical_projection":
      return "projection_alive_count";
    case "dialogue_non_authoritative":
      return "dialogue_quote";
  }
}

function renderCanonicalSource(
  source: Extract<HouseSummarySourceValue, { kind: "canonical_event" }>,
): string {
  const name = (id: UUID): string => {
    const value = source.playerNamesById[id];
    if (!value) throw new Error(`House summary source is missing player ${id}.`);
    return value;
  };
  const renderer = HOUSE_CANONICAL_EVENT_RENDERERS[source.event.type] as (
    event: HouseNarratedCanonicalEvent,
    playerNameById: (id: UUID) => string,
  ) => string;
  return renderer(source.event, name);
}

export function renderHouseAudienceClaims(
  frontier: HouseSummaryFrontier,
  claims: readonly HouseAudienceClaimSelection[],
): string {
  return claims.map((claim) => {
    const source = frontier.sourceValuesByAlias.get(claim.sourceAlias);
    if (!source) throw new Error(`House summary source alias ${claim.sourceAlias} is unavailable.`);
    if (expectedHouseAudienceClaimKind(source) !== claim.kind) {
      throw new Error(`House summary claim kind does not match source alias ${claim.sourceAlias}.`);
    }
    switch (source.kind) {
      case "canonical_event":
        return renderCanonicalSource(source);
      case "canonical_projection": {
        const count = source.alivePlayerIds.length;
        return `${count} player${count === 1 ? " remains" : "s remain"}.`;
      }
      case "dialogue_non_authoritative":
        if (!source.quote.trim()) throw new Error("House summary dialogue source is empty.");
        return `${source.speakerName}: “${source.quote}”`;
    }
  }).join(" ");
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
  const sourceValuesByAlias = new Map<string, HouseSummarySourceValue>();
  const playerNamesById = Object.fromEntries(
    input.projection.playerOrder.map((id) => [
      id,
      normalizeProviderString(input.projection.players[id]?.name ?? "Unknown player", 80),
    ]),
  ) as Record<UUID, string>;
  let nextAliasIndex = 0;
  const addFact = (
    row: Omit<HouseFactRow, "alias">,
    sourceValue: HouseSummarySourceValue,
  ): void => {
    const categoryFacts = factStore[row.category];
    if (categoryFacts.length >= MAX_FACT_ROWS_PER_CATEGORY) return;
    const alias = nextAlias(nextAliasIndex);
    categoryFacts.push({ ...row, alias });
    sourceValuesByAlias.set(alias, sourceValue);
    nextAliasIndex += 1;
  };
  const deltaEvents: CanonicalGameEvent[] = [];

  for (const event of input.events) {
    if (event.sequence <= input.afterCanonicalSequence) continue;
    deltaEvents.push(event);
    if (event.visibility !== "public" && event.visibility !== "system") continue;
    if (!CANONICAL_NARRATION_TYPE_SET.has(event.type)) continue;
    const data = safeEventData(event, input.projection);
    if (!data) continue;
    addFact(
      {
        category: "canonical_phase_facts",
        authority: "canonical_event",
        label: event.type,
        data,
        source: sourceForEvent(event),
      },
      {
        kind: "canonical_event",
        event: structuredClone(event) as HouseNarratedCanonicalEvent,
        playerNamesById,
      },
    );
  }

  for (const projectionRow of projectionRows(deltaEvents, input.projection)) {
    addFact(projectionRow.row, projectionRow.sourceValue);
  }

  for (const entry of input.transcript) {
    if (
      entry.scope !== "public"
      || typeof entry.entrySequence !== "number"
      || entry.entrySequence <= input.afterDialogueSequence
      || entry.from === "House"
    ) {
      continue;
    }
    const source: Extract<HouseSourceCoordinate, { kind: "transcript_entry" }> = {
      kind: "transcript_entry",
      sequence: entry.entrySequence,
      round: entry.round,
      phase: entry.phase,
      dialogueKind: entry.dialogueKind ?? "public_speech",
    };
    const speakerName = entry.anonymous ? "Anonymous" : normalizeProviderString(entry.from, 80);
    addFact(
      {
        category: "audience_dialogue_quotes",
        authority: "dialogue_non_authoritative",
        label: "Accepted public player dialogue",
        data: {
          speaker: speakerName,
          quote: normalizeProviderString(entry.text),
          anonymous: entry.anonymous === true,
          trust: "dialogue_non_authoritative",
        },
        source,
      },
      {
        kind: "dialogue_non_authoritative",
        speakerPlayerId: entry.speakerPlayerId ?? null,
        speakerName,
        quote: entry.text,
        anonymous: entry.anonymous === true,
        source,
      },
    );
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
    sourceValuesByAlias,
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
