"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getGame, getGameTranscript, type GameDetail, type GamePlayer, type TranscriptEntry, type WsGameEvent, type PhaseKey } from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PHASE_LABELS: Record<PhaseKey, string> = {
  INIT: "Waiting Room",
  INTRODUCTION: "Introductions",
  LOBBY: "Public Lobby",
  WHISPER: "Whisper Phase",
  RUMOR: "Rumor Phase",
  VOTE: "Voting",
  POWER: "Power Play",
  REVEAL: "Reveal",
  COUNCIL: "Council",
  DIARY_ROOM: "Diary Room",
  PLEA: "Plea",
  ACCUSATION: "Accusation",
  DEFENSE: "Defense",
  OPENING_STATEMENTS: "Opening Statements",
  JURY_QUESTIONS: "Jury Questions",
  CLOSING_ARGUMENTS: "Closing Arguments",
  JURY_VOTE: "Jury Vote",
  END: "Game Over",
};

const PHASE_COLORS: Partial<Record<PhaseKey, string>> = {
  LOBBY: "text-blue-400",
  WHISPER: "text-purple-400",
  RUMOR: "text-yellow-400",
  VOTE: "text-orange-400",
  POWER: "text-red-400",
  REVEAL: "text-pink-400",
  COUNCIL: "text-red-500",
  JURY_VOTE: "text-amber-400",
  END: "text-green-400",
};

function phaseColor(phase: PhaseKey): string {
  return PHASE_COLORS[phase] ?? "text-white/60";
}

