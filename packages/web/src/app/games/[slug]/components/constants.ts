import type { PhaseKey } from "@/lib/api";
import type { RoomType, EndgameStage } from "./types";

// Dramatic display names for the transition overlay (◆ NAME ◆)
export const PHASE_TRANSITION_LABELS: Partial<Record<PhaseKey, string>> = {
  INTRODUCTION: "INTRODUCTION",
  LOBBY: "LOBBY PHASE",
  WHISPER: "WHISPER PHASE",
  RUMOR: "RUMOR PHASE",
  VOTE: "VOTE PHASE",
  POWER: "POWER PLAY",
  REVEAL: "REVEAL",
  COUNCIL: "COUNCIL VOTE",
  DIARY_ROOM: "DIARY ROOM",
  PLEA: "PLEA",
  ACCUSATION: "ACCUSATION",
  DEFENSE: "DEFENSE",
  OPENING_STATEMENTS: "OPENING STATEMENTS",
  JURY_QUESTIONS: "JURY QUESTIONS",
  CLOSING_ARGUMENTS: "CLOSING ARGUMENTS",
  JURY_VOTE: "JURY VOTE",
  END: "GAME OVER",
};

// Flavor text variants per phase — 3–5 options, randomly selected on each transition
export const PHASE_FLAVORS: Partial<Record<PhaseKey, string[]>> = {
  INTRODUCTION: [
    "The operatives have arrived. Study them carefully.",
    "Every game begins with first impressions. Make yours count.",
    "Six strangers. One winner. The game begins.",
  ],
  LOBBY: [
    "The floor is open. Every word is a move.",
    "Alliances form and fracture in the lobby. Choose your words carefully.",
    "What is said here shapes what happens next.",
    "The public stage — where trust is built and broken.",
  ],
  WHISPER: [
    "The operatives go dark. Secrets are currency.",
    "Private channels activate. Not everything can be said out loud.",
    "The shadows hide more than they reveal.",
    "Every whisper is a gamble. Who can you trust?",
  ],
  RUMOR: [
    "The whispers become rumors. Truth and lies blur.",
    "Alliances tested by misinformation. What do you believe?",
    "Information spreads. Not all of it is accurate.",
    "The rumor mill turns. Someone is spinning a story.",
  ],
  VOTE: [
    "Every operative must now cast their expose vote. Who is the most dangerous?",
    "The chamber falls silent. Each player weighs their next move.",
    "Alliances are tested. Truths and lies converge in a single vote.",
    "The moment of decision has arrived. Choose wisely.",
  ],
  POWER: [
    "One operative holds the power. What will they do with it?",
    "A single decision changes everything.",
    "Power is a gift — and a trap. All eyes are watching.",
    "The power token changes hands. The game shifts.",
  ],
  REVEAL: [
    "The votes have been counted. There is no hiding now.",
    "Truth and deception collide in a single moment.",
    "The moment of reckoning has arrived.",
    "Every secret comes to light. Every vote has a name.",
  ],
  COUNCIL: [
    "Two names. One elimination. Every vote counts.",
    "The council convenes. Someone is going home.",
    "The balance of power hangs by a thread.",
    "Final arguments have been made. The verdict awaits.",
  ],
  DIARY_ROOM: [
    "The diary room opens. What are you really thinking?",
    "Every confession stays between you and the House.",
    "Speak your truth. The game watches everything.",
  ],
  PLEA: [
    "Make your case. Words are your only shield now.",
    "Speak carefully. The council is listening.",
    "Your survival depends on what you say next.",
  ],
  ACCUSATION: [
    "The accusations begin. Point your finger — carefully.",
    "Truth and lies are about to collide.",
    "Someone is in the crosshairs. Will you pull the trigger?",
  ],
  JURY_QUESTIONS: [
    "The jury demands answers. Every word will be judged.",
    "The finalists face their reckoning. No more secrets.",
    "Questions from those who were eliminated — and have nothing to lose.",
  ],
  JURY_VOTE: [
    "The jury casts their final verdict. One player wins it all.",
    "After everything, the eliminated decide the winner.",
    "The ultimate judgment is at hand.",
  ],
};

export const PHASE_LABELS: Record<PhaseKey, string> = {
  INIT: "Waiting Room",
  INTRODUCTION: "Introductions",
  LOBBY: "Public Lobby",
  WHISPER: "Whisper Phase",
  RUMOR: "Rumor Phase",
  VOTE: "Voting",
  POWER: "Power Play",
  REVEAL: "Reveal",
  COUNCIL: "Council",
  DIARY_ROOM: "Diary Room",
  PLEA: "Plea",
  ACCUSATION: "Accusation",
  DEFENSE: "Defense",
  OPENING_STATEMENTS: "Opening Statements",
  JURY_QUESTIONS: "Jury Questions",
  CLOSING_ARGUMENTS: "Closing Arguments",
  JURY_VOTE: "Jury Vote",
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
  WHISPER: "private_rooms",
  VOTE: "tribunal",
  POWER: "tribunal",
  REVEAL: "tribunal",
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

export const HOUSE_INTROS: Partial<Record<PhaseKey, string>> = {
  WHISPER: "The operatives have gone dark. These are the conversations they didn't want you to hear.",
  REVEAL: "The votes are in. Every operative must now face the truth.",
  DIARY_ROOM: "Before they move on, The House has a few questions.",
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
export const BASE_INTERVAL_MS = 10000;
export const INTER_SCENE_PAUSE_MS = 2500;
export const TYPING_HOLD_MS = 2000;
export const POST_REVEAL_BASE_MS = 2500;
export const POST_REVEAL_PER_CHAR_MS = 35;
// Dramatic phases get extra timing multiplier on top of spectacle base
export const DRAMATIC_PHASE_MULTIPLIER = 2.5;
export const DRAMATIC_PHASES: ReadonlySet<PhaseKey> = new Set([
  "VOTE", "POWER", "REVEAL", "COUNCIL", "JURY_VOTE",
]);

// Phases that render as a scrolling group chat feed (all messages on left)
export const CHAT_FEED_PHASES: ReadonlySet<PhaseKey> = new Set([
  "INTRODUCTION", "LOBBY", "RUMOR", "ACCUSATION", "DEFENSE",
  "OPENING_STATEMENTS", "CLOSING_ARGUMENTS", "PLEA",
]);

// Chat-style timing — faster than spotlight since messages stack in a feed
export const CHAT_TYPING_HOLD_MS = 800;
export const CHAT_POST_MSG_BASE_MS = 600;
export const CHAT_POST_MSG_PER_CHAR_MS = 12;

export const ENDGAME_CONFIG: Record<
  EndgameStage,
  { title: string; color: string; body: string[] }
> = {
  reckoning: {
    title: "THE RECKONING",
    color: "text-orange-400",
    body: [
      "Four operatives remain. The alliances break down.",
      "Only one path forward: survive at any cost.",
      "",
      "Eliminated players now serve as jury.",
      "Their verdict awaits at The Judgment.",
    ],
  },
  tribunal: {
    title: "THE TRIBUNAL",
    color: "text-red-400",
    body: [
      "Three remain. The circle tightens.",
      "Every word is a weapon. Every silence, a confession.",
      "",
      "One more will fall before The Judgment.",
    ],
  },
  judgment: {
    title: "THE JUDGMENT",
    color: "text-amber-400",
    body: [],
  },
};
