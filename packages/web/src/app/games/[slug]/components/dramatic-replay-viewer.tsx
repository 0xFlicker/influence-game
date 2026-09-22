"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { visualSpeechDurationMs } from "@influence/engine/visual-speech";
import { VisualPresentation } from "./visual-presentation";
import { useVisualWatch } from "./use-visual-watch";
import { visualWatchPresentation, paceVisualBallots } from "./visual-watch-model";
import { MotionConfig } from "motion/react";
import type {
  TranscriptEntry,
  GamePlayer,
  GameDetail,
  GameWatchReplayFrame,
  PhaseKey,
} from "@/lib/api";
import type {
  ClassicPresentationCue,
  EndgameStage,
  EndgameScreenState,
  FormatPresentationCue,
  PresentationCue,
  ReplayScene,
  TransitionState,
} from "./types";
import {
  PHASE_TRANSITION_LABELS,
  PHASE_FLAVORS,
  phaseColor,
  setPhaseAttr,
  setEndgameAttr,
  ENDGAME_PHASES,
  ROOM_TYPE_COLORS,
  SPEED_OPTIONS,
  PACED_PHASES,
  PHASE_END_PAUSE_MS,
} from "./constants";
import { ConnectionBadge, GameStateHUD } from "./game-info";
import { PhaseTransitionOverlay } from "./phase-transition";
import { EndgameEntryScreen } from "./endgame-entry";
import { buildReplayScenes } from "./spectacle-viewer";
import { shouldSuppressDramaticAdvance } from "./dramatic-interaction";
import {
  MATCH_WATCH_FORMAT_PHASES,
  REPLAY_FRAME_PHASE_ORDER,
  type MatchWatchPlaybackState,
  type PresentationHydrationState,
} from "./match-watch-model";
import type { WatchConnStatus } from "./types";
import {
  compileFormatPresentationPrefix,
  formatPresentationDecisionsFromFrames,
  formatPresentationEligibilityFromFrames,
} from "./format-presentation-model";
import { usePresentationDirector } from "./format-presentation-director";
import { FormatPresentation } from "./format-presentation";
import { ActiveFormatLabel } from "./active-format-label";
import { findPresentationCueIndexForSequence } from "./presentation-sequence";

const FORMAT_AUTHORITY_TRANSCRIPT_PHASES: ReadonlySet<PhaseKey> = new Set([
  "VOTE",
  "FORMAT_MENU",
  "FORMAT_PICK",
  "FORMAT_RESOLVE",
]);

export function isFormatSocialTranscriptMessage(
  message: Pick<TranscriptEntry, "phase" | "presentationPurpose">,
): boolean {
  return message.presentationPurpose === "farewell"
    || !FORMAT_AUTHORITY_TRANSCRIPT_PHASES.has(message.phase);
}

interface DramaticReplayViewerProps {
  game: GameDetail;
  messages: TranscriptEntry[];
  players: GamePlayer[];
  replayFrames?: GameWatchReplayFrame[];
  live?: boolean;
  connStatus?: WatchConnStatus;
  presentationHydrationStatus?: PresentationHydrationState["status"];
  embedded?: boolean;
  /** Canonical event sequence to seek to on first load (completed replay deep-links). */
  startSequence?: number;
  onPlaybackStateChange?: (state: MatchWatchPlaybackState) => void;
}

export function DramaticReplayViewer(props: DramaticReplayViewerProps) {
  return (
    <MotionConfig reducedMotion="user">
      <DramaticReplayTheater {...props} />
    </MotionConfig>
  );
}

function buildClassicPresentationCues(
  scenes: ReturnType<typeof buildReplayScenes>,
  replayFrames: readonly GameWatchReplayFrame[],
): ClassicPresentationCue[] {
  const framesByRound = new Map<number, GameWatchReplayFrame[]>();
  for (const frame of replayFrames) {
    const roundFrames = framesByRound.get(frame.round) ?? [];
    roundFrames.push(frame);
    framesByRound.set(frame.round, roundFrames);
  }
  return scenes.flatMap((scene, sceneIndex) =>
    scene.messages.flatMap((message, messageIndex) => {
      const canonicalSequence = latestFrameSequenceAtOrBefore(
        framesByRound.get(scene.round) ?? [],
        message.timestamp,
      );

      const stages: Array<{ stage: ClassicPresentationCue["stage"]; durationMs: number }> = [
        { stage: "done", durationMs: visualSpeechDurationMs(message.text) },
      ];

      return stages.map(({ stage, durationMs }) => ({
        source: "classic" as const,
        liveCatchUp: message.liveCatchUp,
        key: `classic:${message.id}:${stage}`,
        canonicalSequence,
        round: scene.round,
        phase: scene.phase,
        kind: "classic_transcript" as const,
        stage,
        baseDurationMs: durationMs,
        sceneIndex,
        messageIndex,
      }));
    }),
  );
}

