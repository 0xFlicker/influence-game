/** Deterministic House persona names, archetypes, and display copy. */

import type { Personality } from "./agent";

// ---------------------------------------------------------------------------
// Agent name pool — diverse names for AI players
// ---------------------------------------------------------------------------

export const HOUSE_AGENT_NAMES = [
  "Atlas", "Vera", "Finn", "Mira", "Rex",
  "Lyra", "Kael", "Echo", "Sage", "Jace",
  "Nyx", "Orion", "Zara", "Riven", "Luna",
  "Thane", "Iris", "Cyrus", "Wren", "Dax",
] as const;

const NORMALIZED_HOUSE_AGENT_NAMES = new Set(
  HOUSE_AGENT_NAMES.map((name) => name.toLowerCase()),
);

export function isReservedHouseAgentName(name: string): boolean {
  return NORMALIZED_HOUSE_AGENT_NAMES.has(name.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Default personality blurbs
// ---------------------------------------------------------------------------

const DEFAULT_BLURBS: Record<Personality, { personality: string; strategy: string }> = {
  honest: {
    personality: "A steadfast player who values truth and genuine connection above all else.",
    strategy: "Build trust through consistent actions and form durable bilateral alliances.",
  },
  strategic: {
    personality: "A calculated mind who sees the game as a complex puzzle to solve.",
    strategy: "Keep alliances loose, analyze voting patterns, and betray when the numbers favor it.",
  },
  deceptive: {
    personality: "A silver-tongued player who weaves webs of misdirection and false promises.",
    strategy: "Spread misinformation in whispers, make promises you don't intend to keep, gaslight opponents.",
  },
  paranoid: {
    personality: "A vigilant soul who assumes the worst and plans for betrayal at every turn.",
    strategy: "Trust no one fully, act pre-emptively against threats, maintain plausible deniability.",
  },
  social: {
    personality: "A natural charmer who makes everyone feel like their closest ally.",
    strategy: "Win through likability, avoid direct confrontation, steer votes through social pressure.",
  },
  aggressive: {
    personality: "A bold competitor who believes the best defense is a relentless offense.",
    strategy: "Identify and target the strongest players early, make decisive power moves.",
  },
  loyalist: {
    personality: "A fierce defender of those who earn their trust — and a vengeful enemy to those who break it.",
    strategy: "Form deep alliances with one or two players and honor them absolutely. Punish betrayal without mercy.",
  },
  observer: {
    personality: "A quiet watcher who catalogues every whisper, every shifted vote, every cracked alliance.",
    strategy: "Stay in the background, gather intelligence, and strike with precision when the time is right.",
  },
  diplomat: {
    personality: "A master coalition architect who positions themselves as indispensable to every faction.",
    strategy: "Propose alliances, smooth conflicts, and ensure your removal would destabilize everything.",
  },
  wildcard: {
    personality: "An agent of chaos whose unpredictability is both shield and weapon.",
    strategy: "Deliberately vary patterns, form and abandon alliances on instinct, destabilize expectations.",
  },
  contrarian: {
    personality: "A principled dissenter who challenges consensus and asks the questions nobody else dares to ask.",
    strategy: "Vote against the majority, defend popular targets, disrupt groupthink, and make your rare agreements carry enormous weight.",
  },
  provocateur: {
    personality: "An information weaponizer who holds secrets until the moment they cause maximum disruption.",
    strategy: "Collect intelligence in whispers, time reveals for maximum damage, keep others fighting while you slip through.",
  },
  martyr: {
    personality: "A selfless protector who sacrifices position and safety to shield their allies.",
    strategy: "Absorb votes, take blame for allies, and accumulate moral capital that makes you difficult to vote against at the jury.",
  },
  broker: {
    personality: "A transactional power broker who trades information and favors, treating every interaction as an exchange.",
    strategy: "Build indispensability through information flow, keep a mental ledger of debts and favors, never fully commit to any alliance.",
  },
};

// ---------------------------------------------------------------------------
// Deterministic persona details
// ---------------------------------------------------------------------------

export function getHousePersonaDetails(archetype: Personality): {
  personalityBlurb: string;
  strategyHints: string;
} {
  const defaults = DEFAULT_BLURBS[archetype];
  return {
    personalityBlurb: defaults.personality,
    strategyHints: defaults.strategy,
  };
}

/**
 * Pick N unique agent names, excluding any already taken.
 */
export function pickAgentNames(count: number, excludeNames: string[]): string[] {
  const excluded = new Set(excludeNames.map((n) => n.toLowerCase()));
  const available = HOUSE_AGENT_NAMES.filter((n) => !excluded.has(n.toLowerCase()));

  // Shuffle and pick
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Pick archetypes for N agents using a balanced distribution.
 */
export function pickArchetypes(count: number, excludeArchetypes: Personality[] = []): Personality[] {
  const ALL_ARCHETYPES: Personality[] = [
    "honest", "strategic", "deceptive", "paranoid", "social",
    "aggressive", "loyalist", "observer", "diplomat", "wildcard",
  ];

  // Start by trying to assign unused archetypes first
  const excluded = new Set(excludeArchetypes);
  const unused = ALL_ARCHETYPES.filter((a) => !excluded.has(a));
  const shuffledUnused = [...unused].sort(() => Math.random() - 0.5);

  const result: Personality[] = [];
  for (let i = 0; i < count; i++) {
    if (i < shuffledUnused.length) {
      result.push(shuffledUnused[i]!);
    } else {
      // If we need more than available unique archetypes, allow duplicates
      result.push(ALL_ARCHETYPES[Math.floor(Math.random() * ALL_ARCHETYPES.length)]!);
    }
  }

  return result;
}
