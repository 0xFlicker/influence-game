import { werewolfVisualStaging } from "./visual-staging";
import { applyWerewolfEvent } from "./rules";
import { projectWerewolfEntry, projectWerewolfSnapshot, type WerewolfAudience } from "./observation";
import type { WerewolfEvent, WerewolfState } from "./types";
import {isWerewolfPlayable, type WerewolfNightAction, type WerewolfWatchIdentity, type WerewolfWatchMoment, type WerewolfWatchIndex} from "./watch-contract";

/** Server-only staging coordinates never appear in the browser DTO. */
export type WerewolfWatchStaging = ReturnType<typeof werewolfVisualStaging>;
export function projectWerewolfWatch(events: readonly WerewolfEvent[], audience: WerewolfAudience, fromCursor = 1, limit = 32) {
  if (!["mystery", "omniscient"].includes(audience) || !Number.isSafeInteger(fromCursor) || fromCursor < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new Error("Invalid watch window");
  let state: WerewolfState | null = null, cursor = 0;
  const moments: Array<WerewolfWatchMoment & { staging: WerewolfWatchStaging }> = [];
  const navigation: WerewolfWatchIndex[] = [];
  const playback: Array<{cursor: number; steps: number}> = [];
  let sceneId = "introduction", chapterId = "introduction", packAttempt = 1;
  for (const frame of walkWerewolfHistory(events, audience)) {
    const { event, before, entry } = frame;
    state = frame.state;
    cursor = frame.cursor;
    if (entry) {
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
      const staging = before ?? state;
      const nightActions = resolvedNightActions(staging, entry, audience);
      if (isWerewolfPlayable(entry)) playback.push({cursor, steps: entry.kind === "vote" && entry.result.ballots.length > 0 ? entry.result.ballots.length + 2 : 1 + nightActions.length});
      if (cursor < fromCursor || cursor >= fromCursor + limit) continue;
      const visualStaging = werewolfVisualStaging(staging, event, entry);
      moments.push({ cursor, entry, snapshot: projectWerewolfSnapshot(state, audience, cursor), chapterId, sceneId, mediaKey: null,
        ...(nightActions.length ? { night: { actions: nightActions, before: projectWerewolfSnapshot(staging, audience, cursor) } } : {}), staging: visualStaging });
    }
  }
  if (!state) throw new Error("Werewolf replay is empty");
  const players: WerewolfWatchIdentity[] = state.players.map(p => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl, personaKey: p.personaKey ?? null, personality: p.personality, backstory: p.backstory }));
  return { gameId: state.gameId, rulesVersion: state.config.rulesVersion, latestCursor: cursor, fromCursor, throughCursor: moments.at(-1)?.cursor ?? Math.min(cursor, fromCursor - 1), players, moments, navigation, playback };
}


/** Internal traversal: one validated authority for audience-local source positions.
 * Frames include private reducer state and must never be serialized to clients.
 */
export function* walkWerewolfHistory(events: readonly WerewolfEvent[], audience: WerewolfAudience) {
  let state: WerewolfState | null = null, cursor = 0;
  for (const event of events) {
    const before: WerewolfState | null = state;
    state = applyWerewolfEvent(state, event);
    const visible = state.history.slice(before?.history.length ?? 0).flatMap(entry => projectWerewolfEntry(entry, audience));
    if (visible.length > 1) throw new Error("Watch event requires explicit multi-entry staging");
    const entry = visible[0];
    if (entry) cursor++;
    yield { event, before, state, entry, cursor };
  }
}

/** One action list owns both scrub counts and scene expansion; public night entries remain empty. */
function resolvedNightActions(state: WerewolfState, entry: import("./observation").WerewolfPublicEntry, audience: WerewolfAudience): WerewolfNightAction[] {
  if (audience !== "omniscient" || entry.kind !== "night") return [];
  const actions: WerewolfNightAction[] = [];
  if (entry.protectedId) {
    const protection = state.actions.find(action => action.action === "protect" && action.decision.kind === "target" && action.decision.targetId === entry.protectedId);
    if (!protection) throw new Error("Resolved protection has no accepted doctor action");
    actions.push({kind: "protect", actorId: protection.actorId, targetId: entry.protectedId});
  }
  if (entry.investigation) actions.push({kind: "investigate", actorId: entry.investigation.seerId, targetId: entry.investigation.targetId, isWolf: entry.investigation.isWolf});
  if (entry.attackTargetId) actions.push({kind: "hunt", wolfIds: state.aliveIds.filter(id => state.roles[id] === "werewolf"), targetId: entry.attackTargetId});
  return actions;
}
