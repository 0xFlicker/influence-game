import type { CanonicalGameEvent } from "./canonical-events";
import { formatResolutionAggregate, type LaunchFormatId } from "./formats";
import { resolveGameKernel, type GameKernel } from "./game-kernel";
import { replayCanonicalEvents, type CanonicalGameProjection } from "./game-projection";
import { PlayerStatus, type Phase, type PowerActionType, type UUID } from "./types";
import {
  projectFormatBallotPresentation,
  reconstructSafetyBouncePrefix,
  type FormatBallotPresentationStatus,
} from "./viewer-decision-events";
import {
  booleanOrNull,
  exposureBenchEntries,
  stringArray,
  stringValue,
} from "./revealed-round-facts-values";

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
  /** Present for Save-or-Exit; null for The Short List / Safety Bounce final votes. */
  polarity: "save" | "eliminate" | null;
}

export type RevealedFormatBallotPresentationEntry =
  | RevealedFormatBallotEntry
  | {
      voter: RevealedPlayerRef;
      target: null;
      polarity: null;
      forfeited: true;
    };

export interface RevealedFormatBallotPresentation {
  status: FormatBallotPresentationStatus;
  rollCall: RevealedFormatBallotPresentationEntry[];
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

export interface RevealedMajorityEliminationFacts {
  totals: RevealedVoteCount[];
}

export interface RevealedEvenVotesFacts {
  totals: RevealedVoteCount[];
  eligible: RevealedPlayerRef[];
}

export interface RevealedRestrictedHistoryFacts {
  totals: RevealedVoteCount[];
  forfeited: RevealedPlayerRef[];
}

export interface RevealedSafetyBounceFacts {
  starter: RevealedPlayerRef | null;
  pointers: RevealedFormatBouncePointer[];
  safe: RevealedPlayerRef[];
  vulnerable: RevealedPlayerRef[];
  voteTotals: RevealedVoteCount[];
}

export interface RevealedTwoNamesPlea {
  speaker: RevealedPlayerRef;
  ordinal: 0 | 1;
  status: "accepted" | "absent";
  text: string | null;
}

export interface RevealedTwoNamesFacts {
  initialNominees: [RevealedPlayerRef, RevealedPlayerRef] | null;
  overrideHolder: RevealedPlayerRef | null;
  overrideAction: "declined" | "used" | null;
  removedNominee: RevealedPlayerRef | null;
  replacementNominee: RevealedPlayerRef | null;
  finalists: [RevealedPlayerRef, RevealedPlayerRef] | null;
  completedMingleWindows: Array<"initial_names" | "final_names">;
  pleas: RevealedTwoNamesPlea[];
  eligibleVoters: RevealedPlayerRef[];
  totals: RevealedVoteCount[];
}

/** Public format facts for format-kernel rounds. */
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
  majorityElimination: RevealedMajorityEliminationFacts | null;
  evenVotes: RevealedEvenVotesFacts | null;
  /** Added with Restricted History; absent only from older serialized fixtures. */
  restrictedHistory?: RevealedRestrictedHistoryFacts | null;
  safetyBounce: RevealedSafetyBounceFacts | null;
  /** Added with Two Names; absent only from older serialized fixtures. */
  twoNames?: RevealedTwoNamesFacts | null;
  /** Sanitized accepted ballots in canonical event order, readable immediately by operators. */
  acceptedBallots: RevealedFormatBallotEntry[];
  /** Resolution-gated, canonical roster-ordered presentation roll call. */
  ballotPresentation: RevealedFormatBallotPresentation;
}

export interface RevealedEndgameVoteEntry {
  voter: RevealedPlayerRef;
  target: RevealedPlayerRef;
}

/**
 * First-class endgame stage facts for Reckoning / Tribunal / Judgment.
 * Present only when the round has endgame or jury activity.
 */
