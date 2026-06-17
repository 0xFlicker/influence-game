import type { UUID } from "./types";

export interface ExposureBenchPlayer {
  id: UUID;
  name: string;
  shielded: boolean;
}

export interface ExposureBenchEntry {
  id: UUID;
  name: string;
  exposeScore: number;
}

export type InitialExposureBenchMode =
  | "all_player_fallback"
  | "one_locked_one_choice"
  | "exposure_locked"
  | "higher_votes_choice";

export type ShieldReplacementMode =
  | "not_needed"
  | "bench_replacement_locked"
  | "bench_replacement_choice"
  | "all_player_fallback_replacement";

export type ExposureBenchFallbackReason =
  | "bench_too_small"
  | "bench_exhausted"
  | "missing_selection"
  | "invalid_selection";

export interface ExposureBenchChoice {
  requiredCount: number;
  eligibleCandidateIds: UUID[];
  reason:
    | "none"
    | "zero_bench"
    | "one_bench"
    | "tied_exposure_tier"
    | "shield_replacement_tier"
    | "shield_replacement_fallback";
}

interface BaseResolution {
  alivePlayers: ExposureBenchPlayer[];
  empoweredId: UUID;
  exposeScores: Record<UUID, number>;
  exposureBench: ExposureBenchEntry[];
  rawExposePressure: ExposureBenchEntry[];
  lockedCandidates: UUID[];
  choice: ExposureBenchChoice;
  selectedCandidateIds: UUID[];
  candidates: [UUID, UUID] | null;
  fallbackApplied: boolean;
  fallbackReason: ExposureBenchFallbackReason | null;
}

export interface InitialExposureBenchResolution extends BaseResolution {
  mode: InitialExposureBenchMode;
}

export interface ShieldReplacementResolution extends BaseResolution {
  mode: ShieldReplacementMode;
  protectedCandidateId: UUID;
  remainingCandidateIds: UUID[];
}

interface ResolveInitialInput {
  alivePlayers: ExposureBenchPlayer[];
  empoweredId: UUID;
  exposeScores: Record<UUID, number>;
  selectedCandidateIds?: UUID[];
}

interface ResolveShieldReplacementInput {
  initialResolution: InitialExposureBenchResolution;
  protectedCandidateId: UUID;
  selectedCandidateIds?: UUID[];
}

function scoreOf(scores: Record<UUID, number>, id: UUID): number {
  return scores[id] ?? 0;
}

function byScoreThenName(scores: Record<UUID, number>) {
  return (a: ExposureBenchPlayer | ExposureBenchEntry, b: ExposureBenchPlayer | ExposureBenchEntry): number =>
    scoreOf(scores, b.id) - scoreOf(scores, a.id) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id);
}

function pressureEntry(player: ExposureBenchPlayer, exposeScores: Record<UUID, number>): ExposureBenchEntry {
  return {
    id: player.id,
    name: player.name,
    exposeScore: scoreOf(exposeScores, player.id),
  };
}

function buildRawExposePressure(
  alivePlayers: ExposureBenchPlayer[],
  exposeScores: Record<UUID, number>,
): ExposureBenchEntry[] {
  return [...alivePlayers]
    .sort(byScoreThenName(exposeScores))
    .map((player) => pressureEntry(player, exposeScores));
}

function buildExposureBench(
  alivePlayers: ExposureBenchPlayer[],
  empoweredId: UUID,
  exposeScores: Record<UUID, number>,
): ExposureBenchEntry[] {
  return alivePlayers
    .filter((player) => player.id !== empoweredId && !player.shielded && scoreOf(exposeScores, player.id) > 0)
    .sort(byScoreThenName(exposeScores))
    .map((player) => pressureEntry(player, exposeScores));
}

