import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DRAMATIC_ADVANCE_SUPPRESS_SELECTOR } from "../app/games/[slug]/components/dramatic-interaction";

const componentDirectory = join(
  import.meta.dir,
  "../app/games/[slug]/components",
);

const historicalPortraitFiles = [
  "chat-feeds.tsx",
  "message-bubble.tsx",
  "reveal-choreography.tsx",
  "spectacle-viewer.tsx",
  "game-info.tsx",
  "completed-results-agent-card.tsx",
  "vote-display.tsx",
  "dramatic-replay-viewer.tsx",
] as const;

function source(filename: string): string {
  return readFileSync(join(componentDirectory, filename), "utf8");
}

describe("historical agent portrait surfaces", () => {
  it("routes every passive game portrait through the historical-player preview adapter", () => {
    for (const filename of historicalPortraitFiles) {
      const contents = source(filename);

      expect(contents).toContain("GamePlayerAvatarPreview");
      expect(contents).not.toContain("@/components/agent-avatar");
      expect(contents).not.toContain("<AgentAvatar");
    }
  });

  it("maps House Highlights agents into historical players with current-agent records", () => {
    const cardSource = source("house-highlights-card.tsx");
    const modelSource = source("house-highlights-model.ts");

    expect(cardSource).toContain("GamePlayerAvatarPreview");
    expect(cardSource).not.toContain("resolveHighlightAvatarUrl");
    expect(modelSource).toContain("currentAgent: agent.currentAgent");
    expect(modelSource).toContain("name: agent.name");
    expect(modelSource).toContain("persona: agent.persona");
  });

  it("keeps replay portrait triggers from advancing click-to-continue playback", () => {
    const replaySource = source("dramatic-replay-viewer.tsx");

    expect(replaySource).toContain("shouldSuppressDramaticAdvance(e.target)");
    expect(replaySource).toContain("GamePlayerAvatarPreview");
    expect(DRAMATIC_ADVANCE_SUPPRESS_SELECTOR).toContain("button");
  });
});
