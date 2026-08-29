import { writeFile } from "node:fs/promises";

const mode = process.env.LOCAL_HARNESS_FIXTURE_MODE;
const pidFile = process.env.LOCAL_HARNESS_FIXTURE_PID_FILE;
if (!pidFile) throw new Error("LOCAL_HARNESS_FIXTURE_PID_FILE is required");
await writeFile(pidFile, String(process.pid));

if (mode === "malformed") {
  process.on("SIGTERM", () => process.exit(0));
  console.log("FIXTURE_READY {");
} else if (mode === "timeout") {
  process.on("SIGTERM", () => {});
} else if (mode === "ready-nonzero") {
  process.on("SIGTERM", () => process.exit(1));
  console.log("FIXTURE_READY {}");
} else {
  throw new Error(`Unknown local harness fixture mode: ${mode}`);
}

setInterval(() => {}, 1_000);
