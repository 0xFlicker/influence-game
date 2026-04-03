"use client";

import type { GameDetail, GamePlayer, PhaseKey } from "@/lib/api";
import { AgentAvatar } from "@/components/agent-avatar";
import { PHASE_LABELS } from "./constants";

export function ConnectionBadge({ status }: { status: "connecting" | "live" | "disconnected" | "reconnecting" | "replay" }) {
  const configs = {
    connecting: { dot: "bg-yellow-400 animate-pulse", text: "Connecting…", cls: "text-yellow-400" },
    live: { dot: "bg-green-400 animate-pulse", text: "Live", cls: "text-green-400" },
    disconnected: { dot: "bg-red-400", text: "Disconnected", cls: "text-red-400" },
    reconnecting: { dot: "bg-orange-400 animate-pulse", text: "Reconnecting…", cls: "text-orange-400" },
    replay: { dot: "bg-indigo-400", text: "Replay", cls: "text-indigo-400" },
  };
  const cfg = configs[status];
  return (
    <span className={`flex items-center gap-1.5 text-xs font-medium ${cfg.cls}`}>
      <span className={`inline-block w-2 h-2 rounded-full ${cfg.dot}`} />
      {cfg.text}
    </span>
  );
}

export function PhaseHeader({ game, isReplay }: { game: GameDetail; isReplay: boolean }) {
  const alive = game.players.filter((p) => p.status === "alive").length;
  const total = game.players.length;
  const roundPct = Math.round((game.currentRound / game.maxRounds) * 100);

  return (
    <div className="influence-glass rounded-panel p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <span className="text-sm font-semibold uppercase tracking-wider text-phase">
            {PHASE_LABELS[game.currentPhase] ?? game.currentPhase}
          </span>
          <div className="text-text-secondary text-xs mt-0.5">
            Round {game.currentRound} / {game.maxRounds}
            {!isReplay && game.status === "in_progress" && (
              <span className="ml-3">{alive} alive · {total - alive} out</span>
            )}
            {game.status === "completed" && game.winner && !isReplay && (
              <span className="ml-3 text-green-400">{game.winner} wins</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="h-1.5 bg-white/10 rounded-full w-32 overflow-hidden">
            <div
              className="h-full bg-phase rounded-full transition-all duration-500"
              style={{ width: `${roundPct}%` }}
            />
          </div>
          <span className="text-text-muted text-xs mt-1 inline-block">{roundPct}% complete</span>
        </div>
      </div>
    </div>
  );
}

/**
 * GameStateHUD — compact corner overlay showing game state at a glance.
 * Like a sports broadcast "score bug": always visible, compact, informative.
 */
export function GameStateHUD({
  players,
  currentRound,
  maxRounds,
  phase,
  empoweredPlayerId,
}: {
  players: GamePlayer[];
  currentRound: number;
  maxRounds: number;
  phase: PhaseKey;
  empoweredPlayerId: string | null;
}) {
  const alive = players.filter((p) => p.status === "alive");
  const eliminated = players.filter((p) => p.status === "eliminated");
  const shielded = alive.filter((p) => p.shielded);
  const empowered = empoweredPlayerId
    ? players.find((p) => p.id === empoweredPlayerId)
    : null;

  return (
    <div className="influence-glass rounded-panel p-3 text-xs space-y-2 min-w-[180px]">
      {/* Phase & Round */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wider text-phase truncate">
          {PHASE_LABELS[phase] ?? phase}
        </span>
        <span className="text-text-muted flex-shrink-0">
          R{currentRound}/{maxRounds}
        </span>
      </div>

      {/* Player counts */}
      <div className="flex items-center gap-3 text-text-secondary">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          {alive.length} alive
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400/50" />
          {eliminated.length} out
        </span>
      </div>

      {/* Status indicators */}
      {(shielded.length > 0 || empowered) && (
        <div className="border-t border-white/5 pt-2 space-y-1">
          {empowered && (
            <div className="flex items-center gap-1.5 text-amber-400/80">
              <span>👑</span>
              <span className="truncate">{empowered.name}</span>
            </div>
          )}
          {shielded.length > 0 && (
            <div className="flex items-center gap-1.5 text-blue-400/80">
              <span>🛡</span>
              <span className="truncate">{shielded.map((p) => p.name).join(", ")}</span>
            </div>
          )}
        </div>
      )}

      {/* Round progress dots */}
      <div className="flex gap-1 pt-1">
        {Array.from({ length: maxRounds }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i < currentRound ? "bg-phase/70" : "bg-white/10"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export function PlayerRoster({
  players,
  empoweredPlayerId,
  eliminatedRounds,
  recentlyUnshielded,
  speedrun,
}: {
  players: GamePlayer[];
  empoweredPlayerId: string | null;
  eliminatedRounds: ReadonlyMap<string, number>;
  recentlyUnshielded: ReadonlySet<string>;
  speedrun: boolean;
}) {
  const alive = players.filter((p) => p.status === "alive");
  const eliminated = players.filter((p) => p.status === "eliminated");

  return (
    <div className="influence-glass rounded-panel p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
        Players · {alive.length} alive
      </h3>
      <div className="space-y-1.5">
        {alive.map((p) => {
          const isEmpowered = p.id === empoweredPlayerId;
          const isShattered = !speedrun && recentlyUnshielded.has(p.id);

          return (
            <div
              key={p.id}
              className={`flex items-center gap-2 text-sm rounded-lg px-1 py-0.5 transition-all duration-300 ${
                isEmpowered
                  ? "border border-amber-500/40 bg-amber-950/20 shadow-[0_0_8px_rgba(245,158,11,0.15)]"
                  : ""
              }`}
            >
              <AgentAvatar avatarUrl={p.avatarUrl} persona={p.persona} name={p.name} size="8" />
              <span className={`font-medium ${isEmpowered ? "text-amber-200" : "text-white"}`}>
                {p.name}
              </span>
              <span className="text-white/30 text-xs flex-1 truncate">{p.persona}</span>
              {/* Crown badge — empowered player */}
              {isEmpowered && (
                <span className="text-amber-400 text-sm" title="Empowered">
                  👑
                </span>
              )}
              {/* Shield badge — protected player */}
              {p.shielded && (
                <span
                  className="text-blue-400 text-sm"
                  title="Protected this round"
                >
                  🛡
                </span>
              )}
              {/* Shield shatter — just expired (live mode only) */}
              {isShattered && (
                <span className="text-blue-300/70 text-sm animate-shield-shatter">🛡</span>
              )}
            </div>
          );
        })}
        {eliminated.length > 0 && (
          <>
            <div className="border-t border-white/5 my-2" />
            {eliminated.map((p) => {
              const elimRound = eliminatedRounds.get(p.id);
              return (
                <div key={p.id} className="flex items-center gap-2 text-sm">
                  <span className="text-base grayscale opacity-40">💀</span>
                  <span className="text-white/35 line-through">{p.name}</span>
                  {elimRound != null && (
                    <span className="text-white/20 text-xs ml-auto">R{elimRound}</span>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
