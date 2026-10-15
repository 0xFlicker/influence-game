import { Hono } from "hono";
import { createDB, type DrizzleDB } from "../db/index.js";
import { createPostgameMediaWorkerRoutes } from "../routes/postgame-media-worker.js";
import { getPublicPostgameMedia } from "./postgame-media.js";
import { secureTokenEquals, workerTokenFromAuthorization } from "./postgame-media-worker-auth.js";
import { queueProofFixture, proofDatabaseReceipt, type ProofSQL, type RenderProofIdentity } from "./staging-render-proof.js";
import type { RenderExecution } from "@influence/engine/render-execution-config";

/** No ordinary API/game-worker bootstrap, scheduler, model, image or recovery runtime. */
export function createStagingRenderProofAPI(options: {
  sql: ProofSQL; runId: string; identity: RenderProofIdentity; execution: RenderExecution;
  apiDigest: string; candidateSha: string; healthy: () => boolean; db?: DrizzleDB;
}) {
  if (options.execution.environment !== "staging" || options.execution.network !== "tailnet"
    || options.execution.apiOrigin !== "https://influence-staging.tail8a79ed.ts.net"
    || !/^sha256:[a-f0-9]{64}$/.test(options.apiDigest)
    || !/^[a-f0-9]{40}$/.test(options.candidateSha)
    || options.candidateSha !== options.identity.candidateSha) throw new Error("Staging proof release identity required");
  const db = options.db ?? createDB();
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (!options.healthy()) return c.json({ error: "Proof isolation failed; writes and wakes stopped" }, 503);
    await next();
  });
  const health = () => ({ status: "ok", service: "influence-api", commit: options.candidateSha,
    runtimeRole: "gateway", renderExecution: options.execution,
    releaseControl: { runtimeState: "active", imageDigest: options.apiDigest, migrationSet: options.identity.migrationSet },
    renderProof: { runId: options.runId, database: options.identity.database, principal: options.identity.principal,
      fixtureDigest: options.identity.fixtureDigest, gameId: options.identity.gameId,
      admissionHeld: true, schedulersHeld: true, upstreamWorkers: false, boundedWakeProducer: true } });
  app.get("/health", c => c.json(health()));
  app.get("/api/health", c => c.json(health()));
  app.get("/api/internal/render-proof/receipt", async c => {
    const token = workerTokenFromAuthorization(c.req.header("Authorization"));
    const expected = process.env.POSTGAME_MEDIA_CONTROL_TOKEN?.trim();
    if (!expected || !token || !secureTokenEquals(token, expected)) return c.json({ error: "Proof operator authentication required" }, 401);
    try { return c.json(await proofDatabaseReceipt(options.sql, options.runId)); }
    catch { return c.json({ error: "Proof database is no longer contained" }, 503); }
  });
  app.post("/api/internal/render-proof/queue", async c => {
    const provided = workerTokenFromAuthorization(c.req.header("Authorization"));
    const expected = process.env.POSTGAME_MEDIA_CONTROL_TOKEN?.trim();
    if (!expected || !provided || !secureTokenEquals(provided, expected)) return c.json({ error: "Proof operator authentication required" }, 401);
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || !("runId" in body) || body.runId !== options.runId
      || !("confirmation" in body) || body.confirmation !== "QUEUE_ONE_FROZEN_FIXTURE") return c.json({ error: "Exact run ID and proof confirmation required" }, 400);
    try { return c.json(await queueProofFixture(options.sql, options.runId), 202); }
    catch { return c.json({ error: "Proof fixture is not eligible for its single enqueue" }, 409); }
  });
  app.get("/api/games/:id/postgame/media", async c => {
    if (c.req.param("id") !== options.identity.gameId) return c.json({ error: "Fixture not found" }, 404);
    return c.json(await getPublicPostgameMedia(db, options.identity.gameId));
  });
  app.route("/", createPostgameMediaWorkerRoutes(db, { execution: options.execution, canClaimWork: options.healthy }));
  // Unregistered game/admission/free-queue/editorial/image routes are permanent
  // scheduler holds. No ordinary runtime imports or authorization bootstrap.
  app.notFound(c => c.json({ error: "This API serves only the isolated render proof" }, 404));
  return app;
}
