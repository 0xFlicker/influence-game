"use client";

import { useEffect, useRef } from "react";
import type { TranscriptEntry, GamePlayer, PhaseKey } from "@/lib/api";
import { AgentAvatar } from "@/components/agent-avatar";

/**
 * Single message item in the reveal stage — House messages are centered and
 * styled dramatically; player messages use regular bubble styling.
 * All-caps runs (e.g., "ATLAS" or "VERA — 4 VOTES") get a highlight treatment.
 */
export function RevealMessageItem({
  msg,
  players,
}: {
  msg: TranscriptEntry;
  players: GamePlayer[];
}) {
  const isHouse = !msg.fromPlayerId || msg.scope === "system";

  if (isHouse) {
    // Detect all-caps player name announcement (e.g., "ATLAS — 3 VOTES")
    const isAnnouncement = /\b[A-Z]{3,}\b/.test(msg.text);
    return (
      <div className="text-center py-3 animate-[fadePure_0.4s_ease-out]">
        {isAnnouncement ? (
          <p className="text-xl md:text-2xl font-bold tracking-widest text-red-300">
            {msg.text}
          </p>
        ) : (
          <p className="text-sm md:text-base text-white/55 italic">{msg.text}</p>
        )}
      </div>
    );
  }

  const player = players.find((p) => p.id === msg.fromPlayerId)
    ?? players.find((p) => p.name === msg.fromPlayerId);
  const name = msg.fromPlayerName ?? player?.name ?? msg.fromPlayerId ?? "Unknown";
  return (
    <div className="flex gap-3 animate-[fadePure_0.4s_ease-out]">
      <div className="flex-shrink-0">
        {player ? <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="8" /> : <span className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-sm">?</span>}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white/70 mb-0.5">{name}</p>
        <p className="text-sm text-white/60 leading-relaxed break-words">{msg.text}</p>
      </div>
    </div>
  );
}

/**
 * RevealModeView — replaces the main stage during REVEAL/COUNCIL phases.
 * Messages are shown progressively as they're drained from the reveal queue.
 * While waiting for the next message, a pulsing ellipsis signals more is coming.
 */
export function RevealModeView({
  shown,
  pendingCount,
  players,
  phase,
}: {
  shown: TranscriptEntry[];
  pendingCount: number;
  players: GamePlayer[];
  phase: PhaseKey;
}) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [shown]);

  const color = phase === "REVEAL" ? "text-pink-400/60" : "text-red-400/60";
  const label = phase === "REVEAL" ? "REVEAL" : "COUNCIL VOTE";

  return (
    <div
      ref={feedRef}
      className="border border-pink-900/20 bg-pink-950/5 flex-1 overflow-y-auto p-6 space-y-4"
    >
      {shown.length === 0 && (
        <div className="text-center mt-16">
          <p className={`text-xs font-semibold uppercase tracking-[0.3em] mb-3 ${color}`}>
            ◆ {label} ◆
          </p>
          <p className="text-xs text-white/20 animate-pulse">The votes are in…</p>
        </div>
      )}

      {shown.map((msg) => (
        <RevealMessageItem key={msg.id} msg={msg} players={players} />
      ))}

      {pendingCount > 0 && (
        <div className="text-center py-2">
          <p className="text-xs text-white/20 animate-pulse tracking-widest">…</p>
        </div>
      )}
    </div>
  );
}
