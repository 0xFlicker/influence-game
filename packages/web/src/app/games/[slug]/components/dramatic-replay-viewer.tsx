"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { FitPresentation } from "./fit-presentation";
import { usePlayerFullscreen } from "@/components/watch/use-player-fullscreen";
import {WatchThinking} from "@/components/watch/watch-thinking";
import type {ThinkingOrder} from "@/components/watch/watch-director";
import {getPublicWatchIntelligence} from "@/lib/api";
import { WatchTransport } from "@/components/watch/watch-transport";
import { useWatchKeyboard } from "@/components/watch/use-watch-keyboard";
import { VisualPresentation } from "./visual-presentation";
import { voteLedgerForCue, voteSceneIdentity } from "./vote-ledger-model";
import { useVisualWatch } from "./use-visual-watch";
import { visualWatchPresentation, paceVisualBallots, transcriptPresentationDurationMs, isSoloTranscript } from "./visual-watch-model";
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
  FormatPresentationCue,
  PresentationCue,
  ReplayScene,
} from "./types";
import {
  PHASE_TRANSITION_LABELS,
  phaseColor,
  phaseToRoomType,
  setPhaseAttr,
  setEndgameAttr,
  ENDGAME_PHASES,
  ROOM_TYPE_COLORS,
} from "./constants";
import { ConnectionBadge, GameStateHUD } from "./game-info";
import { buildStoryScenes, withHouseBridges } from "./house-story";
import { buildEndgamePresentationCues, revealedWinnerCue } from "./endgame-presentation";
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
import { usePresentationDirector } from "./influence-presentation-director";
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
  message: Pick<TranscriptEntry, "phase" | "presentationPurpose" | "dialogueKind">,
): boolean {
  return message.dialogueKind === "house_summary"
    || message.presentationPurpose === "farewell"
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

export function buildClassicPresentationCues(
  scenes: ReplayScene[],
  replayFrames: readonly GameWatchReplayFrame[],
  players: readonly GamePlayer[] = [],
): ClassicPresentationCue[] {
  const framesByRound = new Map<number, GameWatchReplayFrame[]>();
  for (const frame of replayFrames) {
    const roundFrames = framesByRound.get(frame.round) ?? [];
    roundFrames.push(frame);
    framesByRound.set(frame.round, roundFrames);
  }
  return scenes.flatMap((scene, sceneIndex) =>
    scene.messages.map((message, messageIndex) => ({
      source: "classic" as const,
      liveCatchUp: message.liveCatchUp,
      key: `classic:${message.entrySequence ?? message.id}:done`,
      houseSummary: message.dialogueKind === "house_summary",
      canonicalSequence: message.firstDurableEventSequence ?? latestFrameSequenceAtOrBefore(
        framesByRound.get(scene.round) ?? [], message.timestamp,
      ),
      round: scene.round,
      phase: scene.phase,
      kind: "classic_transcript" as const,
      stage: "done" as const,
      baseDurationMs: transcriptPresentationDurationMs(message, players),
      speechPresentation: isSoloTranscript(message) ? "solo" as const
        : message.anonymous || message.speakerPlayerId || message.fromPlayerId ? "scene" as const : undefined,
      sceneIndex,
      messageIndex,
    })),
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
  if (left.source !== right.source) {
    // Summaries sharing a commit with a result follow every reveal stage.
    if (left.source === "classic") return left.houseSummary ? 1 : -1;
    if (right.source === "classic") return right.houseSummary ? -1 : 1;
    return left.source === "house" ? -1 : 1;
  }
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
  scenes: ReplayScene[],
): PresentationCue[] {
  const socialCues = classicCues.filter((cue) => {
    const message = scenes[cue.sceneIndex]?.messages[cue.messageIndex];
    return message ? isFormatSocialTranscriptMessage(message) : false;
  });
  return [...socialCues, ...formatCues].sort(comparePresentationCues);
}

function formatCueScene(cue: Exclude<PresentationCue, ClassicPresentationCue>): ReplayScene {
  return {
    id: cue.key,
    round: cue.round,
    phase: cue.phase,
    roomType: phaseToRoomType(cue.phase),
    messages: [],
  };
}

export function findCueForAdjacentScene(
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
  return voteSceneIdentity(cue) ?? (cue.source === "classic"
    ? `classic:${cue.sceneIndex}`
    : cue.key);
}

export function formatSnapshotForPresentationCursor(
  cues: readonly PresentationCue[],
  cursor: number,
  round: number,
) {
  for (let index = Math.min(cursor, cues.length - 1); index >= 0; index -= 1) {
    const cue = cues[index]!;
    if (cue.round !== round) continue;
    if (cue.source === "format") {
      return cue.after;
    }
  }
  return null;
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
  const scenes = useMemo(() => buildStoryScenes(filteredMessages), [filteredMessages]);
  const classicCues = useMemo(
    () => buildClassicPresentationCues(scenes, replayFrames, players),
    [replayFrames, scenes, players],
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
    () => [...(isFormatGame
      ? mergeFormatAndSocialCues(formatCompilation.cues, classicCues, scenes)
      : classicCues), ...buildEndgamePresentationCues(replayFrames)].sort(comparePresentationCues),
    [
      classicCues,
      formatCompilation.cues,
      isFormatGame,
      scenes,
      replayFrames,
    ],
  );
  const presentationCues = useMemo(() => withHouseBridges(paceVisualBallots(canonicalPresentationCues, players), scenes), [canonicalPresentationCues, players, scenes]);
  const {
    director,
    snapshot: directorSnapshot,
    scope: animationScope,
    reducedMotion,
  } = usePresentationDirector({ followTail: live });
  const { fullscreen, button: fullscreenButton, error: fullscreenError, toggle: toggleFullscreen } = usePlayerFullscreen(animationScope);
  const [showThinking, setShowThinking] = useState(false);
  const [thinkingOrder, setThinkingOrder] = useState<ThinkingOrder>("thinking-first");
  const controlsRef = useRef<HTMLDivElement>(null);
  const controlsHovered = useRef(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectHydrationPendingRef = useRef(false);
  // Scroll ref for stacked diary/mingle content (INF-93)

  const fallbackCue = presentationCues[0] ?? null;
  const activeCue = director.getActiveCue() ?? fallbackCue;
  const classicCue = activeCue?.source === "classic" ? activeCue : null;
  const formatCue = activeCue?.source === "format" ? activeCue : null;
  const presentedFormatSnapshot = useMemo(() => {
    if (!isFormatGame || !activeCue) return null;
    return formatSnapshotForPresentationCursor(
      presentationCues,
      directorSnapshot.cursor,
      activeCue.round,
    );
  }, [activeCue, isFormatGame, directorSnapshot.cursor, presentationCues]);
  const activeFormatIdForSocialScene = classicCue ? presentedFormatSnapshot?.activeFormatId ?? null : null;
  const messageIndex = classicCue?.messageIndex ?? 0;
  const scene = classicCue
    ? scenes[classicCue.sceneIndex]
    : activeCue && activeCue.source !== "classic"
      ? formatCueScene(activeCue)
      : undefined;
  const currentMessage = scene?.messages[messageIndex] ?? null;
  const visualData = useVisualWatch(game.id, true, live, activeCue?.key);
  const priorLobbyMessages = useMemo(() => !formatCue ? [] : classicCues
    .filter(cue => cue.round === formatCue.round && cue.phase === "LOBBY"
      && cue.canonicalSequence !== null && cue.canonicalSequence <= formatCue.canonicalSequence)
    .map(cue => scenes[cue.sceneIndex]!.messages[cue.messageIndex]!), [classicCues, formatCue, scenes]);
  const visual = visualWatchPresentation(
    visualData ?? { enabled: true, status: null, portraits: {}, scenes: [] }, revealedWinnerCue(presentationCues, directorSnapshot.cursor) ?? activeCue, currentMessage, players, priorLobbyMessages,
  );
  const thinkingActor = visual.beat && "speech" in visual.beat ? visual.beat.speech?.playerId : null;
  const thinkingSpeaker = players.find(player => player.id === thinkingActor)?.name ?? "Player";
  const thoughtSequence = activeCue?.canonicalSequence;
  const messageThought = currentMessage?.thinking;
  const messageId = currentMessage?.id;
  const entrySequence = currentMessage?.entrySequence;
  const thoughtRound = activeCue?.round, thoughtPhase = activeCue?.phase;
  const classicThought = activeCue?.source === "classic";
  const loadThinking = useCallback(async (signal: AbortSignal) => {
    if (!thinkingActor || thoughtRound === undefined || !thoughtPhase) return null;
    if (classicThought && messageThought) return messageThought;
    if (thoughtSequence == null) return null;
    const result = await getPublicWatchIntelligence(game.slug, {actorPlayerId:thinkingActor, round:thoughtRound, phase:thoughtPhase, throughEventSequence:thoughtSequence, throughTranscriptSequence:entrySequence ?? 0, limit:4}, signal);
    if (!result.ok) return null;
    return result.intelligence.thinking.cards.filter(card => card.actorPlayerId === thinkingActor && (classicThought ? card.id === `transcript:${messageId}` : card.eventSequence === thoughtSequence)).map(card => card.text).join("\n\n") || null;
  }, [game.slug, thinkingActor, thoughtSequence, thoughtRound, thoughtPhase, messageThought, messageId, entrySequence, classicThought]);
  const currentStateEntry = Boolean(live && formatCue && directorSnapshot.hydrationWatermark !== null
    && formatCue.canonicalSequence <= directorSnapshot.hydrationWatermark);
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
        director.load(presentationCues, presentationCues.length - 1);
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
  const usesFullHeightContent = fullscreen || formatCue?.kind === "two_names_plea" || visual.beat !== null;
  const isSoloPresentation = visual.beat?.kind === "portrait";
  const isRoomPresentation = visual.beat?.kind === "scene" || visual.beat?.kind === "portrait-room" || visual.beat?.kind === "safety-bounce" || visual.beat?.kind === "winner";

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
      formatSnapshot: presentedFormatSnapshot,
      players: replayPlayers,
      visibleMessages: allVisibleMessages,
    });
  }, [activeCue?.canonicalSequence, allVisibleMessages, onPlaybackStateChange, presentedFormatSnapshot, replayPlayers, scene]);

  const advanceMessage = useCallback(() => {
    director.manualAdvance();
  }, [director]);

  const stepBackOneCue = useCallback(() => {
    director.pause(); director.setFollowTail(false);
    director.seek(directorSnapshot.cursor - 1);
  }, [director, directorSnapshot.cursor]);

  const pausePresentation = useCallback(() => {
    director.pause();
  }, [director]);

  const goToNextScene = useCallback(() => {
    const nextIndex = findCueForAdjacentScene(
      presentationCues,
      directorSnapshot.cursor,
      1,
    );
    if (nextIndex !== null) {director.pause(); director.setFollowTail(false); director.seek(nextIndex);}
  }, [director, directorSnapshot.cursor, presentationCues]);

  const goToEnd = useCallback(() => {
    if (presentationCues.length > 0) {
      pausePresentation();
      director.setFollowTail(live);
      director.seek(presentationCues.length - 1);
      if (live) director.play();
    }
  }, [director, pausePresentation, presentationCues.length, live]);

  const goToBeginning = useCallback(() => {
    director.pause(); director.setFollowTail(false); director.seek(0);
  }, [director]);

  const goToPrevScene = useCallback(() => {
    const previousIndex = findCueForAdjacentScene(presentationCues, directorSnapshot.cursor, -1);
    if (previousIndex !== null) {director.pause(); director.setFollowTail(false); director.seek(previousIndex);}
  }, [director, directorSnapshot.cursor, presentationCues]);

  // Reset auto-hide timer helper
  const resetControlsTimer = useCallback(() => {
    if (embedded && !fullscreen) {
      setControlsVisible(true);
      return;
    }
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (!controlsHovered.current && !controlsRef.current?.contains(document.activeElement)) setControlsVisible(false);
    }, 3000);
  }, [embedded, fullscreen]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setControlsVisible(true);
      if (isPlaying) resetControlsTimer();
    });
    return () => { cancelAnimationFrame(frame); if (controlsTimer.current) clearTimeout(controlsTimer.current); };
  }, [fullscreen, isPlaying, resetControlsTimer]);

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
    if (embedded && !fullscreen) return;
    setControlsVisible(true);
    resetControlsTimer();
  }, [embedded, fullscreen, resetControlsTimer]);

  // Auto-hide controls (touch for mobile)
  const handleTouchStart = useCallback(() => {
    if (embedded && !fullscreen) return;
    if (controlsVisible) {
      resetControlsTimer();
    }
  }, [controlsVisible, embedded, fullscreen, resetControlsTimer]);

  useWatchKeyboard({
    toggle: () => { if (isPlaying) pausePresentation(); else director.play(); },
    advance: advanceMessage, back: stepBackOneCue,
    previousChapter: goToPrevScene,
    nextChapter: goToNextScene,
    speed: value => director.setSpeed(value),
    interact: () => { setControlsVisible(true); resetControlsTimer(); },
  });

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
      data-player-fullscreen={fullscreen || undefined}
      style={fullscreen ? { position: "fixed", inset: 0, width: "100vw", height: "100dvh", maxWidth: "none", maxHeight: "none", margin: 0, padding: 0, border: 0, zIndex: 1000, background: "black" } : undefined}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onTouchStart={handleTouchStart}
    >
      {!embedded && !fullscreen && (
        <>
          <div className="influence-phase-atmosphere" />
          <div className="influence-phase-vignette" />
          {ENDGAME_PHASES.has(scene.phase) && <div className="influence-endgame-atmosphere" />}
        </>
      )}

      {/* Exit button — top-left, auto-hides with controls */}
      {!embedded && !fullscreen && (
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
      {!embedded && !fullscreen && (
        <div className={`flex-shrink-0 px-4 md:px-6 pt-4 md:pt-5 pb-2 md:pb-3 flex items-center justify-between z-[60] pointer-events-none transition-opacity duration-500 ${
          controlsVisible || !isPlaying ? "opacity-100" : "opacity-0"
        }`}>
          <div className="flex items-center gap-2 md:gap-3 pl-10 min-w-0">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ROOM_TYPE_COLORS[scene.roomType]}`} />
            <span className={`text-xs font-semibold uppercase tracking-[0.25em] ${phaseColor(scene.phase)} truncate`}>
              {PHASE_TRANSITION_LABELS[scene.phase] ?? scene.phase}
            </span>
            {scene.round > 0 && (
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
      {!embedded && !fullscreen && (
        <div
          data-replay-controls
        ref={controlsRef}
        onFocusCapture={() => {controlsHovered.current = true;setControlsVisible(true);}}
        onBlurCapture={event => {if (!event.currentTarget.contains(event.relatedTarget)) controlsHovered.current = false;}}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") controlsHovered.current = true; }}
        onPointerLeave={() => { controlsHovered.current = false; resetControlsTimer(); }}
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
      <div className={`shrink-0 px-6 z-[60] ${fullscreen ? "hidden" : ""}`}>
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
        className={`relative flex-1 min-h-0 flex flex-col ${
          usesFullHeightContent
            ? "items-stretch overflow-hidden"
            : "items-start overflow-y-auto overscroll-y-contain"
        } justify-center ${fullscreen ? isRoomPresentation || isSoloPresentation ? "pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]" : "pb-[140px] pt-[env(safe-area-inset-top)]" : isSoloPresentation || isRoomPresentation ? "" : isTwoNamesPresentation ? "p-3" : "px-4 md:px-8 py-4 md:py-8"}`}
      >
        <WatchThinking director={director} cueKey={activeCue?.key ?? null} enabled={showThinking} order={thinkingOrder} speaker={thinkingSpeaker} load={loadThinking}>
        <div className={`w-full min-h-0 ${!usesFullHeightContent ? "my-auto" : ""} ${usesFullHeightContent ? "flex flex-1 flex-col" : ""} ${fullscreen || isSoloPresentation || isRoomPresentation ? "" : "max-w-3xl"}`}>
          {formatCompilationNotice ? (
            <div className="mb-3 shrink-0">{formatCompilationNotice}</div>
          ) : null}
          {visual?.beat ? <VisualPresentation fullscreen={fullscreen} director={director} retainTail={!live} currentStateEntry={currentStateEntry} beat={visual.beat} rooms={visual.rooms} reducedMotion={reducedMotion}
            voteLedger={voteLedgerForCue(presentationCues, directorSnapshot.cursor)} roster={formatRoster.map(player => ({ ...player, avatarUrl: visualData?.portraits[player.id] ?? player.avatarUrl }))} /> : <>
          {formatCue && (
            <div className={`min-h-0 flex-1 ${formatCue.kind === "two_names_plea" ? "h-full" : ""}`}>
              <FitPresentation enabled={fullscreen}><FormatPresentation
                cue={formatCue}
                roster={formatRoster}
                currentStateEntry={Boolean(
                  live
                  && directorSnapshot.hydrationWatermark !== null
                  && formatCue.canonicalSequence
                    <= directorSnapshot.hydrationWatermark,
                )}
              /></FitPresentation>
            </div>
          )}

          </>}

        </div>
        </WatchThinking>
      </div>

      {live && !fullscreen && directorSnapshot.waitingAtTail && (
        <div role="status" className="shrink-0 py-3 text-center text-xs text-white/40">Waiting for messages…</div>
      )}

      {/* Bottom scrub controls — pinned under the scrollable content region */}
      <div
        data-replay-controls
        ref={controlsRef}
        onFocusCapture={() => {controlsHovered.current = true;setControlsVisible(true);}}
        onBlurCapture={event => {if (!event.currentTarget.contains(event.relatedTarget)) controlsHovered.current = false;}}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") controlsHovered.current = true; }}
        onPointerLeave={() => { controlsHovered.current = false; resetControlsTimer(); }}
        className={`${fullscreen ? "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/85 to-transparent" : "shrink-0 border-t border-white/5 bg-black/70"} px-3 md:px-6 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:py-4 transition-opacity duration-500 z-[60] backdrop-blur-sm ${
          controlsVisible || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <WatchTransport fullscreen={fullscreen} fullscreenButton={fullscreenButton} toggleFullscreen={toggleFullscreen} fullscreenError={fullscreenError}
          header={activeFormatIdForSocialScene ? <div className="mb-3 flex justify-center"><ActiveFormatLabel formatId={activeFormatIdForSocialScene} /></div> : null}
          isPlaying={isPlaying} togglePlay={() => { if (isPlaying) pausePresentation(); else director.play(); }} speed={speed} onSpeed={value => director.setSpeed(value)}
          goToBeginning={goToBeginning} goToPrevScene={goToPrevScene} stepBackOneCue={stepBackOneCue} advanceMessage={advanceMessage} goToNextScene={goToNextScene} goToEnd={goToEnd}
          live={live} cursor={directorSnapshot.cursor} count={presentationCues.length}
          settings={<div className="space-y-3"><label className="flex gap-2"><input type="checkbox" checked={showThinking} onChange={event => setShowThinking(event.target.checked)} />Show thinking in scene</label><label className="grid gap-2">Thinking order<select className="rounded border border-white/30 bg-zinc-900 p-2" value={thinkingOrder} onChange={event => setThinkingOrder(event.target.value as ThinkingOrder)}><option value="thinking-first">Thinking first</option><option value="speech-first">Speech first</option></select></label></div>} />
      </div>
    </div>
  );
}