function latestFrameSequenceAtOrBefore(
  frames: readonly GameWatchReplayFrame[],
  timestamp: number,
): number | null {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index]!;
    if (frame.timestamp <= timestamp) return frame.sequence;
  }
  return null;
}

export function comparePresentationCues(
  left: PresentationCue,
  right: PresentationCue,
): number {
  if (left.round !== right.round) return left.round - right.round;
  if (
    left.canonicalSequence !== null
    && right.canonicalSequence !== null
    && left.canonicalSequence !== right.canonicalSequence
  ) {
    return left.canonicalSequence - right.canonicalSequence;
  }
  const phaseIndex = (phase: PhaseKey): number => {
    const formatIndex = MATCH_WATCH_FORMAT_PHASES.indexOf(phase);
    if (formatIndex >= 0) return formatIndex;
    const replayIndex = REPLAY_FRAME_PHASE_ORDER.indexOf(phase);
    return replayIndex >= 0
      ? MATCH_WATCH_FORMAT_PHASES.length + replayIndex
      : Number.MAX_SAFE_INTEGER;
  };
  const phaseDifference =
    phaseIndex(left.phase) - phaseIndex(right.phase);
  if (phaseDifference !== 0) return phaseDifference;
  if (left.source !== right.source) return left.source === "classic" ? -1 : 1;
  if (left.source === "format" && right.source === "format") {
    return left.canonicalSequence - right.canonicalSequence;
  }
  if (left.source === "classic" && right.source === "classic") {
    return left.sceneIndex - right.sceneIndex || left.messageIndex - right.messageIndex;
  }
  return 0;
}

export function buildReplayPlayersForCue(input: {
  players: readonly GamePlayer[];
  isFormatGame: boolean;
  canonicalFrame: GameWatchReplayFrame | null;
  classicEliminatedIds: ReadonlySet<string>;
  live: boolean;
}): GamePlayer[] {
  const canonicalById = new Map(
    input.canonicalFrame?.players.map((player) => [player.id, player]) ?? [],
  );
  return input.players.map((player) => {
    const canonical = canonicalById.get(player.id);
    return {
      ...player,
      status: input.isFormatGame
        ? canonical?.status ?? player.status
        : input.classicEliminatedIds.has(player.id) ? "eliminated" : "alive",
      shielded: input.isFormatGame
        ? canonical?.shielded ?? player.shielded
        : input.live ? player.shielded : false,
    };
  });
}

function mergeFormatAndSocialCues(
  formatCues: readonly FormatPresentationCue[],
  classicCues: readonly ClassicPresentationCue[],
  scenes: ReturnType<typeof buildReplayScenes>,
): PresentationCue[] {
  const socialCues = classicCues.filter((cue) => {
    const message = scenes[cue.sceneIndex]?.messages[cue.messageIndex];
    return message ? isFormatSocialTranscriptMessage(message) : false;
  });
  return [...socialCues, ...formatCues].sort(comparePresentationCues);
}

function formatCueScene(cue: FormatPresentationCue): ReplayScene {
  return {
    id: cue.key,
    round: cue.round,
    phase: cue.phase,
    roomType: "tribunal" as const,
    messages: [] as TranscriptEntry[],
    houseIntro: null,
  };
}

function findCueForAdjacentScene(
  cues: readonly PresentationCue[],
  cursor: number,
  direction: -1 | 1,
): number | null {
  const current = cues[cursor];
  if (!current) return null;
  const identity = cueSceneIdentity(current);
  if (direction === 1) {
    for (let index = cursor + 1; index < cues.length; index += 1) {
      if (cueSceneIdentity(cues[index]!) !== identity) return index;
    }
    return null;
  }
  let previous = cursor - 1;
  while (previous >= 0 && cueSceneIdentity(cues[previous]!) === identity) previous -= 1;
  if (previous < 0) return null;
  const previousIdentity = cueSceneIdentity(cues[previous]!);
  while (
    previous > 0
    && cueSceneIdentity(cues[previous - 1]!) === previousIdentity
  ) {
    previous -= 1;
  }
  return previous;
}

