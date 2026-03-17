#!/usr/bin/env bun
/**
 * Influence Game — Batch Simulation Runner
 *
 * Runs multiple game simulations and outputs structured analysis.
 *
 * Usage:
 *   doppler run -- bun run simulate
 *   doppler run -- bun run simulate -- --games 5 --players 6
 *   doppler run -- bun run simulate -- --games 3 --players 4 --personas Atlas,Vera,Finn,Mira
 */

import OpenAI from "openai";
import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { GameRunner, type TranscriptEntry } from "./game-runner";
import { InfluenceAgent, type Personality } from "./agent";
import { LLMHouseInterviewer } from "./house-interviewer";
import { DEFAULT_CONFIG, type GameConfig, type UUID } from "./types";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface SimArgs {
  games: number;
  players: number;
  personas: string[] | null;
}

function parseArgs(): SimArgs {
  const argv = process.argv.slice(2);
  const args: SimArgs = { games: 3, players: 6, personas: null };

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
    }
  }

  if (isNaN(args.games) || args.games < 1) args.games = 3;
  if (isNaN(args.players) || args.players < 4) args.players = 4;
  if (args.players > 10) args.players = 10;

  return args;
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
];

function selectCast(
  count: number,
  requestedPersonas: string[] | null,
  openai: OpenAI,
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
    return new InfluenceAgent(id, name, personality, openai, "gpt-4o-mini");
  });
}

// ---------------------------------------------------------------------------
// Game result types
// ---------------------------------------------------------------------------

interface GameResult {
  gameNumber: number;
  winnerName: string | undefined;
  winnerPersona: string | undefined;
  rounds: number;
  eliminationOrder: string[];
  endgameType: string;
  playerPersonas: Record<string, string>;
  durationMs: number;
}

interface AggregateStats {
  totalGames: number;
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
}

// ---------------------------------------------------------------------------
// Extract data from transcript
// ---------------------------------------------------------------------------

function extractEliminationOrder(transcript: readonly TranscriptEntry[]): string[] {
  const eliminated: string[] = [];
  for (const entry of transcript) {
    if (entry.scope === "system") {
      // Match elimination announcements
      const match = entry.text.match(/(\w+) has been eliminated/);
      if (match && match[1] && !eliminated.includes(match[1])) {
        eliminated.push(match[1]);
      }
    }
  }
  return eliminated;
}

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

function countEmpowerments(transcript: readonly TranscriptEntry[], playerName: string): number {
  let count = 0;
  for (const entry of transcript) {
    if (entry.scope === "system" && entry.text.includes(`${playerName} is empowered`)) {
      count++;
    }
  }
  return count;
}

