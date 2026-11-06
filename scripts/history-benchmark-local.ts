import { createDB, closeDB } from "../packages/api/src/db/index";
import { readHouseParticipation, readHouseParticipationPage } from "../packages/api/src/services/house-participation";
const url = process.env.HISTORY_BENCHMARK_URL;
if (!url) throw new Error("Use scripts/benchmark-history-page.sh");
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/influence_test") throw new Error("Benchmark requires a disposable loopback database");
const db = createDB(url);
try {
  for (const kind of ["page", "old", "page", "old"] as const) {
    const start = performance.now();
    const result = kind === "page" ? await readHouseParticipationPage(db, "history-benchmark-owner", 20, null) : await readHouseParticipation(db, "history-benchmark-owner");
    console.log(JSON.stringify({kind, rows: Array.isArray(result) ? result.length : result.items.length, ms: Math.round(performance.now() - start), bytes: Buffer.byteLength(JSON.stringify(result))}));
  }
} finally { await closeDB(url); }
