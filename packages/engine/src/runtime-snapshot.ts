/**
 * Runtime Snapshot v1 builders shared by the engine checkpoint writer and API seal path.
 */

import type {
  AccumulatorEntryV1,
  AccumulatorProofV1,
  ActorWitnessV1,
  CheckpointBoundaryIdentityV1,
  GameCheckpointKind,
  PhaseAccumulatorRegistryV1,
  RuntimeSnapshotV1,
  TranscriptWatermarkV1,
} from "./game-runner.types";
import { PHASE_BOUNDARY_ACCUMULATOR_IDS } from "./game-runner.types";
import type { Phase } from "./types";
import type { UUID } from "./types";

/** Placeholder boundary identity emitted by the engine; API write seals owner/hash fields. */
export function createEngineBoundaryPlaceholder(params: {
  boundarySequence: number;
  checkpointKind: GameCheckpointKind;
  phase: Phase;
  round: number;
}): CheckpointBoundaryIdentityV1 {
  return {
    version: 1,
    ownerEpoch: "",
    boundarySequence: params.boundarySequence,
    eventHeadHash: "",
    projectionHash: "",
    checkpointKind: params.checkpointKind,
    phase: params.phase,
    round: params.round,
  };
}

export function sealBoundaryIdentity(
  placeholder: CheckpointBoundaryIdentityV1,
  sealed: {
    ownerEpoch: string;
    eventHeadHash: string;
    projectionHash: string;
  },
): CheckpointBoundaryIdentityV1 {
  return {
    ...placeholder,
    ownerEpoch: sealed.ownerEpoch,
    eventHeadHash: sealed.eventHeadHash,
    projectionHash: sealed.projectionHash,
  };
}

export function buildActorWitness(params: {
  boundary: CheckpointBoundaryIdentityV1;
  actorCoordinate: string;
  actorStatus: "active" | "done";
  round: number;
  phase: Phase;
  alivePlayerIds: UUID[];
}): ActorWitnessV1 {
  return {
    version: 1,
    boundary: params.boundary,
    machineSchemaVersion: "phase-machine-v1",
    actorCoordinate: params.actorCoordinate,
    actorStatus: params.actorStatus,
    contextSummary: {
      round: params.round,
      phase: params.phase,
      alivePlayerIds: params.alivePlayerIds,
    },
    futureHydrationInputVersion: 1,
  };
}

export function buildPhaseAccumulatorRegistry(params: {
  boundary: CheckpointBoundaryIdentityV1;
  entries: AccumulatorEntryV1[];
}): PhaseAccumulatorRegistryV1 {
  return {
    version: 1,
    boundaryClass: "phase_boundary",
    boundary: params.boundary,
    entries: params.entries,
  };
}

export function buildTranscriptWatermark(params: {
  boundary: CheckpointBoundaryIdentityV1;
  lastCanonicalSequence: number;
  entryCount: number;
  boundaryDigest: string;
}): TranscriptWatermarkV1 {
  return {
    version: 1,
    boundary: params.boundary,
    lastCanonicalSequence: params.lastCanonicalSequence,
    entryCount: params.entryCount,
    durableBoundary: true,
    boundaryDigest: params.boundaryDigest,
  };
}

export function buildRuntimeSnapshotV1(params: {
  boundary: CheckpointBoundaryIdentityV1;
  actorWitness: ActorWitnessV1;
  accumulatorRegistry: PhaseAccumulatorRegistryV1;
  transcriptWatermark: TranscriptWatermarkV1;
}): RuntimeSnapshotV1 {
  return {
    version: 1,
    boundary: params.boundary,
    actorWitness: params.actorWitness,
    accumulatorRegistry: params.accumulatorRegistry,
    transcriptWatermark: params.transcriptWatermark,
  };
}

export function accumulatorProof(
  kind: AccumulatorProofV1["kind"],
  detail?: string,
): AccumulatorProofV1 {
  return detail ? { kind, detail } : { kind };
}

export function requiredPhaseBoundaryAccumulatorIds(): readonly string[] {
  return PHASE_BOUNDARY_ACCUMULATOR_IDS;
}