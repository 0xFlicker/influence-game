import { closeDB, createDB } from "../../packages/api/src/db/index";
import { readHouseParticipation } from "../../packages/api/src/services/house-participation";

// The shell runner creates and owns this disposable, loopback-only database.
const url = process.env.HISTORY_BENCHMARK_URL;
if (!url) throw new Error("Run scripts/benchmark-history-fixture.sh");
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/influence_test") throw new Error("Synthetic benchmark requires its disposable loopback database");
const db = createDB(url);
try {
  // These synthetic Influence games intentionally have no canonical events.
  // The bounded service option is a comparison only, not a paginated API.
  for (const limit of [20, 100, undefined]) {
    const started = performance.now();
    const rows = await readHouseParticipation(db, "history-benchmark-owner", { gameKind: "influence", limit });
    console.log(JSON.stringify({ limit: limit ?? "unbounded", rows: rows.length,
      durationMs: Math.round(performance.now() - started), bytes: Buffer.byteLength(JSON.stringify(rows)) }));
  }
} finally { await closeDB(url); }
