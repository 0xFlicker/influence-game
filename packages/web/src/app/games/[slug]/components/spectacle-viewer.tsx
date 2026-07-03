"use client";

import type { TranscriptEntry, GamePlayer } from "@/lib/api";
import { AgentAvatar } from "@/components/agent-avatar";
import { Typewriter } from "@/components/typewriter";
import type { ReplayScene, SpectacleMessagePhase } from "./types";
import { HOUSE_INTROS, phaseToRoomType } from "./constants";

// ---------------------------------------------------------------------------
// buildReplayScenes — groups transcript into per-phase (and per-room) scenes
// ---------------------------------------------------------------------------

/**
 * Parse mingle allocation text to extract room assignments.
 * Lightweight version for scene-building (no player UUID resolution needed).
 */
function parseWhisperRooms(msgs: TranscriptEntry[]): Array<{ roomId: number; playerNames: string[] }> {
  const playerByIdOrName = new Map<string, string>();
  for (const msg of msgs) {
    if (msg.fromPlayerId && msg.fromPlayerName) playerByIdOrName.set(msg.fromPlayerId, msg.fromPlayerName);
    if (msg.fromPlayerName) playerByIdOrName.set(msg.fromPlayerName, msg.fromPlayerName);
  }

  const roomsById = new Map<number, { roomId: number; playerNames: string[] }>();

  for (const msg of msgs) {
    for (const room of msg.roomMetadata?.diagnostics?.allocatedRooms ?? []) {
      roomsById.set(room.roomId, {
        roomId: room.roomId,
        playerNames: room.players.map((player) => player.name),
      });
    }
    for (const room of msg.roomMetadata?.rooms ?? []) {
      if (!roomsById.has(room.roomId)) {
        roomsById.set(room.roomId, {
          roomId: room.roomId,
          playerNames: room.playerIds.map((id) => playerByIdOrName.get(id) ?? id),
        });
      }
    }
  }

  const rooms: Array<{ roomId: number; playerNames: string[] }> = Array.from(roomsById.values())
    .sort((left, right) => left.roomId - right.roomId);
  if (rooms.length > 0) return rooms;

  const allocationEntries = msgs.filter((e) => e.scope === "system" && /Room\s+\d+:/.test(e.text));
  for (const allocationEntry of allocationEntries) {
    for (const match of allocationEntry.text.matchAll(/Room\s+(\d+):\s*([^|]+?)(?=\s*\||$)/g)) {
      const roomId = Number(match[1]);
      const occupantsText = match[2]?.trim();
      if (!occupantsText || Number.isNaN(roomId)) continue;
      const playerNames = occupantsText.toLowerCase() === "empty"
        ? []
        : occupantsText
            .split(/\s*(?:,|&)\s*/)
            .map((name) => name.trim())
            .filter(Boolean);
      rooms.push({ roomId, playerNames });
    }
  }
  return rooms;
}

