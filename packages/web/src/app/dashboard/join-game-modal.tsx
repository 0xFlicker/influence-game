"use client";

import { AgentSelector } from "@/components/casting/agent-selector";
import { joinGame, type GameSummary } from "@/lib/api";
import { gameDisplayName } from "@/lib/game-identity";

export function JoinGameModal({ game, onClose, onSuccess }: {
  game: GameSummary;
  onClose: () => void;
  onSuccess: (gameId: string) => void;
}) {
  return <AgentSelector
    description={`Join ${gameDisplayName(game)} · ${game.playerCount}-player · ${game.modelLabel}`}
    createHref={`/agents/create?flow=join_game&gameId=${encodeURIComponent(game.id)}`}
    onClose={onClose} submitLabel="Join game" pendingLabel="Joining…"
    onSelect={async agent => {
      await joinGame(game.id, { agentProfileId: agent.id });
      onSuccess(game.id);
    }}
  />;
}
