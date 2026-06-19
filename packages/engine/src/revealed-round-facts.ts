import type { CanonicalGameEvent } from "./canonical-events";
import { replayCanonicalEvents, type CanonicalGameProjection } from "./game-projection";
import { PlayerStatus, type Phase, type PowerActionType, type UUID } from "./types";

export type RevealedFactsStatus = "available" | "not_yet_resolved" | "not_yet_flushed" | "unavailable";

export type RevealedCanonicalFactsStatus = "available" | "not_yet_flushed" | "unavailable";

export type RevealedFactsDiagnosticSeverity = "info" | "warning" | "error";

export interface RevealedRoundFactsDiagnostic {
  code: string;
  severity: RevealedFactsDiagnosticSeverity;
  message: string;
}

export interface RevealedPlayerRef {
  id: UUID;
  name: string;
}

export interface RevealedVoteLedgerEntry {
  voter: RevealedPlayerRef;
  empowerTarget: RevealedPlayerRef;
  exposeTarget: RevealedPlayerRef;
  revoteEmpowerTarget: RevealedPlayerRef | null;
}

export interface RevealedCouncilVoteLedgerEntry {
  voter: RevealedPlayerRef;
  target: RevealedPlayerRef;
}

export interface RevealedVoteCount {
  player: RevealedPlayerRef;
  votes: number;
}

export interface RevealedExposureBenchEntry {
  player: RevealedPlayerRef;
  exposeScore: number | null;
}

export interface RevealedExposureResolutionSummary {
  status: RevealedFactsStatus;
  mode: string | null;
  exposureBench: RevealedExposureBenchEntry[];
  lockedCandidates: RevealedPlayerRef[];
  eligibleCandidates: RevealedPlayerRef[];
  selectedCandidates: RevealedPlayerRef[];
  fallbackApplied: boolean | null;
  fallbackReason: string | null;
}

export interface RevealedPowerActionSummary {
  action: PowerActionType;
  target: RevealedPlayerRef | null;
}

export interface RevealedStandardVoteFacts {
  status: RevealedFactsStatus;
  ledger: RevealedVoteLedgerEntry[];
  empowerTally: RevealedVoteCount[];
  empowered: RevealedPlayerRef | null;
  method: string | null;
  tied: RevealedPlayerRef[];
}

export interface RevealedPowerFacts {
  status: RevealedFactsStatus;
  exposureScores: RevealedVoteCount[];
  exposureBench: RevealedExposureResolutionSummary;
  shieldReplacement: RevealedExposureResolutionSummary | null;
  action: RevealedPowerActionSummary | null;
  shieldGranted: RevealedPlayerRef | null;
  autoEliminated: RevealedPlayerRef | null;
  finalCouncilCandidates: RevealedPlayerRef[];
  method: string | null;
}

export interface RevealedCouncilFacts {
  status: RevealedFactsStatus;
  ledger: RevealedCouncilVoteLedgerEntry[];
  eliminated: RevealedPlayerRef | null;
  method: string | null;
  candidates: RevealedPlayerRef[];
}

export interface RevealedRoundFacts {
  round: number;
  phase: Phase | null;
  players: {
    alive: RevealedPlayerRef[];
    eliminated: RevealedPlayerRef[];
  };
  standardVote: RevealedStandardVoteFacts;
  power: RevealedPowerFacts;
  council: RevealedCouncilFacts;
}

export interface RevealedRoundFactsAvailability {
  canonicalFactsStatus: RevealedCanonicalFactsStatus;
  eventLogStatus: string;
  projectionStatus: string;
  artifactDerivedFacts: {
    status: "not_used";
    reason: string;
  };
  diagnostics: RevealedRoundFactsDiagnostic[];
}

export interface RevealedRoundFactsRead {
  roundFacts: RevealedRoundFacts;
  availability: RevealedRoundFactsAvailability;
}

export interface BuildRevealedRoundFactsOptions {
  events: readonly CanonicalGameEvent[];
  round?: number;
  eventLogStatus?: string;
  projectionStatus?: string;
}

type EventOf<TType extends CanonicalGameEvent["type"]> = Extract<CanonicalGameEvent, { type: TType }>;

const ARTIFACT_FACTS_NOT_USED_REASON = "Decision logs and cognitive artifacts are not authoritative game facts.";

