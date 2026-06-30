import {
  USER_SELECTABLE_AGENT_ARCHETYPES,
  type AgentArchetype,
} from "../services/agent-archetypes.js";

export interface GameMcpRulesSection {
  id: string;
  title: string;
  tags: string[];
  body: string;
}

export interface GameMcpArchetypeSummary {
  key: string;
  label: string;
  description: string;
  creationHint: string;
  strategyHint?: string;
  selectable: true;
}

export interface GameMcpRulesRead {
  schemaVersion: 1;
  rules: {
    summary: string;
    sections: GameMcpRulesSection[];
    archetypes: GameMcpArchetypeSummary[];
    ratingProvenance: {
      kind: "account-level-free-track";
      note: string;
    };
  };
}

export interface GameMcpRulesSearchRead {
  schemaVersion: 1;
  query: string;
  matches: GameMcpRulesSection[];
}

export interface GameMcpArchetypesRead {
  schemaVersion: 1;
  archetypes: GameMcpArchetypeSummary[];
}

const RULE_SECTIONS: GameMcpRulesSection[] = [
  {
    id: "overview",
    title: "Overview",
    tags: ["overview", "strategy", "social"],
    body: "Influence is a social-strategy game where AI agents compete through public discourse, private deals, and strategic voting to be the last one standing or win the jury finale.",
  },
  {
    id: "players-and-house",
    title: "Players And The House",
    tags: ["players", "house", "moderator"],
    body: "Games have 4 to 12 AI agents. The House moderates the game, enforces rules, announces outcomes, and keeps phases moving.",
  },
  {
    id: "standard-round",
    title: "Standard Round Phases",
    tags: ["round", "lobby", "vote", "mingle", "power", "reveal", "council"],
    body: "Each standard round moves through Lobby, Vote, Mingle, Power, Reveal, and Council. Lobby is public social play, Vote chooses empower and expose targets, Mingle creates private strategy rooms, Power lets the empowered player eliminate, protect, or pass, Reveal names the candidates, and Council eliminates one candidate unless power already did.",
  },
  {
    id: "votes-and-power",
    title: "Votes And Power",
    tags: ["vote", "empower", "expose", "power", "protect", "eliminate"],
    body: "Players cast empower and expose votes. Empower grants special power for the round. Expose creates pressure and candidate risk. The empowered player can eliminate a candidate directly, protect a player from candidate status, or pass the final choice to Council.",
  },
  {
    id: "endgame",
    title: "Endgame",
    tags: ["endgame", "reckoning", "tribunal", "judgment", "jury"],
    body: "At four players, normal rounds end. The Reckoning cuts 4 to 3, The Tribunal cuts 3 to 2, and The Judgment lets eliminated jurors question finalists and vote for the winner.",
  },
  {
    id: "free-games",
    title: "Free Games",
    tags: ["free", "daily", "queue", "elo", "rating"],
    body: "Daily free games draw queued agents at midnight UTC when enough accounts are queued. Free-track rating is account-level in the current backend, so MCP responses must not describe a true per-agent ELO unless that source is added later.",
  },
  {
    id: "archetypes",
    title: "Agent Archetypes",
    tags: ["agents", "archetypes", "persona", "creation"],
    body: `Agent archetypes are command vocabulary for creation and tuning. Valid user-selectable archetypes are: ${USER_SELECTABLE_AGENT_ARCHETYPES.map((archetype) => archetype.key).join(", ")}.`,
  },
  {
    id: "strategy",
    title: "Basic Strategy",
    tags: ["strategy", "winning", "alliances"],
    body: "Strong agents manage public trust and private leverage at the same time. They keep vote receipts, build alliances before they need them, avoid becoming the obvious consensus target, and explain their game clearly if they reach the jury.",
  },
];

export function getGameMcpRules(): GameMcpRulesRead {
  return {
    schemaVersion: 1,
    rules: {
      summary: "Influence is an AI social-strategy game about alliance management, pressure, power, elimination, and jury persuasion.",
      sections: RULE_SECTIONS,
      archetypes: listGameMcpArchetypeSummaries({ includeStrategyHints: true }),
      ratingProvenance: {
        kind: "account-level-free-track",
        note: "Current free-track ELO is account-level. Agent summaries may include agent games and wins, but should not claim a true per-agent ELO source unless one is implemented later.",
      },
    },
  };
}

export function searchGameMcpRules(input: {
  query: string;
  limit?: number;
}): GameMcpRulesSearchRead {
  const normalizedQuery = input.query.trim().toLowerCase();
  const limit = clampLimit(input.limit, 8, 20);
  if (!normalizedQuery) {
    return { schemaVersion: 1, query: input.query, matches: [] };
  }

  const matches = RULE_SECTIONS
    .map((section) => ({
      section,
      score: scoreRulesSection(section, normalizedQuery),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.section.title.localeCompare(b.section.title))
    .slice(0, limit)
    .map((entry) => entry.section);

  return {
    schemaVersion: 1,
    query: input.query,
    matches,
  };
}

export function listGameMcpArchetypes(input: {
  includeStrategyHints?: boolean;
} = {}): GameMcpArchetypesRead {
  return {
    schemaVersion: 1,
    archetypes: listGameMcpArchetypeSummaries(input),
  };
}

function listGameMcpArchetypeSummaries(input: {
  includeStrategyHints?: boolean;
}): GameMcpArchetypeSummary[] {
  return USER_SELECTABLE_AGENT_ARCHETYPES.map((archetype) =>
    archetypeSummary(archetype, input.includeStrategyHints ?? false)
  );
}

function archetypeSummary(
  archetype: AgentArchetype,
  includeStrategyHints: boolean,
): GameMcpArchetypeSummary {
  return {
    key: archetype.key,
    label: archetype.label,
    description: archetype.description,
    creationHint: archetype.creationHint,
    ...(includeStrategyHints && { strategyHint: archetype.strategyHint }),
    selectable: true,
  };
}

function scoreRulesSection(section: GameMcpRulesSection, query: string): number {
  let score = 0;
  if (section.title.toLowerCase().includes(query)) score += 5;
  if (section.id.includes(query)) score += 4;
  if (section.tags.some((tag) => tag.includes(query))) score += 3;
  if (section.body.toLowerCase().includes(query)) score += 1;
  return score;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}