function countJuryAppearances(transcript: readonly TranscriptEntry[], playerName: string): number {
  let count = 0;
  for (const entry of transcript) {
    if (entry.scope === "system" && entry.text.includes("Jury:") && entry.text.includes(playerName)) {
      count++;
    }
  }
  return count > 0 ? 1 : 0; // Binary: was on jury or not
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

function computeAggregateStats(results: GameResult[]): AggregateStats {
  const perPersona: AggregateStats["perPersona"] = {};
  const perEndgameType: Record<string, number> = {};
  let totalRounds = 0;
  let totalDuration = 0;
  const roundDist: Record<number, number> = {};

  for (const result of results) {
    // Track rounds
    totalRounds += result.rounds;
    totalDuration += result.durationMs;
    roundDist[result.rounds] = (roundDist[result.rounds] ?? 0) + 1;

    // Track endgame types
    perEndgameType[result.endgameType] = (perEndgameType[result.endgameType] ?? 0) + 1;

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
    totalGames: results.length,
    perPersona,
    perEndgameType,
    overall: {
      avgGameLength: results.length > 0 ? totalRounds / results.length : 0,
      roundDistribution: roundDist,
      avgDurationMs: results.length > 0 ? totalDuration / results.length : 0,
    },
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
  lines.push(`**Games played:** ${stats.totalGames}`);
  lines.push(`**Avg game length:** ${stats.overall.avgGameLength.toFixed(1)} rounds`);
  lines.push(
    `**Avg duration:** ${(stats.overall.avgDurationMs / 1000).toFixed(0)}s per game`,
  );
  lines.push("");

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

  // Individual game results
  lines.push("## Individual Games");
  lines.push("");
  lines.push("| # | Winner | Persona | Rounds | Endgame | Duration |");
  lines.push("|---|--------|---------|--------|---------|----------|");
  for (const r of results) {
    lines.push(
      `| ${r.gameNumber} | ${r.winnerName ?? "draw"} | ${r.winnerPersona ?? "-"} | ${r.rounds} | ${r.endgameType} | ${(r.durationMs / 1000).toFixed(0)}s |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY not set. Run via: doppler run -- bun run simulate");
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log(`\n=== Influence Batch Simulation ===`);
  console.log(`Games: ${args.games} | Players per game: ${args.players}`);
  if (args.personas) console.log(`Personas: ${args.personas.join(", ")}`);
  console.log("");

  // Simulation config: no timers (agents respond as fast as they can)
  const simConfig: GameConfig = {
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
  };

  // Create output directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const batchDir = join(import.meta.dir, "..", "docs", "simulations", `batch-${timestamp}`);
  mkdirSync(batchDir, { recursive: true });

  const results: GameResult[] = [];

  for (let g = 1; g <= args.games; g++) {
    console.log(`--- Game ${g}/${args.games} ---`);
    const startTime = Date.now();

    // Create fresh agents for each game
    const agents = selectCast(args.players, args.personas, openai);
    const playerPersonas: Record<string, string> = {};
    for (const agent of agents) {
      playerPersonas[agent.name] = agent.personality;
    }

    console.log(`  Players: ${agents.map((a) => a.name).join(", ")}`);

    const houseInterviewer = new LLMHouseInterviewer(openai);
    const runner = new GameRunner(agents, simConfig, houseInterviewer);

    try {
      const result = await runner.run();
      const durationMs = Date.now() - startTime;

      const eliminationOrder = extractEliminationOrder(result.transcript);
      const endgameType = extractEndgameType(result.transcript);

      const gameResult: GameResult = {
        gameNumber: g,
        winnerName: result.winnerName,
        winnerPersona: result.winnerName ? playerPersonas[result.winnerName] : undefined,
        rounds: result.rounds,
        eliminationOrder,
        endgameType,
        playerPersonas,
        durationMs,
      };
      results.push(gameResult);

      console.log(
        `  Winner: ${result.winnerName ?? "draw"} (${gameResult.winnerPersona ?? "-"}) | Rounds: ${result.rounds} | ${(durationMs / 1000).toFixed(0)}s`,
      );

      // Save transcript
      const transcriptPath = join(batchDir, `game-${g}.txt`);
      writeFileSync(transcriptPath, formatTranscript(result.transcript));
    } catch (err) {
      const durationMs = Date.now() - startTime;
      console.error(`  Game ${g} FAILED after ${(durationMs / 1000).toFixed(0)}s: ${err}`);
      results.push({
        gameNumber: g,
        winnerName: undefined,
        winnerPersona: undefined,
        rounds: 0,
        eliminationOrder: [],
        endgameType: "error",
        playerPersonas,
        durationMs,
      });
    }
  }

  // Compute aggregates
  const stats = computeAggregateStats(results);

  // Output structured JSON
  console.log("\n=== Aggregate Stats (JSON) ===\n");
  console.log(JSON.stringify(stats, null, 2));

  // Output markdown summary
  const markdown = renderMarkdownSummary(stats, results);
  console.log("\n" + markdown);

  // Save summary to batch directory
  writeFileSync(join(batchDir, "summary.md"), markdown);
  writeFileSync(join(batchDir, "stats.json"), JSON.stringify(stats, null, 2));

  console.log(`\nTranscripts saved to: ${batchDir}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