function eligibleLiveCandidateIds(
  alivePlayers: ExposureBenchPlayer[],
  empoweredId: UUID,
  excludeIds: UUID[] = [],
): UUID[] {
  const excluded = new Set([empoweredId, ...excludeIds]);
  return alivePlayers
    .filter((player) => !player.shielded && !excluded.has(player.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((player) => player.id);
}

function tierIds(entries: ExposureBenchEntry[], exposeScores: Record<UUID, number>, score: number): UUID[] {
  return entries
    .filter((entry) => scoreOf(exposeScores, entry.id) === score)
    .sort(byScoreThenName(exposeScores))
    .map((entry) => entry.id);
}

function resolveChoice(
  eligibleCandidateIds: UUID[],
  requiredCount: number,
  selectedCandidateIds: UUID[] | undefined,
): {
  selectedCandidateIds: UUID[];
  fallbackApplied: boolean;
  fallbackReason: ExposureBenchFallbackReason | null;
} {
  if (requiredCount === 0) {
    return { selectedCandidateIds: [], fallbackApplied: false, fallbackReason: null };
  }

  const eligibleSet = new Set(eligibleCandidateIds);
  const selected: UUID[] = [];
  let invalidSelection = false;

  for (const id of selectedCandidateIds ?? []) {
    if (!eligibleSet.has(id) || selected.includes(id)) {
      invalidSelection = true;
      continue;
    }
    selected.push(id);
    if (selected.length === requiredCount) break;
  }

  for (const id of eligibleCandidateIds) {
    if (selected.length === requiredCount) break;
    if (!selected.includes(id)) {
      selected.push(id);
    }
  }

  const missingSelection = !selectedCandidateIds || selectedCandidateIds.length < requiredCount;
  return {
    selectedCandidateIds: selected,
    fallbackApplied: invalidSelection || missingSelection,
    fallbackReason: invalidSelection ? "invalid_selection" : missingSelection ? "missing_selection" : null,
  };
}

function pairFrom(ids: UUID[]): [UUID, UUID] | null {
  const first = ids[0];
  const second = ids[1];
  return first && second ? [first, second] : null;
}

function unresolvedInitialChoice(
  exposureBench: ExposureBenchEntry[],
  exposeScores: Record<UUID, number>,
): { lockedCandidates: UUID[]; choiceIds: UUID[]; requiredCount: number } {
  const lockedCandidates: UUID[] = [];
  let remainingSlots = 2;
  let index = 0;

  while (index < exposureBench.length && remainingSlots > 0) {
    const score = exposureBench[index]!.exposeScore;
    const currentTier = tierIds(exposureBench.slice(index), exposeScores, score);
    if (currentTier.length <= remainingSlots) {
      lockedCandidates.push(...currentTier);
      remainingSlots -= currentTier.length;
      index += currentTier.length;
      continue;
    }

    return {
      lockedCandidates,
      choiceIds: currentTier,
      requiredCount: remainingSlots,
    };
  }

  return {
    lockedCandidates,
    choiceIds: [],
    requiredCount: 0,
  };
}

export function resolveInitialExposureBench(input: ResolveInitialInput): InitialExposureBenchResolution {
  const rawExposePressure = buildRawExposePressure(input.alivePlayers, input.exposeScores);
  const exposureBench = buildExposureBench(input.alivePlayers, input.empoweredId, input.exposeScores);

  if (exposureBench.length === 0) {
    const eligibleCandidateIds = eligibleLiveCandidateIds(input.alivePlayers, input.empoweredId);
    const choice = resolveChoice(eligibleCandidateIds, 2, input.selectedCandidateIds);
    return {
      alivePlayers: input.alivePlayers,
      empoweredId: input.empoweredId,
      exposeScores: input.exposeScores,
      exposureBench,
      rawExposePressure,
      lockedCandidates: [],
      choice: { requiredCount: 2, eligibleCandidateIds, reason: "zero_bench" },
      selectedCandidateIds: choice.selectedCandidateIds,
      candidates: pairFrom(choice.selectedCandidateIds),
      fallbackApplied: choice.fallbackApplied,
      fallbackReason: choice.fallbackReason === "invalid_selection" ? choice.fallbackReason : "bench_too_small",
      mode: "all_player_fallback",
    };
  }

  if (exposureBench.length === 1) {
    const locked = [exposureBench[0]!.id];
    const eligibleCandidateIds = eligibleLiveCandidateIds(input.alivePlayers, input.empoweredId, locked);
    const choice = resolveChoice(eligibleCandidateIds, 1, input.selectedCandidateIds);
    return {
      alivePlayers: input.alivePlayers,
      empoweredId: input.empoweredId,
      exposeScores: input.exposeScores,
      exposureBench,
      rawExposePressure,
      lockedCandidates: locked,
      choice: { requiredCount: 1, eligibleCandidateIds, reason: "one_bench" },
      selectedCandidateIds: choice.selectedCandidateIds,
      candidates: pairFrom([...locked, ...choice.selectedCandidateIds]),
      fallbackApplied: choice.fallbackApplied,
      fallbackReason: choice.fallbackReason,
      mode: "one_locked_one_choice",
    };
  }

  if (exposureBench.length === 2) {
    const candidates: [UUID, UUID] = [exposureBench[0]!.id, exposureBench[1]!.id];
    return {
      alivePlayers: input.alivePlayers,
      empoweredId: input.empoweredId,
      exposeScores: input.exposeScores,
      exposureBench,
      rawExposePressure,
      lockedCandidates: candidates,
      choice: { requiredCount: 0, eligibleCandidateIds: [], reason: "none" },
      selectedCandidateIds: [],
      candidates,
      fallbackApplied: false,
      fallbackReason: null,
      mode: "exposure_locked",
    };
  }

  const unresolved = unresolvedInitialChoice(exposureBench, input.exposeScores);
  const choice = resolveChoice(unresolved.choiceIds, unresolved.requiredCount, input.selectedCandidateIds);
  return {
    alivePlayers: input.alivePlayers,
    empoweredId: input.empoweredId,
    exposeScores: input.exposeScores,
    exposureBench,
    rawExposePressure,
    lockedCandidates: unresolved.lockedCandidates,
    choice: {
      requiredCount: unresolved.requiredCount,
      eligibleCandidateIds: unresolved.choiceIds,
      reason: unresolved.requiredCount > 0 ? "tied_exposure_tier" : "none",
    },
    selectedCandidateIds: choice.selectedCandidateIds,
    candidates: pairFrom([...unresolved.lockedCandidates, ...choice.selectedCandidateIds]),
    fallbackApplied: choice.fallbackApplied,
    fallbackReason: choice.fallbackReason,
    mode: unresolved.requiredCount > 0 ? "higher_votes_choice" : "exposure_locked",
  };
}

export function resolveShieldReplacement(input: ResolveShieldReplacementInput): ShieldReplacementResolution {
  const { initialResolution, protectedCandidateId } = input;
  const remainingCandidateIds = initialResolution.candidates?.filter((id) => id !== protectedCandidateId) ?? [];

  if (!initialResolution.candidates || remainingCandidateIds.length === initialResolution.candidates.length) {
    return {
      ...initialResolution,
      mode: "not_needed",
      protectedCandidateId,
      remainingCandidateIds,
    };
  }

  const benchEligibleIds = new Set(initialResolution.exposureBench.map((entry) => entry.id));
  const excluded = new Set([...remainingCandidateIds, protectedCandidateId, initialResolution.empoweredId]);
  const remainingBench = initialResolution.exposureBench.filter(
    (entry) => benchEligibleIds.has(entry.id) && !excluded.has(entry.id),
  );

  if (remainingBench.length > 0) {
    const topScore = remainingBench[0]!.exposeScore;
    const eligibleCandidateIds = remainingBench
      .filter((entry) => entry.exposeScore === topScore)
      .sort(byScoreThenName(initialResolution.exposeScores))
      .map((entry) => entry.id);
    const choice = resolveChoice(eligibleCandidateIds, 1, input.selectedCandidateIds);
    const selected = choice.selectedCandidateIds[0];
    return {
      ...initialResolution,
      mode: eligibleCandidateIds.length === 1 ? "bench_replacement_locked" : "bench_replacement_choice",
      protectedCandidateId,
      remainingCandidateIds,
      lockedCandidates: remainingCandidateIds,
      choice: { requiredCount: 1, eligibleCandidateIds, reason: "shield_replacement_tier" },
      selectedCandidateIds: selected ? [selected] : [],
      candidates: selected ? pairFrom([...remainingCandidateIds, selected]) : null,
      fallbackApplied: choice.fallbackApplied,
      fallbackReason: choice.fallbackReason,
    };
  }

  const eligibleCandidateIds = eligibleLiveCandidateIds(
    initialResolution.alivePlayers,
    initialResolution.empoweredId,
    [...remainingCandidateIds, protectedCandidateId],
  );
  const choice = resolveChoice(eligibleCandidateIds, 1, input.selectedCandidateIds);
  const selected = choice.selectedCandidateIds[0];

  return {
    ...initialResolution,
    mode: "all_player_fallback_replacement",
    protectedCandidateId,
    remainingCandidateIds,
    lockedCandidates: remainingCandidateIds,
    choice: { requiredCount: 1, eligibleCandidateIds, reason: "shield_replacement_fallback" },
    selectedCandidateIds: selected ? [selected] : [],
    candidates: selected ? pairFrom([...remainingCandidateIds, selected]) : null,
    fallbackApplied: choice.fallbackApplied,
    fallbackReason: choice.fallbackReason ?? "bench_exhausted",
  };
}
