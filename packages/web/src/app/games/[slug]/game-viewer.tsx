"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useLoginGate } from "@/app/providers";
import { useRouter } from "next/navigation";
import { getGame, getGameTranscript, getAuthToken, type GameDetail, type GamePlayer, type GameSummary, type TranscriptEntry, type WsGameEvent, type PhaseKey } from "@/lib/api";
import { usePermissions } from "@/hooks/use-permissions";
import { audioCue } from "@/lib/audio-cues";
import { JoinGameModal } from "@/app/dashboard/join-game-modal";

import type { EndgameScreenState, TransitionState, SpectacleMessagePhase, GameViewerProps } from "./components/types";
import {
  PHASE_FLAVORS,
  setPhaseAttr,
  setEndgameAttr,
  TYPING_HOLD_MS,
  POST_REVEAL_BASE_MS,
  POST_REVEAL_PER_CHAR_MS,
  PACED_PHASES,
  PHASE_END_PAUSE_MS,
} from "./components/constants";
import { wsEntryToTranscriptEntry } from "./components/message-parsing";
import { useGameWebSocket } from "./components/use-game-websocket";
import { ReplayControls } from "./components/replay-controls";
import { MessageBubble } from "./components/message-bubble";
import { PhaseTransitionOverlay } from "./components/phase-transition";
import { EndgameEntryScreen } from "./components/endgame-entry";
import { ConnectionBadge, PhaseHeader, GameStateHUD, PlayerRoster } from "./components/game-info";
import { GroupChatFeed, JuryDMView } from "./components/chat-feeds";
import { WhisperPhaseView } from "./components/whisper-phase";
import { DiaryRoomPanel, DiaryRoomGridView, groupMessages } from "./components/diary-room";
import { RevealModeView } from "./components/reveal-choreography";
import { SpectacleMessageSpotlight } from "./components/spectacle-viewer";
import { DramaticReplayViewer } from "./components/dramatic-replay-viewer";

