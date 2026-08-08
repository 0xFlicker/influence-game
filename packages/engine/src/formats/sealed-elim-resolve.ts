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
  ) => Promise<CollectedSealedElimDecision<TDecision>>;
  recordAcceptedBallot: (
    accepted: AcceptedSealedElimDecision<TDecision>,
  ) => Promise<void>;
  breakTie: (
    tiedPlayerIds: readonly UUID[],
  ) => Promise<SealedElimTieResolution<TTieEvidence>>;
  beforeScore?: () => Promise<void>;
}

export interface ResolvedSealedElimRound<TTieEvidence> {
  ballots: SealedElimBallot[];
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
): { score: SealedElimScore; resolution: FormatEliminationResolution } {
  if (ballots.length !== aliveIds.length) {
    throw new Error(
      `${registration.id} incomplete sealed ballots: ${ballots.length}/${aliveIds.length}`,
    );
  }

  const voters = new Set<UUID>();
  for (const ballot of ballots) {
    if (voters.has(ballot.voterId)) {
      throw new Error(`${registration.id} duplicate sealed ballot voter: ${ballot.voterId}`);
    }
    voters.add(ballot.voterId);
    if (!registration.isLegalBallot(ballot.voterId, ballot.targetId, aliveIds)) {
      throw new Error(
        `${registration.id} illegal sealed ballot: ${ballot.voterId}->${ballot.targetId}`,
      );
    }
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

  for (const participant of options.participants) {
    const otherIds = aliveIds.filter((id) => id !== participant.id);
    const fallbackTargetId = otherIds.at(-1) ?? otherIds[0];
    if (!fallbackTargetId) {
      throw new Error(`${options.registration.id} requires at least two alive players`);
    }
    const collected = await options.collectDecision(participant, fallbackTargetId);
    const legal = options.registration.isLegalBallot(
      participant.id,
      collected.targetId,
      aliveIds,
    );
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
  const scored = scoreSealedElimBallots(options.registration, aliveIds, ballots);
  let resolution = scored.resolution;
  let tieEvidence: TTieEvidence | null = null;
  if (resolution.kind === "tie") {
    const broken = await options.breakTie(resolution.tiedSet);
    resolution = broken.resolution;
    tieEvidence = broken.evidence;
  }

  return {
    ballots,
    score: scored.score,
    aggregate: options.registration.aggregate.toAggregate(scored.score),
    resolution,
    tieEvidence,
  };
}
