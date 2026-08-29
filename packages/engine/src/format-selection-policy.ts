import type { LaunchFormatId } from "./format-presentation-metadata";

export interface FormatSelectionMetadata {
  /** First standard round in which this format may enter the offer. */
  availableFromRound: number;
  /** Minimum living roster at the standard-round selection boundary. */
  minimumLivingPlayers?: number;
}

export interface FormatSelectionEligibilityContext {
  round: number;
  livingPlayerCount: number;
}

/** Standard round formats resolve before The Reckoning begins with four players. */
export const ENDGAME_STARTING_PLAYER_COUNT = 4;

/** Browser-safe format eligibility policy shared by creation UI and runtime. */
export const FORMAT_SELECTION_METADATA = {
  save_or_eliminate: { availableFromRound: 1 },
  vote_bomb: { availableFromRound: 1 },
  safety_bounce: { availableFromRound: 1 },
  majority_elimination: { availableFromRound: 1 },
  even_votes: { availableFromRound: 1 },
  restricted_history: { availableFromRound: 3 },
  two_names: { availableFromRound: 1, minimumLivingPlayers: 5 },
} as const satisfies Readonly<Record<LaunchFormatId, FormatSelectionMetadata>>;

export function isFormatEligibleForSelection(
  formatId: LaunchFormatId,
  context: FormatSelectionEligibilityContext,
): boolean {
  const selection: FormatSelectionMetadata = FORMAT_SELECTION_METADATA[formatId];
  return selection.availableFromRound <= context.round
    && context.livingPlayerCount >= (selection.minimumLivingPlayers ?? 0);
}

export function canFormatAppearInStandardRounds(
  formatId: LaunchFormatId,
  startingPlayerCount: number,
): boolean {
  const selection = FORMAT_SELECTION_METADATA[formatId];
  const livingPlayerCount = startingPlayerCount - selection.availableFromRound + 1;

  return livingPlayerCount > ENDGAME_STARTING_PLAYER_COUNT
    && isFormatEligibleForSelection(formatId, {
      round: selection.availableFromRound,
      livingPlayerCount,
    });
}
