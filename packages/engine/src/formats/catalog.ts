/**
 * Exhaustive runtime format registry.
 *
 * Runtime dispatch goes through this catalog and fails closed. Presentation
 * metadata deliberately remains in its browser-safe leaf module.
 */
import type { LaunchFormatId } from "../format-presentation-metadata";
import type { UUID } from "../types";
import {
  computeMajorityEliminationTallies,
  isLegalMajorityEliminationBallot,
  resolveMajorityElimination,
} from "./majority-elimination";
import {
  computeEvenVotesTallies,
  isLegalEvenVotesBallot,
  resolveEvenVotes,
} from "./even-votes";
import {
  computeRestrictedHistoryTallies,
  isLegalRestrictedHistoryBallot,
  resolveRestrictedHistory,
} from "./restricted-history";
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
import {
  computeTwoNamesTallies,
  isLegalTwoNamesBallot,
  isLegalTwoNamesInitialPair,
  resolveTwoNames,
  twoNamesOrdinaryVoterIds,
  twoNamesOverrideCandidates,
  twoNamesRemovalChoices,
  twoNamesReplacementCandidates,
} from "./two-names";

export type SealedElimFormatId =
  | "vote_bomb"
  | "majority_elimination"
  | "even_votes"
  | "restricted_history";

export interface SealedElimDecisionContract<
  TId extends SealedElimFormatId = SealedElimFormatId,
> {
  handler: "sealed_elim";
  formatId: TId;
  targetPolicy: "alive_non_self" | "restricted_history";
  agentMethod:
    | "getVoteBombBallot"
    | "getMajorityEliminationBallot"
    | "getEvenVotesBallot"
    | "getRestrictedHistoryBallot";
  toolName:
    | "short_list_ballot"
    | "highest_count_ballot"
    | "even_votes_ballot"
    | "restricted_history_ballot";
  toolDescription: string;
  traceAction:
    | "format-vote-bomb-ballot"
    | "format-majority-elimination-ballot"
    | "format-even-votes-ballot"
    | "format-restricted-history-ballot";
  strategyGuidance: string;
  invalidTargetReason:
    | "invalid_vote_bomb_target"
    | "invalid_majority_elimination_target"
    | "invalid_even_votes_target"
    | "invalid_restricted_history_target";
}

export interface SealedElimAggregateAdapter {
  capability: "sealed_elim";
  toAggregate: (score: SealedElimScore) => SealedElimAggregate;
  fromAggregate: (aggregate: SealedElimAggregate) => SealedElimScore;
}

export interface SealedElimPresentationContract {
  scoring: "fewest_positive" | "highest_total" | "highest_even";
  zeroVoteTreatment: "safe" | "eligible";
}

export interface SealedElimRegistration<
  TId extends SealedElimFormatId = SealedElimFormatId,
> {
  id: TId;
  capability: "sealed_elim";
  availableFromRound: number;
  ballotParticipation: "required" | "forfeit_if_no_legal_target";
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
  availableFromRound: number;
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
  availableFromRound: number;
  handler: "safety_bounce";
  resolveVote: typeof resolveSafetyBounceVote;
  isLegalVote: typeof isLegalSafetyBounceVote;
  decision: { handler: "safety_bounce" };
  aggregate: { capability: "public_chain"; handler: "safety_bounce" };
  presentation: { handler: "safety_bounce" };
}

export interface TwoNamesRegistration {
  id: "two_names";
  capability: "two_names";
  availableFromRound: number;
  minimumLivingPlayers: 5;
  initialNames: {
    isLegal: typeof isLegalTwoNamesInitialPair;
  };
  override: {
    candidates: typeof twoNamesOverrideCandidates;
    removalChoices: typeof twoNamesRemovalChoices;
    replacementCandidates: typeof twoNamesReplacementCandidates;
  };
  ballot: {
    eligibleVoterIds: typeof twoNamesOrdinaryVoterIds;
    isLegal: typeof isLegalTwoNamesBallot;
    score: typeof computeTwoNamesTallies;
    resolve: typeof resolveTwoNames;
  };
  decision: {
    handler: "two_names";
    initialNames: {
      agentMethod: "getTwoNamesInitialNames";
      toolName: "two_names_initial_names";
      traceAction: "format-two-names-initial-names";
      invalidReason: "invalid_two_names_initial_names";
      fallbackText: "Use the first legal pair in canonical roster order.";
    };
    override: {
      agentMethod: "getTwoNamesOverride";
      toolName: "two_names_override";
      traceAction: "format-two-names-override";
      invalidReason: "invalid_two_names_override";
      fallbackText: "Decline Override.";
    };
    replacement: {
      agentMethod: "getTwoNamesReplacement";
      toolName: "two_names_replacement";
      traceAction: "format-two-names-replacement";
      invalidReason: "invalid_two_names_replacement";
      fallbackText: "Use the first legal replacement in canonical roster order.";
    };
    ballot: {
      agentMethod: "getTwoNamesBallot";
      toolName: "two_names_ballot";
      traceAction: "format-two-names-ballot";
      invalidReason: "invalid_two_names_ballot";
      fallbackText: "Vote for the first final nominee in canonical pair order.";
    };
    tiebreak: {
      agentMethod: "breakTwoNamesTie";
      toolName: "two_names_tiebreak";
      traceAction: "format-two-names-tiebreak";
      invalidReason: "invalid_two_names_tiebreak";
      fallbackText: "Eliminate the first final nominee in canonical pair order.";
    };
    plea: {
      agentMethod: "getTwoNamesPlea";
      traceAction: "format-two-names-plea";
    };
  };
  aggregate: { capability: "two_names" };
  presentation: { handler: "two_names" };
}

