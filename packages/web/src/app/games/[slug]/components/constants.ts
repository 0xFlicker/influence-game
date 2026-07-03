import type { PhaseKey } from "@/lib/api";
import type { RoomType, EndgameStage } from "./types";

// Dramatic display names for the transition overlay (◆ NAME ◆)
export const PHASE_TRANSITION_LABELS: Partial<Record<PhaseKey, string>> = {
  INTRODUCTION: "INTRODUCTION",
  LOBBY: "LOBBY PHASE",
  MINGLE_I: "MINGLE I",
  PRE_VOTE_HUDDLE: "ALLIANCE HUDDLES",
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

// Flavor text variants per phase — 3–5 options, randomly selected on each transition
export const PHASE_FLAVORS: Partial<Record<PhaseKey, string[]>> = {
  INTRODUCTION: [
    "The operatives have arrived. Study them carefully.",
    "Every game begins with first impressions. Make yours count.",
    "Six strangers. One winner. The game begins.",
  ],
  LOBBY: [
    "The floor is open. Every word is a move.",
    "Trust forms and fractures in the lobby. Choose your words carefully.",
    "What is said here shapes what happens next.",
    "The public stage — where trust is built and broken.",
  ],
  MINGLE_I: [
    "The pre-vote Mingle rooms open.",
    "Private conversations set up the official deal window.",
    "The agents talk first, then decide which alliances become official.",
  ],
  PRE_VOTE_HUDDLE: [
    "The House opens scarce alliance huddle time.",
    "Active alliances get one last beat before the Vote.",
    "The deals move behind closed doors.",
  ],
  MINGLE: [
    "The Mingle rooms open. Secrets are currency.",
    "Private rooms activate. Not everything can be said out loud.",
    "Every room choice is a signal. Every absence is a tell.",
    "Agents move through the Mingle. Who can you trust?",
  ],
  POST_VOTE_MINGLE: [
    "The votes are public. The private rooms are not.",
    "Receipts are fresh. Promises are suddenly expensive.",
    "The Mingle rooms reopen under pressure.",
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
  PRE_COUNCIL_HUDDLE: [
    "Alliance huddles reopen before Council.",
    "The Council vote is close enough to taste.",
    "Last-minute coordination begins.",
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
  MINGLE_I: "Mingle I",
  PRE_VOTE_HUDDLE: "Pre-Vote Huddles",
  // WHISPER is a distinct historical phase; current room movement uses MINGLE.
  WHISPER: "Whisper",
  MINGLE: "Mingle",
  POST_VOTE_MINGLE: "Post-Vote Mingle",
  RUMOR: "Rumor Phase",
  VOTE: "Voting",
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

export const HOUSE_INTROS: Partial<Record<PhaseKey, string>> = {
  MINGLE_I: "The pre-vote Mingle rooms are open, then named alliances can become official by explicit consent.",
  PRE_VOTE_HUDDLE: "The House is checking which alliances get time before the Vote.",
  MINGLE: "The Mingle rooms are open. These are the conversations they didn't want you to hear.",
  POST_VOTE_MINGLE: "The votes are public. The private rooms reopen under pressure.",
  REVEAL: "The votes are in. Every operative must now face the truth.",
  PRE_COUNCIL_HUDDLE: "The House is checking which alliances get time before Council.",
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

// Phases that get an extra digestion pause at the end before transitioning
export const PACED_PHASES: ReadonlySet<PhaseKey> = new Set([
  "INTRODUCTION", "LOBBY", "MINGLE_I", "PRE_VOTE_HUDDLE", "MINGLE", "POST_VOTE_MINGLE", "PRE_COUNCIL_HUDDLE",
]);

// Extra pause at the end of paced phases (ms at 1x speed)
export const PHASE_END_PAUSE_MS = 5000;

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
