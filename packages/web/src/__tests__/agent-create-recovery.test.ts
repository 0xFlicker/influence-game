import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AgentCreateRulesLink, buildRecoveredUpdate } from "../app/dashboard/agents/agent-create-content";
import type { AgentProfileWriteParams, SavedAgent } from "../lib/api";

const baseline: AgentProfileWriteParams = {
  name: "Rowan",
  personality: "Patient.",
  backstory: "Original history.",
  strategyStyle: "Original plan.",
  personaKey: "strategic",
  gender: "non-binary",
};

function remote(overrides: Partial<SavedAgent> = {}): SavedAgent {
  return {
    id: "agent-1",
    ...baseline,
    backstory: baseline.backstory ?? null,
    strategyStyle: baseline.strategyStyle ?? null,
    personaKey: baseline.personaKey ?? null,
    avatarUrl: null,
    gamesPlayed: 0,
    gamesWon: 0,
    profileRevisionId: "revision-2",
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("Agent creation response-loss recovery", () => {
  test("links new Agent creation to the Rules", () => {
    const html = renderToString(createElement(AgentCreateRulesLink));

    expect(html).toContain('href="/rules"');
    expect(html).toContain("Read the Rules");
  });

  test("patches only locally changed fields and preserves a concurrent remote Strategy", () => {
    const update = buildRecoveredUpdate(
      baseline,
      { ...baseline, name: "Rowan Vale" },
      remote({ strategyStyle: "A newer remote plan." }),
    );

    expect(update).toEqual({ name: "Rowan Vale" });
  });

  test("blocks a three-way conflict on the same field", () => {
    expect(() => buildRecoveredUpdate(
      baseline,
      { ...baseline, strategyStyle: "The local plan." },
      remote({ strategyStyle: "The remote plan." }),
    )).toThrow("Strategy changed in another session");
  });

  test("allows an exact response-loss replay without reverting unrelated remote fields", () => {
    const local = { ...baseline, strategyStyle: "The committed local plan." };
    const update = buildRecoveredUpdate(
      baseline,
      local,
      remote({ name: "Remote Rename", strategyStyle: local.strategyStyle }),
    );

    expect(update).toEqual({ strategyStyle: local.strategyStyle });
  });
});