export function buildReplayScenes(transcript: TranscriptEntry[]): ReplayScene[] {
  // Diary entries are archived in the inspector and intentionally omitted
  // from the main gameplay loop.
  const grouped = new Map<string, TranscriptEntry[]>();
  for (const msg of transcript) {
    if (msg.phase === "DIARY_ROOM" || msg.scope === "diary") {
      continue;
    }

    const key = `R${msg.round}-${msg.phase}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(msg);
  }

  const scenes: ReplayScene[] = [];
  for (const [id, msgs] of grouped.entries()) {
    const { round, phase } = msgs[0]!;
    const roomType = phaseToRoomType(phase);

    if (phase === "MINGLE" || phase === "POST_VOTE_MINGLE") {
      if (msgs.some((m) => (m.roomMetadata?.rooms.length ?? 0) > 0)) {
        scenes.push({
          id,
          round,
          phase,
          roomType,
          messages: msgs,
          houseIntro: HOUSE_INTROS[phase] ?? null,
        });
        continue;
      }

      // Sequential: overview scene → one scene per room
      const rooms = parseWhisperRooms(msgs);
      const systemMsgs = msgs.filter((m) => m.scope === "system");

      // Overview scene (allocation reveal — no chat messages to step through)
      scenes.push({
        id: `${id}-overview`,
        round,
        phase,
        roomType,
        messages: systemMsgs.length > 0 ? [systemMsgs[0]!] : [],
        houseIntro: HOUSE_INTROS[phase] ?? null,
        isOverview: true,
      });

      if (rooms.length > 0) {
        // One scene per room — match by roomId first, fall back to player names
        // (older games may lack roomId on persisted transcript entries)
        for (const room of rooms) {
          const nameSet = new Set(room.playerNames.map((n) => n.toLowerCase()));
          const roomMsgs = msgs.filter((m) => {
            if (m.scope !== "mingle") return false;
            if (m.roomId != null) return m.roomId === room.roomId;
            // Fallback: match by sender/recipient names
            const from = (m.fromPlayerId ?? m.fromPlayerName ?? "").toLowerCase();
            const to = (m.toPlayerIds?.[0] ?? "").toLowerCase();
            return nameSet.has(from) && (to === "" || nameSet.has(to));
          });
          if (roomMsgs.length === 0) continue;
          scenes.push({
            id: `${id}-room${room.roomId}`,
            round,
            phase,
            roomType,
            messages: roomMsgs,
            houseIntro: null,
            whisperRoom: { roomId: room.roomId, playerNames: room.playerNames },
          });
        }
      } else {
        // Fallback: no allocation parsed — single scene with all mingle messages
        const mingleMsgs = msgs.filter((m) => m.scope === "mingle");
        if (mingleMsgs.length > 0) {
          scenes.push({
            id: `${id}-all`,
            round,
            phase,
            roomType,
            messages: mingleMsgs,
            houseIntro: null,
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

// ---------------------------------------------------------------------------
// SpectacleMessageSpotlight — single-message spotlight for live non-dedicated phases
// ---------------------------------------------------------------------------

export function SpectacleMessageSpotlight({
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
      <div className="flex-1 flex items-center justify-center ">
        <p className="text-white/15 text-sm animate-pulse">Waiting for the next move…</p>
      </div>
    );
  }

  const isSystem = !message.fromPlayerId || message.scope === "system";
  const isAnonymousRumor = message.phase === "RUMOR" && message.scope === "public";
  const player = isAnonymousRumor ? null : (message.fromPlayerId
    ? players.find((p) => p.id === message.fromPlayerId)
      ?? players.find((p) => p.name === message.fromPlayerId)
    : null);
  const playerName = isAnonymousRumor
    ? "Anonymous"
    : (message.fromPlayerName ?? player?.name ?? message.fromPlayerId ?? "The House");
  const isElimination = message.scope === "system" && (message.text.includes("ELIMINATED:") || message.text.includes("AUTO-ELIMINATE:"));

  return (
    <div className="flex-1 flex items-center justify-center  px-6 py-8">
      <div className="max-w-2xl w-full">
        {/* Typing indicator */}
        {phase === "typing" && !isSystem && (
          <div className="text-center animate-[fadeIn_0.3s_ease-out]">
            <div className="flex items-center justify-center gap-3 mb-8">
              {isAnonymousRumor ? (
                <span className="w-10 h-10 rounded-full bg-purple-900/40 flex items-center justify-center text-xl">🗣</span>
              ) : player ? (
                <AgentAvatar avatarUrl={player.avatarUrl} personaKey={player.personaKey} persona={player.persona} name={player.name} size="10" />
              ) : null}
              <span className={`text-lg font-semibold ${isAnonymousRumor ? "text-purple-300/70 italic" : "text-white/60"}`}>{playerName}</span>
              {isAnonymousRumor && (
                <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">rumor</span>
              )}
              {message.scope === "mingle" && (
                <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">mingle</span>
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
                {isAnonymousRumor ? (
                  <span className="w-10 h-10 rounded-full bg-purple-900/40 flex items-center justify-center text-xl">🗣</span>
                ) : player ? (
                  <AgentAvatar avatarUrl={player.avatarUrl} personaKey={player.personaKey} persona={player.persona} name={player.name} size="10" />
                ) : null}
                <span className={`text-lg font-semibold ${isAnonymousRumor ? "text-purple-300/70 italic" : "text-white/70"}`}>{playerName}</span>
                {isAnonymousRumor && (
                  <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">rumor</span>
                )}
                {message.scope === "mingle" && (
                  <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">mingle</span>
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
