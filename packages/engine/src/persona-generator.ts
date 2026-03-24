/**
 * Persona Generator
 *
 * Uses LLM to generate unique personality descriptions and strategy hints
 * for AI players based on their archetype. Falls back to hardcoded defaults.
 */

import OpenAI from "openai";
import type { Personality } from "./agent";

// ---------------------------------------------------------------------------
// Agent name pool — diverse names for AI players
// ---------------------------------------------------------------------------

const AGENT_NAMES: string[] = [
  "Atlas", "Vera", "Finn", "Mira", "Rex",
  "Lyra", "Kael", "Echo", "Sage", "Jace",
  "Nyx", "Orion", "Zara", "Riven", "Luna",
  "Thane", "Iris", "Cyrus", "Wren", "Dax",
];

// ---------------------------------------------------------------------------
// Default personality blurbs (fallback if LLM fails)
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
};

// ---------------------------------------------------------------------------
// LLM generation
// ---------------------------------------------------------------------------

export interface GeneratedPersona {
  name: string;
  personality: string;
  strategyHints: string;
  personaKey: Personality;
}

/**
 * Generate a unique personality description and strategy using LLM.
 * Falls back to defaults if the LLM call fails.
 */
export async function generatePersona(
  openai: OpenAI,
  name: string,
  archetype: Personality,
  model = "gpt-5-nano",
): Promise<GeneratedPersona> {
  try {
    const isGpt5 = model.startsWith("gpt-5");
    const isReasoning = /^o\d/.test(model) || model === "gpt-5-nano" || model === "gpt-5-mini";
    const budget = isReasoning ? 600 : 200;
    const response = await openai.chat.completions.create({
      model,
      ...(isGpt5 || isReasoning
        ? { max_completion_tokens: budget }
        : { max_tokens: budget }),
      ...(!isReasoning && { temperature: 0.9 }),
      messages: [
        {
          role: "system",
          content: `You are a character designer for a social strategy game called "Influence". Generate a unique personality description and strategy hint for an AI player.`,
        },
        {
          role: "user",
          content: `Create a personality blurb and strategy hint for a player named "${name}" with the "${archetype}" archetype.

Respond with JSON only:
{
  "personality": "A 1-2 sentence description of this character's personality and vibe. Make it unique and flavorful.",
  "strategy": "A 1-2 sentence summary of their strategic approach in the game."
}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(content) as { personality?: string; strategy?: string };
      if (parsed.personality && parsed.strategy) {
        return {
          name,
          personality: parsed.personality,
          strategyHints: parsed.strategy,
          personaKey: archetype,
        };
      }
    }
  } catch (err) {
    console.warn(`[persona-generator] LLM generation failed for ${name}, using defaults:`, err);
  }

  // Fallback to defaults
  const defaults = DEFAULT_BLURBS[archetype];
  return {
    name,
    personality: defaults.personality,
    strategyHints: defaults.strategy,
    personaKey: archetype,
  };
}

/**
 * Pick N unique agent names, excluding any already taken.
 */
export function pickAgentNames(count: number, excludeNames: string[]): string[] {
  const excluded = new Set(excludeNames.map((n) => n.toLowerCase()));
  const available = AGENT_NAMES.filter((n) => !excluded.has(n.toLowerCase()));

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
