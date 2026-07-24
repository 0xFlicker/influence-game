import type { UUID } from "../types";

/** Launch-set round formats for the sequester format kernel. */
export type LaunchFormatId = "save_or_eliminate" | "vote_bomb" | "safety_bounce";

export const LAUNCH_FORMAT_IDS: readonly LaunchFormatId[] = [
  "save_or_eliminate",
  "vote_bomb",
  "safety_bounce",
] as const;

export type SaveOrEliminatePolarity = "save" | "eliminate";

export interface SaveOrEliminateBallot {
  voterId: UUID;
  polarity: SaveOrEliminatePolarity;
  targetId: UUID;
}

export interface VoteBombBallot {
  voterId: UUID;
  targetId: UUID;
}

export type BounceClassification = "safe" | "vulnerable";

export interface BounceBoard {
  starterId: UUID;
  safe: UUID[];
  vulnerable: UUID[];
  unclassified: UUID[];
  /** Next actor to point, if classification incomplete. */
  nextActorId: UUID | null;
  /** Last resolved target (becomes next actor when board incomplete). */
  lastTargetId: UUID | null;
}

export interface BouncePointer {
  actorId: UUID;
  targetId: UUID;
}

export type FormatEliminationResolution =
  | {
      kind: "clear";
      eliminatedId: UUID;
      tiedSet: UUID[];
    }
  | {
      kind: "tie";
      eliminatedId: null;
      tiedSet: UUID[];
    }
  | {
      kind: "auto";
      eliminatedId: UUID;
      tiedSet: UUID[];
      reason: "sole_vulnerable" | "sole_lowest_net" | "sole_fewest_positive";
    };
