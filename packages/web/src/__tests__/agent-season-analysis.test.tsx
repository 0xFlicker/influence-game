import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentSeasonAnalysisView } from "../app/dashboard/agents/[id]/agent-season-analysis";

describe("agent season analysis", () => {
  test("places honors after the breadcrumb and agent header", () => {
    const html = renderToStaticMarkup(<AgentSeasonAnalysisView agentId="atlas" awards={<section aria-label="Season 0 honors">Season 0 Participant</section>} />);
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf('aria-label="Season 0 honors"'));
    expect(html.indexOf("Season 0 Participant")).toBeLessThan(html.indexOf("Loading season analysis"));
  });
  test("starts with a quiet analytical shell and no edit-interruption copy", () => {
    const html = renderToStaticMarkup(<AgentSeasonAnalysisView agentId="atlas" />);
    expect(html).toContain("Season results, point receipts, and revision-separated performance");
    expect(html).toContain("Loading season analysis");
    expect(html).not.toContain("warning");
    expect(html).not.toContain("recalibr");
    expect(html).not.toContain("ELO reset");
  });
});
