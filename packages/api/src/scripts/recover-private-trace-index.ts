import { createDB, closeDB } from "../db/index.js";
import { recoverPrivateTraceIndex, PrivateTraceIndexRecoveryError } from "../services/private-trace-index-recovery.js";
import { safeEvidenceError } from "../services/evidence-errors.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const value = (name: string) => {
  const index = args.indexOf(name);
  const result = index >= 0 ? args[index + 1] : undefined;
  if (!result || result.startsWith("--")) throw new Error(`Missing ${name}`);
  return result;
};
try {
  const input = { gameId: value("--game"), key: value("--key"), expectedSha256: value("--sha256"), apply,
    ...(apply && { reason: value("--reason") }) };
  const db = createDB();
  console.log(JSON.stringify(await recoverPrivateTraceIndex(db, input), null, 2));
} catch (error) {
  // Driver and JSON parser errors can contain private data. Do not print them.
  console.error(error instanceof PrivateTraceIndexRecoveryError ? error.message : safeEvidenceError(error));
  process.exitCode = 1;
} finally {
  await closeDB();
}
