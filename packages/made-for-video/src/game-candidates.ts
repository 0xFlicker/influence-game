#!/usr/bin/env bun
/**
 * Rank recent public House game summaries for producer review.
 *
 * Usage:
 *   bun run game-candidates <summaries.json> <output.md> [limit]
 *
 * The input may be an array or an object with a `games` array. Each item may
 * contain `slug`, `title`, `summary`, and `createdAt`. This accepts a saved
 * House MCP result without coupling the package to a particular MCP transport.
 */
import { readFile, writeFile } from "node:fs/promises";

interface GameSummary {
  slug?: unknown;
  title?: unknown;
  summary?: unknown;
  createdAt?: unknown;
}

const TERMS: ReadonlyArray<readonly [RegExp, number]> = [
  [/betray|blindside|double.?cross|backstab/i, 9],
  [/scheme|plot|counter.?plan|maneuver|leverage/i, 6],
  [/twist|reversal|turnaround|pivot/i, 5],
  [/alliance|loyal|defect|fracture/i, 4],
  [/power|empower|shield|chooser|tiebreak/i, 4],
  [/plea|accus|final|vote|exit/i, 3],
];

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function score(summary: string): number {
  return TERMS.reduce((total, [pattern, value]) => total + (pattern.test(summary) ? value : 0), 0);
}

const [inputPath, outputPath, limitArgument] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: bun run game-candidates <summaries.json> <output.md> [limit]");
const limit = Number.parseInt(limitArgument ?? "12", 10);
if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");

const parsed = JSON.parse(await readFile(inputPath, "utf8")) as GameSummary[] | { games?: GameSummary[] };
const games = Array.isArray(parsed) ? parsed : parsed.games;
if (!Array.isArray(games)) throw new Error("Expected an array of game summaries or an object with a games array.");

const ranked = games
  .map((game) => {
    const summary = string(game.summary) ?? "";
    return { game, summary, score: score(summary) };
  })
  .filter((candidate) => candidate.summary && candidate.score > 0)
  .sort((left, right) => right.score - left.score)
  .slice(0, limit);

const document = [
  "# House game candidates for video review",
  "",
  "> Rankings surface summaries with strategic or dramatic language. They are an editorial queue, not proof that a particular action, motive, or outcome occurred.",
  "",
  "## Next step",
  "",
  "For each promising game, export the producer transcript, verify the events, then choose a two-sided moment with exact dialogue and a clear shot/reverse-shot opportunity.",
  "",
  "## Ranked summaries",
  "",
  ...ranked.flatMap(({ game, summary, score: candidateScore }, index) => [
    `### ${index + 1}. ${string(game.title) ?? string(game.slug) ?? "Untitled game"} — score ${candidateScore}`,
    "",
    `- Slug: ${string(game.slug) ?? "unknown"}`,
    ...(string(game.createdAt) ? [`- Created: ${string(game.createdAt)}`] : []),
    "",
    summary,
    "",
  ]),
].join("\n");

await writeFile(outputPath, `${document}\n`, { mode: 0o600 });
console.log(`Wrote ${ranked.length} game candidates to ${outputPath}`);
