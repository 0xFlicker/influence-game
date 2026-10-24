/** Version dispatch preserves released history without translating old decisions. */
import * as legacy from "./legacy-rules";
import * as current from "./rules-v9";
import type { WerewolfConfig, WerewolfEvent, WerewolfEventData, WerewolfPlayer, WerewolfPreset, WerewolfSetup, WerewolfState, WerewolfRequest, WerewolfAcceptedAction } from "./types";
export { WEREWOLF_PRESETS, WEREWOLF_MAX_RECIPIENTS, WEREWOLF_PACK_ATTEMPTS, WEREWOLF_RULES as LEGACY_WEREWOLF_RULES, werewolfDayInitiative } from "./legacy-rules";
export { WEREWOLF_RULES_V9, WEREWOLF_RULES_V9 as WEREWOLF_RULES, DEFAULT_DISCUSSION_POLICY } from "./rules-v9";
export const legacyWerewolfConfig = legacy.werewolfConfig;
export class WerewolfRulesVersionError extends Error {
  constructor() { super("This game uses an unsupported Werewolf rules version. Supported versions are v7, v8, v9 and v10."); }
}
export function werewolfConfig(preset: WerewolfPreset, maxDays = 10, setup?: WerewolfSetup): WerewolfConfig {
  return { ...legacy.werewolfConfig(preset, maxDays, setup), rulesVersion: 10, discussionPolicy: { ...current.DEFAULT_DISCUSSION_POLICY } };
}
export function assignWerewolfRoles(players: readonly WerewolfPlayer[], config: WerewolfConfig, seed: string) {
  if (config.rulesVersion === 9 || config.rulesVersion === 10) return current.assignRoles(players, config, seed);
  return legacy.assignWerewolfRoles(players, config, seed);
}
export function startWerewolf(gameId: string, players: WerewolfPlayer[], config: WerewolfConfig, seed: string): WerewolfEvent {
  if (!gameId) throw new Error("Werewolf requires a game ID");
  return { type: "werewolf.started", gameId, sequence: 1, payload: { config, seed, players: structuredClone(players), roles: assignWerewolfRoles(players, config, seed) } };
}
export function nextWerewolfStep(state: WerewolfState) { return state.config.rulesVersion >= 9 ? current.nextStep(state) : legacy.nextWerewolfStep(state); }
export function werewolfActionPlans(state: WerewolfState) {
  if (state.config.rulesVersion < 9) return legacy.werewolfActionPlans(state);
  const step = current.nextStep(state);
  return step.kind === "action" ? [{ sequence: state.sequence + 1, request: step.request }] : [];
}
export function validateWerewolfAction(request: WerewolfRequest, action: WerewolfAcceptedAction) {
  if ("solo" in request && request.solo || ["conversation", "public_vote", "pack_propose"].includes(request.action)) current.validateAction(request, action);
  else legacy.validateWerewolfAction(request, action);
}
export function werewolfPackOrder(state: WerewolfState) { return state.config.rulesVersion >= 9 ? current.packOrder(state) : legacy.werewolfPackOrder(state); }
export function werewolfVoteMode(state: WerewolfState) { return state.config.rulesVersion >= 9 ? "majority" as const : legacy.werewolfVoteMode(state); }
export function werewolfTurnReminder(state: WerewolfState, actorId: string) { return state.config.rulesVersion >= 9 ? null : legacy.werewolfTurnReminder(state, actorId); }
export function applyWerewolfEvent(previous: WerewolfState | null, event: WerewolfEvent): WerewolfState {
  const version = previous?.config.rulesVersion ?? (event.type === "werewolf.started" ? event.payload.config.rulesVersion : null);
  if (version === 9 || version === 10) return current.applyEvent(previous, event);
  if (version !== 7 && version !== 8) throw new WerewolfRulesVersionError();
  return legacy.applyWerewolfEvent(previous, event);
}
export function replayWerewolf(events: readonly WerewolfEvent[]): WerewolfState {
  let state: WerewolfState | null = null;
  for (const event of events) state = applyWerewolfEvent(state, event);
  if (!state) throw new Error("Werewolf event history is empty");
  return state;
}
export function werewolfEvent(state: WerewolfState, data: WerewolfEventData): WerewolfEvent {
  const event = { ...data, gameId: state.gameId, sequence: state.sequence + 1 };
  applyWerewolfEvent(state, event);
  return event;
}
