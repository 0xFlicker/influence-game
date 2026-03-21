"use client";

import type { TranscriptEntry, GamePlayer } from "@/lib/api";
import { AgentAvatar } from "@/components/agent-avatar";
import { Typewriter } from "@/components/typewriter";
import type { ReplayScene, SpectacleMessagePhase } from "./types";
import { HOUSE_INTROS, phaseToRoomType } from "./constants";

// ---------------------------------------------------------------------------
// buildReplayScenes — groups transcript into per-phase (and per-room) scenes
// ---------------------------------------------------------------------------

export function buildReplayScenes(transcript: TranscriptEntry[]): ReplayScene[] {
  const grouped = new Map<string, TranscriptEntry[]>();
  for (const msg of transcript) {
    const key = `R${msg.round}-${msg.phase}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(msg);
  }

  const scenes: ReplayScene[] = [];
  for (const [id, msgs] of grouped.entries()) {
    const { round, phase } = msgs[0]!;
    const roomType = phaseToRoomType(phase);

    if (phase === "WHISPER") {
      // Single scene with all whisper messages — rooms render simultaneously
      scenes.push({
        id,
        round,
        phase,
        roomType,
        messages: msgs,
        houseIntro: HOUSE_INTROS[phase] ?? null,
      });
    } else {
      scenes.push({
        id,
        round,
        phase,
        roomType,
        messages: msgs,
        houseIntro: HOUSE_INTROS[phase] ?? null,
      });
    }
  }

  return scenes;
}

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
  const player = message.fromPlayerId
    ? players.find((p) => p.id === message.fromPlayerId)
      ?? players.find((p) => p.name === message.fromPlayerId)
    : null;
  const playerName =
    message.fromPlayerName ?? player?.name ?? message.fromPlayerId ?? "The House";
  const isElimination = message.scope === "system" && (message.text.includes("ELIMINATED:") || message.text.includes("AUTO-ELIMINATE:"));

  return (
    <div className="flex-1 flex items-center justify-center  px-6 py-8">
      <div className="max-w-2xl w-full">
        {/* Typing indicator */}
        {phase === "typing" && !isSystem && (
          <div className="text-center animate-[fadeIn_0.3s_ease-out]">
            <div className="flex items-center justify-center gap-3 mb-8">
              {player && <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="10" />}
              <span className="text-lg font-semibold text-white/60">{playerName}</span>
              {message.scope === "whisper" && (
                <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">whisper</span>
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
                {player && <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="10" />}
                <span className="text-lg font-semibold text-white/70">{playerName}</span>
                {message.scope === "whisper" && (
                  <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">whisper</span>
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
