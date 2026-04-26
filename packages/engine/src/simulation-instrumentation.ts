import type { TranscriptEntry } from "./game-runner.types";
import type { TokenUsage } from "./token-tracker";
import { Phase } from "./types";

export interface SimulatorArgsSnapshot {
  games: number;
  players: number;
  personas: string[] | null;
  model: string;
  variant: string;
}

export interface GitMetadata {
  branch: string | null;
  commitSha: string | null;
  commitShortSha: string | null;
  isDirty: boolean | null;
}

export interface SimulationRunMetadata {
  variant: string;
  timestamp: string;
  command: string;
  cwd: string;
  git: GitMetadata;
  args: SimulatorArgsSnapshot;
}

export interface PowerActionObservation {
  round: number;
  actor: string;
  action: "eliminate" | "protect" | "pass";
  target: string;
  text: string;
}

export interface AutoEliminateObservation {
  round: number;
  target: string;
  text: string;
}

export interface CouncilMarkerInstrumentation {
  revealPhases: number;
  councilPhases: number;
  councilVotes: number;
  candidatePairs: Array<{ round: number; candidates: [string, string] }>;
}

export interface EndgameMarkerInstrumentation {
  reckoning: number;
  tribunal: number;
  judgment: number;
  juryQuestions: number;
  juryVotes: number;
  byPhase: Partial<Record<Phase, number>>;
}

export interface RoomPairObservation {
  round: number;
  roomId: number;
  players: [string, string];
}

export interface RepeatedPairInstrumentation {
  totalRepeatedOccurrences: number;
  maxPairCount: number;
  maxPairShareOfRooms: number;
  maxPairShareOfWhisperRounds: number;
  pairs: Array<{
    pair: [string, string];
    count: number;
    rounds: number[];
  }>;
}

export interface RoomInstrumentation {
  totalRooms: number;
  whisperRounds: number;
  participationByPlayer: Record<string, number>;
  exclusionsByPlayer: Record<string, number>;
  totalExclusions: number;
  pairs: RoomPairObservation[];
  repeatedPairs: RepeatedPairInstrumentation;
}

export interface ActionUsageInstrumentation {
  totalCalls: number;
  totalEmptyResponses: number;
  emptyResponseRate: number;
  byAction: Record<
    string,
    {
      callCount: number;
      emptyResponses: number;
      emptyResponseRate: number;
      totalTokens: number;
    }
  >;
  bySource: Record<string, TokenUsage>;
}

export interface GameInstrumentation {
  powerActions: {
    total: number;
    counts: Record<"eliminate" | "protect" | "pass", number>;
    actions: PowerActionObservation[];
  };
  autoEliminations: {
    total: number;
    eliminations: AutoEliminateObservation[];
  };
  council: CouncilMarkerInstrumentation;
  endgame: EndgameMarkerInstrumentation;
  rooms: RoomInstrumentation;
  actionUsage: ActionUsageInstrumentation;
}

export interface BatchInstrumentation {
  totalGames: number;
  powerActions: GameInstrumentation["powerActions"];
  autoEliminations: GameInstrumentation["autoEliminations"];
  council: CouncilMarkerInstrumentation;
  endgame: EndgameMarkerInstrumentation;
  rooms: RoomInstrumentation;
  actionUsage: ActionUsageInstrumentation;
}

const EMPTY_USAGE: TokenUsage = {
  promptTokens: 0,
  cachedTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  callCount: 0,
  emptyResponses: 0,
};

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function increment<K extends string>(
  record: Partial<Record<K, number>>,
  key: K,
  amount = 1,
): void {
  record[key] = (record[key] ?? 0) + amount;
}

function sortedPair(a: string, b: string): [string, string] {
  return [a, b].sort((left, right) => left.localeCompare(right)) as [string, string];
}

function pairKey(pair: [string, string]): string {
  return `${pair[0]}|${pair[1]}`;
}

function parsePowerAction(text: string): Omit<PowerActionObservation, "round" | "text"> | null {
  const match = /^(.+) power action: (eliminate|protect|pass) -> (.+)$/.exec(text.trim());
  if (!match) return null;
  const [, actor, action, target] = match;
  if (!actor || !action || !target) return null;
  return {
    actor,
    action: action as "eliminate" | "protect" | "pass",
    target,
  };
}

function parseAutoEliminate(text: string): string | null {
  const match = /^AUTO-ELIMINATE:\s*(.+)$/.exec(text.trim());
  return match?.[1] ?? null;
}

function parseCandidatePair(text: string): [string, string] | null {
  const match = /Council candidates:\s*(.+?)\s+vs\s+(.+)$/.exec(text.trim());
  const left = match?.[1]?.trim();
  const right = match?.[2]?.trim();
  return left && right ? [left, right] : null;
}

