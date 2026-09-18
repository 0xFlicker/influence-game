#!/usr/bin/env bun
/**
 * Rank producer-transcript moments for a human video-design review.
 *
 * This is deliberately a recommendation aid, not a source of game truth.
 * It groups only adjacent actor-authored dialogue with their own thinking and
 * strategy artifacts; a producer must confirm the actual event record before
 * presenting a scene as fact.
 *
 * Usage:
 *   bun run scene-candidates <capture.json> <output.md> [limit]
 */
import { readFile, writeFile } from "node:fs/promises";

interface NarrativeGroup {
  actor?: string | { name?: string | null } | null;
  action?: string | null;
  phase?: string | null;
  round?: number | null;
  scope?: string;
  seq?: number;
  text?: string;
  thinking?: string;
  strategy?: string;
}

interface Capture {
  game?: { slug?: string };
  pages?: Array<{ groups?: NarrativeGroup[] }>;
}

const TERMS: ReadonlyArray<readonly [RegExp, number]> = [
  [/betray|blindside|double.?cross|turn on|backstab/i, 8],
  [/plead|survival|pressure point|pile-on|vulnerable|exit/i, 5],
  [/alliance|aligned|protect|relationship|commitment/i, 4],
  [/power|empower|chooser|shield|tiebreak|vote|ballot/i, 4],
  [/counter|redirect|pivot|fallback|conditional|leverage/i, 3],
  [/secret|private|huddle|mingle|corroboration/i, 2],
];

function actorName(actor: NarrativeGroup["actor"]): string | null {
  if (typeof actor === "string") return actor;
  return actor?.name ?? null;
}

function score(group: NarrativeGroup): number {
  const haystack = [group.text, group.thinking, group.strategy].filter(Boolean).join("\n");
  return TERMS.reduce((total, [pattern, value]) => total + (pattern.test(haystack) ? value : 0), 0);
}

function excerpt(value: string | undefined, maxLength = 420): string | null {
  if (!value) return null;
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

const [capturePath, outputPath, limitArgument] = process.argv.slice(2);
if (!capturePath || !outputPath) {
  throw new Error("Usage: bun run scene-candidates <capture.json> <output.md> [limit]");
}
const limit = Number.parseInt(limitArgument ?? "12", 10);
if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");

const capture = JSON.parse(await readFile(capturePath, "utf8")) as Capture;
const candidates = (capture.pages ?? [])
  .flatMap((page) => page.groups ?? [])
  .filter((group) => group.scope !== "system" && Boolean(group.text))
  .map((group) => ({ group, score: score(group) }))
  .filter((candidate) => candidate.score > 0)
  .sort((left, right) => right.score - left.score || (left.group.seq ?? 0) - (right.group.seq ?? 0))
  .slice(0, limit);

const document = [
  `# Video scene candidates: ${capture.game?.slug ?? "unknown game"}`,
  "",
  "> Private producer working document. Scores are heuristic review prompts, not factual claims or an authorization to portray unseen events.",
  "",
  "## Review rule",
  "",
  "Confirm every external fact, action, and outcome against canonical events before publishing. Transcript dialogue, thinking, and strategy guide emotional subtext and shot choice; they do not establish game truth.",
  "",
  "## Candidates",
  "",
  ...candidates.flatMap(({ group, score: candidateScore }, index) => [
    `### ${index + 1}. ${actorName(group.actor) ?? "Unknown actor"} — score ${candidateScore}`,
    "",
    `- Sequence: ${group.seq ?? "unknown"}`,
    `- Round / phase: ${group.round ?? "unknown"} / ${group.phase ?? "unknown"}`,
    `- Surface: ${group.action ?? group.scope ?? "unknown"}`,
    "",
    `**Dialogue**  \n${excerpt(group.text) ?? "—"}`,
    "",
    ...(excerpt(group.thinking) ? [`**Private strategic cue**  \n${excerpt(group.thinking)}`] : []),
    ...(excerpt(group.strategy) ? [`**Strategy artifact**  \n${excerpt(group.strategy)}`] : []),
    "",
  ]),
].join("\n");

await writeFile(outputPath, `${document}\n`, { mode: 0o600 });
console.log(`Wrote ${candidates.length} scene candidates to ${outputPath}`);
