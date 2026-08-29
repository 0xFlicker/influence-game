import { describe, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { AGENT_PROFILE_LIMITS } from "@influence/engine/agent-profile-contract";
import { AgentForm } from "../app/dashboard/agents/agent-form";
import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";

const auth = { account: { id: "user-1" } } as InfluenceAuthState;

function renderForm(props: Partial<ComponentProps<typeof AgentForm>> = {}) {
  return renderToString(
    <InfluenceAuthContext.Provider value={auth}>
      <AgentForm
        draftScope="agent-form-test"
        onSubmit={async () => undefined}
        onCancel={() => undefined}
        {...props}
      />
    </InfluenceAuthContext.Provider>,
  );
}

describe("AgentForm", () => {
  test("offers semantic, touch-friendly gender choices", () => {
    const html = renderForm();

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain("Male");
    expect(html).toContain("Female");
    expect(html).toContain("Non-binary");
    expect(html).toContain("min-h-11");
    expect(html).toContain("flex-[1_1_auto]");
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("Generate replaces the current profile text and image.");
  });

  test("shows the saved gender as selected on edit", () => {
    const html = renderForm({
      initial: {
        id: "agent-1",
        name: "Atlas",
        backstory: null,
        personality: "Strategic",
        strategyStyle: "Wait for evidence.",
        personaKey: "strategic",
        gender: "female",
        avatarUrl: "/avatars/atlas.png",
        gamesPlayed: 0,
        gamesWon: 0,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
    });

    expect(html).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*>Female<\/button>/);
    expect(html).toContain("Generate replaces the current profile text.");
    expect(html).not.toContain("Generate replaces the current profile text and image.");
  });

  test("makes Strategy the dominant long-form field and shares server limits", () => {
    const html = renderForm();

    expect(html).toContain('id="agent-strategyStyle"');
    expect(html).toContain(`maxLength="${AGENT_PROFILE_LIMITS.strategyStyle}"`);
    expect(html).toContain(`maxLength="${AGENT_PROFILE_LIMITS.personality}"`);
    expect(html).toContain(`maxLength="${AGENT_PROFILE_LIMITS.backstory}"`);
    expect(html).toContain("lg:min-h-80");
  });

  test("starts a review edit from the proposal and keeps the baseline visible", () => {
    const html = renderForm({
      initial: {
        id: "agent-1",
        name: "Atlas",
        backstory: null,
        personality: "Strategic",
        strategyStyle: "Build one voting bloc, then commit.",
        personaKey: "strategic",
        gender: "female",
        avatarUrl: null,
        gamesPlayed: 0,
        gamesWon: 0,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      strategyComparison: {
        baseline: "Collect information and stay flexible.",
        initialWorking: "Build one voting bloc, then commit.",
        baselineLabel: "Current strategy",
        requireChange: true,
      },
    });

    expect(html).toContain("Live changes");
    expect(html).toContain("Strategy changes from Current strategy");
    expect(html).toContain("xl:grid-cols-2");
    expect(html).toContain("xl:h-[40rem]");
    expect(html).toContain("xl:!h-[40rem]");
    expect(html).toContain(">Collect</span>");
    expect(html).toContain("Build one voting bloc, then commit.");
    expect(html).toContain(">Build one voting bloc, then commit.</textarea>");
    expect(html).toContain("Edit the suggestion to save a custom Strategy update.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save Agent<\/button>/);
  });
});
