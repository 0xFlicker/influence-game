import type { HouseFollowUp } from "./house-follow-ups.js";
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
    | "entry_too_large";
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
