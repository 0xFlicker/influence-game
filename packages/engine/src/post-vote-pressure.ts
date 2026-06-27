import type { Player, UUID } from "./types";
import {
  resolveInitialExposureBench,
  resolveShieldReplacement,
  type InitialExposureBenchResolution,
} from "./exposure-bench";

export type PostVotePressureStatus =
  | "empowered"
  | "locked_at_risk"
  | "empowered_selected"
  | "selectable_exposed"
  | "current_at_risk"
  | "replacement_risk"
  | "fallback_risk"
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
  initialResolution?: InitialExposureBenchResolution | null;
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
  return [...players].sort(
    (a, b) =>
      (exposeScores[b.id] ?? 0) - (exposeScores[a.id] ?? 0) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

export function buildPostVotePressureProjection(
  input: ProjectionInput,
): PostVotePressureProjection | null {
  const empowered = input.alivePlayers.find((player) => player.id === input.empoweredId);
  if (!empowered) return null;

  const exposePressure = sortByExposePressure(input.alivePlayers, input.exposeScores)
    .map((player) => pressureEntry(player, input.exposeScores));
  const initialResolution = input.initialResolution ?? resolveInitialExposureBench({
    alivePlayers: input.alivePlayers.map((player) => ({
      id: player.id,
      name: player.name,
      shielded: player.shielded,
    })),
    exposeScores: input.exposeScores,
    empoweredId: empowered.id,
  });
  const currentAtRisk = (initialResolution.candidates ?? [])
    .map((id) => input.alivePlayers.find((player) => player.id === id))
    .filter((player): player is Pick<Player, "id" | "name" | "shielded"> => Boolean(player))
    .map((player) => pressureEntry(player, input.exposeScores));
  const currentAtRiskIds = new Set(currentAtRisk.map((player) => player.id));
  const lockedAtRiskIds = new Set(initialResolution.lockedCandidates.filter((id) => currentAtRiskIds.has(id)));
  const empoweredSelectedIds = new Set(initialResolution.selectedCandidateIds.filter((id) => currentAtRiskIds.has(id)));
  const selectableExposedIds = new Set(
    initialResolution.choice.eligibleCandidateIds.filter(
      (id) => !empoweredSelectedIds.has(id) && (input.exposeScores[id] ?? 0) > 0,
    ),
  );
  const fallbackRiskIds = new Set<UUID>(
    initialResolution.choice.eligibleCandidateIds.filter(
      (id) => !empoweredSelectedIds.has(id) && (input.exposeScores[id] ?? 0) === 0,
    ),
  );

  const shieldScenarios: PostVoteShieldScenario[] = currentAtRisk.map((player) => {
    const replacement = resolveShieldReplacement({
      initialResolution,
      protectedCandidateId: player.id,
    });
    const resultingAtRisk = (replacement.candidates ?? [])
      .map((id) => input.alivePlayers.find((alive) => alive.id === id))
      .filter((alive): alive is Pick<Player, "id" | "name" | "shielded"> => Boolean(alive))
      .map((alive) => pressureEntry(alive, input.exposeScores));
    return {
      shieldedPlayer: { id: player.id, name: player.name },
      resultingAtRisk,
    };
  });

  const replacementRiskIds = new Set<UUID>();
  for (const scenario of shieldScenarios) {
    for (const player of scenario.resultingAtRisk) {
      if (!currentAtRiskIds.has(player.id)) {
        if (player.exposeScore > 0) {
          replacementRiskIds.add(player.id);
        } else {
          fallbackRiskIds.add(player.id);
        }
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
      } else if (replacementRiskIds.has(player.id)) {
        status = "replacement_risk";
      } else if (lockedAtRiskIds.has(player.id)) {
        status = "locked_at_risk";
      } else if (empoweredSelectedIds.has(player.id)) {
        status = "empowered_selected";
      } else if (selectableExposedIds.has(player.id)) {
        status = "selectable_exposed";
      } else if (fallbackRiskIds.has(player.id)) {
        status = "fallback_risk";
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
  const councilCandidates = pressure.currentAtRisk
    .map((player) => `${player.name} (${player.exposeScore})`)
    .join(", ") || "none";
  const atRiskIfShieldGranted = pressure.replacementRisk
    .map((player) => `${player.name} (${player.exposeScore})`)
    .join(", ") || "none";

  return `Post-vote pressure: ${pressure.empowered.name} is empowered. Council candidates: ${councilCandidates}. At-risk if a shield is granted: ${atRiskIfShieldGranted}.`;
}
