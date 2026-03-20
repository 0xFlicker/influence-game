"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { TranscriptEntry, GamePlayer, GameDetail } from "@/lib/api";
import { AgentAvatar } from "@/components/agent-avatar";
import type { EndgameStage, EndgameScreenState, TransitionState, SpectacleMessagePhase } from "./types";
import {
  PHASE_TRANSITION_LABELS,
  PHASE_FLAVORS,
  phaseColor,
  setPhaseAttr,
  setEndgameAttr,
  ENDGAME_PHASES,
  ROOM_TYPE_COLORS,
  SPEED_OPTIONS,
  INTER_SCENE_PAUSE_MS,
  TYPING_HOLD_MS,
  POST_REVEAL_BASE_MS,
  POST_REVEAL_PER_CHAR_MS,
  DRAMATIC_PHASE_MULTIPLIER,
  DRAMATIC_PHASES,
  CHAT_FEED_PHASES,
  CHAT_TYPING_HOLD_MS,
  CHAT_POST_MSG_BASE_MS,
  CHAT_POST_MSG_PER_CHAR_MS,
} from "./constants";
import { ConnectionBadge, GameStateHUD } from "./game-info";
import { PhaseTransitionOverlay } from "./phase-transition";
import { EndgameEntryScreen } from "./endgame-entry";
import { GroupChatFeed, JuryDMView } from "./chat-feeds";
import { WhisperPhaseView } from "./whisper-phase";
import { DiaryRoomGridView } from "./diary-room";
import { VoteTallyOverlay, SpectacleMessageContent } from "./vote-display";
import { buildReplayScenes } from "./spectacle-viewer";

