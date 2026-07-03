import { describe, expect, test } from "bun:test";
import {
  getGameMcpRules,
  listGameMcpArchetypes,
  searchGameMcpRules,
} from "../game-mcp/rules.js";
import {
  USER_SELECTABLE_AGENT_ARCHETYPE_KEYS,
  isUserSelectableAgentArchetype,
} from "../services/agent-archetypes.js";

describe("game MCP rules catalog", () => {
  test("returns rules without stale per-agent rating reset copy", () => {
    const rules = getGameMcpRules();
    const serialized = JSON.stringify(rules).toLowerCase();

    expect(rules.schemaVersion).toBe(1);
    expect(rules.rules.ratingProvenance.kind).toBe("account-level-free-track");
    expect(serialized).toContain("account-level");
    expect(serialized).not.toContain("rating resets");
    expect(serialized).not.toContain("reset to 1200");
    expect(serialized).not.toContain("top 100 agents");
  });

  test("describes named-alliance cadence and read-only MCP boundaries", () => {
    const rules = getGameMcpRules();
    const serialized = JSON.stringify(rules).toLowerCase();
    const standardRound = rules.rules.sections.find((section) => section.id === "standard-round");
    const namedAlliances = rules.rules.sections.find((section) => section.id === "named-alliances");

    expect(standardRound?.body).toContain("Mingle I");
    expect(standardRound?.body).toContain("pre-vote alliance huddles");
    expect(standardRound?.body).toContain("public Vote");
    expect(standardRound?.body).toContain("post-vote Mingle");
    expect(namedAlliances?.body).toContain("Consent attaches to the same name, roster, purpose, and timebox version");
    expect(namedAlliances?.body).toContain("MCP active-match tools are read-only");
    expect(serialized).not.toContain("whisper");
    expect(serialized).not.toContain("each standard round moves through lobby, vote, mingle, power, reveal, and council");
  });

  test("lists archetypes from the shared validation catalog", () => {
    const read = listGameMcpArchetypes({ includeStrategyHints: true });
    const keys = read.archetypes.map((archetype) => archetype.key);

    expect(keys).toEqual(USER_SELECTABLE_AGENT_ARCHETYPE_KEYS);
    expect(keys).not.toContain("broker");

    for (const archetype of read.archetypes) {
      expect(archetype.selectable).toBe(true);
      expect(isUserSelectableAgentArchetype(archetype.key)).toBe(true);
      expect(archetype.creationHint).toBeTruthy();
      expect(archetype.strategyHint).toBeTruthy();
    }
  });

  test("searches structured rules sections", () => {
    const archetypeMatches = searchGameMcpRules({ query: "diplomat" });
    expect(archetypeMatches.matches.map((match) => match.id)).toContain("archetypes");

    const endgameMatches = searchGameMcpRules({ query: "jury" });
    expect(endgameMatches.matches.map((match) => match.id)).toContain("endgame");

    const allianceMatches = searchGameMcpRules({ query: "huddle" });
    expect(allianceMatches.matches.map((match) => match.id)).toContain("named-alliances");

    const emptyMatches = searchGameMcpRules({ query: "   " });
    expect(emptyMatches.matches).toEqual([]);
  });
});
