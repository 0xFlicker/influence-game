import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AgentImageControl } from "../components/agent-image-control";

describe("AgentImageControl", () => {
  it("keeps portrait preview without an upload action", () => {
    const html = renderToString(
      createElement(AgentImageControl, {
        currentUrl: undefined,
        persona: "strategic",
        name: "Atlas",
      }),
    );

    expect(html).toContain("/avatars/personas/strategic.png");
    expect(html).toContain('aria-label="View Atlas portrait and stats"');
    expect(html).not.toContain("Change portrait");
    expect(html).not.toContain('type="file"');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/);
  });

  it("still renders an explicit avatar URL when one exists", () => {
    const html = renderToString(
      createElement(AgentImageControl, {
        currentUrl: "https://cdn.example/atlas.png",
        persona: "strategic",
        name: "Atlas",
      }),
    );

    expect(html).toContain("https://cdn.example/atlas.png");
  });
});
