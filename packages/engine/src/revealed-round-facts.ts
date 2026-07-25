import type { CanonicalGameEvent } from "./canonical-events";
import type { LaunchFormatId } from "./formats";
import { resolveGameKernel, type GameKernel } from "./game-kernel";
import { replayCanonicalEvents, type CanonicalGameProjection } from "./game-projection";
import { PlayerStatus, type Phase, type PowerActionType, type UUID } from "./types";

export type RevealedFactsStatus = "available" | "not_yet_resolved" | "not_yet_flushed" | "unavailable";

export type RevealedCanonicalFactsStatus = "available" | "not_yet_flushed" | "unavailable";

export type RevealedFactsDiagnosticSeverity = "info" | "warning" | "error";

/**
 * Ballot ledger scope for format sealed ballots.
 * - public: never include voter→ballot mappings
 * - owner: include only ballots cast by ownedPlayerIds
 * - producer: full sealed ballot ledger
 */
export type RevealedFormatBallotAccessMode = "public" | "owner" | "producer";

export interface RevealedFormatBallotAccess {
  mode: RevealedFormatBallotAccessMode;
  /** Required when mode is "owner". */
  ownedPlayerIds?: ReadonlySet<UUID> | readonly UUID[];
}

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
  /**
   * Legacy dual-ballot expose target.
   * Omitted entirely on format-kernel empower-only ledgers (do not emit null noise).
   */
  exposeTarget?: RevealedPlayerRef | null;
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

export interface RevealedFormatBallotEntry {
  voter: RevealedPlayerRef;
  target: RevealedPlayerRef;
  /** Present for Save-or-Eliminate; null for Vote Bomb / Safety Bounce final votes. */
  polarity: "save" | "eliminate" | null;
}

export interface RevealedFormatBouncePointer {
  actor: RevealedPlayerRef;
  target: RevealedPlayerRef;
  classification: "safe" | "vulnerable";
}

export interface RevealedSaveOrEliminateFacts {
  nets: RevealedVoteCount[];
  savesReceived: RevealedVoteCount[];
  eliminateReceived: RevealedVoteCount[];
}

export interface RevealedVoteBombFacts {
  totals: RevealedVoteCount[];
  zeroSafe: RevealedPlayerRef[];
}

export interface RevealedSafetyBounceFacts {
  starter: RevealedPlayerRef | null;
  pointers: RevealedFormatBouncePointer[];
  safe: RevealedPlayerRef[];
  vulnerable: RevealedPlayerRef[];
  voteTotals: RevealedVoteCount[];
}

/**
 * Public format facts for format-kernel rounds.
 * Sealed ballots are never public; owner/producer scopes attach a filtered ledger.
 */
export interface RevealedFormatFacts {
  status: RevealedFactsStatus;
  empowered: RevealedPlayerRef | null;
  offeredFormatIds: [LaunchFormatId, LaunchFormatId] | null;
  selectedFormatId: LaunchFormatId | null;
  resolutionKind: "clear" | "auto" | null;
  eliminated: RevealedPlayerRef | null;
  tied: RevealedPlayerRef[];
  tiebreaker: RevealedPlayerRef | null;
  saveOrEliminate: RevealedSaveOrEliminateFacts | null;
  voteBomb: RevealedVoteBombFacts | null;
  safetyBounce: RevealedSafetyBounceFacts | null;
  /**
   * Sealed ballots: empty for public; owner-filtered for owner; full for producer.
   * Never includes thinking, reasoningContext, decision logs, or model metadata.
   */
  sealedBallots: RevealedFormatBallotEntry[];
  sealedBallotAccess: RevealedFormatBallotAccessMode;
}

export interface RevealedRoundFacts {
  round: number;
  phase: Phase | null;
  players: {
    alive: RevealedPlayerRef[];
    eliminated: RevealedPlayerRef[];
  };
  standardVote: RevealedStandardVoteFacts;
  /** Format-kernel public + scoped sealed-ballot facts. */
  format: RevealedFormatFacts;
  /**
   * Classic Power path only.
   * Omitted on format-kernel rounds (absence means not in kernel, not unresolved).
   */
  power?: RevealedPowerFacts;
  /**
   * Classic Council path only.
   * Omitted on format-kernel rounds (absence means not in kernel, not unresolved).
   */
  council?: RevealedCouncilFacts;
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
  /**
   * Resolved game kernel. When omitted, inferred via resolveGameKernel({ events }).
   * Callers with a stored column should pass the resolved kernel from resolveGameKernel.
   */
  kernel?: GameKernel;
  /**
   * Controls sealed format ballot inclusion. Defaults to public (no ballots).
   * Owner mode requires ownedPlayerIds; unknown modes fall back to public.
   */
  ballotAccess?: RevealedFormatBallotAccess;
}

