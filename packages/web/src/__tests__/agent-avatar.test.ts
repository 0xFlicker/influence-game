import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AgentAvatar, resolveAgentAvatarUrl } from "../components/agent-avatar";
import { PERSONAS } from "../lib/personas";

describe("AgentAvatar", () => {
  it("uses personaKey for generated persona display text", () => {
    expect(resolveAgentAvatarUrl(null, "Zara is exuberant and unpredictable.", "Zara Quinn", "observer")).toBe(
      "/avatars/personas/observer.svg",
    );
  });

  it("keeps custom uploaded avatars ahead of persona keys", () => {
    expect(resolveAgentAvatarUrl("https://example.test/zara.png", "observer", "Zara Quinn", "strategic")).toBe(
      "https://example.test/zara.png",
    );
  });

  it("keeps generated personality blurbs out of avatar badge titles", () => {
    const html = renderToString(
      createElement(AgentAvatar, {
        persona: "Zara is exuberant and unpredictable.",
        personaKey: "observer",
        name: "Zara Quinn",
      }),
    );

    expect(html).toContain('title="Observer archetype"');
    expect(html).not.toContain("Zara is exuberant and unpredictable.");
  });

  it("has an SVG asset for every exposed persona key", () => {
    for (const persona of PERSONAS) {
      expect(
        existsSync(join(import.meta.dir, "../../public/avatars/personas", `${persona.key}.svg`)),
      ).toBe(true);
    }
  });
});
