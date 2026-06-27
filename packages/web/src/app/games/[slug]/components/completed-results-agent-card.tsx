import type { GamePlayer } from "@/lib/api";
import { AgentAvatar } from "@/components/agent-avatar";
import type { CompletedResultsAgentCardModel } from "./completed-results-model";

export function CompletedResultsAgentCard({
  card,
  player,
}: {
  card: CompletedResultsAgentCardModel;
  player?: GamePlayer;
}) {
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start gap-3">
        <AgentAvatar
          avatarUrl={player?.avatarUrl}
          personaKey={player?.personaKey}
          persona={player?.persona ?? ""}
          name={card.player.name}
          size="10"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h4 className="truncate text-sm font-semibold text-white">{card.player.name}</h4>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">{card.placementLabel}</span>
          </div>
          <div className="mt-1 text-xs text-white/40">
            {card.votesCast} cast · {card.votesReceived} received
          </div>
        </div>
      </div>

      {card.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {card.tags.map((tag) => (
            <span key={tag} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/55">
              {tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
