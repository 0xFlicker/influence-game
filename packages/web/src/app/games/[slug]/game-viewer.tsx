"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { getGame, getGameTranscript, getAuthToken, type GameDetail, type GamePlayer, type GameSummary, type TranscriptEntry, type WsGameEvent, type WsTranscriptEntry, type PhaseKey, type TranscriptScope } from "@/lib/api";
import { Typewriter } from "@/components/typewriter";
import { audioCue } from "@/lib/audio-cues";
import { AgentAvatar } from "@/components/agent-avatar";
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

// Phase accent color — driven by CSS custom property via data-phase on root.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function phaseColor(_phase: PhaseKey): string {
  return "text-phase";
}

// Set data-phase attribute on document root for CSS variable cascade.
function setPhaseAttr(phase: PhaseKey) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-phase", phase);
  }
}

// Endgame phases for gold overlay
const ENDGAME_PHASES: ReadonlySet<PhaseKey> = new Set([
  "PLEA", "ACCUSATION", "DEFENSE", "OPENING_STATEMENTS",
  "JURY_QUESTIONS", "CLOSING_ARGUMENTS", "JURY_VOTE", "END",
]);

function setEndgameAttr(phase: PhaseKey) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-endgame", ENDGAME_PHASES.has(phase) ? "true" : "false");
  }
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
  /** Present on per-room whisper scenes (spectacle mode splits whisper phases by room). */
  whisperRoom?: { roomId: number; playerNames: string[] };
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

