"use client";

import type { TranscriptEntry, GamePlayer } from "@/lib/api";
import { GamePlayerAvatarPreview } from "@/components/game-player-avatar-preview";
import { Typewriter } from "@/components/typewriter";
import type { SpectacleMessagePhase } from "./types";

// ---------------------------------------------------------------------------
// SpectacleMessageSpotlight — single-message spotlight for live non-dedicated phases
// ---------------------------------------------------------------------------

export function SpectacleMessageSpotlight({
  message,
  phase,
  players,
  onRevealComplete,
  queueLength,
  speedrun = false,
}: {
  message: TranscriptEntry | null;
  phase: SpectacleMessagePhase;
  players: GamePlayer[];
  onRevealComplete: () => void;
  queueLength: number;
  speedrun?: boolean;
}) {
  if (!message) {
    return (
      <div className="flex-1 flex items-center justify-center ">
        <p className="text-white/15 text-sm animate-pulse">Waiting for the next move…</p>
      </div>
    );
  }

  const isSystem = !message.fromPlayerId || message.scope === "system";
  const isAnonymousRumor = message.phase === "RUMOR" && message.scope === "public";
  const player = isAnonymousRumor ? null : (message.fromPlayerId
    ? players.find((p) => p.id === message.fromPlayerId)
      ?? players.find((p) => p.name === message.fromPlayerId)
    : null);
  const playerName = isAnonymousRumor
    ? "Anonymous"
    : (message.fromPlayerName ?? player?.name ?? message.fromPlayerId ?? "The House");
  const isElimination = message.scope === "system" && (message.text.includes("ELIMINATED:") || message.text.includes("AUTO-ELIMINATE:"));

  return (
    <div className="flex-1 flex items-center justify-center  px-6 py-8">
      <div className="max-w-2xl w-full">
        {/* Typing indicator */}
        {phase === "typing" && !isSystem && (
          <div className="text-center animate-[fadeIn_0.3s_ease-out]">
            <div className="flex items-center justify-center gap-3 mb-8">
              {isAnonymousRumor ? (
                <span className="w-10 h-10 rounded-full bg-purple-900/40 flex items-center justify-center text-xl">🗣</span>
              ) : player ? (
                <GamePlayerAvatarPreview player={player} size="10" />
              ) : null}
              <span className={`text-lg font-semibold ${isAnonymousRumor ? "text-purple-300/70 italic" : "text-white/60"}`}>{playerName}</span>
              {isAnonymousRumor && (
                <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">rumor</span>
              )}
              {message.scope === "mingle" && (
                <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">mingle</span>
              )}
            </div>
            <div className="flex items-center justify-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-white/25 animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1.2s" }} />
              <span className="w-2.5 h-2.5 rounded-full bg-white/25 animate-bounce" style={{ animationDelay: "200ms", animationDuration: "1.2s" }} />
              <span className="w-2.5 h-2.5 rounded-full bg-white/25 animate-bounce" style={{ animationDelay: "400ms", animationDuration: "1.2s" }} />
            </div>
          </div>
        )}

        {/* Message reveal / done */}
        {(phase === "revealing" || phase === "done") && (
          <div className="text-center animate-[fadeIn_0.3s_ease-out]">
            {!isSystem && (
              <div className="flex items-center justify-center gap-3 mb-8">
                {isAnonymousRumor ? (
                  <span className="w-10 h-10 rounded-full bg-purple-900/40 flex items-center justify-center text-xl">🗣</span>
                ) : player ? (
                  <GamePlayerAvatarPreview player={player} size="10" />
                ) : null}
                <span className={`text-lg font-semibold ${isAnonymousRumor ? "text-purple-300/70 italic" : "text-white/70"}`}>{playerName}</span>
                {isAnonymousRumor && (
                  <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">rumor</span>
                )}
                {message.scope === "mingle" && (
                  <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">mingle</span>
                )}
              </div>
            )}

            {isElimination ? (
              <p className="text-2xl md:text-3xl font-bold text-red-400 tracking-wider">
                {phase === "revealing" ? (
                  <Typewriter text={message.text} rate="house" onComplete={onRevealComplete} speedrun={speedrun} />
                ) : message.text}
              </p>
            ) : isSystem ? (
              <p className="text-base md:text-lg text-white/40 italic leading-relaxed">
                {phase === "revealing" ? (
                  <Typewriter text={message.text} rate="house" onComplete={onRevealComplete} speedrun={speedrun} />
                ) : message.text}
              </p>
            ) : (
              <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl px-8 py-6 inline-block max-w-xl text-left">
                <p className="text-lg md:text-xl leading-relaxed text-white/80">
                  {phase === "revealing" ? (
                    <Typewriter text={message.text} rate="spectacle" onComplete={onRevealComplete} speedrun={speedrun} />
                  ) : message.text}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Queue indicator */}
        {queueLength > 0 && phase === "done" && (
          <p className="text-center text-xs text-white/10 mt-6 animate-pulse">
            {queueLength} more…
          </p>
        )}
      </div>
    </div>
  );
}
