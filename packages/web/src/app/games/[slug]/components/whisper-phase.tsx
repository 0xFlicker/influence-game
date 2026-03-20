"use client";

import { useState, useEffect } from "react";
import type { TranscriptEntry, GamePlayer } from "@/lib/api";
import { AgentAvatar } from "@/components/agent-avatar";
import { Typewriter } from "@/components/typewriter";
import type { WhisperRoomStage, WhisperStageData } from "./types";

export function canonicalPairKey(a: string, b: string): string {
  return [a, b].sort((left, right) => left.localeCompare(right)).join("::");
}

export function parseWhisperAllocation(text: string, players: GamePlayer[]): {
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

export function buildWhisperStageData(
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

/** Sealed room card — shows room assignment but hides message content during live gameplay. */
function WhisperRoomSealed({
  room,
  players,
}: {
  room: WhisperRoomStage;
  players: GamePlayer[];
}) {
  const playerA = players.find((p) => p.id === room.playerIds[0] || p.name === room.playerNames[0]);
  const playerB = players.find((p) => p.id === room.playerIds[1] || p.name === room.playerNames[1]);
  const messageCount = room.messages.length;

  return (
    <div className="rounded-2xl border border-purple-400/20 bg-black/30 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-purple-900/20">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-purple-300/45 flex-shrink-0">
            Room {room.roomId}
          </p>
          <p className="text-xs font-semibold text-white truncate">
            {room.playerNames.join(" × ")}
          </p>
        </div>
        <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-amber-200/80 flex-shrink-0">
          Sealed
        </span>
      </div>

      <div className="p-4 flex flex-col items-center justify-center gap-3 min-h-[120px]">
        <div className="flex items-center gap-3">
          {playerA && (
            <AgentAvatar avatarUrl={playerA.avatarUrl} persona={playerA.persona} name={playerA.name} size="8" />
          )}
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400/40 animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400/20 animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
          {playerB && (
            <AgentAvatar avatarUrl={playerB.avatarUrl} persona={playerB.persona} name={playerB.name} size="8" />
          )}
        </div>
        <p className="text-xs text-white/30 italic">
          {messageCount === 0
            ? "Private conversation in progress..."
            : `${messageCount} message${messageCount !== 1 ? "s" : ""} exchanged — revealed after voting`}
        </p>
      </div>
    </div>
  );
}

/** Single DM-style room chat box — messages aligned left/right based on speaker. Used in replay/reveal mode. */
export function WhisperRoomDM({
  room,
  players,
}: {
  room: WhisperRoomStage;
  players: GamePlayer[];
}) {
  // First player in the room is treated as "self" (messages on right)
  const selfId = room.playerIds[0];

  return (
    <div className="rounded-2xl border border-purple-400/20 bg-black/30 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-purple-900/20">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-purple-300/45 flex-shrink-0">
            Room {room.roomId}
          </p>
          <p className="text-xs font-semibold text-white truncate">
            {room.playerNames.join(" × ")}
          </p>
        </div>
        <span className="rounded-full border border-red-400/25 bg-red-400/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-red-200/80 flex-shrink-0">
          Revealed
        </span>
      </div>

      <div className="p-3 space-y-2">
        {room.messages.length === 0 ? (
          <p className="text-xs text-white/30 italic text-center py-6">No messages exchanged.</p>
        ) : (
          room.messages.map((msg, idx) => {
            const isSelf = msg.fromPlayerId === selfId;
            const player = players.find((c) => c.id === msg.fromPlayerId)
              ?? players.find((c) => c.name === msg.fromPlayerId);
            const name = player?.name ?? msg.fromPlayerId ?? "Unknown";
            const showOnRight = isSelf;

            return (
              <div
                key={msg.id}
                className={`flex gap-2 ${showOnRight ? "justify-end" : "justify-start"} animate-[fadeIn_0.25s_ease-out]`}
                style={{ animationDelay: `${idx * 200}ms` }}
              >
                {!showOnRight && (
                  <div className="flex-shrink-0 mt-1">
                    {player ? (
                      <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />
                    ) : (
                      <span className="w-6 h-6 rounded-full bg-purple-900/30 flex items-center justify-center text-[10px] text-purple-300/60">?</span>
                    )}
                  </div>
                )}
                <div className={`max-w-[80%] ${showOnRight ? "text-right" : "text-left"}`}>
                  <p className="text-[10px] mb-0.5 text-white/30">
                    {name}
                  </p>
                  <div className={`rounded-2xl px-3 py-2 ${
                    showOnRight
                      ? "bg-purple-800/30 border border-purple-600/20 rounded-tr-sm"
                      : "bg-white/[0.06] border border-white/[0.08] rounded-tl-sm"
                  }`}>
                    <p className="text-xs leading-relaxed text-white/70 text-left">{msg.text}</p>
                  </div>
                </div>
                {showOnRight && (
                  <div className="flex-shrink-0 mt-1">
                    {player ? (
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

export function WhisperPhaseView({
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
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
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
      ) : isReplay ? (
        <>
          {/* Replay: room selector + selected room(s), max 2 cols on lg+ */}
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            {stage.rooms.map((room, idx) => {
              const nextIdx = (mobileRoomIndex + 1) % stage.rooms.length;
              const isCompanion = stage.rooms.length > 1 && idx === nextIdx;
              return (
                <button
                  key={room.roomId}
                  type="button"
                  onClick={() => { if (!isCompanion) setMobileRoomIndex(idx); }}
                  className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] transition-colors flex items-center gap-1.5 ${
                    idx === mobileRoomIndex || isCompanion
                      ? "border-purple-300/50 bg-purple-300/15 text-white"
                      : "border-white/10 bg-white/5 text-white/50 hover:border-purple-300/30"
                  } ${isCompanion ? "hidden lg:flex opacity-40 cursor-not-allowed" : ""}`}
                >
                  <span>Room {room.roomId}</span>
                  <span className="text-[9px] text-purple-300/40 truncate max-w-[8rem]">
                    {room.playerNames.join(" × ")}
                  </span>
                  {room.messages.length > 0 && (
                    <span className="text-[8px] text-purple-300/40">{room.messages.length}</span>
                  )}
                </button>
              );
            })}
            {stage.commons.length > 0 && (
              <span className="text-[10px] text-white/25 ml-1">
                Commons: {stage.commons.map((p) => p.name).join(", ")}
              </span>
            )}
          </div>
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
            {stage.rooms[mobileRoomIndex] && (
              <WhisperRoomDM room={stage.rooms[mobileRoomIndex]} players={players} />
            )}
            {stage.rooms.length > 1 && stage.rooms[(mobileRoomIndex + 1) % stage.rooms.length] && (
              <div className="hidden lg:block">
                <WhisperRoomDM room={stage.rooms[(mobileRoomIndex + 1) % stage.rooms.length]!} players={players} />
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Live mode: whisper content is sealed — max 2 cols */}
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
            {stage.rooms.map((room) => (
              <WhisperRoomSealed key={room.roomId} room={room} players={players} />
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
        </>
      )}
    </div>
  );
}
