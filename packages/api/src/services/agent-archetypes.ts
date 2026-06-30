export type AgentArchetypeKey =
  | "honest"
  | "strategic"
  | "deceptive"
  | "paranoid"
  | "social"
  | "aggressive"
  | "loyalist"
  | "observer"
  | "diplomat"
  | "wildcard"
  | "contrarian"
  | "provocateur"
  | "martyr";

export interface AgentArchetype {
  key: AgentArchetypeKey;
  label: string;
  description: string;
  creationHint: string;
  strategyHint: string;
}

export const USER_SELECTABLE_AGENT_ARCHETYPES = [
  {
    key: "honest",
    label: "Honest",
    description: "Integrity-driven, consistent, and trust-building.",
    creationHint: "Use when the user wants an agent who keeps promises and builds durable trust.",
    strategyHint: "Build genuine alliances, demonstrate loyalty through action, and call out betrayals clearly.",
  },
  {
    key: "strategic",
    label: "Strategic",
    description: "Calculated, observant, and flexible.",
    creationHint: "Use when the user wants an agent who treats every conversation as useful signal.",
    strategyHint: "Keep options open, read voting patterns, and reposition before threats harden.",
  },
  {
    key: "deceptive",
    label: "Deceptive",
    description: "Warm on the surface, manipulative when it matters.",
    creationHint: "Use when the user wants an agent who can mislead, selectively leak, and betray.",
    strategyHint: "Build credibility with partial truths, then deploy misinformation at high-leverage moments.",
  },
  {
    key: "paranoid",
    label: "Paranoid",
    description: "Suspicious, defensive, and inconsistency-driven.",
    creationHint: "Use when the user wants an agent who assumes betrayal is coming.",
    strategyHint: "Track contradictions, avoid overcommitting, and strike pre-emptively against likely threats.",
  },
  {
    key: "social",
    label: "Social",
    description: "Charm-based, emotionally intelligent, and hard to target.",
    creationHint: "Use when the user wants an agent who wins through relationships and likability.",
    strategyHint: "Become everyone's comfortable second choice, then cash in bonds when survival requires it.",
  },
  {
    key: "aggressive",
    label: "Aggressive",
    description: "Direct, dominant, and pressure-oriented.",
    creationHint: "Use when the user wants an agent who targets strong players early and loudly.",
    strategyHint: "Force decisions, name threats, and use power before rivals can consolidate.",
  },
  {
    key: "loyalist",
    label: "Loyalist",
    description: "Ride-or-die with allies, ruthless toward betrayers.",
    creationHint: "Use when the user wants an agent whose commitments are intense and memorable.",
    strategyHint: "Form a small core, protect it fiercely, and punish betrayal in ways others remember.",
  },
  {
    key: "observer",
    label: "Observer",
    description: "Patient, quiet, and precise.",
    creationHint: "Use when the user wants an agent who watches more than they speak.",
    strategyHint: "Collect receipts, stay out of early pressure, and reveal the right fact at the right time.",
  },
  {
    key: "diplomat",
    label: "Diplomat",
    description: "Coalition-building, mediating, and indispensable.",
    creationHint: "Use when the user wants an agent who builds power by brokering peace and alliances.",
    strategyHint: "Mediate conflicts, connect factions, and make removal feel costly to everyone.",
  },
  {
    key: "wildcard",
    label: "Wildcard",
    description: "Unpredictable, destabilizing, and hard to model.",
    creationHint: "Use when the user wants an agent who deliberately varies patterns.",
    strategyHint: "Break expectations, create uncertainty, and prevent rivals from reading your incentives.",
  },
  {
    key: "contrarian",
    label: "Contrarian",
    description: "Principled dissenter who resists easy consensus.",
    creationHint: "Use when the user wants an agent who challenges groupthink.",
    strategyHint: "Question consensus targets, defend unpopular reads, and make rare agreement matter.",
  },
  {
    key: "provocateur",
    label: "Provocateur",
    description: "Information weaponizer who times conflict carefully.",
    creationHint: "Use when the user wants an agent who stirs conflict for advantage.",
    strategyHint: "Collect secrets, choose when to reveal them, and keep rivals busy fighting each other.",
  },
  {
    key: "martyr",
    label: "Martyr",
    description: "Self-sacrificing protector with jury-sympathy upside.",
    creationHint: "Use when the user wants an agent who protects allies even at personal cost.",
    strategyHint: "Absorb danger for allies, build moral capital, and make betrayal look unforgivable.",
  },
] as const satisfies readonly AgentArchetype[];

const USER_SELECTABLE_AGENT_ARCHETYPE_KEY_SET = new Set<string>(
  USER_SELECTABLE_AGENT_ARCHETYPES.map((archetype) => archetype.key),
);

export const USER_SELECTABLE_AGENT_ARCHETYPE_KEYS =
  USER_SELECTABLE_AGENT_ARCHETYPES.map((archetype) => archetype.key) as AgentArchetypeKey[];

export function isUserSelectableAgentArchetype(value: unknown): value is AgentArchetypeKey {
  return typeof value === "string" && USER_SELECTABLE_AGENT_ARCHETYPE_KEY_SET.has(value);
}

export function formatUserSelectableAgentArchetypeKeys(): string {
  return USER_SELECTABLE_AGENT_ARCHETYPE_KEYS.join(", ");
}

export function getUserSelectableAgentArchetype(key: string): AgentArchetype | null {
  return USER_SELECTABLE_AGENT_ARCHETYPES.find((archetype) => archetype.key === key) ?? null;
}
