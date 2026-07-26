import { setupTestDB } from "../test-utils.js";

const holdMs = Number.parseInt(process.argv[2] ?? "0", 10);
const startedPath = process.argv[3];
const readyPath = process.argv[4];

if (!Number.isFinite(holdMs) || holdMs < 0 || !startedPath || !readyPath) {
  throw new Error("Usage: test-db-process-lock-probe.ts <hold-ms> <started-path> <ready-path>");
}

await Bun.write(startedPath, "started");
await setupTestDB();
await Bun.write(readyPath, "ready");
await Bun.sleep(holdMs);
process.exit(0);
