"use client";

import { useState } from "react";
import type { TranscriptEntry, GamePlayer } from "@/lib/api";
import { AgentAvatar } from "@/components/agent-avatar";
import { formatTime } from "./constants";
import type { GroupedMessage, DiaryRoomData } from "./types";

/** Extract the player name from a diary `fromPlayerId` field.
 *  House question format: "House -> Alice" or "House -> Alice (juror)"
 *  Player answer format:  "Alice" or "Alice (juror)"
 */
export function diaryPlayerName(fromPlayerId: string): string {
  return fromPlayerId.replace(/^House -> /, "").replace(/ \(juror\)$/, "");
}

/**
 * Groups diary entries into Q&A pairs by matching "House -> X" questions
 * with "X" answers. Handles parallel interleaving from Promise.all.
 */
export function groupMessages(messages: TranscriptEntry[]): GroupedMessage[] {
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

export function DiaryQACard({
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

/**
 * Card for a single voluntary diary reflection (no paired House question).
 */
export function DiaryEntryCard({
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
export function DiaryRoomPanel({
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
      <div className="border border-purple-900/30 bg-purple-950/10 p-12 text-center flex-1 flex flex-col items-center justify-center">
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
      <div className="border border-purple-900/30 bg-purple-950/10 p-12 text-center text-purple-300/30 text-sm flex-1 flex items-center justify-center">
        No diary entries yet.
      </div>
    );
  }

  const grouped = groupMessages(diaryMessages);

  return (
    <div className="border border-purple-900/30 bg-purple-950/10 flex-1 overflow-y-auto p-4 space-y-3">
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

export function buildDiaryRooms(
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
  return (
    <div className="rounded-2xl border border-purple-400/20 bg-black/30 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-purple-900/20">
        {room.player && <AgentAvatar avatarUrl={room.player.avatarUrl} persona={room.player.persona} name={room.player.name} size="6" />}
        <p className="text-xs font-semibold text-white truncate">{room.playerName}</p>
        <span className="text-[9px] uppercase tracking-[0.2em] text-purple-300/45 ml-auto">Diary</span>
      </div>

      <div className="p-3 space-y-2">
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

export function DiaryRoomGridView({
  messages,
  players,
}: {
  messages: TranscriptEntry[];
  players: GamePlayer[];
}) {
  const rooms = buildDiaryRooms(messages, players);
  const [mobileRoomIndex, setMobileRoomIndex] = useState(0);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
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
          {/* Room selector */}
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            {rooms.map((room, idx) => {
              const nextIdx = (mobileRoomIndex + 1) % rooms.length;
              const isCompanion = rooms.length > 1 && idx === nextIdx;
              return (
                <button
                  key={room.playerName}
                  type="button"
                  onClick={() => { if (!isCompanion) setMobileRoomIndex(idx); }}
                  className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] transition-colors flex items-center gap-1 ${
                    idx === mobileRoomIndex || isCompanion
                      ? "border-purple-300/50 bg-purple-300/15 text-white"
                      : "border-white/10 bg-white/5 text-white/50 hover:border-purple-300/30"
                  } ${isCompanion ? "hidden lg:flex opacity-40 cursor-not-allowed" : ""}`}
                >
                  {room.player && <AgentAvatar avatarUrl={room.player.avatarUrl} persona={room.player.persona} name={room.player.name} size="6" />}
                  <span className="truncate max-w-[6rem]">{room.playerName}</span>
                  {room.entries.length > 0 && (
                    <span className="text-[8px] text-purple-300/40">{room.entries.length}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Room display — 1 col (default), 2 col on lg+ */}
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
            {rooms[mobileRoomIndex] && (
              <DiaryRoomChat room={rooms[mobileRoomIndex]} />
            )}
            {rooms.length > 1 && rooms[(mobileRoomIndex + 1) % rooms.length] && (
              <div className="hidden lg:block">
                <DiaryRoomChat room={rooms[(mobileRoomIndex + 1) % rooms.length]!} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
