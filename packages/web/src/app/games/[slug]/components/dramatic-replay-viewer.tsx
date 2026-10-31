"use client";

import {twoNamesDecisionSpeechAction} from "@influence/engine/influence-decision-speech";
import type {PresentationCue} from "./types";
import type {AudioWatchCoordinate} from "@influence/engine/audio-watch";
import {HouseNarration} from "@/components/watch/house-narration";
import {influencePresentationPolicy} from "./influence-presentation-director";
import {influenceProductionReference} from "@/lib/replay-export/influence-production-reference";
import {useGamePlayback,useIsFollowPlayer} from "@/components/watch/game-playback";
import {useWatchVoice} from "@/components/watch/use-watch-voice";
import {influenceTranscriptAudioIdentity} from "@/components/watch/audio-watch-coordinate";
import {sampleWatch} from "@/components/watch/watch-sampling";
import {soloPresentationDurationMs} from "./solo-presentation-timing";
import {WatchClock} from "@/components/watch/watch-clock";
import {useWatchTimeline} from "@/components/watch/use-watch-timeline";
import {isFormatSocialTranscriptMessage, buildClassicPresentationCues, buildReplayPlayersForCue, classicEliminatedPlayerIds, comparePresentationCues, findCueForAdjacentScene, formatCueScene, formatSnapshotForPresentationCursor, mergeFormatAndSocialCues} from "./influence-replay-cues";
export {isFormatSocialTranscriptMessage, buildClassicPresentationCues, buildReplayPlayersForCue, comparePresentationCues, findCueForAdjacentScene, formatSnapshotForPresentationCursor} from "./influence-replay-cues";

import { Component, type ReactNode, useState, useEffect, useRef, useMemo, useCallback } from "react";
import { FitPresentation } from "./fit-presentation";
import { usePlayerFullscreen } from "@/components/watch/use-player-fullscreen";
import {WatchThinking} from "@/components/watch/watch-thinking";
import {influenceThinkingActor, influenceThinkingText} from "./influence-thinking";
import {useWatchPreferences, type WatchPreferenceScope} from "@/components/watch/use-watch-preferences";
import {WatchWaiting} from "@/components/watch/watch-waiting";
import {getPublicWatchIntelligence} from "@/lib/api";
import { gameReplaySequenceHref } from "@/lib/game-links";
import { WatchTransport } from "@/components/watch/watch-transport";
import { useWatchKeyboard } from "@/components/watch/use-watch-keyboard";
import { VisualPresentation } from "./visual-presentation";
import { compileVoteLedgers } from "./vote-ledger-model";
import { useVisualWatch } from "./use-visual-watch";
import { visualWatchPresentation } from "./visual-watch-model";
import { MotionConfig } from "motion/react";
import type {
  TranscriptEntry,
  GamePlayer,
  GameDetail,
  GameWatchReplayFrame,
} from "@/lib/api";
import type {
} from "./types";
import {
  PHASE_TRANSITION_LABELS,
  phaseColor,
  setPhaseAttr,
  setEndgameAttr,
  ENDGAME_PHASES,
  ROOM_TYPE_COLORS,
} from "./constants";
import { ConnectionBadge, GameStateHUD } from "./game-info";
import { buildStoryScenes } from "./house-story";
import { buildEndgamePresentationCues, compileRevealedWinnerCues } from "./endgame-presentation";
import { compileSafetyBounceLobbyLookup } from "./safety-bounce-scene-model";
import { shouldSuppressDramaticAdvance } from "./dramatic-interaction";
import {
  type MatchWatchPlaybackState,
  type PresentationHydrationState,
} from "./match-watch-model";
import type { WatchConnStatus } from "./types";
import {
  compileFormatPresentationPrefix,
  formatPresentationDecisionsFromFrames,
  formatPresentationEligibilityFromFrames,
} from "./format-presentation-model";
import { useWatchAnalytics } from "@/components/watch/use-watch-analytics";
import { usePresentationDirector } from "./influence-presentation-director";
import { FormatPresentation } from "./format-presentation";
import { ActiveFormatLabel } from "./active-format-label";
import { findPresentationCueIndexForSequence } from "./presentation-sequence";
import {composeInfluencePresentation, influenceCastArt} from "./influence-presentation";
import {InfluenceOpeningFrame} from "./influence-opening-frame";
import {influenceMusic, influenceOpeningAudio} from "./influence-music";
import {speechMusicVolume} from "@/components/watch/watch-music";
import {useWatchMusic} from "@/components/watch/use-watch-music";
import {WatchBuffering} from "@/components/watch/watch-waiting";
import {useOpeningAudio} from "@/components/watch/use-opening-audio";

