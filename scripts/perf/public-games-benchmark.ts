import { closeDB, createDB } from "../../packages/api/src/db/index";
import { createGameRoutes } from "../../packages/api/src/routes/games";

const url = process.env.PUBLIC_SHELF_BENCHMARK_URL;
if (!url) throw new Error("Run scripts/benchmark-public-shelf.sh");
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/influence_test") throw new Error("Benchmark requires an isolated loopback test database");
const db = createDB(url);
const app = createGameRoutes(db);
try {
  for (const path of ["/api/games?limit=6", "/api/games", "/api/games?limit=6", "/api/games"]) {
    const started = performance.now();
    const response = await app.request(path);
    const body = await response.text();
    if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
    console.log(JSON.stringify({ path, durationMs: Math.round(performance.now() - started), rows: (JSON.parse(body) as unknown[]).length, bytes: Buffer.byteLength(body) }));
  }
} finally { await closeDB(url); }
