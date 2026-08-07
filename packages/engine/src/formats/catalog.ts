/**
 * Exhaustive runtime format registry.
 *
 * Runtime dispatch goes through this catalog and fails closed. Presentation
 * metadata deliberately remains in its browser-safe leaf module.
 */
import {
  LAUNCH_FORMAT_IDS,
  type LaunchFormatId,
} from "../format-presentation-metadata";
import type { UUID } from "../types";
import {
  computeMajorityEliminationTallies,
  isLegalMajorityEliminationBallot,
  resolveMajorityElimination,
} from "./majority-elimination";
import {
  isLegalSaveOrEliminateBallot,
  resolveSaveOrEliminate,
} from "./save-or-eliminate";
import {
  isLegalSafetyBounceVote,
  resolveSafetyBounceVote,
} from "./safety-bounce";
import type {
  FormatEliminationResolution,
  SealedElimAggregate,
  SealedElimBallot,
  SealedElimScore,
} from "./types";
import {
  computeVoteBombTallies,
  isLegalVoteBombBallot,
  resolveVoteBomb,
} from "./vote-bomb";

export type SealedElimFormatId = "vote_bomb" | "majority_elimination";

export interface SealedElimDecisionContract<
  TId extends SealedElimFormatId = SealedElimFormatId,
> {
  handler: "sealed_elim";
  formatId: TId;
  targetPolicy: "alive_non_self";
}

export interface SealedElimAggregateAdapter {
  capability: "sealed_elim";
  toAggregate: (score: SealedElimScore) => SealedElimAggregate;
  fromAggregate: (aggregate: SealedElimAggregate) => SealedElimScore;
}

export interface SealedElimPresentationContract {
  scoring: "fewest_positive" | "highest_total";
  zeroVoteTreatment: "safe" | "eligible";
}

export interface SealedElimRegistration<
  TId extends SealedElimFormatId = SealedElimFormatId,
> {
  id: TId;
  capability: "sealed_elim";
  score: (
    aliveIds: readonly UUID[],
    ballots: readonly SealedElimBallot[],
  ) => SealedElimScore;
  resolve: (
    aliveIds: readonly UUID[],
    ballots: readonly SealedElimBallot[],
  ) => FormatEliminationResolution;
  isLegalBallot: (
    voterId: UUID,
    targetId: UUID,
    aliveIds: readonly UUID[],
  ) => boolean;
  decision: SealedElimDecisionContract<TId>;
  aggregate: SealedElimAggregateAdapter;
  presentation: SealedElimPresentationContract;
}

export interface SealedPolarityRegistration {
  id: "save_or_eliminate";
  capability: "sealed_polarity";
  handler: "save_or_eliminate";
  resolve: typeof resolveSaveOrEliminate;
  isLegalBallot: typeof isLegalSaveOrEliminateBallot;
  decision: { handler: "save_or_eliminate" };
  aggregate: { capability: "sealed_polarity"; handler: "save_or_eliminate" };
  presentation: { handler: "save_or_eliminate" };
}

export interface PublicChainRegistration {
  id: "safety_bounce";
  capability: "public_chain";
  handler: "safety_bounce";
  resolveVote: typeof resolveSafetyBounceVote;
  isLegalVote: typeof isLegalSafetyBounceVote;
  decision: { handler: "safety_bounce" };
  aggregate: { capability: "public_chain"; handler: "safety_bounce" };
  presentation: { handler: "safety_bounce" };
}

export type FormatRegistration =
  | SealedElimRegistration
  | SealedPolarityRegistration
  | PublicChainRegistration;

export type FormatRegistrationFor<TId extends LaunchFormatId> =
  TId extends "save_or_eliminate"
    ? SealedPolarityRegistration
    : TId extends "safety_bounce"
      ? PublicChainRegistration
      : TId extends SealedElimFormatId
        ? SealedElimRegistration<TId>
        : never;

export type FormatCatalog = {
  readonly [TId in LaunchFormatId]: FormatRegistrationFor<TId>;
};

function voteBombScore(
  aliveIds: readonly UUID[],
  ballots: readonly SealedElimBallot[],
): SealedElimScore {
  const { totals, positiveIds } = computeVoteBombTallies(aliveIds, ballots);
  return { totals, eligibleIds: positiveIds };
}

