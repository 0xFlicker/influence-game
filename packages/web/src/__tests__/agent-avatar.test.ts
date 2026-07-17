import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AgentAvatar, resolveAgentAvatarUrl } from "../components/agent-avatar";
import {
  AgentAvatarPreview,
  AgentAvatarPreviewContent,
  type PublicAgentAvatarPreview,
} from "../components/agent-avatar-preview";
import { setApiBase } from "../lib/api";
import { PERSONAS } from "../lib/personas";

describe("AgentAvatar", () => {
  it("uses personaKey for generated persona display text", () => {
    expect(resolveAgentAvatarUrl(null, "Zara is exuberant and unpredictable.", "Zara Quinn", "observer")).toBe(
      "/avatars/personas/observer.png",
    );
  });

  it("keeps custom uploaded avatars ahead of persona keys", () => {
    expect(resolveAgentAvatarUrl("https://example.test/zara.png", "observer", "Zara Quinn", "strategic")).toBe(
      "https://example.test/zara.png",
    );
  });

  it("resolves API-relative uploaded avatars against the configured API base", () => {
    setApiBase("http://127.0.0.1:3000");

    expect(
      resolveAgentAvatarUrl(
        "/api/uploads/local?key=pfp%2Fuser-1%2Favatar.png",
        "observer",
        "Zara Quinn",
        "strategic",
      ),
    ).toBe("http://127.0.0.1:3000/api/uploads/local?key=pfp%2Fuser-1%2Favatar.png");
  });

  it("removes expiring S3 signature params from uploaded avatar URLs", () => {
    expect(
      resolveAgentAvatarUrl(
        "https://bucket.example.test/pfp/user-1/avatar.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=abc123",
        "observer",
        "Zara Quinn",
        "strategic",
      ),
    ).toBe("https://bucket.example.test/pfp/user-1/avatar.png");
  });

  it("converts path-style S3 signed upload URLs to stable bucket public URLs", () => {
    expect(
      resolveAgentAvatarUrl(
        "https://us-iad-1.linodeobjects.com/influence-pfp/pfp/user-1/avatar.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=abc123",
        "observer",
        "Zara Quinn",
        "strategic",
      ),
    ).toBe("https://influence-pfp.us-iad-1.linodeobjects.com/pfp/user-1/avatar.png");
  });

  it("renders portraits without an archetype badge overlay", () => {
    const html = renderToString(
      createElement(AgentAvatar, {
        persona: "Zara is exuberant and unpredictable.",
        personaKey: "observer",
        name: "Zara Quinn",
      }),
    );

    expect(html).not.toContain('title="Observer archetype"');
    expect(html).not.toContain("Zara is exuberant and unpredictable.");
  });

  it("renders one passive portrait trigger with a tooltip relationship", () => {
    const html = renderToString(
      createElement(AgentAvatarPreview, {
        avatarUrl: null,
        personaKey: "strategic",
        name: "Nova",
        gamesPlayed: 5,
        gamesWon: 2,
      }),
    );

    expect(html).toContain('aria-label="View Nova portrait and stats"');
    expect(html).toContain("aria-describedby=");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain("<a");
  });

  it("renders public preview content with role and positive game stats", () => {
    const html = renderToString(
      createElement(AgentAvatarPreviewContent, {
        avatarUrl: null,
        personaKey: "strategic",
        name: "Nova",
        gamesPlayed: 5,
        gamesWon: 2,
      }),
    );

    expect(html).toContain("Strategist");
    expect(html).toContain(">games</dt>");
    expect(html).toContain(">5</dd>");
    expect(html).toContain(">wins</dt>");
    expect(html).toContain(">2</dd>");
    expect(html).toContain(">win rate</dt>");
    expect(html).toContain(">40%</dd>");
    expect(html.toLowerCase()).not.toContain("rating");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a");
  });

  it("renders distinct zero-game and unavailable current-stat states", () => {
    const zeroGameHtml = renderToString(
      createElement(AgentAvatarPreviewContent, {
        avatarUrl: null,
        personaKey: "observer",
        name: "Echo",
        gamesPlayed: 0,
        gamesWon: 0,
      }),
    );
    const unavailableHtml = renderToString(
      createElement(AgentAvatarPreviewContent, {
        avatarUrl: null,
        personaKey: "observer",
        name: "Echo",
        gamesPlayed: null,
        gamesWon: null,
      }),
    );

    expect(zeroGameHtml).toContain("No games yet");
    expect(zeroGameHtml).not.toContain("win rate");
    expect(unavailableHtml).toContain("Current stats unavailable");
    expect(unavailableHtml).not.toContain("win rate");
  });

  it("keeps the smallest and largest portrait sizes available to previews", () => {
    for (const size of ["6", "32"] as const) {
      const html = renderToString(
        createElement(AgentAvatarPreview, {
          avatarUrl: null,
          personaKey: "strategic",
          name: "Nova",
          gamesPlayed: 0,
          gamesWon: 0,
          size,
        }),
      );

      expect(html).toContain(`aria-label="View Nova portrait and stats"`);
    }
  });

  it("keeps private and admin-only fields out of the public preview type", () => {
    type PrivatePreviewKey = Extract<
      keyof PublicAgentAvatarPreview,
      "backstory" | "strategy" | "reasoning" | "provider" | "revision" | "rating"
    >;
    const hasNoPrivatePreviewKeys: PrivatePreviewKey extends never ? true : false = true;

    expect(hasNoPrivatePreviewKeys).toBe(true);
  });

  it("accepts permissioned richer content outside the public preview data contract", () => {
    const html = renderToString(
      createElement(AgentAvatarPreview, {
        avatarUrl: null,
        personaKey: "observer",
        name: "Echo",
        gamesPlayed: 3,
        gamesWon: 1,
        previewContent: createElement("div", null, "Authorized admin details"),
      }),
    );

    expect(html).toContain('aria-label="View Echo portrait and stats"');
  });

  it("uses useful role labels instead of House personality names", () => {
    expect(PERSONAS.find((persona) => persona.key === "strategic")?.name).toBe("Strategist");
    expect(PERSONAS.find((persona) => persona.key === "paranoid")?.name).toBe("Watchful");
    expect(PERSONAS.map((persona) => persona.name)).not.toContain("Atlas");
    expect(PERSONAS.map((persona) => persona.name)).not.toContain("Lyra");
  });

  it("has a generated PNG asset for every exposed persona key", () => {
    for (const persona of PERSONAS) {
      expect(
        existsSync(join(import.meta.dir, "../../public/avatars/personas", `${persona.key}.png`)),
      ).toBe(true);
    }
  });
});
