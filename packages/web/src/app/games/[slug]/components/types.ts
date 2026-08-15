import type {
  PhaseKey,
  TranscriptEntry,
  GamePlayer,
  GameDetail,
  GameWatchReplayFrame,
  PublicPostgameMediaResponse,
  ViewerDecisionEvent,
} from "@/lib/api";
import type { LaunchFormatId } from "@influence/engine/format-presentation-metadata";

export type RoomType = "lobby" | "private_rooms" | "tribunal" | "diary" | "endgame";

export interface ReplayScene {
  id: string;
  round: number;
  phase: PhaseKey;
  roomType: RoomType;
  messages: TranscriptEntry[];
  houseIntro: string | null;
  /** Present on per-room scenes (sequential presentation). Field name retained for historical data shape compatibility (see whisper-phase.tsx header comment). */
  whisperRoom?: { roomId: number; playerNames: string[] };
  /** Present on per-player diary scenes (sequential presentation). */
  diaryPlayer?: { playerName: string };
  /** When true, this scene is an overview/allocation screen with no chat messages. */
  isOverview?: boolean;
}

export interface WhisperRoomStage {
  roomId: number;
  beat?: number;
  localRoomNumber?: number;
  playerIds: string[];
  playerNames: string[];
  messages: TranscriptEntry[];
}

export interface WhisperStageData {
  allocationText: string | null;
  rooms: WhisperRoomStage[];
  commons: GamePlayer[];
  hasRoomMetadata?: boolean;
}

export interface TransitionState {
  phase: PhaseKey;
  round: number;
  maxRounds: number;
  aliveCount: number;
  flavorText: string;
}

export type GroupedMessage =
  | { kind: "msg"; entry: TranscriptEntry }
  | { kind: "diary_pair"; question: TranscriptEntry; answer: TranscriptEntry | null; id: number }
  | { kind: "diary_orphan_answer"; answer: TranscriptEntry };

export type EndgameStage = "reckoning" | "tribunal" | "judgment";

export interface EndgameScreenState {
  stage: EndgameStage;
  finalists?: [string, string];
  jurors?: string[];
}

export interface DiaryRoomData {
  playerName: string;
  player: GamePlayer | undefined;
  entries: Array<{ question: TranscriptEntry; answer: TranscriptEntry | null }>;
}

export type ConnStatus = "connecting" | "live" | "disconnected" | "reconnecting";
export type WatchConnStatus = ConnStatus | "replay";

export interface GameViewerProps {
  gameId: string;
  completedMode?: "replay" | "results" | null;
  /**
   * If provided, renders in replay mode using the supplied data rather than
   * fetching client-side. Used for finished games loaded server-side.
   */
  initialGame?: GameDetail;
  initialMessages?: TranscriptEntry[];
  initialReplayFrames?: GameWatchReplayFrame[];
  initialPostgameMedia?: PublicPostgameMediaResponse;
  /** Canonical event sequence to open a completed replay at (path deep-link). */
  startSequence?: number;
}

export type SpectacleMessagePhase = "typing" | "revealing" | "done";

export interface FormatPresentationRosterPlayer {
  id: string;
  name: string;
}

export type FormatPresentationBallot =
  | {
      voterId: string;
      targetId: string;
      polarity: "save" | "eliminate" | null;
      forfeited?: never;
    }
  | {
      voterId: string;
      targetId: null;
      polarity: null;
      forfeited: true;
    };

export interface FormatEmpowerVoteReceipt {
  voterId: string;
  targetId: string;
  revoteTargetId: string | null;
}

export interface SafetyBouncePresentationSnapshot {
  starterId: string;
  currentActorId: string;
  safePlayerIds: string[];
  vulnerablePlayerIds: string[];
  benchPlayerIds: string[];
}

export type FormatResolutionPresentation =
  Extract<ViewerDecisionEvent, { type: "format.resolved" }>["payload"];

export interface FormatPresentationSnapshot {
  round: number;
  phase: PhaseKey;
  canonicalSequence: number;
  empoweredId: string | null;
  empoweredTally: Record<string, number> | null;
  offeredFormatIds: [LaunchFormatId, LaunchFormatId] | null;
  activeFormatId: LaunchFormatId | null;
  safetyBounce: SafetyBouncePresentationSnapshot | null;
  resolution: FormatResolutionPresentation | null;
  revealedBallots: FormatPresentationBallot[];
  eliminatedId: string | null;
}

interface FormatPresentationCueBase {
  source: "format";
  key: string;
  canonicalSequence: number;
  round: number;
  phase: PhaseKey;
  baseDurationMs: number;
  before: FormatPresentationSnapshot;
  after: FormatPresentationSnapshot;
}

export type FormatPresentationCue =
  | (FormatPresentationCueBase & {
      kind: "empowered_tally";
      empoweredId: string;
      counts: Record<string, number>;
      receipts: FormatEmpowerVoteReceipt[];
    })
  | (FormatPresentationCueBase & {
      kind: "format_menu";
      empoweredId: string;
      offeredFormatIds: [LaunchFormatId, LaunchFormatId];
    })
  | (FormatPresentationCueBase & {
      kind: "format_selected";
      stage: "choice_legible" | "rules_reveal";
      empoweredId: string;
      formatId: LaunchFormatId;
    })
  | (FormatPresentationCueBase & {
      kind: "safety_bounce_started";
      starterId: string;
    })
  | (FormatPresentationCueBase & {
      kind: "safety_bounce_pointer";
      actorId: string;
      targetId: string;
      classification: "safe" | "vulnerable";
      pointerCandidateIds: string[];
      pacing: "early" | "middle" | "closing";
    })
  | (FormatPresentationCueBase & {
      kind: "format_aggregate";
      resolution: FormatResolutionPresentation;
      ballotPresentationStatus: "revealed" | "not_applicable";
    })
  | (FormatPresentationCueBase & {
      kind: "format_roll_call";
      ballot: FormatPresentationBallot;
      rollCallIndex: number;
      rollCallCount: number;
      pacing: "brisk" | "decisive" | "final";
    })
  | (FormatPresentationCueBase & {
      kind: "format_tiebreak";
      tiebreakerId: string;
      tiedPlayerIds: string[];
    })
  | (FormatPresentationCueBase & {
      kind: "format_elimination";
      eliminatedId: string;
      resolutionKind: "clear" | "auto";
    });

export interface ClassicPresentationCue {
  source: "classic";
  key: string;
  canonicalSequence: number | null;
  round: number;
  phase: PhaseKey;
  kind: "classic_transcript";
  stage: SpectacleMessagePhase;
  baseDurationMs: number;
  sceneIndex: number;
  messageIndex: number;
}

export type PresentationCue = ClassicPresentationCue | FormatPresentationCue;