const sealedElimAggregateAdapter: SealedElimAggregateAdapter = {
  capability: "sealed_elim",
  toAggregate: ({ totals, eligibleIds }) => ({
    totals: { ...totals },
    eligiblePlayerIds: [...eligibleIds],
  }),
  fromAggregate: ({ totals, eligiblePlayerIds }) => ({
    totals: { ...totals },
    eligibleIds: [...eligiblePlayerIds],
  }),
};

export const FORMAT_CATALOG: FormatCatalog = {
  save_or_eliminate: {
    id: "save_or_eliminate",
    capability: "sealed_polarity",
    handler: "save_or_eliminate",
    resolve: resolveSaveOrEliminate,
    isLegalBallot: isLegalSaveOrEliminateBallot,
    decision: { handler: "save_or_eliminate" },
    aggregate: {
      capability: "sealed_polarity",
      handler: "save_or_eliminate",
    },
    presentation: { handler: "save_or_eliminate" },
  },
  vote_bomb: {
    id: "vote_bomb",
    capability: "sealed_elim",
    score: voteBombScore,
    resolve: resolveVoteBomb,
    isLegalBallot: isLegalVoteBombBallot,
    decision: {
      handler: "sealed_elim",
      formatId: "vote_bomb",
      targetPolicy: "alive_non_self",
    },
    aggregate: sealedElimAggregateAdapter,
    presentation: {
      scoring: "fewest_positive",
      zeroVoteTreatment: "safe",
    },
  },
  safety_bounce: {
    id: "safety_bounce",
    capability: "public_chain",
    handler: "safety_bounce",
    resolveVote: resolveSafetyBounceVote,
    isLegalVote: isLegalSafetyBounceVote,
    decision: { handler: "safety_bounce" },
    aggregate: { capability: "public_chain", handler: "safety_bounce" },
    presentation: { handler: "safety_bounce" },
  },
  majority_elimination: {
    id: "majority_elimination",
    capability: "sealed_elim",
    score: computeMajorityEliminationTallies,
    resolve: resolveMajorityElimination,
    isLegalBallot: isLegalMajorityEliminationBallot,
    decision: {
      handler: "sealed_elim",
      formatId: "majority_elimination",
      targetPolicy: "alive_non_self",
    },
    aggregate: sealedElimAggregateAdapter,
    presentation: {
      scoring: "highest_total",
      zeroVoteTreatment: "eligible",
    },
  },
};

/** Ordered omission default for live games. */
export const DEFAULT_FORMAT_MANIFEST: readonly LaunchFormatId[] = [
  ...LAUNCH_FORMAT_IDS,
];

/** Formats available to games created before manifests were persisted. */
export const LEGACY_FORMAT_MANIFEST: readonly LaunchFormatId[] = [
  "save_or_eliminate",
  "vote_bomb",
  "safety_bounce",
];

export function isRegisteredFormatId(value: string): value is LaunchFormatId {
  return Object.hasOwn(FORMAT_CATALOG, value);
}

/** Validate and defensively copy a frozen per-game format manifest. */
export function resolveFormatManifest(value: unknown): LaunchFormatId[] {
  const candidate = value === undefined ? DEFAULT_FORMAT_MANIFEST : value;
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new Error("Format manifest must contain at least one registered format id");
  }

  const resolved: LaunchFormatId[] = [];
  const seen = new Set<LaunchFormatId>();
  for (const entry of candidate) {
    if (typeof entry !== "string" || !isRegisteredFormatId(entry)) {
      throw new Error(`Format manifest entries must be registered format ids: ${String(entry)}`);
    }
    if (seen.has(entry)) {
      throw new Error(`Format manifest contains duplicate format id: ${entry}`);
    }
    seen.add(entry);
    resolved.push(entry);
  }
  return resolved;
}

export function getFormatRegistration<TId extends LaunchFormatId>(
  formatId: TId,
): FormatRegistrationFor<TId>;
export function getFormatRegistration(formatId: string): FormatRegistration;
export function getFormatRegistration(formatId: string): FormatRegistration {
  if (!isRegisteredFormatId(formatId)) {
    throw new Error(`Unknown format id at catalog lookup: ${formatId}`);
  }
  return FORMAT_CATALOG[formatId];
}

export function requireSealedElimRegistration(
  formatId: LaunchFormatId,
): SealedElimRegistration {
  const registration = getFormatRegistration(formatId);
  if (registration.capability !== "sealed_elim") {
    throw new Error(
      `Format ${formatId} is capability ${registration.capability}, not sealed_elim`,
    );
  }
  return registration;
}
