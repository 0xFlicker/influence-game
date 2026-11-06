import { eq } from "drizzle-orm";
import { closeDB, createDB, schema } from "../db/index.js";
import { readEpisodePresentations } from "../services/episode-presentation.js";

const url = process.env.PUBLIC_SHELF_BENCHMARK_URL;
if (!url) throw new Error("Run scripts/benchmark-public-shelf.sh");
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/influence_test") throw new Error("Benchmark requires an isolated loopback database");
const db = createDB(url);
try {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, "shelf-season-game-10000"));
  if (!game) throw new Error("Synthetic season fixture missing");
  for (const includeEpisodeNumbers of [true, false, true, false]) {
    const started = performance.now();
    const episode = (await readEpisodePresentations(db, [game], { includeEpisodeNumbers })).get(game.id);
    if (!episode || episode.episodeNumber !== (includeEpisodeNumbers ? 10000 : null)) throw new Error("Unexpected episode projection");
    console.log(JSON.stringify({ kind: includeEpisodeNumbers ? "season numbering" : "selected episode only", durationMs: Math.round(performance.now() - started) }));
  }
} finally { await closeDB(url); }
