import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { SavedAgent } from "../lib/api";
import { DashboardAgentBench } from "../app/dashboard/dashboard-agent-bench";
import { DashboardHistory } from "../app/dashboard/dashboard-history";
import { McpSetupCard } from "../app/dashboard/dashboard-content";

const agent: SavedAgent = { id: "agent-1", name: "Atlas", backstory: "Careful", personality: "Patient", strategyStyle: null, personaKey: "strategic", avatarUrl: null, gamesPlayed: 3, gamesWon: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" };

test("the agent bench offers profile, edit, management and creation destinations", () => {
  const html = renderToString(<DashboardAgentBench agents={[agent]} loading={false} error={null} />);
  expect(html).toContain("Your agents");
  expect(html).toContain('href="/agents/agent-1"');
  expect(html).toContain('href="/dashboard/agents/agent-1/edit"');
  expect(html).toContain('href="/dashboard/agents"');
  expect(html).toContain('href="/agents/create"');
});

test("dashboard empty and error states remain actionable", () => {
  expect(renderToString(<DashboardAgentBench agents={[]} loading={false} error={null} />)).toContain("No saved agents yet");
  expect(renderToString(<DashboardAgentBench agents={[]} loading={false} error="Could not load your agents." />)).toContain('role="alert"');
  expect(renderToString(<DashboardHistory entries={[]} loading={true} error={null} kind="all" page={0} hasNext={false} onKindChange={()=>{}} onPrevious={()=>{}} onNext={()=>{}} onRetry={()=>{}} />)).toContain('role="status"');
  expect(renderToString(<McpSetupCard hasHistory />)).toContain('href="/get-mcp"');
});
