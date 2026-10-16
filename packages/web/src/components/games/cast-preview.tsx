"use client";

import { useState } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import type { EpisodeCast } from "@/lib/api";

/** Public original cast only; paging never depends on survivor or faction state. */
export function CastPreview({ cast, label = "Meet the cast" }: { cast: EpisodeCast[]; label?: string }) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(cast.length / 4);
  const current = pages ? page % pages : 0;
  if (!cast.length) return null;
  return <>
    <div className="episode-cast" role="group" aria-label={`Cast page ${current + 1} of ${pages}`}>
      {cast.slice(current * 4, current * 4 + 4).map(player => <div key={player.id}>
        <AgentAvatar name={player.name} persona={player.personaKey ?? ""} personaKey={player.personaKey} avatarUrl={player.avatarUrl} size="32" />
        <span>{player.name}</span>
      </div>)}
    </div>
    <span className="episode-frame-label">{label}</span>
    {pages > 1 && <div className="episode-cast-pagination" role="group" aria-label="Cast pagination">
      <button type="button" aria-label="Previous cast page" onClick={() => setPage((current + pages - 1) % pages)}>←</button>
      <span aria-live="polite">{current + 1} / {pages}</span>
      <button type="button" aria-label="Next cast page" onClick={() => setPage((current + 1) % pages)}>→</button>
    </div>}
  </>;
}
