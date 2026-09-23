import { setupTestDB } from "../test-utils.js";

const releasePath = process.argv[2];
const startedPath = process.argv[3];
const readyPath = process.argv[4];

if (!releasePath || !startedPath || !readyPath) {
  throw new Error("Usage: test-db-process-lock-probe.ts <release-path-or-dash> <started-path> <ready-path>");
}

await Bun.write(startedPath, "started");
await setupTestDB();
await Bun.write(readyPath, "ready");
// The owner exits only after the parent has observed actual lock contention.
// Process startup speed must not decide whether this test exercises a waiter.
while (releasePath !== "-" && !(await Bun.file(releasePath).exists())) {
  await Bun.sleep(10);
}
process.exit(0);
