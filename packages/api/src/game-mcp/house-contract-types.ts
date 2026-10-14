import type { HouseFollowUp } from "./house-follow-ups.js";
import type { readHouseGameRetrospective } from "../services/house-game-retrospective.js";
import type { resumeHouseGameRetrospective } from "../services/house-retrospective-recovery.js";
export type HouseRetrospectiveRead = HouseEnvelope<Awaited<ReturnType<typeof readHouseGameRetrospective>> | HouseFailure>;
export type HouseRetrospectiveResume = HouseEnvelope<Awaited<ReturnType<typeof resumeHouseGameRetrospective>> | HouseFailure>;
import type {
  readHouseGame,
  readHouseGameThinking,
  readHouseInspectionResults,
} from "../services/house-game-inspection.js";
import type { listHouseGames } from "../services/house-game-access.js";
import type {
  getGameMcpRules,
  searchGameMcpRules,
  listGameMcpArchetypes,
} from "./rules.js";
import type { HouseCutsResponse } from "@influence/engine/house-cuts/publication";
export type HouseCutsRead = HouseEnvelope<HouseCutsResponse | HouseFailure>;
export interface HouseFailure {
  schemaVersion: 1;
  status:
    | "not_accessible"
    | "invalid_input"
    | "invalid_cursor"
    | "unsupported_game_kind"
    | "not_started"
    | "not_completed"
    | "unavailable"
    | "entry_too_large"
    | "conflict"
    | "admission_closed";
  message: string;
}
type HouseEnvelope<T> = T & { followUps?: HouseFollowUp[] };
export type HouseGameRead = HouseEnvelope<
  Awaited<ReturnType<typeof readHouseGame>> | HouseFailure
>;
export type HouseThinkingRead = HouseEnvelope<
  Awaited<ReturnType<typeof readHouseGameThinking>> | HouseFailure
>;
export type HouseResultsRead = HouseEnvelope<
  Awaited<ReturnType<typeof readHouseInspectionResults>> | HouseFailure
>;
export type HouseCatalogRead = HouseEnvelope<
  Awaited<ReturnType<typeof listHouseGames>> | HouseFailure
>;
export type HouseRulesRead = HouseEnvelope<
  ReturnType<typeof getGameMcpRules> | HouseFailure
>;
export type HouseRulesSearchRead = HouseEnvelope<
  ReturnType<typeof searchGameMcpRules> | HouseFailure
>;
export type HouseArchetypesRead = HouseEnvelope<
  ReturnType<typeof listGameMcpArchetypes> | HouseFailure
>;
