import { closeDB, createDB } from "../db/index.js";
import { backfillAgentScreenings } from "../services/agent-screening-backfill.js";

const args = process.argv.slice(2);
let apply = false, after: string | undefined, limit = 100;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--apply") apply = true;
  else if (arg === "--after" && args[i + 1]) after = args[++i];
  else if (arg === "--limit" && args[i + 1]) limit = Number(args[++i]);
  else throw new Error(`Unknown or incomplete argument: ${arg}`);
}
try {
  const result = await backfillAgentScreenings(createDB(), { apply, after, limit });
  console.log(JSON.stringify({ mode: apply ? "enqueue" : "dry-run", ...result }, null, 2));
  if (result.failures.length || result.conflicts.length) process.exitCode = 1;
} finally { await closeDB(); }