export function GameViewer({ gameId, initialGame, initialMessages, mode }: GameViewerProps) {
  const { authenticated } = usePrivy();
  const { gatedLogin } = useLoginGate();
  const { isAdmin, loading: permLoading } = usePermissions();
  const router = useRouter();
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [joinedSuccess, setJoinedSuccess] = useState(false);
  const [replayChoice, setReplayChoice] = useState<"replay" | "results" | null>(null);
  const [game, setGame] = useState<GameDetail | null>(initialGame ?? null);
  const [messages, setMessages] = useState<TranscriptEntry[]>(initialMessages ?? []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replayIndex, setReplayIndex] = useState<number>(0);
  const [activeTransition, setActiveTransition] = useState<TransitionState | null>(null);
  const [transitionHoldMs, setTransitionHoldMs] = useState(2000);
  // Negative IDs for live WS messages (avoids collision with positive DB ids)
  const msgIdRef = useRef(-1);
  // maxRounds ref so handleWsEvent can access it without being a dep
  const maxRoundsRef = useRef<number>(initialGame?.maxRounds ?? 9);
  // Track players whose next public message is their elimination last words.
  // Map: playerId → true (present = awaiting last words)
  const awaitingLastWordsRef = useRef<Set<string>>(new Set());
  // Set of message IDs that should render as last-words choreography
  const [lastWordsIds, setLastWordsIds] = useState<ReadonlySet<number>>(new Set());
  // Endgame entry screens
  const [activeEndgame, setActiveEndgame] = useState<EndgameScreenState | null>(null);
  const prevAliveCountRef = useRef<number | null>(null);
  // Reveal choreography queue (REVEAL + COUNCIL phases, live mode only)
  const [revealQueue, setRevealQueue] = useState<TranscriptEntry[]>([]);
  const [revealShown, setRevealShown] = useState<TranscriptEntry[]>([]);
  // Track phase in a ref so handleWsEvent (useCallback) can access it without stale closure
  const currentPhaseRef = useRef<PhaseKey>("INIT");
  // Speedrun flag — derive early so useEffects can use it as dependency
  const isSpeedrun = game?.viewerMode === "speedrun";
  // Diary Room tab state (desktop toggle)
  const [activeTab, setActiveTab] = useState<"stage" | "diary">("stage");
  const [newDiaryCount, setNewDiaryCount] = useState(0);
  const activeTabRef = useRef<"stage" | "diary">("stage");
  activeTabRef.current = activeTab;
  // Mobile 4-tab state
  type MobileTab = "chat" | "players" | "diary" | "votes";
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");
  const [newChatCount, setNewChatCount] = useState(0);
  const [newEliminationsCount, setNewEliminationsCount] = useState(0);
  const mobileTabRef = useRef<MobileTab>("chat");
  mobileTabRef.current = mobileTab;
  // Auth state (for diary room gate)
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    typeof window !== "undefined" ? !!getAuthToken() : false,
  );
  // Player card badges
  // empoweredPlayerId is set by the reveal choreography (INF-76) — null until then
  const [empoweredPlayerId] = useState<string | null>(null);
  const [eliminatedRounds, setEliminatedRounds] = useState<ReadonlyMap<string, number>>(new Map());
  const eliminatedRoundsRef = useRef<Map<string, number>>(new Map());
  const [recentlyUnshielded, setRecentlyUnshielded] = useState<ReadonlySet<string>>(new Set());
  // Track previous shield states to detect expiry
  const prevShieldedRef = useRef<Map<string, boolean>>(new Map());
  // Spectacle mode — queue-based single-message display for live non-whisper, non-reveal phases
  const [spectacleQueue, setSpectacleQueue] = useState<TranscriptEntry[]>([]);
  const [spectacleCurrent, setSpectacleCurrent] = useState<TranscriptEntry | null>(null);
  const [spectaclePhase, setSpectaclePhase] = useState<SpectacleMessagePhase>("done");

  // Set data-phase on root for cinematic CSS cascade (live mode)
  useEffect(() => {
    if (game?.currentPhase) {
      setPhaseAttr(game.currentPhase);
      setEndgameAttr(game.currentPhase);
    }
    return () => {
      if (typeof document !== "undefined") {
        document.documentElement.removeAttribute("data-phase");
        document.documentElement.removeAttribute("data-endgame");
      }
    };
  }, [game?.currentPhase]);

  // Fetch game data client-side if not provided via props
  useEffect(() => {
    if (initialGame) {
      // Already have game data; set replay index to end
      setReplayIndex((initialMessages?.length ?? 1) - 1);
      return;
    }

    if (!gameId) return;

    async function load() {
      try {
        const gameData = await getGame(gameId);
        setGame(gameData);
        maxRoundsRef.current = gameData.maxRounds;
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

  // Auto-scroll: live view on new messages, replay on index change
  useEffect(() => {
    if (!isReplay && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, isReplay]);

  useEffect(() => {
    if (isReplay && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [replayIndex, isReplay]);

  // Drain reveal queue — release one message every 1.5s (or instantly in speedrun)
  // Pauses while phase transition overlay is active (INF-84).
  useEffect(() => {
    if (revealQueue.length === 0 || isReplay || activeTransition) return;

    if (isSpeedrun) {
      setRevealShown((s) => [...s, ...revealQueue]);
      setRevealQueue([]);
      return;
    }

    const HOLD_MS = 1500;
    const timer = setTimeout(() => {
      setRevealQueue((q) => {
        if (q.length === 0) return q;
        const [next, ...rest] = q;
        setRevealShown((s) => [...s, next]);
        // Audio cues for specific reveal events
        if (next.fromPlayerId === null || next.scope === "system") {
          const text = next.text.toUpperCase();
          if (text.includes("POWER") && text.includes("TOKEN")) {
            audioCue.sting("empower_reveal");
          } else if (text.includes("COUNCIL") && text.includes("NOMINATE")) {
            audioCue.sting("council_nominees");
          } else if (text.includes("ELIMINATE") && text.includes("DIRECTLY")) {
            audioCue.sting("auto_elimination");
          } else if (text.includes("TIE")) {
            audioCue.sting("tiebreak");
          }
        }
        return rest;
      });
    }, HOLD_MS);

    return () => clearTimeout(timer);
  }, [revealQueue, isReplay, isSpeedrun, activeTransition]);

  // Spectacle queue drain — take next message when current finishes
  // Pauses while phase transition overlay is active (INF-84).
  useEffect(() => {
    if (isReplay || spectacleCurrent || spectacleQueue.length === 0 || activeTransition) return;
    setSpectacleQueue((q) => {
      if (q.length === 0) return q;
      const [next, ...rest] = q;
      setSpectacleCurrent(next);
      setSpectaclePhase("typing");
      return rest;
    });
  }, [spectacleQueue, spectacleCurrent, isReplay, activeTransition]);

  // Spectacle animation state machine
  // Pauses while phase transition overlay is active (INF-84).
  useEffect(() => {
    if (!spectacleCurrent || isReplay || activeTransition) return;
    const isSystem = !spectacleCurrent.fromPlayerId || spectacleCurrent.scope === "system";

    if (spectaclePhase === "typing") {
      if (isSystem || isSpeedrun) {
        setSpectaclePhase("revealing");
        return;
      }
      const timer = setTimeout(() => setSpectaclePhase("revealing"), TYPING_HOLD_MS);
      return () => clearTimeout(timer);
    }

    if (spectaclePhase === "done") {
      const holdMs = isSpeedrun
        ? 100
        : Math.max(POST_REVEAL_BASE_MS, spectacleCurrent.text.length * POST_REVEAL_PER_CHAR_MS);
      const timer = setTimeout(() => {
        setSpectacleCurrent(null);
      }, holdMs);
      return () => clearTimeout(timer);
    }
    // "revealing" transitions via Typewriter onComplete
  }, [spectacleCurrent, spectaclePhase, isReplay, isSpeedrun, activeTransition]);

  // Auth session events from Privy / login flow
  useEffect(() => {
    const onReady = () => setIsAuthenticated(true);
    const onExpired = () => setIsAuthenticated(false);
    window.addEventListener("auth:session-ready", onReady);
    window.addEventListener("auth:expired", onExpired);
    return () => {
      window.removeEventListener("auth:session-ready", onReady);
      window.removeEventListener("auth:expired", onExpired);
    };
  }, []);

  // Trigger endgame entry screens when alive count crosses a threshold
  useEffect(() => {
    if (!game || isReplay) return;
    const aliveCount = game.players.filter((p) => p.status === "alive").length;
    const prev = prevAliveCountRef.current;
    if (prev !== null && prev > aliveCount && (aliveCount === 4 || aliveCount === 3 || aliveCount === 2)) {
      // Compute active jury pool (odd-sized, last N eliminated)
      const totalPlayers = game.players.length;
      const maxJurors = totalPlayers <= 6 ? 3 : totalPlayers <= 9 ? 5 : 7;
      const allEliminated = game.players
        .filter((p) => p.status === "eliminated")
        .map((p) => p.name);
      const jurors = allEliminated.slice(-maxJurors);
      const alive = game.players.filter((p) => p.status === "alive");
      // Audio sting for endgame entry
      if (aliveCount === 4) audioCue.sting("endgame_reckoning");
      setActiveEndgame({
        stage: aliveCount === 4 ? "reckoning" : aliveCount === 3 ? "tribunal" : "judgment",
        finalists:
          aliveCount === 2
            ? [alive[0]?.name ?? "?", alive[1]?.name ?? "?"]
            : undefined,
        jurors,
      });
    }
    prevAliveCountRef.current = aliveCount;
  }, [game, isReplay]);

  const handleWsEvent = useCallback((ev: WsGameEvent) => {
    switch (ev.type) {
      case "game_state": {
        const { snapshot } = ev;
        // Derive current phase from last transcript entry (snapshot lacks explicit phase field)
        const lastEntry = snapshot.transcript.at(-1);
        const snapshotPhase = (lastEntry?.phase ?? "INIT") as PhaseKey;

        // Build a complete player registry from all sources (alive + eliminated)
        setGame((g) => {
          if (!g) return g;

          const playerMap = new Map<string, GamePlayer>();

          // Seed with existing players (preserves persona info from getGame())
          for (const p of g.players) {
            playerMap.set(p.id, p);
          }

          // Update/add alive players from snapshot
          for (const ap of snapshot.alivePlayers) {
            const existing = playerMap.get(ap.id);
            playerMap.set(ap.id, {
              id: ap.id,
              name: ap.name,
              persona: existing?.persona ?? "strategic",
              status: "alive" as const,
              shielded: ap.shielded,
            });
          }

          // Update/add eliminated players from snapshot
          for (const ep of snapshot.eliminatedPlayers) {
            const existing = playerMap.get(ep.id);
            playerMap.set(ep.id, {
              id: ep.id,
              name: ep.name,
              persona: existing?.persona ?? "strategic",
              status: "eliminated" as const,
              shielded: false,
            });
          }

          return {
            ...g,
            currentRound: snapshot.round,
            currentPhase: snapshotPhase,
            players: Array.from(playerMap.values()),
          };
        });

        // Sync phase ref so REVEAL/COUNCIL queue logic works immediately on reconnect
        if (snapshotPhase !== "INIT") {
          currentPhaseRef.current = snapshotPhase;
        }
        // Detect shield state changes to trigger shatter animation + audio
        const newlyUnshielded: string[] = [];
        for (const ap of snapshot.alivePlayers) {
          const wasShielded = prevShieldedRef.current.get(ap.id);
          if (wasShielded === false && ap.shielded) {
            // Shield just granted
            audioCue.sting("shield_granted");
          }
          if (wasShielded === true && !ap.shielded) {
            newlyUnshielded.push(ap.id);
          }
          prevShieldedRef.current.set(ap.id, ap.shielded);
        }
        if (newlyUnshielded.length > 0) {
          setRecentlyUnshielded((prev) => new Set([...prev, ...newlyUnshielded]));
          // Clear after animation completes (800ms)
          setTimeout(() => {
            setRecentlyUnshielded((prev) => {
              const next = new Set(prev);
              for (const id of newlyUnshielded) next.delete(id);
              return next;
            });
          }, 800);
        }
        // Load catch-up transcript
        let id = msgIdRef.current;
        const msgs = snapshot.transcript.map((entry) =>
          wsEntryToTranscriptEntry(entry, snapshot.gameId, id--),
        );
        msgIdRef.current = id;
        setMessages(msgs);
        break;
      }
      case "phase_change": {
        const prevPhase = currentPhaseRef.current;
        currentPhaseRef.current = ev.phase as PhaseKey;
        setGame((g) => g ? { ...g, currentPhase: ev.phase, currentRound: ev.round } : g);
        // When entering REVEAL: reset reveal panel for new round
        if (ev.phase === "REVEAL") {
          setRevealShown([]);
          setRevealQueue([]);
        }
        // When leaving REVEAL or COUNCIL: flush any remaining queued messages
        if ((prevPhase === "REVEAL" || prevPhase === "COUNCIL") &&
            ev.phase !== "REVEAL" && ev.phase !== "COUNCIL") {
          setRevealQueue((q) => {
            if (q.length > 0) {
              setRevealShown((s) => [...s, ...q]);
            }
            return [];
          });
        }
        // Audio zone transitions
        if (ev.phase === "INTRODUCTION") audioCue.zone("ambient");
        else if (ev.phase === "WHISPER" || ev.phase === "VOTE") audioCue.zone("tension");
        else if (ev.phase === "REVEAL" || ev.phase === "COUNCIL") audioCue.zone("drama");
        else if (ev.phase === "LOBBY" || ev.phase === "RUMOR") audioCue.zone("resolution");
        // Show transition overlay in live mode (not on END phase — no point)
        if (ev.phase !== "END" && ev.phase !== "INIT") {
          const flavorText =
            prevPhase === "WHISPER" && ev.phase === "RUMOR"
              ? "The rooms are sealed. Time to face the group."
              : (() => {
                  const flavors = PHASE_FLAVORS[ev.phase] ?? [];
                  return flavors.length > 0
                    ? flavors[Math.floor(Math.random() * flavors.length)]
                    : "";
                })();
          // Extend overlay hold when leaving a paced phase (gives viewers digestion time)
          setTransitionHoldMs(PACED_PHASES.has(prevPhase) ? 2000 + PHASE_END_PAUSE_MS : 2000);
          setActiveTransition({
            phase: ev.phase,
            round: ev.round,
            maxRounds: maxRoundsRef.current,
            aliveCount: ev.alivePlayers.length,
            flavorText,
          });
        }
        break;
      }
      case "message": {
        const id = msgIdRef.current--;
        const msg = wsEntryToTranscriptEntry(ev.entry, gameId, id);
        // If this is the first public message from a player awaiting last-words,
        // mark it and remove them from the awaiting set.
        if (
          ev.entry.scope === "public" &&
          ev.entry.from !== "SYSTEM" &&
          awaitingLastWordsRef.current.has(ev.entry.from)
        ) {
          awaitingLastWordsRef.current.delete(ev.entry.from);
          setLastWordsIds((prev) => new Set([...prev, id]));
        }
        // Badge count for diary entries arriving while user is on Main Stage tab
        if (ev.entry.scope === "diary" && activeTabRef.current !== "diary") {
          setNewDiaryCount((n) => n + 1);
        }
        // Mobile badge counts
        if (
          ev.entry.scope === "public" &&
          mobileTabRef.current !== "chat"
        ) {
          setNewChatCount((n) => n + 1);
        }
        // Queue messages for spectacle display (skip phases with dedicated views)
        const phase = currentPhaseRef.current;
        if (ev.entry.scope !== "diary" && ev.entry.scope !== "whisper") {
          if (phase === "REVEAL" || phase === "COUNCIL") {
            setRevealQueue((q) => [...q, msg]);
          } else if (
            phase !== "WHISPER" &&
            phase !== "INTRODUCTION" &&
            phase !== "LOBBY" &&
            phase !== "JURY_QUESTIONS" &&
            phase !== "DIARY_ROOM"
          ) {
            setSpectacleQueue((q) => [...q, msg]);
          }
        }
        setMessages((m) => [...m, msg]);
        break;
      }
      case "player_eliminated":
        // Register this player as awaiting their last-words message
        awaitingLastWordsRef.current.add(ev.playerId);
        // Track elimination round for badge display
        eliminatedRoundsRef.current.set(ev.playerId, ev.round);
        setEliminatedRounds(new Map(eliminatedRoundsRef.current));
        // Mobile: badge Players tab when not viewing it
        if (mobileTabRef.current !== "players") {
          setNewEliminationsCount((n) => n + 1);
        }
        // Audio: player eliminated sting + drama zone
        audioCue.sting("player_eliminated");
        audioCue.zone("drama");
        setGame((g) => {
          if (!g) return g;
          const found = g.players.some((p) => p.id === ev.playerId);
          const updated = found
            ? g.players.map((p) =>
                p.id === ev.playerId
                  ? { ...p, status: "eliminated" as const, name: ev.playerName || p.name }
                  : p,
              )
            : [
                ...g.players,
                {
                  id: ev.playerId,
                  name: ev.playerName,
                  persona: "strategic",
                  status: "eliminated" as const,
                  shielded: false,
                },
              ];
          return { ...g, players: updated };
        });
        break;
      case "game_over":
        setGame((g) =>
          g ? { ...g, status: "completed", currentPhase: "END", winner: ev.winnerName } : g,
        );
        audioCue.sting("winner_announced");
        audioCue.zone("resolution");
        break;
    }
  }, [gameId]);

  const wsStatus = useGameWebSocket(gameId, !!gameId && !!game && !isReplay, handleWsEvent);

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
      <div className="influence-glass rounded-panel p-12 text-center text-white/20 text-sm">
        Loading game…
      </div>
    );
  }

  // Gate live match viewing to admin-only (INF-92).
  // Non-admin users see a "game in progress" notice instead of the live feed.
  if (game.status === "in_progress" && !permLoading && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
        <div className="text-4xl">&#x1f3ac;</div>
        <h2 className="text-xl font-semibold text-white">Game in progress</h2>
        <p className="text-white/50 text-sm max-w-md">
          This match is currently being played. Live viewing is available to admins only.
          Check back once the game is finished to watch the full replay.
        </p>
        <button
          onClick={() => router.push("/games")}
          className="mt-2 text-sm px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 transition-colors"
        >
          Browse games
        </button>
      </div>
    );
  }

  // Spoiler-free entry screen for completed games (INF-138).
  // Show choice before entering the replay viewer.
  if (isReplay && messages.length > 0 && !replayChoice) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-8 text-center px-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">
            Game #{game.gameNumber}
          </h1>
          <p className="text-white/40 text-sm">
            {game.players.length} players &middot; Completed
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={() => setReplayChoice("replay")}
            className="group relative px-8 py-4 rounded-xl border border-indigo-500/50 bg-indigo-600/20 hover:bg-indigo-600/30 transition-all"
          >
            <div className="text-2xl mb-1">&#x25B6;&#xFE0F;</div>
            <div className="text-white font-semibold">Watch Replay</div>
            <p className="text-white/40 text-xs mt-1">
              Experience the game scene by scene
            </p>
          </button>
          <button
            onClick={() => setReplayChoice("results")}
            className="group relative px-8 py-4 rounded-xl border border-amber-500/50 bg-amber-600/20 hover:bg-amber-600/30 transition-all"
          >
            <div className="text-2xl mb-1">&#x1F3C6;</div>
            <div className="text-white font-semibold">Reveal Results</div>
            <p className="text-white/40 text-xs mt-1">
              See the winner and round summary
            </p>
          </button>
        </div>
        <button
          onClick={() => router.push("/games")}
          className="text-sm text-white/30 hover:text-white/60 transition-colors"
        >
          Back to games
        </button>
      </div>
    );
  }

  // Results reveal screen (INF-138)
  if (isReplay && replayChoice === "results" && game) {
    const winnerName = game.winner;
    const alive = game.players.filter((p) => p.status === "alive");
    const eliminated = game.players.filter((p) => p.status === "eliminated");
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-8 text-center px-4 overflow-y-auto py-12">
        <div>
          <div className="text-4xl mb-3">&#x1F3C6;</div>
          <h1 className="text-3xl font-bold text-white mb-1">
            {winnerName ?? "Unknown"}
          </h1>
          <p className="text-amber-400 text-sm font-medium">Winner</p>
          {game.winnerPersona && (
            <p className="text-white/30 text-xs mt-1">{game.winnerPersona}</p>
          )}
        </div>

        {alive.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Finalists</h2>
            <div className="flex flex-wrap justify-center gap-3">
              {alive.map((p) => (
                <div
                  key={p.id}
                  className={`px-4 py-2 rounded-lg border text-sm ${
                    p.name === winnerName
                      ? "border-amber-500/50 bg-amber-600/20 text-amber-300"
                      : "border-white/10 bg-white/5 text-white/60"
                  }`}
                >
                  {p.name}
                </div>
              ))}
            </div>
          </div>
        )}

        {eliminated.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Eliminated</h2>
            <div className="flex flex-wrap justify-center gap-2">
              {eliminated.map((p) => (
                <span
                  key={p.id}
                  className="px-3 py-1.5 rounded-lg border border-white/5 bg-white/5 text-white/30 text-xs"
                >
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={() => setReplayChoice("replay")}
            className="text-sm px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
          >
            Watch Replay
          </button>
          <button
            onClick={() => router.push("/games")}
            className="text-sm px-5 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 transition-colors"
          >
            Back to games
          </button>
        </div>
      </div>
    );
  }

  // Route to dramatic viewer for completed games (replay) and live in_progress games
  // (unless ?mode=classic). Waiting games skip this — they need the join UI.
  const useDramaticViewer = mode !== "classic" && (
    (isReplay && messages.length > 0) ||
    (!isReplay && game.status === "in_progress")
  );
  if (useDramaticViewer) {
    return (
      <DramaticReplayViewer
        game={game}
        messages={messages}
        players={game.players}
        live={!isReplay}
        connStatus={connStatus}
      />
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

  const currentWhisperEntries = visibleMessages.filter(
    (message) =>
      message.phase === "WHISPER" &&
      message.round === replayGame.currentRound &&
      (message.scope === "whisper" || message.scope === "system"),
  );

  // Group chat messages for INTRODUCTION/LOBBY phases (live mode)
  const currentGroupChatMessages = visibleMessages.filter(
    (m) =>
      (m.phase === "INTRODUCTION" || m.phase === "LOBBY") &&
      m.round === replayGame.currentRound &&
      m.scope !== "diary" &&
      m.scope !== "whisper",
  );

  // Jury question messages for JURY_QUESTIONS phase (live mode)
  const currentJuryMessages = visibleMessages.filter(
    (m) =>
      m.phase === "JURY_QUESTIONS" &&
      m.scope !== "whisper",
  );

  // Diary messages for DIARY_ROOM grid (live mode)
  const currentDiaryMessages = visibleMessages.filter(
    (m) =>
      m.scope === "diary" &&
      m.round === replayGame.currentRound,
  );

  // Phases that use dedicated views instead of spectacle spotlight
  const DEDICATED_VIEW_PHASES: ReadonlySet<PhaseKey> = new Set([
    "WHISPER", "REVEAL", "COUNCIL", "INTRODUCTION", "LOBBY", "JURY_QUESTIONS", "DIARY_ROOM",
  ]);

  // Construct a GameSummary-compatible object for the JoinGameModal
  const gameSummaryForJoin: GameSummary = {
    id: game.id,
    slug: game.slug,
    gameNumber: game.gameNumber,
    status: game.status,
    playerCount: game.players.length,
    currentRound: game.currentRound,
    maxRounds: game.maxRounds,
    currentPhase: game.currentPhase,
    phaseTimeRemaining: null,
    alivePlayers: game.players.filter((p) => p.status === "alive").length,
    eliminatedPlayers: game.players.filter((p) => p.status === "eliminated").length,
    modelTier: game.modelTier,
    visibility: game.visibility,
    viewerMode: game.viewerMode,
    createdAt: game.createdAt,
    startedAt: game.startedAt,
    completedAt: game.completedAt,
  };

  function handleJoinClick() {
    if (!authenticated) {
      gatedLogin();
      return;
    }
    setJoinModalOpen(true);
  }

  function handleJoinSuccess() {
    setJoinModalOpen(false);
    setJoinedSuccess(true);
    router.push("/dashboard");
  }

  return (
    <>
      {/* Join modal */}
      {joinModalOpen && (
        <JoinGameModal
          game={gameSummaryForJoin}
          onClose={() => setJoinModalOpen(false)}
          onSuccess={handleJoinSuccess}
        />
      )}

      {/* Phase transition overlay — live mode only, not replay */}
      {activeTransition && !isReplay && (
        <PhaseTransitionOverlay
          transition={activeTransition}
          onDismiss={() => setActiveTransition(null)}
          holdMs={transitionHoldMs}
        />
      )}

      {/* Endgame entry screens (Reckoning / Tribunal / Judgment) — live mode only */}
      {activeEndgame && !isReplay && (
        <EndgameEntryScreen
          endgame={activeEndgame}
          onDismiss={() => setActiveEndgame(null)}
        />
      )}

    {/* ── Mobile layout (<768px) — 4-tab view with bottom tab bar ── */}
    <div className="md:hidden flex flex-col h-[calc(100dvh-4rem)] pb-16 overflow-hidden">
      <PhaseHeader game={replayGame} isReplay={isReplay} />

      {/* Join banner — shown when game is waiting for players */}
      {game.status === "waiting" && !joinedSuccess && (
        <div className="mb-3 border border-indigo-500/30 bg-indigo-950/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-indigo-300">Open for players</p>
            <p className="text-xs text-white/30 mt-0.5">Waiting room — join before the game starts</p>
          </div>
          <button
            onClick={handleJoinClick}
            className="shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Join
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-2 px-1">
        <ConnectionBadge status={connStatus} />
        {!isReplay && (
          <span className="text-xs text-white/20">
            R{replayGame.currentRound}
          </span>
        )}
      </div>

      {/* Mobile Chat tab — dedicated phase views */}
      {mobileTab === "chat" && (replayGame.currentPhase === "INTRODUCTION" || replayGame.currentPhase === "LOBBY") && !isReplay && (
        <GroupChatFeed
          messages={currentGroupChatMessages}
          players={game.players}
          phase={replayGame.currentPhase}
        />
      )}
      {mobileTab === "chat" && replayGame.currentPhase === "WHISPER" && !isReplay && (
        <WhisperPhaseView
          phaseEntries={currentWhisperEntries}
          players={game.players}
          phaseKey={`whisper-${replayGame.currentRound}`}
        />
      )}
      {mobileTab === "chat" && replayGame.currentPhase === "DIARY_ROOM" && !isReplay && (
        <DiaryRoomGridView
          messages={currentDiaryMessages}
          players={game.players}
        />
      )}
      {mobileTab === "chat" && replayGame.currentPhase === "JURY_QUESTIONS" && !isReplay && (
        <JuryDMView
          messages={currentJuryMessages}
          players={game.players}
        />
      )}
      {mobileTab === "chat" &&
        (replayGame.currentPhase === "REVEAL" || replayGame.currentPhase === "COUNCIL") &&
        !isReplay && (
          <RevealModeView
            shown={revealShown}
            pendingCount={revealQueue.length}
            players={game.players}
            phase={replayGame.currentPhase}
          />
        )}
      {/* Mobile Chat: replay feed (all phases) OR spectacle for remaining live phases */}
      {mobileTab === "chat" && isReplay && (
        <div
          ref={feedRef}
          className="flex-1 overflow-y-auto p-4 space-y-3"
        >
          {visibleMessages.filter((m) => m.scope !== "diary" && m.scope !== "whisper")
            .length === 0 ? (
            <p className="text-center text-white/20 text-sm mt-12">No messages in replay.</p>
          ) : (
            groupMessages(
              visibleMessages.filter((m) => m.scope !== "diary" && m.scope !== "whisper"),
            ).map((item) => {
              if (item.kind === "msg") {
                return <MessageBubble key={item.entry.id} msg={item.entry} players={game.players} />;
              }
              return null;
            })
          )}
        </div>
      )}
      {mobileTab === "chat" &&
        !isReplay &&
        !DEDICATED_VIEW_PHASES.has(replayGame.currentPhase) && (
          <SpectacleMessageSpotlight
            message={spectacleCurrent}
            phase={spectaclePhase}
            players={game.players}
            onRevealComplete={() => setSpectaclePhase("done")}
            queueLength={spectacleQueue.length}
            speedrun={isSpeedrun}
          />
        )}

      {/* Mobile Players tab */}
      {mobileTab === "players" && (
        <PlayerRoster
          players={game.players}
          empoweredPlayerId={empoweredPlayerId}
          eliminatedRounds={eliminatedRounds}
          recentlyUnshielded={recentlyUnshielded}
          speedrun={isSpeedrun}
        />
      )}

      {/* Mobile Diary tab */}
      {mobileTab === "diary" && (
        <DiaryRoomPanel
          messages={isReplay ? messages : visibleMessages}
          players={game.players}
          isAuthenticated={isAuthenticated}
          isReplay={isReplay}
        />
      )}

      {/* Mobile Votes tab — placeholder for V2 vote tracker */}
      {mobileTab === "votes" && (
        <div className="flex-1 p-12 text-center text-white/20 text-sm flex items-center justify-center">
          <p>Vote tracker coming soon</p>
        </div>
      )}

      {/* Replay controls on mobile */}
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

      {/* Bottom tab bar — fixed */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-void/95 backdrop-blur border-t border-white/10 grid grid-cols-4">
        {(
          [
            { id: "chat", icon: "💬", label: "Chat", badge: newChatCount },
            { id: "players", icon: "👥", label: "Players", badge: newEliminationsCount },
            { id: "diary", icon: "📓", label: "Diary", badge: newDiaryCount },
            { id: "votes", icon: "🗳", label: "Votes", badge: 0 },
          ] as Array<{ id: MobileTab; icon: string; label: string; badge: number }>
        ).map(({ id, icon, label, badge }) => (
          <button
            key={id}
            onClick={() => {
              setMobileTab(id);
              if (id === "chat") setNewChatCount(0);
              if (id === "players") setNewEliminationsCount(0);
              if (id === "diary") setNewDiaryCount(0);
            }}
            className={`relative flex flex-col items-center justify-center py-2 text-xs transition-colors ${
              mobileTab === id
                ? "text-white"
                : "text-white/35 hover:text-white/60"
            }`}
          >
            <span className="text-base mb-0.5">{icon}</span>
            <span className="text-[10px] uppercase tracking-wide">{label}</span>
            {badge > 0 && (
              <span className="absolute top-1 right-3 text-[9px] bg-indigo-600 text-white rounded-full min-w-[14px] h-[14px] flex items-center justify-center leading-none px-0.5">
                {badge > 9 ? "9+" : badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>

    {/* ── Desktop layout (≥768px) — 2-column grid ── */}
    <div className="hidden md:grid md:grid-cols-[1fr_240px] gap-4 h-[calc(100dvh-2rem)] overflow-hidden">
      {/* Left: main feed + diary room panel */}
      <div className="flex flex-col min-h-0 overflow-hidden">
        {/* Phase header */}
        <PhaseHeader game={replayGame} isReplay={isReplay} />

        {/* Join banner — shown when game is waiting for players */}
        {game.status === "waiting" && !joinedSuccess && (
          <div className="mb-3 border border-indigo-500/30 bg-indigo-950/30 rounded-xl px-5 py-3.5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-indigo-300">Open for players</p>
              <p className="text-xs text-white/30 mt-0.5">Waiting room — join before the game starts</p>
            </div>
            <button
              onClick={handleJoinClick}
              className="shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              Join Game
            </button>
          </div>
        )}

        {/* Tab toggle: Main Stage | Diary Room */}
        <div className="flex items-center gap-1 mb-3">
          <button
            onClick={() => setActiveTab("stage")}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === "stage"
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            💬 Main Stage
          </button>
          <button
            onClick={() => {
              setActiveTab("diary");
              setNewDiaryCount(0);
            }}
            className={`relative text-xs px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === "diary"
                ? "bg-purple-900/30 text-purple-300"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            📓 Diary Room
            {newDiaryCount > 0 && (
              <span className="absolute -top-1 -right-1 text-[10px] bg-purple-600 text-white rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {newDiaryCount > 9 ? "9+" : newDiaryCount}
              </span>
            )}
          </button>

          {/* Connection badge pushed to right */}
          <div className="ml-auto flex items-center gap-3">
            <ConnectionBadge status={connStatus} />
            {!isReplay && activeTab === "stage" && (
              <span className="text-xs text-white/20">
                {messages.filter((m) => m.scope !== "diary").length} messages
              </span>
            )}
          </div>
        </div>

        {/* Diary Room panel */}
        {activeTab === "diary" && (
          <DiaryRoomPanel
            messages={isReplay ? messages : visibleMessages}
            players={game.players}
            isAuthenticated={isAuthenticated}
            isReplay={isReplay}
          />
        )}

        {/* Main Stage: Group chat for INTRODUCTION/LOBBY (live mode) */}
        {activeTab === "stage" && (replayGame.currentPhase === "INTRODUCTION" || replayGame.currentPhase === "LOBBY") && !isReplay && (
          <GroupChatFeed
            messages={currentGroupChatMessages}
            players={game.players}
            phase={replayGame.currentPhase}
          />
        )}

        {/* Main Stage: Whisper phase — DM grid */}
        {activeTab === "stage" && replayGame.currentPhase === "WHISPER" && !isReplay && (
          <WhisperPhaseView
            phaseEntries={currentWhisperEntries}
            players={game.players}
            phaseKey={`whisper-${replayGame.currentRound}`}
          />
        )}

        {/* Main Stage: Diary room grid (live DIARY_ROOM phase) */}
        {activeTab === "stage" && replayGame.currentPhase === "DIARY_ROOM" && !isReplay && (
          <DiaryRoomGridView
            messages={currentDiaryMessages}
            players={game.players}
          />
        )}

        {/* Main Stage: Jury questions DM (live JURY_QUESTIONS phase) */}
        {activeTab === "stage" && replayGame.currentPhase === "JURY_QUESTIONS" && !isReplay && (
          <JuryDMView
            messages={currentJuryMessages}
            players={game.players}
          />
        )}

        {/* Main Stage: Reveal choreography panel (REVEAL/COUNCIL, live mode) */}
        {activeTab === "stage" &&
          (replayGame.currentPhase === "REVEAL" || replayGame.currentPhase === "COUNCIL") &&
          !isReplay && (
            <RevealModeView
              shown={revealShown}
              pendingCount={revealQueue.length}
              players={game.players}
              phase={replayGame.currentPhase}
            />
          )}

        {/* Main Stage: replay feed (all phases) */}
        {activeTab === "stage" && isReplay && (
          <div
            ref={feedRef}
            className="flex-1 overflow-y-auto p-4 space-y-3"
          >
            {visibleMessages.filter((m) => m.scope !== "diary" && m.scope !== "whisper").length === 0 ? (
              <p className="text-center text-white/20 text-sm mt-16">No messages in replay.</p>
            ) : (
              groupMessages(visibleMessages.filter((m) => m.scope !== "diary" && m.scope !== "whisper")).map(
                (item) => {
                  if (item.kind === "msg") {
                    return <MessageBubble key={item.entry.id} msg={item.entry} players={game.players} />;
                  }
                  return null;
                },
              )
            )}
          </div>
        )}

        {/* Main Stage: spectacle spotlight for remaining live phases */}
        {activeTab === "stage" &&
          !isReplay &&
          !DEDICATED_VIEW_PHASES.has(replayGame.currentPhase) && (
            <SpectacleMessageSpotlight
              message={spectacleCurrent}
              phase={spectaclePhase}
              players={game.players}
              onRevealComplete={() => setSpectaclePhase("done")}
              queueLength={spectacleQueue.length}
              speedrun={isSpeedrun}
            />
          )}

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

      {/* Right: game state HUD + player roster */}
      <div className="space-y-3">
        <GameStateHUD
          players={game.players}
          currentRound={replayGame.currentRound}
          maxRounds={game.maxRounds}
          phase={replayGame.currentPhase}
          empoweredPlayerId={empoweredPlayerId}
        />
        <PlayerRoster
          players={game.players}
          empoweredPlayerId={empoweredPlayerId}
          eliminatedRounds={eliminatedRounds}
          recentlyUnshielded={recentlyUnshielded}
          speedrun={isSpeedrun}
        />
      </div>
    </div>
    </>
  );
}
