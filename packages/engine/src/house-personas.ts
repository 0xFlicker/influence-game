/** Deterministic House persona names, archetypes, and display copy. */

import type { Personality } from "./agent";

// ---------------------------------------------------------------------------
// Existing Agent Profile name-reservation policy, independent of cast selection.
// ---------------------------------------------------------------------------

export const HOUSE_AGENT_NAMES = [
  "Atlas", "Vera", "Finn", "Mira", "Rex",
  "Lyra", "Kael", "Echo", "Sage", "Jace",
  "Nyx", "Orion", "Zara", "Riven", "Luna",
  "Thane", "Iris", "Cyrus", "Wren", "Dax",
] as const;

/** Curated from the bundled fictional portraits and their authored prompts.
 * Order also defines the existing deterministic fallback portrait selection.
 */
const HOUSE_PORTRAIT_GENDERS = {
  honest: "male", strategic: "male", deceptive: "female", paranoid: "female", social: "female",
  aggressive: "male", loyalist: "male", observer: "female", diplomat: "female", wildcard: "male",
  contrarian: "female", provocateur: "male", martyr: "female",
  broker: "female",
} as const;
export type HousePortraitKey = keyof typeof HOUSE_PORTRAIT_GENDERS;
export const HOUSE_PORTRAIT_KEYS = Object.freeze(Object.keys(HOUSE_PORTRAIT_GENDERS) as (keyof typeof HOUSE_PORTRAIT_GENDERS)[]);

/** Same portrait selection for viewers, visual production, and House casting. */
export function getHousePortraitKey(name: string, personaKey?: string | null): keyof typeof HOUSE_PORTRAIT_GENDERS {
  const key = personaKey?.trim().toLowerCase();
  if (key && Object.hasOwn(HOUSE_PORTRAIT_GENDERS, key)) return key as keyof typeof HOUSE_PORTRAIT_GENDERS;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return HOUSE_PORTRAIT_KEYS[hash % HOUSE_PORTRAIT_KEYS.length]!;
}

/** Apply only to built-in House seats, never infer an owned character's gender. */
export function getHousePortraitGender(name: string, personaKey?: string | null): "male" | "female" {
  return HOUSE_PORTRAIT_GENDERS[getHousePortraitKey(name, personaKey)];
}

/** Original authored identities. Shuffle characters, never names and archetypes separately. */
export const HOUSE_CAST = Object.freeze([
  { name: "Atlas", personality: "strategic", gender: "male" },
  { name: "Vera", personality: "deceptive", gender: "female" },
  { name: "Finn", personality: "honest", gender: "male" },
  { name: "Mira", personality: "social", gender: "female" },
  { name: "Rex", personality: "aggressive", gender: "male" },
  { name: "Lyra", personality: "paranoid", gender: "female" },
  { name: "Kael", personality: "loyalist", gender: "male" },
  { name: "Echo", personality: "observer", gender: "female" },
  { name: "Sage", personality: "diplomat", gender: "female" },
  { name: "Jace", personality: "wildcard", gender: "male" },
  { name: "Rune", personality: "provocateur", gender: "male" },
  { name: "Wren", personality: "martyr", gender: "female" },
  { name: "Nyx", personality: "contrarian", gender: "female" },
  { name: "Vex", personality: "broker", gender: "female" },
] as const satisfies readonly { name: string; personality: Personality; gender: "male" | "female" }[]);

export class HouseCastCapacityError extends Error {}

/** Select distinct complete identities. A restricted pool cannot clone a character. */
export function pickHouseCast(count: number, options: {
  excludeNames?: readonly string[];
  excludeArchetypes?: readonly string[];
  personaPool?: readonly Personality[];
  fillStrategy?: "balanced" | "random";
} = {}) {
  if (!Number.isInteger(count) || count < 0) throw new Error("House cast count must be a nonnegative integer");
  const excluded = new Set(options.excludeNames?.map(name => name.trim().toLowerCase()));
  const pool = new Set(options.personaPool ?? HOUSE_CAST.map(member => member.personality));
  const available = HOUSE_CAST.filter(member => !excluded.has(member.name.toLowerCase()) && pool.has(member.personality));
  if (available.length < count) throw new HouseCastCapacityError(`Only ${available.length} distinct House characters are available for ${count} seats. Add archetypes to the casting pool or seat owned agents.`);
  for (let index = available.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [available[index], available[other]] = [available[other]!, available[index]!];
  }
  if (options.fillStrategy !== "random") {
    const used = new Set(options.excludeArchetypes);
    available.sort((left, right) => Number(used.has(left.personality)) - Number(used.has(right.personality)));
  }
  return available.slice(0, count);
}

/** Reconcile waiting House seats once, before their immutable game-start roster.
 * Keep distinct existing archetypes first; replace duplicated/unknown identities.
 */
export function restoreHouseCast(personaKeys: readonly (string | null | undefined)[], excludeNames: readonly string[], personaPool: readonly Personality[] = HOUSE_CAST.map(member => member.personality)) {
  const used = new Set(excludeNames.map(name => name.trim().toLowerCase()));
  const pool = new Set(personaPool);
  const matches = personaKeys.map(key => {
    const member = HOUSE_CAST.find(candidate => candidate.personality === key && pool.has(candidate.personality) && !used.has(candidate.name.toLowerCase()));
    if (member) used.add(member.name.toLowerCase());
    return member;
  });
  const remaining = HOUSE_CAST.filter(member => pool.has(member.personality) && !used.has(member.name.toLowerCase()));
  const missing = matches.filter(member => !member).length;
  if (remaining.length < missing) throw new HouseCastCapacityError(`The casting pool cannot supply ${personaKeys.length} distinct House characters. Add archetypes or seat owned agents.`);
  return matches.map(member => member ?? remaining.shift()!);
}

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

export const HOUSE_PERSONA_KEYS: Personality[] = HOUSE_CAST.map(member => member.personality);

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
