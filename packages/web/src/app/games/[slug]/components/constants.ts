import type { PhaseKey } from "@/lib/api";
import type { RoomType } from "./types";

// Display names shared by the phase header and House bridge.
export const PHASE_TRANSITION_LABELS: Partial<Record<PhaseKey, string>> = {
  INTRODUCTION: "INTRODUCTION",
  LOBBY: "LOBBY PHASE",
  MINGLE_I: "MINGLE I",
  PRE_VOTE_HUDDLE: "ALLIANCE HUDDLES",
  FORMAT_MENU: "FORMAT MENU",
  FORMAT_PICK: "FORMAT SELECTION",
  FORMAT_MINGLE: "FORMAT MINGLE",
  FORMAT_RESOLVE: "FORMAT RESOLUTION",
  MINGLE: "MINGLE",
  POST_VOTE_MINGLE: "POST-VOTE MINGLE",
  RUMOR: "RUMOR PHASE",
  VOTE: "VOTE PHASE",
  POWER: "POWER PLAY",
  REVEAL: "REVEAL",
  PRE_COUNCIL_HUDDLE: "ALLIANCE HUDDLES",
  COUNCIL: "COUNCIL VOTE",
  DIARY_ROOM: "DIARY ROOM",
  PLEA: "PLEA",
  ACCUSATION: "ACCUSATION",
  DEFENSE: "DEFENSE",
  OPENING_STATEMENTS: "OPENING STATEMENTS",
  JURY_QUESTIONS: "JURY QUESTIONS",
  CLOSING_ARGUMENTS: "CLOSING ARGUMENTS",
  JURY_VOTE: "JURY VOTE",
  SUSPENDED: "SUSPENDED",
  END: "GAME OVER",
};

export const PHASE_LABELS: Record<PhaseKey, string> = {
  INIT: "Waiting Room",
  INTRODUCTION: "Introductions",
  LOBBY: "Public Lobby",
  MINGLE_I: "Mingle I",
  PRE_VOTE_HUDDLE: "Pre-Vote Huddles",
  // WHISPER is a distinct historical phase; current room movement uses MINGLE.
  WHISPER: "Whisper",
  MINGLE: "Mingle",
  POST_VOTE_MINGLE: "Post-Vote Mingle",
  RUMOR: "Rumor Phase",
  VOTE: "Voting",
  FORMAT_MENU: "Format Menu",
  FORMAT_PICK: "Format Selection",
  FORMAT_MINGLE: "Format Mingle",
  FORMAT_RESOLVE: "Format Resolution",
  POWER: "Power Play",
  REVEAL: "Reveal",
  PRE_COUNCIL_HUDDLE: "Pre-Council Huddles",
  COUNCIL: "Council",
  DIARY_ROOM: "Diary Room",
  PLEA: "Plea",
  ACCUSATION: "Accusation",
  DEFENSE: "Defense",
  OPENING_STATEMENTS: "Opening Statements",
  JURY_QUESTIONS: "Jury Questions",
  CLOSING_ARGUMENTS: "Closing Arguments",
  JURY_VOTE: "Jury Vote",
  SUSPENDED: "Suspended",
  END: "Game Over",
};

// Phase accent color — driven by CSS custom property via data-phase on root.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function phaseColor(_phase: PhaseKey): string {
  return "text-phase";
}

// Set data-phase attribute on document root for CSS variable cascade.
export function setPhaseAttr(phase: PhaseKey) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-phase", phase);
  }
}

// Endgame phases for gold overlay
export const ENDGAME_PHASES: ReadonlySet<PhaseKey> = new Set([
  "PLEA", "ACCUSATION", "DEFENSE", "OPENING_STATEMENTS",
  "JURY_QUESTIONS", "CLOSING_ARGUMENTS", "JURY_VOTE", "END",
]);

