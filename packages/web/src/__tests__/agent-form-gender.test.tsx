import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AgentForm } from "../app/dashboard/agents/agent-form";

describe("AgentForm gender selection", () => {
  test("offers the supported gender choices on create", () => {
    const html = renderToString(createElement(AgentForm, {
      onSubmit: async () => undefined,
      onCancel: () => undefined,
    }));

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain("Male");
    expect(html).toContain("Female");
    expect(html).toContain("Non-binary");
  });

  test("shows the saved gender as selected on edit", () => {
    const html = renderToString(createElement(AgentForm, {
      initial: {
        id: "agent-1",
        name: "Atlas",
        backstory: null,
        personality: "Strategic",
        strategyStyle: null,
        personaKey: "strategic",
        gender: "female",
        avatarUrl: null,
        gamesPlayed: 0,
        gamesWon: 0,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      onSubmit: async () => undefined,
      onCancel: () => undefined,
    }));

    expect(html).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*>Female<\/button>/);
  });
});
