import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentList } from "@/app/dashboard/agents/agent-list";
import type { SavedAgent } from "@/lib/api";
import { AgentModelLabel, agentModelLabel } from "./agent-model-label";
import { AgentAvatarPreviewContent } from "./agent-avatar-preview";

test("Default and missing preferences have no model label or placeholder", () => {
  for (const preference of [undefined, null, "default"] as const) {
    expect(agentModelLabel(preference)).toBeNull();
    expect(renderToStaticMarkup(<AgentModelLabel preference={preference} />)).toBe("");
  }
});

test("explicit choices use the shared model label, preserving an unknown exact ID", () => {
  expect(agentModelLabel({ catalogId: "openai:gpt-6-luna" })).toBe("OpenAI gpt-6-luna");
  expect(agentModelLabel({ catalogId: "katana:kimi-k3" })).toBe("Katana kimi-k3");
  expect(agentModelLabel({ catalogId: "future-provider:custom" })).toBe("future-provider:custom");
});

test("saved-agent cards and portrait previews show explicit model choices beside archetype information", () => {
  const agent: SavedAgent = { id: "one", name: "Mira", personaKey: "strategic", personality: "Curious", backstory: null,
    strategyStyle: null, avatarUrl: null, gamesPlayed: 0, gamesWon: 0, createdAt: "", updatedAt: "",
    modelPreference: { catalogId: "openai:gpt-6.1-sol" } };
  const card = renderToStaticMarkup(<AgentList agents={[agent]} onEdit={() => {}} onDelete={() => {}} />);
  const preview = renderToStaticMarkup(<AgentAvatarPreviewContent {...agent} />);
  for (const html of [card, preview]) {
    expect(html).toContain("OpenAI gpt-6.1-sol");
    expect(html).not.toContain("Default");
    expect(html).not.toContain("Flex");
  }
  expect(renderToStaticMarkup(<AgentList agents={[{ ...agent, modelPreference: "default" }]} onEdit={() => {}} onDelete={() => {}} />))
    .not.toContain("OpenAI");
});
