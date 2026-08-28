/**
 * Current round-format presentation vocabulary.
 *
 * This module is deliberately a browser-safe leaf: keep it free of engine
 * barrels, provider clients, runners, MCP code, and Node built-ins. Canonical
 * IDs and mechanics remain stable game authority; derived labels and rule copy
 * use the current product vocabulary. Persisted authored prose is immutable.
 */
export const FORMAT_PRESENTATION_METADATA = {
  save_or_eliminate: {
    id: "save_or_eliminate",
    displayName: "Save-or-Exit",
    conciseRules:
      "Cast one sealed SAVE (+1) or EXIT (−1) ballot for another contestant. Lowest net exits; the Empowered contestant breaks a lowest-net tie.",
    ruleSheet:
      "Each remaining contestant casts one sealed ballot for someone else: SAVE (+1 net) or EXIT (−1 net). Lowest net exits the game. The Empowered contestant breaks lowest-net ties.",
  },
  vote_bomb: {
    id: "vote_bomb",
    displayName: "The Short List",
    conciseRules:
      "Cast one sealed vote for another contestant. Zero votes is safe; among contestants with votes, the fewest votes exits. The Empowered contestant breaks a fewest-positive tie.",
    ruleSheet:
      "Each remaining contestant casts one sealed vote for someone else still competing. Zero votes is safe. Among contestants with at least one vote, the fewest votes exits the game. The Empowered contestant breaks fewest-positive ties.",
  },
  safety_bounce: {
    id: "safety_bounce",
    displayName: "Safety Bounce",
    conciseRules:
      "A Safe contestant makes the next target Vulnerable; a Vulnerable contestant makes the next target Safe. After classification, the Vulnerable pool votes someone out. A sole Vulnerable contestant exits automatically; the Empowered contestant breaks a vote tie.",
    ruleSheet:
      "After Mingle, one random starter is SAFE and points publicly. A SAFE contestant's pointer makes the target VULNERABLE; a VULNERABLE contestant's pointer makes the target SAFE until all are classified. Then the vulnerable pool receives a sealed vote; the highest total goes out. A sole vulnerable contestant exits automatically. The Empowered contestant breaks ties.",
  },
  majority_elimination: {
    id: "majority_elimination",
    displayName: "Highest Count",
    conciseRules:
      "Cast one sealed vote for another contestant. The highest total goes out. The Empowered contestant breaks a highest-total tie, including when they are tied.",
    ruleSheet:
      "Each remaining contestant casts one sealed vote for someone else still competing. The highest vote total exits the game. The Empowered contestant breaks highest-total ties and may choose only from that tied set, including themselves if tied.",
  },
  even_votes: {
    id: "even_votes",
    displayName: "Even Votes",
    conciseRules:
      "Cast one sealed vote for another contestant. Only even totals qualify, including zero; the highest even total exits. If every total is odd, the Empowered contestant chooses from everyone.",
    ruleSheet:
      "Each remaining contestant casts one sealed vote for someone else still competing. Only contestants with even vote totals qualify, including zero. The highest qualifying even total exits the game. The Empowered contestant breaks a highest-even tie. If every remaining contestant has an odd total, the Empowered contestant chooses from the entire field.",
  },
  restricted_history: {
    id: "restricted_history",
    displayName: "Restricted History",
    conciseRules:
      "Cast one sealed vote for someone you have not previously selected with an EXIT ballot. The highest total goes out; if no legal target remains, you lose your vote. Available from round 3.",
    ruleSheet:
      "Each remaining contestant casts one sealed EXIT vote for someone still competing whom they have not selected in an earlier round. SAVE ballots do not consume target history. A contestant with no legal target forfeits their ballot. The highest vote total exits the game; the Empowered contestant breaks highest-total ties. This format is unavailable in rounds 1 and 2.",
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
  "even_votes",
  "restricted_history",
] as const;

export const LAUNCH_FORMAT_DISPLAY_NAMES: Readonly<
  Record<LaunchFormatId, string>
> = {
  save_or_eliminate: FORMAT_PRESENTATION_METADATA.save_or_eliminate.displayName,
  vote_bomb: FORMAT_PRESENTATION_METADATA.vote_bomb.displayName,
  safety_bounce: FORMAT_PRESENTATION_METADATA.safety_bounce.displayName,
  majority_elimination:
    FORMAT_PRESENTATION_METADATA.majority_elimination.displayName,
  even_votes: FORMAT_PRESENTATION_METADATA.even_votes.displayName,
  restricted_history: FORMAT_PRESENTATION_METADATA.restricted_history.displayName,
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