export type FormatRegistration =
  | SealedElimRegistration
  | SealedPolarityRegistration
  | PublicChainRegistration
  | TwoNamesRegistration;

export type FormatRegistrationFor<TId extends LaunchFormatId> =
  TId extends "save_or_eliminate"
    ? SealedPolarityRegistration
    : TId extends "safety_bounce"
      ? PublicChainRegistration
      : TId extends "two_names"
        ? TwoNamesRegistration
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
    availableFromRound: 1,
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
    availableFromRound: 1,
    ballotParticipation: "required",
    score: voteBombScore,
    resolve: resolveVoteBomb,
    isLegalBallot: isLegalVoteBombBallot,
    decision: {
      handler: "sealed_elim",
      formatId: "vote_bomb",
      targetPolicy: "alive_non_self",
      agentMethod: "getVoteBombBallot",
      toolName: "short_list_ballot",
      toolDescription: "Cast one sealed The Short List ballot for a remaining non-self contestant.",
      traceAction: "format-vote-bomb-ballot",
      strategyGuidance:
        "The Short List rewards deliberate placement: loading several votes onto one contestant can leave a different contestant holding the fewest-positive total, while a single stray vote can put someone on the fewest-positive ledge. Zero votes is safe. Coordinate when useful, but do not assume the room kept its promises.",
      invalidTargetReason: "invalid_vote_bomb_target",
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
    availableFromRound: 1,
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
    availableFromRound: 1,
    ballotParticipation: "required",
    score: computeMajorityEliminationTallies,
    resolve: resolveMajorityElimination,
    isLegalBallot: isLegalMajorityEliminationBallot,
    decision: {
      handler: "sealed_elim",
      formatId: "majority_elimination",
      targetPolicy: "alive_non_self",
      agentMethod: "getMajorityEliminationBallot",
      toolName: "highest_count_ballot",
      toolDescription: "Cast one sealed Highest Count ballot for a remaining non-self contestant.",
      traceAction: "format-majority-elimination-ballot",
      strategyGuidance:
        "Highest Count sends out the contestant with the most votes. This is not The Short List: zero votes is not a special safe class, and the fewest-positive rule does not apply. This is not Safety Bounce: every remaining non-self contestant is legal, not only a vulnerable pool. All remaining contestants, including the Empowered contestant, can receive ballots and exit.",
      invalidTargetReason: "invalid_majority_elimination_target",
    },
    aggregate: sealedElimAggregateAdapter,
    presentation: {
      scoring: "highest_total",
      zeroVoteTreatment: "eligible",
    },
  },
  even_votes: {
    id: "even_votes",
    capability: "sealed_elim",
    availableFromRound: 1,
    ballotParticipation: "required",
    score: computeEvenVotesTallies,
    resolve: resolveEvenVotes,
    isLegalBallot: isLegalEvenVotesBallot,
    decision: {
      handler: "sealed_elim",
      formatId: "even_votes",
      targetPolicy: "alive_non_self",
      agentMethod: "getEvenVotesBallot",
      toolName: "even_votes_ballot",
      toolDescription: "Cast one sealed Even Votes ballot for a remaining non-self contestant.",
      traceAction: "format-even-votes-ballot",
      strategyGuidance:
        "Even Votes rewards parity control, not simple pile-ons. Only even totals qualify, including zero, and the highest even total exits. An odd total is safe unless every remaining contestant finishes odd, which hands the Empowered contestant the entire field. Use your ballot to flip a target between odd safety and even danger, and account for how allies or opponents may flip that parity after you.",
      invalidTargetReason: "invalid_even_votes_target",
    },
    aggregate: sealedElimAggregateAdapter,
    presentation: {
      scoring: "highest_even",
      zeroVoteTreatment: "eligible",
    },
  },
  restricted_history: {
    id: "restricted_history",
    capability: "sealed_elim",
    availableFromRound: 3,
    ballotParticipation: "forfeit_if_no_legal_target",
    score: computeRestrictedHistoryTallies,
    resolve: resolveRestrictedHistory,
    isLegalBallot: isLegalRestrictedHistoryBallot,
    decision: {
      handler: "sealed_elim",
      formatId: "restricted_history",
      targetPolicy: "restricted_history",
      agentMethod: "getRestrictedHistoryBallot",
      toolName: "restricted_history_ballot",
      toolDescription: "Cast one sealed Restricted History ballot for a legal contestant you have not previously selected with an EXIT ballot.",
      traceAction: "format-restricted-history-ballot",
      strategyGuidance:
        "Restricted History sends out the contestant with the most votes, but you cannot select anyone you previously selected with an EXIT format ballot. SAVE ballots do not consume history. Your legal target list is authoritative; if it is empty, your ballot is forfeited without an agent call.",
      invalidTargetReason: "invalid_restricted_history_target",
    },
    aggregate: sealedElimAggregateAdapter,
    presentation: {
      scoring: "highest_total",
      zeroVoteTreatment: "eligible",
    },
  },
  two_names: {
    id: "two_names",
    capability: "two_names",
    availableFromRound: 1,
    minimumLivingPlayers: 5,
    initialNames: {
      isLegal: isLegalTwoNamesInitialPair,
    },
    override: {
      candidates: twoNamesOverrideCandidates,
      removalChoices: twoNamesRemovalChoices,
      replacementCandidates: twoNamesReplacementCandidates,
    },
    ballot: {
      eligibleVoterIds: twoNamesOrdinaryVoterIds,
      isLegal: isLegalTwoNamesBallot,
      score: computeTwoNamesTallies,
      resolve: resolveTwoNames,
    },
    decision: {
      handler: "two_names",
      initialNames: {
        agentMethod: "getTwoNamesInitialNames",
        toolName: "two_names_initial_names",
        traceAction: "format-two-names-initial-names",
        invalidReason: "invalid_two_names_initial_names",
        fallbackText: "Use the first legal pair in canonical roster order.",
      },
      override: {
        agentMethod: "getTwoNamesOverride",
        toolName: "two_names_override",
        traceAction: "format-two-names-override",
        invalidReason: "invalid_two_names_override",
        fallbackText: "Decline Override.",
      },
      replacement: {
        agentMethod: "getTwoNamesReplacement",
        toolName: "two_names_replacement",
        traceAction: "format-two-names-replacement",
        invalidReason: "invalid_two_names_replacement",
        fallbackText: "Use the first legal replacement in canonical roster order.",
      },
      ballot: {
        agentMethod: "getTwoNamesBallot",
        toolName: "two_names_ballot",
        traceAction: "format-two-names-ballot",
        invalidReason: "invalid_two_names_ballot",
        fallbackText: "Vote for the first final nominee in canonical pair order.",
      },
      tiebreak: {
        agentMethod: "breakTwoNamesTie",
        toolName: "two_names_tiebreak",
        traceAction: "format-two-names-tiebreak",
        invalidReason: "invalid_two_names_tiebreak",
        fallbackText: "Eliminate the first final nominee in canonical pair order.",
      },
      plea: {
        agentMethod: "getTwoNamesPlea",
        traceAction: "format-two-names-plea",
      },
    },
    aggregate: { capability: "two_names" },
    presentation: { handler: "two_names" },
  },
};

/** Ordered omission default for live games. */
export const DEFAULT_FORMAT_MANIFEST: readonly LaunchFormatId[] = [
  "save_or_eliminate",
  "vote_bomb",
  "safety_bounce",
  "majority_elimination",
  "even_votes",
  "restricted_history",
  "two_names",
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
  if (!resolved.some((formatId) => FORMAT_CATALOG[formatId].availableFromRound <= 1)) {
    throw new Error("Format manifest must contain at least one format available in round 1");
  }
  return resolved;
}

export interface FormatSelectionContext {
  round: number;
  livingIds: readonly UUID[];
}

export function formatsAvailableForSelection(
  manifest: readonly LaunchFormatId[],
  context: FormatSelectionContext,
): LaunchFormatId[] {
  if (!Number.isInteger(context.round) || context.round < 1) {
    throw new Error(`Format round must be a positive integer: ${context.round}`);
  }
  return resolveFormatManifest(manifest).filter((formatId) => {
    const registration = FORMAT_CATALOG[formatId];
    if (registration.availableFromRound > context.round) return false;
    return registration.capability !== "two_names"
      || context.livingIds.length >= registration.minimumLivingPlayers;
  });
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
