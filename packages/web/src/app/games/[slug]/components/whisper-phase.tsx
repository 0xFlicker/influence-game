"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
    // Also key by player names — message `fromPlayerId` / `toPlayerIds` contain
    // names (not UUIDs) so the UUID pair key above won't match during fallback.
    if (room.playerNames.length === 2) {
      roomsByPair.set(canonicalPairKey(room.playerNames[0]!, room.playerNames[1]!), stageRoom);
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

/** Single DM-style room chat box with independent scrolling. Used in replay/reveal mode. */
export function WhisperRoomDM({
  room,
  players,
  focused,
  onFocus,
  onClose,
}: {
  room: WhisperRoomStage;
  players: GamePlayer[];
  focused?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
}) {
  // Room owner: first player in allocation (the one who chose this room).
  // Resolve via players array to get canonical ID for robust matching.
  const ownerName = room.playerNames[0];
  const ownerPlayer = ownerName
    ? players.find((p) => p.id === room.playerIds[0] || p.name === ownerName)
    : undefined;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [room.messages.length]);

  return (
    <div
      className={`rounded-2xl border bg-black/30 flex flex-col overflow-hidden transition-all duration-300 ${
        focused
          ? "border-purple-400/40 ring-1 ring-purple-400/20 col-span-full"
          : "border-purple-400/20 cursor-pointer hover:border-purple-400/35"
      }`}
      onClick={(e) => {
        if (!focused && onFocus) {
          e.stopPropagation();
          onFocus();
        }
      }}
      data-controls
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-purple-900/20 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-purple-300/45 flex-shrink-0">
            Room {room.roomId}
          </p>
          <p className="text-xs font-semibold text-white truncate">
            {room.playerNames.join(" × ")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {room.messages.length > 0 && (
            <span className="text-[9px] text-purple-300/40">
              {room.messages.length} msg{room.messages.length !== 1 ? "s" : ""}
            </span>
          )}
          <span className="rounded-full border border-red-400/25 bg-red-400/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-red-200/80">
            Revealed
          </span>
          {focused && onClose && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="w-5 h-5 flex items-center justify-center rounded-full border border-white/10 text-white/40 hover:text-white hover:border-white/25 transition-colors"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M1 1l6 6M7 1L1 7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className={`p-3 space-y-2 overflow-y-auto ${focused ? "max-h-[60vh]" : "max-h-[40vh]"}`}
      >
        {room.messages.length === 0 ? (
          <p className="text-xs text-white/30 italic text-center py-6">No messages exchanged.</p>
        ) : (
          room.messages.map((msg, idx) => {
            // Resolve sender, then compare to owner by canonical player object
            const player = players.find((c) => c.id === msg.fromPlayerId)
              ?? players.find((c) => c.name === msg.fromPlayerId);
            const isOwner = ownerPlayer
              ? (player?.id === ownerPlayer.id)
              : (msg.fromPlayerId === ownerName);
            const name = player?.name ?? msg.fromPlayerId ?? "Unknown";

            return (
              <div
                key={msg.id}
                className={`flex gap-2 ${isOwner ? "justify-end" : "justify-start"} animate-[fadeIn_0.25s_ease-out]`}
                style={{ animationDelay: `${Math.min(idx, 10) * 100}ms` }}
              >
                {!isOwner && (
                  <div className="flex-shrink-0 mt-1">
                    {player ? (
                      <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="6" />
                    ) : (
                      <span className="w-6 h-6 rounded-full bg-purple-900/30 flex items-center justify-center text-[10px] text-purple-300/60">?</span>
                    )}
                  </div>
                )}
                <div className={`max-w-[80%] ${isOwner ? "text-right" : "text-left"}`}>
                  <p className="text-[10px] mb-0.5 text-white/30">
                    {name}
                  </p>
                  <div className={`rounded-2xl px-3 py-2 ${
                    isOwner
                      ? "bg-blue-600/30 border border-blue-500/25 rounded-tr-sm"
                      : "bg-white/[0.08] border border-white/[0.10] rounded-tl-sm"
                  }`}>
                    <p className="text-xs leading-relaxed text-white/70 text-left">{msg.text}</p>
                  </div>
                </div>
                {isOwner && (
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

/**
 * Rich allocation overview — used by the dramatic viewer for overview scenes
 * and as the opening screen in the sequential whisper view.
 * Explains whisper room mechanics and shows who ended up where.
 */
export function WhisperAllocationOverview({
  stage,
  players,
  animated = true,
}: {
  stage: WhisperStageData;
  players: GamePlayer[];
  animated?: boolean;
}) {
  const fadeIn = animated ? "animate-[fadeIn_0.35s_ease-out]" : "";

  return (
    <div data-controls className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="text-center mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-purple-300/70 mb-2">
          Whisper Room Assignments
        </p>
        <p className="text-xs text-white/40 max-w-md mx-auto leading-relaxed">
          Each player secretly chose another player to whisper with.
          Mutual picks share a private room. Unmatched players go to the Commons.
        </p>
      </div>

      {stage.rooms.length === 0 ? (
        <div className="rounded-2xl border border-purple-900/20 bg-black/20 p-8 text-center text-white/45">
          Waiting for the House to finish assigning rooms.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 max-w-2xl mx-auto">
            {stage.rooms.map((room, index) => {
              const playerA = players.find((p) => p.id === room.playerIds[0] || p.name === room.playerNames[0]);
              const playerB = players.find((p) => p.id === room.playerIds[1] || p.name === room.playerNames[1]);
              return (
                <div
                  key={room.roomId}
                  className={`rounded-2xl border border-purple-500/25 bg-black/30 px-5 py-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] ${fadeIn}`}
                  style={animated ? { animationDelay: `${index * 150}ms` } : undefined}
                >
                  <p className="text-[10px] uppercase tracking-[0.28em] text-purple-300/50 mb-4">
                    Room {room.roomId}
                  </p>
                  <div className="flex items-center justify-center gap-4">
                    <div className="flex flex-col items-center gap-1.5">
                      {playerA ? (
                        <AgentAvatar avatarUrl={playerA.avatarUrl} persona={playerA.persona} name={playerA.name} size="10" />
                      ) : (
                        <span className="w-10 h-10 rounded-full bg-purple-900/30 flex items-center justify-center text-sm text-purple-300/60">?</span>
                      )}
                      <span className="text-xs font-medium text-white/80 text-center max-w-[5rem] truncate">{room.playerNames[0]}</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-purple-400/60 text-lg font-light">&times;</span>
                    </div>
                    <div className="flex flex-col items-center gap-1.5">
                      {playerB ? (
                        <AgentAvatar avatarUrl={playerB.avatarUrl} persona={playerB.persona} name={playerB.name} size="10" />
                      ) : (
                        <span className="w-10 h-10 rounded-full bg-purple-900/30 flex items-center justify-center text-sm text-purple-300/60">?</span>
                      )}
                      <span className="text-xs font-medium text-white/80 text-center max-w-[5rem] truncate">{room.playerNames[1]}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {stage.commons.length > 0 && (
            <div
              className={`rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-5 text-center max-w-2xl mx-auto ${fadeIn}`}
              style={animated ? { animationDelay: `${stage.rooms.length * 150 + 100}ms` } : undefined}
            >
              <p className="text-[10px] uppercase tracking-[0.28em] text-white/35 mb-3">Commons</p>
              <div className="flex items-center justify-center gap-4 flex-wrap">
                {stage.commons.map((player) => (
                  <div key={player.id} className="flex flex-col items-center gap-1.5">
                    <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="8" />
                    <span className="text-xs text-white/60">{player.name}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-white/25 mt-3 italic">No mutual pick — waiting in the Commons this round.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Sequential whisper view for the classic game viewer — overview then one room at a time. */
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
  // activeIndex: -1 = overview, 0..N = room index
  const [activeIndex, setActiveIndex] = useState(-1);

  // Reset to overview on phase change
  useEffect(() => {
    setActiveIndex(-1);
  }, [phaseKey]);

  // Auto-advance from overview to first room after 6 seconds
  useEffect(() => {
    if (activeIndex !== -1 || stage.rooms.length === 0) return;
    const timer = window.setTimeout(() => setActiveIndex(0), 6000);
    return () => window.clearTimeout(timer);
  }, [activeIndex, stage.rooms.length]);

  // Auto-advance between rooms every 8 seconds (if room has messages and we're caught up)
  useEffect(() => {
    if (activeIndex < 0 || activeIndex >= stage.rooms.length) return;
    const room = stage.rooms[activeIndex];
    if (!room || room.messages.length === 0) return;
    const timer = window.setTimeout(() => {
      if (activeIndex < stage.rooms.length - 1) {
        setActiveIndex((i) => i + 1);
      }
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [activeIndex, stage.rooms]);

  const activeRoom = activeIndex >= 0 ? stage.rooms[activeIndex] : null;

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

      {/* Room navigation tabs */}
      {stage.rooms.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5 mb-4">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setActiveIndex(-1); }}
            className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] transition-colors ${
              activeIndex === -1
                ? "border-purple-300/50 bg-purple-300/15 text-white"
                : "border-white/10 bg-white/5 text-white/50 hover:border-purple-300/30"
            }`}
          >
            Overview
          </button>
          {stage.rooms.map((room, idx) => (
            <button
              key={room.roomId}
              type="button"
              onClick={(e) => { e.stopPropagation(); setActiveIndex(idx); }}
              className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.15em] transition-colors flex items-center gap-1 ${
                idx === activeIndex
                  ? "border-purple-300/50 bg-purple-300/15 text-white"
                  : "border-white/10 bg-white/5 text-white/50 hover:border-purple-300/30"
              }`}
            >
              Room {room.roomId}
              {room.messages.length > 0 && (
                <span className="text-[8px] text-purple-300/40">{room.messages.length}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Content: overview or single room */}
      {activeIndex === -1 ? (
        <WhisperAllocationOverview stage={stage} players={players} />
      ) : activeRoom ? (
        isReplay ? (
          <div className="max-w-2xl mx-auto animate-[fadeIn_0.3s_ease-out]">
            <WhisperRoomDM room={activeRoom} players={players} />
          </div>
        ) : (
          <div className="max-w-2xl mx-auto animate-[fadeIn_0.3s_ease-out]">
            <WhisperRoomSealed room={activeRoom} players={players} />
          </div>
        )
      ) : (
        <div className="rounded-2xl border border-purple-900/20 bg-black/20 p-8 text-center text-white/45">
          Waiting for the House to finish assigning rooms.
        </div>
      )}

      {/* Commons note below active room */}
      {activeIndex >= 0 && stage.commons.length > 0 && (
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-center max-w-2xl mx-auto">
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/30 mb-1">Commons</p>
          <p className="text-sm text-white/60">
            {stage.commons.map((p) => p.name).join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}
