import type { PhaseKey, TranscriptEntry, GamePlayer, GameDetail } from "@/lib/api";

export type RoomType = "lobby" | "private_rooms" | "tribunal" | "diary" | "endgame";

export interface ReplayScene {
  id: string;
  round: number;
  phase: PhaseKey;
  roomType: RoomType;
  messages: TranscriptEntry[];
  houseIntro: string | null;
  /** Present on per-room whisper scenes (spectacle mode splits whisper phases by room). */
  whisperRoom?: { roomId: number; playerNames: string[] };
}

export interface WhisperRoomStage {
  roomId: number;
  playerIds: string[];
  playerNames: string[];
  messages: TranscriptEntry[];
}

export interface WhisperStageData {
  allocationText: string | null;
  rooms: WhisperRoomStage[];
  commons: GamePlayer[];
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

export interface GameViewerProps {
  gameId: string;
  /**
   * If provided, renders in replay mode using the supplied data rather than
   * fetching client-side. Used for finished games loaded server-side.
   */
  initialGame?: GameDetail;
  initialMessages?: TranscriptEntry[];
  /** "classic" forces the old message-stepper replay; "dramatic" (or undefined) uses scene-based replay for completed games. */
  mode?: string;
}

export type SpectacleMessagePhase = "typing" | "revealing" | "done";
