import {werewolfStepDurations} from "./watch-timing";
import {WOLF_TRANSFORM_MS, WOLF_STAGGER_MS} from "../visual-speech";
import { werewolfVisualStaging } from "./visual-staging";
import { applyWerewolfEvent } from "./rules";
import { projectWerewolfEntry, projectWerewolfSnapshot, type WerewolfAudience } from "./observation";
import type { WerewolfEvent, WerewolfState } from "./types";
import {werewolfNightSteps, isWerewolfPlayable, type WerewolfNightAction, type WerewolfWatchIdentity, type WerewolfWatchMoment, type WerewolfWatchIndex, type WerewolfWatchWindow} from "./watch-contract";

/** Server-only staging coordinates never appear in the browser DTO. */
export type WerewolfWatchStaging = ReturnType<typeof werewolfVisualStaging>;
/** Explicit published presentation, never an input to the canonical reducer. */
export type WerewolfRetrospectivePresentation = Map<number, {id: string; actorId: string; speech: string}>;
export function projectWerewolfWatch(events: readonly WerewolfEvent[], audience: WerewolfAudience, fromCursor = 1, limit = 32, hasWolfForms?: (staging: WerewolfWatchStaging, cursor: number, ids: string[]) => boolean, retakes?: WerewolfRetrospectivePresentation) {
  if (!["mystery", "omniscient"].includes(audience) || !Number.isSafeInteger(fromCursor) || fromCursor < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new Error("Invalid watch window");
  return projectWatchHistory(events, audience, fromCursor, limit, hasWolfForms, retakes);
}

/** Producer-only complete projection of an already bounded canonical prefix.
 * The caller materializes permitted media and paginates before serialization. */
export function projectWerewolfProductionWatch(events: readonly WerewolfEvent[], audience: WerewolfAudience, hasWolfForms?: (staging: WerewolfWatchStaging, cursor: number, ids: string[]) => boolean, retakes?: WerewolfRetrospectivePresentation) {
  if (audience !== "mystery" && audience !== "omniscient") throw new Error("Invalid Werewolf audience");
  return projectWatchHistory(events, audience, 1, Number.MAX_SAFE_INTEGER, hasWolfForms, retakes);
}

function projectWatchHistory(events: readonly WerewolfEvent[], audience: WerewolfAudience, fromCursor: number, limit: number, hasWolfForms?: (staging: WerewolfWatchStaging, cursor: number, ids: string[]) => boolean, retakes?: WerewolfRetrospectivePresentation) {
  let state: WerewolfState | null = null, cursor = 0;
  const moments: Array<WerewolfWatchMoment & { staging: WerewolfWatchStaging }> = [];
  const navigation: WerewolfWatchIndex[] = [];
  const playback: WerewolfWatchWindow["playback"] = [];
  let dayBallots: NonNullable<WerewolfWatchMoment["dayBallots"]> = [];
  let ballotDay = -1;
  const introducedWolves = new Set<string>();
  let sceneId = "introduction", chapterId = "introduction", packAttempt = 1;
  for (const frame of walkWerewolfHistory(events, audience)) {
    const { event, before } = frame;
    let entry = frame.entry;
    const retake = retakes?.get(event.sequence);
    if (retake) {
      if (event.type !== "werewolf.retrospective_statement_recorded" || entry?.kind !== "speech" || entry.purpose !== "retrospective" || entry.actorId !== retake.actorId) throw new Error("Retake must match its original retrospective speaker");
      entry = {...entry, text: retake.speech};
    }
    state = frame.state;
    cursor = frame.cursor;
    if (entry) {
      chapterId = entry.kind === "result" ? "ending" : entry.day === 0 ? "introduction" : `cycle:${entry.day}`;
      if (entry.kind === "phase") {
        if (entry.phase === "introduction") { sceneId = "introduction"; chapterId = "introduction"; }
        if (entry.phase === "night") { introducedWolves.clear(); packAttempt = 1; sceneId = `cycle:${entry.day}:pack:1`; }
      } else if (entry.kind === "discussion") sceneId = `${chapterId}:thread:${entry.contribution.thread}`;
      else if (entry.kind === "conversation") sceneId = `${chapterId}:conversation`;
      else if (entry.kind === "ballot") sceneId = `${chapterId}:ballot`;
      else if (entry.kind === "proposal") sceneId = `${chapterId}:pack:proposal`;
      else if (entry.kind === "vote") sceneId = `${chapterId}:checkpoint:${entry.result.thread}`;
      else if (entry.kind === "speech" && entry.audience === "pack") sceneId = `${chapterId}:pack:${packAttempt}`;
      else if (entry.kind === "pack_vote") { sceneId = `${chapterId}:pack:${entry.result.attempt}`; packAttempt = entry.result.attempt + 1; }
      else if (entry.kind === "night") sceneId = `${chapterId}:dawn`;
      else if (entry.kind === "result") sceneId = "ending";
      else if (entry.kind === "speech") { chapterId = entry.purpose === "retrospective" ? "retrospective" : "introduction"; sceneId = chapterId; }
      const staging = before ?? state;
      const nightActions = resolvedNightActions(staging, entry, audience);
      const nightSteps = werewolfNightSteps(nightActions);
      if (entry.kind === "ballot") {
        if (ballotDay !== entry.day) {dayBallots = []; ballotDay = entry.day;}
        dayBallots.push({voterId: entry.actorId, targetId: entry.targetId, unavailable: entry.unavailable});
      }
      if (isWerewolfPlayable(entry) && navigation.at(-1)?.sceneId !== sceneId) {
        const label = entry.kind === "discussion" ? `Day ${entry.day} · Thread ${entry.contribution.thread}` : entry.kind === "conversation" ? `Day ${entry.day} · Conversation` : entry.kind === "ballot" ? `Day ${entry.day} · Public ballot` : entry.kind === "proposal" ? `Night ${entry.day} · Pack proposal` : entry.kind === "vote" ? `Day ${entry.day} · Vote` : chapterId === "introduction" ? "Introductions" : chapterId === "retrospective" ? "Retrospective" : chapterId === "ending" ? "Ending" : `Cycle ${entry.day} · ${entry.kind === "night" ? "Dawn" : "Pack"}`;
        for (const [step, {action}] of nightSteps.entries()) {
          if (step > 0 && nightSteps[step - 1]!.action === action) continue;
          const roleLabel = action.kind === "protect" ? "Doctor" : action.kind === "investigate" ? "Seer" : "Hunt";
          navigation.push({cursor, step, chapterId, sceneId: `${chapterId}:${action.kind}`, label: `Night ${entry.day} · ${roleLabel}`});
        }
        navigation.push({ cursor, step: nightSteps.length, chapterId, sceneId, label });
      }
      const firstPackSpeech = (entry.kind === "proposal" || entry.kind === "speech" && entry.audience === "pack") && isWerewolfPlayable(entry);
      const hunt = nightActions.find(action => action.kind === "hunt");
      const appearingWolves = audience === "omniscient" ? firstPackSpeech ? staging.aliveIds.filter(id => staging.roles[id] === "werewolf") : hunt?.wolfIds ?? [] : [];
      const transformWolfIds = appearingWolves.filter(id => !introducedWolves.has(id));
      for (const id of transformWolfIds) introducedWolves.add(id);
      const visualStaging = werewolfVisualStaging(staging, event, entry);
      if (isWerewolfPlayable(entry)) {
        const durationsMs = werewolfStepDurations(entry, state.players, nightActions, state.config.rulesVersion);
        if (transformWolfIds.length && hasWolfForms?.(visualStaging, cursor, transformWolfIds)) {
          const step = nightActions.length ? nightSteps.findIndex(({action}) => action.kind === "hunt") : 0;
          if (step >= 0) durationsMs[step]! += WOLF_TRANSFORM_MS + (transformWolfIds.length - 1) * WOLF_STAGGER_MS;
        }
        const key = `${state.gameId}:${audience}:${cursor}`;
        const rank = (ballot: {targetId: string | null; unavailable: boolean}) => ballot.targetId ? 0 : ballot.unavailable ? 1 : 2;
        const keys = entry.kind === "vote" && state.config.rulesVersion < 9 && entry.result.ballots.length
          ? [...[...entry.result.ballots].sort((a, b) => rank(a) - rank(b)).map(ballot => `${key}:ballot:${ballot.voterId}`), `${key}:tally`, key]
          : entry.kind === "vote" && state.config.rulesVersion >= 9 && entry.result.ballots.length ? [`${key}:tally`, key]
          : [...nightSteps.map(({action, decision}) => `${key}:${action.kind}${decision ? ":decision" : ""}`), key];
        playback.push({cursor, steps: durationsMs.length, durationsMs, keys});
      }
      if (cursor < fromCursor || cursor >= fromCursor + limit) continue;
      moments.push({ cursor, entry, ...(entry.kind === "ballot" ? {dayBallots: dayBallots.map(ballot => ({...ballot}))} : {}), ...(transformWolfIds.length ? { transformWolfIds } : {}), snapshot: projectWerewolfSnapshot(state, audience, cursor), chapterId, sceneId, mediaKey: null,
        ...(retake ? {retrospectiveRetakeId: retake.id} : {}),
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

/** Producer-only join to canonical provenance. Keep this separate from public
 * watch DTOs: a private sequence gap is never a spectator position or tag ID. */
export function projectWerewolfProductionProvenance(events: readonly WerewolfEvent[], audience: WerewolfAudience, throughCursor?: number) {
  if (audience !== "mystery" && audience !== "omniscient") throw new Error("Invalid Werewolf audience");
  if (throughCursor !== undefined && (!Number.isSafeInteger(throughCursor) || throughCursor < 1)) throw new Error("Invalid production source prefix");
  const provenance: Array<{ cursor: number; eventSequence: number }> = [];
  for (const frame of walkWerewolfHistory(events, audience)) {
    if (frame.entry) {
      provenance.push({ cursor: frame.cursor, eventSequence: frame.event.sequence });
      if (frame.cursor === throughCursor) break;
    }
  }
  if (throughCursor !== undefined && provenance.at(-1)?.cursor !== throughCursor) throw new Error("Unavailable production source prefix");
  return provenance;
}

/** One action list owns both scrub counts and scene expansion; public night entries remain empty. */
function resolvedNightActions(state: WerewolfState, entry: import("./observation").WerewolfPublicEntry, audience: WerewolfAudience): WerewolfNightAction[] {
  if (audience !== "omniscient" || entry.kind !== "night") return [];
  const actions: WerewolfNightAction[] = [];
  if (entry.protectedId) {
    const protection = state.actions.find(action => action.action === "protect" && (action.decision.kind === "target" || action.decision.kind === "solo_target") && action.decision.targetId === entry.protectedId);
    if (!protection) throw new Error("Resolved protection has no accepted doctor action");
    actions.push({kind: "protect", actorId: protection.actorId, targetId: entry.protectedId, ...nightSpeech(protection.decision)});
  }
  if (entry.investigation) {
    const investigation = state.actions.find(action => action.action === "investigate" && action.actorId === entry.investigation!.seerId);
    if (!investigation) throw new Error("Resolved investigation has no accepted seer action");
    actions.push({kind: "investigate", actorId: entry.investigation.seerId, targetId: entry.investigation.targetId, isWolf: entry.investigation.isWolf, ...nightSpeech(investigation.decision)});
  }
  if (entry.attackTargetId) actions.push({kind: "hunt", wolfIds: state.aliveIds.filter(id => state.roles[id] === "werewolf"), targetId: entry.attackTargetId});
  return actions;
}

function nightSpeech(decision: import("./types").WerewolfDecision) {
  return decision.kind === "solo_target" && decision.text !== null ? {speech: {text: decision.text, cue: decision.cue}} : {};
}