export function buildRevealedRoundFacts(options: BuildRevealedRoundFactsOptions): RevealedRoundFactsRead {
  const eventLogStatus = options.eventLogStatus ?? (options.events.length === 0 ? "empty" : "complete");
  const projectionStatus = options.projectionStatus ?? (options.events.length === 0 ? "empty" : "complete");

  if (eventLogStatus === "empty" || options.events.length === 0) {
    const round = options.round ?? 0;
    return {
      roundFacts: emptyRoundFacts(round, null, emptyPlayers(), "not_yet_flushed"),
      availability: availability("not_yet_flushed", eventLogStatus, projectionStatus, [
        {
          code: "canonical_event_log_empty",
          severity: "info",
          message: "Canonical gameplay facts have not been persisted yet.",
        },
      ]),
    };
  }

  if (eventLogStatus === "invalid" || projectionStatus === "failed") {
    const round = options.round ?? latestRound(options.events);
    return unavailableFactsRead(round, eventLogStatus, projectionStatus);
  }

  let latestProjection: CanonicalGameProjection;
  try {
    latestProjection = replayCanonicalEvents(options.events);
  } catch {
    const round = options.round ?? latestRound(options.events);
    return unavailableFactsRead(round, eventLogStatus, projectionStatus);
  }

  const round = options.round ?? latestProjection.round;
  const roundEvents = options.events.filter((event) => event.round === round);
  if (roundEvents.length === 0) {
    return {
      roundFacts: emptyRoundFacts(round, latestProjection.phase, playerGroups(latestProjection), "not_yet_flushed"),
      availability: availability("not_yet_flushed", eventLogStatus, projectionStatus, [
        {
          code: "round_canonical_events_not_found",
          severity: "info",
          message: "No persisted canonical events were found for this round.",
        },
      ]),
    };
  }

  let roundProjection = latestProjection;
  try {
    roundProjection = replayCanonicalEvents(options.events.filter((event) => event.round <= round));
  } catch {
    // Fall back to the latest trusted projection for player refs while reporting the replay issue.
  }

  const phase = roundPhase(roundEvents, round === latestProjection.round ? latestProjection.phase : roundProjection.phase);
  const players = playerGroups(roundProjection);
  const standardVote = buildStandardVoteFacts(roundEvents, roundProjection);
  const power = buildPowerFacts(roundEvents, roundProjection, standardVote);
  const council = buildCouncilFacts(roundEvents, roundProjection);
  const diagnostics = sectionDiagnostics(standardVote, power, council);

  return {
    roundFacts: {
      round,
      phase,
      players,
      standardVote,
      power,
      council,
    },
    availability: availability("available", eventLogStatus, projectionStatus, diagnostics),
  };
}

function buildStandardVoteFacts(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
): RevealedStandardVoteFacts {
  const voteEvents = eventsOfType(events, "vote.cast");
  const revoteEvents = eventsOfType(events, "vote.empower_revote_cast");
  const tally = latestEvent(events, "vote.empower_tally_resolved");
  const empoweredSet = latestEvent(events, "vote.empowered_set");
  const resolved = Boolean(empoweredSet || (tally && tally.payload.tied === null));

  if (!resolved) {
    return emptyStandardVote("not_yet_resolved");
  }

  const revotes = new Map<UUID, UUID>();
  for (const event of revoteEvents) revotes.set(event.payload.voterId, event.payload.target);

  const ledger = sortByPlayerOrder(voteEvents, projection, (event) => event.payload.voterId).map((event) => ({
    voter: playerRef(projection, event.payload.voterId),
    empowerTarget: playerRef(projection, event.payload.empowerTarget),
    exposeTarget: playerRef(projection, event.payload.exposeTarget),
    revoteEmpowerTarget: refOrNull(projection, revotes.get(event.payload.voterId)),
  }));

  const empoweredId = empoweredSet?.payload.empowered ?? tally?.payload.empowered ?? null;
  const method = empoweredSet?.payload.method ?? tally?.payload.method ?? null;

  return {
    status: "available",
    ledger,
    empowerTally: tally ? countsToVoteCounts(tally.payload.counts, projection) : [],
    empowered: refOrNull(projection, empoweredId),
    method,
    tied: tally?.payload.tied ? tally.payload.tied.map((id) => playerRef(projection, id)) : [],
  };
}

function buildPowerFacts(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
  standardVote: RevealedStandardVoteFacts,
): RevealedPowerFacts {
  const actionEvent = latestEvent(events, "power.action_set");
  const candidatesEvent = latestEvent(events, "power.candidates_resolved");

  if (!actionEvent && !candidatesEvent) {
    return emptyPower("not_yet_resolved");
  }

  const action = actionEvent
    ? {
        action: actionEvent.payload.action.action,
        target: actionEvent.payload.action.action === "pass"
          ? null
          : playerRef(projection, actionEvent.payload.action.target),
      }
    : null;

  if (!candidatesEvent) {
    return {
      ...emptyPower("not_yet_resolved"),
      action,
      exposureScores: exposureScoresFromStandardVote(standardVote, projection),
    };
  }

  return {
    status: "available",
    exposureScores: countsToVoteCounts(candidatesEvent.payload.exposeScores, projection),
    exposureBench: sanitizeExposureResolution(candidatesEvent.payload.initialResolution, projection),
    shieldReplacement: candidatesEvent.payload.shieldReplacement
      ? sanitizeExposureResolution(candidatesEvent.payload.shieldReplacement, projection)
      : null,
    action,
    shieldGranted: refOrNull(projection, candidatesEvent.payload.shieldGranted),
    autoEliminated: refOrNull(projection, candidatesEvent.payload.autoEliminated),
    finalCouncilCandidates: candidatesEvent.payload.candidates
      ? candidatesEvent.payload.candidates.map((id) => playerRef(projection, id))
      : [],
    method: candidatesEvent.payload.method,
  };
}