export interface RevealedEndgameFacts {
  status: RevealedFactsStatus;
  stage: string | null;
  lastEmpoweredFromRegularRounds: RevealedPlayerRef | null;
  eliminationVotes: RevealedEndgameVoteEntry[];
  eliminated: RevealedPlayerRef | null;
  eliminationMethod: string | null;
  juryVotes: RevealedEndgameVoteEntry[];
  juryWinner: RevealedPlayerRef | null;
  juryMethod: string | null;
  /** Next stage id when known from a later stage_set, else winner when Judgment resolved. */
  progression: { kind: "stage"; stage: string } | { kind: "winner"; winner: RevealedPlayerRef } | null;
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
  /** Endgame stage facts when this round has Reckoning/Tribunal/Judgment activity. */
  endgame?: RevealedEndgameFacts;
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
  const format = buildFormatFacts(roundEvents, roundProjection);
  const power = includeClassicPowerCouncil
    ? buildPowerFacts(roundEvents, roundProjection, standardVote)
    : undefined;
  const council = includeClassicPowerCouncil
    ? buildCouncilFacts(roundEvents, roundProjection)
    : undefined;
  const endgame = buildEndgameFacts(roundEvents, options.events, roundProjection, round);
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
      ...(endgame ? { endgame } : {}),
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
): RevealedFormatFacts {
  const menu = latestEvent(events, "format.menu_offered");
  const selected = latestEvent(events, "format.selected");
  const resolved = latestEvent(events, "format.resolved");
  const bounceStarted = latestEvent(events, "format.safety_bounce_started");
  const hasBouncePointers = eventsOfType(events, "format.safety_bounce_pointer").length > 0;
  const hasBallots = eventsOfType(events, "format.ballot_cast").length > 0;
  const hasForfeitures = eventsOfType(events, "format.ballot_forfeited").length > 0;

  if (!menu && !selected && !resolved && !bounceStarted && !hasBouncePointers && !hasBallots && !hasForfeitures) {
    return emptyFormat("not_yet_resolved");
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

  const safetyBounce = buildSafetyBounceFacts(
    events,
    projection,
    resolved,
    bounceStarted,
    hasBouncePointers,
  );
  const aggregate = resolved ? formatResolutionAggregate(resolved) : null;
  const saveOrEliminate = aggregate?.capability === "sealed_polarity"
    ? {
        nets: countsToVoteCounts(aggregate.nets, projection),
        savesReceived: countsToVoteCounts(aggregate.savesReceived, projection),
        eliminateReceived: countsToVoteCounts(
          aggregate.eliminateReceived,
          projection,
        ),
      }
    : null;
  const voteBomb = resolved?.payload.formatId === "vote_bomb"
    && aggregate?.capability === "sealed_elim"
    ? {
        totals: countsToVoteCounts(aggregate.totals, projection),
        zeroSafe: Object.keys(aggregate.totals)
          .filter((id) => !aggregate.eligiblePlayerIds.includes(id))
          .map((id) => playerRef(projection, id)),
      }
    : null;
  const majorityElimination = resolved?.payload.formatId === "majority_elimination"
    && aggregate?.capability === "sealed_elim"
    ? {
        totals: countsToVoteCounts(aggregate.totals, projection),
      }
    : null;
  const evenVotes = resolved?.payload.formatId === "even_votes"
    && aggregate?.capability === "sealed_elim"
    ? {
        totals: countsToVoteCounts(aggregate.totals, projection),
        eligible: aggregate.eligiblePlayerIds.map((id) => playerRef(projection, id)),
      }
    : null;
  const restrictedHistory = resolved?.payload.formatId === "restricted_history"
    && aggregate?.capability === "sealed_elim"
    ? {
        totals: countsToVoteCounts(aggregate.totals, projection),
        forfeited: eventsOfType(events, "format.ballot_forfeited")
          .map((event) => playerRef(projection, event.payload.voterId)),
      }
    : null;
  const twoNamesSetup = latestEvent(events, "format.two_names_setup");
  const twoNamesDeclined = latestEvent(events, "format.two_names_override_declined");
  const twoNamesUsed = latestEvent(events, "format.two_names_override_used");
  const twoNamesReplacement = latestEvent(events, "format.two_names_replacement_named");
  const twoNamesAggregate = aggregate?.capability === "two_names" ? aggregate : null;
  const twoNamesFinalistIds = twoNamesReplacement?.payload.finalistPlayerIds
    ?? twoNamesDeclined?.payload.finalistPlayerIds
    ?? twoNamesAggregate?.finalistPlayerIds
    ?? null;
  const twoNames = selectedFormatId === "two_names" || twoNamesSetup || twoNamesAggregate
    ? {
        initialNominees: twoNamesSetup
          ? ([
              playerRef(projection, twoNamesSetup.payload.initialNomineeIds[0]),
              playerRef(projection, twoNamesSetup.payload.initialNomineeIds[1]),
            ] as [RevealedPlayerRef, RevealedPlayerRef])
          : null,
        overrideHolder: refOrNull(
          projection,
          twoNamesSetup?.payload.overrideHolderId ?? twoNamesAggregate?.overrideHolderId ?? null,
        ),
        overrideAction: twoNamesDeclined
          ? "declined" as const
          : twoNamesUsed
            ? "used" as const
            : twoNamesAggregate?.overrideAction ?? null,
        removedNominee: refOrNull(
          projection,
          twoNamesUsed?.payload.removedNomineeId ?? twoNamesAggregate?.removedNomineeId ?? null,
        ),
        replacementNominee: refOrNull(
          projection,
          twoNamesReplacement?.payload.replacementNomineeId
            ?? twoNamesAggregate?.replacementNomineeId
            ?? null,
        ),
        finalists: twoNamesFinalistIds
          ? ([
              playerRef(projection, twoNamesFinalistIds[0]),
              playerRef(projection, twoNamesFinalistIds[1]),
            ] as [RevealedPlayerRef, RevealedPlayerRef])
          : null,
        completedMingleWindows: eventsOfType(events, "format.two_names_mingle_completed")
          .map((event) => event.payload.window),
        pleas: eventsOfType(events, "format.two_names_plea_recorded").map((event) => ({
          speaker: playerRef(projection, event.payload.speakerId),
          ordinal: event.payload.ordinal,
          status: event.payload.status,
          text: event.payload.text,
        })),
        eligibleVoters: (twoNamesAggregate?.eligibleVoterIds ?? []).map(
          (id) => playerRef(projection, id),
        ),
        totals: twoNamesAggregate
          ? countsToVoteCounts(twoNamesAggregate.totals, projection)
          : [],
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
  const acceptedBallots = buildAcceptedFormatBallots(events, projection);
  const eligibleVoterIds = twoNamesAggregate?.eligibleVoterIds
    ?? projection.playerOrder.filter((playerId) =>
      projection.players[playerId]?.status === PlayerStatus.ALIVE
      || events.some(
        (event) => event.type === "player.eliminated" && event.payload.playerId === playerId,
      )
    );
  const projectedPresentation = projectFormatBallotPresentation({
    events,
    round: events[0]?.round ?? 0,
    eligibleVoterIds,
    formatManifest: projection.formatManifest,
  });
  const ballotPresentation: RevealedFormatBallotPresentation = {
    status: projectedPresentation.status,
    rollCall: projectedPresentation.rollCall.map((entry) =>
      entry.targetId === null
        ? {
            voter: playerRef(projection, entry.voterId),
            target: null,
            polarity: null,
            forfeited: true as const,
          }
        : {
            voter: playerRef(projection, entry.voterId),
            target: playerRef(projection, entry.targetId),
            polarity: entry.polarity,
          }
    ),
  };

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
    majorityElimination,
    evenVotes,
    restrictedHistory,
    safetyBounce,
    twoNames,
    acceptedBallots,
    ballotPresentation,
  };
}

function buildSafetyBounceFacts(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
  resolved: EventOf<"format.resolved"> | null,
  bounceStarted: EventOf<"format.safety_bounce_started"> | null,
  hasBouncePointers: boolean,
): RevealedSafetyBounceFacts | null {
  const resolvedAggregate = resolved ? formatResolutionAggregate(resolved) : null;
  const resolvedBounce = resolvedAggregate?.capability === "public_chain"
    ? resolvedAggregate
    : null;
  if (!bounceStarted && !resolvedBounce && !hasBouncePointers) {
    return null;
  }

  const prefix = reconstructSafetyBouncePrefix({
    roster: projection.playerOrder.map((id) => ({ id })),
    events,
  });

  return {
    starter: refOrNull(projection, prefix.starterId),
    pointers: prefix.acceptedPointers.map((pointer) => ({
      actor: playerRef(projection, pointer.actorId),
      target: playerRef(projection, pointer.targetId),
      classification: pointer.classification,
    })),
    safe: prefix.safePlayerIds.map((id) => playerRef(projection, id)),
    vulnerable: prefix.vulnerablePlayerIds.map((id) => playerRef(projection, id)),
    voteTotals: resolvedBounce ? countsToVoteCounts(resolvedBounce.voteTotals, projection) : [],
  };
}

/**
 * Format ballot envelopes may be producer-visible for historical provenance,
 * but this aggregate is a viewer fact. It is intentionally built only from
 * canonical ballot payloads, never transcript prose or private artifacts.
 */
function buildAcceptedFormatBallots(
  events: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
): RevealedFormatBallotEntry[] {
  const ballotEvents = eventsOfType(events, "format.ballot_cast");
  return ballotEvents.map((event) => ({
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

function buildEndgameFacts(
  roundEvents: readonly CanonicalGameEvent[],
  allEvents: readonly CanonicalGameEvent[],
  projection: CanonicalGameProjection,
  round: number,
): RevealedEndgameFacts | undefined {
  const stageSet = latestEvent(roundEvents, "endgame.stage_set");
  const elimResolved = latestEvent(roundEvents, "endgame.elimination_resolved");
  const elimVotes = eventsOfType(roundEvents, "endgame.elimination_vote_cast");
  const juryVotes = eventsOfType(roundEvents, "jury.vote_cast");
  const juryWinner = latestEvent(roundEvents, "jury.winner_determined");

  if (!stageSet && !elimResolved && elimVotes.length === 0 && juryVotes.length === 0 && !juryWinner) {
    return undefined;
  }

  const stage = stageSet?.payload.stage ?? elimResolved?.payload.stage ?? null;
  const lastEmpoweredId = stageSet?.payload.lastEmpoweredFromRegularRounds
    ?? projection.lastEmpoweredFromRegularRounds
    ?? lastRegularEmpoweredFromEvents(allEvents, round)
    ?? null;

  let progression: RevealedEndgameFacts["progression"] = null;
  if (juryWinner?.payload.winnerId) {
    progression = {
      kind: "winner",
      winner: playerRef(projection, juryWinner.payload.winnerId),
    };
  } else {
    const laterStage = allEvents.find(
      (event) =>
        event.type === "endgame.stage_set"
        && event.round > round
        && typeof event.payload.stage === "string",
    );
    if (laterStage && laterStage.type === "endgame.stage_set") {
      progression = { kind: "stage", stage: laterStage.payload.stage };
    }
  }

  return {
    status: elimResolved || juryWinner ? "available" : "available",
    stage: stage === null ? null : String(stage),
    lastEmpoweredFromRegularRounds: refOrNull(projection, lastEmpoweredId),
    eliminationVotes: sortByPlayerOrder(elimVotes, projection, (event) => event.payload.voterId).map((event) => ({
      voter: playerRef(projection, event.payload.voterId),
      target: playerRef(projection, event.payload.target),
    })),
    eliminated: refOrNull(projection, elimResolved?.payload.eliminated ?? null),
    eliminationMethod: elimResolved?.payload.method ?? null,
    juryVotes: sortByPlayerOrder(juryVotes, projection, (event) => event.payload.jurorId).map((event) => ({
      voter: playerRef(projection, event.payload.jurorId),
      target: playerRef(projection, event.payload.finalistId),
    })),
    juryWinner: refOrNull(projection, juryWinner?.payload.winnerId ?? null),
    juryMethod: juryWinner?.payload.method ?? null,
    progression,
  };
}

/** Backfill last regular empower for historical stage_set payloads that stored null. */
function lastRegularEmpoweredFromEvents(
  events: readonly CanonicalGameEvent[],
  beforeRound: number,
): UUID | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.round >= beforeRound) continue;
    if (event.type === "vote.empowered_set") {
      return event.payload.empowered;
    }
    if (event.type === "format.resolved" && event.payload.empoweredId) {
      return event.payload.empoweredId;
    }
    if (event.type === "format.selected" && event.payload.empoweredId) {
      return event.payload.empoweredId;
    }
    if (event.type === "vote.empower_tally_resolved" && event.payload.tied === null) {
      return event.payload.empowered;
    }
  }
  return null;
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
    format: emptyFormat(status),
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
    majorityElimination: null,
    evenVotes: null,
    restrictedHistory: null,
    safetyBounce: null,
    twoNames: null,
    acceptedBallots: [],
    ballotPresentation: {
      status: status === "unavailable" || status === "not_yet_flushed"
        ? "unavailable"
        : "not_applicable",
      rollCall: [],
    },
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
