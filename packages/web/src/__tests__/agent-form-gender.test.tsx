import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AgentForm, generationButtonLabel } from "../app/dashboard/agents/agent-form";

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

  test("uses the compact two-column desktop layout without narrowing Strategy Style", () => {
    const html = renderToString(createElement(AgentForm, {
      compact: true,
      onSubmit: async () => undefined,
      onCancel: () => undefined,
    }));

    expect(html).toContain("md:grid-cols-2");
    expect(html).toContain("Strategy Style");
    expect(html.match(/md:col-span-2/g)?.length).toBeGreaterThanOrEqual(5);
  });

  test("gives Backstory and Personality matching fixed heights in the compact layout", () => {
    const html = renderToString(createElement(AgentForm, {
      compact: true,
      onSubmit: async () => undefined,
      onCancel: () => undefined,
    }));

    expect(html.match(/rows="4"/g)).toHaveLength(2);
  });

  test("keeps generation feedback inside the Generate button", () => {
    expect(generationButtonLabel({ generating: false, portraitStarting: false, portraitPending: false })).toBe("Generate");
    expect(generationButtonLabel({ generating: true, portraitStarting: false, portraitPending: false })).toBe("Generating...");
    expect(generationButtonLabel({ generating: false, portraitStarting: true, portraitPending: false })).toBe("Generating portrait...");
  });
});