function buildCouncilFacts(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
): RevealedCouncilFacts {
  const resolved = latestEvent(events, "council.elimination_resolved");

  if (!resolved) {
    return emptyCouncil("not_yet_resolved");
  }

  const ledger = sortCouncilVotes(resolved.payload.tally.votes, projection).map(([voterId, targetId]) => ({
    voter: playerRef(projection, voterId),
    target: playerRef(projection, targetId),
  }));

  return {
    status: "available",
    ledger,
    eliminated: playerRef(projection, resolved.payload.eliminated),
    method: resolved.payload.method,
    candidates: resolved.payload.candidates.map((id) => playerRef(projection, id)),
  };
}

function sectionDiagnostics(
  standardVote: RevealedStandardVoteFacts,
  power: RevealedPowerFacts,
  council: RevealedCouncilFacts,
): RevealedRoundFactsDiagnostic[] {
  const diagnostics: RevealedRoundFactsDiagnostic[] = [];
  if (standardVote.status !== "available") {
    diagnostics.push({
      code: "standard_vote_not_yet_resolved",
      severity: "info",
      message: "Standard vote facts are not revealed until the empower result is resolved.",
    });
  }
  if (power.status !== "available") {
    diagnostics.push({
      code: "power_not_yet_resolved",
      severity: "info",
      message: "Power facts are not revealed until the power outcome is persisted.",
    });
  }
  if (council.status !== "available") {
    diagnostics.push({
      code: "council_not_yet_resolved",
      severity: "info",
      message: "Council vote facts are not revealed until elimination is resolved.",
    });
  }
  return diagnostics;
}

function availability(
  canonicalFactsStatus: RevealedCanonicalFactsStatus,
  eventLogStatus: string,
  projectionStatus: string,
  diagnostics: RevealedRoundFactsDiagnostic[],
): RevealedRoundFactsAvailability {
  return {
    canonicalFactsStatus,
    eventLogStatus,
    projectionStatus,
    artifactDerivedFacts: {
      status: "not_used",
      reason: ARTIFACT_FACTS_NOT_USED_REASON,
    },
    diagnostics,
  };
}

function unavailableFactsRead(
  round: number,
  eventLogStatus: string,
  projectionStatus: string,
): RevealedRoundFactsRead {
  return {
    roundFacts: emptyRoundFacts(round, null, emptyPlayers(), "unavailable"),
    availability: availability("unavailable", eventLogStatus, projectionStatus, [
      {
        code: "canonical_event_log_unavailable",
        severity: "warning",
        message: "Canonical gameplay facts are unavailable from the persisted event log.",
      },
    ]),
  };
}

function emptyRoundFacts(
  round: number,
  phase: Phase | null,
  players: RevealedRoundFacts["players"],
  status: RevealedFactsStatus,
): RevealedRoundFacts {
  return {
    round,
    phase,
    players,
    standardVote: emptyStandardVote(status),
    power: emptyPower(status),
    council: emptyCouncil(status),
  };
}

function emptyPlayers(): RevealedRoundFacts["players"] {
  return { alive: [], eliminated: [] };
}

function emptyStandardVote(status: RevealedFactsStatus): RevealedStandardVoteFacts {
  return {
    status,
    ledger: [],
    empowerTally: [],
    empowered: null,
    method: null,
    tied: [],
  };
}

function emptyExposureResolution(status: RevealedFactsStatus): RevealedExposureResolutionSummary {
  return {
    status,
    mode: null,
    exposureBench: [],
    lockedCandidates: [],
    eligibleCandidates: [],
    selectedCandidates: [],
    fallbackApplied: null,
    fallbackReason: null,
  };
}

function emptyPower(status: RevealedFactsStatus): RevealedPowerFacts {
  return {
    status,
    exposureScores: [],
    exposureBench: emptyExposureResolution(status),
    shieldReplacement: null,
    action: null,
    shieldGranted: null,
    autoEliminated: null,
    finalCouncilCandidates: [],
    method: null,
  };
}

function emptyCouncil(status: RevealedFactsStatus): RevealedCouncilFacts {
  return {
    status,
    ledger: [],
    eliminated: null,
    method: null,
    candidates: [],
  };
}

