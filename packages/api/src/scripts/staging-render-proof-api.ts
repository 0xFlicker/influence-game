import postgres from "postgres";
import { renderExecutionConfig } from "@influence/engine/render-execution-config";
import { assertProofDatabase } from "../services/staging-render-proof.js";
import { createStagingRenderProofAPI } from "../services/staging-render-proof-api.js";
import { createDB, closeDB } from "../db/index.js";
import { dispatchRenderWakes } from "../services/postgame-media-execution.js";

async function main() {
const runId = process.env.INFLUENCE_RENDER_PROOF_RUN_ID;
if (!runId || process.env.NODE_ENV !== "staging" || process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT !== "staging"
  || !process.env.DATABASE_URL) throw new Error("Explicit isolated staging proof binding required");
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const identity = await assertProofDatabase(sql, runId);
const execution = renderExecutionConfig();
if (!process.env.POSTGAME_MEDIA_WORKER_TOKEN || !process.env.POSTGAME_MEDIA_CONTROL_TOKEN
  || process.env.INFLUENCE_STORAGE_BACKEND !== "s3") throw new Error("Proof requires separately entered worker/control and staging object-storage credentials");
if (execution.mode === "remote" && (process.env.POSTGAME_MEDIA_WAKE_URL !== identity.wakeUrl || !process.env.POSTGAME_MEDIA_WAKE_SECRET)) throw new Error("Exclusive proof wake producer configuration differs");
let healthy = true, stopped = false, checking = false;
const db = createDB();
const app = createStagingRenderProofAPI({ sql, runId, identity, execution, db,
  candidateSha: process.env.GIT_SHA ?? "", apiDigest: process.env.INFLUENCE_API_IMAGE_DIGEST ?? "", healthy: () => healthy });
const server = Bun.serve({ port: Number(process.env.PORT ?? 3001), hostname: process.env.HOST ?? "0.0.0.0", fetch: app.fetch });
// Exactly one proof producer, also across duplicate processes (existing DB
// advisory-lock delivery). Every sweep rechecks the whole database first.
const timer = setInterval(async () => {
  if (stopped || checking || !healthy) return;
  checking = true;
  try {
    await assertProofDatabase(sql, runId);
    if (execution.mode === "remote") {
      const [job] = await sql`SELECT status FROM game_postgame_media WHERE game_id=${identity.gameId}`;
      // The proof has exactly one durable enqueue wake. Do not synthesize
      // periodic new wake IDs during cold start or wake an empty admitted slot.
      try { if (job?.status !== "waiting_inputs") await dispatchRenderWakes(db, { repair: false }); }
      catch { console.warn("[render-proof] Wake delivery deferred; durable proof wake retained"); }
    }
  }
  catch { healthy = false; console.error("[render-proof] Isolation check failed; admission and wake delivery stopped"); }
  finally { checking = false; }
}, 5000);
const shutdown = async () => { stopped = true; healthy = false; clearInterval(timer); server.stop(); await closeDB(); await sql.end(); };
process.once("SIGTERM", () => void shutdown()); process.once("SIGINT", () => void shutdown());
console.info("[render-proof] Serving one frozen fixture with upstream and scheduler routes absent");
}
main().catch(() => { console.error("[render-proof] Startup rejected; inspect private configuration and isolation evidence"); process.exit(1); });
