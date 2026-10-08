import type {TranscriptEntry, GamePlayer, GameWatchReplayFrame, PhaseKey} from "@/lib/api";
import type {ClassicPresentationCue, FormatPresentationCue, PresentationCue, ReplayScene} from "./types";
import {phaseToRoomType} from "./constants";
import {MATCH_WATCH_FORMAT_PHASES, REPLAY_FRAME_PHASE_ORDER} from "./match-watch-model";
import {transcriptPresentationDurationMs, isSoloTranscript} from "./visual-watch-model";
import {voteSceneIdentity} from "./vote-ledger-model";
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

export function mergeFormatAndSocialCues(
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

export function formatCueScene(cue: Exclude<PresentationCue, ClassicPresentationCue>): ReplayScene {
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

