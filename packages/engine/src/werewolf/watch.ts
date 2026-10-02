import { applyWerewolfEvent } from "./rules";
import { projectWerewolfEntry, projectWerewolfSnapshot, type WerewolfAudience } from "./observation";
import type { WerewolfEvent, WerewolfState } from "./types";
import {isWerewolfPlayable, type WerewolfWatchIdentity, type WerewolfWatchMoment, type WerewolfWatchIndex} from "./watch-contract";

/** Server-only staging coordinates never appear in the browser DTO. */
export interface WerewolfWatchStaging { boundary: number; roomId: "lobby" | "mingle-1" | null; participantIds: string[] }
export function projectWerewolfWatch(events: readonly WerewolfEvent[], audience: WerewolfAudience, fromCursor = 1, limit = 32) {
  if (!["mystery", "omniscient"].includes(audience) || !Number.isSafeInteger(fromCursor) || fromCursor < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new Error("Invalid watch window");
  let state: WerewolfState | null = null, cursor = 0;
  const moments: Array<WerewolfWatchMoment & { staging: WerewolfWatchStaging }> = [];
  const navigation: WerewolfWatchIndex[] = [];
  let sceneId = "introduction", chapterId = "introduction", packAttempt = 1;
  for (const event of events) {
    const before: WerewolfState | null = state;
    state = applyWerewolfEvent(state, event);
    const appended = state.history.slice(before?.history.length ?? 0);
    const visible = appended.flatMap(entry => projectWerewolfEntry(entry, audience));
    if (visible.length > 1) throw new Error("Watch event requires explicit multi-entry staging");
    for (const entry of visible) {
      cursor++;
      chapterId = entry.kind === "result" ? "ending" : entry.day === 0 ? "introduction" : `cycle:${entry.day}`;
      if (entry.kind === "phase") {
        if (entry.phase === "introduction") { sceneId = "introduction"; chapterId = "introduction"; }
        if (entry.phase === "night") { packAttempt = 1; sceneId = `cycle:${entry.day}:pack:1`; }
      } else if (entry.kind === "discussion") sceneId = `${chapterId}:thread:${entry.contribution.thread}`;
      else if (entry.kind === "vote") sceneId = `${chapterId}:checkpoint:${entry.result.thread}`;
      else if (entry.kind === "speech" && entry.audience === "pack") sceneId = `${chapterId}:pack:${packAttempt}`;
      else if (entry.kind === "pack_vote") { sceneId = `${chapterId}:pack:${entry.result.attempt}`; packAttempt = entry.result.attempt + 1; }
      else if (entry.kind === "night") sceneId = `${chapterId}:dawn`;
      else if (entry.kind === "result") sceneId = "ending";
      else if (entry.kind === "speech") { chapterId = "introduction"; sceneId = "introduction"; }
      if (isWerewolfPlayable(entry) && navigation.at(-1)?.sceneId !== sceneId) {
        const label = entry.kind === "discussion" ? `Day ${entry.day} · Thread ${entry.contribution.thread}` : entry.kind === "vote" ? `Day ${entry.day} · Vote` : chapterId === "introduction" ? "Introductions" : chapterId === "ending" ? "Ending" : `Cycle ${entry.day} · ${entry.kind === "night" ? "Dawn" : "Pack"}`;
        navigation.push({ cursor, chapterId, sceneId, label });
      }
      if (cursor < fromCursor || cursor >= fromCursor + limit) continue;
      const roomId = entry.day === 0 ? null : entry.kind === "pack_vote" || entry.kind === "speech" && entry.audience === "pack" ? "mingle-1" : "lobby";
      const staging = before ?? state;
      moments.push({ cursor, entry, snapshot: projectWerewolfSnapshot(state, audience, cursor), chapterId, sceneId, mediaKey: null,
        staging: { boundary: event.sequence - 1, roomId, participantIds: roomId === null ? [] : staging.aliveIds.filter(id => roomId === "lobby" || staging.roles[id] === "werewolf") } });
    }
  }
  if (!state) throw new Error("Werewolf replay is empty");
  const players: WerewolfWatchIdentity[] = state.players.map(p => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl, personaKey: p.personaKey ?? null, personality: p.personality, backstory: p.backstory }));
  return { gameId: state.gameId, rulesVersion: state.config.rulesVersion, latestCursor: cursor, fromCursor, throughCursor: moments.at(-1)?.cursor ?? Math.min(cursor, fromCursor - 1), players, moments, navigation };
}
