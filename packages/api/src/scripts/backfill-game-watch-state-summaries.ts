import { createDB } from "../db/index.js";
import { backfillGameWatchStateSummaries } from "../services/game-watch-state-summary.js";

function parseArgs(argv: readonly string[]): { force: boolean; limit?: number } {
  let force = false;
  let limit: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--limit") {
      const value = argv[i + 1];
      if (!value) throw new Error("--limit requires a number");
      limit = parseLimit(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      limit = parseLimit(arg.slice("--limit=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return limit === undefined ? { force } : { force, limit };
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid --limit value: ${value}`);
  }
  return parsed;
}

const { force, limit } = parseArgs(process.argv.slice(2));
const db = createDB(process.env.DATABASE_URL);
const result = await backfillGameWatchStateSummaries(db, {
  force,
  ...(limit !== undefined && { limit }),
});

console.log(JSON.stringify(result, null, 2));
process.exit(result.failed > 0 ? 1 : 0);
