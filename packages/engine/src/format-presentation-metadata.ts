/**
 * Immutable launch-format presentation contract.
 *
 * This module is deliberately a browser-safe leaf: keep it free of engine
 * barrels, provider clients, runners, MCP code, and Node built-ins. Historical
 * replay copy is tied to this launch contract; future rule changes need a
 * versioned contract instead of mutating these entries.
 */
export const FORMAT_PRESENTATION_METADATA = {
  save_or_eliminate: {
    id: "save_or_eliminate",
    displayName: "Save-or-Eliminate",
    conciseRules:
      "Cast one sealed SAVE (+1) or ELIMINATE (−1) ballot against another agent. Lowest net is eliminated; the Empowered agent breaks a lowest-net tie.",
    ruleSheet:
      "Each player casts one sealed ballot: SAVE (+1 net) or ELIMINATE (−1 net) against someone else. Lowest net is eliminated. The empowered player breaks lowest-net ties.",
  },
  vote_bomb: {
    id: "vote_bomb",
    displayName: "Vote Bomb",
    conciseRules:
      "Cast one sealed vote against another agent. Zero votes is safe; among agents with votes, the fewest votes is eliminated. The Empowered agent breaks a fewest-positive tie.",
    ruleSheet:
      "Each living player casts one sealed vote for another living player. Zero votes is safe. Among players with at least one vote, fewest votes is eliminated. The empowered player breaks fewest-positive ties.",
  },
  safety_bounce: {
    id: "safety_bounce",
    displayName: "Safety Bounce",
    conciseRules:
      "A Safe agent makes the next target Vulnerable; a Vulnerable agent makes the next target Safe. After classification, the Vulnerable pool votes someone out. Sole Vulnerable is automatically eliminated; the Empowered agent breaks a vote tie.",
    ruleSheet:
      "After mingle: one random starter is SAFE and points publicly. A SAFE player's pointer makes the target VULNERABLE; a VULNERABLE player's pointer makes the target SAFE until all are classified. Then a sealed vote among the vulnerable pool only — most votes out. Sole vulnerable auto-elims. Empowered breaks ties.",
  },
  majority_elimination: {
    id: "majority_elimination",
    displayName: "Majority Elimination",
    conciseRules:
      "Cast one sealed vote against another agent. Most votes out. The Empowered agent breaks a highest-total tie, including when the Empowered agent is tied.",
    ruleSheet:
      "Each living player casts one sealed vote for another living player (no self-votes). Highest vote total is eliminated. The empowered player breaks highest-total ties and may choose among that tied set only, including themselves if tied.",
  },
} as const;

export type LaunchFormatId = keyof typeof FORMAT_PRESENTATION_METADATA;

export type LaunchFormatPresentationMetadata =
  (typeof FORMAT_PRESENTATION_METADATA)[LaunchFormatId];

export const LAUNCH_FORMAT_IDS: readonly LaunchFormatId[] = [
  "save_or_eliminate",
  "vote_bomb",
  "safety_bounce",
  "majority_elimination",
] as const;

export const LAUNCH_FORMAT_DISPLAY_NAMES: Readonly<
  Record<LaunchFormatId, string>
> = {
  save_or_eliminate: FORMAT_PRESENTATION_METADATA.save_or_eliminate.displayName,
  vote_bomb: FORMAT_PRESENTATION_METADATA.vote_bomb.displayName,
  safety_bounce: FORMAT_PRESENTATION_METADATA.safety_bounce.displayName,
  majority_elimination:
    FORMAT_PRESENTATION_METADATA.majority_elimination.displayName,
};

export function isLaunchFormatId(value: string): value is LaunchFormatId {
  return Object.hasOwn(FORMAT_PRESENTATION_METADATA, value);
}

export function displayNameForFormat(formatId: string): string {
  return isLaunchFormatId(formatId)
    ? FORMAT_PRESENTATION_METADATA[formatId].displayName
    : formatId;
}

export function formatPresentationMetadata(
  formatId: LaunchFormatId,
): LaunchFormatPresentationMetadata {
  return FORMAT_PRESENTATION_METADATA[formatId];
}