export function DramaticReplayViewer({
  game,
  messages,
  players,
  live = false,
  connStatus,
}: {
  game: GameDetail;
  messages: TranscriptEntry[];
  players: GamePlayer[];
  live?: boolean;
  connStatus?: "connecting" | "live" | "disconnected" | "reconnecting" | "replay";
}) {
  const scenes = useMemo(() => buildReplayScenes(messages, players), [messages, players]);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [messagePhase, setMessagePhase] = useState<SpectacleMessagePhase>("typing");
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [showHouseOverlay, setShowHouseOverlay] = useState(false);
  const [activeEndgameScreen, setActiveEndgameScreen] = useState<EndgameScreenState | null>(null);
  const [activePhaseTransition, setActivePhaseTransition] = useState<TransitionState | null>(null);
  const seenEndgameStages = useRef<Set<string>>(new Set());
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveInitializedRef = useRef(false);

  const scene = scenes[sceneIndex];
  const totalScenes = scenes.length;
  const currentMessage = scene?.messages[messageIndex] ?? null;
  const isSystemMessage = !currentMessage?.fromPlayerId || currentMessage?.scope === "system";

  // Set data-phase on root for cinematic CSS cascade
  const scenePhase = scene?.phase;
  useEffect(() => {
    if (scenePhase) {
      setPhaseAttr(scenePhase);
      setEndgameAttr(scenePhase);
    }
    return () => {
      if (typeof document !== "undefined") {
        document.documentElement.removeAttribute("data-phase");
        document.documentElement.removeAttribute("data-endgame");
      }
    };
  }, [scenePhase]);

  // Live mode: jump to latest position when scenes first appear
  useEffect(() => {
    if (!live || liveInitializedRef.current || totalScenes === 0) return;
    liveInitializedRef.current = true;
    const lastScene = scenes[totalScenes - 1]!;
    setSceneIndex(totalScenes - 1);
    setMessageIndex(lastScene.messages.length - 1);
    setMessagePhase("done");
  }, [live, totalScenes, scenes]);

  // Resolve current speaker
  const currentPlayer = currentMessage?.fromPlayerId
    ? players.find((p) => p.id === currentMessage.fromPlayerId)
      ?? players.find((p) => p.name === currentMessage.fromPlayerId)
    : null;
  const currentPlayerName =
    currentMessage?.fromPlayerName ?? currentPlayer?.name ?? currentMessage?.fromPlayerId ?? "The House";

  // All messages visible up to current point
  const allVisibleMessages = useMemo(() => {
    const msgs: TranscriptEntry[] = [];
    for (let i = 0; i <= sceneIndex && i < scenes.length; i++) {
      const s = scenes[i]!;
      if (i < sceneIndex) {
        msgs.push(...s.messages);
      } else {
        msgs.push(...s.messages.slice(0, messageIndex + 1));
      }
    }
    return msgs;
  }, [scenes, sceneIndex, messageIndex]);

  // Determine rendering mode for current scene
  const isChatFeedScene = !!scene && CHAT_FEED_PHASES.has(scene.phase);
  const isWhisperScene = !!scene && scene.phase === "WHISPER";
  const isDiaryScene = !!scene && scene.phase === "DIARY_ROOM";
  const isJuryScene = !!scene && scene.phase === "JURY_QUESTIONS";
  const isChatStyleScene = isChatFeedScene || isWhisperScene || isDiaryScene || isJuryScene;

  // Messages visible in current scene's chat feed (for chat-style phases)
  const chatFeedMessages = useMemo(() => {
    if (!scene || !isChatStyleScene) return [];
    // During typing phase, show messages up to (but not including) current
    // During revealing/done, include current message
    const endIdx = messagePhase === "typing" ? messageIndex : messageIndex + 1;
    return scene.messages.slice(0, endIdx);
  }, [scene, isChatStyleScene, messageIndex, messagePhase]);

  // For whisper scenes: gather all whisper messages for this round from allVisibleMessages
  const whisperRoundMessages = useMemo(() => {
    if (!scene || scene.phase !== "WHISPER") return [];
    return allVisibleMessages.filter(m => m.round === scene.round && m.phase === "WHISPER");
  }, [allVisibleMessages, scene]);

  // For diary scenes: show ALL messages at once (grid renders all rooms simultaneously)
  const diaryRoundMessages = useMemo(() => {
    if (!scene || scene.phase !== "DIARY_ROOM") return [];
    return scene.messages;
  }, [scene]);

  // For jury scenes: gather all jury messages
  const juryMessages = useMemo(() => {
    if (!scene || scene.phase !== "JURY_QUESTIONS") return [];
    return allVisibleMessages.filter(m => m.phase === "JURY_QUESTIONS");
  }, [allVisibleMessages, scene]);

  // Track eliminated players from visible messages
  const eliminatedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const msg of allVisibleMessages) {
      if (msg.scope === "system" && msg.text.includes("has been eliminated")) {
        const player = players.find((p) => msg.text.includes(p.name));
        if (player) ids.add(player.id);
      }
    }
    return ids;
  }, [allVisibleMessages, players]);
  const aliveCount = players.length - eliminatedIds.size;

  // Build players with correct alive/eliminated status for current replay position
  const replayPlayers = useMemo(() =>
    players.map((p) => ({
      ...p,
      status: eliminatedIds.has(p.id) ? "eliminated" as const : "alive" as const,
    })),
  [players, eliminatedIds]);

  // Detect scene transitions
  const prevScene = sceneIndex > 0 ? scenes[sceneIndex - 1] : null;
  const isNewRound = scene && prevScene && scene.round !== prevScene.round;
  const isRoomChange = scene && prevScene && scene.roomType !== prevScene.roomType;

  // Phase transition overlay on room type changes
  useEffect(() => {
    if (isRoomChange && scene) {
      const flavors = PHASE_FLAVORS[scene.phase] ?? [];
      const flavorText = flavors.length > 0
        ? flavors[Math.floor(Math.random() * flavors.length)]!
        : "";
      setActivePhaseTransition({
        phase: scene.phase,
        round: scene.round,
        maxRounds: game.maxRounds,
        aliveCount,
        flavorText,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIndex]);

  // Endgame entry screens at player-count thresholds
  useEffect(() => {
    if (!scene || scene.roomType !== "endgame") return;
    let stage: EndgameStage | null = null;
    if (aliveCount <= 2 && !seenEndgameStages.current.has("judgment")) stage = "judgment";
    else if (aliveCount <= 3 && !seenEndgameStages.current.has("tribunal")) stage = "tribunal";
    else if (aliveCount <= 4 && !seenEndgameStages.current.has("reckoning")) stage = "reckoning";
    if (stage) {
      seenEndgameStages.current.add(stage);
      const alivePlayers = players.filter((p) => !eliminatedIds.has(p.id));
      const finalists = alivePlayers.length === 2
        ? [alivePlayers[0]!.name, alivePlayers[1]!.name] as [string, string]
        : undefined;
      const jurors = stage === "judgment"
        ? players.filter((p) => eliminatedIds.has(p.id)).map((p) => p.name)
        : undefined;
      setActiveEndgameScreen({ stage, finalists, jurors });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIndex]);

  // House overlay on room changes
  useEffect(() => {
    if (scene?.houseIntro && isRoomChange) {
      setShowHouseOverlay(true);
      const timer = window.setTimeout(() => setShowHouseOverlay(false), 3500);
      return () => window.clearTimeout(timer);
    }
  }, [sceneIndex, scene?.houseIntro, isRoomChange]);

  // Auto-advance state machine
  useEffect(() => {
    if (!isPlaying || !scene || !currentMessage) return;

    // Diary scenes: show all content at once, hold proportionally, then advance
    if (isDiaryScene) {
      if (messagePhase === "typing") {
        // Grid already renders all rooms — skip to end of scene immediately
        setMessageIndex(scene.messages.length - 1);
        setMessagePhase("done");
        return;
      }
      if (messagePhase === "done") {
        const isLastScene = sceneIndex >= totalScenes - 1;
        // Hold proportional to content: ~5s base + 300ms per diary message
        const holdMs = Math.max(5000, scene.messages.length * 300) / speed;
        const timer = setTimeout(() => {
          if (!isLastScene) {
            setSceneIndex((i) => i + 1);
            setMessageIndex(0);
            setMessagePhase("typing");
          } else if (!live) {
            setIsPlaying(false);
          }
        }, holdMs);
        return () => clearTimeout(timer);
      }
      return;
    }

    if (messagePhase === "typing") {
      // Chat-style phases: short typing indicator then skip straight to "done"
      if (isChatStyleScene) {
        if (isSystemMessage) {
          setMessagePhase("done");
          return;
        }
        const timer = setTimeout(() => setMessagePhase("done"), CHAT_TYPING_HOLD_MS / speed);
        return () => clearTimeout(timer);
      }
      // System messages skip typing indicator
      if (isSystemMessage) {
        setMessagePhase("revealing");
        return;
      }
      const typingMul = DRAMATIC_PHASES.has(scene.phase) ? DRAMATIC_PHASE_MULTIPLIER : 1;
      const timer = setTimeout(() => setMessagePhase("revealing"), (TYPING_HOLD_MS * typingMul) / speed);
      return () => clearTimeout(timer);
    }

    if (messagePhase === "done") {
      const isLastInScene = messageIndex >= scene.messages.length - 1;
      const isLastScene = sceneIndex >= totalScenes - 1;

      // Chat-style phases use faster timing
      if (isChatStyleScene) {
        const holdMs = isLastInScene
          ? INTER_SCENE_PAUSE_MS / speed
          : Math.max(CHAT_POST_MSG_BASE_MS, currentMessage.text.length * CHAT_POST_MSG_PER_CHAR_MS) / speed;

        const timer = setTimeout(() => {
          if (!isLastInScene) {
            setMessageIndex((i) => i + 1);
            setMessagePhase("typing");
          } else if (!isLastScene) {
            setSceneIndex((i) => i + 1);
            setMessageIndex(0);
            setMessagePhase("typing");
          } else if (!live) {
            setIsPlaying(false);
          }
        }, holdMs);
        return () => clearTimeout(timer);
      }

      // Hold time proportional to message length; dramatic phases get extra weight
      const dramaticMul = DRAMATIC_PHASES.has(scene.phase) ? DRAMATIC_PHASE_MULTIPLIER : 1;
      const holdMs = isLastInScene
        ? (INTER_SCENE_PAUSE_MS * dramaticMul) / speed
        : (Math.max(POST_REVEAL_BASE_MS, currentMessage.text.length * POST_REVEAL_PER_CHAR_MS) * dramaticMul) / speed;

      const timer = setTimeout(() => {
        if (!isLastInScene) {
          setMessageIndex((i) => i + 1);
          setMessagePhase("typing");
        } else if (!isLastScene) {
          setSceneIndex((i) => i + 1);
          setMessageIndex(0);
          setMessagePhase("typing");
        } else if (!live) {
          setIsPlaying(false);
        }
        // In live mode at the end: do nothing — wait for new messages
        // to arrive. When scenes rebuild, this effect re-runs and advances.
      }, holdMs);
      return () => clearTimeout(timer);
    }
    // "revealing" phase transitions via Typewriter onComplete
  }, [isPlaying, messagePhase, messageIndex, sceneIndex, scene, totalScenes, speed, currentMessage, isSystemMessage, isChatStyleScene, isDiaryScene, live]);

  // Advance function — for click/tap and keyboard
  const advanceMessage = useCallback(() => {
    if (!scene) return;
    // Diary scenes show all content at once — click advances to next scene
    if (scene.phase === "DIARY_ROOM") {
      if (sceneIndex < totalScenes - 1) {
        setSceneIndex((i) => i + 1);
        setMessageIndex(0);
        setMessagePhase("typing");
      }
      return;
    }
    // If mid-animation, skip to fully revealed
    if (messagePhase === "typing" || messagePhase === "revealing") {
      setMessagePhase("done");
      return;
    }
    // Advance to next message or scene
    if (messageIndex < scene.messages.length - 1) {
      setMessageIndex((i) => i + 1);
      setMessagePhase("typing");
    } else if (sceneIndex < totalScenes - 1) {
      setSceneIndex((i) => i + 1);
      setMessageIndex(0);
      setMessagePhase("typing");
    }
  }, [scene, messagePhase, messageIndex, sceneIndex, totalScenes]);

  const goToNextScene = useCallback(() => {
    if (sceneIndex < totalScenes - 1) {
      setSceneIndex((i) => i + 1);
      setMessageIndex(0);
      setMessagePhase("typing");
    }
  }, [sceneIndex, totalScenes]);

  const goToEnd = useCallback(() => {
    if (totalScenes > 0) {
      const lastScene = scenes[totalScenes - 1]!;
      setSceneIndex(totalScenes - 1);
      setMessageIndex(lastScene.messages.length - 1);
      setMessagePhase("done");
      setIsPlaying(false);
    }
  }, [totalScenes, scenes]);

  const goToBeginning = useCallback(() => {
    setSceneIndex(0);
    setMessageIndex(0);
    setMessagePhase("typing");
  }, []);

  const goToPrevScene = useCallback(() => {
    if (messageIndex > 0) {
      // If mid-scene, go to start of current scene
      setMessageIndex(0);
      setMessagePhase("typing");
    } else if (sceneIndex > 0) {
      setSceneIndex((i) => i - 1);
      setMessageIndex(0);
      setMessagePhase("typing");
    }
  }, [sceneIndex, messageIndex]);

  // Click handler — advance when paused, pause when playing
  // Tap-to-skip: clicking always advances (skips current animation or goes to
  // next message). Only the play/pause button can pause. After advancing,
  // playback auto-continues if it was playing.
  const handleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-controls]")) return;
    advanceMessage();
  }, [advanceMessage]);

  // Auto-hide controls
  const handleMouseMove = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          setIsPlaying((p) => !p);
          break;
        case "ArrowRight":
        case "Enter":
          e.preventDefault();
          advanceMessage();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (messageIndex > 0) {
            setMessageIndex((i) => i - 1);
            setMessagePhase("done");
          } else if (sceneIndex > 0) {
            const prev = scenes[sceneIndex - 1]!;
            setSceneIndex((i) => i - 1);
            setMessageIndex(prev.messages.length - 1);
            setMessagePhase("done");
          }
          break;
        case "]":
          e.preventDefault();
          goToNextScene();
          break;
        case "[":
          e.preventDefault();
          if (scene) {
            for (let i = sceneIndex - 1; i >= 0; i--) {
              if (scenes[i]!.round !== scene.round) {
                const targetRound = scenes[i]!.round;
                let first = i;
                while (first > 0 && scenes[first - 1]!.round === targetRound) first--;
                setSceneIndex(first);
                setMessageIndex(0);
                setMessagePhase("typing");
                break;
              }
            }
          }
          break;
        case "1": setSpeed(0.5); break;
        case "2": setSpeed(1); break;
        case "3": setSpeed(2); break;
        case "4": setSpeed(4); break;
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [advanceMessage, goToNextScene, messageIndex, sceneIndex, scene, scenes]);

  if (!scene || totalScenes === 0) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-4">
        {live ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs font-medium text-green-400">Live</span>
            </div>
            <p className="text-white/30 text-sm">Waiting for the game to begin…</p>
          </>
        ) : (
          <p className="text-white/20 text-sm">No replay data available.</p>
        )}
      </div>
    );
  }

  // Whisper room label
  const roomLabel = scene.whisperRoom
    ? `Room ${scene.whisperRoom.roomId} — ${scene.whisperRoom.playerNames.join(" × ")}`
    : null;

  // Is the current message an elimination announcement?
  const isElimination = currentMessage?.scope === "system" && currentMessage.text.includes("has been eliminated");

  return (
    <div
      className="fixed inset-0 z-30 influence-shell flex flex-col cursor-pointer select-none"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
    >
      {/* Cinematic atmosphere layers */}
      <div className="influence-phase-atmosphere" />
      <div className="influence-phase-vignette" />
      {ENDGAME_PHASES.has(scene.phase) && <div className="influence-endgame-atmosphere" />}

      {/* Overlays */}
      {activePhaseTransition && (
        <PhaseTransitionOverlay
          transition={activePhaseTransition}
          onDismiss={() => setActivePhaseTransition(null)}
        />
      )}
      {activeEndgameScreen && (
        <EndgameEntryScreen
          endgame={activeEndgameScreen}
          onDismiss={() => setActiveEndgameScreen(null)}
        />
      )}
      {showHouseOverlay && scene.houseIntro && (
        <div className="fixed inset-0 z-40 bg-black/90 flex flex-col items-center justify-center animate-[fadeIn_0.3s_ease-out]">
          <p className="text-white/20 text-xs tracking-[0.4em] uppercase mb-4">◆ THE HOUSE ◆</p>
          <p className="text-white/60 italic text-lg max-w-lg text-center px-6 leading-relaxed">
            {scene.houseIntro}
          </p>
        </div>
      )}

      {/* Exit button — top-left, auto-hides with controls */}
      <button
        type="button"
        data-controls
        onClick={(e) => {
          e.stopPropagation();
          window.history.back();
        }}
        className={`fixed top-4 left-4 z-20 w-9 h-9 flex items-center justify-center rounded-full border border-white/10 bg-black/50 text-white/50 hover:text-white hover:border-white/25 transition-all duration-500 ${
          controlsVisible || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        title="Exit"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M1 1l12 12M13 1L1 13" />
        </svg>
      </button>

      {/* Top bar — phase context */}
      <div className={`flex-shrink-0 px-6 pt-5 pb-3 flex items-center justify-between z-10 transition-opacity duration-500 ${
        controlsVisible || !isPlaying ? "opacity-100" : "opacity-0"
      }`}>
        <div className="flex items-center gap-3 pl-10">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ROOM_TYPE_COLORS[scene.roomType]}`} />
          <span className={`text-xs font-semibold uppercase tracking-[0.25em] ${phaseColor(scene.phase)}`}>
            {PHASE_TRANSITION_LABELS[scene.phase] ?? scene.phase}
          </span>
          {roomLabel && (
            <span className="text-xs text-purple-300/50">{roomLabel}</span>
          )}
          {isNewRound && (
            <span className="text-xs text-white/25 uppercase tracking-wider">
              Round {scene.round}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ConnectionBadge status={connStatus ?? "replay"} />
        </div>
      </div>

      {/* Game state HUD — top-right corner, auto-hides with controls */}
      <div
        data-controls
        className={`fixed top-14 right-4 z-20 transition-opacity duration-500 ${
          controlsVisible || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <GameStateHUD
          players={replayPlayers}
          currentRound={scene.round}
          maxRounds={game.maxRounds}
          phase={scene.phase}
          empoweredPlayerId={null}
        />
      </div>

      {/* Scene progress bar */}
      <div className="px-6 z-10">
        <div className="flex h-0.5 rounded-full overflow-hidden bg-white/5 gap-px">
          {scenes.map((s, i) => (
            <div
              key={s.id}
              className={`flex-1 min-w-[2px] ${ROOM_TYPE_COLORS[s.roomType]} ${
                i <= sceneIndex ? "opacity-80" : "opacity-10"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Center — phase-aware content */}
      <div className={`flex-1 flex ${isChatStyleScene ? "items-end" : "items-center"} justify-center px-8 py-8 overflow-y-auto`}>
        <div className={`w-full ${isChatStyleScene ? "max-w-3xl" : "max-w-2xl"}`}>
          {/* --- Chat-style: Group Chat Feed --- */}
          {isChatFeedScene && (
            <div className="flex flex-col gap-2">
              <GroupChatFeed messages={chatFeedMessages} players={replayPlayers} phase={scene.phase} />
              {/* Typing indicator below chat feed */}
              {messagePhase === "typing" && currentMessage && !isSystemMessage && (
                <div className="flex items-center gap-2 px-4 animate-[fadeIn_0.2s_ease-out]">
                  {currentPlayer && <AgentAvatar avatarUrl={currentPlayer.avatarUrl} persona={currentPlayer.persona} name={currentPlayer.name} size="6" />}
                  <span className="text-xs text-white/40">{currentPlayerName}</span>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/25 animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1.2s" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/25 animate-bounce" style={{ animationDelay: "200ms", animationDuration: "1.2s" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/25 animate-bounce" style={{ animationDelay: "400ms", animationDuration: "1.2s" }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* --- Chat-style: Whisper Rooms DM Grid --- */}
          {isWhisperScene && (
            <WhisperPhaseView
              phaseEntries={whisperRoundMessages}
              players={replayPlayers}
              phaseKey={`replay-R${scene.round}-WHISPER`}
              isReplay
            />
          )}

          {/* --- Chat-style: Diary Rooms DM Grid --- */}
          {isDiaryScene && (
            <DiaryRoomGridView
              messages={diaryRoundMessages}
              players={replayPlayers}
            />
          )}

          {/* --- Chat-style: Jury Questions DM --- */}
          {isJuryScene && (
            <JuryDMView
              messages={juryMessages}
              players={replayPlayers}
            />
          )}

          {/* --- Dramatic: Single-message spotlight (votes/reveals/power/end) --- */}
          {!isChatStyleScene && (
            <>
              {/* Typing indicator */}
              {messagePhase === "typing" && currentMessage && !isSystemMessage && (
                <div className="text-center animate-[fadeIn_0.3s_ease-out]">
                  <div className="flex items-center justify-center gap-3 mb-8">
                    {currentPlayer && (
                      <AgentAvatar avatarUrl={currentPlayer.avatarUrl} persona={currentPlayer.persona} name={currentPlayer.name} size="10" />
                    )}
                    <span className="text-lg font-semibold text-white/60">{currentPlayerName}</span>
                    {currentMessage.scope === "whisper" && (
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
              {(messagePhase === "revealing" || messagePhase === "done") && currentMessage && (
                <SpectacleMessageContent
                  message={currentMessage}
                  scene={scene}
                  players={players}
                  messagePhase={messagePhase}
                  onRevealComplete={() => setMessagePhase("done")}
                  isSystemMessage={isSystemMessage}
                  isElimination={isElimination}
                  currentPlayer={currentPlayer}
                  currentPlayerName={currentPlayerName}
                  speedMultiplier={speed}
                />
              )}

              {/* Vote/council/jury tally overlay */}
              {scene && currentMessage && DRAMATIC_PHASES.has(scene.phase) && messagePhase === "done" && (
                <VoteTallyOverlay
                  sceneMessages={scene.messages}
                  upToIndex={messageIndex}
                  players={players}
                  scenePhase={scene.phase}
                />
              )}
            </>
          )}

          {/* Paused indicator */}
          {!isPlaying && messagePhase === "done" && (
            <p className="text-center text-xs text-white/15 mt-8 animate-pulse">
              Click or press → to advance
            </p>
          )}
          {/* Live: waiting for new messages */}
          {live && isPlaying && messagePhase === "done" && sceneIndex >= totalScenes - 1 && messageIndex >= (scene?.messages.length ?? 0) - 1 && (
            <div className="text-center mt-8 animate-pulse">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full bg-green-400/50 animate-pulse" />
                <span className="text-xs text-green-400/50">Waiting for messages…</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom controls — auto-hide when playing */}
      <div
        data-controls
        className={`flex-shrink-0 px-6 py-4 transition-opacity duration-500 z-10 ${
          controlsVisible || !isPlaying ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="flex items-center justify-between max-w-3xl mx-auto">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setIsPlaying((p) => !p); }}
            className="text-sm text-white/50 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20"
          >
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); goToBeginning(); }}
              disabled={sceneIndex === 0 && messageIndex === 0}
              className="text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              ⏮ Start
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); goToPrevScene(); }}
              disabled={sceneIndex === 0 && messageIndex === 0}
              className="text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              ◀◀ Prev
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); goToNextScene(); }}
              disabled={sceneIndex >= totalScenes - 1}
              className="text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              Next ▶▶
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); goToEnd(); }}
              className="text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20"
            >
              {live ? "Live ⏭" : "End ⏭"}
            </button>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-xs text-white/20 mr-1">Speed:</span>
            {SPEED_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={(e) => { e.stopPropagation(); setSpeed(opt.value); }}
                className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                  speed === opt.value
                    ? "bg-white/10 text-white border border-white/20"
                    : "text-white/30 hover:text-white/60 border border-transparent"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-white/10 text-center mt-2">
          Space: play/pause · Click/→: advance · ←: back · []: rounds · 1234: speed
        </p>
      </div>
    </div>
  );
}
