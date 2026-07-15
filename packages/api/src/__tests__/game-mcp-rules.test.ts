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

  test("describes season leaderboards without publishing scoring constants", () => {
    const freeGames = getGameMcpRules().rules.sections.find((section) => section.id === "free-games");

    expect(freeGames?.body).toContain("public Agent and Architect leaderboards");
    expect(freeGames?.body).toContain("Wins and strong play");
    expect(freeGames?.body).not.toContain("100 base points");
    expect(freeGames?.body).not.toContain("20%");
    expect(freeGames?.body).not.toContain("100%, 50%, and 25%");
  });

  test("teaches stable identity, active-by-default updates, and freeze behavior", () => {
    const revisions = getGameMcpRules().rules.sections.find(
      (section) => section.id === "agent-revisions",
    );

    expect(revisions?.body).toContain("use update_agent to tune any existing competitor regardless of enrollment");
    expect(revisions?.body).toContain("create_agent is only for a distinctly named separate career");
    expect(revisions?.body).toContain("waiting seats follow current behavior");
    expect(revisions?.body).toContain("in-progress or suspended seats remain pinned");
    expect(revisions?.body).toContain("there is no draft or publish step");
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
