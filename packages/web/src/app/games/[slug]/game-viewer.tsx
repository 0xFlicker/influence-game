"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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

  const player = players.find((p) => p.id === msg.fromPlayerId);
  const name = msg.fromPlayerName ?? player?.name ?? "Unknown";
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
  onDismissRef.current = onDismiss;

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

/**
 * Replaces the main stage during WHISPER phase.
 * Shows a quiet-state header + whisper activity indicators (sender + recipients).
 * Content is hidden for non-admin viewers; sign-in CTA shown for anonymous.
 *
 * The `phaseKey` prop causes the House intro typewriter to reset each new
 * WHISPER phase (keyed by round number).
 */
function WhisperPhaseView({
  whisperMessages,
  players,
  isAuthenticated,
  phaseKey,
}: {
  whisperMessages: TranscriptEntry[];
  players: GamePlayer[];
  isAuthenticated: boolean;
  phaseKey: string;
}) {
  const [introComplete, setIntroComplete] = useState(false);
  // Reset intro when entering a new whisper phase
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setIntroComplete(false); }, [phaseKey]);

  const houseIntro = "The operatives go dark. Whispers fill the shadows.";

  return (
    <div className="border border-purple-900/20 bg-purple-950/10 rounded-xl flex-1 overflow-y-auto p-6 min-h-[420px] max-h-[600px]">
      {/* Header */}
      <div className="text-center mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-purple-400/60 mb-1">
          ◆ WHISPER PHASE ◆
        </p>
        <p className="text-xs text-purple-400/30 uppercase tracking-wider">
          Private channels are active
        </p>
      </div>

      {/* House intro */}
      <div className="text-center mb-6">
        <p className="text-sm text-white/40 italic">
          <Typewriter
            key={phaseKey}
            text={houseIntro}
            rate="house"
            onComplete={() => setIntroComplete(true)}
          />
        </p>
      </div>

      {/* Whisper activity indicators */}
      {(introComplete || whisperMessages.length > 0) && whisperMessages.length > 0 && (
        <div className="space-y-2 mt-4">
          {whisperMessages.map((msg) => {
            const sender = players.find((p) => p.id === msg.fromPlayerId);
            const senderName = sender?.name ?? msg.fromPlayerId ?? "Unknown";
            const recipients = (msg.toPlayerIds ?? [])
              .map((id) => players.find((p) => p.id === id)?.name ?? id)
              .filter(Boolean);

            return (
              <div key={msg.id} className="flex items-center gap-2 text-xs text-purple-300/50">
                <span className="text-purple-500/40 flex-shrink-0">•</span>
                <span className="flex-1">
                  <span className="text-white/55 font-medium">{senderName}</span>
                  {" "}is whispering to{" "}
                  <span className="text-white/55 font-medium">
                    {recipients.length > 0 ? recipients.join(" and ") : "someone"}
                  </span>
                  …
                </span>
                <span className="text-white/20 flex-shrink-0">{formatTime(msg.timestamp)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Anonymous sign-in CTA */}
      {!isAuthenticated && (
        <div className="mt-8 text-center border-t border-purple-900/20 pt-5">
          <p className="text-xs text-white/20 italic">
            Sign in to view your own whispers in the sidebar
          </p>
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

  const player = players.find((p) => p.id === msg.fromPlayerId);
  const name = msg.fromPlayerName ?? player?.name ?? "Unknown";
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

  const player = players.find((p) => p.id === entry.fromPlayerId);
  const playerName = entry.fromPlayerName ?? player?.name ?? "Unknown";
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
}: {
  messages: TranscriptEntry[];
  players: GamePlayer[];
  isAuthenticated: boolean;
}) {
  if (!isAuthenticated) {
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
  onEventRef.current = onEvent;

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
    text: entry.text,
    timestamp: entry.timestamp,
  };
}

export function GameViewer({ gameId, initialGame, initialMessages }: GameViewerProps) {
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
  const [empoweredPlayerId, setEmpoweredPlayerId] = useState<string | null>(null);
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

  // Auto-scroll for live view
  useEffect(() => {
    if (!isReplay && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, isReplay]);

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
          const flavors = PHASE_FLAVORS[ev.phase] ?? [];
          const flavorText =
            flavors.length > 0
              ? flavors[Math.floor(Math.random() * flavors.length)]
              : "";
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
        if (ev.entry.scope === "diary" && mobileTabRef.current !== "diary") {
          // already handled via newDiaryCount shared with desktop
        } else if (
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
          whisperMessages={visibleMessages.filter((m) => m.scope === "whisper")}
          players={game.players}
          isAuthenticated={isAuthenticated}
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
              ).map((item, idx) => {
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
          messages={visibleMessages}
          players={game.players}
          isAuthenticated={isAuthenticated}
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
            messages={visibleMessages}
            players={game.players}
            isAuthenticated={isAuthenticated}
          />
        )}

        {/* Main Stage: Whisper phase quiet-state */}
        {activeTab === "stage" && replayGame.currentPhase === "WHISPER" && !isReplay && (
          <WhisperPhaseView
            whisperMessages={visibleMessages.filter((m) => m.scope === "whisper")}
            players={game.players}
            isAuthenticated={isAuthenticated}
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
                (item, idx) => {
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
