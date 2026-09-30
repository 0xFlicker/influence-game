import { closeDB, createDB } from "../db/index.js";
import { bootstrapInitialOperator, type InitialOperatorBootstrapInput } from "../services/initial-operator-bootstrap.js";

export const BOOTSTRAP_USAGE = "bootstrap-initial-operator --user-id <existing-account-id> --operator <local-operator-label> --dry-run|--apply";

export function parseBootstrapArguments(args: string[]): InitialOperatorBootstrapInput {
  let userId: string | undefined, operator: string | undefined, dryRun: boolean | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--user-id" || arg === "--operator") {
      const value = args[++index]?.trim();
      if (!value || value.startsWith("--")) throw new Error(BOOTSTRAP_USAGE);
      if (arg === "--user-id") { if (userId) throw new Error("Duplicate --user-id"); userId = value; }
      else { if (operator) throw new Error("Duplicate --operator"); operator = value; }
    } else if (arg === "--dry-run" || arg === "--apply") {
      if (dryRun !== undefined) throw new Error("Choose exactly one of --dry-run or --apply");
      dryRun = arg === "--dry-run";
    } else throw new Error(BOOTSTRAP_USAGE);
  }
  if (!userId || !operator || dryRun === undefined) throw new Error(BOOTSTRAP_USAGE);
  if (userId.length > 200 || operator.length > 120 || /[\x00-\x1f\x7f]/.test(userId + operator)) throw new Error("Invalid account ID or operator label");
  return { userId, operator, dryRun };
}

export async function runBootstrapCommand(args: string[], databaseUrl: string | undefined, output: (value: string) => void = console.log): Promise<number> {
  const input = parseBootstrapArguments(args);
  if (!databaseUrl?.trim()) throw new Error("DATABASE_URL is required; use the app's existing runtime environment");
  try {
    const result = await bootstrapInitialOperator(createDB(databaseUrl), input);
    output(JSON.stringify(result));
    return result.status === "blocked" ? 2 : 0;
  } finally { await closeDB(databaseUrl); }
}

if (import.meta.main) {
  try {
    if (process.argv.slice(2).includes("--help")) { console.log(BOOTSTRAP_USAGE); process.exitCode = 0; }
    else process.exitCode = await runBootstrapCommand(process.argv.slice(2), process.env.DATABASE_URL);
  } catch {
    // Never print connection strings, SQL parameters or driver error objects.
    console.error(`Bootstrap failed. Check arguments, DATABASE_URL and applied migrations. Usage: ${BOOTSTRAP_USAGE}`);
    process.exitCode = 1;
  }
}