function isSystemMarker(entry: TranscriptEntry, marker: string): boolean {
  return entry.scope === "system" && entry.text.includes(marker);
}

function extractActionName(source: string): string {
  const slashIndex = source.indexOf("/");
  return slashIndex >= 0 ? source.slice(slashIndex + 1) : source;
}

function mergeUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    callCount: left.callCount + right.callCount,
    emptyResponses: left.emptyResponses + right.emptyResponses,
  };
}

function buildRepeatedPairInstrumentation(
  pairs: RoomPairObservation[],
  whisperRounds: number,
): RepeatedPairInstrumentation {
  const counts = new Map<string, { pair: [string, string]; count: number; rounds: Set<number> }>();

  for (const observation of pairs) {
    const normalized = sortedPair(observation.players[0], observation.players[1]);
    const key = pairKey(normalized);
    const current = counts.get(key) ?? { pair: normalized, count: 0, rounds: new Set<number>() };
    current.count += 1;
    current.rounds.add(observation.round);
    counts.set(key, current);
  }

  const repeated = [...counts.values()]
    .filter((entry) => entry.count > 1)
    .map((entry) => ({
      pair: entry.pair,
      count: entry.count,
      rounds: [...entry.rounds].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.count - a.count || pairKey(a.pair).localeCompare(pairKey(b.pair)));

  const maxPairCount = Math.max(0, ...[...counts.values()].map((entry) => entry.count));
  const maxPairRoundCount = Math.max(0, ...[...counts.values()].map((entry) => entry.rounds.size));

  return {
    totalRepeatedOccurrences: repeated.reduce((sum, entry) => sum + entry.count - 1, 0),
    maxPairCount,
    maxPairShareOfRooms: rate(maxPairCount, pairs.length),
    maxPairShareOfWhisperRounds: rate(maxPairRoundCount, whisperRounds),
    pairs: repeated,
  };
}

export function buildActionUsageInstrumentation(
  perSourceUsage: Record<string, TokenUsage>,
): ActionUsageInstrumentation {
  const byAction: ActionUsageInstrumentation["byAction"] = {};
  let totalCalls = 0;
  let totalEmptyResponses = 0;

  for (const [source, usage] of Object.entries(perSourceUsage)) {
    totalCalls += usage.callCount;
    totalEmptyResponses += usage.emptyResponses;

    const action = extractActionName(source);
    const existing = byAction[action] ?? {
      callCount: 0,
      emptyResponses: 0,
      emptyResponseRate: 0,
      totalTokens: 0,
    };
    existing.callCount += usage.callCount;
    existing.emptyResponses += usage.emptyResponses;
    existing.totalTokens += usage.totalTokens;
    existing.emptyResponseRate = rate(existing.emptyResponses, existing.callCount);
    byAction[action] = existing;
  }

  return {
    totalCalls,
    totalEmptyResponses,
    emptyResponseRate: rate(totalEmptyResponses, totalCalls),
    byAction,
    bySource: perSourceUsage,
  };
}

export function instrumentGame(
  transcript: readonly TranscriptEntry[],
  perSourceUsage: Record<string, TokenUsage>,
  playerNameById: Record<string, string>,
): GameInstrumentation {
  const powerActions: PowerActionObservation[] = [];
  const autoEliminations: AutoEliminateObservation[] = [];
  const candidatePairs: Array<{ round: number; candidates: [string, string] }> = [];
  const council: CouncilMarkerInstrumentation = {
    revealPhases: 0,
    councilPhases: 0,
    councilVotes: 0,
    candidatePairs,
  };
  const endgame: EndgameMarkerInstrumentation = {
    reckoning: 0,
    tribunal: 0,
    judgment: 0,
    juryQuestions: 0,
    juryVotes: 0,
    byPhase: {},
  };
  const participationByPlayer: Record<string, number> = {};
  const exclusionsByPlayer: Record<string, number> = {};
  const pairs: RoomPairObservation[] = [];
  const whisperRounds = new Set<number>();
  let totalExclusions = 0;

  for (const entry of transcript) {
    const parsedPower = entry.scope === "system" ? parsePowerAction(entry.text) : null;
    if (parsedPower) {
      powerActions.push({ ...parsedPower, round: entry.round, text: entry.text });
    }

    const autoEliminated = entry.scope === "system" ? parseAutoEliminate(entry.text) : null;
    if (autoEliminated) {
      autoEliminations.push({ round: entry.round, target: autoEliminated, text: entry.text });
    }

    if (isSystemMarker(entry, "=== REVEAL PHASE ===")) {
      council.revealPhases += 1;
      const candidates = parseCandidatePair(entry.text);
      if (candidates) candidatePairs.push({ round: entry.round, candidates });
    }
    if (isSystemMarker(entry, "=== COUNCIL PHASE ===")) {
      council.councilPhases += 1;
    }
    if (entry.scope === "system" && /\bcouncil vote ->/.test(entry.text)) {
      council.councilVotes += 1;
    }

    if (entry.scope === "system") {
      if (entry.text.includes("THE RECKONING") || entry.text.includes("RECKONING:")) {
        endgame.reckoning += 1;
      }
      if (entry.text.includes("THE TRIBUNAL") || entry.text.includes("TRIBUNAL:")) {
        endgame.tribunal += 1;
      }
      if (entry.text.includes("THE JUDGMENT") || entry.text.includes("JUDGMENT:")) {
        endgame.judgment += 1;
      }
      if (entry.text.includes("JURY QUESTIONS")) {
        endgame.juryQuestions += 1;
      }
      if (entry.text.includes("JURY VOTE")) {
        endgame.juryVotes += 1;
      }
    }

    if (
      entry.phase === Phase.PLEA ||
      entry.phase === Phase.ACCUSATION ||
      entry.phase === Phase.DEFENSE ||
      entry.phase === Phase.OPENING_STATEMENTS ||
      entry.phase === Phase.JURY_QUESTIONS ||
      entry.phase === Phase.CLOSING_ARGUMENTS ||
      entry.phase === Phase.JURY_VOTE
    ) {
      increment(endgame.byPhase, entry.phase);
    }

    if (entry.roomMetadata) {
      whisperRounds.add(entry.round);
      for (const room of entry.roomMetadata.rooms) {
        const playerA = playerNameById[room.playerA] ?? room.playerA;
        const playerB = playerNameById[room.playerB] ?? room.playerB;
        participationByPlayer[playerA] = (participationByPlayer[playerA] ?? 0) + 1;
        participationByPlayer[playerB] = (participationByPlayer[playerB] ?? 0) + 1;
        pairs.push({
          round: entry.round,
          roomId: room.roomId,
          players: [playerA, playerB],
        });
      }

      for (const playerName of entry.roomMetadata.excluded) {
        exclusionsByPlayer[playerName] = (exclusionsByPlayer[playerName] ?? 0) + 1;
        totalExclusions += 1;
      }
    }
  }

  return {
    powerActions: {
      total: powerActions.length,
      counts: {
        eliminate: powerActions.filter((action) => action.action === "eliminate").length,
        protect: powerActions.filter((action) => action.action === "protect").length,
        pass: powerActions.filter((action) => action.action === "pass").length,
      },
      actions: powerActions,
    },
    autoEliminations: {
      total: autoEliminations.length,
      eliminations: autoEliminations,
    },
    council,
    endgame,
    rooms: {
      totalRooms: pairs.length,
      whisperRounds: whisperRounds.size,
      participationByPlayer,
      exclusionsByPlayer,
      totalExclusions,
      pairs,
      repeatedPairs: buildRepeatedPairInstrumentation(pairs, whisperRounds.size),
    },
    actionUsage: buildActionUsageInstrumentation(perSourceUsage),
  };
}

export function aggregateInstrumentation(games: readonly GameInstrumentation[]): BatchInstrumentation {
  const powerActions: BatchInstrumentation["powerActions"] = {
    total: 0,
    counts: { eliminate: 0, protect: 0, pass: 0 },
    actions: [],
  };
  const autoEliminations: BatchInstrumentation["autoEliminations"] = {
    total: 0,
    eliminations: [],
  };
  const council: CouncilMarkerInstrumentation = {
    revealPhases: 0,
    councilPhases: 0,
    councilVotes: 0,
    candidatePairs: [],
  };
  const endgame: EndgameMarkerInstrumentation = {
    reckoning: 0,
    tribunal: 0,
    judgment: 0,
    juryQuestions: 0,
    juryVotes: 0,
    byPhase: {},
  };
  const participationByPlayer: Record<string, number> = {};
  const exclusionsByPlayer: Record<string, number> = {};
  const pairs: RoomPairObservation[] = [];
  const repeatedPairTotals = new Map<string, { pair: [string, string]; count: number; rounds: Set<number> }>();
  let totalRepeatedOccurrences = 0;
  let maxPairCount = 0;
  let maxPairShareOfRooms = 0;
  let maxPairShareOfWhisperRounds = 0;
  let totalExclusions = 0;
  let whisperRounds = 0;
  let totalCalls = 0;
  let totalEmptyResponses = 0;
  const byAction: ActionUsageInstrumentation["byAction"] = {};
  const bySource: Record<string, TokenUsage> = {};

  for (const game of games) {
    powerActions.total += game.powerActions.total;
    powerActions.counts.eliminate += game.powerActions.counts.eliminate;
    powerActions.counts.protect += game.powerActions.counts.protect;
    powerActions.counts.pass += game.powerActions.counts.pass;
    powerActions.actions.push(...game.powerActions.actions);

    autoEliminations.total += game.autoEliminations.total;
    autoEliminations.eliminations.push(...game.autoEliminations.eliminations);

    council.revealPhases += game.council.revealPhases;
    council.councilPhases += game.council.councilPhases;
    council.councilVotes += game.council.councilVotes;
    council.candidatePairs.push(...game.council.candidatePairs);

    endgame.reckoning += game.endgame.reckoning;
    endgame.tribunal += game.endgame.tribunal;
    endgame.judgment += game.endgame.judgment;
    endgame.juryQuestions += game.endgame.juryQuestions;
    endgame.juryVotes += game.endgame.juryVotes;
    for (const [phase, count] of Object.entries(game.endgame.byPhase)) {
      increment(endgame.byPhase, phase as Phase, count);
    }

    for (const [player, count] of Object.entries(game.rooms.participationByPlayer)) {
      participationByPlayer[player] = (participationByPlayer[player] ?? 0) + count;
    }
    for (const [player, count] of Object.entries(game.rooms.exclusionsByPlayer)) {
      exclusionsByPlayer[player] = (exclusionsByPlayer[player] ?? 0) + count;
    }
    totalExclusions += game.rooms.totalExclusions;
    whisperRounds += game.rooms.whisperRounds;
    pairs.push(...game.rooms.pairs);
    totalRepeatedOccurrences += game.rooms.repeatedPairs.totalRepeatedOccurrences;
    maxPairCount = Math.max(maxPairCount, game.rooms.repeatedPairs.maxPairCount);
    maxPairShareOfRooms = Math.max(
      maxPairShareOfRooms,
      game.rooms.repeatedPairs.maxPairShareOfRooms,
    );
    maxPairShareOfWhisperRounds = Math.max(
      maxPairShareOfWhisperRounds,
      game.rooms.repeatedPairs.maxPairShareOfWhisperRounds,
    );
    for (const repeatedPair of game.rooms.repeatedPairs.pairs) {
      const key = pairKey(repeatedPair.pair);
      const existing = repeatedPairTotals.get(key) ?? {
        pair: repeatedPair.pair,
        count: 0,
        rounds: new Set<number>(),
      };
      existing.count += repeatedPair.count;
      for (const round of repeatedPair.rounds) existing.rounds.add(round);
      repeatedPairTotals.set(key, existing);
    }

    totalCalls += game.actionUsage.totalCalls;
    totalEmptyResponses += game.actionUsage.totalEmptyResponses;
    for (const [action, usage] of Object.entries(game.actionUsage.byAction)) {
      const existing = byAction[action] ?? {
        callCount: 0,
        emptyResponses: 0,
        emptyResponseRate: 0,
        totalTokens: 0,
      };
      existing.callCount += usage.callCount;
      existing.emptyResponses += usage.emptyResponses;
      existing.totalTokens += usage.totalTokens;
      existing.emptyResponseRate = rate(existing.emptyResponses, existing.callCount);
      byAction[action] = existing;
    }
    for (const [source, usage] of Object.entries(game.actionUsage.bySource)) {
      bySource[source] = mergeUsage(bySource[source] ?? EMPTY_USAGE, usage);
    }
  }

  return {
    totalGames: games.length,
    powerActions,
    autoEliminations,
    council,
    endgame,
    rooms: {
      totalRooms: pairs.length,
      whisperRounds,
      participationByPlayer,
      exclusionsByPlayer,
      totalExclusions,
      pairs,
      repeatedPairs: {
        totalRepeatedOccurrences,
        maxPairCount,
        maxPairShareOfRooms,
        maxPairShareOfWhisperRounds,
        pairs: [...repeatedPairTotals.values()]
          .map((entry) => ({
            pair: entry.pair,
            count: entry.count,
            rounds: [...entry.rounds].sort((a, b) => a - b),
          }))
          .sort((a, b) => b.count - a.count || pairKey(a.pair).localeCompare(pairKey(b.pair))),
      },
    },
    actionUsage: {
      totalCalls,
      totalEmptyResponses,
      emptyResponseRate: rate(totalEmptyResponses, totalCalls),
      byAction,
      bySource,
    },
  };
}
