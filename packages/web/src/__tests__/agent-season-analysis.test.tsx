import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentSeasonAnalysisView } from "../app/dashboard/agents/[id]/agent-season-analysis";

describe("agent season analysis", () => {
  test("starts with a quiet analytical shell and no edit-interruption copy", () => {
    const html = renderToStaticMarkup(<AgentSeasonAnalysisView agentId="atlas" />);
    expect(html).toContain("Season results, point receipts, and revision-separated performance");
    expect(html).toContain("Loading season analysis");
    expect(html).not.toContain("warning");
    expect(html).not.toContain("recalibr");
    expect(html).not.toContain("ELO reset");
  });
});
