import type {
  UUID,
  RoomAllocation,
  GameConfig,
  WhisperRoomAllocationMode,
  WhisperRoomPlayerRef,
  WhisperRoomRequestRecord,
  WhisperSessionDiagnostics,
} from "../types";
import { Phase } from "../types";
import type { PhaseActor, PhaseRunnerContext } from "./phase-runner-context";

export interface BrokenWhisperRoomPreference {
  playerId: UUID;
  requestedPartnerId: UUID;
}

export interface RoomAllocationOptions {
  allocationMode?: WhisperRoomAllocationMode;
  avoidRepeatPairs?: boolean;
  priorRooms?: RoomAllocation[];
  previousSessionRooms?: RoomAllocation[];
  previousSessionExcludedPlayerIds?: UUID[];
  priorExcludedPlayerIds?: UUID[];
  exclusionCounts?: Map<UUID, number>;
  sessionIndex?: number;
  rawRequests?: Map<UUID, UUID | null>;
}

interface CandidatePair {
  playerA: UUID;
  playerB: UUID;
  key: string;
}

interface AllocationStats {
  priorPairCounts: Map<string, number>;
  previousPairKeys: Set<string>;
  previousExcludedPlayerIds: Set<UUID>;
  exclusionCounts: Map<UUID, number>;
  participationCounts: Map<UUID, number>;
  medianParticipation: number;
  minExclusions: number;
  orderIndex: Map<UUID, number>;
}

/**
 * Compute the number of whisper rooms for the current round.
 * Formula: max(1, floor(alivePlayers / 2) - 1)
 */
export function computeRoomCount(aliveCount: number): number {
  return Math.max(1, Math.floor(aliveCount / 2) - 1);
}

function pairKey(playerA: UUID, playerB: UUID): string {
  return [playerA, playerB].sort().join(":");
}

function buildPriorPairKeys(priorRooms: RoomAllocation[]): Set<string> {
  return new Set(priorRooms.map((room) => pairKey(room.playerA, room.playerB)));
}

