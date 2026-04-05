"use client";

import type { TranscriptEntry, GamePlayer } from "@/lib/api";
import { AgentAvatar } from "@/components/agent-avatar";
import { Typewriter } from "@/components/typewriter";
import type { ReplayScene, SpectacleMessagePhase } from "./types";
import { HOUSE_INTROS, phaseToRoomType } from "./constants";
import { diaryPlayerName } from "./diary-room";

// ---------------------------------------------------------------------------
// buildReplayScenes — groups transcript into per-phase (and per-room) scenes
// ---------------------------------------------------------------------------

/**
 * Parse whisper allocation text to extract room assignments.
 * Lightweight version for scene-building (no player UUID resolution needed).
 */
function parseWhisperRooms(msgs: TranscriptEntry[]): Array<{ roomId: number; playerNames: string[] }> {
  const allocationEntry = [...msgs]
    .reverse()
    .find((e) => e.scope === "system" && /Room\s+\d+:/.test(e.text));
  if (!allocationEntry) return [];

  const rooms: Array<{ roomId: number; playerNames: string[] }> = [];
  for (const match of allocationEntry.text.matchAll(/Room\s+(\d+):\s*([^|]+?)\s*&\s*([^|]+?)(?=\s*\||$)/g)) {
    const roomId = Number(match[1]);
    const leftName = match[2]?.trim();
    const rightName = match[3]?.trim();
    if (!leftName || !rightName || Number.isNaN(roomId)) continue;
    rooms.push({ roomId, playerNames: [leftName, rightName] });
  }
  return rooms;
}

/**
 * Interleave thinking entries inline: each agent's thinking appears right
 * after that agent's last regular message, instead of being grouped at the end.
 */
function interleaveThinking(msgs: TranscriptEntry[]): TranscriptEntry[] {
  const regular = msgs.filter((m) => m.scope !== "thinking");
  const thinking = msgs.filter((m) => m.scope === "thinking");
  if (thinking.length === 0) return msgs;

  // Map agent → thinking entries
  const thinkingByAgent = new Map<string, TranscriptEntry[]>();
  for (const t of thinking) {
    const key = t.fromPlayerId ?? t.fromPlayerName ?? "";
    if (!thinkingByAgent.has(key)) thinkingByAgent.set(key, []);
    thinkingByAgent.get(key)!.push(t);
  }

  // Find last regular message index per agent
  const lastIdx = new Map<string, number>();
  regular.forEach((m, i) => {
    const key = m.fromPlayerId ?? m.fromPlayerName ?? "";
    lastIdx.set(key, i);
  });

  // Insert thinking after each agent's last regular message
  const result: TranscriptEntry[] = [];
  const inserted = new Set<string>();
  for (let i = 0; i < regular.length; i++) {
    const m = regular[i]!;
    result.push(m);
    const key = m.fromPlayerId ?? m.fromPlayerName ?? "";
    if (lastIdx.get(key) === i && thinkingByAgent.has(key)) {
      result.push(...thinkingByAgent.get(key)!);
      inserted.add(key);
    }
  }

  // Append thinking from agents with no regular messages
  for (const [key, entries] of thinkingByAgent) {
    if (!inserted.has(key)) {
      result.push(...entries);
    }
  }

  return result;
}