type EventOf<TType extends CanonicalGameEvent["type"]> = Extract<CanonicalGameEvent, { type: TType }>;

const ARTIFACT_FACTS_NOT_USED_REASON = "Decision logs and cognitive artifacts are not authoritative game facts.";

export function buildRevealedRoundFacts(options: BuildRevealedRoundFactsOptions): RevealedRoundFactsRead {
  const eventLogStatus = options.eventLogStatus ?? (options.events.length === 0 ? "empty" : "complete");
  const projectionStatus = options.projectionStatus ?? (options.events.length === 0 ? "empty" : "complete");
  const kernel =
    options.kernel
    ?? resolveGameKernel({ events: options.events }).kernel;
  const includeClassicPowerCouncil = kernel === "classic";

  if (eventLogStatus === "empty" || options.events.length === 0) {
    const round = options.round ?? 0;
    return {
      roundFacts: emptyRoundFacts(round, null, emptyPlayers(), "not_yet_flushed", includeClassicPowerCouncil),
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
    return unavailableFactsRead(round, eventLogStatus, projectionStatus, includeClassicPowerCouncil);
  }

  let latestProjection: CanonicalGameProjection;
  try {
    latestProjection = replayCanonicalEvents(options.events);
  } catch {
    const round = options.round ?? latestRound(options.events);
    return unavailableFactsRead(round, eventLogStatus, projectionStatus, includeClassicPowerCouncil);
  }

  const round = options.round ?? latestProjection.round;
  const roundEvents = options.events.filter((event) => event.round === round);
  if (roundEvents.length === 0) {
    return {
      roundFacts: emptyRoundFacts(
        round,
        latestProjection.phase,
        playerGroups(latestProjection),
        "not_yet_flushed",
        includeClassicPowerCouncil,
      ),
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
  const standardVote = buildStandardVoteFacts(roundEvents, roundProjection, includeClassicPowerCouncil);
  const format = buildFormatFacts(roundEvents, roundProjection, options.ballotAccess);
  const power = includeClassicPowerCouncil
    ? buildPowerFacts(roundEvents, roundProjection, standardVote)
    : undefined;
  const council = includeClassicPowerCouncil
    ? buildCouncilFacts(roundEvents, roundProjection)
    : undefined;
  const diagnostics = sectionDiagnostics(standardVote, format, power, council, includeClassicPowerCouncil);

  return {
    roundFacts: {
      round,
      phase,
      players,
      standardVote,
      format,
      ...(power ? { power } : {}),
      ...(council ? { council } : {}),
    },
    availability: availability("available", eventLogStatus, projectionStatus, diagnostics),
  };
}

function buildStandardVoteFacts(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
  includeExposeTargets: boolean,
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
    ...(includeExposeTargets
      ? {
          exposeTarget: event.payload.exposeTarget
            ? playerRef(projection, event.payload.exposeTarget)
            : null,
        }
      : {}),
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

function buildFormatFacts(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
  ballotAccess: RevealedFormatBallotAccess | undefined,
): RevealedFormatFacts {
  const menu = latestEvent(events, "format.menu_offered");
  const selected = latestEvent(events, "format.selected");
  const resolved = latestEvent(events, "format.resolved");
  const bounceStarted = latestEvent(events, "format.safety_bounce_started");
  const bouncePointers = eventsOfType(events, "format.safety_bounce_pointer");
  const accessMode = normalizeBallotAccessMode(ballotAccess);

  if (!menu && !selected && !resolved && !bounceStarted && bouncePointers.length === 0) {
    return emptyFormat("not_yet_resolved", accessMode);
  }

  const offeredFormatIds = menu
    ? ([menu.payload.offeredFormatIds[0], menu.payload.offeredFormatIds[1]] as [
        LaunchFormatId,
        LaunchFormatId,
      ])
    : null;
  const empoweredId =
    resolved?.payload.empoweredId
    ?? selected?.payload.empoweredId
    ?? menu?.payload.empoweredId
    ?? null;
  const selectedFormatId =
    resolved?.payload.formatId
    ?? selected?.payload.formatId
    ?? null;

  const safetyBounce = buildSafetyBounceFacts(events, projection, resolved, bounceStarted);
  const saveOrEliminate = resolved?.payload.saveOrEliminate
    ? {
        nets: countsToVoteCounts(resolved.payload.saveOrEliminate.nets, projection),
        savesReceived: countsToVoteCounts(resolved.payload.saveOrEliminate.savesReceived, projection),
        eliminateReceived: countsToVoteCounts(
          resolved.payload.saveOrEliminate.eliminateReceived,
          projection,
        ),
      }
    : null;
  const voteBomb = resolved?.payload.voteBomb
    ? {
        totals: countsToVoteCounts(resolved.payload.voteBomb.totals, projection),
        zeroSafe: resolved.payload.voteBomb.zeroSafePlayerIds.map((id) => playerRef(projection, id)),
      }
    : null;

  const eliminatedId = resolved?.payload.eliminatedId ?? null;
  const rawTiedIds = resolved?.payload.tiedPlayerIds ?? [];
  const tiebreakerId = resolved?.payload.tiebreakerId ?? null;
  // Sole-auto noise: eliminated alone in tiedSet is not a multi-way tie for readers.
  // Multi-way pre-break history is kept when more than one id is present (incl. post-tiebreak).
  const tiedIds =
    eliminatedId !== null
    && rawTiedIds.length === 1
    && rawTiedIds[0] === eliminatedId
    && !tiebreakerId
      ? []
      : rawTiedIds;

  // Status: available once any public format fact exists (menu/pick/bounce/resolve).
  // Partial in-progress rounds still return available with null resolution fields.
  return {
    status: "available",
    empowered: refOrNull(projection, empoweredId),
    offeredFormatIds,
    selectedFormatId,
    resolutionKind: resolved?.payload.resolutionKind ?? null,
    eliminated: refOrNull(projection, eliminatedId),
    tied: tiedIds.map((id) => playerRef(projection, id)),
    tiebreaker: refOrNull(projection, tiebreakerId),
    saveOrEliminate,
    voteBomb,
    safetyBounce,
    sealedBallots: buildSealedFormatBallots(events, projection, ballotAccess),
    sealedBallotAccess: accessMode,
  };
}

function buildSafetyBounceFacts(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
  resolved: EventOf<"format.resolved"> | null,
  bounceStarted: EventOf<"format.safety_bounce_started"> | null,
): RevealedSafetyBounceFacts | null {
  const pointerEvents = eventsOfType(events, "format.safety_bounce_pointer");
  const resolvedBounce = resolved?.payload.safetyBounce ?? null;
  if (!bounceStarted && !resolvedBounce && pointerEvents.length === 0) {
    return null;
  }

  const starterId = resolvedBounce?.starterId ?? bounceStarted?.payload.starterId ?? null;
  const pointers = pointerEvents.map((event) => ({
    actor: playerRef(projection, event.payload.actorId),
    target: playerRef(projection, event.payload.targetId),
    classification: event.payload.classification,
  }));

  if (resolvedBounce) {
    return {
      starter: refOrNull(projection, starterId),
      pointers,
      safe: resolvedBounce.safePlayerIds.map((id) => playerRef(projection, id)),
      vulnerable: resolvedBounce.vulnerablePlayerIds.map((id) => playerRef(projection, id)),
      voteTotals: countsToVoteCounts(resolvedBounce.voteTotals, projection),
    };
  }

  // In-progress bounce: recompute pools from public pointer chain + starter.
  const classified = new Map<UUID, "safe" | "vulnerable">();
  if (starterId) classified.set(starterId, "safe");
  for (const event of pointerEvents) {
    classified.set(event.payload.targetId, event.payload.classification);
  }
  const safe: RevealedPlayerRef[] = [];
  const vulnerable: RevealedPlayerRef[] = [];
  for (const [id, classification] of classified) {
    const ref = playerRef(projection, id);
    if (classification === "safe") safe.push(ref);
    else vulnerable.push(ref);
  }

  return {
    starter: refOrNull(projection, starterId),
    pointers,
    safe,
    vulnerable,
    voteTotals: [],
  };
}

function normalizeBallotAccessMode(
  ballotAccess: RevealedFormatBallotAccess | undefined,
): RevealedFormatBallotAccessMode {
  if (!ballotAccess) return "public";
  if (ballotAccess.mode === "producer") return "producer";
  if (ballotAccess.mode === "owner") return "owner";
  return "public";
}

function ownedPlayerIdSet(
  ballotAccess: RevealedFormatBallotAccess | undefined,
): Set<UUID> {
  if (!ballotAccess || ballotAccess.mode !== "owner") return new Set();
  const raw = ballotAccess.ownedPlayerIds;
  if (!raw) return new Set();
  return raw instanceof Set ? new Set(raw) : new Set(raw);
}

/**
 * Sealed ballots are producer-visibility events. Public never sees them.
 * Owner sees only owned voters; producer sees the full ledger.
 * Cognitive fields never appear on these events or this projection.
 */
function buildSealedFormatBallots(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
  ballotAccess: RevealedFormatBallotAccess | undefined,
): RevealedFormatBallotEntry[] {
  const mode = normalizeBallotAccessMode(ballotAccess);
  if (mode === "public") return [];

  const ballotEvents = eventsOfType(events, "format.ballot_cast");
  const owned = mode === "owner" ? ownedPlayerIdSet(ballotAccess) : null;
  const filtered = ballotEvents.filter((event) => {
    if (mode === "producer") return true;
    return owned?.has(event.payload.voterId) ?? false;
  });

  return sortByPlayerOrder(filtered, projection, (event) => event.payload.voterId).map((event) => ({
    voter: playerRef(projection, event.payload.voterId),
    target: playerRef(projection, event.payload.targetId),
    polarity: event.payload.polarity,
  }));
}

function sectionDiagnostics(
  standardVote: RevealedStandardVoteFacts,
  format: RevealedFormatFacts,
  power: RevealedPowerFacts | undefined,
  council: RevealedCouncilFacts | undefined,
  includeClassicPowerCouncil: boolean,
): RevealedRoundFactsDiagnostic[] {
  const diagnostics: RevealedRoundFactsDiagnostic[] = [];
  if (standardVote.status !== "available") {
    diagnostics.push({
      code: "standard_vote_not_yet_resolved",
      severity: "info",
      message: "Standard vote facts are not revealed until the empower result is resolved.",
    });
  }
  if (format.status !== "available") {
    diagnostics.push({
      code: "format_not_yet_resolved",
      severity: "info",
      message: "Format facts are not available until a format menu or selection is persisted.",
    });
  } else if (!format.eliminated) {
    diagnostics.push({
      code: "format_in_progress",
      severity: "info",
      message: "Format menu or selection is available; elimination resolution has not flushed yet.",
    });
  }
  // Classic path only — format-kernel omits power/council keys entirely.
  if (includeClassicPowerCouncil) {
    if (power && power.status !== "available") {
      diagnostics.push({
        code: "power_not_yet_resolved",
        severity: "info",
        message: "Power facts are not revealed until the power outcome is persisted.",
      });
    }
    if (council && council.status !== "available") {
      diagnostics.push({
        code: "council_not_yet_resolved",
        severity: "info",
        message: "Council vote facts are not revealed until elimination is resolved.",
      });
    }
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
  includeClassicPowerCouncil: boolean,
): RevealedRoundFactsRead {
  return {
    roundFacts: emptyRoundFacts(round, null, emptyPlayers(), "unavailable", includeClassicPowerCouncil),
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
  includeClassicPowerCouncil: boolean,
): RevealedRoundFacts {
  return {
    round,
    phase,
    players,
    standardVote: emptyStandardVote(status),
    format: emptyFormat(status, "public"),
    ...(includeClassicPowerCouncil
      ? {
          power: emptyPower(status),
          council: emptyCouncil(status),
        }
      : {}),
  };
}

function emptyFormat(
  status: RevealedFactsStatus,
  sealedBallotAccess: RevealedFormatBallotAccessMode,
): RevealedFormatFacts {
  return {
    status,
    empowered: null,
    offeredFormatIds: null,
    selectedFormatId: null,
    resolutionKind: null,
    eliminated: null,
    tied: [],
    tiebreaker: null,
    saveOrEliminate: null,
    voteBomb: null,
    safetyBounce: null,
    sealedBallots: [],
    sealedBallotAccess,
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
    if (!entry.exposeTarget) continue;
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
