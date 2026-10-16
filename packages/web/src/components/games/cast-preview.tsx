import { AgentAvatar } from "@/components/agent-avatar";
import type { EpisodeCast } from "@/lib/api";

/** One public cast frame. The shared slideshow owns progression between groups. */
export function CastPreview({ cast }: { cast: EpisodeCast[] }) {
  return <div className="episode-cast" role="group" aria-label="Cast portraits">
    {cast.map(player => <div key={player.id}>
      <AgentAvatar name={player.name} persona={player.personaKey ?? ""} personaKey={player.personaKey} avatarUrl={player.avatarUrl} size="32" />
      <span>{player.name}</span>
    </div>)}
  </div>;
}