function personaEmoji(persona: string): string {
  const map: Record<string, string> = {
    honest: "🕊",
    strategic: "♟",
    deceptive: "🎭",
    paranoid: "👁",
    social: "🤝",
    aggressive: "⚔",
    loyalist: "🛡",
    observer: "🔍",
    diplomat: "🌿",
    wildcard: "🃏",
  };
  return map[persona] ?? "●";
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConnectionBadge({ status }: { status: "connecting" | "live" | "disconnected" | "replay" }) {
  const configs = {
    connecting: { dot: "bg-yellow-400 animate-pulse", text: "Connecting…", cls: "text-yellow-400" },
    live: { dot: "bg-green-400 animate-pulse", text: "Live", cls: "text-green-400" },
    disconnected: { dot: "bg-red-400", text: "Disconnected", cls: "text-red-400" },
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

function PhaseHeader({ game, isReplay }: { game: GameDetail; isReplay: boolean }) {
  const alive = game.players.filter((p) => p.status === "alive").length;
  const total = game.players.length;
  const roundPct = Math.round((game.currentRound / game.maxRounds) * 100);

  return (
    <div className="border border-white/10 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <span className={`text-sm font-semibold uppercase tracking-wider ${phaseColor(game.currentPhase)}`}>
            {PHASE_LABELS[game.currentPhase] ?? game.currentPhase}
          </span>
          <div className="text-white/40 text-xs mt-0.5">
            Round {game.currentRound} / {game.maxRounds}
            {!isReplay && game.status === "in_progress" && (
              <span className="ml-3">🟢 {alive} alive · ☠ {total - alive} out</span>
            )}
            {game.status === "completed" && game.winner && (
              <span className="ml-3 text-green-400">🏆 {game.winner} wins</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="h-1.5 bg-white/10 rounded-full w-32 overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${roundPct}%` }}
            />
          </div>
          <span className="text-white/25 text-xs mt-1 inline-block">{roundPct}% complete</span>
        </div>
      </div>
    </div>
  );
}

function PlayerRoster({ players }: { players: GamePlayer[] }) {
  const alive = players.filter((p) => p.status === "alive");
  const eliminated = players.filter((p) => p.status === "eliminated");

  return (
    <div className="border border-white/10 rounded-xl p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-white/30 mb-3">
        Players · {alive.length} alive
      </h3>
      <div className="space-y-1.5">
        {alive.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-sm">
            <span className="text-base">{personaEmoji(p.persona)}</span>
            <span className="text-white font-medium">{p.name}</span>
            <span className="text-white/30 text-xs">{p.persona}</span>
            {p.shielded && (
              <span className="text-xs bg-blue-900/40 text-blue-400 border border-blue-900/60 px-1.5 py-0.5 rounded-full ml-auto">
                Shielded
              </span>
            )}
          </div>
        ))}
        {eliminated.length > 0 && (
          <>
            <div className="border-t border-white/5 my-2" />
            {eliminated.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-sm opacity-35">
                <span className="text-base grayscale">{personaEmoji(p.persona)}</span>
                <span className="text-white/50 line-through">{p.name}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ msg, players }: { msg: TranscriptEntry; players: GamePlayer[] }) {
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
    return (
      <div className="border border-purple-900/30 bg-purple-950/20 rounded-lg px-3 py-2 text-xs text-purple-300/70 italic">
        <span className="not-italic font-medium text-purple-400/80 mr-1">[Diary]</span>
        {msg.text}
      </div>
    );
  }

  const player = players.find((p) => p.id === msg.fromPlayerId);
  const name = msg.fromPlayerName ?? player?.name ?? "Unknown";
  const isEliminated = player?.status === "eliminated";

  return (
    <div className={`flex gap-3 ${isEliminated ? "opacity-50" : ""}`}>
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-sm">
        {player ? personaEmoji(player.persona) : "?"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-xs font-semibold text-white/80">{name}</span>
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

function ReplayControls({
  current,
  total,
  onPrev,
  onNext,
  onFirst,
  onLast,
}: {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLast: () => void;
}) {
  const btnCls =
    "text-xs border border-white/10 hover:border-white/25 text-white/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed";
  return (
    <div className="flex items-center gap-2 justify-center py-3 border-t border-white/10">
      <button onClick={onFirst} disabled={current === 0} className={btnCls}>
        ⏮
      </button>
      <button onClick={onPrev} disabled={current === 0} className={btnCls}>
        ←
      </button>
      <span className="text-xs text-white/30 px-2">
        {current + 1} / {total}
      </span>
      <button onClick={onNext} disabled={current >= total - 1} className={btnCls}>
        →
      </button>
      <button onClick={onLast} disabled={current >= total - 1} className={btnCls}>
        ⏭
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WebSocket hook
// ---------------------------------------------------------------------------

const WS_BASE =
  (typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_WS_URL
    : undefined) ?? "ws://localhost:3000";

type ConnStatus = "connecting" | "live" | "disconnected";

function useGameWebSocket(
  gameId: string,
  enabled: boolean,
  onEvent: (ev: WsGameEvent) => void,
): ConnStatus {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    const ws = new WebSocket(`${WS_BASE}/api/games/${gameId}/watch`);
    wsRef.current = ws;

    ws.onopen = () => setStatus("live");
    ws.onclose = () => setStatus("disconnected");
    ws.onerror = () => setStatus("disconnected");

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as WsGameEvent;
        onEventRef.current(data);
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      ws.close();
    };
  }, [gameId, enabled]);

  return status;
}

// ---------------------------------------------------------------------------
// Main game viewer component
// ---------------------------------------------------------------------------

interface GameViewerProps {
  gameId: string;
  /**
   * If provided, renders in replay mode using the supplied data rather than
   * fetching client-side. Used for finished games loaded server-side.
   */
  initialGame?: GameDetail;
  initialMessages?: TranscriptEntry[];
}

export function GameViewer({ gameId, initialGame, initialMessages }: GameViewerProps) {
  const [game, setGame] = useState<GameDetail | null>(initialGame ?? null);
  const [messages, setMessages] = useState<TranscriptEntry[]>(initialMessages ?? []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replayIndex, setReplayIndex] = useState<number>(0);

  // Fetch game data client-side if not provided via props
  useEffect(() => {
    if (initialGame) {
      // Already have game data; set replay index to end
      setReplayIndex((initialMessages?.length ?? 1) - 1);
      return;
    }

    async function load() {
      try {
        const gameData = await getGame(gameId);
        setGame(gameData);
        if (gameData.status === "completed" || gameData.status === "cancelled") {
          const transcript = await getGameTranscript(gameId);
          setMessages(transcript);
          setReplayIndex(transcript.length > 0 ? transcript.length - 1 : 0);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load game.");
      }
    }

    load();
  }, [gameId, initialGame, initialMessages]);

  const feedRef = useRef<HTMLDivElement>(null);

  const isReplay = !!game && game.status !== "in_progress" && game.status !== "waiting";

  // Auto-scroll for live view
  useEffect(() => {
    if (!isReplay && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, isReplay]);

  const handleWsEvent = useCallback((ev: WsGameEvent) => {
    switch (ev.type) {
      case "game_state":
        setGame(ev.game);
        setMessages(ev.messages);
        break;
      case "phase_change":
        setGame((g) => g ? { ...g, currentPhase: ev.phase, currentRound: ev.round } : g);
        break;
      case "message":
        setMessages((m) => [...m, ev.message]);
        break;
      case "player_eliminated":
        setGame((g) =>
          g
            ? {
                ...g,
                players: g.players.map((p) =>
                  p.id === ev.playerId ? { ...p, status: "eliminated" as const } : p,
                ),
              }
            : g,
        );
        break;
      case "game_over":
        setGame((g) =>
          g ? { ...g, status: "completed", currentPhase: "END", winner: ev.winnerName } : g,
        );
        break;
    }
  }, []);

  const wsStatus = useGameWebSocket(gameId, !!game && !isReplay, handleWsEvent);

  const connStatus = isReplay
    ? "replay"
    : wsStatus === "live"
      ? "live"
      : wsStatus;

  // Loading / error states
  if (loadError) {
    return (
      <div className="border border-red-900/30 rounded-xl p-12 text-center text-red-400/70 text-sm">
        {loadError}
      </div>
    );
  }

  if (!game) {
    return (
      <div className="border border-white/10 rounded-xl p-12 text-center text-white/20 text-sm">
        Loading game…
      </div>
    );
  }

  // Replay: visible messages up to replayIndex
  const visibleMessages = isReplay ? messages.slice(0, replayIndex + 1) : messages;

  // Replay state: reconstruct current phase/round from visible messages
  const replayGame: GameDetail = isReplay
    ? {
        ...game,
        currentPhase: (visibleMessages.findLast((m) => m.phase)?.phase ?? game.currentPhase) as PhaseKey,
        currentRound: visibleMessages.findLast((m) => m.round)?.round ?? 1,
      }
    : game;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4">
      {/* Left: main feed */}
      <div className="flex flex-col min-h-0">
        {/* Phase header */}
        <PhaseHeader game={replayGame} isReplay={isReplay} />

        {/* Connection badge */}
        <div className="flex items-center justify-between mb-2 px-1">
          <ConnectionBadge status={connStatus} />
          {!isReplay && (
            <span className="text-xs text-white/20">
              {messages.length} message{messages.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Message feed */}
        <div
          ref={feedRef}
          className="border border-white/10 rounded-xl flex-1 overflow-y-auto p-4 space-y-3 min-h-[420px] max-h-[600px]"
        >
          {visibleMessages.length === 0 ? (
            <p className="text-center text-white/20 text-sm mt-16">
              {isReplay ? "No messages in replay." : "Waiting for game to begin…"}
            </p>
          ) : (
            visibleMessages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} players={game.players} />
            ))
          )}
        </div>

        {/* Replay controls */}
        {isReplay && messages.length > 0 && (
          <ReplayControls
            current={replayIndex}
            total={messages.length}
            onFirst={() => setReplayIndex(0)}
            onLast={() => setReplayIndex(messages.length - 1)}
            onPrev={() => setReplayIndex((i) => Math.max(0, i - 1))}
            onNext={() => setReplayIndex((i) => Math.min(messages.length - 1, i + 1))}
          />
        )}
      </div>

      {/* Right: player roster */}
      <div>
        <PlayerRoster players={game.players} />
      </div>
    </div>
  );
}
