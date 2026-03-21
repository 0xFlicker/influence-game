"use client";

import { useState, useEffect } from "react";
import type { TranscriptEntry, GamePlayer } from "@/lib/api";
import { AgentAvatar } from "@/components/agent-avatar";
import { Typewriter } from "@/components/typewriter";
import { formatTime } from "./constants";

export function MessageBubble({ msg, players }: { msg: TranscriptEntry; players: GamePlayer[] }) {
  const isSystem = msg.scope === "system";
  const isDiary = msg.scope === "diary";
  const isWhisper = msg.scope === "whisper";

  if (isSystem) {
    return (
      <div className="text-center py-1">
        <span className="text-xs text-white/30 bg-white/5 px-3 py-1 rounded-full">
          {msg.text}
        </span>
      </div>
    );
  }

  if (isDiary) {
    // Fallback for any unmatched diary entries
    const isDiaryQuestion = msg.fromPlayerId?.startsWith("House ->");
    if (isDiaryQuestion) {
      return (
        <div className="border border-purple-900/30 bg-purple-950/20 rounded-lg px-3 py-2 text-xs text-purple-300/60 italic">
          <span className="not-italic font-medium text-purple-400/70 mr-1">📔 House:</span>
          {msg.text}
        </div>
      );
    }
    const player = players.find((p) => p.name === msg.fromPlayerId);
    return (
      <div className="ml-4 border-l-2 border-purple-700/40 pl-3 py-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          {player && <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />}
          <span className="text-xs font-semibold text-white/60">{msg.fromPlayerId}</span>
        </div>
        <p className="text-xs text-white/55 italic">{msg.text}</p>
      </div>
    );
  }

  const isAnonymousRumor = msg.phase === "RUMOR" && msg.scope === "public";
  const player = isAnonymousRumor
    ? undefined
    : players.find((p) => p.id === msg.fromPlayerId)
      ?? players.find((p) => p.name === msg.fromPlayerId);
  const name = isAnonymousRumor ? "Anonymous" : (msg.fromPlayerName ?? player?.name ?? msg.fromPlayerId ?? "Unknown");
  const isEliminated = player?.status === "eliminated";

  return (
    <div className={`flex gap-3 ${isEliminated ? "opacity-50" : ""}`}>
      <div className="flex-shrink-0">
        {isAnonymousRumor ? (
          <span className="w-7 h-7 rounded-full bg-purple-900/40 flex items-center justify-center text-sm">🗣</span>
        ) : player ? (
          <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="8" />
        ) : (
          <span className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-sm">?</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className={`text-xs font-semibold ${isAnonymousRumor ? "text-purple-300/70 italic" : "text-white/80"}`}>{name}</span>
          {isAnonymousRumor && (
            <span className="text-[10px] text-purple-400/50 uppercase tracking-wider">rumor</span>
          )}
          {isWhisper && (
            <span className="text-xs text-purple-400/70">🤫 whisper</span>
          )}
          <span className="text-white/20 text-xs ml-auto flex-shrink-0">{formatTime(msg.timestamp)}</span>
        </div>
        <p className="text-sm text-white/70 leading-relaxed break-words">{msg.text}</p>
      </div>
    </div>
  );
}

/**
 * Renders the elimination last-words sequence with timed choreography:
 * 1. 3s hold (skull pulse)
 * 2. House intro typewriter: "[Name]… your last words." (50 c/s)
 * 3. 0.5s pause
 * 4. Player last words at slow typewriter (28 c/s)
 * 5. Final dimmed-card state
 *
 * In speedrun/replay mode: renders instantly with no holds or animation.
 */
export function LastWordsMessage({
  entry,
  players,
  speedrun,
  isReplay,
}: {
  entry: TranscriptEntry;
  players: GamePlayer[];
  speedrun: boolean;
  isReplay: boolean;
}) {
  type LWPhase = "hold" | "intro" | "pause" | "words" | "done";

  const [phase, setPhase] = useState<LWPhase>(() =>
    speedrun || isReplay ? "done" : "hold",
  );

  const player = players.find((p) => p.id === entry.fromPlayerId)
    ?? players.find((p) => p.name === entry.fromPlayerId);
  const playerName = entry.fromPlayerName ?? player?.name ?? entry.fromPlayerId ?? "Unknown";
  const introText = `${playerName}… your last words.`;

  useEffect(() => {
    if (speedrun || isReplay) return;

    if (phase === "hold") {
      const t = setTimeout(() => setPhase("intro"), 3000);
      return () => clearTimeout(t);
    }
    if (phase === "pause") {
      const t = setTimeout(() => setPhase("words"), 500);
      return () => clearTimeout(t);
    }
  }, [phase, speedrun, isReplay]);

  // Shared final render (done state + speedrun/replay)
  if (phase === "done" || speedrun || isReplay) {
    return (
      <div className="flex gap-3 opacity-60">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-red-900/30 flex items-center justify-center text-sm">
          💀
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-xs font-semibold text-red-300/60">{playerName}</span>
            <span className="text-xs text-red-400/40 italic">last words</span>
            <span className="text-white/20 text-xs ml-auto flex-shrink-0">
              {formatTime(entry.timestamp)}
            </span>
          </div>
          <p className="text-sm text-white/50 italic leading-relaxed break-words">
            {entry.text}
          </p>
        </div>
      </div>
    );
  }

  if (phase === "hold") {
    return (
      <div className="flex items-center gap-3 py-2 text-red-900/60">
        <span className="text-lg animate-pulse">💀</span>
        <span className="text-xs text-white/15 italic tracking-wider">…</span>
      </div>
    );
  }

  // intro + pause: show House prompt
  const showIntroTypewriter = phase === "intro";
  if (phase === "intro" || phase === "pause") {
    return (
      <div className="py-1 space-y-1">
        <p className="text-xs text-white/30 font-medium uppercase tracking-wider">◆ House</p>
        <p className="text-sm text-white/50 italic">
          {showIntroTypewriter ? (
            <Typewriter text={introText} rate="house" onComplete={() => setPhase("pause")} />
          ) : (
            introText
          )}
        </p>
      </div>
    );
  }

  // phase === "words"
  return (
    <div className="py-1 space-y-2">
      <p className="text-xs text-white/30 font-medium uppercase tracking-wider">◆ House</p>
      <p className="text-sm text-white/50 italic">{introText}</p>
      <div className="flex gap-3 ml-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-red-900/30 flex items-center justify-center text-sm">
          💀
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-xs font-semibold text-red-300/60">{playerName}</span>
            <span className="text-xs text-red-400/40 italic">last words</span>
          </div>
          <p className="text-sm text-white/50 italic leading-relaxed break-words">
            <Typewriter
              text={entry.text}
              rate="last-words"
              onComplete={() => setPhase("done")}
            />
          </p>
        </div>
      </div>
    </div>
  );
}
