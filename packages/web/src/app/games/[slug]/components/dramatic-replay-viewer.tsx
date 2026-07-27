"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { MotionConfig } from "motion/react";
import type {
  TranscriptEntry,
  GamePlayer,
  GameDetail,
  GameWatchReplayFrame,
  PhaseKey,
} from "@/lib/api";
import { GamePlayerAvatarPreview } from "@/components/game-player-avatar-preview";
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
  DIARY_WHISPER_SCENE_END_HOLD_MS,
  PACED_PHASES,
  PHASE_END_PAUSE_MS,
} from "./constants";
import { PhaseEndingCue } from "./phase-ending-cue";
import { ConnectionBadge, GameStateHUD } from "./game-info";
import { PhaseTransitionOverlay } from "./phase-transition";
import { EndgameEntryScreen } from "./endgame-entry";
import { GroupChatFeed, JuryDMView } from "./chat-feeds";
import { OpenWhisperRoomsView, WhisperRoomDM, WhisperAllocationOverview, buildWhisperStageData } from "./whisper-phase";
import { buildDiaryRooms, DiaryRoomChat } from "./diary-room";
import type { WhisperRoomStage } from "./types";
import { VoteTallyOverlay, SpectacleMessageContent } from "./vote-display";
import { buildReplayScenes } from "./spectacle-viewer";
import { shouldSuppressDramaticAdvance } from "./dramatic-interaction";
import { getHouseSummaryExtraHoldMs, getJuryClosingStatementsExtraHoldMs, getJuryOpeningStatementsExtraHoldMs, getJuryQuestionsExtraHoldMs } from "./dramatic-timing";
import {
  MATCH_WATCH_FORMAT_PHASES,
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

function isRoomReplayPhase(phase: string): boolean {
  return phase === "MINGLE_I" || phase === "MINGLE" || phase === "POST_VOTE_MINGLE";
}

const FORMAT_AUTHORITY_TRANSCRIPT_PHASES: ReadonlySet<PhaseKey> = new Set([
  "VOTE",
  "FORMAT_MENU",
  "FORMAT_PICK",
  "FORMAT_RESOLVE",
]);

export function isFormatSocialTranscriptMessage(
  message: Pick<TranscriptEntry, "phase">,
): boolean {
  return !FORMAT_AUTHORITY_TRANSCRIPT_PHASES.has(message.phase);
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
      const isLastInScene = messageIndex === scene.messages.length - 1;
      const isChatStyle =
        CHAT_FEED_PHASES.has(scene.phase)
        || isRoomReplayPhase(scene.phase)
        || scene.phase === "DIARY_ROOM"
        || scene.phase === "JURY_QUESTIONS";
      const typingMs = message.scope === "system" || !message.fromPlayerId
        ? 0
        : isChatStyle
          ? CHAT_TYPING_HOLD_MS
          : TYPING_HOLD_MS * (
              DRAMATIC_PHASES.has(scene.phase) ? DRAMATIC_PHASE_MULTIPLIER : 1
            );
      const extraHoldMs =
        getHouseSummaryExtraHoldMs(message, scene.messages, messageIndex)
        + getJuryOpeningStatementsExtraHoldMs(message, scene.messages, messageIndex)
        + getJuryQuestionsExtraHoldMs(message, scene.messages, messageIndex)
        + getJuryClosingStatementsExtraHoldMs(message, scene.messages, messageIndex);
      const holdMs = isLastInScene
        ? (
            isRoomReplayPhase(scene.phase) || scene.phase === "DIARY_ROOM"
              ? DIARY_WHISPER_SCENE_END_HOLD_MS
              : INTER_SCENE_PAUSE_MS
          ) + (PACED_PHASES.has(scene.phase) ? PHASE_END_PAUSE_MS : 0)
        : isChatStyle
          ? Math.max(CHAT_POST_MSG_BASE_MS, message.text.length * CHAT_POST_MSG_PER_CHAR_MS)
          : Math.max(POST_REVEAL_BASE_MS, message.text.length * POST_REVEAL_PER_CHAR_MS)
            * (DRAMATIC_PHASES.has(scene.phase) ? DRAMATIC_PHASE_MULTIPLIER : 1);
      const canonicalSequence = latestFrameSequenceAtOrBefore(
        framesByRound.get(scene.round) ?? [],
        message.timestamp,
      );

      const stages: Array<{
        stage: ClassicPresentationCue["stage"];
        durationMs: number;
      }> = [];
      if (typingMs > 0) {
        stages.push({ stage: "typing", durationMs: typingMs });
      }
      if (!isChatStyle) {
        stages.push({
          stage: "revealing",
          durationMs: Math.max(600, message.text.length * 18),
        });
      }
      stages.push({ stage: "done", durationMs: holdMs + extraHoldMs });

      return stages.map(({ stage, durationMs }) => ({
        source: "classic" as const,
        key: `classic:${scene.id}:${messageIndex}:${message.id}:${stage}`,
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

function mergeFormatAndSocialCues(
  formatCues: readonly FormatPresentationCue[],
  classicCues: readonly ClassicPresentationCue[],
  scenes: ReturnType<typeof buildReplayScenes>,
): PresentationCue[] {
  const socialCues = classicCues.filter((cue) => {
    const message = scenes[cue.sceneIndex]?.messages[cue.messageIndex];
    return message ? isFormatSocialTranscriptMessage(message) : false;
  });
  return [...socialCues, ...formatCues].sort((left, right) => {
    if (left.round !== right.round) return left.round - right.round;
    const phaseDifference =
      MATCH_WATCH_FORMAT_PHASES.indexOf(left.phase)
      - MATCH_WATCH_FORMAT_PHASES.indexOf(right.phase);
    if (phaseDifference !== 0) return phaseDifference;
    if (left.source !== right.source) return left.source === "classic" ? -1 : 1;
    if (left.source === "format" && right.source === "format") {
      return left.canonicalSequence - right.canonicalSequence;
    }
    if (left.source === "classic" && right.source === "classic") {
      return left.sceneIndex - right.sceneIndex || left.messageIndex - right.messageIndex;
    }
    return 0;
  });
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
  onPlaybackStateChange,
}: DramaticReplayViewerProps) {
  const [showThinking, setShowThinking] = useState(!live); // default true for replay
  // Backward compat: always filter out old scope='thinking' entries (they lack per-message association)
  const filteredMessages = useMemo(
    () => messages.filter((m) => m.scope !== "thinking"),
    [messages],
  );
  const isFormatGame =
    (game.gameKernel ?? game.watchState?.gameKernel) === "format";
  const formatRoster = useMemo(
    () => players.map((player) => ({ id: player.id, name: player.name })),
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
      roster: formatRoster,
      decisions: formatPresentationDecisionsFromFrames(replayFrames),
      eligiblePlayerIdsByRound: formatPresentationEligibilityFromFrames(replayFrames),
    }),
    [
      formatRoster,
      game.gameKernel,
      game.id,
      game.watchState?.gameKernel,
      replayFrames,
    ],
  );
  const presentationCues = useMemo(
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
  const {
    director,
    snapshot: directorSnapshot,
    scope: animationScope,
    reducedMotion,
  } = usePresentationDirector({ followTail: live });
  // Check if any per-message thinking exists (to decide whether to show toggle)
  const hasThinkingMessages = useMemo(() => messages.some((m) => m.thinking), [messages]);
  const [activeEndgameScreen, setActiveEndgameScreen] = useState<EndgameScreenState | null>(null);
  const [activePhaseTransition, setActivePhaseTransition] = useState<TransitionState | null>(null);
  const resumeAfterTransitionRef = useRef(false);
  const seenEndgameStages = useRef<Set<string>>(new Set());
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectHydrationPendingRef = useRef(false);
  // Scroll ref for stacked diary/mingle content (INF-93)
  const stackedScrollRef = useRef<HTMLDivElement>(null);

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
  const totalScenes = scenes.length;
  const currentMessage = scene?.messages[messageIndex] ?? null;
  const messagePhase = classicCue?.stage ?? "done";
  const isPlaying = directorSnapshot.isPlaying;
  const speed = directorSnapshot.speed;
  const showPhaseEndingCue = Boolean(
    classicCue?.stage === "done"
    && scene
    && messageIndex === scene.messages.length - 1
    && PACED_PHASES.has(scene.phase),
  );
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

  useEffect(() => {
    if (presentationCues.length === 0) return;
    if (live && directorSnapshot.cueKeys.length === 0) {
      director.reconnect(presentationCues);
      director.play();
      return;
    }
    if (directorSnapshot.cueKeys.length === 0) {
      director.load(presentationCues);
      director.play();
      return;
    }
    if (live) {
      director.append(presentationCues);
    } else {
      director.load(presentationCues);
    }
  }, [director, directorSnapshot.cueKeys.length, live, presentationCues]);

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

    const shouldResume = directorSnapshot.isPlaying;
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

  // Resolve current speaker (anonymous for RUMOR phase)
  const isCurrentRumor = currentMessage?.phase === "RUMOR" && currentMessage?.scope === "public";
  const currentPlayer = isCurrentRumor ? null : (currentMessage?.fromPlayerId
    ? players.find((p) => p.id === currentMessage.fromPlayerId)
      ?? players.find((p) => p.name === currentMessage.fromPlayerId)
    : null);
  const currentPlayerName = isCurrentRumor
    ? "Anonymous"
    : (currentMessage?.fromPlayerName ?? currentPlayer?.name ?? currentMessage?.fromPlayerId ?? "The House");

  // All messages visible up to current point
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

  // Determine rendering mode for current scene
  // Thinking-only scenes (from MINGLE/DIARY phases) should render as a chat feed,
  // not through mingle/diary-specific paths that expect room data.
  const isThinkingOnlyScene = !!scene && scene.messages.length > 0 && scene.messages.every((m) => m.scope === "thinking");
  const isChatFeedScene = !!scene && (CHAT_FEED_PHASES.has(scene.phase) || isThinkingOnlyScene);
  const isWhisperScene = !!scene && isRoomReplayPhase(scene.phase) && !scene.isOverview && !isThinkingOnlyScene;
  const isOpenWhisperScene = !!scene && isRoomReplayPhase(scene.phase) && scene.messages.some((m) => (m.roomMetadata?.rooms.length ?? 0) > 0);
  const isDiaryScene = !!scene && scene.phase === "DIARY_ROOM" && !isThinkingOnlyScene;
  const isOverviewScene = !!scene && !!scene.isOverview;
  const isJuryScene = !!scene && scene.phase === "JURY_QUESTIONS" && !isThinkingOnlyScene;
  const isChatStyleScene = isChatFeedScene || isWhisperScene || isDiaryScene || isJuryScene;
  const usesFullHeightContent = isChatStyleScene || isOverviewScene || isOpenWhisperScene;

  // Messages visible in current scene's chat feed (for chat-style phases)
  const chatFeedMessages = useMemo(() => {
    if (!scene || !isChatStyleScene) return [];
    // During typing phase, show messages up to (but not including) current
    // During revealing/done, include current message
    const endIdx = messagePhase === "typing" ? messageIndex : messageIndex + 1;
    return scene.messages.slice(0, endIdx);
  }, [scene, isChatStyleScene, messageIndex, messagePhase]);

  const openWhisperMessages = useMemo(() => {
    if (!scene || !isOpenWhisperScene) return [];
    const fallbackMetadata = scene.messages.filter((m) => m.roomMetadata).slice(0, 1);
    return chatFeedMessages.some((m) => m.roomMetadata)
      ? chatFeedMessages
      : [...chatFeedMessages, ...fallbackMetadata];
  }, [chatFeedMessages, isOpenWhisperScene, scene]);

  // For per-room mingle scenes: build a WhisperRoomStage for single-room rendering
  const whisperRoom = useMemo((): WhisperRoomStage | null => {
    if (!scene || !scene.whisperRoom || !isWhisperScene) return null;
    const endIdx = messagePhase === "typing" ? messageIndex : messageIndex + 1;
    return {
      roomId: scene.whisperRoom.roomId,
      playerIds: scene.whisperRoom.playerNames, // names used as IDs (engine convention)
      playerNames: scene.whisperRoom.playerNames,
      messages: scene.messages.slice(0, endIdx),
    };
  }, [scene, isWhisperScene, messageIndex, messagePhase]);

  // For overview scenes: build full mingle stage data for rich allocation display
  const overviewStageData = useMemo(() => {
    if (!scene || !isOverviewScene) return null;
    // Gather all room-phase entries from this round to parse allocation.
    const mingleEntries = messages.filter(
      (m) => isRoomReplayPhase(m.phase) && m.round === scene.round,
    );
    return buildWhisperStageData(mingleEntries, players);
  }, [scene, isOverviewScene, messages, players]);

  // Rumor messages for current round (for vote reveal — show voter's rumor alongside vote)
  const rumorMessages = useMemo(() => {
    if (!scene) return [];
    return allVisibleMessages.filter(m => m.round === scene.round && m.phase === "RUMOR" && m.scope === "public");
  }, [allVisibleMessages, scene]);

  // Track eliminated players from visible messages
  const eliminatedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const msg of allVisibleMessages) {
      if (msg.scope === "system" && (msg.text.includes("ELIMINATED:") || msg.text.includes("AUTO-ELIMINATE:"))) {
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
      shielded: live ? p.shielded : false,
    })),
  [players, eliminatedIds, live]);

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

  // For per-player diary scenes: build a DiaryRoomData for single-player rendering
  const diaryRoomData = useMemo(() => {
    if (!scene || !isDiaryScene) return null;
    const endIdx = messagePhase === "typing" ? messageIndex : messageIndex + 1;
    const visibleMsgs = scene.messages.slice(0, endIdx);
    const rooms = buildDiaryRooms(visibleMsgs, replayPlayers);
    return rooms[0] ?? null;
  }, [scene, isDiaryScene, messageIndex, messagePhase, replayPlayers]);

  // Stacked diary rooms: completed diary scenes from the same round (INF-93)
  const previousDiaryRooms = useMemo(() => {
    if (!scene || !isDiaryScene) return [];
    const rooms = [];
    for (let i = 0; i < sceneIndex; i++) {
      const s = scenes[i]!;
      if (s.phase === "DIARY_ROOM" && s.round === scene.round && s.diaryPlayer) {
        const built = buildDiaryRooms(s.messages, replayPlayers);
        if (built[0]) rooms.push(built[0]);
      }
    }
    return rooms;
  }, [scene, isDiaryScene, sceneIndex, scenes, replayPlayers]);

  // Stacked mingle rooms: completed mingle scenes from the same round (INF-93)
  const previousWhisperRooms = useMemo((): WhisperRoomStage[] => {
    if (!scene || !isWhisperScene) return [];
    const rooms: WhisperRoomStage[] = [];
    for (let i = 0; i < sceneIndex; i++) {
      const s = scenes[i]!;
      if (isRoomReplayPhase(s.phase) && s.round === scene.round && s.whisperRoom) {
        rooms.push({
          roomId: s.whisperRoom.roomId,
          playerIds: s.whisperRoom.playerNames,
          playerNames: s.whisperRoom.playerNames,
          messages: s.messages,
        });
      }
    }
    return rooms;
  }, [scene, isWhisperScene, sceneIndex, scenes]);

  // Auto-scroll stacked content to bottom when new rooms/messages arrive (INF-93)
  const hasPreviousRooms = previousDiaryRooms.length > 0 || previousWhisperRooms.length > 0;
  useEffect(() => {
    if (hasPreviousRooms) {
      requestAnimationFrame(() => {
        stackedScrollRef.current?.scrollTo({ top: stackedScrollRef.current.scrollHeight, behavior: "smooth" });
      });
    }
  }, [hasPreviousRooms, sceneIndex, messageIndex]);

  // For jury scenes: gather all jury messages
  const juryMessages = useMemo(() => {
    if (!scene || scene.phase !== "JURY_QUESTIONS") return [];
    return allVisibleMessages.filter(m => m.phase === "JURY_QUESTIONS");
  }, [allVisibleMessages, scene]);

  // Detect scene transitions
  const prevScene = sceneIndex > 0 ? scenes[sceneIndex - 1] : null;
  const isNewRound = scene && prevScene && scene.round !== prevScene.round;
  const isRoomChange = scene && prevScene && scene.roomType !== prevScene.roomType;
  const showHouseOverlay = Boolean(
    classicCue
    && classicCue.messageIndex === 0
    && scene?.houseIntro
    && isRoomChange,
  );

  // Phase transition overlay on room type changes
  const replayTransitionHoldMs =
    prevScene && PACED_PHASES.has(prevScene.phase) ? 2000 + PHASE_END_PAUSE_MS / speed : 2000;

  useEffect(() => {
    if (isRoomChange && scene) {
      resumeAfterTransitionRef.current = director.getSnapshot().isPlaying;
      if (resumeAfterTransitionRef.current) director.pause();
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
      director.pause();
      director.seek(presentationCues.length - 1);
    }
  }, [director, presentationCues.length]);

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
      switch (e.key) {
        case " ":
          e.preventDefault();
          if (isPlaying) director.pause();
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
    director,
    directorSnapshot.cursor,
    goToNextScene,
    isPlaying,
    presentationCues,
  ]);

  if (!scene || presentationCues.length === 0) {
    return (
      <div
        ref={animationScope}
        data-presentation-animation-boundary="true"
        data-reduced-motion={reducedMotion ? "reduce" : "no-preference"}
        className={`${embedded ? "relative h-full min-h-[24rem]" : "fixed inset-0"} bg-black flex flex-col items-center justify-center gap-4`}
      >
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
  const isElimination = currentMessage?.scope === "system" && (currentMessage.text.includes("ELIMINATED:") || currentMessage.text.includes("AUTO-ELIMINATE:"));

  const chatTypingIndicator = messagePhase === "typing" && currentMessage && !isSystemMessage ? (
    <div className="flex items-center gap-2 px-1 py-1 animate-[fadeIn_0.2s_ease-out]">
      {isCurrentRumor ? (
        <span className="w-6 h-6 rounded-full bg-purple-900/40 flex items-center justify-center text-xs">🗣</span>
      ) : currentPlayer ? (
        <GamePlayerAvatarPreview player={currentPlayer} size="6" />
      ) : null}
      <span className={`text-xs ${isCurrentRumor ? "text-purple-300/70 italic" : "text-white/40"}`}>{currentPlayerName}</span>
      <div className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-white/25 animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1.2s" }} />
        <span className="w-1.5 h-1.5 rounded-full bg-white/25 animate-bounce" style={{ animationDelay: "200ms", animationDuration: "1.2s" }} />
        <span className="w-1.5 h-1.5 rounded-full bg-white/25 animate-bounce" style={{ animationDelay: "400ms", animationDuration: "1.2s" }} />
      </div>
    </div>
  ) : null;

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
      {showPhaseEndingCue && (
        <PhaseEndingCue
          durationMs={live && sceneIndex >= totalScenes - 1 ? 0 : PHASE_END_PAUSE_MS / speed}
          label={live && sceneIndex >= totalScenes - 1 ? "Waiting for next phase" : "Phase complete"}
        />
      )}
      {showHouseOverlay && scene.houseIntro && (
        <div className={`${embedded ? "absolute" : "fixed"} inset-0 z-40 bg-black/90 flex flex-col items-center justify-center animate-[fadeIn_0.3s_ease-out]`}>
          <p className="text-white/20 text-xs tracking-[0.4em] uppercase mb-4">◆ THE HOUSE ◆</p>
          <p className="text-white/60 italic text-lg max-w-lg text-center px-6 leading-relaxed">
            {scene.houseIntro}
          </p>
        </div>
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
              {isOpenWhisperScene ? "MINGLE" : (PHASE_TRANSITION_LABELS[scene.phase] ?? scene.phase)}
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
      <div className="px-6 z-[60]">
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

      {/* Center — phase-aware content */}
      <div
        className={`flex-1 min-h-0 flex ${
          usesFullHeightContent
            ? "items-stretch overflow-hidden"
            : "items-center overflow-y-auto"
        } justify-center px-4 md:px-8 py-4 md:py-8`}
      >
        <div className={`w-full min-h-0 ${usesFullHeightContent ? "h-full" : ""} ${(isDiaryScene || isWhisperScene || isOverviewScene || isOpenWhisperScene) ? "max-w-7xl" : isChatStyleScene ? "max-w-3xl" : "max-w-2xl"}`}>
          {activeFormatIdForSocialScene ? (
            <div className="mb-3 flex justify-center">
              <ActiveFormatLabel formatId={activeFormatIdForSocialScene} />
            </div>
          ) : null}
          {formatCue && (
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
          )}

          {/* --- Chat-style: Group Chat Feed --- */}
          {!formatCue && isChatFeedScene && (
            <div className="flex h-full min-h-0 flex-col gap-2">
              <GroupChatFeed
                messages={chatFeedMessages}
                players={replayPlayers}
                phase={scene.phase}
                showThinking={showThinking}
                typingIndicator={chatTypingIndicator}
              />
            </div>
          )}

          {/* --- Chat-style: Whisper Room DM (stacked) --- */}
          {!formatCue && isOpenWhisperScene && (
            <OpenWhisperRoomsView
              phaseEntries={openWhisperMessages}
              players={replayPlayers}
              phaseKey={scene.id}
              live={live}
              showThinking={showThinking}
            />
          )}

          {!formatCue && isWhisperScene && !isOpenWhisperScene && (
            <div ref={stackedScrollRef} className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
              {previousWhisperRooms.map((prevRoom) => (
                <div key={`mingle-prev-${prevRoom.roomId}`} className="opacity-60">
                  <WhisperRoomDM room={prevRoom} players={replayPlayers} showThinking={showThinking} />
                </div>
              ))}
              {whisperRoom && (
                <WhisperRoomDM room={whisperRoom} players={replayPlayers} showThinking={showThinking} />
              )}
            </div>
          )}

          {/* --- Chat-style: Diary Room DM (stacked) --- */}
          {!formatCue && isDiaryScene && (
            <div ref={stackedScrollRef} className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
              {previousDiaryRooms.map((prevRoom) => (
                <div key={`diary-prev-${prevRoom.playerName}`} className="flex max-h-full min-h-0 flex-shrink-0 flex-col opacity-60">
                  <DiaryRoomChat room={prevRoom} showThinking={showThinking} />
                </div>
              ))}
              {diaryRoomData && (
                <div className="flex max-h-full min-h-0 flex-shrink-0 flex-col">
                  <DiaryRoomChat room={diaryRoomData} showThinking={showThinking} />
                </div>
              )}
            </div>
          )}

          {/* --- Chat-style: Jury Questions DM --- */}
          {!formatCue && isJuryScene && (
            <JuryDMView
              messages={juryMessages}
              players={replayPlayers}
              showThinking={showThinking}
            />
          )}

          {/* --- Whisper Overview: Rich allocation display --- */}
          {!formatCue && isOverviewScene && !isOpenWhisperScene && overviewStageData && (
            <WhisperAllocationOverview
              stage={overviewStageData}
              players={replayPlayers}
              mode={scene.phase === "MINGLE" ? "mingle" : "legacy-whisper"}
            />
          )}

          {/* --- Dramatic: Single-message spotlight (votes/reveals/power/end) --- */}
          {!formatCue && !isChatStyleScene && !isOverviewScene && (
            <>
              {/* Typing indicator */}
              {messagePhase === "typing" && currentMessage && !isSystemMessage && (
                <div className="text-center animate-[fadeIn_0.3s_ease-out]">
                  <div className="flex items-center justify-center gap-3 mb-8">
                    {isCurrentRumor ? (
                      <span className="w-10 h-10 rounded-full bg-purple-900/40 flex items-center justify-center text-xl">🗣</span>
                    ) : currentPlayer ? (
                      <GamePlayerAvatarPreview player={currentPlayer} size="10" />
                    ) : null}
                    <span className={`text-lg font-semibold ${isCurrentRumor ? "text-purple-300/70 italic" : "text-white/60"}`}>{currentPlayerName}</span>
                    {isCurrentRumor && (
                      <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">rumor</span>
                    )}
                    {currentMessage.scope === "mingle" && (
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
              {(messagePhase === "revealing" || messagePhase === "done") && currentMessage && (
                <SpectacleMessageContent
                  message={currentMessage}
                  scene={scene}
                  players={players}
                  messagePhase={messagePhase}
                  onRevealComplete={() => undefined}
                  isSystemMessage={isSystemMessage}
                  isElimination={isElimination}
                  currentPlayer={currentPlayer}
                  currentPlayerName={currentPlayerName}
                  speedMultiplier={speed}
                  rumorMessages={rumorMessages}
                  showThinking={showThinking}
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
          {!formatCue
            && !isChatStyleScene
            && !isOverviewScene
            && !isPlaying
            && messagePhase === "done"
            && (
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
        data-replay-controls
        className={`flex-shrink-0 px-3 md:px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:py-4 transition-opacity duration-500 z-[60] ${
          controlsVisible || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Mobile: compact 2-row layout */}
        <div className="md:hidden flex flex-col gap-2 max-w-sm mx-auto">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (isPlaying) director.pause();
                else director.play();
              }}
              className="text-xs text-white/50 hover:text-white transition-colors px-3 py-2 rounded-lg border border-white/10 active:border-white/30"
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); goToBeginning(); }}
                disabled={directorSnapshot.cursor === 0}
                className="text-xs text-white/40 active:text-white transition-colors px-2.5 py-2 rounded-lg border border-white/10 disabled:opacity-20"
              >
                ⏮
              </button>
              <button
                type="button"
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
                onClick={(e) => { e.stopPropagation(); goToNextScene(); }}
                disabled={directorSnapshot.cursor >= presentationCues.length - 1}
                className="text-xs text-white/40 active:text-white transition-colors px-2.5 py-2 rounded-lg border border-white/10 disabled:opacity-20"
              >
                ▶▶
              </button>
              <button
                type="button"
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
              {hasThinkingMessages && !live && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowThinking((v) => !v); }}
                  className={`text-[10px] px-1.5 py-1.5 rounded transition-colors ml-1 ${
                    showThinking
                      ? "bg-indigo-900/40 text-indigo-300 border border-indigo-500/30"
                      : "text-white/40 border border-indigo-500/20 bg-indigo-950/20"
                  }`}
                  title={showThinking ? "Hide agent thinking" : "Show agent thinking"}
                >
                  {showThinking ? "🧠" : "🧠"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Desktop: single-row layout */}
        <div className="hidden md:flex items-center justify-between max-w-3xl mx-auto">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (isPlaying) director.pause();
              else director.play();
            }}
            className="text-sm text-white/50 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20"
          >
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); goToBeginning(); }}
              disabled={directorSnapshot.cursor === 0}
              className="text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              ⏮ Start
            </button>
            <button
              type="button"
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

          {hasThinkingMessages && !live && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowThinking((v) => !v); }}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors border ${
                showThinking
                  ? "bg-indigo-900/40 text-indigo-300 border-indigo-500/30"
                  : "text-indigo-300/50 hover:text-indigo-200 border-indigo-500/20 hover:border-indigo-500/40 bg-indigo-950/20"
              }`}
            >
              🧠 {showThinking ? "Hide Thinking" : "Show Thinking"}
            </button>
          )}
        </div>
        <p className="text-[10px] text-white/10 text-center mt-2 hidden md:block">
          Space: play/pause · Click/→: advance · ←: back · []: rounds · 1234: speed
        </p>
      </div>
    </div>
  );
}