export function setEndgameAttr(phase: PhaseKey) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-endgame", ENDGAME_PHASES.has(phase) ? "true" : "false");
  }
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const PHASE_TO_ROOM: Partial<Record<PhaseKey, RoomType>> = {
  INTRODUCTION: "lobby",
  LOBBY: "lobby",
  RUMOR: "lobby",
  MINGLE_I: "private_rooms",
  PRE_VOTE_HUDDLE: "private_rooms",
  MINGLE: "private_rooms",
  POST_VOTE_MINGLE: "private_rooms",
  FORMAT_MINGLE: "private_rooms",
  VOTE: "tribunal",
  POWER: "tribunal",
  REVEAL: "tribunal",
  PRE_COUNCIL_HUDDLE: "private_rooms",
  COUNCIL: "tribunal",
  DIARY_ROOM: "diary",
  PLEA: "endgame",
  ACCUSATION: "endgame",
  DEFENSE: "endgame",
  OPENING_STATEMENTS: "endgame",
  JURY_QUESTIONS: "endgame",
  CLOSING_ARGUMENTS: "endgame",
  JURY_VOTE: "endgame",
  END: "endgame",
};

export const ROOM_TYPE_COLORS: Record<RoomType, string> = {
  lobby: "bg-blue-500",
  private_rooms: "bg-purple-500",
  tribunal: "bg-red-500",
  diary: "bg-purple-700",
  endgame: "bg-amber-500",
};

export const ROOM_TYPE_BORDERS: Record<RoomType, string> = {
  lobby: "border-blue-900/20 bg-blue-950/5",
  private_rooms: "border-purple-900/20 bg-purple-950/10",
  tribunal: "border-red-900/20 bg-red-950/5",
  diary: "border-purple-900/30 bg-purple-950/10",
  endgame: "border-amber-900/20 bg-amber-950/5",
};

export function phaseToRoomType(phase: PhaseKey): RoomType {
  return PHASE_TO_ROOM[phase] ?? "lobby";
}

// Speed multipliers for dramatic replay
export const SPEED_OPTIONS = [
  { label: "0.5x", value: 0.5 },
  { label: "1x", value: 1 },
  { label: "2x", value: 2 },
  { label: "4x", value: 4 },
] as const;

// Spectacle mode timing — 1x is ~0.25x the old speed
// All base constants tuned +33% from original values after QA feedback (INF-84).
export const BASE_INTERVAL_MS = 13000;
export const INTER_SCENE_PAUSE_MS = 3300;
export const TYPING_HOLD_MS = 2700;
export const POST_REVEAL_BASE_MS = 3300;
export const POST_REVEAL_PER_CHAR_MS = 47;
// Dramatic phases get extra timing multiplier on top of spectacle base
export const DRAMATIC_PHASE_MULTIPLIER = 2.5;
export const DRAMATIC_PHASES: ReadonlySet<PhaseKey> = new Set([
  "PRE_VOTE_HUDDLE", "VOTE", "POWER", "REVEAL", "PRE_COUNCIL_HUDDLE", "COUNCIL", "JURY_VOTE",
]);

// Phases that render as a scrolling group chat feed (all messages on left).
// RUMOR is intentionally not a current live-loop chat phase; legacy replay
// records can still render through the generic phase label/room mapping.
export const CHAT_FEED_PHASES: ReadonlySet<PhaseKey> = new Set([
  "INTRODUCTION", "LOBBY", "ACCUSATION", "DEFENSE",
  "OPENING_STATEMENTS", "CLOSING_ARGUMENTS", "PLEA",
]);

// Chat-style timing — faster than spotlight since messages stack in a feed
// Tuned +33% from original values after QA feedback (INF-84).
export const CHAT_TYPING_HOLD_MS = 1100;
export const CHAT_POST_MSG_BASE_MS = 800;
export const CHAT_POST_MSG_PER_CHAR_MS = 16;

// Hold time after the last message in diary/whisper scenes before transitioning
export const DIARY_WHISPER_SCENE_END_HOLD_MS = 4000;