function latestRound(events: readonly CanonicalGameEvent[]): number {
  return events.at(-1)?.round ?? 0;
}

function roundPhase(events: readonly CanonicalGameEvent[], fallback: Phase | null): Phase | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.phase) return event.phase;
  }
  return fallback;
}

function playerGroups(projection: CanonicalGameProjection): RevealedRoundFacts["players"] {
  const refs = projection.playerOrder.map((id) => ({
    player: projection.players[id],
    ref: playerRef(projection, id),
  }));
  return {
    alive: refs
      .filter(({ player }) => player?.status === PlayerStatus.ALIVE)
      .map(({ ref }) => ref),
    eliminated: refs
      .filter(({ player }) => player?.status === PlayerStatus.ELIMINATED)
      .map(({ ref }) => ref),
  };
}

function playerRef(projection: CanonicalGameProjection, id: UUID): RevealedPlayerRef {
  return {
    id,
    name: projection.players[id]?.name ?? id,
  };
}

function refOrNull(projection: CanonicalGameProjection, id: UUID | null | undefined): RevealedPlayerRef | null {
  return id ? playerRef(projection, id) : null;
}

function eventsOfType<TType extends CanonicalGameEvent["type"]>(
  events: readonly CanonicalGameEvent[],
  type: TType,
): Array<EventOf<TType>> {
  return events.filter((event): event is EventOf<TType> => event.type === type);
}

function latestEvent<TType extends CanonicalGameEvent["type"]>(
  events: readonly CanonicalGameEvent[],
  type: TType,
): EventOf<TType> | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type === type) return event as EventOf<TType>;
  }
  return null;
}

function playerOrderIndex(projection: CanonicalGameProjection, id: UUID): number {
  const index = projection.playerOrder.indexOf(id);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function sortByPlayerOrder<T>(
  values: readonly T[],
  projection: CanonicalGameProjection,
  getPlayerId: (value: T) => UUID,
): T[] {
  return [...values].sort((left, right) => {
    const leftIndex = playerOrderIndex(projection, getPlayerId(left));
    const rightIndex = playerOrderIndex(projection, getPlayerId(right));
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return getPlayerId(left).localeCompare(getPlayerId(right));
  });
}

function countsToVoteCounts(counts: Record<UUID, number>, projection: CanonicalGameProjection): RevealedVoteCount[] {
  return Object.entries(counts)
    .map(([playerId, votes]) => ({ player: playerRef(projection, playerId), votes }))
    .sort((left, right) => {
      if (right.votes !== left.votes) return right.votes - left.votes;
      return playerOrderIndex(projection, left.player.id) - playerOrderIndex(projection, right.player.id);
    });
}

function exposureScoresFromStandardVote(
  standardVote: RevealedStandardVoteFacts,
  projection: CanonicalGameProjection,
): RevealedVoteCount[] {
  if (standardVote.status !== "available") return [];
  const counts: Record<UUID, number> = {};
  for (const entry of standardVote.ledger) {
    counts[entry.exposeTarget.id] = (counts[entry.exposeTarget.id] ?? 0) + 1;
  }
  for (const playerId of projection.playerOrder) counts[playerId] ??= 0;
  return countsToVoteCounts(counts, projection);
}

function sortCouncilVotes(votes: Record<UUID, UUID>, projection: CanonicalGameProjection): Array<[UUID, UUID]> {
  return Object.entries(votes).sort(([leftVoter], [rightVoter]) => {
    const leftIndex = playerOrderIndex(projection, leftVoter);
    const rightIndex = playerOrderIndex(projection, rightVoter);
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return leftVoter.localeCompare(rightVoter);
  });
}

function sanitizeExposureResolution(
  value: Record<string, unknown> | undefined,
  projection: CanonicalGameProjection,
): RevealedExposureResolutionSummary {
  if (!value) return emptyExposureResolution("unavailable");
  return {
    status: "available",
    mode: stringValue(value.mode),
    exposureBench: exposureBenchEntries(value.exposureBench, projection),
    lockedCandidates: stringArray(value.lockedCandidates).map((id) => playerRef(projection, id)),
    eligibleCandidates: stringArray(value.eligibleCandidateIds).map((id) => playerRef(projection, id)),
    selectedCandidates: stringArray(value.selectedCandidateIds).map((id) => playerRef(projection, id)),
    fallbackApplied: booleanOrNull(value.fallbackApplied),
    fallbackReason: stringValue(value.fallbackReason),
  };
}

function exposureBenchEntries(value: unknown, projection: CanonicalGameProjection): RevealedExposureBenchEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: RevealedExposureBenchEntry[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    entries.push({
      player: playerRef(projection, item.id),
      exposeScore: typeof item.exposeScore === "number" ? item.exposeScore : null,
    });
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): UUID[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is UUID => typeof item === "string");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