import {useReplayShare} from "@/components/watch/use-replay-share";
import {replayShareHref, type ReplayShareState} from "@/lib/replay-share";
import {gameReplayHref} from "@/lib/game-links";

interface DramaticReplayViewerProps {
  anonymous?: boolean;
  preferenceScope?: WatchPreferenceScope;
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
  const shared = useReplayShare(props.preferenceScope !== "production");
  const preferences = useWatchPreferences(props.preferenceScope, shared.state, props.anonymous);
  if (shared.error) return <p role="alert">{shared.error}</p>;
  if (!shared.ready || !preferences.ready) return <WatchWaiting label="Preparing the player…" />;
  return (
    <MotionConfig reducedMotion="user">
      <PlaybackContractBoundary key={props.game.id}><DramaticReplayTheater {...props} shared={shared.state} preferences={preferences} /></PlaybackContractBoundary>
    </MotionConfig>
  );
}

class PlaybackContractBoundary extends Component<{children: ReactNode}, {error: Error | null}> {
  state: {error: Error | null} = {error: null};
  static getDerivedStateFromError(error: Error) { return {error}; }
  render() {
    if (this.state.error) return <section role="alert" className="rounded-xl border border-amber-400/40 bg-black/80 p-6 text-white"><h2 className="text-lg font-semibold">Playback stopped</h2><p>{this.state.error.name === "PresentationContractError" ? this.state.error.message : "This recording could not be presented. The game is unaffected."}</p></section>;
    return this.props.children;
  }
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
  preferences,
  anonymous = false,
  shared,
}: DramaticReplayViewerProps & {shared?:ReplayShareState; preferences: ReturnType<typeof useWatchPreferences>}) {
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
      modelPreference: player.modelPreference,
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
      empowerRevoteVersion: game.empowerRevoteVersion,
      gameSchemaVersion: game.gameSchemaVersion,
      roster: formatRoster,
      decisions: formatPresentationDecisionsFromFrames(replayFrames, game.gameSchemaVersion),
      eligiblePlayerIdsByRound: formatPresentationEligibilityFromFrames(replayFrames),
    }),
    [
      formatRoster,
      game.gameKernel,
      game.formatManifest,
      game.empowerRevoteVersion,
      game.gameSchemaVersion,
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
  const presentationCues = useMemo(() => composeInfluencePresentation(game.id, canonicalPresentationCues, players, scenes, game.gameSchemaVersion, {speechPrefixComplete: !live && (presentationHydrationStatus === undefined || presentationHydrationStatus === "ready")}), [canonicalPresentationCues, game.id, players, scenes, game.gameSchemaVersion, live, presentationHydrationStatus]);
  const voteLedgers = useMemo(() => compileVoteLedgers(presentationCues), [presentationCues]);
  const revealedWinners = useMemo(() => compileRevealedWinnerCues(presentationCues), [presentationCues]);
  const lobbyMessages = useMemo(() => compileSafetyBounceLobbyLookup(classicCues, scenes), [classicCues, scenes]);
  const followed=useIsFollowPlayer();
  // Live-tail waiting belongs to the game lifecycle. Navigation changes position
  // and play intent, but must still buffer when playback catches up again.
  const {
    director,
    snapshot: directorSnapshot,
    scope: animationScope,
    reducedMotion,
  } = usePresentationDirector({ followTail: live });
  useWatchAnalytics(director, game.id, "influence", anonymous ? null : live ? "live" : "replay");
  const { fullscreen: nativeFullscreen, theater, theaterButton, toggleTheater, expanded, button: fullscreenButton, error: fullscreenError, toggle: toggleFullscreen } = usePlayerFullscreen(animationScope,followed);
  const {thinking:showThinking, setThinking:setShowThinking} = preferences;
  const timeline = useWatchTimeline(director, presentationCues, showThinking);
  const controlsRef = useRef<HTMLDivElement>(null);
  const controlsHovered = useRef(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectHydrationPendingRef = useRef(false);
  // Scroll ref for stacked diary/mingle content (INF-93)

  const fallbackCue = presentationCues[startSequence !== undefined
    ? findPresentationCueIndexForSequence(presentationCues, startSequence)
    : live ? presentationCues.length - 1 : 0] ?? null;
  const activeCue = director.getActiveCue() ?? fallbackCue;
  const openingCue = activeCue?.source === "opening" ? activeCue : null;
  const openingPlayer = openingCue?.opening.player ? players.find(player => player.id === openingCue.opening.player?.id) : undefined;
  const classicCue = activeCue?.source === "classic" ? activeCue : null;
  const formatCue = activeCue?.source === "format" ? activeCue : null;
  const [chainReveal, setChainReveal] = useState<{key: string; revealed: boolean} | null>(null);
  useEffect(() => {
    if (!activeCue || (activeCue.kind !== "safety_bounce_pointer" && !twoNamesDecisionSpeechAction(activeCue.kind)) || !activeCue.spokenMessage) return;
    return sampleWatch(director, () => {
      const revealed = !director.getThinkingFrame() && director.getElapsedBaseMs() >= soloPresentationDurationMs(activeCue.spokenMessage!);
      setChainReveal(previous => previous?.key === activeCue.key && previous.revealed === revealed ? previous : {key:activeCue.key,revealed});
    });
  }, [activeCue, director]);
  const presentedFormatSnapshot = useMemo(() => {
    if (!isFormatGame || !activeCue) return null;
    if (activeCue.source === "format" && (activeCue.kind === "safety_bounce_pointer" || twoNamesDecisionSpeechAction(activeCue.kind)) && activeCue.spokenMessage
      && !(chainReveal?.key === activeCue.key && chainReveal.revealed)
      && !(live && directorSnapshot.hydrationWatermark !== null && activeCue.canonicalSequence <= directorSnapshot.hydrationWatermark)) return activeCue.before;
    return formatSnapshotForPresentationCursor(
      presentationCues,
      directorSnapshot.cursor,
      activeCue.round,
    );
  }, [activeCue, isFormatGame, directorSnapshot.cursor, directorSnapshot.hydrationWatermark, presentationCues, chainReveal, live]);
  const activeFormatIdForSocialScene = classicCue ? presentedFormatSnapshot?.activeFormatId ?? null : null;
  const messageIndex = classicCue?.messageIndex ?? 0;
  const scene = classicCue
    ? scenes[classicCue.sceneIndex]
    : activeCue && activeCue.source !== "classic"
      ? formatCueScene(activeCue)
      : undefined;
  const currentMessage = scene?.messages[messageIndex] ?? null;
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

  const canonicalReplayFrame = useMemo(() => {
    if (openingCue) return null;
    if (!isFormatGame || replayFrames.length === 0) return null;
    const canonicalSequence = activeCue?.canonicalSequence;
    if (canonicalSequence === null || canonicalSequence === undefined) {
      return replayFrames[0] ?? null;
    }
    // A committed resolution expands into votes, pool and choice before the exit.
    // Keep the cast on its preceding canonical frame until that exit is presented.
    const beforeExit = activeCue?.source === "format" && ["format_roll_call", "format_aggregate", "format_tiebreak", "format_deciding_vote"].includes(activeCue.kind);
    for (let index = replayFrames.length - 1; index >= 0; index -= 1) {
      const frame = replayFrames[index]!;
      if (beforeExit ? frame.sequence < canonicalSequence : frame.sequence <= canonicalSequence) return frame;
    }
    return replayFrames[0] ?? null;
  }, [activeCue, openingCue, isFormatGame, replayFrames]);

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
    const lastMessage = allVisibleMessages.at(-1);
    const prefix = lastMessage ? filteredMessages.slice(0, filteredMessages.indexOf(lastMessage) + 1) : [];
    return classicEliminatedPlayerIds(prefix, players);
  }, [allVisibleMessages, filteredMessages, canonicalReplayFrame, isFormatGame, players]);

  const aliveCount = isFormatGame && canonicalReplayFrame
    ? canonicalReplayFrame.counts.alivePlayers
    : players.length - eliminatedIds.size;

  // Build players with correct alive/eliminated status for current replay position
  const replayPlayers = useMemo(
    () => openingCue ? players.map(player => ({...player, status: "alive" as const, shielded: false, pressureStatus: undefined, exposeScore: undefined})) : buildReplayPlayersForCue({
      players,
      isFormatGame,
      canonicalFrame: canonicalReplayFrame,
      classicEliminatedIds: eliminatedIds,
      live,
    }),
    [canonicalReplayFrame, eliminatedIds, isFormatGame, players, live, openingCue],
  );

  const visualData = useVisualWatch(game.id, true, live, activeCue?.key, anonymous);
  const priorLobbyMessages = formatCue ? lobbyMessages(formatCue.round, formatCue.canonicalSequence) : [];
  const visual = visualWatchPresentation(
    visualData ?? { enabled: true, status: null, portraits: {}, scenes: [] }, revealedWinners[Math.min(directorSnapshot.cursor, presentationCues.length - 1)] ?? activeCue, currentMessage, replayPlayers, priorLobbyMessages, replayFrames,
  );
  const thinkingActor = influenceThinkingActor(activeCue, visual.beat);
  const thinkingSpeaker = players.find(player => player.id === thinkingActor)?.name ?? "Player";
  const thoughtSequence = activeCue?.canonicalSequence;
  const thoughtMessage = activeCue?.decisionSpeechEntry ?? currentMessage;
  const messageThought = thoughtMessage?.thinking;
  const messageId = thoughtMessage?.id;
  const entrySequence = thoughtMessage?.entrySequence;
  const thoughtRound = activeCue?.round, thoughtPhase = activeCue?.phase;
  const classicThought = activeCue?.source === "classic" || Boolean(activeCue?.decisionSpeechEntry);
  const loadThinking = useCallback(async (signal: AbortSignal) => {
    if (!thinkingActor || thoughtRound === undefined || !thoughtPhase) return null;
    if (classicThought && messageThought) return messageThought;
    if (thoughtSequence == null) return null;
    const result = await getPublicWatchIntelligence(game.slug, {actorPlayerId:thinkingActor, round:thoughtRound, phase:thoughtPhase, throughEventSequence:thoughtSequence, throughTranscriptSequence:entrySequence ?? 0, limit:4}, signal, anonymous);
    if (!result.ok) return null;
    return activeCue ? influenceThinkingText(result.intelligence.thinking.cards, activeCue, thinkingActor, messageId) : null;
  }, [anonymous, game.slug, thinkingActor, thoughtSequence, thoughtRound, thoughtPhase, messageThought, messageId, entrySequence, classicThought, activeCue]);
  const coordinateForCue=useCallback((candidate:PresentationCue):AudioWatchCoordinate|null=>{
    if (candidate.source === "opening" || candidate.source === "house" || candidate.voteSummary) return null;
    const message=candidate.decisionSpeechEntry ?? (candidate.source === "classic" ? scenes[candidate.sceneIndex]?.messages[candidate.messageIndex] : formatCueScene(candidate)?.messages[0]);
    const transcriptIdentity=(candidate.source === "classic" || candidate.decisionSpeechEntry) && message ? influenceTranscriptAudioIdentity(message) : null;
    if (candidate.source === "classic" && !transcriptIdentity) return null;
    const ballot=candidate.source === "format" ? candidate.visualBallot ?? (candidate.kind === "format_roll_call" ? candidate.ballot : null) : candidate.source === "endgame" ? candidate.ballot : null;
    const actorId=ballot?.voterId ?? (candidate.source === "format" && candidate.kind === "two_names_plea" ? candidate.speakerId : message?.speakerPlayerId ?? message?.fromPlayerId ?? null);
    return {kind:"influence",...transcriptIdentity,eventSequence:candidate.canonicalSequence ?? message?.firstDurableEventSequence ?? 0,actorId,part:"speech"};
  },[scenes]);
  const [playRequested, setPlayRequested] = useState(!followed);
  const followPosition = () => activeCue ? {kind:"influence" as const,...influenceProductionReference(activeCue,
    key=>presentationCues.find(candidate=>candidate.key===key),candidate=>candidate.source==="classic"?scenes[candidate.sceneIndex]?.messages[candidate.messageIndex]:undefined)} : null;
  const concluded=useCallback(()=>{
    const current=director.getActiveCue();
    return current?.source==='endgame'&&current.kind==='endgame_winner'&&current.phase==='RETROSPECTIVE';
  },[director]);
  const {onSpeech:onHouseSpeech,houseSpeaking,houseHolding} = useGamePlayback({id:game.id,slug:game.slug,kind:"influence"},followPosition,players,{director,concluded,revealAtMs:activeCue?influencePresentationPolicy.scrubAtMs?.(activeCue)??0:0});
  const [masterMuted, setMasterMuted] = useState(true);
  const voice = useWatchVoice({suspended:houseHolding,masterMuted,director,gameId:game.id,audience:"public",thinking:preferences.thinking,live,onPause:() => setPlayRequested(false),
    coordinate:activeCue ? coordinateForCue(activeCue) : null,coordinateForCue,onSpeech:onHouseSpeech});
  const currentStateEntry = Boolean(live && formatCue && directorSnapshot.hydrationWatermark !== null
    && formatCue.canonicalSequence <= directorSnapshot.hydrationWatermark);
  const isPlaying = directorSnapshot.isPlaying;
  const speed = directorSnapshot.speed;
  const musicSection = influenceMusic(game.id, revealedWinners[Math.min(directorSnapshot.cursor, presentationCues.length - 1)] ?? activeCue, currentMessage);
  const closingMusic = !live && musicSection?.continueAtEnd === true && activeCue !== null
    && directorSnapshot.cursor === presentationCues.length - 1
    && director.getElapsedBaseMs() >= activeCue.baseDurationMs && playRequested && !masterMuted && !preferences.musicMuted;
  const preparing = live && presentationHydrationStatus !== "ready";
  const ambient = useWatchMusic({
    section:musicSection, playing:(isPlaying || closingMusic) && !openingCue,
    muted:masterMuted || preferences.musicMuted, volume:speechMusicVolume(preferences.musicVolume, voice.speaking && !voice.muted && voice.volume > 0, houseSpeaking), preparing,
    holding:directorSnapshot.waitingAtTail, live, navigationRevision:director.getNavigationRevision(),
  });
  const transportPlaying = isPlaying || closingMusic && (ambient.status === "playing" || ambient.status === "loading");
  const openingAudio = useOpeningAudio({
    tracks:() => influenceOpeningAudio(openingCue, director.getElapsedBaseMs()),
    playing:isPlaying && !preparing, muted:masterMuted || preferences.musicMuted, volume:speechMusicVolume(preferences.musicVolume, voice.speaking && !voice.muted && voice.volume > 0, houseSpeaking), speed,
  }, director);
  const {suspend: suspendMusic} = openingCue ? openingAudio : ambient;
  const {unlock: unlockAmbient, restart: restartAmbient} = ambient;
  const {unlock: unlockOpening, restart: restartOpening} = openingAudio;
  const unlockMusic = useCallback((muted?: boolean) => {
    // Prepare the ambient AudioContext in the same gesture as opening playback.
    unlockAmbient(muted); unlockOpening(muted);
  }, [unlockAmbient, unlockOpening]);


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
    if (shared && !initialSequenceSeekAppliedRef.current && director.getSnapshot().cueKeys.length === 0) {
      const index = shared.cue ? presentationCues.findIndex(cue => cue.key === shared.cue) : startSequence === undefined ? 0 : findPresentationCueIndexForSequence(presentationCues, startSequence);
      if (index < 0) return;
      director.setSpeed(shared.speed);
      director.setThinkingEnabled(shared.thinking);
      director.load(presentationCues, index);
      director.seekTimeline(index, shared.time * 1000, shared.thinking);
      initialSequenceSeekAppliedRef.current = true;
      if (!followed) director.play();
      return;
    }
    if (startSequence !== undefined && !initialSequenceSeekAppliedRef.current && director.getSnapshot().cueKeys.length === 0) {
      const seekIndex = findPresentationCueIndexForSequence(presentationCues, startSequence);
      director.load(presentationCues, Math.max(0,seekIndex));
      initialSequenceSeekAppliedRef.current = true;
      if (!followed) director.play();
      return;
    }
    if (live && director.getSnapshot().cueKeys.length === 0) {
      const latest = presentationCues.at(-1);
      if (latest?.source === "classic" && !latest.liveCatchUp) {
        // A newly published first speech needs its full reading time. Historical
        // catch-up uses hydration so old introductions are not replayed.
        director.load(presentationCues, presentationCues.length - 1);
      } else {
        director.reconnect(presentationCues);
      }
      if (!followed) director.play();
      return;
    }
    if (director.getSnapshot().cueKeys.length === 0) {
      director.load(presentationCues);
      director.seek(0, 0);
      if (!followed) director.play();
      return;
    }
    // Late visual/timing metadata must retain the selected source and local time,
    // including on completed replays.
    director.append(presentationCues);
  }, [
    followed,
    director,
    directorSnapshot.cueKeys.length,
    live,
    presentationCues,
    presentationHydrationStatus,
    startSequence,
    shared,
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
  const isTwoNamesPresentation = formatCue?.after.activeFormatId === "two_names";
  const isEmpowerPresentation = formatCue?.kind === "empowered_tally" || formatCue?.kind === "empowered_tie";
  const usesFullHeightContent = Boolean(openingCue) || expanded || isEmpowerPresentation || formatCue?.kind === "two_names_plea" || visual.beat !== null;
  const isSoloPresentation = visual.beat?.kind === "portrait" || visual.beat?.kind === "nominee-selection";
  const isRoomPresentation = visual.beat?.kind === "scene" || visual.beat?.kind === "portrait-room" || visual.beat?.kind === "safety-bounce" || visual.beat?.kind === "winner" || visual.beat?.kind === "two-names-stage" || visual.beat?.kind === "two-names-decision";
  useEffect(() => {
    if (!scene || !onPlaybackStateChange) return;
    onPlaybackStateChange({
      round: scene.round,
      phase: scene.phase,
      canonicalSequence: canonicalReplayFrame?.sequence ?? activeCue?.canonicalSequence ?? null,
      formatSnapshot: presentedFormatSnapshot,
      players: replayPlayers,
      visibleMessages: allVisibleMessages,
    });
  }, [activeCue?.canonicalSequence, canonicalReplayFrame, allVisibleMessages, onPlaybackStateChange, presentedFormatSnapshot, replayPlayers, scene]);

  const advanceMessage = useCallback(() => {
    if (!masterMuted && !preferences.musicMuted) unlockMusic();
    director.manualAdvance();
  }, [director, unlockMusic, preferences.musicMuted, masterMuted]);

  const stepBackOneCue = useCallback(() => {
    director.seek(directorSnapshot.cursor - 1);
  }, [director, directorSnapshot.cursor]);

  const pausePresentation = useCallback(() => {
    suspendMusic(); setPlayRequested(false);
    director.pause();
  }, [director, suspendMusic]);

  const togglePlay = () => {
    if (transportPlaying) pausePresentation();
    else {
      voice.resume();
      if (!masterMuted && !preferences.musicMuted) unlockMusic();
      setPlayRequested(true); director.play();
    }
  };

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
      director.setFollowTail(live);
      director.seek(presentationCues.length - 1);
      if (live) {setPlayRequested(true); director.play();}
    }
  }, [director, pausePresentation, presentationCues.length, live]);

  const goToBeginning = useCallback(() => {
    restartAmbient(); restartOpening();
    setPlayRequested(false); director.pause(); director.seek(0, 0);
  }, [director, restartAmbient, restartOpening]);

  const goToPrevScene = useCallback(() => {
    const previousIndex = findCueForAdjacentScene(presentationCues, directorSnapshot.cursor, -1);
    if (previousIndex !== null) director.seek(previousIndex);
  }, [director, directorSnapshot.cursor, presentationCues]);

  // Reset auto-hide timer helper
  const resetControlsTimer = useCallback(() => {
    if (embedded && !expanded) {
      setControlsVisible(true);
      return;
    }
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (!controlsHovered.current && !controlsRef.current?.contains(document.activeElement)) setControlsVisible(false);
    }, 3000);
  }, [embedded, expanded]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setControlsVisible(true);
      if (isPlaying) resetControlsTimer();
    });
    return () => { cancelAnimationFrame(frame); if (controlsTimer.current) clearTimeout(controlsTimer.current); };
  }, [expanded, isPlaying, resetControlsTimer]);

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
    if (embedded && !expanded) return;
    setControlsVisible(true);
    resetControlsTimer();
  }, [embedded, expanded, resetControlsTimer]);

  // Auto-hide controls (touch for mobile)
  const handleTouchStart = useCallback(() => {
    if (embedded && !expanded) return;
    if (controlsVisible) {
      resetControlsTimer();
    }
  }, [controlsVisible, embedded, expanded, resetControlsTimer]);

  useWatchKeyboard({
    toggle: togglePlay,
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
      className={`flex flex-col cursor-pointer select-none text-white [color-scheme:dark] ${
        embedded
          ? "relative h-full min-h-0 overflow-hidden"
          : "fixed inset-0 z-30 influence-shell"
      }`}
      data-player-fullscreen={nativeFullscreen || undefined}
      data-player-theater={theater || undefined}
      style={expanded ? { position: "fixed", inset: 0, width: "100vw", height: "100dvh", maxWidth: "none", maxHeight: "none", margin: 0, padding: 0, border: 0, zIndex: 1000, background: "black" } : undefined}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onTouchStart={handleTouchStart}
    >
      {!embedded && !expanded && (
        <>
          <div className="influence-phase-atmosphere" />
          <div className="influence-phase-vignette" />
          {ENDGAME_PHASES.has(scene.phase) && <div className="influence-endgame-atmosphere" />}
        </>
      )}

      {/* Exit button — top-left, auto-hides with controls */}
      {!embedded && !expanded && (
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
      {!openingCue && !embedded && !expanded && (
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
      {!openingCue && !embedded && !expanded && (
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
      <div className={`shrink-0 px-6 z-[60] ${expanded ? "hidden" : ""}`}>
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
        } justify-center ${openingCue ? "" : expanded ? isRoomPresentation || isSoloPresentation ? "pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]" : "pb-[140px] pt-[env(safe-area-inset-top)]" : isSoloPresentation || isRoomPresentation ? "" : isTwoNamesPresentation ? "p-3" : "px-4 md:px-8 py-4 md:py-8"}`}
      >
        {openingCue ? <>
          <WatchClock director={director}>{elapsed => <InfluenceOpeningFrame cue={openingCue} elapsedMs={elapsed} navigationRevision={director.getNavigationRevision()} reduced={reducedMotion} playing={isPlaying} speed={speed}
            {...influenceCastArt(openingPlayer, visualData)} />}</WatchClock>
          <button type="button" data-replay-controls className="absolute right-4 top-4 z-20 rounded-full border border-white/20 bg-black/60 px-4 py-2 text-xs text-white/80 hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
            onClick={event => {
              event.stopPropagation();
              const firstGameCue = presentationCues.findIndex(cue => cue.source !== "opening");
              suspendMusic();
              // Normal navigation lands paused ballots on their readable frame.
              if (firstGameCue >= 0) director.seek(firstGameCue);
            }}>Skip intro</button>
        </> : <WatchThinking director={director} cueKey={activeCue?.key ?? null} enabled={showThinking} speaker={thinkingSpeaker} load={loadThinking}>
        <div className={`mx-auto w-full min-h-0 ${!usesFullHeightContent ? "my-auto" : ""} ${usesFullHeightContent ? "flex flex-1 flex-col" : ""} ${expanded || isSoloPresentation || isRoomPresentation ? "" : "max-w-3xl"}`}>
          {formatCompilationNotice ? (
            <div className="mb-3 shrink-0">{formatCompilationNotice}</div>
          ) : null}
          {visual?.beat ? <VisualPresentation hideHouseNarration={voice.houseNarrationAvailable} fullscreen={expanded} director={director} currentStateEntry={currentStateEntry} beat={visual.beat} rooms={visual.rooms} reducedMotion={reducedMotion}
            voteLedger={voteLedgers[directorSnapshot.cursor] ?? null} roster={formatRoster.map(player => ({ ...player, avatarUrl: visualData?.portraits[player.id] ?? player.avatarUrl }))} /> : <>
          {formatCue && (
            <div className={`min-h-0 flex-1 ${formatCue.kind === "two_names_plea" ? "h-full" : ""}`}>
              <FitPresentation enabled={expanded || isEmpowerPresentation}><FormatPresentation
                cue={formatCue}
                roster={formatRoster.map(player => ({...player, avatarUrl: visualData?.portraits[player.id] ?? player.avatarUrl, fullBodyReferenceUrl: visualData?.fullBodies?.[player.id]}))}
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
        </WatchThinking>}
        {voice.houseNarrationAvailable && <WatchClock director={director}>{() => <HouseNarration text={currentMessage?.text ?? ""} window={voice.getHouseNarration()} bottom={expanded ? 140 : 16} />}</WatchClock>}
        {live && isPlaying && directorSnapshot.waitingAtTail && activeCue && <WatchBuffering />}
      </div>

      {/* Bottom scrub controls — pinned under the scrollable content region */}
      <div
        data-replay-controls
        ref={controlsRef}
        onFocusCapture={() => {controlsHovered.current = true;setControlsVisible(true);}}
        onBlurCapture={event => {if (!event.currentTarget.contains(event.relatedTarget)) controlsHovered.current = false;}}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") controlsHovered.current = true; }}
        onPointerLeave={() => { controlsHovered.current = false; resetControlsTimer(); }}
        className={`${expanded ? "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/85 to-transparent" : "shrink-0 border-t border-white/5 bg-black/70"} px-3 md:px-6 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 md:py-2 transition-opacity duration-500 z-[60] backdrop-blur-sm ${
          controlsVisible || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {shared?.cue && presentationCues.length > 0 && !presentationCues.some(cue => cue.key === shared.cue) && <p role="alert">This replay moment is no longer available.</p>}
        {voice.error && <div role="alert">{voice.error}</div>}

        <WatchTransport getShareHref={() => {
          const cue = director.getActiveCue();
          const href = cue?.canonicalSequence != null ? gameReplaySequenceHref(game.slug, cue.canonicalSequence) : gameReplayHref(game.slug);
          return cue ? replayShareHref(href, cue.key, director.getTimelineElapsedBaseMs(), director.getSnapshot().speed, preferences) : href;
        }} fullscreen={nativeFullscreen} theater={theater} theaterButton={theaterButton} toggleTheater={toggleTheater} fullscreenButton={fullscreenButton} toggleFullscreen={toggleFullscreen} fullscreenError={fullscreenError}
          header={activeFormatIdForSocialScene ? <div className="mb-3 flex justify-center"><ActiveFormatLabel formatId={activeFormatIdForSocialScene} /></div> : null}
          isPlaying={transportPlaying} togglePlay={togglePlay} speed={speed} onSpeed={value => director.setSpeed(value)}
          audio={{muted:masterMuted,onMute:() => {if (isPlaying) voice.resume();setMasterMuted(!masterMuted);unlockMusic(!masterMuted || preferences.musicMuted);}}}
          voice={voice.available ? {muted:voice.muted,volume:voice.volume,onMute:() => voice.setMuted(!voice.muted),onVolume:voice.setVolume} : undefined}
          music={{muted:preferences.musicMuted,volume:preferences.musicVolume,status:openingCue ? openingAudio.status : ambient.status,
            onMute:() => {if (isPlaying) voice.resume();preferences.setMusicMuted(!preferences.musicMuted);unlockMusic(masterMuted || !preferences.musicMuted);},
            onVolume:preferences.setMusicVolume,retry:() => unlockMusic(masterMuted || preferences.musicMuted)}}
          onScrubStart={() => {ambient.beginScrub(); openingAudio.beginScrub();}}
          onScrubEnd={() => {ambient.endScrub(); openingAudio.endScrub();}}
          goToBeginning={goToBeginning} goToPrevScene={goToPrevScene} onSeek={frame => {const target = timeline.target(frame); if (target) {suspendMusic(); director.seekTimeline(target.index, target.elapsedMs);}}} timeline={timeline} goToNextScene={goToNextScene} goToEnd={goToEnd}
          live={live} cursor={directorSnapshot.cursor} count={presentationCues.length}
          thinking={{enabled:showThinking,onChange:setShowThinking}} />
      </div>
    </div>
  );
}
