import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  GamePlayerAvatarPreview,
  GamePlayerAvatarPreviewContent,
  getGamePlayerAvatarPreviewModel,
} from "../components/game-player-avatar-preview";
import type { GamePlayer } from "../lib/api";

function historicalPlayer(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id: "player-1",
    name: "Historical Atlas",
    persona: "Patient and observant.",
    personaKey: "observer",
    status: "alive",
    shielded: false,
    avatarUrl: "/avatars/historical-atlas.png",
    currentAgent: {
      name: "Atlas After Rename",
      avatarUrl: "/avatars/current-atlas.png",
      role: {
        key: "aggressive",
        label: "Aggressor",
      },
      competition: {
        gamesPlayed: 7,
        wins: 2,
        winRate: 2 / 7,
      },
    },
    ...overrides,
  };
}

describe("GamePlayerAvatarPreview", () => {
  it("keeps historical identity while using the current portrait and record", () => {
    expect(getGamePlayerAvatarPreviewModel(historicalPlayer())).toEqual({
      name: "Historical Atlas",
      persona: "Patient and observant.",
      personaKey: "observer",
      role: "Observer",
      avatarUrl: "/avatars/current-atlas.png",
      gamesPlayed: 7,
      gamesWon: 2,
      winRate: 2 / 7,
    });
  });

  it("falls back to historical portrait and persona with unavailable current stats", () => {
    expect(getGamePlayerAvatarPreviewModel(historicalPlayer({
      persona: "deceptive",
      personaKey: undefined,
      currentAgent: null,
    }))).toEqual({
      name: "Historical Atlas",
      persona: "deceptive",
      personaKey: "deceptive",
      role: "Deceiver",
      avatarUrl: "/avatars/historical-atlas.png",
      gamesPlayed: null,
      gamesWon: null,
      winRate: null,
    });
  });

  it("labels the current record and renders an extant zero-game record as zero", () => {
    const model = getGamePlayerAvatarPreviewModel(historicalPlayer({
      currentAgent: {
        name: "Atlas After Rename",
        avatarUrl: null,
        role: null,
        competition: {
          gamesPlayed: 0,
          wins: 0,
          winRate: 0,
        },
      },
    }));
    const html = renderToString(<GamePlayerAvatarPreviewContent model={model} />);

    expect(html).toContain("Current record");
    expect(html).toContain(">0<");
    expect(html).toContain("0%");
    expect(html).not.toContain("No games yet");
    expect(html).not.toContain("Atlas After Rename");
  });

  it("renders missing current-agent stats as unavailable, never as zero", () => {
    const model = getGamePlayerAvatarPreviewModel(historicalPlayer({
      currentAgent: null,
    }));
    const html = renderToString(<GamePlayerAvatarPreviewContent model={model} />);

    expect(html).toContain("Current record");
    expect(html).toContain("Current stats unavailable");
    expect(html).not.toContain(">0<");
  });

  it("uses the historical name for the preview trigger label", () => {
    const html = renderToString(
      <GamePlayerAvatarPreview player={historicalPlayer()} size="6" />,
    );

    expect(html).toContain('aria-label="View Historical Atlas portrait and stats"');
    expect(html).not.toContain('aria-label="View Atlas After Rename portrait and stats"');
    expect(html).toContain("min-h-11");
    expect(html).toContain("min-w-11");
  });
});