function buildReplayScenes(transcript: TranscriptEntry[], players: GamePlayer[]): ReplayScene[] {
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

    if (phase === "WHISPER") {
      // Split whisper phases into per-room scenes for proper screen time
      const stageData = buildWhisperStageData(msgs, players);

      // System messages scene (allocation reveal)
      const systemMsgs = msgs.filter((m) => m.scope === "system");
      if (systemMsgs.length > 0) {
        scenes.push({
          id: `${id}-allocation`,
          round,
          phase,
          roomType,
          messages: systemMsgs,
          houseIntro: HOUSE_INTROS[phase] ?? null,
        });
      }

      // Per-room scenes — each room gets its own scene with proper screen time
      for (const room of stageData.rooms) {
        if (room.messages.length > 0) {
          scenes.push({
            id: `${id}-room-${room.roomId}`,
            round,
            phase,
            roomType,
            messages: room.messages,
            houseIntro: null,
            whisperRoom: { roomId: room.roomId, playerNames: room.playerNames },
          });
        }
      }
    } else {
      scenes.push({
        id,
        round,
        phase,
        roomType,
        messages: msgs,
        houseIntro: HOUSE_INTROS[phase] ?? null,
      });
    }
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

// Spectacle mode timing — 1x is ~0.25x the old speed
const BASE_INTERVAL_MS = 10000;
const INTER_SCENE_PAUSE_MS = 2500;
const TYPING_HOLD_MS = 2000;
const POST_REVEAL_BASE_MS = 2500;
const POST_REVEAL_PER_CHAR_MS = 35;
// Dramatic phases get extra timing multiplier on top of spectacle base
const DRAMATIC_PHASE_MULTIPLIER = 2.5;
const DRAMATIC_PHASES: ReadonlySet<PhaseKey> = new Set([
  "VOTE", "POWER", "REVEAL", "COUNCIL", "JURY_VOTE",
]);

// ---------------------------------------------------------------------------
// Transcript message parsers — extract structured data from system messages
// ---------------------------------------------------------------------------

function parseVoteMsg(text: string) {
  const m = text.match(/^(.+?) votes: empower=(.+?), expose=(.+?)$/);
  return m ? { voter: m[1]!, empower: m[2]!, expose: m[3]! } : null;
}

function parseEmpowered(text: string) {
  const m = text.match(/^Empowered: (.+)$/);
  return m ? { name: m[1]! } : null;
}

function parseCouncilVoteMsg(text: string) {
  const m = text.match(/^(.+?) council vote -> (.+?)$/);
  return m ? { voter: m[1]!, target: m[2]! } : null;
}

function parsePowerAction(text: string) {
  const m = text.match(/^(.+?) power action: (protect|eliminate) -> (.+?)$/);
  return m ? { agent: m[1]!, action: m[2]! as "protect" | "eliminate", target: m[3]! } : null;
}

function parseJuryVoteMsg(text: string) {
  const m = text.match(/^(.+?) \(juror\) votes for: (.+?)$/);
  return m ? { juror: m[1]!, target: m[2]! } : null;
}

function parseJuryTally(text: string) {
  const m = text.match(/^Jury votes for (.+?): (\d+)$/);
  return m ? { candidate: m[1]!, votes: parseInt(m[2]!, 10) } : null;
}

function parseWinnerAnnouncement(text: string) {
  const m = text.match(/\*{3} THE WINNER IS: (.+?) \*{3}/);
  return m ? { winner: m[1]! } : null;
}

function parseJuryQuestion(text: string) {
  const m = text.match(/^\[QUESTION to (.+?)\] (.+)$/);
  return m ? { finalist: m[1]!, question: m[2]! } : null;
}

function parseJuryAnswer(text: string) {
  const m = text.match(/^\[ANSWER to (.+?)\] (.+)$/);
  return m ? { juror: m[1]!, answer: m[2]! } : null;
}

function parseEliminationVote(text: string) {
  const m = text.match(/^(.+?) votes to eliminate: (.+?)$/);
  return m ? { voter: m[1]!, target: m[2]! } : null;
}

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
    <div className="influence-glass rounded-panel p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <span className="text-sm font-semibold uppercase tracking-wider text-phase">
            {PHASE_LABELS[game.currentPhase] ?? game.currentPhase}
          </span>
          <div className="text-text-secondary text-xs mt-0.5">
            Round {game.currentRound} / {game.maxRounds}
            {!isReplay && game.status === "in_progress" && (
              <span className="ml-3">{alive} alive · {total - alive} out</span>
            )}
            {game.status === "completed" && game.winner && (
              <span className="ml-3 text-green-400">{game.winner} wins</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="h-1.5 bg-white/10 rounded-full w-32 overflow-hidden">
            <div
              className="h-full bg-phase rounded-full transition-all duration-500"
              style={{ width: `${roundPct}%` }}
            />
          </div>
          <span className="text-text-muted text-xs mt-1 inline-block">{roundPct}% complete</span>
        </div>
      </div>
    </div>
  );
}

/**
 * GameStateHUD — compact corner overlay showing game state at a glance.
 * Like a sports broadcast "score bug": always visible, compact, informative.
 */
function GameStateHUD({
  players,
  currentRound,
  maxRounds,
  phase,
  empoweredPlayerId,
}: {
  players: GamePlayer[];
  currentRound: number;
  maxRounds: number;
  phase: PhaseKey;
  empoweredPlayerId: string | null;
}) {
  const alive = players.filter((p) => p.status === "alive");
  const eliminated = players.filter((p) => p.status === "eliminated");
  const shielded = alive.filter((p) => p.shielded);
  const empowered = empoweredPlayerId
    ? players.find((p) => p.id === empoweredPlayerId)
    : null;

  return (
    <div className="influence-glass rounded-panel p-3 text-xs space-y-2 min-w-[180px]">
      {/* Phase & Round */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wider text-phase truncate">
          {PHASE_LABELS[phase] ?? phase}
        </span>
        <span className="text-text-muted flex-shrink-0">
          R{currentRound}/{maxRounds}
        </span>
      </div>

      {/* Player counts */}
      <div className="flex items-center gap-3 text-text-secondary">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          {alive.length} alive
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400/50" />
          {eliminated.length} out
        </span>
      </div>

      {/* Status indicators */}
      {(shielded.length > 0 || empowered) && (
        <div className="border-t border-white/5 pt-2 space-y-1">
          {empowered && (
            <div className="flex items-center gap-1.5 text-amber-400/80">
              <span>👑</span>
              <span className="truncate">{empowered.name}</span>
            </div>
          )}
          {shielded.length > 0 && (
            <div className="flex items-center gap-1.5 text-blue-400/80">
              <span>🛡</span>
              <span className="truncate">{shielded.map((p) => p.name).join(", ")}</span>
            </div>
          )}
        </div>
      )}

      {/* Round progress dots */}
      <div className="flex gap-1 pt-1">
        {Array.from({ length: maxRounds }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i < currentRound ? "bg-phase/70" : "bg-white/10"
            }`}
          />
        ))}
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
    <div className="influence-glass rounded-panel p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
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
              <AgentAvatar avatarUrl={p.avatarUrl} persona={p.persona} name={p.name} size="8" />
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
          {player && <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />}
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
      <div className="flex-shrink-0">
        {player ? <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="8" /> : <span className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-sm">?</span>}
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

// ---------------------------------------------------------------------------
// Group Chat Feed — scrolling chat for INTRODUCTION / LOBBY phases (live mode)
// ---------------------------------------------------------------------------

function GroupChatFeed({
  messages,
  players,
}: {
  messages: TranscriptEntry[];
  players: GamePlayer[];
  phase: PhaseKey;
}) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages.length]);

  return (
    <div
      ref={feedRef}
      className="influence-glass rounded-panel flex-1 overflow-y-auto p-4 md:p-6 min-h-[420px] max-h-[600px]"
    >
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-white/20 text-sm animate-pulse">Waiting for messages…</p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((msg) => (
            <div key={msg.id} className="animate-[fadeIn_0.3s_ease-out]">
              <MessageBubble msg={msg} players={players} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Jury DM View — DM-style layout for JURY_QUESTIONS phase (live mode)
// ---------------------------------------------------------------------------

function JuryDMView({
  messages,
  players,
}: {
  messages: TranscriptEntry[];
  players: GamePlayer[];
}) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages.length]);

  return (
    <div
      ref={feedRef}
      className="influence-glass rounded-panel flex-1 overflow-y-auto p-4 md:p-6 min-h-[420px] max-h-[600px]"
    >
      <div className="text-center mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-amber-300/70 mb-1">
          Jury Questions
        </p>
      </div>
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <p className="text-white/20 text-sm animate-pulse">Awaiting jury questions…</p>
        </div>
      ) : (
        <div className="space-y-3 max-w-lg mx-auto">
          {messages.map((msg) => {
            const question = parseJuryQuestion(msg.text);
            const answer = parseJuryAnswer(msg.text);
            const isQuestion = !!question;
            const isAnswer = !!answer;

            if (isQuestion) {
              const fromPlayer = msg.fromPlayerId
                ? players.find((p) => p.id === msg.fromPlayerId) ?? players.find((p) => p.name === msg.fromPlayerId)
                : null;
              const fromName = msg.fromPlayerName ?? fromPlayer?.name ?? "Juror";
              return (
                <div key={msg.id} className="flex gap-2 justify-start animate-[fadeIn_0.3s_ease-out]">
                  <div className="flex-shrink-0 mt-1">
                    {fromPlayer ? <AgentAvatar avatarUrl={fromPlayer.avatarUrl} persona={fromPlayer.persona} name={fromPlayer.name} size="8" /> : <span className="w-7 h-7 rounded-full bg-amber-900/30 flex items-center justify-center text-xs text-amber-300/60">?</span>}
                  </div>
                  <div className="max-w-[80%]">
                    <p className="text-[10px] text-amber-400/60 mb-0.5">{fromName} <span className="text-white/20">to {question.finalist}</span></p>
                    <div className="bg-white/[0.06] border border-white/[0.08] rounded-2xl rounded-tl-sm px-4 py-2.5">
                      <p className="text-sm text-white/70 leading-relaxed italic">{question.question}</p>
                    </div>
                  </div>
                </div>
              );
            }

            if (isAnswer) {
              const fromPlayer = msg.fromPlayerId
                ? players.find((p) => p.id === msg.fromPlayerId) ?? players.find((p) => p.name === msg.fromPlayerId)
                : null;
              const fromName = msg.fromPlayerName ?? fromPlayer?.name ?? "Finalist";
              return (
                <div key={msg.id} className="flex gap-2 justify-end animate-[fadeIn_0.3s_ease-out]">
                  <div className="max-w-[80%]">
                    <p className="text-[10px] text-amber-300/60 text-right mb-0.5">{fromName}</p>
                    <div className="bg-amber-900/20 border border-amber-700/20 rounded-2xl rounded-tr-sm px-4 py-2.5">
                      <p className="text-sm text-white/80 leading-relaxed">{answer.answer}</p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 mt-1">
                    {fromPlayer ? <AgentAvatar avatarUrl={fromPlayer.avatarUrl} persona={fromPlayer.persona} name={fromPlayer.name} size="8" /> : <span className="w-7 h-7 rounded-full bg-amber-900/30 flex items-center justify-center text-xs text-amber-300/60">?</span>}
                  </div>
                </div>
              );
            }

            // System or non-jury message
            return <MessageBubble key={msg.id} msg={msg} players={players} />;
          })}
        </div>
      )}
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
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 300ms ease-in-out",
        pointerEvents: "none",
      }}
    >
      {/* Cinematic backdrop */}
      <div className="absolute inset-0 bg-black/90" />
      <div className="influence-phase-atmosphere absolute inset-0" />
      <div className="influence-phase-vignette absolute inset-0" />

      <div className="relative text-center px-8 max-w-2xl">
        <div className="influence-phase-bloom absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
        <p className="text-white/20 text-sm tracking-[0.4em] uppercase mb-8">◆ ◆ ◆</p>
        <h1
          className="text-3xl md:text-4xl font-extralight tracking-[0.20em] uppercase mb-6 influence-phase-title"
        >
          {label}
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
            <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />
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
                {player && <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />}
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
// Whisper phase — DM grid (desktop) / tabbed rooms (mobile)
// ---------------------------------------------------------------------------

/** Single DM-style room chat box — messages aligned left/right based on speaker. */
function WhisperRoomDM({
  room,
  players,
  anonymous = false,
}: {
  room: WhisperRoomStage;
  players: GamePlayer[];
  anonymous?: boolean;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [room.messages.length]);

  // First player in the room is treated as "self" (messages on right)
  const selfId = room.playerIds[0];

  return (
    <div className="rounded-2xl border border-purple-400/20 bg-black/30 flex flex-col overflow-hidden h-full">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-purple-900/20">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-purple-300/45 flex-shrink-0">
            Room {room.roomId}
          </p>
          <p className="text-xs font-semibold text-white truncate">
            {room.playerNames.join(" × ")}
          </p>
        </div>
        {anonymous ? (
          <span className="rounded-full border border-purple-400/25 bg-purple-400/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-purple-200/80 flex-shrink-0">
            Anonymous
          </span>
        ) : (
          <span className="rounded-full border border-red-400/25 bg-red-400/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-red-200/80 flex-shrink-0">
            Live
          </span>
        )}
      </div>

      <div ref={feedRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
        {room.messages.length === 0 ? (
          <p className="text-xs text-white/30 italic text-center py-6">Waiting…</p>
        ) : (
          room.messages.map((msg, idx) => {
            const isRevealed = !anonymous || revealedIds.has(msg.id);
            const isSelf = msg.fromPlayerId === selfId;
            const player = players.find((c) => c.id === msg.fromPlayerId)
              ?? players.find((c) => c.name === msg.fromPlayerId);
            const name = isRevealed ? (player?.name ?? msg.fromPlayerId ?? "Unknown") : "???";
            // Alternate sides for anonymous mode since we can't use sender identity
            const showOnRight = anonymous ? idx % 2 === 1 : isSelf;

            const handleReveal = () => {
              if (anonymous && !isRevealed) {
                setRevealedIds((prev) => new Set(prev).add(msg.id));
              }
            };

            return (
              <div
                key={msg.id}
                className={`flex gap-2 ${showOnRight ? "justify-end" : "justify-start"} animate-[fadeIn_0.25s_ease-out]`}
                onClick={handleReveal}
                role={anonymous && !isRevealed ? "button" : undefined}
                tabIndex={anonymous && !isRevealed ? 0 : undefined}
                onKeyDown={anonymous && !isRevealed ? (e) => { if (e.key === "Enter" || e.key === " ") handleReveal(); } : undefined}
              >
                {!showOnRight && (
                  <div className="flex-shrink-0 mt-1">
                    {isRevealed && player ? (
                      <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />
                    ) : (
                      <span className="w-6 h-6 rounded-full bg-purple-900/30 flex items-center justify-center text-[10px] text-purple-300/60">?</span>
                    )}
                  </div>
                )}
                <div className={`max-w-[80%] ${showOnRight ? "text-right" : "text-left"}`}>
                  <p className={`text-[10px] mb-0.5 ${isRevealed ? "text-white/30" : "text-purple-300/40 italic"}`}>
                    {name}
                    {anonymous && !isRevealed && <span className="ml-1 text-purple-300/25">(tap to reveal)</span>}
                  </p>
                  <div className={`rounded-2xl px-3 py-2 ${anonymous && !isRevealed ? "cursor-pointer" : ""} ${
                    showOnRight
                      ? "bg-purple-800/30 border border-purple-600/20 rounded-tr-sm"
                      : "bg-white/[0.06] border border-white/[0.08] rounded-tl-sm"
                  }`}>
                    <p className="text-xs leading-relaxed text-white/70 text-left">{msg.text}</p>
                  </div>
                </div>
                {showOnRight && (
                  <div className="flex-shrink-0 mt-1">
                    {isRevealed && player ? (
                      <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />
                    ) : (
                      <span className="w-6 h-6 rounded-full bg-purple-900/30 flex items-center justify-center text-[10px] text-purple-300/60">?</span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function WhisperPhaseView({
  phaseEntries,
  players,
  phaseKey,
  isReplay = false,
}: {
  phaseEntries: TranscriptEntry[];
  players: GamePlayer[];
  phaseKey: string;
  isReplay?: boolean;
}) {
  const stage = buildWhisperStageData(phaseEntries, players);
  const [mobileRoomIndex, setMobileRoomIndex] = useState(0);
  const [showAllocationReveal, setShowAllocationReveal] = useState(true);

  useEffect(() => {
    setMobileRoomIndex(0);
    setShowAllocationReveal(true);
  }, [phaseKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowAllocationReveal(false), 2000);
    return () => window.clearTimeout(timer);
  }, [phaseKey]);

  return (
    <div className="border influence-glass rounded-panel flex-1 overflow-y-auto p-4 md:p-6 min-h-[420px] max-h-[600px]">
      <div className="text-center mb-4">
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
      ) : stage.rooms.length === 0 ? (
        <div className="rounded-2xl border border-purple-900/20 bg-black/20 p-8 text-center text-white/45">
          Waiting for the House to finish assigning rooms.
        </div>
      ) : (
        <>
          {/* Desktop: simultaneous grid of all rooms */}
          <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-3" style={{ minHeight: "300px" }}>
            {stage.rooms.map((room) => (
              <WhisperRoomDM key={room.roomId} room={room} players={players} anonymous={!isReplay} />
            ))}
            {stage.commons.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col items-center justify-center text-center">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/30 mb-2">Commons</p>
                <p className="text-sm font-semibold text-white/60">
                  {stage.commons.map((p) => p.name).join(", ")}
                </p>
                <p className="text-xs text-white/30 mt-1">No private room this round.</p>
              </div>
            )}
          </div>

          {/* Mobile: single room with tab buttons */}
          <div className="md:hidden">
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {stage.rooms.map((room, idx) => (
                <button
                  key={room.roomId}
                  type="button"
                  onClick={() => setMobileRoomIndex(idx)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] transition-colors ${
                    mobileRoomIndex === idx
                      ? "border-purple-300/50 bg-purple-300/15 text-white"
                      : "border-white/10 bg-white/5 text-white/50 hover:border-purple-300/30"
                  }`}
                >
                  Room {room.roomId}
                </button>
              ))}
            </div>
            {stage.rooms[mobileRoomIndex] && (
              <div style={{ height: "300px" }}>
                <WhisperRoomDM room={stage.rooms[mobileRoomIndex]} players={players} anonymous={!isReplay} />
              </div>
            )}
          </div>
        </>
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
      <div className="text-center py-3 animate-[fadePure_0.4s_ease-out]">
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
    <div className="flex gap-3 animate-[fadePure_0.4s_ease-out]">
      <div className="flex-shrink-0">
        {player ? <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="8" /> : <span className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-sm">?</span>}
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
            <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />
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
// Diary Room Grid — simultaneous diary rooms (live DIARY_ROOM phase)
// ---------------------------------------------------------------------------

interface DiaryRoomData {
  playerName: string;
  player: GamePlayer | undefined;
  entries: Array<{ question: TranscriptEntry; answer: TranscriptEntry | null }>;
}

function buildDiaryRooms(
  messages: TranscriptEntry[],
  players: GamePlayer[],
): DiaryRoomData[] {
  const diaryMsgs = messages.filter((m) => m.scope === "diary");
  const roomMap = new Map<string, DiaryRoomData>();

  for (const msg of diaryMsgs) {
    const isQuestion = msg.fromPlayerId?.startsWith("House ->");
    const playerName = msg.fromPlayerId ? diaryPlayerName(msg.fromPlayerId) : null;
    if (!playerName) continue;

    if (!roomMap.has(playerName)) {
      roomMap.set(playerName, {
        playerName,
        player: players.find((p) => p.name === playerName),
        entries: [],
      });
    }

    const room = roomMap.get(playerName)!;
    if (isQuestion) {
      room.entries.push({ question: msg, answer: null });
    } else {
      // Match answer to last unanswered question
      const unanswered = room.entries.findLast((e) => e.answer === null);
      if (unanswered) {
        unanswered.answer = msg;
      } else {
        // Orphan answer — create a stub entry
        room.entries.push({ question: msg, answer: null });
      }
    }
  }

  return Array.from(roomMap.values());
}

function DiaryRoomChat({
  room,
}: {
  room: DiaryRoomData;
}) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [room.entries.length]);

  return (
    <div className="rounded-2xl border border-purple-400/20 bg-black/30 flex flex-col overflow-hidden h-full">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-purple-900/20">
        {room.player && <AgentAvatar avatarUrl={room.player.avatarUrl} persona={room.player.persona} name={room.player.name} size="6" />}
        <p className="text-xs font-semibold text-white truncate">{room.playerName}</p>
        <span className="text-[9px] uppercase tracking-[0.2em] text-purple-300/45 ml-auto">Diary</span>
      </div>

      <div ref={feedRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
        {room.entries.length === 0 ? (
          <p className="text-xs text-white/30 italic text-center py-6">Awaiting…</p>
        ) : (
          room.entries.map((entry, idx) => (
            <div key={idx} className="space-y-1.5">
              {/* House question — left side */}
              <div className="flex gap-2 justify-start animate-[fadeIn_0.25s_ease-out]">
                <div className="flex-shrink-0 mt-1">
                  <span className="w-6 h-6 rounded-full bg-purple-900/40 flex items-center justify-center text-[10px]">📔</span>
                </div>
                <div className="max-w-[85%]">
                  <p className="text-[10px] text-purple-300/50 mb-0.5">House</p>
                  <div className="bg-white/[0.06] border border-white/[0.08] rounded-2xl rounded-tl-sm px-3 py-2">
                    <p className="text-xs leading-relaxed text-purple-300/70 italic">{entry.question.text}</p>
                  </div>
                </div>
              </div>
              {/* Player answer — right side */}
              {entry.answer ? (
                <div className="flex gap-2 justify-end animate-[fadeIn_0.25s_ease-out]">
                  <div className="max-w-[85%]">
                    <p className="text-[10px] text-white/40 text-right mb-0.5">{room.playerName}</p>
                    <div className="bg-purple-800/25 border border-purple-600/20 rounded-2xl rounded-tr-sm px-3 py-2">
                      <p className="text-xs leading-relaxed text-white/70">{entry.answer.text}</p>
                    </div>
                  </div>
                  <div className="flex-shrink-0 mt-1">
                    {room.player ? <AgentAvatar avatarUrl={room.player.avatarUrl} persona={room.player.persona} name={room.player.name} size="6" /> : <span className="w-6 h-6 rounded-full bg-purple-900/30 flex items-center justify-center text-[10px] text-purple-300/60">?</span>}
                  </div>
                </div>
              ) : (
                <div className="flex justify-end pr-8">
                  <p className="text-xs text-purple-400/30 italic animate-pulse">typing…</p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DiaryRoomGridView({
  messages,
  players,
}: {
  messages: TranscriptEntry[];
  players: GamePlayer[];
}) {
  const rooms = buildDiaryRooms(messages, players);
  const [mobileRoomIndex, setMobileRoomIndex] = useState(0);

  return (
    <div className="border influence-glass rounded-panel flex-1 overflow-y-auto p-4 md:p-6 min-h-[420px] max-h-[600px]">
      <div className="text-center mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-purple-300/70 mb-1">
          Diary Rooms
        </p>
      </div>

      {rooms.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <p className="text-white/20 text-sm animate-pulse">Waiting for diary sessions…</p>
        </div>
      ) : (
        <>
          {/* Desktop: simultaneous grid */}
          <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-3" style={{ minHeight: "300px" }}>
            {rooms.map((room) => (
              <DiaryRoomChat key={room.playerName} room={room} />
            ))}
          </div>

          {/* Mobile: single room with tabs */}
          <div className="md:hidden">
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {rooms.map((room, idx) => (
                <button
                  key={room.playerName}
                  type="button"
                  onClick={() => setMobileRoomIndex(idx)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] transition-colors flex items-center gap-1 ${
                    mobileRoomIndex === idx
                      ? "border-purple-300/50 bg-purple-300/15 text-white"
                      : "border-white/10 bg-white/5 text-white/50 hover:border-purple-300/30"
                  }`}
                >
                  {room.player && <AgentAvatar avatarUrl={room.player.avatarUrl} persona={room.player.persona} name={room.player.name} size="6" />}
                  {room.playerName}
                </button>
              ))}
            </div>
            {rooms[mobileRoomIndex] && (
              <div style={{ height: "300px" }}>
                <DiaryRoomChat room={rooms[mobileRoomIndex]} />
              </div>
            )}
          </div>
        </>
      )}
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

// ---------------------------------------------------------------------------
// Vote/Council tally overlay — running counts during dramatic reveal phases
// ---------------------------------------------------------------------------

function VoteTallyOverlay({
  sceneMessages,
  upToIndex,
  players,
  scenePhase,
}: {
  sceneMessages: TranscriptEntry[];
  upToIndex: number;
  players: GamePlayer[];
  scenePhase: PhaseKey;
}) {
  const visible = sceneMessages.slice(0, upToIndex + 1);

  // Parse tallies based on phase type
  if (scenePhase === "VOTE") {
    const empowerCounts = new Map<string, number>();
    const exposeCounts = new Map<string, number>();
    for (const msg of visible) {
      const vote = parseVoteMsg(msg.text);
      if (vote) {
        empowerCounts.set(vote.empower, (empowerCounts.get(vote.empower) ?? 0) + 1);
        exposeCounts.set(vote.expose, (exposeCounts.get(vote.expose) ?? 0) + 1);
      }
    }
    const hasVotes = empowerCounts.size > 0 || exposeCounts.size > 0;
    if (!hasVotes) return null;

    const sorted = players
      .filter((p) => p.status === "alive")
      .map((p) => ({
        player: p,
        empower: empowerCounts.get(p.name) ?? 0,
        expose: exposeCounts.get(p.name) ?? 0,
      }))
      .sort((a, b) => b.expose - a.expose);
    const maxExpose = Math.max(...sorted.map((s) => s.expose), 0);

    return (
      <div className="mt-8 max-w-sm mx-auto animate-[fadePure_0.4s_ease-out]">
        <p className="text-[10px] uppercase tracking-[0.3em] text-white/20 text-center mb-3">Vote Tally</p>
        <div className="space-y-1">
          {sorted.map(({ player, empower, expose }) => (
            <div
              key={player.id}
              className={`flex items-center gap-2 py-1.5 px-3 rounded-lg transition-all duration-500 ${
                expose > 0 && expose === maxExpose
                  ? "bg-red-900/25 border border-red-500/25"
                  : "bg-white/[0.02]"
              }`}
            >
              <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />
              <span className="text-xs text-white/60 flex-1">{player.name}</span>
              {empower > 0 && (
                <span className="text-[10px] text-amber-400 bg-amber-900/25 px-1.5 py-0.5 rounded">
                  👑 {empower}
                </span>
              )}
              {expose > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  expose === maxExpose ? "text-red-300 bg-red-900/40 font-bold" : "text-red-400/70 bg-red-900/20"
                }`}>
                  ⚡ {expose}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (scenePhase === "COUNCIL") {
    const voteCounts = new Map<string, number>();
    for (const msg of visible) {
      const vote = parseCouncilVoteMsg(msg.text);
      if (vote) {
        voteCounts.set(vote.target, (voteCounts.get(vote.target) ?? 0) + 1);
      }
    }
    if (voteCounts.size === 0) return null;

    const sorted = Array.from(voteCounts.entries())
      .sort((a, b) => b[1] - a[1]);
    const maxVotes = sorted[0]?.[1] ?? 0;

    return (
      <div className="mt-8 max-w-sm mx-auto animate-[fadePure_0.4s_ease-out]">
        <p className="text-[10px] uppercase tracking-[0.3em] text-red-400/40 text-center mb-3">Council Vote</p>
        <div className="space-y-1">
          {sorted.map(([name, count]) => {
            const player = players.find((p) => p.name === name);
            return (
              <div
                key={name}
                className={`flex items-center gap-2 py-1.5 px-3 rounded-lg transition-all duration-500 ${
                  count > 0 && count === maxVotes
                    ? "bg-red-900/25 border border-red-500/25"
                    : "bg-white/[0.02]"
                }`}
              >
                {player && <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />}
                <span className="text-xs text-white/60 flex-1">{name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  count === maxVotes ? "text-red-300 bg-red-900/40 font-bold" : "text-red-400/70 bg-red-900/20"
                }`}>
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (scenePhase === "JURY_VOTE") {
    const juryCounts = new Map<string, number>();
    for (const msg of visible) {
      const vote = parseJuryVoteMsg(msg.text);
      if (vote) {
        juryCounts.set(vote.target, (juryCounts.get(vote.target) ?? 0) + 1);
      }
      const tally = parseJuryTally(msg.text);
      if (tally) {
        juryCounts.set(tally.candidate, tally.votes);
      }
    }
    if (juryCounts.size === 0) return null;

    return (
      <div className="mt-8 max-w-sm mx-auto animate-[fadePure_0.4s_ease-out]">
        <p className="text-[10px] uppercase tracking-[0.3em] text-amber-400/40 text-center mb-3">Jury Verdict</p>
        <div className="flex items-center justify-center gap-12">
          {Array.from(juryCounts.entries()).map(([name, count]) => {
            const player = players.find((p) => p.name === name);
            return (
              <div key={name} className="text-center">
                {player && <div className="mb-1 flex justify-center"><AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="10" /></div>}
                <p className="text-sm text-white/70 font-semibold">{name}</p>
                <p className="text-3xl font-bold text-amber-400 mt-1">{count}</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Reckoning/Tribunal elimination votes
  if (scenePhase === "PLEA" || scenePhase === "ACCUSATION" || scenePhase === "DEFENSE") return null;

  // Fallback: try to parse elimination votes
  const elimCounts = new Map<string, number>();
  for (const msg of visible) {
    const vote = parseEliminationVote(msg.text);
    if (vote) {
      elimCounts.set(vote.target, (elimCounts.get(vote.target) ?? 0) + 1);
    }
  }
  if (elimCounts.size === 0) return null;

  const sortedElim = Array.from(elimCounts.entries())
    .sort((a, b) => b[1] - a[1]);
  const maxElim = sortedElim[0]?.[1] ?? 0;

  return (
    <div className="mt-8 max-w-sm mx-auto animate-[fadePure_0.4s_ease-out]">
      <p className="text-[10px] uppercase tracking-[0.3em] text-red-400/40 text-center mb-3">Elimination Vote</p>
      <div className="space-y-1">
        {sortedElim.map(([name, count]) => {
          const player = players.find((p) => p.name === name);
          return (
            <div
              key={name}
              className={`flex items-center gap-2 py-1.5 px-3 rounded-lg transition-all duration-500 ${
                count > 0 && count === maxElim
                  ? "bg-red-900/25 border border-red-500/25"
                  : "bg-white/[0.02]"
              }`}
            >
              {player && <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />}
              <span className="text-xs text-white/60 flex-1">{name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                count === maxElim ? "text-red-300 bg-red-900/40 font-bold" : "text-red-400/70 bg-red-900/20"
              }`}>
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styled vote card — replaces plain text for vote messages
// ---------------------------------------------------------------------------

function StyledVoteCard({
  text,
  players,
}: {
  text: string;
  players: GamePlayer[];
}) {
  const vote = parseVoteMsg(text);
  if (vote) {
    const voterPlayer = players.find((p) => p.name === vote.voter);
    const empowerPlayer = players.find((p) => p.name === vote.empower);
    const exposePlayer = players.find((p) => p.name === vote.expose);
    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <div className="flex items-center justify-center gap-3 mb-6">
          {voterPlayer && <AgentAvatar avatarUrl={voterPlayer.avatarUrl} persona={voterPlayer.persona} name={voterPlayer.name} size="10" />}
          <span className="text-lg font-semibold text-white/70">{vote.voter}</span>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl px-8 py-6 inline-block max-w-md">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-amber-400 text-sm uppercase tracking-wider w-20 text-right">Empower</span>
              <span className="text-xl">👑</span>
              {empowerPlayer && <AgentAvatar avatarUrl={empowerPlayer.avatarUrl} persona={empowerPlayer.persona} name={empowerPlayer.name} size="6" />}
              <span className="text-lg font-semibold text-amber-300">{vote.empower}</span>
            </div>
            <div className="border-t border-white/5" />
            <div className="flex items-center gap-3">
              <span className="text-red-400 text-sm uppercase tracking-wider w-20 text-right">Expose</span>
              <span className="text-xl">⚡</span>
              {exposePlayer && <AgentAvatar avatarUrl={exposePlayer.avatarUrl} persona={exposePlayer.persona} name={exposePlayer.name} size="6" />}
              <span className="text-lg font-semibold text-red-300">{vote.expose}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const councilVote = parseCouncilVoteMsg(text);
  if (councilVote) {
    const voterPlayer = players.find((p) => p.name === councilVote.voter);
    const targetPlayer = players.find((p) => p.name === councilVote.target);
    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <div className="flex items-center justify-center gap-3 mb-6">
          {voterPlayer && <AgentAvatar avatarUrl={voterPlayer.avatarUrl} persona={voterPlayer.persona} name={voterPlayer.name} size="10" />}
          <span className="text-lg font-semibold text-white/70">{councilVote.voter}</span>
        </div>
        <div className="bg-red-900/10 border border-red-500/15 rounded-2xl px-8 py-6 inline-block">
          <p className="text-xs text-red-400/50 uppercase tracking-wider mb-2">Votes to eliminate</p>
          <div className="flex items-center justify-center gap-3">
            {targetPlayer && <AgentAvatar avatarUrl={targetPlayer.avatarUrl} persona={targetPlayer.persona} name={targetPlayer.name} size="10" />}
            <span className="text-2xl font-bold text-red-300">{councilVote.target}</span>
          </div>
        </div>
      </div>
    );
  }

  const juryVote = parseJuryVoteMsg(text);
  if (juryVote) {
    const jurorPlayer = players.find((p) => p.name === juryVote.juror);
    const targetPlayer = players.find((p) => p.name === juryVote.target);
    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <div className="flex items-center justify-center gap-3 mb-6">
          {jurorPlayer && <AgentAvatar avatarUrl={jurorPlayer.avatarUrl} persona={jurorPlayer.persona} name={jurorPlayer.name} size="10" />}
          <span className="text-lg font-semibold text-white/50">{juryVote.juror}</span>
          <span className="text-xs text-white/25 uppercase tracking-wider">(juror)</span>
        </div>
        <div className="bg-amber-900/10 border border-amber-500/15 rounded-2xl px-8 py-6 inline-block">
          <p className="text-xs text-amber-400/50 uppercase tracking-wider mb-2">Votes for</p>
          <div className="flex items-center justify-center gap-3">
            {targetPlayer && <AgentAvatar avatarUrl={targetPlayer.avatarUrl} persona={targetPlayer.persona} name={targetPlayer.name} size="10" />}
            <span className="text-2xl font-bold text-amber-300">{juryVote.target}</span>
          </div>
        </div>
      </div>
    );
  }

  const powerAction = parsePowerAction(text);
  if (powerAction) {
    const agentPlayer = players.find((p) => p.name === powerAction.agent);
    const targetPlayer = players.find((p) => p.name === powerAction.target);
    const isProtect = powerAction.action === "protect";
    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <div className="flex items-center justify-center gap-3 mb-6">
          <span className="text-2xl">👑</span>
          {agentPlayer && <AgentAvatar avatarUrl={agentPlayer.avatarUrl} persona={agentPlayer.persona} name={agentPlayer.name} size="10" />}
          <span className="text-lg font-semibold text-amber-300">{powerAction.agent}</span>
        </div>
        <div className={`${isProtect ? "bg-blue-900/10 border-blue-500/15" : "bg-red-900/15 border-red-500/20"} border rounded-2xl px-8 py-6 inline-block`}>
          <p className={`text-xs uppercase tracking-wider mb-2 ${isProtect ? "text-blue-400/50" : "text-red-400/60"}`}>
            {isProtect ? "Protects" : "Eliminates"}
          </p>
          <div className="flex items-center justify-center gap-3">
            <span className="text-2xl">{isProtect ? "🛡" : "💀"}</span>
            {targetPlayer && <AgentAvatar avatarUrl={targetPlayer.avatarUrl} persona={targetPlayer.persona} name={targetPlayer.name} size="10" />}
            <span className={`text-2xl font-bold ${isProtect ? "text-blue-300" : "text-red-300"}`}>
              {powerAction.target}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const empowered = parseEmpowered(text);
  if (empowered) {
    const empPlayer = players.find((p) => p.name === empowered.name);
    return (
      <div className="text-center animate-[fadeIn_0.5s_ease-out]">
        <p className="text-xs text-amber-400/40 uppercase tracking-[0.3em] mb-4">◆ EMPOWERED ◆</p>
        <div className="flex items-center justify-center gap-4">
          <span className="text-4xl">👑</span>
          {empPlayer && <AgentAvatar avatarUrl={empPlayer.avatarUrl} persona={empPlayer.persona} name={empPlayer.name} size="16" />}
        </div>
        <p className="text-3xl font-bold text-amber-300 mt-4 tracking-wide">{empowered.name}</p>
        <p className="text-xs text-amber-400/30 mt-2 uppercase tracking-wider">
          holds the power token
        </p>
      </div>
    );
  }

  const winner = parseWinnerAnnouncement(text);
  if (winner) {
    const winPlayer = players.find((p) => p.name === winner.winner);
    return (
      <div className="text-center animate-[fadeIn_0.5s_ease-out]">
        <p className="text-xs text-amber-400/40 uppercase tracking-[0.4em] mb-6">◆ ◆ ◆</p>
        <p className="text-sm text-white/30 uppercase tracking-[0.3em] mb-4">THE WINNER IS</p>
        <div className="flex items-center justify-center gap-4 mb-4">
          {winPlayer && <AgentAvatar avatarUrl={winPlayer.avatarUrl} persona={winPlayer.persona} name={winPlayer.name} size="16" />}
        </div>
        <p className="text-4xl md:text-5xl font-bold text-amber-300 tracking-wide">{winner.winner}</p>
        <p className="text-xs text-amber-400/30 mt-4 uppercase tracking-[0.4em]">◆ ◆ ◆</p>
      </div>
    );
  }

  const elimVote = parseEliminationVote(text);
  if (elimVote) {
    const voterPlayer = players.find((p) => p.name === elimVote.voter);
    const targetPlayer = players.find((p) => p.name === elimVote.target);
    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <div className="flex items-center justify-center gap-3 mb-6">
          {voterPlayer && <AgentAvatar avatarUrl={voterPlayer.avatarUrl} persona={voterPlayer.persona} name={voterPlayer.name} size="10" />}
          <span className="text-lg font-semibold text-white/70">{elimVote.voter}</span>
        </div>
        <div className="bg-red-900/10 border border-red-500/15 rounded-2xl px-8 py-6 inline-block">
          <p className="text-xs text-red-400/50 uppercase tracking-wider mb-2">Votes to eliminate</p>
          <div className="flex items-center justify-center gap-3">
            {targetPlayer && <AgentAvatar avatarUrl={targetPlayer.avatarUrl} persona={targetPlayer.persona} name={targetPlayer.name} size="10" />}
            <span className="text-2xl font-bold text-red-300">{elimVote.target}</span>
          </div>
        </div>
      </div>
    );
  }

  // Not a parseable vote — return null to use default rendering
  return null;
}

// ---------------------------------------------------------------------------
// Jury question intimate framing
// ---------------------------------------------------------------------------

function JuryQuestionFrame({
  message,
  players,
  messagePhase,
  onRevealComplete,
}: {
  message: TranscriptEntry;
  players: GamePlayer[];
  messagePhase: SpectacleMessagePhase;
  onRevealComplete: () => void;
}) {
  const question = parseJuryQuestion(message.text);
  const answer = parseJuryAnswer(message.text);

  if (question) {
    const fromPlayer = message.fromPlayerId
      ? players.find((p) => p.id === message.fromPlayerId) ?? players.find((p) => p.name === message.fromPlayerId)
      : null;
    const finalistPlayer = players.find((p) => p.name === question.finalist);
    const fromName = message.fromPlayerName ?? fromPlayer?.name ?? message.fromPlayerId ?? "Juror";

    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        {/* Juror → Finalist framing */}
        <div className="flex items-center justify-center gap-6 mb-8">
          <div className="text-center">
            {fromPlayer && <div className="mb-1 flex justify-center"><AgentAvatar avatarUrl={fromPlayer.avatarUrl} persona={fromPlayer.persona} name={fromPlayer.name} size="10" /></div>}
            <span className="text-sm text-white/50">{fromName}</span>
            <span className="text-[10px] text-white/25 block uppercase">juror</span>
          </div>
          <span className="text-white/15 text-lg">→</span>
          <div className="text-center">
            {finalistPlayer && <div className="mb-1 flex justify-center"><AgentAvatar avatarUrl={finalistPlayer.avatarUrl} persona={finalistPlayer.persona} name={finalistPlayer.name} size="10" /></div>}
            <span className="text-sm text-white/70 font-semibold">{question.finalist}</span>
            <span className="text-[10px] text-white/25 block uppercase">finalist</span>
          </div>
        </div>
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-8 py-6 inline-block max-w-xl text-left">
          <p className="text-lg leading-relaxed text-white/70 italic">
            {messagePhase === "revealing" ? (
              <Typewriter text={question.question} rate="spectacle" onComplete={onRevealComplete} />
            ) : question.question}
          </p>
        </div>
      </div>
    );
  }

  if (answer) {
    const fromPlayer = message.fromPlayerId
      ? players.find((p) => p.id === message.fromPlayerId) ?? players.find((p) => p.name === message.fromPlayerId)
      : null;
    const fromName = message.fromPlayerName ?? fromPlayer?.name ?? message.fromPlayerId ?? "Finalist";

    return (
      <div className="text-center animate-[fadeIn_0.3s_ease-out]">
        <div className="flex items-center justify-center gap-3 mb-8">
          {fromPlayer && <AgentAvatar avatarUrl={fromPlayer.avatarUrl} persona={fromPlayer.persona} name={fromPlayer.name} size="12" />}
          <span className="text-xl font-semibold text-white/80">{fromName}</span>
        </div>
        <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl px-8 py-6 inline-block max-w-xl text-left">
          <p className="text-xl leading-relaxed text-white/80">
            {messagePhase === "revealing" ? (
              <Typewriter text={answer.answer} rate="spectacle" onComplete={onRevealComplete} />
            ) : answer.answer}
          </p>
        </div>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Spectacle message content — phase-specific rendering for replay viewer
// ---------------------------------------------------------------------------

/** Returns true if the text matches any structured vote/power/reveal parser. */
function isParseableStructuredMsg(text: string): boolean {
  return !!(
    parseVoteMsg(text) ||
    parseCouncilVoteMsg(text) ||
    parsePowerAction(text) ||
    parseJuryVoteMsg(text) ||
    parseEmpowered(text) ||
    parseWinnerAnnouncement(text) ||
    parseEliminationVote(text)
  );
}

function SpectacleMessageContent({
  message,
  scene,
  players,
  messagePhase,
  onRevealComplete,
  isSystemMessage,
  isElimination,
  currentPlayer,
  currentPlayerName,
  speedMultiplier = 1,
}: {
  message: TranscriptEntry;
  scene: ReplayScene;
  players: GamePlayer[];
  messagePhase: SpectacleMessagePhase;
  onRevealComplete: () => void;
  isSystemMessage: boolean;
  isElimination: boolean;
  currentPlayer: GamePlayer | null | undefined;
  currentPlayerName: string;
  speedMultiplier?: number;
}) {
  // For parseable structured messages, skip typewriter and jump to "done"
  const parseable = isParseableStructuredMsg(message.text);
  useEffect(() => {
    if (messagePhase === "revealing" && parseable) {
      onRevealComplete();
    }
  }, [messagePhase, parseable, onRevealComplete]);

  // Jury question/answer — intimate framing
  if (scene.phase === "JURY_QUESTIONS") {
    const isJuryMsg = parseJuryQuestion(message.text) || parseJuryAnswer(message.text);
    if (isJuryMsg) {
      return (
        <JuryQuestionFrame
          message={message}
          players={players}
          messagePhase={messagePhase}
          onRevealComplete={onRevealComplete}
        />
      );
    }
  }

  // Styled vote/power card — shown when parseable and done
  if (parseable) {
    return (
      <StyledVoteCard text={message.text} players={players} />
    );
  }

  // Default text rendering
  return (
    <div className="text-center animate-[fadeIn_0.3s_ease-out]">
      {!isSystemMessage && (
        <div className="flex items-center justify-center gap-3 mb-8">
          {currentPlayer && (
            <AgentAvatar avatarUrl={currentPlayer.avatarUrl} persona={currentPlayer.persona} name={currentPlayer.name} size="10" />
          )}
          <span className="text-lg font-semibold text-white/70">{currentPlayerName}</span>
          {message.scope === "whisper" && (
            <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">whisper</span>
          )}
        </div>
      )}
      {isElimination ? (
        <p className="text-2xl md:text-3xl font-bold text-red-400 tracking-wider">
          {messagePhase === "revealing" ? (
            <Typewriter text={message.text} rate="house" onComplete={onRevealComplete} speedMultiplier={speedMultiplier} />
          ) : message.text}
        </p>
      ) : isSystemMessage ? (
        <p className="text-base md:text-lg text-white/40 italic leading-relaxed">
          {messagePhase === "revealing" ? (
            <Typewriter text={message.text} rate="house" onComplete={onRevealComplete} speedMultiplier={speedMultiplier} />
          ) : message.text}
        </p>
      ) : (
        <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl px-8 py-6 inline-block max-w-xl text-left">
          <p className="text-lg md:text-xl leading-relaxed text-white/80">
            {messagePhase === "revealing" ? (
              <Typewriter text={message.text} rate="spectacle" onComplete={onRevealComplete} speedrun={false} speedMultiplier={speedMultiplier} />
            ) : message.text}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spectacle message spotlight — shared between live + replay immersive views
// ---------------------------------------------------------------------------

function SpectacleMessageSpotlight({
  message,
  phase,
  players,
  onRevealComplete,
  queueLength,
  speedrun = false,
}: {
  message: TranscriptEntry | null;
  phase: SpectacleMessagePhase;
  players: GamePlayer[];
  onRevealComplete: () => void;
  queueLength: number;
  speedrun?: boolean;
}) {
  if (!message) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[350px]">
        <p className="text-white/15 text-sm animate-pulse">Waiting for the next move…</p>
      </div>
    );
  }

  const isSystem = !message.fromPlayerId || message.scope === "system";
  const player = message.fromPlayerId
    ? players.find((p) => p.id === message.fromPlayerId)
      ?? players.find((p) => p.name === message.fromPlayerId)
    : null;
  const playerName =
    message.fromPlayerName ?? player?.name ?? message.fromPlayerId ?? "The House";
  const isElimination = message.scope === "system" && message.text.includes("has been eliminated");

  return (
    <div className="flex-1 flex items-center justify-center min-h-[350px] px-6 py-8">
      <div className="max-w-2xl w-full">
        {/* Typing indicator */}
        {phase === "typing" && !isSystem && (
          <div className="text-center animate-[fadeIn_0.3s_ease-out]">
            <div className="flex items-center justify-center gap-3 mb-8">
              {player && <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="10" />}
              <span className="text-lg font-semibold text-white/60">{playerName}</span>
              {message.scope === "whisper" && (
                <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">whisper</span>
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
        {(phase === "revealing" || phase === "done") && (
          <div className="text-center animate-[fadeIn_0.3s_ease-out]">
            {!isSystem && (
              <div className="flex items-center justify-center gap-3 mb-8">
                {player && <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="10" />}
                <span className="text-lg font-semibold text-white/70">{playerName}</span>
                {message.scope === "whisper" && (
                  <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">whisper</span>
                )}
              </div>
            )}

            {isElimination ? (
              <p className="text-2xl md:text-3xl font-bold text-red-400 tracking-wider">
                {phase === "revealing" ? (
                  <Typewriter text={message.text} rate="house" onComplete={onRevealComplete} speedrun={speedrun} />
                ) : message.text}
              </p>
            ) : isSystem ? (
              <p className="text-base md:text-lg text-white/40 italic leading-relaxed">
                {phase === "revealing" ? (
                  <Typewriter text={message.text} rate="house" onComplete={onRevealComplete} speedrun={speedrun} />
                ) : message.text}
              </p>
            ) : (
              <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl px-8 py-6 inline-block max-w-xl text-left">
                <p className="text-lg md:text-xl leading-relaxed text-white/80">
                  {phase === "revealing" ? (
                    <Typewriter text={message.text} rate="spectacle" onComplete={onRevealComplete} speedrun={speedrun} />
                  ) : message.text}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Queue indicator */}
        {queueLength > 0 && phase === "done" && (
          <p className="text-center text-xs text-white/10 mt-6 animate-pulse">
            {queueLength} more…
          </p>
        )}
      </div>
    </div>
  );
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
// Spectacle Replay Viewer — immersive single-message-at-a-time orchestrator
// ---------------------------------------------------------------------------

type SpectacleMessagePhase = "typing" | "revealing" | "done";

function DramaticReplayViewer({
  game,
  messages,
  players,
  live = false,
  connStatus,
}: {
  game: GameDetail;
  messages: TranscriptEntry[];
  players: GamePlayer[];
  live?: boolean;
  connStatus?: "connecting" | "live" | "disconnected" | "reconnecting" | "replay";
}) {
  const scenes = useMemo(() => buildReplayScenes(messages, players), [messages, players]);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [messagePhase, setMessagePhase] = useState<SpectacleMessagePhase>("typing");
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [showHouseOverlay, setShowHouseOverlay] = useState(false);
  const [activeEndgameScreen, setActiveEndgameScreen] = useState<EndgameScreenState | null>(null);
  const [activePhaseTransition, setActivePhaseTransition] = useState<TransitionState | null>(null);
  const seenEndgameStages = useRef<Set<string>>(new Set());
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveInitializedRef = useRef(false);

  const scene = scenes[sceneIndex];
  const totalScenes = scenes.length;
  const currentMessage = scene?.messages[messageIndex] ?? null;
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

  // Live mode: jump to latest position when scenes first appear
  useEffect(() => {
    if (!live || liveInitializedRef.current || totalScenes === 0) return;
    liveInitializedRef.current = true;
    const lastScene = scenes[totalScenes - 1]!;
    setSceneIndex(totalScenes - 1);
    setMessageIndex(lastScene.messages.length - 1);
    setMessagePhase("done");
  }, [live, totalScenes, scenes]);

  // Resolve current speaker
  const currentPlayer = currentMessage?.fromPlayerId
    ? players.find((p) => p.id === currentMessage.fromPlayerId)
      ?? players.find((p) => p.name === currentMessage.fromPlayerId)
    : null;
  const currentPlayerName =
    currentMessage?.fromPlayerName ?? currentPlayer?.name ?? currentMessage?.fromPlayerId ?? "The House";

  // All messages visible up to current point
  const allVisibleMessages = useMemo(() => {
    const msgs: TranscriptEntry[] = [];
    for (let i = 0; i <= sceneIndex && i < scenes.length; i++) {
      const s = scenes[i]!;
      if (i < sceneIndex) {
        msgs.push(...s.messages);
      } else {
        msgs.push(...s.messages.slice(0, messageIndex + 1));
      }
    }
    return msgs;
  }, [scenes, sceneIndex, messageIndex]);

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

  // Build players with correct alive/eliminated status for current replay position
  const replayPlayers = useMemo(() =>
    players.map((p) => ({
      ...p,
      status: eliminatedIds.has(p.id) ? "eliminated" as const : "alive" as const,
    })),
  [players, eliminatedIds]);

  // Detect scene transitions
  const prevScene = sceneIndex > 0 ? scenes[sceneIndex - 1] : null;
  const isNewRound = scene && prevScene && scene.round !== prevScene.round;
  const isRoomChange = scene && prevScene && scene.roomType !== prevScene.roomType;

  // Phase transition overlay on room type changes
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

  // House overlay on room changes
  useEffect(() => {
    if (scene?.houseIntro && isRoomChange) {
      setShowHouseOverlay(true);
      const timer = window.setTimeout(() => setShowHouseOverlay(false), 3500);
      return () => window.clearTimeout(timer);
    }
  }, [sceneIndex, scene?.houseIntro, isRoomChange]);

  // Auto-advance state machine
  useEffect(() => {
    if (!isPlaying || !scene || !currentMessage) return;

    if (messagePhase === "typing") {
      // System messages skip typing indicator
      if (isSystemMessage) {
        setMessagePhase("revealing");
        return;
      }
      const typingMul = DRAMATIC_PHASES.has(scene.phase) ? DRAMATIC_PHASE_MULTIPLIER : 1;
      const timer = setTimeout(() => setMessagePhase("revealing"), (TYPING_HOLD_MS * typingMul) / speed);
      return () => clearTimeout(timer);
    }

    if (messagePhase === "done") {
      const isLastInScene = messageIndex >= scene.messages.length - 1;
      const isLastScene = sceneIndex >= totalScenes - 1;

      // Hold time proportional to message length; dramatic phases get extra weight
      const dramaticMul = DRAMATIC_PHASES.has(scene.phase) ? DRAMATIC_PHASE_MULTIPLIER : 1;
      const holdMs = isLastInScene
        ? (INTER_SCENE_PAUSE_MS * dramaticMul) / speed
        : (Math.max(POST_REVEAL_BASE_MS, currentMessage.text.length * POST_REVEAL_PER_CHAR_MS) * dramaticMul) / speed;

      const timer = setTimeout(() => {
        if (!isLastInScene) {
          setMessageIndex((i) => i + 1);
          setMessagePhase("typing");
        } else if (!isLastScene) {
          setSceneIndex((i) => i + 1);
          setMessageIndex(0);
          setMessagePhase("typing");
        } else if (!live) {
          setIsPlaying(false);
        }
        // In live mode at the end: do nothing — wait for new messages
        // to arrive. When scenes rebuild, this effect re-runs and advances.
      }, holdMs);
      return () => clearTimeout(timer);
    }
    // "revealing" phase transitions via Typewriter onComplete
  }, [isPlaying, messagePhase, messageIndex, sceneIndex, scene, totalScenes, speed, currentMessage, isSystemMessage, live]);

  // Advance function — for click/tap and keyboard
  const advanceMessage = useCallback(() => {
    if (!scene) return;
    // If mid-animation, skip to fully revealed
    if (messagePhase === "typing" || messagePhase === "revealing") {
      setMessagePhase("done");
      return;
    }
    // Advance to next message or scene
    if (messageIndex < scene.messages.length - 1) {
      setMessageIndex((i) => i + 1);
      setMessagePhase("typing");
    } else if (sceneIndex < totalScenes - 1) {
      setSceneIndex((i) => i + 1);
      setMessageIndex(0);
      setMessagePhase("typing");
    }
  }, [scene, messagePhase, messageIndex, sceneIndex, totalScenes]);

  const goToNextScene = useCallback(() => {
    if (sceneIndex < totalScenes - 1) {
      setSceneIndex((i) => i + 1);
      setMessageIndex(0);
      setMessagePhase("typing");
    }
  }, [sceneIndex, totalScenes]);

  const goToEnd = useCallback(() => {
    if (totalScenes > 0) {
      const lastScene = scenes[totalScenes - 1]!;
      setSceneIndex(totalScenes - 1);
      setMessageIndex(lastScene.messages.length - 1);
      setMessagePhase("done");
      setIsPlaying(false);
    }
  }, [totalScenes, scenes]);

  // Click handler — advance when paused, pause when playing
  // Tap-to-skip: clicking always advances (skips current animation or goes to
  // next message). Only the play/pause button can pause. After advancing,
  // playback auto-continues if it was playing.
  const handleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-controls]")) return;
    advanceMessage();
  }, [advanceMessage]);

  // Auto-hide controls
  const handleMouseMove = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

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
        case "Enter":
          e.preventDefault();
          advanceMessage();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (messageIndex > 0) {
            setMessageIndex((i) => i - 1);
            setMessagePhase("done");
          } else if (sceneIndex > 0) {
            const prev = scenes[sceneIndex - 1]!;
            setSceneIndex((i) => i - 1);
            setMessageIndex(prev.messages.length - 1);
            setMessagePhase("done");
          }
          break;
        case "]":
          e.preventDefault();
          goToNextScene();
          break;
        case "[":
          e.preventDefault();
          if (scene) {
            for (let i = sceneIndex - 1; i >= 0; i--) {
              if (scenes[i]!.round !== scene.round) {
                const targetRound = scenes[i]!.round;
                let first = i;
                while (first > 0 && scenes[first - 1]!.round === targetRound) first--;
                setSceneIndex(first);
                setMessageIndex(0);
                setMessagePhase("typing");
                break;
              }
            }
          }
          break;
        case "1": setSpeed(0.5); break;
        case "2": setSpeed(1); break;
        case "3": setSpeed(2); break;
        case "4": setSpeed(4); break;
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [advanceMessage, goToNextScene, messageIndex, sceneIndex, scene, scenes]);

  if (!scene || totalScenes === 0) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-4">
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
  const isElimination = currentMessage?.scope === "system" && currentMessage.text.includes("has been eliminated");

  return (
    <div
      className="fixed inset-0 z-30 influence-shell flex flex-col cursor-pointer select-none"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
    >
      {/* Cinematic atmosphere layers */}
      <div className="influence-phase-atmosphere" />
      <div className="influence-phase-vignette" />
      {ENDGAME_PHASES.has(scene.phase) && <div className="influence-endgame-atmosphere" />}

      {/* Overlays */}
      {activePhaseTransition && (
        <PhaseTransitionOverlay
          transition={activePhaseTransition}
          onDismiss={() => setActivePhaseTransition(null)}
        />
      )}
      {activeEndgameScreen && (
        <EndgameEntryScreen
          endgame={activeEndgameScreen}
          onDismiss={() => setActiveEndgameScreen(null)}
        />
      )}
      {showHouseOverlay && scene.houseIntro && (
        <div className="fixed inset-0 z-40 bg-black/90 flex flex-col items-center justify-center animate-[fadeIn_0.3s_ease-out]">
          <p className="text-white/20 text-xs tracking-[0.4em] uppercase mb-4">◆ THE HOUSE ◆</p>
          <p className="text-white/60 italic text-lg max-w-lg text-center px-6 leading-relaxed">
            {scene.houseIntro}
          </p>
        </div>
      )}

      {/* Exit button — top-left, auto-hides with controls */}
      <button
        type="button"
        data-controls
        onClick={(e) => {
          e.stopPropagation();
          window.history.back();
        }}
        className={`fixed top-4 left-4 z-20 w-9 h-9 flex items-center justify-center rounded-full border border-white/10 bg-black/50 text-white/50 hover:text-white hover:border-white/25 transition-all duration-500 ${
          controlsVisible || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        title="Exit"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M1 1l12 12M13 1L1 13" />
        </svg>
      </button>

      {/* Top bar — phase context */}
      <div className={`flex-shrink-0 px-6 pt-5 pb-3 flex items-center justify-between z-10 transition-opacity duration-500 ${
        controlsVisible || !isPlaying ? "opacity-100" : "opacity-0"
      }`}>
        <div className="flex items-center gap-3 pl-10">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ROOM_TYPE_COLORS[scene.roomType]}`} />
          <span className={`text-xs font-semibold uppercase tracking-[0.25em] ${phaseColor(scene.phase)}`}>
            {PHASE_TRANSITION_LABELS[scene.phase] ?? scene.phase}
          </span>
          {roomLabel && (
            <span className="text-xs text-purple-300/50">{roomLabel}</span>
          )}
          {isNewRound && (
            <span className="text-xs text-white/25 uppercase tracking-wider">
              Round {scene.round}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ConnectionBadge status={connStatus ?? "replay"} />
        </div>
      </div>

      {/* Game state HUD — top-right corner, auto-hides with controls */}
      <div
        data-controls
        className={`fixed top-14 right-4 z-20 transition-opacity duration-500 ${
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

      {/* Scene progress bar */}
      <div className="px-6 z-10">
        <div className="flex h-0.5 rounded-full overflow-hidden bg-white/5 gap-px">
          {scenes.map((s, i) => (
            <div
              key={s.id}
              className={`flex-1 min-w-[2px] ${ROOM_TYPE_COLORS[s.roomType]} ${
                i <= sceneIndex ? "opacity-80" : "opacity-10"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Center — message spotlight */}
      <div className="flex-1 flex items-center justify-center px-8 py-8 overflow-y-auto">
        <div className="max-w-2xl w-full">
          {/* Typing indicator */}
          {messagePhase === "typing" && currentMessage && !isSystemMessage && (
            <div className="text-center animate-[fadeIn_0.3s_ease-out]">
              <div className="flex items-center justify-center gap-3 mb-8">
                {currentPlayer && (
                  <AgentAvatar avatarUrl={currentPlayer.avatarUrl} persona={currentPlayer.persona} name={currentPlayer.name} size="10" />
                )}
                <span className="text-lg font-semibold text-white/60">{currentPlayerName}</span>
                {currentMessage.scope === "whisper" && (
                  <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">whisper</span>
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
              onRevealComplete={() => setMessagePhase("done")}
              isSystemMessage={isSystemMessage}
              isElimination={isElimination}
              currentPlayer={currentPlayer}
              currentPlayerName={currentPlayerName}
              speedMultiplier={speed}
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

          {/* Paused indicator */}
          {!isPlaying && messagePhase === "done" && (
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
        data-controls
        className={`flex-shrink-0 px-6 py-4 transition-opacity duration-500 z-10 ${
          controlsVisible || !isPlaying ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="flex items-center justify-between max-w-3xl mx-auto">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setIsPlaying((p) => !p); }}
            className="text-sm text-white/50 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20"
          >
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); goToNextScene(); }}
              disabled={sceneIndex >= totalScenes - 1}
              className="text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              Next Scene ▶▶
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); goToEnd(); }}
              className="text-xs text-white/40 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20"
            >
              {live ? "Jump to Live ⏭" : "Go to End ⏭"}
            </button>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-xs text-white/20 mr-1">Speed:</span>
            {SPEED_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={(e) => { e.stopPropagation(); setSpeed(opt.value); }}
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
        </div>
        <p className="text-[10px] text-white/10 text-center mt-2">
          Space: play/pause · Click/→: advance · ←: back · []: rounds · 1234: speed
        </p>
      </div>
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
  // Spectacle mode — queue-based single-message display for live non-whisper, non-reveal phases
  const [spectacleQueue, setSpectacleQueue] = useState<TranscriptEntry[]>([]);
  const [spectacleCurrent, setSpectacleCurrent] = useState<TranscriptEntry | null>(null);
  const [spectaclePhase, setSpectaclePhase] = useState<SpectacleMessagePhase>("done");

  // Set data-phase on root for cinematic CSS cascade (live mode)
  useEffect(() => {
    if (game?.currentPhase) {
      setPhaseAttr(game.currentPhase);
      setEndgameAttr(game.currentPhase);
    }
    return () => {
      if (typeof document !== "undefined") {
        document.documentElement.removeAttribute("data-phase");
        document.documentElement.removeAttribute("data-endgame");
      }
    };
  }, [game?.currentPhase]);

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

  // Spectacle queue drain — take next message when current finishes
  useEffect(() => {
    if (isReplay || spectacleCurrent || spectacleQueue.length === 0) return;
    setSpectacleQueue((q) => {
      if (q.length === 0) return q;
      const [next, ...rest] = q;
      setSpectacleCurrent(next);
      setSpectaclePhase("typing");
      return rest;
    });
  }, [spectacleQueue, spectacleCurrent, isReplay]);

  // Spectacle animation state machine
  useEffect(() => {
    if (!spectacleCurrent || isReplay) return;
    const isSystem = !spectacleCurrent.fromPlayerId || spectacleCurrent.scope === "system";

    if (spectaclePhase === "typing") {
      if (isSystem || isSpeedrun) {
        setSpectaclePhase("revealing");
        return;
      }
      const timer = setTimeout(() => setSpectaclePhase("revealing"), TYPING_HOLD_MS);
      return () => clearTimeout(timer);
    }

    if (spectaclePhase === "done") {
      const holdMs = isSpeedrun
        ? 100
        : Math.max(POST_REVEAL_BASE_MS, spectacleCurrent.text.length * POST_REVEAL_PER_CHAR_MS);
      const timer = setTimeout(() => {
        setSpectacleCurrent(null);
      }, holdMs);
      return () => clearTimeout(timer);
    }
    // "revealing" transitions via Typewriter onComplete
  }, [spectacleCurrent, spectaclePhase, isReplay, isSpeedrun]);

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
        // Queue messages for spectacle display (skip phases with dedicated views)
        const phase = currentPhaseRef.current;
        if (ev.entry.scope !== "diary" && ev.entry.scope !== "whisper") {
          if (phase === "REVEAL" || phase === "COUNCIL") {
            setRevealQueue((q) => [...q, msg]);
          } else if (
            phase !== "WHISPER" &&
            phase !== "INTRODUCTION" &&
            phase !== "LOBBY" &&
            phase !== "JURY_QUESTIONS" &&
            phase !== "DIARY_ROOM"
          ) {
            setSpectacleQueue((q) => [...q, msg]);
          }
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
      <div className="influence-glass rounded-panel p-12 text-center text-white/20 text-sm">
        Loading game…
      </div>
    );
  }

  // Route to dramatic viewer for completed games (replay) and live in_progress games
  // (unless ?mode=classic). Waiting games skip this — they need the join UI.
  const useDramaticViewer = mode !== "classic" && (
    (isReplay && messages.length > 0) ||
    (!isReplay && game.status === "in_progress")
  );
  if (useDramaticViewer) {
    return (
      <DramaticReplayViewer
        game={game}
        messages={messages}
        players={game.players}
        live={!isReplay}
        connStatus={connStatus}
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

  // Group chat messages for INTRODUCTION/LOBBY phases (live mode)
  const currentGroupChatMessages = visibleMessages.filter(
    (m) =>
      (m.phase === "INTRODUCTION" || m.phase === "LOBBY") &&
      m.round === replayGame.currentRound &&
      m.scope !== "diary" &&
      m.scope !== "whisper",
  );

  // Jury question messages for JURY_QUESTIONS phase (live mode)
  const currentJuryMessages = visibleMessages.filter(
    (m) =>
      m.phase === "JURY_QUESTIONS" &&
      m.scope !== "whisper",
  );

  // Diary messages for DIARY_ROOM grid (live mode)
  const currentDiaryMessages = visibleMessages.filter(
    (m) =>
      m.scope === "diary" &&
      m.round === replayGame.currentRound,
  );

  // Phases that use dedicated views instead of spectacle spotlight
  const DEDICATED_VIEW_PHASES: ReadonlySet<PhaseKey> = new Set([
    "WHISPER", "REVEAL", "COUNCIL", "INTRODUCTION", "LOBBY", "JURY_QUESTIONS", "DIARY_ROOM",
  ]);

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

      {/* Mobile Chat tab — dedicated phase views */}
      {mobileTab === "chat" && (replayGame.currentPhase === "INTRODUCTION" || replayGame.currentPhase === "LOBBY") && !isReplay && (
        <GroupChatFeed
          messages={currentGroupChatMessages}
          players={game.players}
          phase={replayGame.currentPhase}
        />
      )}
      {mobileTab === "chat" && replayGame.currentPhase === "WHISPER" && !isReplay && (
        <WhisperPhaseView
          phaseEntries={currentWhisperEntries}
          players={game.players}
          phaseKey={`whisper-${replayGame.currentRound}`}
        />
      )}
      {mobileTab === "chat" && replayGame.currentPhase === "DIARY_ROOM" && !isReplay && (
        <DiaryRoomGridView
          messages={currentDiaryMessages}
          players={game.players}
        />
      )}
      {mobileTab === "chat" && replayGame.currentPhase === "JURY_QUESTIONS" && !isReplay && (
        <JuryDMView
          messages={currentJuryMessages}
          players={game.players}
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
      {/* Mobile Chat: replay feed (all phases) OR spectacle for remaining live phases */}
      {mobileTab === "chat" && isReplay && (
        <div
          ref={feedRef}
          className="influence-glass rounded-panel overflow-y-auto p-4 space-y-3 min-h-[380px] max-h-[60vh]"
        >
          {visibleMessages.filter((m) => m.scope !== "diary" && m.scope !== "whisper")
            .length === 0 ? (
            <p className="text-center text-white/20 text-sm mt-12">No messages in replay.</p>
          ) : (
            groupMessages(
              visibleMessages.filter((m) => m.scope !== "diary" && m.scope !== "whisper"),
            ).map((item) => {
              if (item.kind === "msg") {
                return <MessageBubble key={item.entry.id} msg={item.entry} players={game.players} />;
              }
              return null;
            })
          )}
        </div>
      )}
      {mobileTab === "chat" &&
        !isReplay &&
        !DEDICATED_VIEW_PHASES.has(replayGame.currentPhase) && (
          <SpectacleMessageSpotlight
            message={spectacleCurrent}
            phase={spectaclePhase}
            players={game.players}
            onRevealComplete={() => setSpectaclePhase("done")}
            queueLength={spectacleQueue.length}
            speedrun={isSpeedrun}
          />
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
        <div className="influence-glass rounded-panel p-12 text-center text-white/20 text-sm min-h-[380px] flex items-center justify-center">
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
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-void/95 backdrop-blur border-t border-white/10 grid grid-cols-4">
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

        {/* Main Stage: Group chat for INTRODUCTION/LOBBY (live mode) */}
        {activeTab === "stage" && (replayGame.currentPhase === "INTRODUCTION" || replayGame.currentPhase === "LOBBY") && !isReplay && (
          <GroupChatFeed
            messages={currentGroupChatMessages}
            players={game.players}
            phase={replayGame.currentPhase}
          />
        )}

        {/* Main Stage: Whisper phase — DM grid */}
        {activeTab === "stage" && replayGame.currentPhase === "WHISPER" && !isReplay && (
          <WhisperPhaseView
            phaseEntries={currentWhisperEntries}
            players={game.players}
            phaseKey={`whisper-${replayGame.currentRound}`}
          />
        )}

        {/* Main Stage: Diary room grid (live DIARY_ROOM phase) */}
        {activeTab === "stage" && replayGame.currentPhase === "DIARY_ROOM" && !isReplay && (
          <DiaryRoomGridView
            messages={currentDiaryMessages}
            players={game.players}
          />
        )}

        {/* Main Stage: Jury questions DM (live JURY_QUESTIONS phase) */}
        {activeTab === "stage" && replayGame.currentPhase === "JURY_QUESTIONS" && !isReplay && (
          <JuryDMView
            messages={currentJuryMessages}
            players={game.players}
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

        {/* Main Stage: replay feed (all phases) */}
        {activeTab === "stage" && isReplay && (
          <div
            ref={feedRef}
            className="influence-glass rounded-panel flex-1 overflow-y-auto p-4 space-y-3 min-h-[420px] max-h-[600px]"
          >
            {visibleMessages.filter((m) => m.scope !== "diary" && m.scope !== "whisper").length === 0 ? (
              <p className="text-center text-white/20 text-sm mt-16">No messages in replay.</p>
            ) : (
              groupMessages(visibleMessages.filter((m) => m.scope !== "diary" && m.scope !== "whisper")).map(
                (item) => {
                  if (item.kind === "msg") {
                    return <MessageBubble key={item.entry.id} msg={item.entry} players={game.players} />;
                  }
                  return null;
                },
              )
            )}
          </div>
        )}

        {/* Main Stage: spectacle spotlight for remaining live phases */}
        {activeTab === "stage" &&
          !isReplay &&
          !DEDICATED_VIEW_PHASES.has(replayGame.currentPhase) && (
            <SpectacleMessageSpotlight
              message={spectacleCurrent}
              phase={spectaclePhase}
              players={game.players}
              onRevealComplete={() => setSpectaclePhase("done")}
              queueLength={spectacleQueue.length}
              speedrun={isSpeedrun}
            />
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

      {/* Right: game state HUD + player roster */}
      <div className="space-y-3">
        <GameStateHUD
          players={game.players}
          currentRound={replayGame.currentRound}
          maxRounds={game.maxRounds}
          phase={replayGame.currentPhase}
          empoweredPlayerId={empoweredPlayerId}
        />
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