function buildPriorPairCounts(priorRooms: RoomAllocation[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const room of priorRooms) {
    const key = pairKey(room.playerA, room.playerB);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function getWhisperAllocationMode(config: GameConfig): WhisperRoomAllocationMode {
  return config.whisperRoomAllocationMode ??
    (config.experimentalAntiRepeatWhisperRooms ? "diversity-weighted" : "request-order");
}

function getRecordedPriorRooms(ctx: PhaseRunnerContext, currentRoundRooms: RoomAllocation[]): RoomAllocation[] {
  const priorRooms: RoomAllocation[] = [...currentRoundRooms];
  for (let priorRound = 1; priorRound < ctx.gameState.round; priorRound++) {
    const allocation = ctx.gameState.getRoomAllocations(priorRound);
    if (allocation) priorRooms.push(...allocation.rooms);
  }
  return priorRooms;
}

function getMostRecentRecordedRooms(ctx: PhaseRunnerContext): RoomAllocation[] {
  const allocation = ctx.gameState.getRoomAllocations(ctx.gameState.round - 1);
  return allocation?.rooms ?? [];
}

function getMostRecentRecordedExcludedPlayerIds(ctx: PhaseRunnerContext): UUID[] {
  const allocation = ctx.gameState.getRoomAllocations(ctx.gameState.round - 1);
  return allocation?.excluded ?? [];
}

function buildRecordedExclusionCounts(ctx: PhaseRunnerContext): Map<UUID, number> {
  const counts = new Map<UUID, number>();
  for (let priorRound = 1; priorRound < ctx.gameState.round; priorRound++) {
    const allocation = ctx.gameState.getRoomAllocations(priorRound);
    if (!allocation) continue;
    for (const playerId of allocation.excluded) {
      counts.set(playerId, (counts.get(playerId) ?? 0) + 1);
    }
  }
  return counts;
}

function logDiversityAllocation(
  ctx: PhaseRunnerContext,
  brokenPreferences: BrokenWhisperRoomPreference[],
): void {
  if (brokenPreferences.length === 0) return;

  const brokenText = brokenPreferences
    .map((preference) =>
      `${ctx.gameState.getPlayerName(preference.playerId)} -> ${ctx.gameState.getPlayerName(preference.requestedPartnerId)}`,
    )
    .join(", ");

  ctx.logger.logSystem(
    `Whisper allocation experiment: diversified rooms to reduce repeat pairs and exclusion streaks (${brokenText}).`,
    Phase.WHISPER,
  );
}

function resolveAllocationMode(options: RoomAllocationOptions): WhisperRoomAllocationMode {
  return options.allocationMode ?? (options.avoidRepeatPairs ? "diversity-weighted" : "request-order");
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function buildRotatedOrder(
  alivePlayers: Array<{ id: UUID; name: string }>,
  round: number,
  sessionIndex: number,
): UUID[] {
  const ids = alivePlayers.map((player) => player.id);
  if (ids.length === 0) return ids;
  const offset = (Math.max(0, round - 1) + sessionIndex) % ids.length;
  return ids.slice(offset).concat(ids.slice(0, offset));
}

function buildAllocationStats(
  alivePlayers: Array<{ id: UUID; name: string }>,
  round: number,
  options: RoomAllocationOptions,
): AllocationStats {
  const priorRooms = options.priorRooms ?? [];
  const previousSessionRooms = options.previousSessionRooms ??
    (options.avoidRepeatPairs ? priorRooms : []);
  const previousExcludedPlayerIds = options.previousSessionExcludedPlayerIds ??
    (options.avoidRepeatPairs ? options.priorExcludedPlayerIds ?? [] : []);
  const priorPairCounts = buildPriorPairCounts(priorRooms);
  const previousPairKeys = buildPriorPairKeys(previousSessionRooms);
  const exclusionCounts = new Map<UUID, number>();
  const participationCounts = new Map<UUID, number>();

  for (const player of alivePlayers) {
    exclusionCounts.set(player.id, options.exclusionCounts?.get(player.id) ?? 0);
    participationCounts.set(player.id, 0);
  }

  if (!options.exclusionCounts) {
    for (const playerId of options.priorExcludedPlayerIds ?? []) {
      if (exclusionCounts.has(playerId)) {
        exclusionCounts.set(playerId, (exclusionCounts.get(playerId) ?? 0) + 1);
      }
    }
  }

  for (const room of priorRooms) {
    if (participationCounts.has(room.playerA)) {
      participationCounts.set(room.playerA, (participationCounts.get(room.playerA) ?? 0) + 1);
    }
    if (participationCounts.has(room.playerB)) {
      participationCounts.set(room.playerB, (participationCounts.get(room.playerB) ?? 0) + 1);
    }
  }

  const rotatedOrder = buildRotatedOrder(alivePlayers, round, options.sessionIndex ?? 0);
  const orderIndex = new Map<UUID, number>();
  rotatedOrder.forEach((playerId, index) => orderIndex.set(playerId, index));
  const eligibleExclusionCounts = alivePlayers.map((player) => exclusionCounts.get(player.id) ?? 0);

  return {
    priorPairCounts,
    previousPairKeys,
    previousExcludedPlayerIds: new Set(previousExcludedPlayerIds),
    exclusionCounts,
    participationCounts,
    medianParticipation: median(Array.from(participationCounts.values())),
    minExclusions: eligibleExclusionCounts.length > 0 ? Math.min(...eligibleExclusionCounts) : 0,
    orderIndex,
  };
}

function getValidRequest(
  requests: Map<UUID, UUID>,
  playerId: UUID,
  eligiblePlayerIds: Set<UUID>,
): UUID | undefined {
  const requestedPartnerId = requests.get(playerId);
  if (!requestedPartnerId || requestedPartnerId === playerId || !eligiblePlayerIds.has(requestedPartnerId)) {
    return undefined;
  }
  return requestedPartnerId;
}

function isMutualRequest(
  requests: Map<UUID, UUID>,
  playerA: UUID,
  playerB: UUID,
  eligiblePlayerIds: Set<UUID>,
): boolean {
  return getValidRequest(requests, playerA, eligiblePlayerIds) === playerB &&
    getValidRequest(requests, playerB, eligiblePlayerIds) === playerA;
}

function enumerateCandidatePairs(alivePlayers: Array<{ id: UUID; name: string }>): CandidatePair[] {
  const pairs: CandidatePair[] = [];
  for (let i = 0; i < alivePlayers.length; i++) {
    for (let j = i + 1; j < alivePlayers.length; j++) {
      const playerA = alivePlayers[i]!.id;
      const playerB = alivePlayers[j]!.id;
      pairs.push({ playerA, playerB, key: pairKey(playerA, playerB) });
    }
  }
  return pairs;
}

function enumerateMatchings(candidatePairs: CandidatePair[], roomCount: number): CandidatePair[][] {
  if (roomCount === 0) return [[]];
  const results: CandidatePair[][] = [];

  function walk(startIndex: number, selected: CandidatePair[], usedPlayerIds: Set<UUID>): void {
    if (selected.length === roomCount) {
      results.push([...selected]);
      return;
    }

    for (let i = startIndex; i < candidatePairs.length; i++) {
      const pair = candidatePairs[i]!;
      if (usedPlayerIds.has(pair.playerA) || usedPlayerIds.has(pair.playerB)) continue;

      selected.push(pair);
      usedPlayerIds.add(pair.playerA);
      usedPlayerIds.add(pair.playerB);
      walk(i + 1, selected, usedPlayerIds);
      usedPlayerIds.delete(pair.playerA);
      usedPlayerIds.delete(pair.playerB);
      selected.pop();
    }
  }

  walk(0, [], new Set());
  return results;
}

function comparePairsByRotatedOrder(a: CandidatePair, b: CandidatePair, stats: AllocationStats): number {
  const aFirst = Math.min(stats.orderIndex.get(a.playerA) ?? 0, stats.orderIndex.get(a.playerB) ?? 0);
  const aSecond = Math.max(stats.orderIndex.get(a.playerA) ?? 0, stats.orderIndex.get(a.playerB) ?? 0);
  const bFirst = Math.min(stats.orderIndex.get(b.playerA) ?? 0, stats.orderIndex.get(b.playerB) ?? 0);
  const bSecond = Math.max(stats.orderIndex.get(b.playerA) ?? 0, stats.orderIndex.get(b.playerB) ?? 0);
  return aFirst - bFirst || aSecond - bSecond;
}

function pairTieBreakKey(pair: CandidatePair, stats: AllocationStats): string {
  const first = Math.min(stats.orderIndex.get(pair.playerA) ?? 0, stats.orderIndex.get(pair.playerB) ?? 0);
  const second = Math.max(stats.orderIndex.get(pair.playerA) ?? 0, stats.orderIndex.get(pair.playerB) ?? 0);
  return `${first.toString().padStart(2, "0")}-${second.toString().padStart(2, "0")}`;
}

function matchingTieBreakKey(pairs: CandidatePair[], excluded: UUID[], stats: AllocationStats): string {
  const pairPart = [...pairs]
    .sort((a, b) => comparePairsByRotatedOrder(a, b, stats))
    .map((pair) => pairTieBreakKey(pair, stats))
    .join("|");
  const excludedPart = excluded
    .map((playerId) => stats.orderIndex.get(playerId) ?? 0)
    .sort((a, b) => a - b)
    .map((index) => index.toString().padStart(2, "0"))
    .join(",");
  return `${pairPart}/${excludedPart}`;
}

function scorePair(
  pair: CandidatePair,
  requests: Map<UUID, UUID>,
  eligiblePlayerIds: Set<UUID>,
  stats: AllocationStats,
): number {
  let score = 0;
  const requestA = getValidRequest(requests, pair.playerA, eligiblePlayerIds);
  const requestB = getValidRequest(requests, pair.playerB, eligiblePlayerIds);

  if (requestA === pair.playerB && requestB === pair.playerA) {
    score += 100;
  } else if (requestA === pair.playerB || requestB === pair.playerA) {
    score += 45;
  }

  for (const playerId of [pair.playerA, pair.playerB]) {
    if ((stats.participationCounts.get(playerId) ?? 0) < stats.medianParticipation) {
      score += 25;
    }
    if (stats.previousExcludedPlayerIds.has(playerId)) {
      score += 20;
    }
  }

  const priorPairCount = stats.priorPairCounts.get(pair.key) ?? 0;
  if (stats.previousPairKeys.has(pair.key)) score -= 160;
  if (priorPairCount > 0) {
    score -= 100;
    score -= 40 * priorPairCount;
  }

  return score;
}

function cleanMutualRequestWasExcluded(
  playerId: UUID,
  requests: Map<UUID, UUID>,
  eligiblePlayerIds: Set<UUID>,
  stats: AllocationStats,
): boolean {
  const requestedPartnerId = getValidRequest(requests, playerId, eligiblePlayerIds);
  if (!requestedPartnerId) return false;
  if (!isMutualRequest(requests, playerId, requestedPartnerId, eligiblePlayerIds)) return false;
  const key = pairKey(playerId, requestedPartnerId);
  return !stats.previousPairKeys.has(key) && !stats.priorPairCounts.has(key);
}

function scoreMatching(
  pairs: CandidatePair[],
  requests: Map<UUID, UUID>,
  alivePlayers: Array<{ id: UUID; name: string }>,
  eligiblePlayerIds: Set<UUID>,
  stats: AllocationStats,
): { score: number; excluded: UUID[]; tieBreakKey: string } {
  const pairedPlayerIds = new Set<UUID>();
  let score = 0;

  for (const pair of pairs) {
    pairedPlayerIds.add(pair.playerA);
    pairedPlayerIds.add(pair.playerB);
    score += scorePair(pair, requests, eligiblePlayerIds, stats);
  }

  const excluded = alivePlayers.filter((player) => !pairedPlayerIds.has(player.id)).map((player) => player.id);
  for (const playerId of excluded) {
    if (stats.previousExcludedPlayerIds.has(playerId)) score -= 140;
    if ((stats.exclusionCounts.get(playerId) ?? 0) > stats.minExclusions) score -= 60;
    if (cleanMutualRequestWasExcluded(playerId, requests, eligiblePlayerIds, stats)) score -= 30;
  }

  for (const player of alivePlayers) {
    const requestedPartnerId = getValidRequest(requests, player.id, eligiblePlayerIds);
    if (!requestedPartnerId) continue;
    const matchedRequest = pairs.some((pair) =>
      pair.key === pairKey(player.id, requestedPartnerId),
    );
    if (!matchedRequest) score -= 10;
  }

  return { score, excluded, tieBreakKey: matchingTieBreakKey(pairs, excluded, stats) };
}

function matchingHasImmediateRepeat(pairs: CandidatePair[], stats: AllocationStats): boolean {
  return pairs.some((pair) => stats.previousPairKeys.has(pair.key));
}

function matchingHasConsecutiveExclusion(excluded: UUID[], stats: AllocationStats): boolean {
  return excluded.some((playerId) => stats.previousExcludedPlayerIds.has(playerId));
}

function buildPlayerRef(
  playerById: Map<UUID, { id: UUID; name: string }>,
  playerId: UUID,
): WhisperRoomPlayerRef {
  return {
    id: playerId,
    name: playerById.get(playerId)?.name ?? playerId,
  };
}

function buildRequestRecords(
  rawRequests: Map<UUID, UUID | null>,
  requests: Map<UUID, UUID>,
  alivePlayers: Array<{ id: UUID; name: string }>,
  eligiblePlayerIds: Set<UUID>,
): WhisperRoomRequestRecord[] {
  const playerById = new Map(alivePlayers.map((player) => [player.id, player]));

  return alivePlayers.map((player) => {
    const requestedPartnerId = rawRequests.has(player.id)
      ? rawRequests.get(player.id)
      : requests.get(player.id) ?? null;
    const requestedPartner = requestedPartnerId
      ? buildPlayerRef(playerById, requestedPartnerId)
      : null;

    if (!requestedPartnerId) {
      return {
        requester: buildPlayerRef(playerById, player.id),
        requestedPartner,
        status: "missing",
      };
    }
    if (requestedPartnerId === player.id) {
      return {
        requester: buildPlayerRef(playerById, player.id),
        requestedPartner,
        status: "self",
      };
    }
    if (!eligiblePlayerIds.has(requestedPartnerId)) {
      return {
        requester: buildPlayerRef(playerById, player.id),
        requestedPartner,
        status: "ineligible",
      };
    }

    return {
      requester: buildPlayerRef(playerById, player.id),
      requestedPartner,
      status: "valid",
    };
  });
}

function matchingIncludesPlayer(matching: CandidatePair[], playerId: UUID): boolean {
  return matching.some((pair) => pair.playerA === playerId || pair.playerB === playerId);
}

function buildPriorPairCountsDiagnostics(
  stats: AllocationStats,
  playerById: Map<UUID, { id: UUID; name: string }>,
): WhisperSessionDiagnostics["priorPairCounts"] {
  return [...stats.priorPairCounts.entries()]
    .map(([key, count]) => {
      const [playerA, playerB] = key.split(":") as [UUID, UUID];
      return {
        players: [buildPlayerRef(playerById, playerA), buildPlayerRef(playerById, playerB)] as [
          WhisperRoomPlayerRef,
          WhisperRoomPlayerRef,
        ],
        count,
      };
    })
    .sort((a, b) => {
      const left = `${a.players[0].name}|${a.players[1].name}`;
      const right = `${b.players[0].name}|${b.players[1].name}`;
      return left.localeCompare(right);
    });
}

function buildRequestSatisfaction(
  requestRecords: WhisperRoomRequestRecord[],
  rooms: RoomAllocation[],
  requests: Map<UUID, UUID>,
  eligiblePlayerIds: Set<UUID>,
): WhisperSessionDiagnostics["requestSatisfaction"] {
  const roomPairKeys = new Set(rooms.map((room) => pairKey(room.playerA, room.playerB)));
  let validRequests = 0;
  let mutualHonored = 0;
  let oneWayHonored = 0;
  let unmatchedValidRequests = 0;
  let invalidOrMissingRequests = 0;

  for (const room of rooms) {
    const aRequestedB = getValidRequest(requests, room.playerA, eligiblePlayerIds) === room.playerB;
    const bRequestedA = getValidRequest(requests, room.playerB, eligiblePlayerIds) === room.playerA;
    if (aRequestedB && bRequestedA) {
      mutualHonored += 1;
    } else if (aRequestedB || bRequestedA) {
      oneWayHonored += 1;
    }
  }

  for (const request of requestRecords) {
    if (request.status !== "valid" || !request.requestedPartner) {
      invalidOrMissingRequests += 1;
      continue;
    }

    validRequests += 1;
    if (!roomPairKeys.has(pairKey(request.requester.id, request.requestedPartner.id))) {
      unmatchedValidRequests += 1;
    }
  }

  return {
    validRequests,
    mutualHonored,
    oneWayHonored,
    unmatchedValidRequests,
    invalidOrMissingRequests,
  };
}

function buildWhisperSessionDiagnostics(
  requests: Map<UUID, UUID>,
  alivePlayers: Array<{ id: UUID; name: string }>,
  roomCountLimit: number,
  round: number,
  options: RoomAllocationOptions,
  rooms: RoomAllocation[],
  excluded: UUID[],
): WhisperSessionDiagnostics {
  const allocationMode = resolveAllocationMode(options);
  const roomCount = Math.min(roomCountLimit, Math.floor(alivePlayers.length / 2));
  const stats = buildAllocationStats(alivePlayers, round, options);
  const candidatePairs = enumerateCandidatePairs(alivePlayers);
  const allFullMatchings = enumerateMatchings(candidatePairs, roomCount);
  const nonRepeatFullMatchings = allFullMatchings.filter(
    (matching) => !matchingHasImmediateRepeat(matching, stats),
  );
  const hasFullNonRepeatMatching = nonRepeatFullMatchings.length > 0;
  const exclusionAlternatives = hasFullNonRepeatMatching ? nonRepeatFullMatchings : allFullMatchings;
  const eligiblePlayerIds = new Set(alivePlayers.map((player) => player.id));
  const playerById = new Map(alivePlayers.map((player) => [player.id, player]));
  const rawRequests = options.rawRequests ?? new Map<UUID, UUID | null>(requests);
  const requestRecords = buildRequestRecords(rawRequests, requests, alivePlayers, eligiblePlayerIds);

  const allocatedRooms = rooms.map((room) => {
    const key = pairKey(room.playerA, room.playerB);
    const immediateRepeat = stats.previousPairKeys.has(key);
    const priorRepeatCount = stats.priorPairCounts.get(key) ?? 0;
    return {
      roomId: room.roomId,
      players: [
        buildPlayerRef(playerById, room.playerA),
        buildPlayerRef(playerById, room.playerB),
      ] as [WhisperRoomPlayerRef, WhisperRoomPlayerRef],
      immediateRepeat,
      priorRepeatCount,
      noFullNonRepeatMatchingExisted: immediateRepeat && !hasFullNonRepeatMatching,
    };
  });

  const excludedPlayers = excluded.map((playerId) => {
    const consecutiveExclusion = stats.previousExcludedPlayerIds.has(playerId);
    return {
      player: buildPlayerRef(playerById, playerId),
      consecutiveExclusion,
      alternativeFullMatchingCouldAvoid: consecutiveExclusion &&
        exclusionAlternatives.some((matching) => matchingIncludesPlayer(matching, playerId)),
    };
  });

  return {
    round,
    sessionIndex: (options.sessionIndex ?? 0) + 1,
    allocationMode,
    roomCountLimit,
    eligiblePlayers: alivePlayers.map((player) => buildPlayerRef(playerById, player.id)),
    requests: requestRecords,
    allocatedRooms,
    excludedPlayers,
    priorPairCounts: buildPriorPairCountsDiagnostics(stats, playerById),
    previousSessionExcludedPlayers: [...stats.previousExcludedPlayerIds]
      .map((playerId) => buildPlayerRef(playerById, playerId))
      .sort((a, b) => a.name.localeCompare(b.name)),
    requestSatisfaction: buildRequestSatisfaction(requestRecords, rooms, requests, eligiblePlayerIds),
    repeatPairFlags: {
      immediateRepeats: allocatedRooms.filter((room) => room.immediateRepeat).length,
      repeatedPairs: allocatedRooms.filter((room) => room.priorRepeatCount > 0).length,
      noFullNonRepeatMatchingExists: !hasFullNonRepeatMatching,
    },
    exclusionFlags: {
      consecutiveExclusions: excludedPlayers.filter((player) => player.consecutiveExclusion).length,
      avoidableConsecutiveExclusions: excludedPlayers.filter(
        (player) => player.consecutiveExclusion && player.alternativeFullMatchingCouldAvoid,
      ).length,
    },
  };
}

function chooseDiversityWeightedMatching(
  requests: Map<UUID, UUID>,
  alivePlayers: Array<{ id: UUID; name: string }>,
  roomCountLimit: number,
  round: number,
  options: RoomAllocationOptions,
): { pairs: CandidatePair[]; excluded: UUID[] } {
  const roomCount = Math.min(roomCountLimit, Math.floor(alivePlayers.length / 2));
  const stats = buildAllocationStats(alivePlayers, round, options);
  const candidatePairs = enumerateCandidatePairs(alivePlayers);
  const eligiblePlayerIds = new Set(alivePlayers.map((player) => player.id));
  let matchings = enumerateMatchings(candidatePairs, roomCount);

  if (alivePlayers.length >= 6) {
    const withoutImmediateRepeats = matchings.filter((matching) => !matchingHasImmediateRepeat(matching, stats));
    if (withoutImmediateRepeats.length > 0) {
      matchings = withoutImmediateRepeats;
    }

    const withoutConsecutiveExclusions = matchings.filter((matching) => {
      const pairedPlayerIds = new Set<UUID>();
      for (const pair of matching) {
        pairedPlayerIds.add(pair.playerA);
        pairedPlayerIds.add(pair.playerB);
      }
      const excluded = alivePlayers.filter((player) => !pairedPlayerIds.has(player.id)).map((player) => player.id);
      return !matchingHasConsecutiveExclusion(excluded, stats);
    });
    if (withoutConsecutiveExclusions.length > 0) {
      matchings = withoutConsecutiveExclusions;
    }
  }

  let best:
    | { pairs: CandidatePair[]; excluded: UUID[]; score: number; tieBreakKey: string }
    | undefined;

  for (const matching of matchings) {
    const scored = scoreMatching(matching, requests, alivePlayers, eligiblePlayerIds, stats);
    if (
      !best ||
      scored.score > best.score ||
      (scored.score === best.score && scored.tieBreakKey < best.tieBreakKey)
    ) {
      best = { pairs: matching, excluded: scored.excluded, score: scored.score, tieBreakKey: scored.tieBreakKey };
    }
  }

  if (!best) return { pairs: [], excluded: alivePlayers.map((player) => player.id) };

  return {
    pairs: [...best.pairs].sort((a, b) => comparePairsByRotatedOrder(a, b, stats)),
    excluded: best.excluded,
  };
}

function getUnhonoredRepeatPreferences(
  requests: Map<UUID, UUID>,
  rooms: RoomAllocation[],
  priorRooms: RoomAllocation[],
): BrokenWhisperRoomPreference[] {
  const priorPairCounts = buildPriorPairCounts(priorRooms);
  const roomPairKeys = new Set(rooms.map((room) => pairKey(room.playerA, room.playerB)));
  return Array.from(requests)
    .filter(([playerId, partnerId]) => {
      const key = pairKey(playerId, partnerId);
      return priorPairCounts.has(key) && !roomPairKeys.has(key);
    })
    .map(([playerId, requestedPartnerId]) => ({ playerId, requestedPartnerId }));
}

/**
 * Allocate rooms based on player preferences.
 *
 * The default request-order mode preserves the original mutual-match-first
 * behavior. Experiment modes can replace only the allocator, keeping the rest
 * of the whisper phase unchanged.
 */
export function allocateRooms(
  requests: Map<UUID, UUID>,
  alivePlayers: Array<{ id: UUID; name: string }>,
  roomCountLimit: number,
  round: number,
  options: RoomAllocationOptions = {},
): {
  rooms: RoomAllocation[];
  excluded: UUID[];
  brokenPreferences: BrokenWhisperRoomPreference[];
  diagnostics: WhisperSessionDiagnostics;
} {
  if (resolveAllocationMode(options) === "diversity-weighted") {
    const { pairs, excluded } = chooseDiversityWeightedMatching(
      requests,
      alivePlayers,
      roomCountLimit,
      round,
      options,
    );
    const rooms = pairs.map((pair, index) => ({
      roomId: index + 1,
      playerA: pair.playerA,
      playerB: pair.playerB,
      round,
    }));
    const diagnostics = buildWhisperSessionDiagnostics(
      requests,
      alivePlayers,
      roomCountLimit,
      round,
      options,
      rooms,
      excluded,
    );
    return {
      rooms,
      excluded,
      brokenPreferences: getUnhonoredRepeatPreferences(requests, rooms, options.priorRooms ?? []),
      diagnostics,
    };
  }

  const rooms: RoomAllocation[] = [];
  const paired = new Set<UUID>();
  const repeatedPairKeys = options.avoidRepeatPairs
    ? buildPriorPairKeys(options.priorRooms ?? [])
    : new Set<string>();
  const isAvoidedRepeatPair = (playerId: UUID, partnerId: UUID): boolean =>
    options.avoidRepeatPairs === true && repeatedPairKeys.has(pairKey(playerId, partnerId));

  // Step 1: Mutual matches first
  for (const [playerId, partnerId] of requests) {
    if (paired.has(playerId) || paired.has(partnerId)) continue;
    if (rooms.length >= roomCountLimit) break;
    if (isAvoidedRepeatPair(playerId, partnerId)) continue;
    if (requests.get(partnerId) === playerId) {
      rooms.push({ roomId: rooms.length + 1, playerA: playerId, playerB: partnerId, round });
      paired.add(playerId);
      paired.add(partnerId);
    }
  }

  // Step 2: Remaining requests by order
  for (const [playerId, partnerId] of requests) {
    if (rooms.length >= roomCountLimit) break;
    if (paired.has(playerId)) continue;
    if (paired.has(partnerId)) continue;
    if (isAvoidedRepeatPair(playerId, partnerId)) continue;
    rooms.push({ roomId: rooms.length + 1, playerA: playerId, playerB: partnerId, round });
    paired.add(playerId);
    paired.add(partnerId);
  }

  const excluded = alivePlayers
    .filter((p) => !paired.has(p.id))
    .map((p) => p.id);

  const brokenPreferences = options.avoidRepeatPairs === true
    ? Array.from(requests)
      .filter(([playerId, partnerId]) =>
        isAvoidedRepeatPair(playerId, partnerId) &&
        !rooms.some((room) => pairKey(room.playerA, room.playerB) === pairKey(playerId, partnerId)),
      )
      .map(([playerId, requestedPartnerId]) => ({ playerId, requestedPartnerId }))
    : [];

  return {
    rooms,
    excluded,
    brokenPreferences,
    diagnostics: buildWhisperSessionDiagnostics(
      requests,
      alivePlayers,
      roomCountLimit,
      round,
      options,
      rooms,
      excluded,
    ),
  };
}

/**
 * Run a turn-based conversation in a single whisper room.
 */
async function runRoomConversation(
  ctx: PhaseRunnerContext,
  room: RoomAllocation,
  roomCountForContext: number,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder, config } = ctx;
  const MAX_MESSAGES_PER_AGENT = config.maxWhisperExchanges ?? 2;
  const nameA = gameState.getPlayerName(room.playerA);
  const nameB = gameState.getPlayerName(room.playerB);

  const conversationHistory: Array<{ from: string; text: string }> = [];
  const msgCount = new Map<UUID, number>([[room.playerA, 0], [room.playerB, 0]]);
  let consecutivePasses = 0;

  let currentPlayerId: UUID = room.playerA;

  while (consecutivePasses < 2) {
    const partnerId = currentPlayerId === room.playerA ? room.playerB : room.playerA;
    const partnerName = currentPlayerId === room.playerA ? nameB : nameA;
    const currentName = currentPlayerId === room.playerA ? nameA : nameB;

    if ((msgCount.get(currentPlayerId) ?? 0) >= MAX_MESSAGES_PER_AGENT) {
      consecutivePasses++;
      currentPlayerId = partnerId;
      continue;
    }

    const agent = agents.get(currentPlayerId)!;
    const phaseCtx = contextBuilder.buildPhaseContext(currentPlayerId, Phase.WHISPER, undefined, undefined, {
      roomCount: roomCountForContext,
      roomPartner: partnerName,
    });

    const response = await agent.sendRoomMessage(phaseCtx, partnerName, conversationHistory);

    if (response === null) {
      consecutivePasses++;
    } else {
      consecutivePasses = 0;
      msgCount.set(currentPlayerId, (msgCount.get(currentPlayerId) ?? 0) + 1);

      const inbox = ctx.whisperInbox.get(partnerId) ?? [];
      inbox.push({ from: currentName, text: response.message });
      ctx.whisperInbox.set(partnerId, inbox);

      conversationHistory.push({ from: currentName, text: response.message });
      logger.logWhisper(currentPlayerId, [partnerId], response.message, room.roomId, response.thinking);
    }

    if ((msgCount.get(room.playerA) ?? 0) >= MAX_MESSAGES_PER_AGENT &&
        (msgCount.get(room.playerB) ?? 0) >= MAX_MESSAGES_PER_AGENT) {
      break;
    }

    currentPlayerId = partnerId;
  }
}

export async function runWhisperPhase(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder, config } = ctx;

  logger.emitPhaseChange(Phase.WHISPER);
  logger.logSystem("=== WHISPER PHASE ===", Phase.WHISPER);
  const alivePlayers = gameState.getAlivePlayers();

  ctx.whisperInbox = new Map(alivePlayers.map((p) => [p.id, []]));
  contextBuilder.currentRoomAllocations = [];
  contextBuilder.currentExcludedPlayerIds = [];

  const maxPairsPerAgent = config.maxWhisperPairsPerAgent ?? 3;
  const sessionsPerRound = config.whisperSessionsPerRound ?? 2;

  const conversationCount = new Map<UUID, number>(alivePlayers.map((p) => [p.id, 0]));
  const exclusionCounts = buildRecordedExclusionCounts(ctx);
  let previousSessionRooms = getMostRecentRecordedRooms(ctx);
  let previousSessionExcludedPlayerIds = getMostRecentRecordedExcludedPlayerIds(ctx);
  const allRooms: RoomAllocation[] = [];
  const allExcluded = new Set<UUID>();
  let globalRoomId = 0;

  for (let session = 0; session < sessionsPerRound; session++) {
    const eligible = alivePlayers.filter(
      (p) => (conversationCount.get(p.id) ?? 0) < maxPairsPerAgent,
    );
    if (eligible.length < 2) break;

    const roomCount = computeRoomCount(eligible.length);

    const rawRequests = new Map<UUID, UUID | null>();
    const requests = new Map<UUID, UUID>();
    await Promise.all(
      eligible.map(async (player) => {
        const agent = agents.get(player.id)!;
        const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.WHISPER, undefined, undefined, { roomCount });
        const partnerId = await agent.requestRoom(phaseCtx);
        rawRequests.set(player.id, partnerId);
        if (partnerId && eligible.some((p) => p.id === partnerId)) {
          requests.set(player.id, partnerId);
        }
      }),
    );

    const allocationMode = getWhisperAllocationMode(config);
    const allocationOptions: RoomAllocationOptions = allocationMode === "diversity-weighted"
      ? {
          allocationMode: "diversity-weighted",
          priorRooms: getRecordedPriorRooms(ctx, allRooms),
          previousSessionRooms,
          previousSessionExcludedPlayerIds,
          exclusionCounts,
          sessionIndex: session,
          rawRequests,
        }
      : {
          allocationMode: "request-order",
          sessionIndex: session,
          rawRequests,
        };
    const { rooms, excluded, brokenPreferences, diagnostics } = allocateRooms(
      requests,
      eligible,
      roomCount,
      gameState.round,
      allocationOptions,
    );

    const sessionRooms = rooms.map((r) => {
      globalRoomId++;
      return { ...r, roomId: globalRoomId };
    });
    const sessionDiagnostics: WhisperSessionDiagnostics = {
      ...diagnostics,
      allocatedRooms: diagnostics.allocatedRooms.map((room, index) => ({
        ...room,
        roomId: sessionRooms[index]?.roomId ?? room.roomId,
      })),
    };

    logDiversityAllocation(ctx, brokenPreferences);

    for (const room of sessionRooms) {
      conversationCount.set(room.playerA, (conversationCount.get(room.playerA) ?? 0) + 1);
      conversationCount.set(room.playerB, (conversationCount.get(room.playerB) ?? 0) + 1);
    }

    allRooms.push(...sessionRooms);
    for (const id of excluded) {
      allExcluded.add(id);
      exclusionCounts.set(id, (exclusionCounts.get(id) ?? 0) + 1);
    }
    previousSessionRooms = sessionRooms;
    previousSessionExcludedPlayerIds = excluded;

    const roomDescriptions = sessionRooms.map((r) => {
      const nameA = gameState.getPlayerName(r.playerA);
      const nameB = gameState.getPlayerName(r.playerB);
      return `Room ${r.roomId}: ${nameA} & ${nameB}`;
    });
    const excludedNames = excluded.map((id) => gameState.getPlayerName(id));
    const sessionLabel = sessionsPerRound > 1 ? ` (session ${session + 1})` : "";
    const allocationText = roomDescriptions.join(" | ") +
      (excludedNames.length > 0 ? ` | Commons: ${excludedNames.join(", ")}` : "") +
      sessionLabel;
    logger.logRoomAllocation(allocationText, sessionRooms, excludedNames, sessionDiagnostics);

    await Promise.all(sessionRooms.map((room) => runRoomConversation(ctx, room, roomCount)));
  }

  contextBuilder.currentRoomAllocations = allRooms;
  contextBuilder.currentExcludedPlayerIds = [...allExcluded];
  gameState.recordRoomAllocations(allRooms, [...allExcluded]);

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}

