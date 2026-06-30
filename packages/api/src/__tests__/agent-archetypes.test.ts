import { describe, expect, test } from "bun:test";
import {
  USER_SELECTABLE_AGENT_ARCHETYPE_KEYS,
  USER_SELECTABLE_AGENT_ARCHETYPES,
  formatUserSelectableAgentArchetypeKeys,
  getUserSelectableAgentArchetype,
  isUserSelectableAgentArchetype,
} from "../services/agent-archetypes.js";

describe("agent archetype catalog", () => {
  test("defines the current user-selectable profile archetypes", () => {
    expect(USER_SELECTABLE_AGENT_ARCHETYPE_KEYS).toEqual([
      "honest",
      "strategic",
      "deceptive",
      "paranoid",
      "social",
      "aggressive",
      "loyalist",
      "observer",
      "diplomat",
      "wildcard",
      "contrarian",
      "provocateur",
      "martyr",
    ]);
    expect(USER_SELECTABLE_AGENT_ARCHETYPE_KEYS).not.toContain("broker");
  });

  test("keeps validation and display text on the same keys", () => {
    expect(formatUserSelectableAgentArchetypeKeys()).toBe(
      USER_SELECTABLE_AGENT_ARCHETYPE_KEYS.join(", "),
    );

    for (const archetype of USER_SELECTABLE_AGENT_ARCHETYPES) {
      expect(isUserSelectableAgentArchetype(archetype.key)).toBe(true);
      expect(getUserSelectableAgentArchetype(archetype.key)).toEqual(archetype);
      expect(archetype.label).toBeTruthy();
      expect(archetype.description).toBeTruthy();
      expect(archetype.creationHint).toBeTruthy();
      expect(archetype.strategyHint).toBeTruthy();
    }

    expect(isUserSelectableAgentArchetype("broker")).toBe(false);
    expect(getUserSelectableAgentArchetype("broker")).toBeNull();
  });
});
