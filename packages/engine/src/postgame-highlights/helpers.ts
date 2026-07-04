import type {
  PostgameAnalysisEvidenceRef,
  PostgameAnalysisProjection,
  PostgameTurningPoint,
} from "../postgame-analysis";
import type { PlayerRef } from "./types";

export function playerFromCriteria(
  point: PostgameTurningPoint,
  key: string,
): PlayerRef | null {
  const playerId = typeof point.criteria[key] === "string" ? point.criteria[key] : null;
  if (!playerId) return null;
  return point.players.find((player) => player.id === playerId) ?? { id: playerId, name: playerId };
}

export function playersFromCriteria(
  point: PostgameTurningPoint,
  key: string,
): PlayerRef[] {
  const ids = stringArray(point.criteria[key]);
  return ids.map((id) => point.players.find((player) => player.id === id) ?? { id, name: id });
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
}

export function formatNames(players: readonly PlayerRef[]): string {
  if (players.length === 0) return "The bloc";
  if (players.length === 1) return players[0]!.name;
  if (players.length === 2) return `${players[0]!.name} and ${players[1]!.name}`;
  return `${players.slice(0, -1).map((player) => player.name).join(", ")}, and ${players[players.length - 1]!.name}`;
}

export function finalistVotedToEliminate(
  analysis: PostgameAnalysisProjection,
  finalistId: string,
  eliminatedPlayerId: string,
): boolean {
  const finalistSummary = analysis.playerSummaries.find((summary) => summary.player.id === finalistId);
  if (!finalistSummary) return false;
  return finalistSummary.councilVotesCast.some((vote) => vote.target.id === eliminatedPlayerId)
    || finalistSummary.endgame.endgameVotesCast.some((vote) => vote.target.id === eliminatedPlayerId);
}

export function uniquePlayers(players: readonly PlayerRef[]): PlayerRef[] {
  const byId = new Map<string, PlayerRef>();
  for (const player of players) {
    byId.set(player.id, player);
  }
  return [...byId.values()];
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function sanitizedEventRefs(
  refs: readonly PostgameAnalysisEvidenceRef[],
): PostgameAnalysisEvidenceRef[] {
  return refs.map((ref) => ({
    eventType: ref.eventType,
    round: ref.round,
    sequence: ref.sequence,
    players: ref.players.map((player) => ({ id: player.id, name: player.name })),
  }));
}
