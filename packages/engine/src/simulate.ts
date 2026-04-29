#!/usr/bin/env bun
/**
 * Influence Game — Batch Simulation Runner
 *
 * Runs multiple game simulations and outputs structured analysis.
 *
 * Usage:
 *   bun run simulate
 *   bun run simulate -- --games 5 --players 6
 *   bun run simulate -- --games 3 --players 4 --personas Atlas,Vera,Finn,Mira
 *   bun run simulate -- --variant open-whisper
 *   bun run simulate -- --variant power-lobby-open-whisper
 */

import OpenAI from "openai";
import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { GameRunner, type GameStreamEvent, type TranscriptEntry } from "./game-runner";
import { InfluenceAgent, type Personality } from "./agent";
import { LLMHouseInterviewer } from "./house-interviewer";
import { DEFAULT_CONFIG, type GameConfig, type UUID } from "./types";
import {
  TokenTracker,
  estimateCostAllModels,
  type TokenUsage,
  type CostEstimate,
} from "./token-tracker";
import {
  aggregateInstrumentation,
  instrumentGame,
  type BatchInstrumentation,
  type GameInstrumentation,
  type GitMetadata,
  type SimulationRunMetadata,
} from "./simulation-instrumentation";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const DEFAULT_GAME_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_LLM_TIMEOUT_MS = 45 * 1000;

export interface SimArgs {
  games: number;
  players: number;
  personas: string[] | null;
  model: string;
  variant: string;
  gameTimeoutMs: number;
  llmTimeoutMs: number;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseArgs(argv = process.argv.slice(2)): SimArgs {
  const args: SimArgs = {
    games: 3,
    players: 6,
    personas: null,
    model: "gpt-5-nano",
    variant: process.env.INFLUENCE_SIM_VARIANT ?? "baseline",
    gameTimeoutMs: readPositiveInt(process.env.INFLUENCE_SIM_GAME_TIMEOUT_MS, DEFAULT_GAME_TIMEOUT_MS),
    llmTimeoutMs: readPositiveInt(process.env.INFLUENCE_SIM_LLM_TIMEOUT_MS, DEFAULT_LLM_TIMEOUT_MS),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--games" && next) {
      args.games = parseInt(next, 10);
      i++;
    } else if (arg === "--players" && next) {
      args.players = parseInt(next, 10);
      i++;
    } else if (arg === "--personas" && next) {
      args.personas = next.split(",").map((s) => s.trim());
      i++;
    } else if (arg === "--model" && next) {
      args.model = next;
      i++;
    } else if (arg === "--variant" && next) {
      args.variant = next;
      i++;
    } else if (arg === "--game-timeout-ms" && next) {
      args.gameTimeoutMs = parseInt(next, 10);
      i++;
    } else if (arg === "--game-timeout-sec" && next) {
      args.gameTimeoutMs = parseInt(next, 10) * 1000;
      i++;
    } else if (arg === "--llm-timeout-ms" && next) {
      args.llmTimeoutMs = parseInt(next, 10);
      i++;
    } else if (arg === "--llm-timeout-sec" && next) {
      args.llmTimeoutMs = parseInt(next, 10) * 1000;
      i++;
    }
  }

  if (isNaN(args.games) || args.games < 1) args.games = 3;
  if (isNaN(args.players) || args.players < 4) args.players = 4;
  if (args.players > DEFAULT_CONFIG.maxPlayers) args.players = DEFAULT_CONFIG.maxPlayers;
  if (isNaN(args.gameTimeoutMs) || args.gameTimeoutMs < 1) args.gameTimeoutMs = DEFAULT_GAME_TIMEOUT_MS;
  if (isNaN(args.llmTimeoutMs) || args.llmTimeoutMs < 1) args.llmTimeoutMs = DEFAULT_LLM_TIMEOUT_MS;

  return args;
}