export async function runReckoningWhisper(
  ctx: PhaseRunnerContext,
  actor: PhaseActor,
): Promise<void> {
  const { gameState, agents, logger, contextBuilder } = ctx;

  logger.emitPhaseChange(Phase.WHISPER);
  logger.logSystem("=== RECKONING: WHISPER PHASE ===", Phase.WHISPER);
  const alivePlayers = gameState.getAlivePlayers();

  ctx.whisperInbox = new Map(alivePlayers.map((p) => [p.id, []]));
  contextBuilder.currentRoomAllocations = [];
  contextBuilder.currentExcludedPlayerIds = [];

  const roomCount = computeRoomCount(alivePlayers.length);

  const rawRequests = new Map<UUID, UUID | null>();
  const requests = new Map<UUID, UUID>();
  await Promise.all(
    alivePlayers.map(async (player) => {
      const agent = agents.get(player.id)!;
      const phaseCtx = contextBuilder.buildPhaseContext(player.id, Phase.WHISPER, undefined, undefined, { roomCount });
      const partnerId = await agent.requestRoom(phaseCtx);
      rawRequests.set(player.id, partnerId);
      if (partnerId) {
        requests.set(player.id, partnerId);
      }
    }),
  );

  const allocationMode = getWhisperAllocationMode(ctx.config);
  const allocationOptions: RoomAllocationOptions = allocationMode === "diversity-weighted"
    ? {
        allocationMode: "diversity-weighted",
        priorRooms: getRecordedPriorRooms(ctx, []),
        previousSessionRooms: getMostRecentRecordedRooms(ctx),
        previousSessionExcludedPlayerIds: getMostRecentRecordedExcludedPlayerIds(ctx),
        exclusionCounts: buildRecordedExclusionCounts(ctx),
        sessionIndex: 0,
        rawRequests,
      }
    : {
        allocationMode: "request-order",
        sessionIndex: 0,
        rawRequests,
      };
  const { rooms, excluded, brokenPreferences, diagnostics } = allocateRooms(
    requests,
    alivePlayers,
    roomCount,
    gameState.round,
    allocationOptions,
  );
  contextBuilder.currentRoomAllocations = rooms;
  contextBuilder.currentExcludedPlayerIds = excluded;
  gameState.recordRoomAllocations(rooms, excluded);
  logDiversityAllocation(ctx, brokenPreferences);

  const roomDescriptions = rooms.map((r) => {
    const nameA = gameState.getPlayerName(r.playerA);
    const nameB = gameState.getPlayerName(r.playerB);
    return `Room ${r.roomId}: ${nameA} & ${nameB}`;
  });
  const excludedNames = excluded.map((id) => gameState.getPlayerName(id));
  const allocationText = roomDescriptions.join(" | ") +
    (excludedNames.length > 0 ? ` | Commons: ${excludedNames.join(", ")}` : "");
  logger.logRoomAllocation(allocationText, rooms, excludedNames, diagnostics);

  await Promise.all(rooms.map((room) => runRoomConversation(ctx, room, roomCount)));

  actor.send({ type: "PHASE_COMPLETE" });
  await new Promise((r) => setTimeout(r, 0));
}