export function buildReplayScenes(transcript: TranscriptEntry[]): ReplayScene[] {
  // Group messages by round+phase, but split DIARY_ROOM into separate groups
  // for each contiguous batch. Each runDiaryRoom(precedingPhase) produces a
  // contiguous run of diary entries in the transcript; by assigning a unique
  // key per run we keep post-LOBBY diary rooms separate from post-COUNCIL ones.
  const grouped = new Map<string, TranscriptEntry[]>();
  let diaryBatch = 0;
  let prevWasDiary = false;
  for (const msg of transcript) {
    let key: string;
    if (msg.phase === "DIARY_ROOM") {
      if (!prevWasDiary) diaryBatch++;
      key = `R${msg.round}-DIARY_ROOM-${diaryBatch}`;
      prevWasDiary = true;
    } else {
      key = `R${msg.round}-${msg.phase}`;
      prevWasDiary = false;
    }
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(msg);
  }

  const scenes: ReplayScene[] = [];
  for (const [id, msgs] of grouped.entries()) {
    const { round, phase } = msgs[0]!;
    const roomType = phaseToRoomType(phase);

    if (phase === "WHISPER") {
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
            if (m.scope !== "whisper") return false;
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
        // Fallback: no allocation parsed — single scene with all whisper messages
        const whisperMsgs = msgs.filter((m) => m.scope === "whisper");
        if (whisperMsgs.length > 0) {
          scenes.push({
            id: `${id}-all`,
            round,
            phase,
            roomType,
            messages: whisperMsgs,
            houseIntro: null,
          });
        }
      }

      // Distribute thinking entries inline into whisper room scenes
      const whisperThinking = msgs.filter((m) => m.scope === "thinking");
      if (whisperThinking.length > 0) {
        // Match thinking entries to rooms by agent name
        const roomPlayerSets = rooms.map((r) => new Set(r.playerNames.map((n) => n.toLowerCase())));
        for (const t of whisperThinking) {
          const name = (t.fromPlayerId ?? t.fromPlayerName ?? "").toLowerCase();
          // Find the last room scene this agent belongs to and append thinking
          let added = false;
          for (let ri = scenes.length - 1; ri >= 0; ri--) {
            const s = scenes[ri]!;
            if (s.whisperRoom && roomPlayerSets.some((ps) => ps.has(name) && ps.has(s.whisperRoom!.playerNames[0]!.toLowerCase()))) {
              s.messages.push(t);
              added = true;
              break;
            }
          }
          // Fallback: append to the last whisper room scene
          if (!added) {
            for (let ri = scenes.length - 1; ri >= 0; ri--) {
              if (scenes[ri]!.whisperRoom) {
                scenes[ri]!.messages.push(t);
                added = true;
                break;
              }
            }
          }
        }
      }
    } else if (phase === "DIARY_ROOM") {
      // Sequential: one scene per player
      const playerMap = new Map<string, TranscriptEntry[]>();
      for (const msg of msgs) {
        if (msg.scope !== "diary" || !msg.fromPlayerId) continue;
        const name = diaryPlayerName(msg.fromPlayerId);
        if (!playerMap.has(name)) playerMap.set(name, []);
        playerMap.get(name)!.push(msg);
      }

      if (playerMap.size > 0) {
        let idx = 0;
        for (const [playerName, playerMsgs] of playerMap.entries()) {
          scenes.push({
            id: `${id}-diary-${idx}`,
            round,
            phase,
            roomType,
            messages: playerMsgs,
            houseIntro: idx === 0 ? (HOUSE_INTROS[phase] ?? null) : null,
            diaryPlayer: { playerName },
          });
          idx++;
        }
      } else {
        // Fallback: system-only diary messages
        scenes.push({
          id,
          round,
          phase,
          roomType,
          messages: msgs,
          houseIntro: HOUSE_INTROS[phase] ?? null,
        });
      }

      // Distribute thinking entries inline into per-player diary scenes
      const diaryThinking = msgs.filter((m) => m.scope === "thinking");
      for (const t of diaryThinking) {
        const name = diaryPlayerName(t.fromPlayerId ?? "");
        // Find the matching diary player scene and append
        let added = false;
        for (let di = scenes.length - 1; di >= 0; di--) {
          if (scenes[di]!.diaryPlayer?.playerName === name) {
            scenes[di]!.messages.push(t);
            added = true;
            break;
          }
        }
        // Fallback: append to last diary scene
        if (!added) {
          for (let di = scenes.length - 1; di >= 0; di--) {
            if (scenes[di]!.diaryPlayer) {
              scenes[di]!.messages.push(t);
              added = true;
              break;
            }
          }
        }
      }
    } else {
      scenes.push({
        id,
        round,
        phase,
        roomType,
        messages: interleaveThinking(msgs),
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
                <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="10" />
              ) : null}
              <span className={`text-lg font-semibold ${isAnonymousRumor ? "text-purple-300/70 italic" : "text-white/60"}`}>{playerName}</span>
              {isAnonymousRumor && (
                <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">rumor</span>
              )}
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
                {isAnonymousRumor ? (
                  <span className="w-10 h-10 rounded-full bg-purple-900/40 flex items-center justify-center text-xl">🗣</span>
                ) : player ? (
                  <AgentAvatar avatarUrl={player.avatarUrl} persona={player.persona} name={player.name} size="10" />
                ) : null}
                <span className={`text-lg font-semibold ${isAnonymousRumor ? "text-purple-300/70 italic" : "text-white/70"}`}>{playerName}</span>
                {isAnonymousRumor && (
                  <span className="text-xs text-purple-400/50 uppercase tracking-wider ml-1">rumor</span>
                )}
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