function readGitField(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function readGitMetadata(): GitMetadata {
  const commitSha = readGitField(["rev-parse", "HEAD"]);
  const status = readGitField(["status", "--porcelain"]);

  return {
    branch: readGitField(["rev-parse", "--abbrev-ref", "HEAD"]),
    commitSha,
    commitShortSha: commitSha ? commitSha.slice(0, 7) : null,
    isDirty: status === null ? null : status.length > 0,
  };
}

function buildRunMetadata(args: SimArgs, timestamp: string): SimulationRunMetadata {
  return {
    variant: args.variant,
    timestamp,
    command: process.argv.join(" "),
    cwd: process.cwd(),
    git: readGitMetadata(),
    args: {
      games: args.games,
      players: args.players,
      personas: args.personas,
      model: args.model,
      variant: args.variant,
      gameTimeoutMs: args.gameTimeoutMs,
      llmTimeoutMs: args.llmTimeoutMs,
    },
  };
}

const POWER_LOBBY_VARIANTS = new Set([
  "power-lobby",
  "power-lobby-after-vote",
  "power-lobby-v2",
  "power-lobby-open-whisper",
  "open-whisper-power-lobby",
  "power-lobby-v2-open-whisper",
  "open-whisper-power-lobby-v2",
]);

const OPEN_WHISPER_VARIANTS = new Set([
  "baseline",
  "open-whisper",
  "power-lobby-open-whisper",
  "open-whisper-power-lobby",
  "power-lobby-v2-open-whisper",
  "open-whisper-power-lobby-v2",
]);

export function isPowerLobbyVariant(variant: string): boolean {
  return POWER_LOBBY_VARIANTS.has(variant.toLowerCase());
}

export function isOpenWhisperVariant(variant: string): boolean {
  return OPEN_WHISPER_VARIANTS.has(variant.toLowerCase());
}

export function buildSimulationConfig(variant: string): GameConfig {
  return {
    ...DEFAULT_CONFIG,
    timers: {
      introduction: 0,
      lobby: 0,
      whisper: 0,
      rumor: 0,
      vote: 0,
      power: 0,
      council: 0,
      plea: 0,
      accusation: 0,
      defense: 0,
      openingStatements: 0,
      juryQuestions: 0,
      closingArguments: 0,
      juryVote: 0,
    },
    maxRounds: 10,
    powerLobbyAfterVote: isPowerLobbyVariant(variant),
    whisperSessionsPerRound: isOpenWhisperVariant(variant) ? 2 : DEFAULT_CONFIG.whisperSessionsPerRound,
  };
}

// ---------------------------------------------------------------------------
// Cast of available personas
// ---------------------------------------------------------------------------

const FULL_CAST: Array<{ name: string; personality: Personality }> = [
  { name: "Atlas", personality: "strategic" },
  { name: "Vera", personality: "deceptive" },
  { name: "Finn", personality: "honest" },
  { name: "Mira", personality: "social" },
  { name: "Rex", personality: "aggressive" },
  { name: "Lyra", personality: "paranoid" },
  { name: "Kael", personality: "loyalist" },
  { name: "Echo", personality: "observer" },
  { name: "Sage", personality: "diplomat" },
  { name: "Jace", personality: "wildcard" },
  { name: "Rune", personality: "provocateur" },
  { name: "Wren", personality: "martyr" },
  { name: "Nyx", personality: "contrarian" },
  { name: "Vex", personality: "broker" },
];

function selectCast(
  count: number,
  requestedPersonas: string[] | null,
  openai: OpenAI,
  model: string,
): InfluenceAgent[] {
  let selected: Array<{ name: string; personality: Personality }>;

  if (requestedPersonas) {
    // Match requested names to the full cast
    selected = requestedPersonas
      .map((name) => FULL_CAST.find((c) => c.name.toLowerCase() === name.toLowerCase()))
      .filter((c): c is { name: string; personality: Personality } => c != null);

    if (selected.length < 4) {
      console.error(
        `Error: Only ${selected.length} valid personas found. Need at least 4. Available: ${FULL_CAST.map((c) => c.name).join(", ")}`,
      );
      process.exit(1);
    }
  } else {
    // Shuffle and pick `count` from the full cast
    const shuffled = [...FULL_CAST].sort(() => Math.random() - 0.5);
    selected = shuffled.slice(0, Math.min(count, shuffled.length));
  }

  return selected.map(({ name, personality }) => {
    const id: UUID = randomUUID();
    return new InfluenceAgent(id, name, personality, openai, model);
  });
}

// ---------------------------------------------------------------------------
// Game result types
// ---------------------------------------------------------------------------

export interface GameResult {
  gameNumber: number;
  status: "completed" | "failed";
  winnerName: string | undefined;
  winnerPersona: string | undefined;
  rounds: number;
  eliminationOrder: string[];
  endgameType: string;
  playerPersonas: Record<string, string>;
  durationMs: number;
  transcriptPath: string;
  jsonPath: string;
  progressPath: string;
  error?: string;
  tokenUsage: {
    perAgent: Record<string, TokenUsage>;
    total: TokenUsage;
  };
  instrumentation: GameInstrumentation;
}

export interface AggregateStats {
  metadata: SimulationRunMetadata;
  requestedGames: number;
  attemptedGames: number;
  totalGames: number;
  completedGames: number;
  failedGames: number;
  partial: boolean;
  model: string;
  perPersona: Record<
    string,
    {
      gamesPlayed: number;
      wins: number;
      winRate: number;
      avgSurvivalRound: number;
      timesEmpowered: number;
      timesOnJury: number;
    }
  >;
  perEndgameType: Record<string, number>;
  overall: {
    avgGameLength: number;
    roundDistribution: Record<number, number>;
    avgDurationMs: number;
  };
  tokenUsage: {
    total: TokenUsage;
    costEstimates: CostEstimate[];
  };
  instrumentation: BatchInstrumentation;
}

// ---------------------------------------------------------------------------
// Extract data from transcript
// ---------------------------------------------------------------------------

function extractEndgameType(transcript: readonly TranscriptEntry[]): string {
  let lastStage = "normal";
  for (const entry of transcript) {
    if (entry.scope === "system") {
      if (entry.text.includes("THE JUDGMENT")) lastStage = "judgment";
      else if (entry.text.includes("THE TRIBUNAL")) lastStage = "tribunal";
      else if (entry.text.includes("THE RECKONING")) lastStage = "reckoning";
    }
  }
  return lastStage;
}

function getSurvivalRound(
  eliminationOrder: string[],
  playerName: string,
  totalRounds: number,
): number {
  const idx = eliminationOrder.indexOf(playerName);
  if (idx === -1) return totalRounds; // Survived to the end
  // Approximate: eliminated earlier = lower round
  return Math.max(1, Math.ceil(((idx + 1) / eliminationOrder.length) * totalRounds));
}

// ---------------------------------------------------------------------------
// Aggregate stats computation
// ---------------------------------------------------------------------------

export function computeAggregateStats(
  results: GameResult[],
  model: string,
  metadata: SimulationRunMetadata,
  partial = false,
): AggregateStats {
  const completedResults = results.filter((result) => result.status === "completed");
  const perPersona: AggregateStats["perPersona"] = {};
  const perEndgameType: Record<string, number> = {};
  let totalRounds = 0;
  let totalDuration = 0;
  const roundDist: Record<number, number> = {};
  const batchTokens: TokenUsage = {
    promptTokens: 0,
    cachedTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    callCount: 0,
    emptyResponses: 0,
  };

  for (const result of completedResults) {
    // Track rounds
    totalRounds += result.rounds;
    totalDuration += result.durationMs;
    roundDist[result.rounds] = (roundDist[result.rounds] ?? 0) + 1;

    // Track endgame types
    perEndgameType[result.endgameType] = (perEndgameType[result.endgameType] ?? 0) + 1;

    // Accumulate token usage
    batchTokens.promptTokens += result.tokenUsage.total.promptTokens;
    batchTokens.cachedTokens += result.tokenUsage.total.cachedTokens;
    batchTokens.completionTokens += result.tokenUsage.total.completionTokens;
    batchTokens.reasoningTokens += result.tokenUsage.total.reasoningTokens;
    batchTokens.totalTokens += result.tokenUsage.total.totalTokens;
    batchTokens.callCount += result.tokenUsage.total.callCount;
    batchTokens.emptyResponses += result.tokenUsage.total.emptyResponses;

    // Track per-persona stats
    for (const [name, persona] of Object.entries(result.playerPersonas)) {
      if (!perPersona[persona]) {
        perPersona[persona] = {
          gamesPlayed: 0,
          wins: 0,
          winRate: 0,
          avgSurvivalRound: 0,
          timesEmpowered: 0,
          timesOnJury: 0,
        };
      }
      const stats = perPersona[persona]!;
      stats.gamesPlayed++;
      if (result.winnerName === name) stats.wins++;
      stats.avgSurvivalRound += getSurvivalRound(
        result.eliminationOrder,
        name,
        result.rounds,
      );
    }
  }

  // Compute averages
  for (const stats of Object.values(perPersona)) {
    stats.winRate = stats.gamesPlayed > 0 ? stats.wins / stats.gamesPlayed : 0;
    stats.avgSurvivalRound =
      stats.gamesPlayed > 0 ? stats.avgSurvivalRound / stats.gamesPlayed : 0;
  }

  return {
    metadata,
    requestedGames: metadata.args.games,
    attemptedGames: results.length,
    totalGames: completedResults.length,
    completedGames: completedResults.length,
    failedGames: results.length - completedResults.length,
    partial,
    model,
    perPersona,
    perEndgameType,
    overall: {
      avgGameLength: completedResults.length > 0 ? totalRounds / completedResults.length : 0,
      roundDistribution: roundDist,
      avgDurationMs: completedResults.length > 0 ? totalDuration / completedResults.length : 0,
    },
    tokenUsage: {
      total: batchTokens,
      costEstimates: estimateCostAllModels(batchTokens),
    },
    instrumentation: aggregateInstrumentation(completedResults.map((result) => result.instrumentation)),
  };
}

// ---------------------------------------------------------------------------
// Transcript formatting
// ---------------------------------------------------------------------------

function formatTranscript(transcript: readonly TranscriptEntry[]): string {
  return transcript
    .map((e) => {
      const prefix = `R${e.round}/${e.phase}`;
      const scopeTag = e.scope === "whisper" ? ` [whisper→${e.to?.join(",")}]` : "";
      return `${prefix} ${e.from}${scopeTag}: ${e.text}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Markdown summary
// ---------------------------------------------------------------------------

function renderMarkdownSummary(stats: AggregateStats, results: GameResult[]): string {
  const lines: string[] = [];

  lines.push("# Simulation Results");
  lines.push("");
  lines.push(`**Variant:** ${stats.metadata.variant}`);
  lines.push(`**Git:** ${stats.metadata.git.commitShortSha ?? "unknown"} (${stats.metadata.git.branch ?? "unknown branch"}${stats.metadata.git.isDirty ? ", dirty" : ""})`);
  lines.push(`**Command:** \`${stats.metadata.command}\``);
  lines.push(`**Timestamp:** ${stats.metadata.timestamp}`);
  lines.push(`**Games completed:** ${stats.completedGames}/${stats.requestedGames}`);
  lines.push(`**Games attempted:** ${stats.attemptedGames}`);
  if (stats.failedGames > 0) lines.push(`**Failed games:** ${stats.failedGames}`);
  if (stats.partial) lines.push("**Partial batch:** yes");
  lines.push(`**Model:** ${stats.model}`);
  lines.push(`**Timeouts:** game ${(stats.metadata.args.gameTimeoutMs / 1000).toFixed(0)}s, LLM request ${(stats.metadata.args.llmTimeoutMs / 1000).toFixed(0)}s`);
  lines.push(`**Avg game length:** ${stats.overall.avgGameLength.toFixed(1)} rounds`);
  lines.push(
    `**Avg duration:** ${(stats.overall.avgDurationMs / 1000).toFixed(0)}s per game`,
  );
  lines.push("");

  // Instrumentation summary
  lines.push("## Instrumentation");
  lines.push("");
  lines.push("| Signal | Count |");
  lines.push("|--------|------:|");
  lines.push(`| Power actions | ${stats.instrumentation.powerActions.total} |`);
  lines.push(`| Power eliminate | ${stats.instrumentation.powerActions.counts.eliminate} |`);
  lines.push(`| Power protect | ${stats.instrumentation.powerActions.counts.protect} |`);
  lines.push(`| Power pass | ${stats.instrumentation.powerActions.counts.pass} |`);
  lines.push(`| Empowered actors | ${Object.keys(stats.instrumentation.powerActions.actorCounts).length} |`);
  lines.push(`| Consecutive eliminate repeats | ${stats.instrumentation.powerActions.consecutiveEliminates.total} |`);
  lines.push(`| Repeated protect-same-target occurrences | ${stats.instrumentation.powerActions.repeatedProtectSameTarget.total} |`);
  lines.push(`| Auto-eliminations | ${stats.instrumentation.autoEliminations.total} |`);
  lines.push(`| Reveal phases | ${stats.instrumentation.council.revealPhases} |`);
  lines.push(`| Council phases | ${stats.instrumentation.council.councilPhases} |`);
  lines.push(`| Council votes | ${stats.instrumentation.council.councilVotes} |`);
  lines.push(`| Reckoning markers | ${stats.instrumentation.endgame.reckoning} |`);
  lines.push(`| Tribunal markers | ${stats.instrumentation.endgame.tribunal} |`);
  lines.push(`| Judgment markers | ${stats.instrumentation.endgame.judgment} |`);
  lines.push(`| Whisper rooms | ${stats.instrumentation.rooms.totalRooms} |`);
  lines.push(`| Whisper sessions instrumented | ${stats.instrumentation.rooms.whisperSessions.length} |`);
  lines.push(`| Room exclusions | ${stats.instrumentation.rooms.totalExclusions} |`);
  lines.push(`| Repeated room-pair occurrences | ${stats.instrumentation.rooms.repeatedPairs.totalRepeatedOccurrences} |`);
  lines.push(`| Request mutual matches honored | ${stats.instrumentation.rooms.requestSatisfaction.mutualHonored} |`);
  lines.push(`| Request one-way matches honored | ${stats.instrumentation.rooms.requestSatisfaction.oneWayHonored} |`);
  lines.push(`| Unmatched valid room requests | ${stats.instrumentation.rooms.requestSatisfaction.unmatchedValidRequests} |`);
  lines.push(`| Invalid/missing room requests | ${stats.instrumentation.rooms.requestSatisfaction.invalidOrMissingRequests} |`);
  lines.push(`| Immediate repeat rooms flagged | ${stats.instrumentation.rooms.repeatPairFlags.immediateRepeats} |`);
  lines.push(`| Avoidable consecutive exclusions flagged | ${stats.instrumentation.rooms.exclusionFlags.avoidableConsecutiveExclusions} |`);
  lines.push(`| LLM empty/fallback responses | ${stats.instrumentation.actionUsage.totalEmptyResponses} |`);
  lines.push("");

  if (Object.keys(stats.instrumentation.powerActions.actionDistributionByActor).length > 0) {
    lines.push("## Power Action Distribution");
    lines.push("");
    lines.push("| Actor | Actions | Eliminate | Protect | Pass |");
    lines.push("|-------|--------:|----------:|--------:|-----:|");
    const actors = Object.keys(stats.instrumentation.powerActions.actionDistributionByActor).sort(
      (a, b) =>
        (stats.instrumentation.powerActions.actorCounts[b] ?? 0) -
          (stats.instrumentation.powerActions.actorCounts[a] ?? 0) ||
        a.localeCompare(b),
    );
    for (const actor of actors) {
      const distribution = stats.instrumentation.powerActions.actionDistributionByActor[actor];
      if (!distribution) continue;
      lines.push(
        `| ${actor} | ${stats.instrumentation.powerActions.actorCounts[actor] ?? 0} | ${distribution.eliminate} | ${distribution.protect} | ${distribution.pass} |`,
      );
    }
    lines.push("");
  }

  if (stats.instrumentation.powerActions.consecutiveEliminates.occurrences.length > 0) {
    lines.push("## Consecutive Power Eliminates");
    lines.push("");
    lines.push("| Actor | Rounds | Targets |");
    lines.push("|-------|--------|---------|");
    for (const occurrence of stats.instrumentation.powerActions.consecutiveEliminates.occurrences) {
      lines.push(
        `| ${occurrence.actor} | ${occurrence.previousRound} -> ${occurrence.round} | ${occurrence.previousTarget} -> ${occurrence.target} |`,
      );
    }
    lines.push("");
  }

  if (stats.instrumentation.powerActions.repeatedProtectSameTarget.repeats.length > 0) {
    lines.push("## Repeated Protect Targets");
    lines.push("");
    lines.push("| Actor | Target | Protects | Repeats | Rounds |");
    lines.push("|-------|--------|---------:|--------:|--------|");
    for (const repeat of stats.instrumentation.powerActions.repeatedProtectSameTarget.repeats) {
      lines.push(
        `| ${repeat.actor} | ${repeat.target} | ${repeat.protectActions} | ${repeat.repeatedOccurrences} | ${repeat.rounds.join(", ")} |`,
      );
    }
    lines.push("");
  }

  if (Object.keys(stats.instrumentation.rooms.participationByPlayer).length > 0) {
    lines.push("## Room Participation");
    lines.push("");
    lines.push("| Player | Rooms | Exclusions |");
    lines.push("|--------|------:|-----------:|");
    const players = new Set([
      ...Object.keys(stats.instrumentation.rooms.participationByPlayer),
      ...Object.keys(stats.instrumentation.rooms.exclusionsByPlayer),
    ]);
    for (const player of [...players].sort()) {
      lines.push(
        `| ${player} | ${stats.instrumentation.rooms.participationByPlayer[player] ?? 0} | ${stats.instrumentation.rooms.exclusionsByPlayer[player] ?? 0} |`,
      );
    }
    lines.push("");
  }

  if (stats.instrumentation.rooms.repeatedPairs.pairs.length > 0) {
    lines.push("## Repeated Room Pairs");
    lines.push("");
    lines.push("| Pair | Count | Rounds |");
    lines.push("|------|------:|--------|");
    for (const pair of stats.instrumentation.rooms.repeatedPairs.pairs) {
      lines.push(`| ${pair.pair.join(" + ")} | ${pair.count} | ${pair.rounds.join(", ")} |`);
    }
    lines.push("");
  }

  if (Object.keys(stats.instrumentation.actionUsage.byAction).length > 0) {
    lines.push("## LLM Action Usage");
    lines.push("");
    lines.push("| Action | Calls | Empty/Fallback | Empty Rate | Tokens |");
    lines.push("|--------|------:|---------------:|-----------:|-------:|");
    const actionEntries = Object.entries(stats.instrumentation.actionUsage.byAction).sort(
      ([, a], [, b]) => b.callCount - a.callCount,
    );
    for (const [action, usage] of actionEntries) {
      lines.push(
        `| ${action} | ${usage.callCount} | ${usage.emptyResponses} | ${(usage.emptyResponseRate * 100).toFixed(1)}% | ${usage.totalTokens.toLocaleString()} |`,
      );
    }
    lines.push("");
  }

  // Per-persona table
  lines.push("## Per-Persona Stats");
  lines.push("");
  lines.push("| Persona | Played | Wins | Win Rate | Avg Survival |");
  lines.push("|---------|--------|------|----------|--------------|");

  const sorted = Object.entries(stats.perPersona).sort(
    ([, a], [, b]) => b.winRate - a.winRate,
  );
  for (const [persona, s] of sorted) {
    lines.push(
      `| ${persona} | ${s.gamesPlayed} | ${s.wins} | ${(s.winRate * 100).toFixed(0)}% | ${s.avgSurvivalRound.toFixed(1)} |`,
    );
  }

  lines.push("");

  // Endgame type distribution
  lines.push("## Endgame Types");
  lines.push("");
  lines.push("| Type | Count |");
  lines.push("|------|-------|");
  for (const [type, count] of Object.entries(stats.perEndgameType)) {
    lines.push(`| ${type} | ${count} |`);
  }

  lines.push("");

  // Round distribution
  lines.push("## Round Distribution");
  lines.push("");
  lines.push("| Rounds | Games |");
  lines.push("|--------|-------|");
  for (const [rounds, count] of Object.entries(stats.overall.roundDistribution).sort(
    ([a], [b]) => Number(a) - Number(b),
  )) {
    lines.push(`| ${rounds} | ${count} |`);
  }

  lines.push("");

  // Token usage summary
  lines.push("## Token Usage");
  lines.push("");
  const tu = stats.tokenUsage.total;
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total LLM calls | ${tu.callCount.toLocaleString()} |`);
  lines.push(`| Prompt tokens | ${tu.promptTokens.toLocaleString()} |`);
  lines.push(`| Cached input tokens | ${tu.cachedTokens.toLocaleString()} |`);
  lines.push(`| Completion tokens | ${tu.completionTokens.toLocaleString()} |`);
  if (tu.reasoningTokens > 0) {
    lines.push(`| Reasoning tokens (CoT) | ${tu.reasoningTokens.toLocaleString()} |`);
    lines.push(`| Visible output tokens | ${(tu.completionTokens - tu.reasoningTokens).toLocaleString()} |`);
  }
  lines.push(`| Total tokens | ${tu.totalTokens.toLocaleString()} |`);
  if (tu.emptyResponses > 0) {
    lines.push(`| Empty/fallback responses | ${tu.emptyResponses} (${((tu.emptyResponses / tu.callCount) * 100).toFixed(1)}%) |`);
  }
  lines.push("");

  // Cost estimates across model tiers
  lines.push("## Cost Estimates");
  lines.push("");
  lines.push("| Model | Input Cost | Output Cost | Total Cost |");
  lines.push("|-------|-----------|-------------|------------|");
  for (const est of stats.tokenUsage.costEstimates) {
    const marker = est.model === stats.model ? " *" : "";
    lines.push(
      `| ${est.model}${marker} | $${est.inputCost.toFixed(4)} | $${est.outputCost.toFixed(4)} | $${est.totalCost.toFixed(4)} |`,
    );
  }
  lines.push("");
  lines.push(`_* = model used for this simulation_`);
  lines.push("");

  // Individual game results
  lines.push("## Individual Games");
  lines.push("");
  lines.push("| # | Status | Winner | Persona | Rounds | Endgame | Duration | Tokens | LLM Calls |");
  lines.push("|---|--------|--------|---------|--------|---------|----------|--------|-----------|");
  for (const r of results) {
    lines.push(
      `| ${r.gameNumber} | ${r.status} | ${r.winnerName ?? "draw"} | ${r.winnerPersona ?? "-"} | ${r.rounds} | ${r.endgameType} | ${(r.durationMs / 1000).toFixed(0)}s | ${r.tokenUsage.total.totalTokens.toLocaleString()} | ${r.tokenUsage.total.callCount} |`,
    );
  }

  const failed = results.filter((result) => result.status === "failed");
  if (failed.length > 0) {
    lines.push("");
    lines.push("## Failed Game Diagnostics");
    lines.push("");
    lines.push("| # | Error | Progress Log | Transcript |");
    lines.push("|---|-------|--------------|------------|");
    for (const result of failed) {
      lines.push(
        `| ${result.gameNumber} | ${(result.error ?? "unknown").replace(/\|/g, "\\|")} | ${result.progressPath} | ${result.transcriptPath} |`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

function writeBatchArtifacts(
  batchDir: string,
  metadata: SimulationRunMetadata,
  model: string,
  results: GameResult[],
  partial: boolean,
): { stats: AggregateStats; markdown: string } {
  const stats = computeAggregateStats(results, model, metadata, partial);
  const markdown = renderMarkdownSummary(stats, results);

  writeFileSync(join(batchDir, "summary.md"), markdown);
  writeFileSync(join(batchDir, "stats.json"), JSON.stringify(stats, null, 2));
  writeFileSync(
    join(batchDir, "results.json"),
    JSON.stringify(
      {
        metadata,
        stats,
        games: results,
      },
      null,
      2,
    ),
  );

  return { stats, markdown };
}

class SimulationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Simulation game timed out after ${timeoutMs}ms`);
    this.name = "SimulationTimeoutError";
  }
}

function runWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      onTimeout();
      reject(new SimulationTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function summarizeProgressEvent(event: GameStreamEvent): Record<string, unknown> {
  if (event.type === "phase_change") {
    return {
      event: event.type,
      phase: event.phase,
      round: event.round,
      alivePlayers: event.alivePlayers.map((player) => player.name),
    };
  }

  if (event.type === "transcript_entry") {
    const entry = event.entry;
    return {
      event: event.type,
      round: entry.round,
      phase: entry.phase,
      scope: entry.scope,
      from: entry.from,
      textPreview: entry.text.replace(/\s+/g, " ").slice(0, 160),
      ...(entry.to && { to: entry.to }),
      ...(entry.roomId != null && { roomId: entry.roomId }),
      ...(entry.roomMetadata && {
        roomMetadata: {
          rooms: entry.roomMetadata.rooms.map((room) => ({
            roomId: room.roomId,
            playerCount: room.playerIds.length,
          })),
          excluded: entry.roomMetadata.excluded,
        },
      }),
    };
  }

  if (event.type === "player_eliminated") {
    return {
      event: event.type,
      round: event.round,
      playerName: event.playerName,
    };
  }

  return {
    event: event.type,
    winnerName: event.winnerName,
    totalRounds: event.totalRounds,
  };
}

function writeProgress(
  progressPath: string,
  gameNumber: number,
  startedAt: number,
  event: Record<string, unknown>,
): void {
  appendFileSync(
    progressPath,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      gameNumber,
      ...event,
    })}\n`,
  );
}

function attachProgressLogger(
  runner: GameRunner,
  progressPath: string,
  gameNumber: number,
  startedAt: number,
): void {
  runner.setStreamListener((event) => {
    const progress = summarizeProgressEvent(event);
    writeProgress(progressPath, gameNumber, startedAt, progress);

    if (event.type === "phase_change") {
      console.log(
        `  Progress: R${event.round} ${event.phase} | alive=${event.alivePlayers.map((player) => player.name).join(", ")}`,
      );
    } else if (event.type === "transcript_entry" && event.entry.roomMetadata) {
      console.log(
        `  Progress: R${event.entry.round} room allocation | rooms=${event.entry.roomMetadata.rooms.length} | excluded=${event.entry.roomMetadata.excluded.join(", ") || "none"}`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  const runTimestamp = new Date().toISOString();
  const metadata = buildRunMetadata(args, runTimestamp);

  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "Error: OPENAI_API_KEY not set. Run from the repo root via: bun run simulate",
    );
    process.exit(1);
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: args.llmTimeoutMs,
    maxRetries: 0,
  });

  console.log(`\n=== Influence Batch Simulation ===`);
  console.log(`Games: ${args.games} | Players per game: ${args.players} | Model: ${args.model} | Variant: ${args.variant}`);
  console.log(`Timeouts: game ${(args.gameTimeoutMs / 1000).toFixed(0)}s | LLM request ${(args.llmTimeoutMs / 1000).toFixed(0)}s`);
  console.log(`Git: ${metadata.git.commitShortSha ?? "unknown"} (${metadata.git.branch ?? "unknown branch"}${metadata.git.isDirty ? ", dirty" : ""})`);
  if (args.personas) console.log(`Personas: ${args.personas.join(", ")}`);
  console.log("");

  // Simulation config: no timers (agents respond as fast as they can)
  const simConfig = buildSimulationConfig(args.variant);

  // Create output directory
  const timestamp = runTimestamp.replace(/[:.]/g, "-").slice(0, 19);
  const batchDir = join(import.meta.dir, "..", "docs", "simulations", `batch-${timestamp}`);
  mkdirSync(batchDir, { recursive: true });
  console.log(`Artifacts: ${batchDir}`);
  console.log("");

  const results: GameResult[] = [];
  let timedOutGame = false;
  const flushPartialAndExit = (signal: "SIGINT" | "SIGTERM"): void => {
    writeBatchArtifacts(batchDir, metadata, args.model, results, true);
    console.error(
      `\n${signal} received. Partial aggregate artifacts saved from ${results.filter((result) => result.status === "completed").length} completed game(s) to: ${batchDir}`,
    );
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", () => flushPartialAndExit("SIGINT"));
  process.once("SIGTERM", () => flushPartialAndExit("SIGTERM"));

  for (let g = 1; g <= args.games; g++) {
    console.log(`--- Game ${g}/${args.games} ---`);
    const startTime = Date.now();

    // Create fresh agents for each game
    const agents = selectCast(args.players, args.personas, openai, args.model);
    const playerPersonas: Record<string, string> = {};
    const playerNameById: Record<string, string> = {};
    const gameTracker = new TokenTracker();
    for (const agent of agents) {
      playerPersonas[agent.name] = agent.personality;
      playerNameById[agent.id] = agent.name;
      agent.setTokenTracker(gameTracker);
    }

    console.log(`  Players: ${agents.map((a) => a.name).join(", ")}`);

    const houseInterviewer = new LLMHouseInterviewer(openai, args.model);
    houseInterviewer.setTokenTracker(gameTracker);
    const runner = new GameRunner(agents, simConfig, houseInterviewer);
    const transcriptPath = join(batchDir, `game-${g}.txt`);
    const jsonPath = join(batchDir, `game-${g}.json`);
    const progressPath = join(batchDir, `game-${g}-progress.jsonl`);
    writeProgress(progressPath, g, startTime, {
      event: "game_start",
      players: agents.map((agent) => agent.name),
      variant: args.variant,
      model: args.model,
      gameTimeoutMs: args.gameTimeoutMs,
      llmTimeoutMs: args.llmTimeoutMs,
      transcriptPath,
      jsonPath,
    });
    attachProgressLogger(runner, progressPath, g, startTime);
    console.log(`  Progress log: ${progressPath}`);

    try {
      const result = await runWithTimeout(
        runner.run(),
        args.gameTimeoutMs,
        () => {
          runner.abort();
          writeProgress(progressPath, g, startTime, {
            event: "game_timeout",
            timeoutMs: args.gameTimeoutMs,
            transcriptEntries: runner.transcriptLog.length,
          });
        },
      );
      const durationMs = Date.now() - startTime;

      const eliminationOrder = result.eliminationOrder;
      const endgameType = extractEndgameType(result.transcript);

      const gameTotalUsage = gameTracker.getTotalUsage();
      const perAgentUsage = gameTracker.getAllUsage();
      const instrumentation = instrumentGame(result.transcript, perAgentUsage, playerNameById);
      const gameResult: GameResult = {
        gameNumber: g,
        status: "completed",
        winnerName: result.winnerName,
        winnerPersona: result.winnerName ? playerPersonas[result.winnerName] : undefined,
        rounds: result.rounds,
        eliminationOrder,
        endgameType,
        playerPersonas,
        durationMs,
        transcriptPath,
        jsonPath,
        progressPath,
        tokenUsage: {
          perAgent: perAgentUsage,
          total: gameTotalUsage,
        },
        instrumentation,
      };
      results.push(gameResult);
      writeProgress(progressPath, g, startTime, {
        event: "game_completed",
        winnerName: result.winnerName ?? "draw",
        rounds: result.rounds,
        transcriptEntries: result.transcript.length,
      });

      console.log(
        `  Winner: ${result.winnerName ?? "draw"} (${gameResult.winnerPersona ?? "-"}) | Rounds: ${result.rounds} | ${(durationMs / 1000).toFixed(0)}s | ${gameTotalUsage.totalTokens.toLocaleString()} tokens (${gameTotalUsage.callCount} calls)`,
      );

      // Save transcript
      writeFileSync(transcriptPath, formatTranscript(result.transcript));
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            metadata,
            result: gameResult,
            transcript: result.transcript,
          },
          null,
          2,
        ),
      );
      writeBatchArtifacts(batchDir, metadata, args.model, results, g < args.games);
    } catch (err) {
      if (err instanceof SimulationTimeoutError) timedOutGame = true;
      const durationMs = Date.now() - startTime;
      console.error(`  Game ${g} FAILED after ${(durationMs / 1000).toFixed(0)}s: ${err}`);
      const transcript = [...runner.transcriptLog];
      const perAgentUsage = gameTracker.getAllUsage();
      const instrumentation = instrumentGame(transcript, perAgentUsage, playerNameById);
      const gameResult: GameResult = {
        gameNumber: g,
        status: "failed",
        winnerName: undefined,
        winnerPersona: undefined,
        rounds: 0,
        eliminationOrder: [],
        endgameType: "error",
        playerPersonas,
        durationMs,
        transcriptPath,
        jsonPath,
        progressPath,
        error: err instanceof Error ? err.message : String(err),
        tokenUsage: {
          perAgent: perAgentUsage,
          total: gameTracker.getTotalUsage(),
        },
        instrumentation,
      };
      results.push(gameResult);
      writeProgress(progressPath, g, startTime, {
        event: "game_failed",
        error: gameResult.error ?? "unknown error",
        transcriptEntries: transcript.length,
      });
      writeFileSync(transcriptPath, formatTranscript(transcript));
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            metadata,
            result: gameResult,
            transcript,
          },
          null,
          2,
        ),
      );
      writeBatchArtifacts(batchDir, metadata, args.model, results, g < args.games);
      if (timedOutGame) break;
    }
  }

  // Compute aggregates
  const { stats, markdown } = writeBatchArtifacts(batchDir, metadata, args.model, results, false);

  // Output structured JSON
  console.log("\n=== Aggregate Stats (JSON) ===\n");
  console.log(JSON.stringify(stats, null, 2));

  // Output markdown summary
  console.log("\n" + markdown);

  console.log(`\nSimulation artifacts saved to: ${batchDir}`);
  if (stats.failedGames > 0) {
    console.error(`Simulation completed with ${stats.failedGames} failed game(s). See progress logs in: ${batchDir}`);
    if (timedOutGame) process.exit(1);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
