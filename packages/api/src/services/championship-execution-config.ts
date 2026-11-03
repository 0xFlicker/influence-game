import { DEFAULT_CONVERSATION_POLICY, resolveFormatManifest } from "@influence/engine";
import { CURRENT_INFLUENCE_GAME_SCHEMA_VERSION } from "@influence/engine/influence-game-schema";
import { CURRENT_INFLUENCE_DECISION_CONTRACT_VERSION } from "@influence/engine/influence-decision-speech";
import { CURRENT_EMPOWER_REVOTE_VERSION } from "@influence/engine/empower-revote-rules";
import { werewolfConfig, type WerewolfConfig } from "@influence/engine/werewolf";
import type { RoleComposition } from "@influence/engine/championship";
export interface ChampionshipExecutionConfig { version: 1; influence: Record<string, unknown>; werewolf: WerewolfConfig }
export function freezeChampionshipExecutionConfig(roles: RoleComposition): ChampionshipExecutionConfig {
  return { version: 1,
    influence: { conversationPolicy: { ...DEFAULT_CONVERSATION_POLICY }, mingleSessionsPerRound: 2, maxRounds: 10,
      minPlayers: 8, maxPlayers: 8, serviceTier: "flex", personaPool: [], fillStrategy: "balanced", visibility: "public", slotType: "all_ai",
      audioMode: false, visualMode: false, visualFailurePolicy: "best_effort", formatManifest: resolveFormatManifest(undefined),
      empowerRevoteVersion: CURRENT_EMPOWER_REVOTE_VERSION, decisionContractVersion: CURRENT_INFLUENCE_DECISION_CONTRACT_VERSION,
      gameSchemaVersion: CURRENT_INFLUENCE_GAME_SCHEMA_VERSION },
    werewolf: werewolfConfig(roles.werewolf === 1 ? "one_wolf" : "two_wolves", 10,
      { playerCount: 8, wolves: roles.werewolf as 1 | 2, seer: roles.seer === 1, doctor: roles.doctor === 1 }),
  };
}
