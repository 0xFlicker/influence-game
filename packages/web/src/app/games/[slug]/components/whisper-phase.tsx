"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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

  for (const match of text.matchAll(/Room\s+(\d+):\s*([^|]+?)(?=\s*\||$)/g)) {
    const roomId = Number(match[1]);
    const occupantsText = match[2]?.trim();
    if (!occupantsText || Number.isNaN(roomId)) continue;

    const playerNames = occupantsText.toLowerCase() === "empty"
      ? []
      : occupantsText
          .split(/\s*(?:,|&)\s*/)
          .map((name) => name.trim())
          .filter(Boolean);

    rooms.push({
      roomId,
      playerIds: playerNames
        .map((name) => playerByName.get(name.toLowerCase())?.id)
        .filter((value): value is string => Boolean(value)),
      playerNames,
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
  const allocationEntries = ordered.filter((entry) => entry.scope === "system" && /Room\s+\d+:/.test(entry.text));
  const metadataEntries = ordered.filter((entry) => entry.roomMetadata);
  const playerById = new Map(players.map((player) => [player.id, player]));
  const playerByName = new Map(players.map((player) => [player.name, player]));

  const roomsById = new Map<number, WhisperRoomStage>();
  const roomsByPair = new Map<string, WhisperRoomStage>();
  const commonsByName = new Map<string, GamePlayer>();

  const addRoom = (room: {
    roomId: number;
    beat?: number;
    localRoomNumber?: number;
    playerIds: string[];
    playerNames?: string[];
  }) => {
    const playerNames = room.playerNames ?? room.playerIds.map((id) => playerById.get(id)?.name ?? id);
    const stageRoom: WhisperRoomStage = {
      roomId: room.roomId,
      beat: room.beat,
      localRoomNumber: room.localRoomNumber,
      playerIds: room.playerIds,
      playerNames,
      messages: [],
    };
    roomsById.set(room.roomId, stageRoom);
    if (room.playerIds.length === 2) {
      roomsByPair.set(canonicalPairKey(room.playerIds[0]!, room.playerIds[1]!), stageRoom);
    }
    // Also key by player names — message `fromPlayerId` / `toPlayerIds` contain
    // names (not UUIDs) so the UUID pair key above won't match during fallback.
    if (playerNames.length === 2) {
      roomsByPair.set(canonicalPairKey(playerNames[0]!, playerNames[1]!), stageRoom);
    }
  };

  if (metadataEntries.length > 0) {
    for (const entry of metadataEntries) {
      const rooms = [...(entry.roomMetadata?.rooms ?? [])].sort((left, right) => left.roomId - right.roomId);
      for (const [index, room] of rooms.entries()) {
        addRoom({ ...room, localRoomNumber: index + 1 });
      }
      for (const name of entry.roomMetadata?.excluded ?? []) {
        const player = playerByName.get(name);
        if (player) commonsByName.set(player.name, player);
      }
    }
  } else {
    for (const entry of allocationEntries) {
      const parsed = parseWhisperAllocation(entry.text, players);
      for (const room of parsed.rooms) {
        addRoom({ ...room, localRoomNumber: room.roomId });
      }
      for (const player of parsed.commons) {
        commonsByName.set(player.name, player);
      }
    }
  }

  for (const entry of ordered) {
    if (entry.scope !== "whisper" || !entry.fromPlayerId) continue;
    const recipientIds = entry.toPlayerIds ?? [];
    let room = entry.roomId != null ? roomsById.get(entry.roomId) : undefined;

    if (!room && recipientIds.length === 1) {
      room = roomsByPair.get(canonicalPairKey(entry.fromPlayerId, recipientIds[0]!));
    }

    if (!room && recipientIds.length > 0) {
      const participantIds = [entry.fromPlayerId, ...recipientIds];
      room = Array.from(roomsById.values()).find((candidate) =>
        participantIds.every((id) => candidate.playerIds.includes(id) || candidate.playerNames.includes(id)),
      );
    }

    if (!room) {
      const inferredRoomId = entry.roomId ?? roomsById.size + 1;
      const inferredNames = [
        players.find((player) => player.id === entry.fromPlayerId)?.name ?? entry.fromPlayerId,
        ...recipientIds.map((id) => players.find((player) => player.id === id)?.name ?? id),
      ];
      room = {
        roomId: inferredRoomId,
        playerIds: [entry.fromPlayerId, ...recipientIds],
        playerNames: inferredNames,
        messages: [],
      };
      roomsById.set(room.roomId, room);
      if (recipientIds.length === 1) {
        roomsByPair.set(canonicalPairKey(entry.fromPlayerId, recipientIds[0]!), room);
      }
    }

    room.messages.push(entry);
  }

  const rooms = Array.from(roomsById.values()).sort((left, right) => left.roomId - right.roomId);
  return {
    allocationText: allocationEntries.map((entry) => entry.text).join("\n") || null,
    rooms,
    commons: Array.from(commonsByName.values()),
    hasRoomMetadata: metadataEntries.length > 0,
  };
}

function roomDisplayLabel(room: WhisperRoomStage): string {
  return `R${room.localRoomNumber ?? room.roomId}`;
}

function roomStateLabel(room: WhisperRoomStage): "BACKCHANNEL" | "SINGLE" | "EMPTY" {
  if (room.playerNames.length === 0) return "EMPTY";
  if (room.playerNames.length === 1) return "SINGLE";
  return "BACKCHANNEL";
}

function resolveRoomPlayers(room: WhisperRoomStage, players: GamePlayer[]): GamePlayer[] {
  return room.playerNames
    .map((name, index) =>
      players.find((player) => player.id === room.playerIds[index] || player.name === name),
    )
    .filter((player): player is GamePlayer => Boolean(player));
}

function AgentInitial({
  player,
  name,
  size = "8",
}: {
  player?: GamePlayer;
  name: string;
  size?: "6" | "8" | "10";
}) {
  if (player) {
    return <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size={size} />;
  }

  const sizeClass = size === "10" ? "h-10 w-10" : size === "6" ? "h-6 w-6" : "h-8 w-8";
  return (
    <span className={`${sizeClass} rounded-full border border-white/15 bg-white/5 flex items-center justify-center text-[10px] font-semibold text-white/50`}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function RoomAvatarRow({
  room,
  players,
  size = "8",
}: {
  room: WhisperRoomStage;
  players: GamePlayer[];
  size?: "6" | "8" | "10";
}) {
  const resolved = resolveRoomPlayers(room, players);
  if (room.playerNames.length === 0) {
    return <span className="text-[11px] text-white/25">0 occupants</span>;
  }

  return (
    <div className="flex items-center -space-x-1.5">
      {room.playerNames.slice(0, 5).map((name, index) => (
        <span key={`${room.roomId}-${name}-${index}`} className="rounded-full ring-2 ring-black/70">
          <AgentInitial player={resolved[index]} name={name} size={size} />
        </span>
      ))}
      {room.playerNames.length > 5 && (
        <span className="ml-2 text-[10px] text-white/35">+{room.playerNames.length - 5}</span>
      )}
    </div>
  );
}

function buildMovementRows(rooms: WhisperRoomStage[]): Array<{
  playerKey: string;
  playerName: string;
  from: string | null;
  to: string;
  moved: boolean;
}> {
  const beats = Array.from(new Set(rooms.map((room) => room.beat).filter((beat): beat is number => beat != null))).sort((a, b) => a - b);
  if (beats.length === 0) return [];

  const currentBeat = beats[beats.length - 1]!;
  const previousBeat = beats.length > 1 ? beats[beats.length - 2]! : null;
  const currentRooms = rooms.filter((room) => room.beat === currentBeat);
  const previousRooms = previousBeat == null ? [] : rooms.filter((room) => room.beat === previousBeat);
  const previousByPlayer = new Map<string, string>();
  const rows: Array<{ playerKey: string; playerName: string; from: string | null; to: string; moved: boolean }> = [];

  for (const room of previousRooms) {
    for (const [index, playerId] of room.playerIds.entries()) {
      const playerName = room.playerNames[index] ?? playerId;
      previousByPlayer.set(playerId, roomDisplayLabel(room));
      previousByPlayer.set(playerName, roomDisplayLabel(room));
    }
  }

  for (const room of currentRooms) {
    for (const [index, playerId] of room.playerIds.entries()) {
      const playerName = room.playerNames[index] ?? playerId;
      const from = previousByPlayer.get(playerId) ?? previousByPlayer.get(playerName) ?? null;
      const to = roomDisplayLabel(room);
      rows.push({
        playerKey: playerId,
        playerName,
        from,
        to,
        moved: from != null && from !== to,
      });
    }
  }

  return rows.sort((left, right) => left.playerName.localeCompare(right.playerName));
}

function HouseMap({
  rooms,
  players,
  selectedRoomId,
  onSelectRoom,
}: {
  rooms: WhisperRoomStage[];
  players: GamePlayer[];
  selectedRoomId: number | null;
  onSelectRoom: (roomId: number) => void;
}) {
  return (
    <div className="rounded-2xl border border-purple-500/25 bg-black/35 p-4 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/80">HOUSE MAP</p>
          <p className="mt-1 text-xs text-white/35">Rooms are neutral. Occupancy is the signal.</p>
        </div>
        <span className="rounded-full border border-purple-400/25 bg-purple-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-purple-200/80">
          {rooms.length} rooms
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {rooms.map((room) => {
          const selected = room.roomId === selectedRoomId;
          const state = roomStateLabel(room);
          const hot = !selected && room.messages.length > 0;
          return (
            <button
              key={room.roomId}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSelectRoom(room.roomId);
              }}
              className={`min-h-32 rounded-xl border p-3 text-left transition-colors ${
                selected
                  ? "border-purple-300/70 bg-purple-500/15"
                  : hot
                    ? "border-blue-400/50 bg-blue-500/10 hover:border-blue-300/70"
                    : "border-white/10 bg-white/[0.035] hover:border-purple-300/35"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/85">
                    {roomDisplayLabel(room)}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/35">{state}</p>
                </div>
                <span className={`h-2 w-2 rounded-full ${hot ? "bg-blue-300" : selected ? "bg-purple-300" : "bg-white/20"}`} />
              </div>
              <div className="mt-4">
                <RoomAvatarRow room={room} players={players} size="8" />
              </div>
              <div className="mt-4 flex items-center gap-1">
                {[0, 1, 2, 3].map((index) => (
                  <span
                    key={index}
                    className={`h-1.5 flex-1 rounded-full ${
                      index < Math.min(room.messages.length, 4)
                        ? hot ? "bg-blue-300/85" : "bg-purple-300/80"
                        : "bg-white/12"
                    }`}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MovementTrail({ rows }: { rows: ReturnType<typeof buildMovementRows> }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/75">Movement Trail</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-white/35">Initial room choices are still settling.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((row) => (
            <div key={row.playerKey} className="grid grid-cols-[1fr_auto] items-center gap-3 text-xs">
              <span className="truncate text-white/60">{row.playerName}</span>
              <span className={row.moved ? "text-blue-200/80" : "text-white/35"}>
                {row.from ? `${row.from} -> ${row.to}` : row.to}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RoomRail({
  rooms,
  players,
  selectedRoomId,
  onSelectRoom,
}: {
  rooms: WhisperRoomStage[];
  players: GamePlayer[];
  selectedRoomId: number | null;
  onSelectRoom: (roomId: number) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 md:grid md:grid-cols-1 md:overflow-visible md:pb-0">
      {rooms.map((room) => {
        const selected = room.roomId === selectedRoomId;
        const hot = !selected && room.messages.length > 0;
        const state = roomStateLabel(room);
        return (
          <button
            key={room.roomId}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelectRoom(room.roomId);
            }}
            className={`min-w-28 rounded-xl border px-3 py-3 text-left transition-colors md:min-w-0 ${
              selected
                ? "border-purple-300/60 bg-purple-500/15"
                : hot
                  ? "border-blue-400/50 bg-blue-500/10"
                  : "border-white/10 bg-white/[0.04] hover:border-purple-300/30"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-white/85">
                {roomDisplayLabel(room)}
              </span>
              <span className={`text-[9px] uppercase tracking-[0.14em] ${hot ? "text-blue-200" : "text-white/35"}`}>
                {selected ? "LIVE" : hot ? "HOT" : state === "EMPTY" ? "0" : state === "SINGLE" ? "1" : room.messages.length}
              </span>
            </div>
            <div className="mt-3">
              <RoomAvatarRow room={room} players={players} size="6" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ActiveRoomFeed({
  room,
  players,
  showThinking,
}: {
  room: WhisperRoomStage | null;
  players: GamePlayer[];
  showThinking?: boolean;
}) {
  if (!room) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/30 p-8 text-center text-white/40">
        Waiting for room telemetry.
      </div>
    );
  }

  const occupants = resolveRoomPlayers(room, players);
  const state = roomStateLabel(room);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-purple-500/25 bg-black/35">
      <div className="border-b border-white/10 px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold uppercase tracking-[0.08em] text-white">
              {roomDisplayLabel(room)} / Private Feed
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-yellow-200/70">
              {state === "BACKCHANNEL" ? "BACKCHANNEL" : state}
            </p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/45">
            {room.playerNames.length} agent{room.playerNames.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {room.playerNames.length === 0 ? (
            <span className="text-xs text-white/35">No one entered this room.</span>
          ) : room.playerNames.map((name, index) => (
            <div key={`${room.roomId}-occupant-${name}`} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">
              <AgentInitial player={occupants[index]} name={name} size="6" />
              <span className="max-w-24 truncate text-xs text-white/65">{name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-5">
        {room.messages.length === 0 ? (
          <div className="flex min-h-56 items-center justify-center rounded-xl border border-white/10 bg-white/[0.025] p-6 text-center md:min-h-72">
            <p className="max-w-sm text-sm leading-relaxed text-white/40">
              {state === "EMPTY"
                ? "No one chose this room. That absence is public information."
                : state === "SINGLE"
                  ? `${room.playerNames[0]} is alone here. No backchannel conversation runs for singleton rooms.`
                  : "The room is occupied. Backchannel messages will appear as they arrive."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {room.messages.map((message) => {
              const sender = players.find((player) => player.id === message.fromPlayerId)
                ?? players.find((player) => player.name === message.fromPlayerId);
              const senderName = message.fromPlayerName ?? sender?.name ?? message.fromPlayerId ?? "Unknown";
              return (
                <div key={message.id} className="flex gap-3">
                  <div className="mt-1 flex-shrink-0">
                    <AgentInitial player={sender} name={senderName} size="8" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-blue-200/80">{senderName}</span>
                      <span className="text-[10px] uppercase tracking-[0.16em] text-white/25">BACKCHANNEL</span>
                    </div>
                    {showThinking && message.thinking && (
                      <div className="mb-2 border-l-2 border-indigo-500/25 pl-3">
                        <p className="text-xs italic leading-relaxed text-indigo-200/45">{message.thinking}</p>
                      </div>
                    )}
                    <div className="rounded-2xl rounded-tl-sm border border-blue-400/25 bg-blue-500/10 px-4 py-3">
                      <p className="text-sm leading-relaxed text-white/80">{message.text}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function OpenWhisperRoomsView({
  phaseEntries,
  players,
  phaseKey,
  live = false,
  showThinking,
}: {
  phaseEntries: TranscriptEntry[];
  players: GamePlayer[];
  phaseKey: string;
  live?: boolean;
  showThinking?: boolean;
}) {
  const stage = useMemo(() => buildWhisperStageData(phaseEntries, players), [phaseEntries, players]);
  const beats = useMemo(
    () => Array.from(new Set(stage.rooms.map((room) => room.beat ?? 1))).sort((left, right) => left - right),
    [stage.rooms],
  );
  const activeBeat = beats[beats.length - 1] ?? 1;
  const currentRooms = stage.rooms
    .filter((room) => (room.beat ?? activeBeat) === activeBeat)
    .sort((left, right) => (left.localRoomNumber ?? left.roomId) - (right.localRoomNumber ?? right.roomId));
  const [selection, setSelection] = useState<{ phaseKey: string; roomId: number | null }>({
    phaseKey,
    roomId: currentRooms[0]?.roomId ?? null,
  });
  const requestedRoomId = selection.phaseKey === phaseKey ? selection.roomId : null;
  const activeRoom = currentRooms.find((room) => room.roomId === requestedRoomId) ?? currentRooms[0] ?? null;
  const selectedRoomId = activeRoom?.roomId ?? null;
  const movementRows = useMemo(() => buildMovementRows(stage.rooms), [stage.rooms]);
  const [mapOpen, setMapOpen] = useState(false);

  const selectRoom = useCallback((roomId: number) => {
    setSelection({ phaseKey, roomId });
    setMapOpen(false);
  }, [phaseKey, setMapOpen, setSelection]);

  if (!stage.hasRoomMetadata) {
    return null;
  }

  return (
    <div data-controls className="flex h-full min-h-0 w-full flex-col p-3 md:p-0">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-3 md:gap-4">
        <div className="flex-shrink-0 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 md:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-purple-200/80">WHISPER: OPEN ROOMS</p>
              <p className="mt-1 text-xs text-white/35">Round room telemetry · beat {activeBeat} of {Math.max(beats.length, 1)}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                live
                  ? "border-red-400/30 bg-red-500/15 text-red-100"
                  : "border-white/15 bg-white/5 text-white/55"
              }`}>
                {live ? "LIVE" : "REPLAY"}
              </span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMapOpen(true);
                }}
                className="rounded-full border border-blue-400/25 bg-blue-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-100 md:hidden"
              >
                HOUSE MAP
              </button>
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 md:hidden">
          <RoomRail rooms={currentRooms} players={players} selectedRoomId={selectedRoomId} onSelectRoom={selectRoom} />
        </div>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(28rem,1.4fr)_minmax(16rem,0.7fr)]">
          <div className="hidden min-h-0 overflow-y-auto pr-1 lg:block">
            <HouseMap rooms={currentRooms} players={players} selectedRoomId={selectedRoomId} onSelectRoom={selectRoom} />
          </div>

          <ActiveRoomFeed room={activeRoom} players={players} showThinking={showThinking} />

          <div className="hidden min-h-0 gap-4 overflow-y-auto pr-1 md:grid">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/75">Other Rooms</p>
                <span className="text-[10px] uppercase tracking-[0.16em] text-white/25">{currentRooms.length} total</span>
              </div>
              <RoomRail rooms={currentRooms} players={players} selectedRoomId={selectedRoomId} onSelectRoom={selectRoom} />
            </div>
            <MovementTrail rows={movementRows} />
          </div>
        </div>
      </div>

      {mapOpen && (
        <div
          className="fixed inset-0 z-[80] bg-black/80 p-4 md:hidden"
          onClick={(event) => {
            event.stopPropagation();
            setMapOpen(false);
          }}
        >
          <div className="mx-auto flex h-full max-w-md flex-col justify-end">
            <div
              className="max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 p-3 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/55">HOUSE MAP</span>
                <button
                  type="button"
                  onClick={() => setMapOpen(false)}
                  className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-white/45"
                >
                  Close
                </button>
              </div>
              <HouseMap rooms={currentRooms} players={players} selectedRoomId={selectedRoomId} onSelectRoom={selectRoom} />
              <div className="mt-3">
                <MovementTrail rows={movementRows} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Sealed room card — shows room assignment but hides message content during live gameplay. */
function WhisperRoomSealed({
  room,
  players,
}: {
  room: WhisperRoomStage;
  players: GamePlayer[];
}) {
  const occupants = room.playerIds.length > 0
    ? room.playerIds.map((id, index) => players.find((p) => p.id === id || p.name === room.playerNames[index]))
    : [];
  const messageCount = room.messages.length;

  return (
    <div className="rounded-2xl border border-purple-400/20 bg-black/30 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-purple-900/20">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-purple-300/45 flex-shrink-0">
            Room {room.roomId}
          </p>
          <p className="text-xs font-semibold text-white truncate">
            {room.playerNames.length > 0 ? room.playerNames.join(", ") : "Empty"}
          </p>
        </div>
        <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-amber-200/80 flex-shrink-0">
          Sealed
        </span>
      </div>

      <div className="p-4 flex flex-col items-center justify-center gap-3 min-h-[120px]">
        <div className="flex items-center gap-3">
          {occupants.slice(0, 4).map((player, index) => player ? (
            <AgentAvatar key={player.id} avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="8" />
          ) : (
            <span key={`unknown-${index}`} className="w-8 h-8 rounded-full bg-purple-900/30 flex items-center justify-center text-[10px] text-purple-300/60">?</span>
          ))}
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400/40 animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400/20 animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
        <p className="text-xs text-white/30 italic">
          {messageCount === 0
            ? room.playerNames.length < 2 ? "No backchannel conversation in this room." : "Private conversation in progress..."
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
  showThinking,
}: {
  room: WhisperRoomStage;
  players: GamePlayer[];
  focused?: boolean;
  onFocus?: () => void;
  onClose?: () => void;
  showThinking?: boolean;
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
      className={`rounded-2xl border bg-black/30 flex flex-col min-h-0 overflow-hidden transition-all duration-300 flex-1 ${
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
            {room.playerNames.length > 0 ? room.playerNames.join(", ") : "Empty"}
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
        className="p-3 space-y-2 overflow-y-auto flex-1 min-h-0"
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
                  {showThinking && msg.thinking && (
                    <div className="mb-1 border-l-2 border-indigo-700/30 pl-2 py-0.5">
                      <p className="text-[10px] text-indigo-400/50 italic leading-relaxed">{msg.thinking}</p>
                    </div>
                  )}
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
          WHISPER: OPEN ROOMS
        </p>
        <p className="text-xs text-white/40 max-w-md mx-auto leading-relaxed">
          HOUSE MAP: each player chose a neutral room. Empty rooms and solo rooms are part of the signal.
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
              const occupants = room.playerIds.length > 0
                ? room.playerIds.map((id, playerIndex) => players.find((p) => p.id === id || p.name === room.playerNames[playerIndex]))
                : [];
              return (
                <div
                  key={room.roomId}
                  className={`rounded-2xl border border-purple-500/25 bg-black/30 px-5 py-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] ${fadeIn}`}
                  style={animated ? { animationDelay: `${index * 150}ms` } : undefined}
                >
                  <p className="text-[10px] uppercase tracking-[0.28em] text-purple-300/50 mb-4">
                    Room {room.roomId} · {room.playerNames.length >= 2 ? "BACKCHANNEL" : room.playerNames.length === 1 ? "SOLO" : "EMPTY"}
                  </p>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    {room.playerNames.length === 0 ? (
                      <span className="text-sm text-white/35 italic">Empty</span>
                    ) : room.playerNames.map((name, playerIndex) => {
                      const player = occupants[playerIndex];
                      return (
                        <div key={`${room.roomId}-${name}`} className="flex flex-col items-center gap-1.5">
                          {player ? (
                            <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="10" />
                          ) : (
                            <span className="w-10 h-10 rounded-full bg-purple-900/30 flex items-center justify-center text-sm text-purple-300/60">?</span>
                          )}
                          <span className="text-xs font-medium text-white/80 text-center max-w-[5rem] truncate">{name}</span>
                        </div>
                      );
                    })}
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
  // activeIndex: -1 = overview, 0..N = room index.
  const [activeRoomState, setActiveRoomState] = useState({ phaseKey, index: -1 });
  const activeIndex = activeRoomState.phaseKey === phaseKey ? activeRoomState.index : -1;
  const setActiveIndex = useCallback((nextIndex: number | ((index: number) => number)) => {
    setActiveRoomState((current) => {
      const currentIndex = current.phaseKey === phaseKey ? current.index : -1;
      return {
        phaseKey,
        index: typeof nextIndex === "function" ? nextIndex(currentIndex) : nextIndex,
      };
    });
  }, [phaseKey]);

  // Auto-advance from overview to first room after 6 seconds
  useEffect(() => {
    if (stage.hasRoomMetadata) return;
    if (activeIndex !== -1 || stage.rooms.length === 0) return;
    const timer = window.setTimeout(() => setActiveIndex(0), 6000);
    return () => window.clearTimeout(timer);
  }, [activeIndex, stage.hasRoomMetadata, stage.rooms.length, setActiveIndex]);

  // Auto-advance between rooms every 8 seconds (if room has messages and we're caught up)
  useEffect(() => {
    if (stage.hasRoomMetadata) return;
    if (activeIndex < 0 || activeIndex >= stage.rooms.length) return;
    const room = stage.rooms[activeIndex];
    if (!room || room.messages.length === 0) return;
    const timer = window.setTimeout(() => {
      if (activeIndex < stage.rooms.length - 1) {
        setActiveIndex((i) => i + 1);
      }
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [activeIndex, stage.hasRoomMetadata, stage.rooms, setActiveIndex]);

  const activeRoom = activeIndex >= 0 ? stage.rooms[activeIndex] : null;

  if (stage.hasRoomMetadata) {
    return (
      <OpenWhisperRoomsView
        phaseEntries={phaseEntries}
        players={players}
        phaseKey={phaseKey}
        live={!isReplay}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 md:p-6">
      <div className="flex-shrink-0 text-center mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-purple-300/70 mb-1">
          WHISPER: OPEN ROOMS
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
        <div className="flex-shrink-0 flex flex-wrap items-center justify-center gap-1.5 mb-4">
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
          <div className="flex-1 min-h-0 flex flex-col max-w-2xl w-full mx-auto animate-[fadeIn_0.3s_ease-out]">
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
        <div className="flex-shrink-0 mt-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-center max-w-2xl mx-auto">
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/30 mb-1">Commons</p>
          <p className="text-sm text-white/60">
            {stage.commons.map((p) => p.name).join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}
