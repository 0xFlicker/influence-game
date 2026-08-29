import type { UUID } from "../types";
import type { SealedElimRegistration } from "./catalog";
import type {
  FormatEliminationResolution,
  SealedElimAggregate,
  SealedElimBallot,
  SealedElimScore,
} from "./types";

export interface SealedElimParticipant {
  id: UUID;
  name: string;
}

export interface CollectedSealedElimDecision<TDecision> {
  targetId: UUID;
  decision: TDecision;
}

export interface AcceptedSealedElimDecision<TDecision> {
  ballot: SealedElimBallot;
  decision: TDecision;
  repairedInvalidTarget: boolean;
  traceAction: string;
}

export interface SealedElimTieResolution<TTieEvidence> {
  resolution: Extract<FormatEliminationResolution, { kind: "clear" }>;
  evidence: TTieEvidence;
}

export interface ResolveSealedElimOptions<TDecision, TTieEvidence> {
  registration: SealedElimRegistration;
  traceAction: string;
  participants: readonly SealedElimParticipant[];
  collectDecision: (
    participant: SealedElimParticipant,
    fallbackTargetId: UUID,
    legalTargetIds: readonly UUID[],
  ) => Promise<CollectedSealedElimDecision<TDecision>>;
  recordAcceptedBallot: (
    accepted: AcceptedSealedElimDecision<TDecision>,
  ) => Promise<void>;
  legalTargetIdsFor?: (
    participant: SealedElimParticipant,
    aliveIds: readonly UUID[],
  ) => readonly UUID[];
  recordForfeitedBallot?: (participant: SealedElimParticipant) => Promise<void>;
  breakTie: (
    tiedPlayerIds: readonly UUID[],
  ) => Promise<SealedElimTieResolution<TTieEvidence>>;
  beforeScore?: () => Promise<void>;
}

export interface ResolvedSealedElimRound<TTieEvidence> {
  ballots: SealedElimBallot[];
  forfeitedVoterIds: UUID[];
  score: SealedElimScore;
  aggregate: SealedElimAggregate;
  resolution: Exclude<FormatEliminationResolution, { kind: "tie" }>;
  tieEvidence: TTieEvidence | null;
}

export function isLegalSealedElimBallot(
  voterId: UUID,
  targetId: UUID,
  aliveIds: readonly UUID[],
): boolean {
  return voterId !== targetId
    && aliveIds.includes(voterId)
    && aliveIds.includes(targetId);
}

/**
 * Validate and resolve a complete sealed non-polarity ballot set. This is kept
 * pure so incomplete, duplicate, and illegal ledgers fail before resolution.
 */
export function scoreSealedElimBallots(
  registration: SealedElimRegistration,
  aliveIds: readonly UUID[],
  ballots: readonly SealedElimBallot[],
  options: {
    forfeitedVoterIds?: readonly UUID[];
    legalTargetIdsByVoter?: ReadonlyMap<UUID, readonly UUID[]>;
  } = {},
): { score: SealedElimScore; resolution: FormatEliminationResolution } {
  const forfeitedVoterIds = options.forfeitedVoterIds ?? [];
  if (ballots.length + forfeitedVoterIds.length !== aliveIds.length) {
    throw new Error(
      `${registration.id} incomplete sealed ballots: ${ballots.length + forfeitedVoterIds.length}/${aliveIds.length}`,
    );
  }

  const voters = new Set<UUID>();
  for (const ballot of ballots) {
    if (voters.has(ballot.voterId)) {
      throw new Error(`${registration.id} duplicate sealed ballot voter: ${ballot.voterId}`);
    }
    voters.add(ballot.voterId);
    const legalTargetIds = options.legalTargetIdsByVoter?.get(ballot.voterId) ?? aliveIds;
    if (
      !registration.isLegalBallot(ballot.voterId, ballot.targetId, aliveIds)
      || !legalTargetIds.includes(ballot.targetId)
    ) {
      throw new Error(
        `${registration.id} illegal sealed ballot: ${ballot.voterId}->${ballot.targetId}`,
      );
    }
  }
  for (const voterId of forfeitedVoterIds) {
    if (voters.has(voterId)) {
      throw new Error(`${registration.id} duplicate sealed ballot voter: ${voterId}`);
    }
    if (!aliveIds.includes(voterId)) {
      throw new Error(`${registration.id} illegal forfeited voter: ${voterId}`);
    }
    if (registration.ballotParticipation !== "forfeit_if_no_legal_target") {
      throw new Error(`${registration.id} does not allow ballot forfeiture`);
    }
    const legalTargetIds = options.legalTargetIdsByVoter?.get(voterId);
    if (!legalTargetIds || legalTargetIds.length > 0) {
      throw new Error(`${registration.id} illegal ballot forfeiture: ${voterId}`);
    }
    voters.add(voterId);
  }
  for (const aliveId of aliveIds) {
    if (!voters.has(aliveId)) {
      throw new Error(`${registration.id} missing sealed ballot voter: ${aliveId}`);
    }
  }

  return {
    score: registration.score(aliveIds, ballots),
    resolution: registration.resolve(aliveIds, ballots),
  };
}

/** Shared collect -> validate -> score -> tiebreak path for sealed-elim formats. */
export async function resolveSealedElimRound<TDecision, TTieEvidence>(
  options: ResolveSealedElimOptions<TDecision, TTieEvidence>,
): Promise<ResolvedSealedElimRound<TTieEvidence>> {
  const aliveIds = options.participants.map((participant) => participant.id);
  const ballots: SealedElimBallot[] = [];
  const forfeitedVoterIds: UUID[] = [];
  const legalTargetIdsByVoter = new Map<UUID, readonly UUID[]>();

  for (const participant of options.participants) {
    const legalTargetIds = options.legalTargetIdsFor?.(participant, aliveIds)
      ?? aliveIds.filter((id) => id !== participant.id);
    legalTargetIdsByVoter.set(participant.id, legalTargetIds);
    const fallbackTargetId = legalTargetIds.at(-1) ?? legalTargetIds[0];
    if (!fallbackTargetId) {
      if (
        options.registration.ballotParticipation !== "forfeit_if_no_legal_target"
        || !options.recordForfeitedBallot
      ) {
        throw new Error(`${options.registration.id} requires at least one legal target`);
      }
      forfeitedVoterIds.push(participant.id);
      await options.recordForfeitedBallot(participant);
      continue;
    }
    const collected = await options.collectDecision(
      participant,
      fallbackTargetId,
      legalTargetIds,
    );
    const legal = options.registration.isLegalBallot(
      participant.id,
      collected.targetId,
      aliveIds,
    ) && legalTargetIds.includes(collected.targetId);
    const ballot = {
      voterId: participant.id,
      targetId: legal ? collected.targetId : fallbackTargetId,
    };
    ballots.push(ballot);
    await options.recordAcceptedBallot({
      ballot,
      decision: collected.decision,
      repairedInvalidTarget: !legal,
      traceAction: options.traceAction,
    });
  }

  await options.beforeScore?.();
  const scored = scoreSealedElimBallots(options.registration, aliveIds, ballots, {
    forfeitedVoterIds,
    legalTargetIdsByVoter,
  });
  let resolution = scored.resolution;
  let tieEvidence: TTieEvidence | null = null;
  if (resolution.kind === "tie") {
    const broken = await options.breakTie(resolution.tiedSet);
    resolution = broken.resolution;
    tieEvidence = broken.evidence;
  }

  return {
    ballots,
    forfeitedVoterIds,
    score: scored.score,
    aggregate: options.registration.aggregate.toAggregate(scored.score),
    resolution,
    tieEvidence,
  };
}
