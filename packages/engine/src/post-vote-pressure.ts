import type { Player, UUID } from "./types";

export type PostVotePressureStatus =
  | "empowered"
  | "current_at_risk"
  | "replacement_risk"
  | "safe";

export interface PostVotePressurePlayer {
  id: UUID;
  name: string;
  exposeScore: number;
  status: PostVotePressureStatus;
  shielded: boolean;
}

export interface PostVoteShieldScenario {
  shieldedPlayer: { id: UUID; name: string };
  resultingAtRisk: Array<{ id: UUID; name: string; exposeScore: number }>;
}

export interface PostVotePressureProjection {
  empowered: { id: UUID; name: string };
  exposePressure: Array<{ id: UUID; name: string; exposeScore: number }>;
  currentAtRisk: Array<{ id: UUID; name: string; exposeScore: number }>;
  replacementRisk: Array<{ id: UUID; name: string; exposeScore: number }>;
  shieldScenarios: PostVoteShieldScenario[];
  players: PostVotePressurePlayer[];
}

interface ProjectionInput {
  alivePlayers: Pick<Player, "id" | "name" | "shielded">[];
  exposeScores: Record<UUID, number>;
  empoweredId?: UUID | null;
}

function pressureEntry(
  player: Pick<Player, "id" | "name">,
  exposeScores: Record<UUID, number>,
): { id: UUID; name: string; exposeScore: number } {
  return {
    id: player.id,
    name: player.name,
    exposeScore: exposeScores[player.id] ?? 0,
  };
}

function sortByExposePressure<T extends { id: UUID; name: string }>(
  players: T[],
  exposeScores: Record<UUID, number>,
): T[] {
  return [...players].sort((a, b) => (exposeScores[b.id] ?? 0) - (exposeScores[a.id] ?? 0));
}

function likelyAtRiskAfterShield(
  alivePlayers: Pick<Player, "id" | "name" | "shielded">[],
  exposeScores: Record<UUID, number>,
  empoweredId: UUID,
  shieldedPlayerId?: UUID,
): Array<{ id: UUID; name: string; exposeScore: number }> {
  const eligible = sortByExposePressure(
    alivePlayers.filter(
      (player) =>
        player.id !== empoweredId &&
        player.id !== shieldedPlayerId &&
        !player.shielded,
    ),
    exposeScores,
  );

  return eligible.slice(0, 2).map((player) => pressureEntry(player, exposeScores));
}

export function buildPostVotePressureProjection(
  input: ProjectionInput,
): PostVotePressureProjection | null {
  const empowered = input.alivePlayers.find((player) => player.id === input.empoweredId);
  if (!empowered) return null;

  const exposePressure = sortByExposePressure(input.alivePlayers, input.exposeScores)
    .map((player) => pressureEntry(player, input.exposeScores));
  const currentAtRisk = likelyAtRiskAfterShield(
    input.alivePlayers,
    input.exposeScores,
    empowered.id,
  );
  const currentAtRiskIds = new Set(currentAtRisk.map((player) => player.id));

  const shieldScenarios: PostVoteShieldScenario[] = currentAtRisk.map((player) => {
    const resultingAtRisk = likelyAtRiskAfterShield(
      input.alivePlayers,
      input.exposeScores,
      empowered.id,
      player.id,
    );
    return {
      shieldedPlayer: { id: player.id, name: player.name },
      resultingAtRisk,
    };
  });

  const replacementRiskIds = new Set<UUID>();
  for (const scenario of shieldScenarios) {
    for (const player of scenario.resultingAtRisk) {
      if (!currentAtRiskIds.has(player.id)) {
        replacementRiskIds.add(player.id);
      }
    }
  }

  const replacementRisk = exposePressure
    .filter((player) => replacementRiskIds.has(player.id))
    .map((player) => ({ ...player }));

  return {
    empowered: { id: empowered.id, name: empowered.name },
    exposePressure,
    currentAtRisk,
    replacementRisk,
    shieldScenarios,
    players: input.alivePlayers.map((player) => {
      let status: PostVotePressureStatus = "safe";
      if (player.id === empowered.id) {
        status = "empowered";
      } else if (currentAtRiskIds.has(player.id)) {
        status = "current_at_risk";
      } else if (replacementRiskIds.has(player.id)) {
        status = "replacement_risk";
      }

      return {
        id: player.id,
        name: player.name,
        exposeScore: input.exposeScores[player.id] ?? 0,
        status,
        shielded: player.shielded,
      };
    }),
  };
}

export function formatPostVotePressureSummary(
  pressure: PostVotePressureProjection,
): string {
  const currentAtRisk = pressure.currentAtRisk
    .map((player) => `${player.name} (${player.exposeScore})`)
    .join(", ") || "none";
  const replacementRisk = pressure.replacementRisk
    .map((player) => `${player.name} (${player.exposeScore})`)
    .join(", ") || "none";

  return `Post-vote pressure: ${pressure.empowered.name} is empowered. Current at-risk: ${currentAtRisk}. Replacement risk if a shield is granted: ${replacementRisk}.`;
}
