"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { getGame, getGameTranscript, getAuthToken, type GameDetail, type GamePlayer, type GameSummary, type TranscriptEntry, type WsGameEvent, type WsTranscriptEntry, type PhaseKey, type TranscriptScope } from "@/lib/api";
import { Typewriter } from "@/components/typewriter";
import { audioCue } from "@/lib/audio-cues";
import { JoinGameModal } from "@/app/dashboard/join-game-modal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Dramatic display names for the transition overlay (◆ NAME ◆)
const PHASE_TRANSITION_LABELS: Partial<Record<PhaseKey, string>> = {
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
const PHASE_FLAVORS: Partial<Record<PhaseKey, string[]>> = {
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

const PHASE_LABELS: Record<PhaseKey, string> = {
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

const PHASE_COLORS: Partial<Record<PhaseKey, string>> = {
  LOBBY: "text-blue-400",
  WHISPER: "text-purple-400",
  RUMOR: "text-yellow-400",
  VOTE: "text-orange-400",
  POWER: "text-red-400",
  REVEAL: "text-pink-400",
  COUNCIL: "text-red-500",
  JURY_VOTE: "text-amber-400",
  END: "text-green-400",
};

function phaseColor(phase: PhaseKey): string {
  return PHASE_COLORS[phase] ?? "text-white/60";
}

function personaEmoji(persona: string): string {
  const map: Record<string, string> = {
    honest: "🕊",
    strategic: "♟",
    deceptive: "🎭",
    paranoid: "👁",
    social: "🤝",
    aggressive: "⚔",
    loyalist: "🛡",
    observer: "🔍",
    diplomat: "🌿",
    wildcard: "🃏",
  };
  return map[persona] ?? "●";
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ---------------------------------------------------------------------------
// Dramatic Replay — Scene model + builder
// ---------------------------------------------------------------------------

type RoomType = "lobby" | "private_rooms" | "tribunal" | "diary" | "endgame";

interface ReplayScene {
  id: string;
  round: number;
  phase: PhaseKey;
  roomType: RoomType;
  messages: TranscriptEntry[];
  houseIntro: string | null;
}

const PHASE_TO_ROOM: Partial<Record<PhaseKey, RoomType>> = {
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

const ROOM_TYPE_COLORS: Record<RoomType, string> = {
  lobby: "bg-blue-500",
  private_rooms: "bg-purple-500",
  tribunal: "bg-red-500",
  diary: "bg-purple-700",
  endgame: "bg-amber-500",
};

const ROOM_TYPE_BORDERS: Record<RoomType, string> = {
  lobby: "border-blue-900/20 bg-blue-950/5",
  private_rooms: "border-purple-900/20 bg-purple-950/10",
  tribunal: "border-red-900/20 bg-red-950/5",
  diary: "border-purple-900/30 bg-purple-950/10",
  endgame: "border-amber-900/20 bg-amber-950/5",
};

const HOUSE_INTROS: Partial<Record<PhaseKey, string>> = {
  WHISPER: "The operatives have gone dark. These are the conversations they didn't want you to hear.",
  REVEAL: "The votes are in. Every operative must now face the truth.",
  DIARY_ROOM: "Before they move on, The House has a few questions.",
};

function phaseToRoomType(phase: PhaseKey): RoomType {
  return PHASE_TO_ROOM[phase] ?? "lobby";
}

function buildReplayScenes(transcript: TranscriptEntry[]): ReplayScene[] {
  const grouped = new Map<string, TranscriptEntry[]>();
  for (const msg of transcript) {
    const key = `R${msg.round}-${msg.phase}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(msg);
  }

  const scenes: ReplayScene[] = [];
  for (const [id, msgs] of grouped.entries()) {
    const { round, phase } = msgs[0]!;
    const roomType = phaseToRoomType(phase);
    scenes.push({
      id,
      round,
      phase,
      roomType,
      messages: msgs,
      houseIntro: HOUSE_INTROS[phase] ?? null,
    });
  }

  return scenes;
}

// Speed multipliers for dramatic replay
const SPEED_OPTIONS = [
  { label: "0.5x", value: 0.5 },
  { label: "1x", value: 1 },
  { label: "2x", value: 2 },
  { label: "4x", value: 4 },
] as const;

const BASE_INTERVAL_MS = 2500;
const INTER_SCENE_PAUSE_MS = 800;

interface WhisperRoomStage {
  roomId: number;
  playerIds: string[];
  playerNames: string[];
  messages: TranscriptEntry[];
}

interface WhisperStageData {
  allocationText: string | null;
  rooms: WhisperRoomStage[];
  commons: GamePlayer[];
}

function canonicalPairKey(a: string, b: string): string {
  return [a, b].sort((left, right) => left.localeCompare(right)).join("::");
}

function parseWhisperAllocation(text: string, players: GamePlayer[]): {
  rooms: Array<{ roomId: number; playerIds: string[]; playerNames: string[] }>;
  commons: GamePlayer[];
} {
  const playerByName = new Map(players.map((player) => [player.name.toLowerCase(), player]));
  const rooms: Array<{ roomId: number; playerIds: string[]; playerNames: string[] }> = [];

  for (const match of text.matchAll(/Room\s+(\d+):\s*([^|]+?)\s*&\s*([^|]+?)(?=\s*\||$)/g)) {
    const roomId = Number(match[1]);
    const leftName = match[2]?.trim();
    const rightName = match[3]?.trim();
    if (!leftName || !rightName || Number.isNaN(roomId)) continue;

    const leftPlayer = playerByName.get(leftName.toLowerCase());
    const rightPlayer = playerByName.get(rightName.toLowerCase());

    rooms.push({
      roomId,
      playerIds: [leftPlayer?.id, rightPlayer?.id].filter((value): value is string => Boolean(value)),
      playerNames: [leftName, rightName],
    });
  }

  const commonsText = text.match(/Commons:\s*(.+)$/)?.[1]?.trim() ?? "";
  const commons = commonsText.length === 0
    ? []
    : commonsText
        .split(",")
        .map((name) => name.trim())
        .map((name) => playerByName.get(name.toLowerCase()))
        .filter((player): player is GamePlayer => Boolean(player));

  return { rooms, commons };
}

function buildWhisperStageData(
  phaseEntries: TranscriptEntry[],
  players: GamePlayer[],
): WhisperStageData {
  const ordered = [...phaseEntries].sort((left, right) => left.timestamp - right.timestamp);
  const allocationEntry = [...ordered]
    .reverse()
    .find((entry) => entry.scope === "system" && /Room\s+\d+:/.test(entry.text));

  const parsed = allocationEntry
    ? parseWhisperAllocation(allocationEntry.text, players)
    : { rooms: [], commons: [] as GamePlayer[] };

  const roomsById = new Map<number, WhisperRoomStage>();
  const roomsByPair = new Map<string, WhisperRoomStage>();

  for (const room of parsed.rooms) {
    const stageRoom: WhisperRoomStage = {
      roomId: room.roomId,
      playerIds: room.playerIds,
      playerNames: room.playerNames,
      messages: [],
    };
    roomsById.set(room.roomId, stageRoom);
    if (room.playerIds.length === 2) {
      roomsByPair.set(canonicalPairKey(room.playerIds[0]!, room.playerIds[1]!), stageRoom);
    }
  }

  for (const entry of ordered) {
    if (entry.scope !== "whisper" || !entry.fromPlayerId) continue;
    const partnerId = entry.toPlayerIds?.[0];
    let room = entry.roomId != null ? roomsById.get(entry.roomId) : undefined;

    if (!room && partnerId) {
      room = roomsByPair.get(canonicalPairKey(entry.fromPlayerId, partnerId));
    }

    if (!room) {
      const inferredRoomId = entry.roomId ?? roomsById.size + 1;
      const inferredNames = [
        players.find((player) => player.id === entry.fromPlayerId)?.name ?? entry.fromPlayerId,
        partnerId
          ? players.find((player) => player.id === partnerId)?.name ?? partnerId
          : "Unknown",
      ];
      room = {
        roomId: inferredRoomId,
        playerIds: partnerId ? [entry.fromPlayerId, partnerId] : [entry.fromPlayerId],
        playerNames: inferredNames,
        messages: [],
      };
      roomsById.set(room.roomId, room);
      if (partnerId) {
        roomsByPair.set(canonicalPairKey(entry.fromPlayerId, partnerId), room);
      }
    }

    room.messages.push(entry);
  }

  const rooms = Array.from(roomsById.values()).sort((left, right) => left.roomId - right.roomId);
  return {
    allocationText: allocationEntry?.text ?? null,
    rooms,
    commons: parsed.commons,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConnectionBadge({ status }: { status: "connecting" | "live" | "disconnected" | "reconnecting" | "replay" }) {
  const configs = {
    connecting: { dot: "bg-yellow-400 animate-pulse", text: "Connecting…", cls: "text-yellow-400" },
    live: { dot: "bg-green-400 animate-pulse", text: "Live", cls: "text-green-400" },
    disconnected: { dot: "bg-red-400", text: "Disconnected", cls: "text-red-400" },
    reconnecting: { dot: "bg-orange-400 animate-pulse", text: "Reconnecting…", cls: "text-orange-400" },
    replay: { dot: "bg-indigo-400", text: "Replay", cls: "text-indigo-400" },
  };
  const cfg = configs[status];
  return (
    <span className={`flex items-center gap-1.5 text-xs font-medium ${cfg.cls}`}>
      <span className={`inline-block w-2 h-2 rounded-full ${cfg.dot}`} />
      {cfg.text}
    </span>
  );
}

function PhaseHeader({ game, isReplay }: { game: GameDetail; isReplay: boolean }) {
  const alive = game.players.filter((p) => p.status === "alive").length;
  const total = game.players.length;
  const roundPct = Math.round((game.currentRound / game.maxRounds) * 100);

  return (
    <div className="border border-white/10 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <span className={`text-sm font-semibold uppercase tracking-wider ${phaseColor(game.currentPhase)}`}>
            {PHASE_LABELS[game.currentPhase] ?? game.currentPhase}
          </span>
          <div className="text-white/40 text-xs mt-0.5">
            Round {game.currentRound} / {game.maxRounds}
            {!isReplay && game.status === "in_progress" && (
              <span className="ml-3">🟢 {alive} alive · ☠ {total - alive} out</span>
            )}
            {game.status === "completed" && game.winner && (
              <span className="ml-3 text-green-400">🏆 {game.winner} wins</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="h-1.5 bg-white/10 rounded-full w-32 overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${roundPct}%` }}
            />
          </div>
          <span className="text-white/25 text-xs mt-1 inline-block">{roundPct}% complete</span>
        </div>
      </div>
    </div>
  );
}

function PlayerRoster({
  players,
  empoweredPlayerId,
  eliminatedRounds,
  recentlyUnshielded,
  speedrun,
}: {
  players: GamePlayer[];
  empoweredPlayerId: string | null;
  eliminatedRounds: ReadonlyMap<string, number>;
  recentlyUnshielded: ReadonlySet<string>;
  speedrun: boolean;
}) {
  const alive = players.filter((p) => p.status === "alive");
  const eliminated = players.filter((p) => p.status === "eliminated");

  return (
    <div className="border border-white/10 rounded-xl p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-white/30 mb-3">
        Players · {alive.length} alive
      </h3>
      <div className="space-y-1.5">
        {alive.map((p) => {
          const isEmpowered = p.id === empoweredPlayerId;
          const isShattered = !speedrun && recentlyUnshielded.has(p.id);

          return (
            <div
              key={p.id}
              className={`flex items-center gap-2 text-sm rounded-lg px-1 py-0.5 transition-all duration-300 ${
                isEmpowered
                  ? "border border-amber-500/40 bg-amber-950/20 shadow-[0_0_8px_rgba(245,158,11,0.15)]"
                  : ""
              }`}
            >
              <span className="text-base">{personaEmoji(p.persona)}</span>
              <span className={`font-medium ${isEmpowered ? "text-amber-200" : "text-white"}`}>
                {p.name}
              </span>
              <span className="text-white/30 text-xs flex-1 truncate">{p.persona}</span>
              {/* Crown badge — empowered player */}
              {isEmpowered && (
                <span className="text-amber-400 text-sm" title="Empowered">
                  👑
                </span>
              )}
              {/* Shield badge — protected player */}
              {p.shielded && (
                <span
                  className="text-blue-400 text-sm"
                  title="Protected this round"
                >
                  🛡
                </span>
              )}
              {/* Shield shatter — just expired (live mode only) */}
              {isShattered && (
                <span className="text-blue-300/70 text-sm animate-shield-shatter">🛡</span>
              )}
            </div>
          );
        })}
        {eliminated.length > 0 && (
          <>
            <div className="border-t border-white/5 my-2" />
            {eliminated.map((p) => {
              const elimRound = eliminatedRounds.get(p.id);
              return (
                <div key={p.id} className="flex items-center gap-2 text-sm">
                  <span className="text-base grayscale opacity-40">💀</span>
                  <span className="text-white/35 line-through">{p.name}</span>
                  {elimRound != null && (
                    <span className="text-white/20 text-xs ml-auto">R{elimRound}</span>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ msg, players }: { msg: TranscriptEntry; players: GamePlayer[] }) {
  const isSystem = msg.scope === "system";
  const isDiary = msg.scope === "diary";
  const isWhisper = msg.scope === "whisper";

  if (isSystem) {
    return (
      <div className="text-center py-1">
        <span className="text-xs text-white/30 bg-white/5 px-3 py-1 rounded-full">
          {msg.text}
        </span>
      </div>
    );
  }

  if (isDiary) {
    // Fallback for any unmatched diary entries
    const isDiaryQuestion = msg.fromPlayerId?.startsWith("House ->");
    if (isDiaryQuestion) {
      return (
        <div className="border border-purple-900/30 bg-purple-950/20 rounded-lg px-3 py-2 text-xs text-purple-300/60 italic">
          <span className="not-italic font-medium text-purple-400/70 mr-1">📔 House:</span>
          {msg.text}
        </div>
      );
    }
    const player = players.find((p) => p.name === msg.fromPlayerId);
    return (
      <div className="ml-4 border-l-2 border-purple-700/40 pl-3 py-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          {player && <span className="text-sm">{personaEmoji(player.persona)}</span>}
          <span className="text-xs font-semibold text-white/60">{msg.fromPlayerId}</span>
        </div>
        <p className="text-xs text-white/55 italic">{msg.text}</p>
      </div>
    );
  }

  const player = players.find((p) => p.id === msg.fromPlayerId)
    ?? players.find((p) => p.name === msg.fromPlayerId);
  const name = msg.fromPlayerName ?? player?.name ?? msg.fromPlayerId ?? "Unknown";
  const isEliminated = player?.status === "eliminated";

  return (
    <div className={`flex gap-3 ${isEliminated ? "opacity-50" : ""}`}>
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-sm">
        {player ? personaEmoji(player.persona) : "?"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-xs font-semibold text-white/80">{name}</span>
          {isWhisper && (
            <span className="text-xs text-purple-400/70">🤫 whisper</span>
          )}
          <span className="text-white/20 text-xs ml-auto flex-shrink-0">{formatTime(msg.timestamp)}</span>
        </div>
        <p className="text-sm text-white/70 leading-relaxed break-words">{msg.text}</p>
      </div>
    </div>
  );
}

function ReplayControls({
  current,
  total,
  onPrev,
  onNext,
  onFirst,
  onLast,
}: {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLast: () => void;
}) {
  const btnCls =
    "text-xs border border-white/10 hover:border-white/25 text-white/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed";
  return (
    <div className="flex items-center gap-2 justify-center py-3 border-t border-white/10">
      <button onClick={onFirst} disabled={current === 0} className={btnCls}>
        ⏮
      </button>
      <button onClick={onPrev} disabled={current === 0} className={btnCls}>
        ←
      </button>
      <span className="text-xs text-white/30 px-2">
        {current + 1} / {total}
      </span>
      <button onClick={onNext} disabled={current >= total - 1} className={btnCls}>
        →
      </button>
      <button onClick={onLast} disabled={current >= total - 1} className={btnCls}>
        ⏭
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase transition overlay
// ---------------------------------------------------------------------------

interface TransitionState {
  phase: PhaseKey;
  round: number;
  maxRounds: number;
  aliveCount: number;
  flavorText: string;
}

function PhaseTransitionOverlay({
  transition,
  onDismiss,
}: {
  transition: TransitionState;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; });

  useEffect(() => {
    // Brief tick to trigger CSS fade-in transition
    const fadeIn = setTimeout(() => setVisible(true), 16);
    // Start fade-out after 2s hold
    const fadeOut = setTimeout(() => setVisible(false), 2000);
    // Unmount after fade-out completes (300ms)
    const dismiss = setTimeout(() => onDismissRef.current(), 2300);

    return () => {
      clearTimeout(fadeIn);
      clearTimeout(fadeOut);
      clearTimeout(dismiss);
    };
  }, []);

  const label =
    PHASE_TRANSITION_LABELS[transition.phase] ?? transition.phase.replace(/_/g, " ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 300ms ease-in-out",
        pointerEvents: "none",
      }}
    >
      <div className="text-center px-8 max-w-2xl">
        <p className="text-white/20 text-sm tracking-[0.4em] uppercase mb-8">◆ ◆ ◆</p>
        <h1
          className={`text-3xl md:text-4xl font-bold tracking-widest uppercase mb-6 ${phaseColor(transition.phase)}`}
        >
          ◆&nbsp;&nbsp;{label}&nbsp;&nbsp;◆
        </h1>
        {transition.flavorText && (
          <p className="text-white/55 text-base md:text-lg leading-relaxed mb-8 italic">
            {transition.flavorText}
          </p>
        )}
        <p className="text-white/25 text-sm tracking-widest uppercase">
          Round {transition.round} of {transition.maxRounds}&nbsp;·&nbsp;{transition.aliveCount} alive
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diary Q&A grouping
// ---------------------------------------------------------------------------

type GroupedMessage =
  | { kind: "msg"; entry: TranscriptEntry }
  | { kind: "diary_pair"; question: TranscriptEntry; answer: TranscriptEntry | null; id: number }
  | { kind: "diary_orphan_answer"; answer: TranscriptEntry };

/** Extract the player name from a diary `fromPlayerId` field.
 *  House question format: "House -> Alice" or "House -> Alice (juror)"
 *  Player answer format:  "Alice" or "Alice (juror)"
 */
function diaryPlayerName(fromPlayerId: string): string {
  return fromPlayerId.replace(/^House -> /, "").replace(/ \(juror\)$/, "");
}

/**
 * Groups diary entries into Q&A pairs by matching "House -> X" questions
 * with "X" answers. Handles parallel interleaving from Promise.all.
 */
function groupMessages(messages: TranscriptEntry[]): GroupedMessage[] {
  const result: GroupedMessage[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.scope !== "diary") {
      result.push({ kind: "msg", entry: msg });
      i++;
      continue;
    }

    // Collect a contiguous batch of diary entries
    const batch: TranscriptEntry[] = [];
    while (i < messages.length && messages[i].scope === "diary") {
      batch.push(messages[i]);
      i++;
    }

    const questions = batch.filter((e) => e.fromPlayerId?.startsWith("House ->"));
    const answers = batch.filter((e) => !e.fromPlayerId?.startsWith("House ->"));
    const usedAnswerIds = new Set<number>();

    for (const q of questions) {
      const targetName = q.fromPlayerId ? diaryPlayerName(q.fromPlayerId) : null;
      const match = targetName
        ? answers.find(
            (a) => !usedAnswerIds.has(a.id) && diaryPlayerName(a.fromPlayerId ?? "") === targetName,
          )
        : undefined;

      if (match) usedAnswerIds.add(match.id);
      result.push({ kind: "diary_pair", question: q, answer: match ?? null, id: q.id });
    }

    for (const a of answers) {
      if (!usedAnswerIds.has(a.id)) {
        result.push({ kind: "diary_orphan_answer", answer: a });
      }
    }
  }

  return result;
}

function DiaryQACard({
  question,
  answer,
  players,
}: {
  question: TranscriptEntry;
  answer: TranscriptEntry | null;
  players: GamePlayer[];
}) {
  const [open, setOpen] = useState(true);

  const targetName = question.fromPlayerId ? diaryPlayerName(question.fromPlayerId) : null;
  const player = targetName ? players.find((p) => p.name === targetName) : null;
  const isJuror = question.fromPlayerId?.includes("(juror)") ?? false;

  return (
    <div className="border border-purple-900/40 bg-purple-950/20 rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-purple-900/20 transition-colors"
      >
        <span className="font-semibold text-purple-400/80 uppercase tracking-wider">
          📔 Diary Room
        </span>
        {player && (
          <span className="text-purple-300/60 flex items-center gap-1">
            <span>{personaEmoji(player.persona)}</span>
            <span>{player.name}{isJuror ? " (juror)" : ""}</span>
          </span>
        )}
        {!player && targetName && (
          <span className="text-purple-300/50">{targetName}{isJuror ? " (juror)" : ""}</span>
        )}
        <span className="ml-auto text-purple-400/30">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {/* House question */}
          <p className="text-purple-300/60 italic leading-relaxed">{question.text}</p>

          {/* Player answer */}
          {answer ? (
            <div className="ml-3 border-l-2 border-purple-700/40 pl-3">
              <div className="flex items-center gap-1.5 mb-0.5">
                {player && <span className="text-sm">{personaEmoji(player.persona)}</span>}
                <span className="font-semibold text-white/70">{targetName}</span>
                <span className="text-white/20 ml-auto flex-shrink-0">
                  {formatTime(answer.timestamp)}
                </span>
              </div>
              <p className="text-white/60 leading-relaxed">{answer.text}</p>
            </div>
          ) : (
            <p className="ml-3 text-purple-400/30 italic">Awaiting response…</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Whisper phase quiet-state view
// ---------------------------------------------------------------------------

function WhisperPhaseView({
  phaseEntries,
  players,
  phaseKey,
}: {
  phaseEntries: TranscriptEntry[];
  players: GamePlayer[];
  phaseKey: string;
}) {
  const stage = buildWhisperStageData(phaseEntries, players);
  const [pinnedShot, setPinnedShot] = useState<string | null>(null);
  const [autoIndex, setAutoIndex] = useState(0);
  const [showAllocationReveal, setShowAllocationReveal] = useState(true);

  useEffect(() => {
    setPinnedShot(null);
    setAutoIndex(0);
    setShowAllocationReveal(true);
  }, [phaseKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowAllocationReveal(false), 2000);
    return () => window.clearTimeout(timer);
  }, [phaseKey]);

  const shots = [
    ...stage.rooms.map((room) => ({ key: `room-${room.roomId}`, kind: "room" as const, room })),
    ...(stage.commons.length > 0
      ? [{ key: "commons", kind: "commons" as const, players: stage.commons }]
      : []),
  ];

  useEffect(() => {
    if (showAllocationReveal || pinnedShot || shots.length <= 1) return;
    const activeShot = shots[autoIndex % shots.length];
    const holdMs = activeShot?.kind === "commons" ? 4000 : 9000;
    const timer = window.setTimeout(() => {
      setAutoIndex((index) => (index + 1) % shots.length);
    }, holdMs);
    return () => window.clearTimeout(timer);
  }, [autoIndex, pinnedShot, shots, showAllocationReveal]);

  const activeShot = pinnedShot
    ? shots.find((shot) => shot.key === pinnedShot) ?? shots[0]
    : shots[autoIndex % Math.max(shots.length, 1)];

  const activeRoom = activeShot?.kind === "room" ? activeShot.room : null;
  const activeCommons = activeShot?.kind === "commons" ? activeShot.players : null;

  return (
    <div className="border border-purple-900/20 bg-[radial-gradient(circle_at_top,rgba(120,57,191,0.2),rgba(9,4,19,0.95)_62%)] rounded-xl flex-1 overflow-y-auto p-4 md:p-6 min-h-[420px] max-h-[600px]">
      <div className="text-center mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-purple-300/70 mb-1">
          Whisper Rooms
        </p>
        <p className="text-sm text-white/55 italic min-h-[1.5rem]">
          <Typewriter
            key={phaseKey}
            text="The House has assigned private rooms. Every secret has an audience."
            rate="house"
          />
        </p>
      </div>

      {showAllocationReveal ? (
        <div className="space-y-4 animate-[fadeIn_0.35s_ease-out]">
          <p className="text-center text-xs uppercase tracking-[0.25em] text-purple-300/45">
            Room Allocation Reveal
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {stage.rooms.map((room, index) => (
              <div
                key={room.roomId}
                className="rounded-2xl border border-purple-500/20 bg-black/25 px-4 py-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] animate-[fadeIn_0.45s_ease-out]"
                style={{ animationDelay: `${index * 120}ms` }}
              >
                <p className="text-[11px] uppercase tracking-[0.28em] text-purple-300/45 mb-3">
                  Room {room.roomId}
                </p>
                <p className="text-lg font-semibold text-white">
                  {room.playerNames.join("  ×  ")}
                </p>
              </div>
            ))}
          </div>
          {stage.commons.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-center animate-[fadeIn_0.55s_ease-out]">
              <p className="text-[11px] uppercase tracking-[0.28em] text-white/35 mb-2">Commons</p>
              <p className="text-sm text-white/65">
                {stage.commons.map((player) => player.name).join(", ")}
              </p>
            </div>
          )}
        </div>
      ) : shots.length === 0 ? (
        <div className="rounded-2xl border border-purple-900/20 bg-black/20 p-8 text-center text-white/45">
          Waiting for the House to finish assigning rooms.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {stage.rooms.map((room) => {
              const tabKey = `room-${room.roomId}`;
              const isPinned = pinnedShot === tabKey;
              return (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => setPinnedShot((current) => current === tabKey ? null : tabKey)}
                  className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.2em] transition-colors ${
                    isPinned
                      ? "border-purple-300/50 bg-purple-300/15 text-white"
                      : "border-white/10 bg-white/5 text-white/55 hover:border-purple-300/30 hover:text-white"
                  }`}
                >
                  Room {room.roomId}
                </button>
              );
            })}
            {stage.commons.length > 0 && (
              <button
                type="button"
                onClick={() => setPinnedShot((current) => current === "commons" ? null : "commons")}
                className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.2em] transition-colors ${
                  pinnedShot === "commons"
                    ? "border-white/40 bg-white/12 text-white"
                    : "border-white/10 bg-white/5 text-white/55 hover:border-white/25 hover:text-white"
                }`}
              >
                Commons
              </button>
            )}
            <div className="ml-auto text-[11px] uppercase tracking-[0.25em] text-purple-300/45">
              {pinnedShot ? "Pinned room" : "Auto-rotate live"}
            </div>
          </div>

          {stage.allocationText && (
            <p className="text-xs text-white/35 border-b border-white/10 pb-3">
              {stage.allocationText}
            </p>
          )}

          {activeRoom && (
            <div
              key={activeShot?.key}
              className="rounded-[28px] border border-purple-400/20 bg-black/30 p-5 md:p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)] animate-[fadeIn_0.3s_ease-out]"
            >
              <div className="flex items-center justify-between gap-3 mb-5">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-purple-300/45 mb-1">
                    Room {activeRoom.roomId}
                  </p>
                  <p className="text-xl font-semibold text-white">
                    {activeRoom.playerNames.join("  ×  ")}
                  </p>
                </div>
                <span className="rounded-full border border-red-400/25 bg-red-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-red-200/80">
                  Live
                </span>
              </div>

              {activeRoom.messages.length === 0 ? (
                <p className="text-sm text-white/45 italic">
                  The room is sealed. Waiting for the first message.
                </p>
              ) : (
                <div className="space-y-3">
                  {activeRoom.messages.map((msg) => {
                    const player = players.find((candidate) => candidate.id === msg.fromPlayerId)
                      ?? players.find((candidate) => candidate.name === msg.fromPlayerId);
                    const name = player?.name ?? msg.fromPlayerId ?? "Unknown";
                    return (
                      <div key={msg.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm">{player ? personaEmoji(player.persona) : "●"}</span>
                          <span className="text-sm font-semibold text-white/75">{name}</span>
                          <span className="ml-auto text-[11px] uppercase tracking-[0.18em] text-white/25">
                            {formatTime(msg.timestamp)}
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed text-white/70">{msg.text}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeCommons && (
            <div
              key={activeShot?.key}
              className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-5 md:p-6 text-center shadow-[0_30px_80px_rgba(0,0,0,0.38)] animate-[fadeIn_0.3s_ease-out]"
            >
              <p className="text-[11px] uppercase tracking-[0.28em] text-white/35 mb-3">Commons</p>
              <p className="text-2xl font-semibold text-white mb-3">
                {activeCommons.map((player) => player.name).join("  ·  ")}
              </p>
              <p className="text-sm text-white/55 max-w-xl mx-auto">
                These operatives were shut out of private conversations this round.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reveal choreography panel (REVEAL + COUNCIL phases)
// ---------------------------------------------------------------------------

/**
 * Single message item in the reveal stage — House messages are centered and
 * styled dramatically; player messages use regular bubble styling.
 * All-caps runs (e.g., "ATLAS" or "VERA — 4 VOTES") get a highlight treatment.
 */
function RevealMessageItem({
  msg,
  players,
}: {
  msg: TranscriptEntry;
  players: GamePlayer[];
}) {
  const isHouse = !msg.fromPlayerId || msg.scope === "system";

  if (isHouse) {
    // Detect all-caps player name announcement (e.g., "ATLAS — 3 VOTES")
    const isAnnouncement = /\b[A-Z]{3,}\b/.test(msg.text);
    return (
      <div className="text-center py-3 animate-[fadeIn_0.4s_ease-out]">
        {isAnnouncement ? (
          <p className="text-xl md:text-2xl font-bold tracking-widest text-red-300">
            {msg.text}
          </p>
        ) : (
          <p className="text-sm md:text-base text-white/55 italic">{msg.text}</p>
        )}
      </div>
    );
  }

  const player = players.find((p) => p.id === msg.fromPlayerId)
    ?? players.find((p) => p.name === msg.fromPlayerId);
  const name = msg.fromPlayerName ?? player?.name ?? msg.fromPlayerId ?? "Unknown";
  return (
    <div className="flex gap-3 animate-[fadeIn_0.4s_ease-out]">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-sm">
        {player ? personaEmoji(player.persona) : "?"}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white/70 mb-0.5">{name}</p>
        <p className="text-sm text-white/60 leading-relaxed break-words">{msg.text}</p>
      </div>
    </div>
  );
}

/**
 * RevealModeView — replaces the main stage during REVEAL/COUNCIL phases.
 * Messages are shown progressively as they're drained from the reveal queue.
 * While waiting for the next message, a pulsing ellipsis signals more is coming.
 */
function RevealModeView({
  shown,
  pendingCount,
  players,
  phase,
}: {
  shown: TranscriptEntry[];
  pendingCount: number;
  players: GamePlayer[];
  phase: PhaseKey;
}) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [shown]);

  const color = phase === "REVEAL" ? "text-pink-400/60" : "text-red-400/60";
  const label = phase === "REVEAL" ? "REVEAL" : "COUNCIL VOTE";

  return (
    <div
      ref={feedRef}
      className="border border-pink-900/20 bg-pink-950/5 rounded-xl flex-1 overflow-y-auto p-6 min-h-[420px] max-h-[600px] space-y-4"
    >
      {shown.length === 0 && (
        <div className="text-center mt-16">
          <p className={`text-xs font-semibold uppercase tracking-[0.3em] mb-3 ${color}`}>
            ◆ {label} ◆
          </p>
          <p className="text-xs text-white/20 animate-pulse">The votes are in…</p>
        </div>
      )}

      {shown.map((msg) => (
        <RevealMessageItem key={msg.id} msg={msg} players={players} />
      ))}

      {pendingCount > 0 && (
        <div className="text-center py-2">
          <p className="text-xs text-white/20 animate-pulse tracking-widest">…</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Endgame entry screens — Reckoning / Tribunal / Judgment
// ---------------------------------------------------------------------------

type EndgameStage = "reckoning" | "tribunal" | "judgment";

interface EndgameScreenState {
  stage: EndgameStage;
  finalists?: [string, string];
  jurors?: string[];
}

const ENDGAME_CONFIG: Record<
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

function EndgameEntryScreen({
  endgame,
  onDismiss,
}: {
  endgame: EndgameScreenState;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [jurorsVisible, setJurorsVisible] = useState(0);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const fadeIn = setTimeout(() => setVisible(true), 16);
    const fadeOut = setTimeout(() => setVisible(false), 4500);
    const dismiss = setTimeout(() => onDismissRef.current(), 4800);
    return () => {
      clearTimeout(fadeIn);
      clearTimeout(fadeOut);
      clearTimeout(dismiss);
    };
  }, []);

  // Stagger jury icons for Judgment
  useEffect(() => {
    if (endgame.stage !== "judgment" || !endgame.jurors?.length) return;
    const total = endgame.jurors.length;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setJurorsVisible(i);
      if (i >= total) clearInterval(id);
    }, 300);
    return () => clearInterval(id);
  }, [endgame.stage, endgame.jurors]);

  const cfg = ENDGAME_CONFIG[endgame.stage];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.97)",
        transition: "opacity 400ms ease-in-out, transform 400ms ease-in-out",
        pointerEvents: "none",
      }}
    >
      <div className="text-center px-8 max-w-2xl w-full">
        <p className="text-white/20 text-sm tracking-[0.4em] uppercase mb-8">◆ ◆ ◆</p>
        <h1
          className={`text-3xl md:text-4xl font-bold tracking-widest uppercase mb-8 ${cfg.color}`}
        >
          ◆&nbsp;&nbsp;{cfg.title}&nbsp;&nbsp;◆
        </h1>

        {/* Reckoning / Tribunal: body copy with staggered fade-in */}
        {endgame.stage !== "judgment" && (
          <div className="space-y-1 mb-8">
            {cfg.body.map((line, i) =>
              line ? (
                <p
                  key={i}
                  className="text-white/55 text-base md:text-lg leading-relaxed"
                  style={{
                    opacity: visible ? 1 : 0,
                    transition: `opacity 400ms ease-in-out ${i * 120 + 200}ms`,
                  }}
                >
                  {line}
                </p>
              ) : (
                <div key={i} className="h-3" />
              ),
            )}
          </div>
        )}

        {/* Judgment: finalist names + jury roster */}
        {endgame.stage === "judgment" && endgame.finalists && (
          <>
            <div className="flex items-center justify-center gap-12 mb-8">
              {endgame.finalists.map((name, i) => (
                <div
                  key={name}
                  className="text-center"
                  style={{
                    opacity: visible ? 1 : 0,
                    transform: visible ? "translateY(0)" : "translateY(8px)",
                    transition: `opacity 400ms ease-out ${i * 300 + 200}ms, transform 400ms ease-out ${i * 300 + 200}ms`,
                  }}
                >
                  <p className="text-amber-300 text-2xl md:text-3xl font-bold tracking-wide">
                    {name}
                  </p>
                  <p className="text-white/30 text-xs mt-1 uppercase tracking-wider">Finalist</p>
                </div>
              ))}
            </div>
            <p
              className="text-white/40 text-sm italic mb-5"
              style={{
                opacity: visible ? 1 : 0,
                transition: "opacity 400ms ease-in-out 900ms",
              }}
            >
              The jury casts their final verdict.
            </p>
            {endgame.jurors && endgame.jurors.length > 0 && (
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <span className="text-white/20 text-xs mr-1 uppercase tracking-wider">Jury:</span>
                {endgame.jurors.map((name, i) => (
                  <span
                    key={name}
                    className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10"
                    style={{
                      opacity: i < jurorsVisible ? 1 : 0,
                      transform: i < jurorsVisible ? "scale(1)" : "scale(0.85)",
                      transition: "opacity 300ms ease-out, transform 300ms ease-out",
                    }}
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Elimination last-words choreography
// ---------------------------------------------------------------------------

/**
 * Renders the elimination last-words sequence with timed choreography:
 * 1. 3s hold (skull pulse)
 * 2. House intro typewriter: "[Name]… your last words." (50 c/s)
 * 3. 0.5s pause
 * 4. Player last words at slow typewriter (28 c/s)
 * 5. Final dimmed-card state
 *
 * In speedrun/replay mode: renders instantly with no holds or animation.
 */
function LastWordsMessage({
  entry,
  players,
  speedrun,
  isReplay,
}: {
  entry: TranscriptEntry;
  players: GamePlayer[];
  speedrun: boolean;
  isReplay: boolean;
}) {
  type LWPhase = "hold" | "intro" | "pause" | "words" | "done";

  const [phase, setPhase] = useState<LWPhase>(() =>
    speedrun || isReplay ? "done" : "hold",
  );

  const player = players.find((p) => p.id === entry.fromPlayerId)
    ?? players.find((p) => p.name === entry.fromPlayerId);
  const playerName = entry.fromPlayerName ?? player?.name ?? entry.fromPlayerId ?? "Unknown";
  const introText = `${playerName}… your last words.`;

  useEffect(() => {
    if (speedrun || isReplay) return;

    if (phase === "hold") {
      const t = setTimeout(() => setPhase("intro"), 3000);
      return () => clearTimeout(t);
    }
    if (phase === "pause") {
      const t = setTimeout(() => setPhase("words"), 500);
      return () => clearTimeout(t);
    }
  }, [phase, speedrun, isReplay]);

  // Shared final render (done state + speedrun/replay)
  if (phase === "done" || speedrun || isReplay) {
    return (
      <div className="flex gap-3 opacity-60">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-red-900/30 flex items-center justify-center text-sm">
          💀
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-xs font-semibold text-red-300/60">{playerName}</span>
            <span className="text-xs text-red-400/40 italic">last words</span>
            <span className="text-white/20 text-xs ml-auto flex-shrink-0">
              {formatTime(entry.timestamp)}
            </span>
          </div>
          <p className="text-sm text-white/50 italic leading-relaxed break-words">
            {entry.text}
          </p>
        </div>
      </div>
    );
  }

  if (phase === "hold") {
    return (
      <div className="flex items-center gap-3 py-2 text-red-900/60">
        <span className="text-lg animate-pulse">💀</span>
        <span className="text-xs text-white/15 italic tracking-wider">…</span>
      </div>
    );
  }

  // intro + pause: show House prompt
  const showIntroTypewriter = phase === "intro";
  if (phase === "intro" || phase === "pause") {
    return (
      <div className="py-1 space-y-1">
        <p className="text-xs text-white/30 font-medium uppercase tracking-wider">◆ House</p>
        <p className="text-sm text-white/50 italic">
          {showIntroTypewriter ? (
            <Typewriter text={introText} rate="house" onComplete={() => setPhase("pause")} />
          ) : (
            introText
          )}
        </p>
      </div>
    );
  }

  // phase === "words"
  return (
    <div className="py-1 space-y-2">
      <p className="text-xs text-white/30 font-medium uppercase tracking-wider">◆ House</p>
      <p className="text-sm text-white/50 italic">{introText}</p>
      <div className="flex gap-3 ml-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-red-900/30 flex items-center justify-center text-sm">
          💀
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-xs font-semibold text-red-300/60">{playerName}</span>
            <span className="text-xs text-red-400/40 italic">last words</span>
          </div>
          <p className="text-sm text-white/50 italic leading-relaxed break-words">
            <Typewriter
              text={entry.text}
              rate="last-words"
              onComplete={() => setPhase("done")}
            />
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diary Room panel
// ---------------------------------------------------------------------------

/**
 * Card for a single voluntary diary reflection (no paired House question).
 */
function DiaryEntryCard({
  entry,
  players,
}: {
  entry: TranscriptEntry;
  players: GamePlayer[];
}) {
  const [open, setOpen] = useState(true);
  const playerName = entry.fromPlayerId
    ? entry.fromPlayerId.replace(/ \(juror\)$/, "")
    : "Unknown";
  const player = players.find((p) => p.name === playerName);
  const roundLabel = `Round ${entry.round}`;

  return (
    <div className="border border-purple-900/40 bg-purple-950/15 rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-purple-900/20 transition-colors"
      >
        <span className="font-semibold uppercase tracking-wider text-purple-400/70">📔 Diary</span>
        {player && (
          <span className="text-purple-300/60 flex items-center gap-1">
            <span>{personaEmoji(player.persona)}</span>
            <span>{player.name}</span>
          </span>
        )}
        {!player && playerName && (
          <span className="text-purple-300/50">{playerName}</span>
        )}
        <span className="text-purple-400/35 text-xs ml-auto">{roundLabel}</span>
        <span className="text-purple-400/30 ml-2">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3">
          <p className="text-white/55 leading-relaxed italic">{entry.text}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Dedicated Diary Room panel — card-based confessional view.
 * Access-gated: anonymous viewers see a sign-in prompt.
 */
function DiaryRoomPanel({
  messages,
  players,
  isAuthenticated,
  isReplay = false,
}: {
  messages: TranscriptEntry[];
  players: GamePlayer[];
  isAuthenticated: boolean;
  isReplay?: boolean;
}) {
  if (!isAuthenticated && !isReplay) {
    return (
      <div className="border border-purple-900/30 bg-purple-950/10 rounded-xl p-12 text-center min-h-[420px] flex flex-col items-center justify-center">
        <p className="text-3xl mb-4">📓</p>
        <p className="text-white/60 font-medium mb-2">Diary Room is locked</p>
        <p className="text-white/30 text-xs leading-relaxed max-w-xs">
          Sign in to read uncensored agent confessions — every operative&apos;s true thoughts.
        </p>
      </div>
    );
  }

  const diaryMessages = messages.filter((m) => m.scope === "diary");

  if (diaryMessages.length === 0) {
    return (
      <div className="border border-purple-900/30 bg-purple-950/10 rounded-xl p-12 text-center text-purple-300/30 text-sm min-h-[420px] flex items-center justify-center">
        No diary entries yet.
      </div>
    );
  }

  const grouped = groupMessages(diaryMessages);

  return (
    <div className="border border-purple-900/30 bg-purple-950/10 rounded-xl flex-1 overflow-y-auto p-4 space-y-3 min-h-[420px] max-h-[600px]">
      {grouped.map((item, idx) => {
        if (item.kind === "diary_pair") {
          return (
            <DiaryQACard
              key={item.id}
              question={item.question}
              answer={item.answer}
              players={players}
            />
          );
        }
        if (item.kind === "diary_orphan_answer") {
          return (
            <DiaryEntryCard
              key={`diary-${item.answer.id}-${idx}`}
              entry={item.answer}
              players={players}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WebSocket hook
// ---------------------------------------------------------------------------

const WS_BASE =
  (typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_WS_URL
    : undefined) ?? "ws://localhost:3000";

type ConnStatus = "connecting" | "live" | "disconnected" | "reconnecting";

function useGameWebSocket(
  gameId: string,
  enabled: boolean,
  onEvent: (ev: WsGameEvent) => void,
): ConnStatus {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let retryDelay = 1000;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;

      const ws = new WebSocket(`${WS_BASE}/ws/games/${gameId}`);
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        retryDelay = 1000;
        setStatus("live");
      };

      ws.onclose = () => {
        if (cancelled) return;
        // Add ±10% jitter to avoid thundering herd when multiple viewers reconnect
        const jitter = retryDelay * 0.1 * (Math.random() * 2 - 1);
        const delay = retryDelay + jitter;
        setStatus("reconnecting");
        retryTimeout = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30_000);
          connect();
        }, delay);
      };

      // onerror always precedes onclose — let onclose handle the status transition
      ws.onerror = () => {};

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as WsGameEvent;
          onEventRef.current(data);
        } catch {
          // ignore malformed frames
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      wsRef.current?.close();
    };
  }, [gameId, enabled]);

  return status;
}

// ---------------------------------------------------------------------------
// Main game viewer component
// ---------------------------------------------------------------------------

interface GameViewerProps {
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

/** Convert a WebSocket-format transcript entry to a display-ready TranscriptEntry. */
function wsEntryToTranscriptEntry(
  entry: WsTranscriptEntry,
  gameId: string,
  id: number,
): TranscriptEntry {
  return {
    id,
    gameId,
    round: entry.round,
    phase: entry.phase as PhaseKey,
    fromPlayerId: entry.from === "SYSTEM" ? null : entry.from,
    fromPlayerName: null, // resolved by MessageBubble via player lookup
    scope: entry.scope as TranscriptScope,
    toPlayerIds: entry.to ?? null,
    roomId: entry.roomId,
    text: entry.text,
    timestamp: entry.timestamp,
  };
}

// ---------------------------------------------------------------------------
// Dramatic Replay Viewer — scene-based orchestrator
// ---------------------------------------------------------------------------

function DramaticReplayViewer({
  game,
  messages,
  players,
}: {
  game: GameDetail;
  messages: TranscriptEntry[];
  players: GamePlayer[];
}) {
  const scenes = useMemo(() => buildReplayScenes(messages), [messages]);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [showHouseOverlay, setShowHouseOverlay] = useState(false);
  const [activeEndgameScreen, setActiveEndgameScreen] = useState<EndgameScreenState | null>(null);
  const [activePhaseTransition, setActivePhaseTransition] = useState<TransitionState | null>(null);
  const seenEndgameStages = useRef<Set<string>>(new Set());
  const feedRef = useRef<HTMLDivElement>(null);

  const scene = scenes[sceneIndex];
  const totalScenes = scenes.length;

  // Visible messages within current scene
  const visibleSceneMessages = scene ? scene.messages.slice(0, messageIndex + 1) : [];

  // All messages visible up to current scene (for context)
  const allVisibleMessages = useMemo(() => {
    const msgs: TranscriptEntry[] = [];
    for (let i = 0; i < sceneIndex; i++) {
      msgs.push(...scenes[i]!.messages);
    }
    msgs.push(...visibleSceneMessages);
    return msgs;
  }, [scenes, sceneIndex, visibleSceneMessages]);

  // Reconstruct game state from visible messages
  const replayGame: GameDetail = useMemo(() => {
    const lastMsg = allVisibleMessages[allVisibleMessages.length - 1];
    return {
      ...game,
      currentPhase: (lastMsg?.phase ?? game.currentPhase) as PhaseKey,
      currentRound: lastMsg?.round ?? 1,
    };
  }, [game, allVisibleMessages]);

  // Track eliminated players from visible messages
  const eliminatedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const msg of allVisibleMessages) {
      if (msg.scope === "system" && msg.text.includes("has been eliminated")) {
        const player = players.find((p) => msg.text.includes(p.name));
        if (player) ids.add(player.id);
      }
    }
    return ids;
  }, [allVisibleMessages, players]);
  const aliveCount = players.length - eliminatedIds.size;

  // Detect round boundaries for round markers
  const prevScene = sceneIndex > 0 ? scenes[sceneIndex - 1] : null;
  const isNewRound = scene && prevScene && scene.round !== prevScene.round;
  const isRoomChange = scene && prevScene && scene.roomType !== prevScene.roomType;

  // Show House overlay when entering a new scene with houseIntro
  useEffect(() => {
    if (scene?.houseIntro && isRoomChange) {
      setShowHouseOverlay(true);
      const timer = window.setTimeout(() => setShowHouseOverlay(false), 2500);
      return () => window.clearTimeout(timer);
    }
  }, [sceneIndex, scene?.houseIntro, isRoomChange]);

  // Trigger PhaseTransitionOverlay on room type changes
  useEffect(() => {
    if (isRoomChange && scene) {
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

  // Trigger endgame entry screens at player-count thresholds
  useEffect(() => {
    if (!scene || scene.roomType !== "endgame") return;
    let stage: EndgameStage | null = null;
    if (aliveCount <= 2 && !seenEndgameStages.current.has("judgment")) {
      stage = "judgment";
    } else if (aliveCount <= 3 && !seenEndgameStages.current.has("tribunal")) {
      stage = "tribunal";
    } else if (aliveCount <= 4 && !seenEndgameStages.current.has("reckoning")) {
      stage = "reckoning";
    }
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

  // Auto-advance messages within a scene (House overlay does NOT pause auto-play)
  useEffect(() => {
    if (!isPlaying || !scene) return;
    if (messageIndex >= scene.messages.length - 1) {
      // All messages in scene revealed — pause then advance to next scene
      if (sceneIndex >= totalScenes - 1) {
        setIsPlaying(false);
        return;
      }
      const timer = window.setTimeout(() => {
        setSceneIndex((i) => Math.min(totalScenes - 1, i + 1));
        setMessageIndex(0);
      }, INTER_SCENE_PAUSE_MS / speed);
      return () => window.clearTimeout(timer);
    }

    // Determine reveal interval based on scene type
    const currentMsg = scene.messages[messageIndex];
    const isElimination = currentMsg?.scope === "system" && currentMsg.text.includes("has been eliminated");
    const isTribunal = scene.phase === "REVEAL" || scene.phase === "COUNCIL";

    let intervalMs: number;
    if (isElimination) {
      // Auto-pause 2s at elimination moments
      intervalMs = 2000 / speed;
    } else if (isTribunal) {
      // Reveal/Council: 1.5s base interval for dramatic reveals
      intervalMs = 1500 / speed;
    } else {
      intervalMs = BASE_INTERVAL_MS / speed;
    }

    const timer = window.setTimeout(() => {
      setMessageIndex((i) => i + 1);
    }, intervalMs);
    return () => window.clearTimeout(timer);
  }, [isPlaying, messageIndex, sceneIndex, scene, totalScenes, speed]);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messageIndex, sceneIndex]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          setIsPlaying((p) => !p);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (sceneIndex < totalScenes - 1) {
            setSceneIndex((i) => i + 1);
            setMessageIndex(0);
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (sceneIndex > 0) {
            setSceneIndex((i) => i - 1);
            setMessageIndex(0);
          }
          break;
        case "]":
          e.preventDefault();
          // Next round
          for (let i = sceneIndex + 1; i < totalScenes; i++) {
            if (scenes[i]!.round !== scene?.round) {
              setSceneIndex(i);
              setMessageIndex(0);
              break;
            }
          }
          break;
        case "[":
          e.preventDefault();
          // Previous round
          if (scene) {
            for (let i = sceneIndex - 1; i >= 0; i--) {
              if (scenes[i]!.round !== scene.round) {
                // Jump to the first scene of that round
                const targetRound = scenes[i]!.round;
                let first = i;
                while (first > 0 && scenes[first - 1]!.round === targetRound) first--;
                setSceneIndex(first);
                setMessageIndex(0);
                break;
              }
            }
          }
          break;
        case "1":
          setSpeed(0.5);
          break;
        case "2":
          setSpeed(1);
          break;
        case "3":
          setSpeed(2);
          break;
        case "4":
          setSpeed(4);
          break;
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [sceneIndex, totalScenes, scene, scenes]);

  if (!scene || totalScenes === 0) {
    return (
      <div className="border border-white/10 rounded-xl p-12 text-center text-white/20 text-sm">
        No replay data available.
      </div>
    );
  }

  const roomBorder = ROOM_TYPE_BORDERS[scene.roomType];
  const phaseLabel = PHASE_TRANSITION_LABELS[scene.phase] ?? scene.phase;

  return (
    <div className="flex flex-col gap-3">
      {/* Phase transition overlay on room type changes */}
      {activePhaseTransition && (
        <PhaseTransitionOverlay
          transition={activePhaseTransition}
          onDismiss={() => setActivePhaseTransition(null)}
        />
      )}

      {/* Endgame entry screens */}
      {activeEndgameScreen && (
        <EndgameEntryScreen
          endgame={activeEndgameScreen}
          onDismiss={() => setActiveEndgameScreen(null)}
        />
      )}

      {/* House Overlay */}
      {showHouseOverlay && scene.houseIntro && (
        <div
          className="fixed inset-0 z-40 bg-black/85 flex flex-col items-center justify-center cursor-pointer animate-[fadeIn_0.3s_ease-out]"
          onClick={() => setShowHouseOverlay(false)}
        >
          <p className="text-white/30 text-xs tracking-[0.4em] uppercase mb-4">
            ◆ THE HOUSE ◆
          </p>
          <p className="text-white/70 italic text-base md:text-lg max-w-lg text-center px-6 leading-relaxed">
            {scene.houseIntro}
          </p>
        </div>
      )}

      {/* Round boundary */}
      {isNewRound && (
        <div className="text-center py-4">
          <p className="text-white/20 text-xs tracking-[0.3em] uppercase">◆ ◆ ◆</p>
          <p className="text-white/60 text-lg font-semibold mt-1">ROUND {scene.round}</p>
          <p className="text-white/30 text-xs mt-0.5">{aliveCount} operatives remaining</p>
          <p className="text-white/20 text-xs tracking-[0.3em] uppercase mt-1">◆ ◆ ◆</p>
        </div>
      )}

      {/* Scene header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${ROOM_TYPE_COLORS[scene.roomType]}`} />
          <span className={`text-xs font-semibold uppercase tracking-[0.2em] ${phaseColor(scene.phase)}`}>
            ◆ {phaseLabel} ◆
          </span>
          <span className="text-xs text-white/20">Round {scene.round}</span>
        </div>
        <ConnectionBadge status="replay" />
      </div>

      {/* Scene scrubber */}
      <div className="flex h-2 rounded-full overflow-hidden bg-white/5 gap-px">
        {scenes.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => { setSceneIndex(i); setMessageIndex(0); }}
            className={`flex-1 min-w-[3px] transition-opacity ${ROOM_TYPE_COLORS[s.roomType]} ${
              i <= sceneIndex ? "opacity-100" : "opacity-25"
            } ${i === sceneIndex ? "ring-1 ring-white/40" : ""} hover:opacity-80`}
            title={`${s.id} — ${PHASE_TRANSITION_LABELS[s.phase] ?? s.phase}`}
          />
        ))}
      </div>

      {/* Message feed */}
      <div
        ref={feedRef}
        className={`border ${roomBorder} rounded-xl flex-1 overflow-y-auto p-4 space-y-3 min-h-[420px] max-h-[600px]`}
      >
        {scene.roomType === "private_rooms" ? (
          // Whisper room: show full content grouped by room
          <div className="space-y-4">
            <p className="text-center text-xs uppercase tracking-[0.25em] text-purple-300/50 mb-2">
              The operatives went dark. These are their private conversations.
            </p>
            {(() => {
              const stageData = buildWhisperStageData(visibleSceneMessages, players);
              return stageData.rooms.map((room, idx) => (
                <div
                  key={room.roomId}
                  className="rounded-2xl border border-purple-400/20 bg-black/30 p-4 shadow-lg animate-[fadeIn_0.4s_ease-out_both]"
                  style={{ animationDelay: `${idx * 600}ms` }}
                >
                  <p className="text-[11px] uppercase tracking-[0.28em] text-purple-300/45 mb-1">
                    Room {room.roomId}
                  </p>
                  <p className="text-sm font-semibold text-white mb-3">
                    {room.playerNames.join(" × ")}
                  </p>
                  {room.messages.length === 0 ? (
                    <p className="text-xs text-white/35 italic">No messages yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {room.messages.map((msg) => {
                        const player = players.find((p) => p.id === msg.fromPlayerId);
                        return (
                          <div key={msg.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm">{player ? personaEmoji(player.persona) : "●"}</span>
                              <span className="text-xs font-semibold text-white/75">{player?.name ?? msg.fromPlayerId}</span>
                              <span className="ml-auto text-[10px] text-white/20">{formatTime(msg.timestamp)}</span>
                            </div>
                            <p className="text-sm text-white/70 leading-relaxed">{msg.text}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ));
            })()}
          </div>
        ) : scene.roomType === "tribunal" && (scene.phase === "REVEAL" || scene.phase === "COUNCIL") ? (
          // Tribunal: reveal choreography with dramatic message items
          <div className="space-y-4">
            {visibleSceneMessages.length === 0 ? (
              <div className="text-center mt-16">
                <p className={`text-xs font-semibold uppercase tracking-[0.3em] mb-3 ${
                  scene.phase === "REVEAL" ? "text-pink-400/60" : "text-red-400/60"
                }`}>
                  ◆ {scene.phase === "REVEAL" ? "REVEAL" : "COUNCIL VOTE"} ◆
                </p>
                <p className="text-xs text-white/20 animate-pulse">The votes are in…</p>
              </div>
            ) : (
              visibleSceneMessages.map((msg) => {
                // Detect elimination last words
                const isElimMsg = msg.scope === "system" && msg.text.includes("has been eliminated");
                if (isElimMsg) {
                  return (
                    <div key={msg.id} className="text-center py-4">
                      <p className="text-lg font-bold text-red-400 tracking-wider animate-[fadeIn_0.5s_ease-out]">
                        {msg.text}
                      </p>
                    </div>
                  );
                }
                return <RevealMessageItem key={msg.id} msg={msg} players={players} />;
              })
            )}
            {messageIndex < scene.messages.length - 1 && (
              <div className="text-center py-2">
                <p className="text-xs text-white/20 animate-pulse tracking-widest">…</p>
              </div>
            )}
          </div>
        ) : (
          // All other room types: linear message feed
          visibleSceneMessages.length === 0 ? (
            <p className="text-center text-white/20 text-sm mt-16">
              Scene loading…
            </p>
          ) : (
            visibleSceneMessages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} players={players} />
            ))
          )
        )}
      </div>

      {/* Replay control bar */}
      <div className="border border-white/10 rounded-xl px-4 py-3 space-y-2">
        {/* Scene info + navigation */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { setSceneIndex(0); setMessageIndex(0); }}
              disabled={sceneIndex === 0}
              className="text-xs border border-white/10 hover:border-white/25 text-white/50 hover:text-white px-2 py-1 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="First scene"
            >
              ⏮
            </button>
            <button
              type="button"
              onClick={() => { setSceneIndex((i) => Math.max(0, i - 1)); setMessageIndex(0); }}
              disabled={sceneIndex === 0}
              className="text-xs border border-white/10 hover:border-white/25 text-white/50 hover:text-white px-2 py-1 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous scene (←)"
            >
              ←
            </button>
          </div>

          <span className="text-xs text-white/40 text-center">
            Scene {sceneIndex + 1} of {totalScenes} · R{scene.round} {PHASE_LABELS[scene.phase]}
          </span>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { setSceneIndex((i) => Math.min(totalScenes - 1, i + 1)); setMessageIndex(0); }}
              disabled={sceneIndex >= totalScenes - 1}
              className="text-xs border border-white/10 hover:border-white/25 text-white/50 hover:text-white px-2 py-1 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next scene (→)"
            >
              →
            </button>
            <button
              type="button"
              onClick={() => { setSceneIndex(totalScenes - 1); setMessageIndex(scenes[totalScenes - 1]!.messages.length - 1); }}
              disabled={sceneIndex >= totalScenes - 1}
              className="text-xs border border-white/10 hover:border-white/25 text-white/50 hover:text-white px-2 py-1 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Last scene"
            >
              ⏭
            </button>
          </div>
        </div>

        {/* Play/pause + speed */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            className="text-xs border border-white/10 hover:border-white/25 text-white/70 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
            title="Play/Pause (Space)"
          >
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>

          <div className="flex items-center gap-1">
            <span className="text-xs text-white/30 mr-1">Speed:</span>
            {SPEED_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSpeed(opt.value)}
                className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                  speed === opt.value
                    ? "bg-white/15 text-white border border-white/25"
                    : "text-white/40 hover:text-white/70 border border-transparent"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <span className="text-xs text-white/20">
            {messageIndex + 1}/{scene.messages.length} msgs
          </span>
        </div>

        {/* Keyboard shortcuts hint */}
        <p className="text-[10px] text-white/15 text-center">
          Space: play/pause · ←→: scenes · []: rounds · 1234: speed
        </p>
      </div>

      {/* Player roster below controls */}
      <PlayerRoster
        players={players}
        empoweredPlayerId={null}
        eliminatedRounds={new Map()}
        recentlyUnshielded={new Set()}
        speedrun={false}
      />
    </div>
  );
}

export function GameViewer({ gameId, initialGame, initialMessages, mode }: GameViewerProps) {
  const { authenticated, login } = usePrivy();
  const router = useRouter();
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [joinedSuccess, setJoinedSuccess] = useState(false);
  const [game, setGame] = useState<GameDetail | null>(initialGame ?? null);
  const [messages, setMessages] = useState<TranscriptEntry[]>(initialMessages ?? []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replayIndex, setReplayIndex] = useState<number>(0);
  const [activeTransition, setActiveTransition] = useState<TransitionState | null>(null);
  // Negative IDs for live WS messages (avoids collision with positive DB ids)
  const msgIdRef = useRef(-1);
  // maxRounds ref so handleWsEvent can access it without being a dep
  const maxRoundsRef = useRef<number>(initialGame?.maxRounds ?? 9);
  // Track players whose next public message is their elimination last words.
  // Map: playerId → true (present = awaiting last words)
  const awaitingLastWordsRef = useRef<Set<string>>(new Set());
  // Set of message IDs that should render as last-words choreography
  const [lastWordsIds, setLastWordsIds] = useState<ReadonlySet<number>>(new Set());
  // Endgame entry screens
  const [activeEndgame, setActiveEndgame] = useState<EndgameScreenState | null>(null);
  const prevAliveCountRef = useRef<number | null>(null);
  // Reveal choreography queue (REVEAL + COUNCIL phases, live mode only)
  const [revealQueue, setRevealQueue] = useState<TranscriptEntry[]>([]);
  const [revealShown, setRevealShown] = useState<TranscriptEntry[]>([]);
  // Track phase in a ref so handleWsEvent (useCallback) can access it without stale closure
  const currentPhaseRef = useRef<PhaseKey>("INIT");
  // Speedrun flag — derive early so useEffects can use it as dependency
  const isSpeedrun = game?.viewerMode === "speedrun";
  // Diary Room tab state (desktop toggle)
  const [activeTab, setActiveTab] = useState<"stage" | "diary">("stage");
  const [newDiaryCount, setNewDiaryCount] = useState(0);
  const activeTabRef = useRef<"stage" | "diary">("stage");
  activeTabRef.current = activeTab;
  // Mobile 4-tab state
  type MobileTab = "chat" | "players" | "diary" | "votes";
  const [mobileTab, setMobileTab] = useState<MobileTab>("chat");
  const [newChatCount, setNewChatCount] = useState(0);
  const [newEliminationsCount, setNewEliminationsCount] = useState(0);
  const mobileTabRef = useRef<MobileTab>("chat");
  mobileTabRef.current = mobileTab;
  // Auth state (for diary room gate)
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    typeof window !== "undefined" ? !!getAuthToken() : false,
  );
  // Player card badges
  // empoweredPlayerId is set by the reveal choreography (INF-76) — null until then
  // empoweredPlayerId will be set by reveal choreography (INF-76)
  const [empoweredPlayerId] = useState<string | null>(null);
  const [eliminatedRounds, setEliminatedRounds] = useState<ReadonlyMap<string, number>>(new Map());
  const eliminatedRoundsRef = useRef<Map<string, number>>(new Map());
  const [recentlyUnshielded, setRecentlyUnshielded] = useState<ReadonlySet<string>>(new Set());
  // Track previous shield states to detect expiry
  const prevShieldedRef = useRef<Map<string, boolean>>(new Map());

  // Fetch game data client-side if not provided via props
  useEffect(() => {
    if (initialGame) {
      // Already have game data; set replay index to end
      setReplayIndex((initialMessages?.length ?? 1) - 1);
      return;
    }

    if (!gameId) return;

    async function load() {
      try {
        const gameData = await getGame(gameId);
        setGame(gameData);
        maxRoundsRef.current = gameData.maxRounds;
        if (gameData.status === "completed" || gameData.status === "cancelled") {
          const transcript = await getGameTranscript(gameId);
          setMessages(transcript);
          setReplayIndex(transcript.length > 0 ? transcript.length - 1 : 0);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load game.");
      }
    }

    load();
  }, [gameId, initialGame, initialMessages]);

  const feedRef = useRef<HTMLDivElement>(null);

  const isReplay = !!game && game.status !== "in_progress" && game.status !== "waiting";

  // Auto-scroll: live view on new messages, replay on index change
  useEffect(() => {
    if (!isReplay && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, isReplay]);

  useEffect(() => {
    if (isReplay && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [replayIndex, isReplay]);

  // Drain reveal queue — release one message every 1.5s (or instantly in speedrun)
  useEffect(() => {
    if (revealQueue.length === 0 || isReplay) return;

    if (isSpeedrun) {
      setRevealShown((s) => [...s, ...revealQueue]);
      setRevealQueue([]);
      return;
    }

    const HOLD_MS = 1500;
    const timer = setTimeout(() => {
      setRevealQueue((q) => {
        if (q.length === 0) return q;
        const [next, ...rest] = q;
        setRevealShown((s) => [...s, next]);
        // Audio cues for specific reveal events
        if (next.fromPlayerId === null || next.scope === "system") {
          const text = next.text.toUpperCase();
          if (text.includes("POWER") && text.includes("TOKEN")) {
            audioCue.sting("empower_reveal");
          } else if (text.includes("COUNCIL") && text.includes("NOMINATE")) {
            audioCue.sting("council_nominees");
          } else if (text.includes("ELIMINATE") && text.includes("DIRECTLY")) {
            audioCue.sting("auto_elimination");
          } else if (text.includes("TIE")) {
            audioCue.sting("tiebreak");
          }
        }
        return rest;
      });
    }, HOLD_MS);

    return () => clearTimeout(timer);
  }, [revealQueue, isReplay, isSpeedrun]);

  // Auth session events from Privy / login flow
  useEffect(() => {
    const onReady = () => setIsAuthenticated(true);
    const onExpired = () => setIsAuthenticated(false);
    window.addEventListener("auth:session-ready", onReady);
    window.addEventListener("auth:expired", onExpired);
    return () => {
      window.removeEventListener("auth:session-ready", onReady);
      window.removeEventListener("auth:expired", onExpired);
    };
  }, []);

  // Trigger endgame entry screens when alive count crosses a threshold
  useEffect(() => {
    if (!game || isReplay) return;
    const aliveCount = game.players.filter((p) => p.status === "alive").length;
    const prev = prevAliveCountRef.current;
    if (prev !== null && prev > aliveCount && (aliveCount === 4 || aliveCount === 3 || aliveCount === 2)) {
      const jurors = game.players
        .filter((p) => p.status === "eliminated")
        .map((p) => p.name);
      const alive = game.players.filter((p) => p.status === "alive");
      // Audio sting for endgame entry
      if (aliveCount === 4) audioCue.sting("endgame_reckoning");
      setActiveEndgame({
        stage: aliveCount === 4 ? "reckoning" : aliveCount === 3 ? "tribunal" : "judgment",
        finalists:
          aliveCount === 2
            ? [alive[0]?.name ?? "?", alive[1]?.name ?? "?"]
            : undefined,
        jurors,
      });
    }
    prevAliveCountRef.current = aliveCount;
  }, [game, isReplay]);

  const handleWsEvent = useCallback((ev: WsGameEvent) => {
    switch (ev.type) {
      case "game_state": {
        const { snapshot } = ev;
        // Derive current phase from last transcript entry (snapshot lacks explicit phase field)
        const lastEntry = snapshot.transcript.at(-1);
        const snapshotPhase = (lastEntry?.phase ?? "INIT") as PhaseKey;

        // Build a complete player registry from all sources (alive + eliminated)
        setGame((g) => {
          if (!g) return g;

          const playerMap = new Map<string, GamePlayer>();

          // Seed with existing players (preserves persona info from getGame())
          for (const p of g.players) {
            playerMap.set(p.id, p);
          }

          // Update/add alive players from snapshot
          for (const ap of snapshot.alivePlayers) {
            const existing = playerMap.get(ap.id);
            playerMap.set(ap.id, {
              id: ap.id,
              name: ap.name,
              persona: existing?.persona ?? "strategic",
              status: "alive" as const,
              shielded: ap.shielded,
            });
          }

          // Update/add eliminated players from snapshot
          for (const ep of snapshot.eliminatedPlayers) {
            const existing = playerMap.get(ep.id);
            playerMap.set(ep.id, {
              id: ep.id,
              name: ep.name,
              persona: existing?.persona ?? "strategic",
              status: "eliminated" as const,
              shielded: false,
            });
          }

          return {
            ...g,
            currentRound: snapshot.round,
            currentPhase: snapshotPhase,
            players: Array.from(playerMap.values()),
          };
        });

        // Sync phase ref so REVEAL/COUNCIL queue logic works immediately on reconnect
        if (snapshotPhase !== "INIT") {
          currentPhaseRef.current = snapshotPhase;
        }
        // Detect shield state changes to trigger shatter animation + audio
        const newlyUnshielded: string[] = [];
        for (const ap of snapshot.alivePlayers) {
          const wasShielded = prevShieldedRef.current.get(ap.id);
          if (wasShielded === false && ap.shielded) {
            // Shield just granted
            audioCue.sting("shield_granted");
          }
          if (wasShielded === true && !ap.shielded) {
            newlyUnshielded.push(ap.id);
          }
          prevShieldedRef.current.set(ap.id, ap.shielded);
        }
        if (newlyUnshielded.length > 0) {
          setRecentlyUnshielded((prev) => new Set([...prev, ...newlyUnshielded]));
          // Clear after animation completes (800ms)
          setTimeout(() => {
            setRecentlyUnshielded((prev) => {
              const next = new Set(prev);
              for (const id of newlyUnshielded) next.delete(id);
              return next;
            });
          }, 800);
        }
        // Load catch-up transcript
        let id = msgIdRef.current;
        const msgs = snapshot.transcript.map((entry) =>
          wsEntryToTranscriptEntry(entry, snapshot.gameId, id--),
        );
        msgIdRef.current = id;
        setMessages(msgs);
        break;
      }
      case "phase_change": {
        const prevPhase = currentPhaseRef.current;
        currentPhaseRef.current = ev.phase as PhaseKey;
        setGame((g) => g ? { ...g, currentPhase: ev.phase, currentRound: ev.round } : g);
        // When entering REVEAL: reset reveal panel for new round
        if (ev.phase === "REVEAL") {
          setRevealShown([]);
          setRevealQueue([]);
        }
        // When leaving REVEAL or COUNCIL: flush any remaining queued messages
        if ((prevPhase === "REVEAL" || prevPhase === "COUNCIL") &&
            ev.phase !== "REVEAL" && ev.phase !== "COUNCIL") {
          setRevealQueue((q) => {
            if (q.length > 0) {
              setRevealShown((s) => [...s, ...q]);
            }
            return [];
          });
        }
        // Audio zone transitions
        if (ev.phase === "INTRODUCTION") audioCue.zone("ambient");
        else if (ev.phase === "WHISPER" || ev.phase === "VOTE") audioCue.zone("tension");
        else if (ev.phase === "REVEAL" || ev.phase === "COUNCIL") audioCue.zone("drama");
        else if (ev.phase === "LOBBY" || ev.phase === "RUMOR") audioCue.zone("resolution");
        // Show transition overlay in live mode (not on END phase — no point)
        if (ev.phase !== "END" && ev.phase !== "INIT") {
          const flavorText =
            prevPhase === "WHISPER" && ev.phase === "RUMOR"
              ? "The rooms are sealed. Time to face the group."
              : (() => {
                  const flavors = PHASE_FLAVORS[ev.phase] ?? [];
                  return flavors.length > 0
                    ? flavors[Math.floor(Math.random() * flavors.length)]
                    : "";
                })();
          setActiveTransition({
            phase: ev.phase,
            round: ev.round,
            maxRounds: maxRoundsRef.current,
            aliveCount: ev.alivePlayers.length,
            flavorText,
          });
        }
        break;
      }
      case "message": {
        const id = msgIdRef.current--;
        const msg = wsEntryToTranscriptEntry(ev.entry, gameId, id);
        // If this is the first public message from a player awaiting last-words,
        // mark it and remove them from the awaiting set.
        if (
          ev.entry.scope === "public" &&
          ev.entry.from !== "SYSTEM" &&
          awaitingLastWordsRef.current.has(ev.entry.from)
        ) {
          awaitingLastWordsRef.current.delete(ev.entry.from);
          setLastWordsIds((prev) => new Set([...prev, id]));
        }
        // Badge count for diary entries arriving while user is on Main Stage tab
        if (ev.entry.scope === "diary" && activeTabRef.current !== "diary") {
          setNewDiaryCount((n) => n + 1);
        }
        // Mobile badge counts
        if (
          ev.entry.scope === "public" &&
          mobileTabRef.current !== "chat"
        ) {
          setNewChatCount((n) => n + 1);
        }
        // Queue messages during REVEAL/COUNCIL for reveal choreography
        const phase = currentPhaseRef.current;
        if (
          (phase === "REVEAL" || phase === "COUNCIL") &&
          ev.entry.scope !== "diary" &&
          ev.entry.scope !== "whisper"
        ) {
          setRevealQueue((q) => [...q, msg]);
        }
        setMessages((m) => [...m, msg]);
        break;
      }
      case "player_eliminated":
        // Register this player as awaiting their last-words message
        awaitingLastWordsRef.current.add(ev.playerId);
        // Track elimination round for badge display
        eliminatedRoundsRef.current.set(ev.playerId, ev.round);
        setEliminatedRounds(new Map(eliminatedRoundsRef.current));
        // Mobile: badge Players tab when not viewing it
        if (mobileTabRef.current !== "players") {
          setNewEliminationsCount((n) => n + 1);
        }
        // Audio: player eliminated sting + drama zone
        audioCue.sting("player_eliminated");
        audioCue.zone("drama");
        setGame((g) => {
          if (!g) return g;
          const found = g.players.some((p) => p.id === ev.playerId);
          const updated = found
            ? g.players.map((p) =>
                p.id === ev.playerId
                  ? { ...p, status: "eliminated" as const, name: ev.playerName || p.name }
                  : p,
              )
            : [
                ...g.players,
                {
                  id: ev.playerId,
                  name: ev.playerName,
                  persona: "strategic",
                  status: "eliminated" as const,
                  shielded: false,
                },
              ];
          return { ...g, players: updated };
        });
        break;
      case "game_over":
        setGame((g) =>
          g ? { ...g, status: "completed", currentPhase: "END", winner: ev.winnerName } : g,
        );
        audioCue.sting("winner_announced");
        audioCue.zone("resolution");
        break;
    }
  }, [gameId]);

  const wsStatus = useGameWebSocket(gameId, !!gameId && !!game && !isReplay, handleWsEvent);

  const connStatus = isReplay
    ? "replay"
    : wsStatus === "live"
      ? "live"
      : wsStatus;

  // Loading / error states
  if (loadError) {
    return (
      <div className="border border-red-900/30 rounded-xl p-12 text-center text-red-400/70 text-sm">
        {loadError}
      </div>
    );
  }

  if (!game) {
    return (
      <div className="border border-white/10 rounded-xl p-12 text-center text-white/20 text-sm">
        Loading game…
      </div>
    );
  }

  // Route to dramatic replay for completed games (unless ?mode=classic)
  const useDramaticReplay = isReplay && mode !== "classic" && messages.length > 0;
  if (useDramaticReplay) {
    return (
      <DramaticReplayViewer
        game={game}
        messages={messages}
        players={game.players}
      />
    );
  }

  // Replay: visible messages up to replayIndex
  const visibleMessages = isReplay ? messages.slice(0, replayIndex + 1) : messages;

  // Replay state: reconstruct current phase/round from visible messages
  const replayGame: GameDetail = isReplay
    ? {
        ...game,
        currentPhase: (visibleMessages.findLast((m) => m.phase)?.phase ?? game.currentPhase) as PhaseKey,
        currentRound: visibleMessages.findLast((m) => m.round)?.round ?? 1,
      }
    : game;

  const currentWhisperEntries = visibleMessages.filter(
    (message) =>
      message.phase === "WHISPER" &&
      message.round === replayGame.currentRound &&
      (message.scope === "whisper" || message.scope === "system"),
  );

  // Construct a GameSummary-compatible object for the JoinGameModal
  const gameSummaryForJoin: GameSummary = {
    id: game.id,
    slug: game.slug,
    gameNumber: game.gameNumber,
    status: game.status,
    playerCount: game.players.length,
    currentRound: game.currentRound,
    maxRounds: game.maxRounds,
    currentPhase: game.currentPhase,
    phaseTimeRemaining: null,
    alivePlayers: game.players.filter((p) => p.status === "alive").length,
    eliminatedPlayers: game.players.filter((p) => p.status === "eliminated").length,
    modelTier: game.modelTier,
    visibility: game.visibility,
    viewerMode: game.viewerMode,
    createdAt: game.createdAt,
    startedAt: game.startedAt,
    completedAt: game.completedAt,
  };

  function handleJoinClick() {
    if (!authenticated) {
      login();
      return;
    }
    setJoinModalOpen(true);
  }

  function handleJoinSuccess() {
    setJoinModalOpen(false);
    setJoinedSuccess(true);
    router.push("/dashboard");
  }

  return (
    <>
      {/* Join modal */}
      {joinModalOpen && (
        <JoinGameModal
          game={gameSummaryForJoin}
          onClose={() => setJoinModalOpen(false)}
          onSuccess={handleJoinSuccess}
        />
      )}

      {/* Phase transition overlay — live mode only, not replay */}
      {activeTransition && !isReplay && (
        <PhaseTransitionOverlay
          transition={activeTransition}
          onDismiss={() => setActiveTransition(null)}
        />
      )}

      {/* Endgame entry screens (Reckoning / Tribunal / Judgment) — live mode only */}
      {activeEndgame && !isReplay && (
        <EndgameEntryScreen
          endgame={activeEndgame}
          onDismiss={() => setActiveEndgame(null)}
        />
      )}

    {/* ── Mobile layout (<768px) — 4-tab view with bottom tab bar ── */}
    <div className="md:hidden flex flex-col min-h-0 pb-16">
      <PhaseHeader game={replayGame} isReplay={isReplay} />

      {/* Join banner — shown when game is waiting for players */}
      {game.status === "waiting" && !joinedSuccess && (
        <div className="mb-3 border border-indigo-500/30 bg-indigo-950/30 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-indigo-300">Open for players</p>
            <p className="text-xs text-white/30 mt-0.5">Waiting room — join before the game starts</p>
          </div>
          <button
            onClick={handleJoinClick}
            className="shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Join
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-2 px-1">
        <ConnectionBadge status={connStatus} />
        {!isReplay && (
          <span className="text-xs text-white/20">
            R{replayGame.currentRound}
          </span>
        )}
      </div>

      {/* Mobile Chat tab */}
      {mobileTab === "chat" && replayGame.currentPhase === "WHISPER" && !isReplay && (
        <WhisperPhaseView
          phaseEntries={currentWhisperEntries}
          players={game.players}
          phaseKey={`whisper-${replayGame.currentRound}`}
        />
      )}
      {mobileTab === "chat" &&
        (replayGame.currentPhase === "REVEAL" || replayGame.currentPhase === "COUNCIL") &&
        !isReplay && (
          <RevealModeView
            shown={revealShown}
            pendingCount={revealQueue.length}
            players={game.players}
            phase={replayGame.currentPhase}
          />
        )}
      {mobileTab === "chat" &&
        replayGame.currentPhase !== "WHISPER" &&
        (isReplay ||
          (replayGame.currentPhase !== "REVEAL" &&
            replayGame.currentPhase !== "COUNCIL")) && (
          <div
            ref={feedRef}
            className="border border-white/10 rounded-xl overflow-y-auto p-4 space-y-3 min-h-[380px] max-h-[60vh]"
          >
            {visibleMessages.filter((m) => m.scope !== "diary" && m.scope !== "whisper")
              .length === 0 ? (
              <p className="text-center text-white/20 text-sm mt-12">
                {isReplay ? "No messages in replay." : "Waiting for game to begin…"}
              </p>
            ) : (
              groupMessages(
                visibleMessages.filter((m) => m.scope !== "diary" && m.scope !== "whisper"),
              ).map((item) => {
                if (item.kind === "msg" && lastWordsIds.has(item.entry.id)) {
                  return (
                    <LastWordsMessage
                      key={item.entry.id}
                      entry={item.entry}
                      players={game.players}
                      speedrun={isSpeedrun}
                      isReplay={isReplay}
                    />
                  );
                }
                if (item.kind === "msg") {
                  return (
                    <MessageBubble
                      key={item.entry.id}
                      msg={item.entry}
                      players={game.players}
                    />
                  );
                }
                return null;
              })
            )}
          </div>
        )}

      {/* Mobile Players tab */}
      {mobileTab === "players" && (
        <PlayerRoster
          players={game.players}
          empoweredPlayerId={empoweredPlayerId}
          eliminatedRounds={eliminatedRounds}
          recentlyUnshielded={recentlyUnshielded}
          speedrun={isSpeedrun}
        />
      )}

      {/* Mobile Diary tab */}
      {mobileTab === "diary" && (
        <DiaryRoomPanel
          messages={isReplay ? messages : visibleMessages}
          players={game.players}
          isAuthenticated={isAuthenticated}
          isReplay={isReplay}
        />
      )}

      {/* Mobile Votes tab — placeholder for V2 vote tracker */}
      {mobileTab === "votes" && (
        <div className="border border-white/10 rounded-xl p-12 text-center text-white/20 text-sm min-h-[380px] flex items-center justify-center">
          <p>Vote tracker coming soon</p>
        </div>
      )}

      {/* Replay controls on mobile */}
      {isReplay && messages.length > 0 && (
        <ReplayControls
          current={replayIndex}
          total={messages.length}
          onFirst={() => setReplayIndex(0)}
          onLast={() => setReplayIndex(messages.length - 1)}
          onPrev={() => setReplayIndex((i) => Math.max(0, i - 1))}
          onNext={() => setReplayIndex((i) => Math.min(messages.length - 1, i + 1))}
        />
      )}

      {/* Bottom tab bar — fixed */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#0a0a0a]/95 backdrop-blur border-t border-white/10 grid grid-cols-4">
        {(
          [
            { id: "chat", icon: "💬", label: "Chat", badge: newChatCount },
            { id: "players", icon: "👥", label: "Players", badge: newEliminationsCount },
            { id: "diary", icon: "📓", label: "Diary", badge: newDiaryCount },
            { id: "votes", icon: "🗳", label: "Votes", badge: 0 },
          ] as Array<{ id: MobileTab; icon: string; label: string; badge: number }>
        ).map(({ id, icon, label, badge }) => (
          <button
            key={id}
            onClick={() => {
              setMobileTab(id);
              if (id === "chat") setNewChatCount(0);
              if (id === "players") setNewEliminationsCount(0);
              if (id === "diary") setNewDiaryCount(0);
            }}
            className={`relative flex flex-col items-center justify-center py-2 text-xs transition-colors ${
              mobileTab === id
                ? "text-white"
                : "text-white/35 hover:text-white/60"
            }`}
          >
            <span className="text-base mb-0.5">{icon}</span>
            <span className="text-[10px] uppercase tracking-wide">{label}</span>
            {badge > 0 && (
              <span className="absolute top-1 right-3 text-[9px] bg-indigo-600 text-white rounded-full min-w-[14px] h-[14px] flex items-center justify-center leading-none px-0.5">
                {badge > 9 ? "9+" : badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>

    {/* ── Desktop layout (≥768px) — 2-column grid ── */}
    <div className="hidden md:grid md:grid-cols-[1fr_240px] gap-4">
      {/* Left: main feed + diary room panel */}
      <div className="flex flex-col min-h-0">
        {/* Phase header */}
        <PhaseHeader game={replayGame} isReplay={isReplay} />

        {/* Join banner — shown when game is waiting for players */}
        {game.status === "waiting" && !joinedSuccess && (
          <div className="mb-3 border border-indigo-500/30 bg-indigo-950/30 rounded-xl px-5 py-3.5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-indigo-300">Open for players</p>
              <p className="text-xs text-white/30 mt-0.5">Waiting room — join before the game starts</p>
            </div>
            <button
              onClick={handleJoinClick}
              className="shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              Join Game
            </button>
          </div>
        )}

        {/* Tab toggle: Main Stage | Diary Room */}
        <div className="flex items-center gap-1 mb-3">
          <button
            onClick={() => setActiveTab("stage")}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === "stage"
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            💬 Main Stage
          </button>
          <button
            onClick={() => {
              setActiveTab("diary");
              setNewDiaryCount(0);
            }}
            className={`relative text-xs px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === "diary"
                ? "bg-purple-900/30 text-purple-300"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            📓 Diary Room
            {newDiaryCount > 0 && (
              <span className="absolute -top-1 -right-1 text-[10px] bg-purple-600 text-white rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {newDiaryCount > 9 ? "9+" : newDiaryCount}
              </span>
            )}
          </button>

          {/* Connection badge pushed to right */}
          <div className="ml-auto flex items-center gap-3">
            <ConnectionBadge status={connStatus} />
            {!isReplay && activeTab === "stage" && (
              <span className="text-xs text-white/20">
                {messages.filter((m) => m.scope !== "diary").length} messages
              </span>
            )}
          </div>
        </div>

        {/* Diary Room panel */}
        {activeTab === "diary" && (
          <DiaryRoomPanel
            messages={isReplay ? messages : visibleMessages}
            players={game.players}
            isAuthenticated={isAuthenticated}
            isReplay={isReplay}
          />
        )}

        {/* Main Stage: Whisper phase quiet-state */}
        {activeTab === "stage" && replayGame.currentPhase === "WHISPER" && !isReplay && (
          <WhisperPhaseView
            phaseEntries={currentWhisperEntries}
            players={game.players}
            phaseKey={`whisper-${replayGame.currentRound}`}
          />
        )}

        {/* Main Stage: Reveal choreography panel (REVEAL/COUNCIL, live mode) */}
        {activeTab === "stage" &&
          (replayGame.currentPhase === "REVEAL" || replayGame.currentPhase === "COUNCIL") &&
          !isReplay && (
            <RevealModeView
              shown={revealShown}
              pendingCount={revealQueue.length}
              players={game.players}
              phase={replayGame.currentPhase}
            />
          )}

        {/* Main Stage message feed (all other phases + replay) */}
        {activeTab === "stage" &&
          replayGame.currentPhase !== "WHISPER" &&
          (isReplay ||
            (replayGame.currentPhase !== "REVEAL" && replayGame.currentPhase !== "COUNCIL")) && (
          <div
            ref={feedRef}
            className="border border-white/10 rounded-xl flex-1 overflow-y-auto p-4 space-y-3 min-h-[420px] max-h-[600px]"
          >
            {visibleMessages.filter((m) => m.scope !== "diary" && m.scope !== "whisper").length === 0 ? (
              <p className="text-center text-white/20 text-sm mt-16">
                {isReplay ? "No messages in replay." : "Waiting for game to begin…"}
              </p>
            ) : (
              groupMessages(visibleMessages.filter((m) => m.scope !== "diary" && m.scope !== "whisper")).map(
                (item) => {
                  // Last-words messages get the elimination choreography component
                  if (item.kind === "msg" && lastWordsIds.has(item.entry.id)) {
                    return (
                      <LastWordsMessage
                        key={item.entry.id}
                        entry={item.entry}
                        players={game.players}
                        speedrun={isSpeedrun}
                        isReplay={isReplay}
                      />
                    );
                  }
                  if (item.kind === "msg") {
                    return (
                      <MessageBubble
                        key={item.entry.id}
                        msg={item.entry}
                        players={game.players}
                      />
                    );
                  }
                  // diary_pair / diary_orphan_answer won't appear (filtered out above)
                  return null;
                },
              )
            )}
          </div>
        )}

        {/* Replay controls */}
        {isReplay && messages.length > 0 && (
          <ReplayControls
            current={replayIndex}
            total={messages.length}
            onFirst={() => setReplayIndex(0)}
            onLast={() => setReplayIndex(messages.length - 1)}
            onPrev={() => setReplayIndex((i) => Math.max(0, i - 1))}
            onNext={() => setReplayIndex((i) => Math.min(messages.length - 1, i + 1))}
          />
        )}
      </div>

      {/* Right: player roster */}
      <div>
        <PlayerRoster
          players={game.players}
          empoweredPlayerId={empoweredPlayerId}
          eliminatedRounds={eliminatedRounds}
          recentlyUnshielded={recentlyUnshielded}
          speedrun={isSpeedrun}
        />
      </div>
    </div>
    </>
  );
}
