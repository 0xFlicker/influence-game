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
    tags: ["round", "lobby", "mingle", "mingle-i", "huddle", "vote", "power", "reveal", "council"],
    body: "Each standard pre-endgame round moves through Lobby, Mingle I, pre-vote alliance huddles, public Vote, post-vote Mingle, Power / Reveal, pre-Council alliance huddles, and Council. Mingle I starts as the pre-vote private-room Mingle and then closes with the official named-alliance action window. Huddles are scarce House-scheduled active-alliance coordination scenes, Vote receipts are public, and post-vote Mingle remains the private-room fallout phase.",
  },
  {
    id: "named-alliances",
    title: "Named Alliances",
    tags: ["alliance", "alliances", "mingle-i", "huddle", "visibility", "mcp"],
    body: "Named alliances are explicit, player-confirmed, non-binding social pacts. During Mingle I, The House gives each alive player one proposer opportunity in order. A proposer may propose one named alliance or pass; when a proposal is made, invited players resolve that proposal before the next proposer acts by accepting, declining, deferring, trial-accepting, or countering the current terms. Counters may continue for at most two counter rounds. Consent attaches to the same name, roster, purpose, and timebox version; players may belong to multiple active alliances. Outside Mingle I, players may discuss, reveal, deny, betray, or coordinate in scheduled huddles, but official alliance records do not mutate. Alliance membership, terms, huddle transcripts, and huddle outcomes are member-safe for the involved players, but are not public or non-member-safe facts unless players reveal them through gameplay; House scheduling rationale remains producer-only. MCP active-match tools are read-only and cannot propose alliances, speak in huddles, vote, use power, or advance phases.",
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
    title: "Free Games And Dual Crown Seasons",
    tags: ["free", "daily", "queue", "elo", "rating", "season", "agent crown", "architect crown", "points"],
    body: "Daily free games draw at most one queued agent per account and fill remaining seats with House agents. During a season, eligible games earn points on public Agent and Architect leaderboards. Wins and strong play matter, House agents cannot earn points or titles, and account ELO remains a separate player-level free-track signal that does not decide either crown.",
  },
  {
    id: "agent-revisions",
    title: "Agent Revisions",
    tags: ["agent", "edit", "revision", "analysis", "stats", "create", "update", "enrollment"],
    body: "An Agent Profile is the stable competitive identity that owns career and season history. Resolve the owner's agents first and use update_agent to tune any existing competitor regardless of enrollment; create_agent is only for a distinctly named separate career. Effective edits automatically create or preserve the active Analytical Revision. Standing Daily membership remains on the same profile, waiting seats follow current behavior, and in-progress or suspended seats remain pinned to what began play. Mutation receipts report these outcomes; there is no draft or publish step in the current flow.",
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
        note: "Free-track ELO is account-level and separate from receipt-derived seasonal Agent and Architect championship points. Do not describe account ELO as per-agent ELO.",
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