function cueSceneIdentity(cue: PresentationCue): string {
  return cue.source === "classic"
    ? `classic:${cue.sceneIndex}`
    : cue.key;
}

export function activeFormatIdForPresentationCursor(
  cues: readonly PresentationCue[],
  cursor: number,
  round: number,
) {
  for (let index = Math.min(cursor, cues.length - 1); index >= 0; index -= 1) {
    const cue = cues[index]!;
    if (cue.round !== round) continue;
    if (cue.source === "format" && cue.after.activeFormatId) {
      return cue.after.activeFormatId;
    }
  }
  return null;
}

function findPreviousRoundCue(
  cues: readonly PresentationCue[],
  cursor: number,
): number {
  const currentRound = cues[cursor]?.round;
  if (currentRound === undefined) return 0;
  for (let index = cursor - 1; index >= 0; index -= 1) {
    const round = cues[index]!.round;
    if (round < currentRound) {
      while (index > 0 && cues[index - 1]!.round === round) index -= 1;
      return index;
    }
  }
  return 0;
}

function DramaticReplayTheater({
  game,
  messages,
  players,
  replayFrames = [],
  live = false,
  connStatus,
  presentationHydrationStatus,
  embedded = false,
  startSequence,
  onPlaybackStateChange,
}: DramaticReplayViewerProps) {
  const initialSequenceSeekAppliedRef = useRef(false);
  // Backward compat: always filter out old scope='thinking' entries (they lack per-message association)
  const filteredMessages = useMemo(
    () => messages.filter((m) => m.scope !== "thinking"),
    [messages],
  );
  const isFormatGame =
    (game.gameKernel ?? game.watchState?.gameKernel) === "format";
  const formatRoster = useMemo(
    () => players.map((player) => ({
      id: player.id,
      name: player.name,
      persona: player.persona,
      personaKey: player.personaKey,
      avatarUrl: player.avatarUrl,
      currentAgent: player.currentAgent,
    })),
    [players],
  );
  const scenes = useMemo(() => buildReplayScenes(filteredMessages), [filteredMessages]);
  const classicCues = useMemo(
    () => buildClassicPresentationCues(scenes, replayFrames),
    [replayFrames, scenes],
  );
  const formatCompilation = useMemo(
    () => compileFormatPresentationPrefix({
      gameId: game.id,
      gameKernel: game.gameKernel ?? game.watchState?.gameKernel ?? "classic",
      formatManifest: game.formatManifest,
      roster: formatRoster,
      decisions: formatPresentationDecisionsFromFrames(replayFrames),
      eligiblePlayerIdsByRound: formatPresentationEligibilityFromFrames(replayFrames),
    }),
    [
      formatRoster,
      game.gameKernel,
      game.formatManifest,
      game.id,
      game.watchState?.gameKernel,
      replayFrames,
    ],
  );
  const canonicalPresentationCues = useMemo(
    () => isFormatGame
      ? mergeFormatAndSocialCues(formatCompilation.cues, classicCues, scenes)
      : classicCues,
    [
      classicCues,
      formatCompilation.cues,
      isFormatGame,
      scenes,
    ],
  );
  const presentationCues = useMemo(() => paceVisualBallots(canonicalPresentationCues, players), [canonicalPresentationCues, players]);
  const {
    director,
    snapshot: directorSnapshot,
    scope: animationScope,
    reducedMotion,
  } = usePresentationDirector({ followTail: live });
  // Check if any per-message thinking exists (to decide whether to show toggle)
  const [activeEndgameScreen, setActiveEndgameScreen] = useState<EndgameScreenState | null>(null);
  const [activePhaseTransition, setActivePhaseTransition] = useState<TransitionState | null>(null);
  const resumeAfterTransitionRef = useRef(false);
  const seenEndgameStages = useRef<Set<string>>(new Set());
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectHydrationPendingRef = useRef(false);
  // Scroll ref for stacked diary/mingle content (INF-93)

  const fallbackCue = presentationCues[0] ?? null;
  const activeCue = director.getActiveCue() ?? fallbackCue;
  const classicCue = activeCue?.source === "classic" ? activeCue : null;
  const formatCue = activeCue?.source === "format" ? activeCue : null;
  const activeFormatIdForSocialScene = useMemo(() => {
    if (!classicCue) return null;
    return activeFormatIdForPresentationCursor(
      presentationCues,
      directorSnapshot.cursor,
      classicCue.round,
    );
  }, [classicCue, directorSnapshot.cursor, presentationCues]);
  const sceneIndex = classicCue?.sceneIndex ?? 0;
  const messageIndex = classicCue?.messageIndex ?? 0;
  const scene = classicCue
    ? scenes[classicCue.sceneIndex]
    : formatCue
      ? formatCueScene(formatCue)
      : undefined;
  const currentMessage = scene?.messages[messageIndex] ?? null;
  const visualData = useVisualWatch(game.id, game.visualMode === true, live);
  const [visualBeatChoice, setVisualBeatChoice] = useState<{ key: string | undefined; sceneAvailable: boolean }>({ key: undefined, sceneAvailable: false });
  const beatKey = activeCue?.key;
  const sceneAvailable = Boolean(currentMessage?.visualScene && visualData?.scenes.some((entry) => entry.id === currentMessage.visualScene?.id));
  const choice = visualBeatChoice.key === beatKey ? visualBeatChoice : { key: beatKey, sceneAvailable };
  if (visualBeatChoice.key !== beatKey) setVisualBeatChoice(choice);
  const visual = visualWatchPresentation(
    { enabled: true, status: null, portraits: {}, scenes: [], ...visualData }, activeCue,
    choice.sceneAvailable ? currentMessage : currentMessage ? { ...currentMessage, visualScene: undefined } : null, players,
  );
  const messagePhase = classicCue?.stage ?? "done";
  const isPlaying = directorSnapshot.isPlaying;
  const speed = directorSnapshot.speed;


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

  useEffect(() => {
    if (presentationCues.length === 0) return;
    if (
      live
      && (
        presentationHydrationStatus !== "ready"
        || reconnectHydrationPendingRef.current
      )
    ) {
      return;
    }
    if (live && directorSnapshot.cueKeys.length === 0) {
      const latest = presentationCues.at(-1);
      if (latest?.source === "classic" && !latest.liveCatchUp) {
        // A newly published first speech needs its full reading time. Historical
        // catch-up uses hydration so old introductions are not replayed.
        director.load(presentationCues);
        director.seek(presentationCues.length - 1);
      } else {
        director.reconnect(presentationCues);
      }
      director.play();
      return;
    }
    if (directorSnapshot.cueKeys.length === 0) {
      director.load(presentationCues);
      if (
        !live
        && startSequence !== undefined
        && !initialSequenceSeekAppliedRef.current
      ) {
        const seekIndex = findPresentationCueIndexForSequence(
          presentationCues,
          startSequence,
        );
        if (seekIndex > 0) director.seek(seekIndex);
        initialSequenceSeekAppliedRef.current = true;
      }
      director.play();
      return;
    }
    if (live) {
      director.append(presentationCues);
    } else {
      director.load(presentationCues);
    }
  }, [
    director,
    directorSnapshot.cueKeys.length,
    live,
    presentationCues,
    presentationHydrationStatus,
    startSequence,
  ]);

  useEffect(() => {
    if (!live) return;
    if (presentationHydrationStatus === "reconnecting") {
      reconnectHydrationPendingRef.current = true;
      return;
    }
    if (
      presentationHydrationStatus !== "ready"
      || !reconnectHydrationPendingRef.current
      || presentationCues.length === 0
    ) {
      return;
    }

    const shouldResume =
      directorSnapshot.isPlaying;
    reconnectHydrationPendingRef.current = false;
    director.reconnect(presentationCues);
    if (shouldResume) director.play();
  }, [
    director,
    directorSnapshot.isPlaying,
    live,
    presentationCues,
    presentationHydrationStatus,
  ]);

  const allVisibleMessages = useMemo(() => {
    const msgs: TranscriptEntry[] = [];
    const seenMessages = new Set<string>();
    const visibleCues = presentationCues.slice(0, directorSnapshot.cursor + 1);
    for (const cue of visibleCues) {
      if (cue.source !== "classic") continue;
      const message = scenes[cue.sceneIndex]?.messages[cue.messageIndex];
      if (!message || (isFormatGame && !isFormatSocialTranscriptMessage(message))) {
        continue;
      }
      const messageKey = `${cue.sceneIndex}:${cue.messageIndex}`;
      if (seenMessages.has(messageKey)) continue;
      seenMessages.add(messageKey);
      msgs.push(message);
    }
    return msgs;
  }, [directorSnapshot.cursor, isFormatGame, presentationCues, scenes]);

  const isTwoNamesPresentation = formatCue?.after.activeFormatId === "two_names";
  const usesFullHeightContent = formatCue?.kind === "two_names_plea" || visual.beat?.kind === "scene";

  const canonicalReplayFrame = useMemo(() => {
    if (!isFormatGame || replayFrames.length === 0) return null;
    const canonicalSequence = activeCue?.canonicalSequence;
    if (canonicalSequence === null || canonicalSequence === undefined) {
      return replayFrames[0] ?? null;
    }
    for (let index = replayFrames.length - 1; index >= 0; index -= 1) {
      const frame = replayFrames[index]!;
      if (frame.sequence <= canonicalSequence) return frame;
    }
    return replayFrames[0] ?? null;
  }, [activeCue?.canonicalSequence, isFormatGame, replayFrames]);

  // Classic replay retains its frozen transcript parser. Format replay status
  // comes only from the canonical replay-frame snapshot at the active cue.
  const eliminatedIds = useMemo(() => {
    if (isFormatGame) {
      return new Set(
        canonicalReplayFrame?.players
          .filter((player) => player.status === "eliminated")
          .map((player) => player.id) ?? [],
      );
    }
    const ids = new Set<string>();
    for (const msg of allVisibleMessages) {
      if (msg.scope === "system" && (msg.text.includes("ELIMINATED:") || msg.text.includes("AUTO-ELIMINATE:"))) {
        const player = players.find((p) => msg.text.includes(p.name));
        if (player) ids.add(player.id);
      }
    }
    return ids;
  }, [allVisibleMessages, canonicalReplayFrame, isFormatGame, players]);
  const aliveCount = isFormatGame && canonicalReplayFrame
    ? canonicalReplayFrame.counts.alivePlayers
    : players.length - eliminatedIds.size;

  // Build players with correct alive/eliminated status for current replay position
  const replayPlayers = useMemo(
    () => buildReplayPlayersForCue({
      players,
      isFormatGame,
      canonicalFrame: canonicalReplayFrame,
      classicEliminatedIds: eliminatedIds,
      live,
    }),
    [canonicalReplayFrame, eliminatedIds, isFormatGame, players, live],
  );

  useEffect(() => {
    if (!scene || !onPlaybackStateChange) return;
    onPlaybackStateChange({
      round: scene.round,
      phase: scene.phase,
      canonicalSequence: activeCue?.canonicalSequence ?? null,
      players: replayPlayers,
      visibleMessages: allVisibleMessages,
    });
  }, [activeCue?.canonicalSequence, allVisibleMessages, onPlaybackStateChange, replayPlayers, scene]);

  // Detect scene transitions
  const prevScene = sceneIndex > 0 ? scenes[sceneIndex - 1] : null;
  const isNewRound = scene && prevScene && scene.round !== prevScene.round;
  const isRoomChange = scene && prevScene && scene.roomType !== prevScene.roomType;
  // Phase transition overlay on room type changes
  const replayTransitionHoldMs =
    prevScene && PACED_PHASES.has(prevScene.phase) ? 2000 + PHASE_END_PAUSE_MS / speed : 2000;

  useEffect(() => {
    if (isRoomChange && scene) {
      if (director.getSnapshot().isPlaying) {
        resumeAfterTransitionRef.current = true;
        director.pause();
      }
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

  const dismissPhaseTransition = useCallback(() => {
    setActivePhaseTransition(null);
    if (resumeAfterTransitionRef.current) {
      resumeAfterTransitionRef.current = false;
      director.play();
    }
  }, [director]);

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

  const advanceMessage = useCallback(() => {
    director.manualAdvance();
  }, [director]);

  const pausePresentation = useCallback(() => {
    // An explicit audience pause wins over automatic transition/reconnect resume.
    resumeAfterTransitionRef.current = false;
    director.pause();
  }, [director]);

  const goToNextScene = useCallback(() => {
    const nextIndex = findCueForAdjacentScene(
      presentationCues,
      directorSnapshot.cursor,
      1,
    );
    if (nextIndex !== null) director.seek(nextIndex);
  }, [director, directorSnapshot.cursor, presentationCues]);

  const goToEnd = useCallback(() => {
    if (presentationCues.length > 0) {
      pausePresentation();
      director.seek(presentationCues.length - 1);
    }
  }, [director, pausePresentation, presentationCues.length]);

  const goToBeginning = useCallback(() => {
    director.seek(0);
  }, [director]);

  const goToPrevScene = useCallback(() => {
    const previousIndex = findCueForAdjacentScene(
      presentationCues,
      directorSnapshot.cursor,
      -1,
    );
    if (previousIndex !== null) director.seek(previousIndex);
  }, [director, directorSnapshot.cursor, presentationCues]);

  // Reset auto-hide timer helper
  const resetControlsTimer = useCallback(() => {
    if (embedded) {
      setControlsVisible(true);
      return;
    }
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  }, [embedded]);

  // Click/tap handler — if controls are hidden, show them first (don't advance).
  // If controls are already visible, advance the message.
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (shouldSuppressDramaticAdvance(e.target)) return;
    if (!controlsVisible && isPlaying) {
      setControlsVisible(true);
      resetControlsTimer();
      return;
    }
    advanceMessage();
  }, [advanceMessage, controlsVisible, isPlaying, resetControlsTimer]);

  // Auto-hide controls (mouse for desktop)
  const handleMouseMove = useCallback(() => {
    if (embedded) return;
    setControlsVisible(true);
    resetControlsTimer();
  }, [embedded, resetControlsTimer]);

  // Auto-hide controls (touch for mobile)
  const handleTouchStart = useCallback(() => {
    if (embedded) return;
    if (controlsVisible) {
      resetControlsTimer();
    }
  }, [controlsVisible, embedded, resetControlsTimer]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (activePhaseTransition || activeEndgameScreen) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          if (isPlaying) pausePresentation();
          else director.play();
          break;
        case "ArrowRight":
        case "Enter":
          e.preventDefault();
          advanceMessage();
          break;
        case "ArrowLeft":
          e.preventDefault();
          director.seek(directorSnapshot.cursor - 1);
          break;
        case "]":
          e.preventDefault();
          goToNextScene();
          break;
        case "[":
          e.preventDefault();
          director.seek(findPreviousRoundCue(presentationCues, directorSnapshot.cursor));
          break;
        case "1": director.setSpeed(0.5); break;
        case "2": director.setSpeed(1); break;
        case "3": director.setSpeed(2); break;
        case "4": director.setSpeed(4); break;
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    advanceMessage,
    activeEndgameScreen,
    activePhaseTransition,
    director,
    directorSnapshot.cursor,
    goToNextScene,
    isPlaying,
    pausePresentation,
    presentationCues,
  ]);

  const formatCompilationNotice =
    isFormatGame && formatCompilation.status === "incomplete" ? (
      <div
        data-format-presentation="incomplete"
        role="status"
        className="rounded-lg border border-amber-200/15 bg-amber-200/[0.04] px-3 py-2 text-xs text-amber-100/75"
      >
        <span className="font-semibold text-amber-100">
          Presentation incomplete.
        </span>{" "}
        {formatCompilation.diagnostic?.message
          ?? "The last trustworthy format state remains visible."}
      </div>
    ) : null;

  if (!scene || presentationCues.length === 0) {
    return (
      <div
        ref={animationScope}
        data-presentation-animation-boundary="true"
        data-reduced-motion={reducedMotion ? "reduce" : "no-preference"}
        className={`${embedded ? "relative h-full min-h-[24rem]" : "fixed inset-0"} bg-black flex flex-col items-center justify-center gap-4`}
      >
        {formatCompilationNotice}
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


  return (
    <div
      ref={animationScope}
      data-presentation-animation-boundary="true"
      data-reduced-motion={reducedMotion ? "reduce" : "no-preference"}
      className={`flex flex-col cursor-pointer select-none ${
        embedded
          ? "relative h-full min-h-0 overflow-hidden"
          : "fixed inset-0 z-30 influence-shell"
      }`}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onTouchStart={handleTouchStart}
    >
      {!embedded && (
        <>
          <div className="influence-phase-atmosphere" />
          <div className="influence-phase-vignette" />
          {ENDGAME_PHASES.has(scene.phase) && <div className="influence-endgame-atmosphere" />}
        </>
      )}

      {/* Overlays */}
      {activePhaseTransition && (
        <PhaseTransitionOverlay
          transition={activePhaseTransition}
          onDismiss={dismissPhaseTransition}
          holdMs={replayTransitionHoldMs}
        />
      )}
      {activeEndgameScreen && (
        <EndgameEntryScreen
          endgame={activeEndgameScreen}
          onDismiss={() => setActiveEndgameScreen(null)}
        />
      )}
      {/* Exit button — top-left, auto-hides with controls */}
      {!embedded && (
        <button
          type="button"
          data-replay-controls
          onClick={(e) => {
            e.stopPropagation();
            window.history.back();
          }}
          className={`fixed top-[max(1rem,env(safe-area-inset-top))] left-4 z-[70] w-9 h-9 flex items-center justify-center rounded-full border border-white/10 bg-black/50 text-white/50 hover:text-white hover:border-white/25 transition-all duration-500 ${
            controlsVisible || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          title="Exit"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 1l12 12M13 1L1 13" />
          </svg>
        </button>
      )}

      {/* Top bar — phase context */}
      {!embedded && (
        <div className={`flex-shrink-0 px-4 md:px-6 pt-4 md:pt-5 pb-2 md:pb-3 flex items-center justify-between z-[60] pointer-events-none transition-opacity duration-500 ${
          controlsVisible || !isPlaying ? "opacity-100" : "opacity-0"
        }`}>
          <div className="flex items-center gap-2 md:gap-3 pl-10 min-w-0">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ROOM_TYPE_COLORS[scene.roomType]}`} />
            <span className={`text-xs font-semibold uppercase tracking-[0.25em] ${phaseColor(scene.phase)} truncate`}>
              {PHASE_TRANSITION_LABELS[scene.phase] ?? scene.phase}
            </span>
            {roomLabel && (
              <span className="text-xs text-purple-300/50 hidden md:inline">{roomLabel}</span>
            )}
            {isNewRound && (
              <span className="text-xs text-white/25 uppercase tracking-wider hidden md:inline">
                Round {scene.round}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
            {/* Compact mobile HUD: round + player counts */}
            <span className="text-[10px] text-white/30 md:hidden">
              R{scene.round} · {aliveCount} alive
            </span>
            <ConnectionBadge status={connStatus ?? "replay"} />
          </div>
        </div>
      )}

      {/* Game state HUD — top-right corner, auto-hides with controls, hidden on mobile */}
      {!embedded && (
        <div
          data-replay-controls
          className={`fixed top-14 right-4 z-[60] transition-opacity duration-500 hidden md:block ${
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
      )}

      {/* Scene progress bar */}
      <div className="shrink-0 px-6 z-[60]">
        <div className="flex h-0.5 rounded-full overflow-hidden bg-white/5 gap-px">
          {presentationCues.map((cue, i) => (
            <div
              key={cue.key}
              className={`flex-1 min-w-[2px] ${
                cue.source === "classic"
                  ? ROOM_TYPE_COLORS[scenes[cue.sceneIndex]?.roomType ?? "lobby"]
                  : ROOM_TYPE_COLORS.tribunal
              } ${
                i <= directorSnapshot.cursor ? "opacity-80" : "opacity-10"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Center — phase-aware content (scrolls; scrub controls stay pinned below) */}
      <div
        className={`flex-1 min-h-0 flex ${
          usesFullHeightContent
            ? "items-stretch overflow-hidden"
            : "items-start overflow-y-auto overscroll-y-contain"
        } justify-center ${isTwoNamesPresentation ? "p-3" : "px-4 md:px-8 py-4 md:py-8"}`}
      >
        <div className={`w-full min-h-0 ${!usesFullHeightContent ? "my-auto" : ""} ${usesFullHeightContent ? "flex h-full flex-col" : ""} ${visual.beat?.kind === "scene" ? "max-w-7xl" : "max-w-3xl"}`}>
          {formatCompilationNotice ? (
            <div className="mb-3 shrink-0">{formatCompilationNotice}</div>
          ) : null}
          {activeFormatIdForSocialScene ? (
            <div className="mb-3 flex shrink-0 justify-center">
              <ActiveFormatLabel formatId={activeFormatIdForSocialScene} />
            </div>
          ) : null}
          {visual?.beat ? <VisualPresentation director={director} beat={visual.beat} rooms={visual.rooms} reducedMotion={reducedMotion} status={visualData?.status} /> : <>
          {formatCue && (
            <div className={`min-h-0 flex-1 ${formatCue.kind === "two_names_plea" ? "h-full" : ""}`}>
              <FormatPresentation
                cue={formatCue}
                roster={formatRoster}
                currentStateEntry={Boolean(
                  live
                  && directorSnapshot.hydrationWatermark !== null
                  && formatCue.canonicalSequence
                    <= directorSnapshot.hydrationWatermark,
                )}
              />
            </div>
          )}

          </>}
          {/* Paused indicator */}
          {!formatCue
            && !isPlaying
            && messagePhase === "done"
            && (
            <p className="text-center text-xs text-white/15 mt-8 animate-pulse">
              Click or press → to advance
            </p>
          )}

        </div>
      </div>

      {live && directorSnapshot.waitingAtTail && (
        <div role="status" className="shrink-0 py-3 text-center text-xs text-white/40">Waiting for messages…</div>
      )}

      {/* Bottom scrub controls — pinned under the scrollable content region */}
      <div
        data-replay-controls
        className={`shrink-0 border-t border-white/5 bg-black/70 px-3 md:px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:py-4 transition-opacity duration-500 z-[60] backdrop-blur-sm ${
          controlsVisible || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Mobile: compact 2-row layout */}
        <div className="md:hidden flex flex-col gap-2 max-w-sm mx-auto">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label={isPlaying ? "Pause replay" : "Play replay"}
              onClick={(e) => {
                e.stopPropagation();
                if (isPlaying) pausePresentation();
                else director.play();
              }}
              className="text-xs text-white/50 hover:text-white transition-colors px-3 py-2 rounded-lg border border-white/10 active:border-white/30"
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Go to replay start"
                onClick={(e) => { e.stopPropagation(); goToBeginning(); }}
                disabled={directorSnapshot.cursor === 0}
                className="text-xs text-white/40 active:text-white transition-colors px-2.5 py-2 rounded-lg border border-white/10 disabled:opacity-20"
              >
                ⏮
              </button>
              <button
                type="button"
                aria-label="Previous scene"
                onClick={(e) => { e.stopPropagation(); goToPrevScene(); }}
                disabled={directorSnapshot.cursor === 0}
                className="text-xs text-white/40 active:text-white transition-colors px-2.5 py-2 rounded-lg border border-white/10 disabled:opacity-20"
              >
                ◀◀
              </button>
              <span className="text-[10px] text-white/20 px-1 min-w-[3rem] text-center">
                {directorSnapshot.cursor + 1}/{presentationCues.length}
              </span>
              <button
                type="button"
                aria-label="Next scene"
                onClick={(e) => { e.stopPropagation(); goToNextScene(); }}
                disabled={directorSnapshot.cursor >= presentationCues.length - 1}
                className="text-xs text-white/40 active:text-white transition-colors px-2.5 py-2 rounded-lg border border-white/10 disabled:opacity-20"
              >
                ▶▶
              </button>
              <button
                type="button"
                aria-label="Go to replay end"
                onClick={(e) => { e.stopPropagation(); goToEnd(); }}
                className="text-xs text-white/40 active:text-white transition-colors px-2.5 py-2 rounded-lg border border-white/10"
              >
                ⏭
              </button>
            </div>
            <div className="flex items-center gap-0.5">
              {SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    director.setSpeed(opt.value);
                  }}
                  className={`text-[10px] px-1.5 py-1.5 rounded transition-colors ${
                    speed === opt.value
                      ? "bg-white/10 text-white border border-white/20"
                      : "text-white/25 border border-transparent"
                  }`}
                >
                  {opt.label}
                </button>
              ))}

            </div>
          </div>
        </div>

        {/* Desktop: single-row layout */}
        <div className="hidden md:flex items-center justify-between max-w-3xl mx-auto">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (isPlaying) pausePresentation();
              else director.play();
            }}
            className="text-sm text-white/50 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20"
          >
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Go to replay start"
              onClick={(e) => { e.stopPropagation(); goToBeginning(); }}
              disabled={directorSnapshot.cursor === 0}
              className="text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              ⏮ Start
            </button>
            <button
              type="button"
              aria-label="Previous scene"
              onClick={(e) => { e.stopPropagation(); goToPrevScene(); }}
              disabled={directorSnapshot.cursor === 0}
              className="text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              ◀◀ Prev
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); goToNextScene(); }}
              disabled={directorSnapshot.cursor >= presentationCues.length - 1}
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
                onClick={(e) => {
                  e.stopPropagation();
                  director.setSpeed(opt.value);
                }}
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
        <p className="text-[10px] text-white/10 text-center mt-2 hidden md:block">
          Space: play/pause · Click/→: advance · ←: back · []: rounds · 1234: speed
        </p>
      </div>
    </div>
  );
}
