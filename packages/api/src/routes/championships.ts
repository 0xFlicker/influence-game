import { prepareChampionshipAwards, deliverChampionshipAwards } from "../services/championship-awards.js";
import { assertChampionshipSchedulerConfigured, championshipScheduleManifest, dispatchScheduledChampionshipMatch, requestChampionshipScheduleSync } from "../services/championship-scheduling.js";
import { launchExactGame, launchExactGameLocally, assertGameLaunchConfigured } from "../services/game-launch.js";
import { correctChampionshipResult } from "../services/championship-corrections.js";
import { readChampionshipArtAttempts, reconcileChampionshipArtAttempt } from "../services/championship-artwork.js";
import { listProducerChampionships, previewChampionshipAwards, listEventAwards, readAwardHistory } from "../services/championship-producer.js";
import { activateChampionship, pauseChampionship, dispatchChampionshipMatch, replayCancelledChampionshipMatch } from "../services/championship-dispatch.js";
import { reconcileChampionships, reconcileChampionshipGameCompletion } from "../services/championship-runtime.js";
import { isPostgresUniqueViolation } from "../lib/postgres-errors.js";
import { resolvePublicPlayer } from "../services/public-player-identity.js";
import { Hono } from "hono";
import { championshipSchedule, parseChampionshipPolicies } from "@influence/engine/championship";
import type { DrizzleDB } from "../db/index.js";
import { requireAuth, requirePermission, requireServiceAuth, type AuthEnv } from "../middleware/auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import { ChampionshipError, configureChampionshipDraft, createChampionshipDraft, lockChampionshipRoster, publishChampionship, readChampionship } from "../services/championships.js";
import { correctAwardRecipient, grantAward, revokeAward, reinstateAward, publicAgentAwards, publicAccountAwards, createAwardDefinition, publicAwardDefinitions } from "../services/awards.js";

export function createChampionshipRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  app.onError((error, c) => {
    if (isPostgresUniqueViolation(error, "competition_audit_request")) return c.json({ error: "Idempotency key already belongs to another operation" }, 409);
    if (error instanceof ChampionshipError) return c.json({ error: error.message }, error.status);
    throw error;
  });
  app.get("/api/championships/:slug", async c => {
    const event = await readChampionship(db, c.req.param("slug"));
    return event ? c.json(event) : c.json({ error: "Event not found" }, 404);
  });
  app.get("/api/awards/agents/:id", async c => c.json({ awards: await publicAgentAwards(db, c.req.param("id")) }));
  app.get("/api/awards/accounts/:identifier", async c => {
    const player = await resolvePublicPlayer(db, c.req.param("identifier"));
    return player ? c.json({ awards: await publicAccountAwards(db, player.internalUserId) }) : c.json({ error: "Player not found" }, 404);
  });
  app.get("/api/award-definitions", async c => c.json({ definitions: await publicAwardDefinitions(db) }));
  app.post("/api/internal/championships/games/launch", requireServiceAuth(db, "dispatch_championship"), requirePermission("dispatch_championship"), async c => {
    if (process.env.NODE_ENV === "production" && process.env.INFLUENCE_API_ROLE !== "game-worker") return c.json({ error: "Use the game-worker launch endpoint" }, 503);
    const body = await parseJsonBody(c, "Exact game launch");
    if (typeof body?.gameId !== "string") return c.json({ error: "Exact game ID required" }, 400);
    await launchExactGameLocally(db, body.gameId);
    return c.json({ accepted: true, gameId: body.gameId });
  });
  app.get("/api/internal/championships/:id/schedules", requireServiceAuth(db, "dispatch_championship"), requirePermission("dispatch_championship"), async c => c.json(await championshipScheduleManifest(db, c.req.param("id"))));
  app.post("/api/internal/championships/:id/matches/:ordinal/dispatch", requireServiceAuth(db, "dispatch_championship"), requirePermission("dispatch_championship"), async c => {
    const body = await parseJsonBody(c, "Scheduled championship match");
    if (!body || body.eventId !== c.req.param("id") || body.ordinal !== Number(c.req.param("ordinal")) || !Number.isSafeInteger(body.ordinal) || body.ordinal < 1 || body.ordinal > 17 || typeof body.matchId !== "string" || typeof body.version !== "string" || !Number.isSafeInteger(body.revision) || typeof body.scheduledAt !== "string") return c.json({ error: "Exact schedule identity required" }, 400);
    return c.json(await dispatchScheduledChampionshipMatch(db, body));
  });
  app.post("/api/internal/championships/games/:id/complete", requireServiceAuth(db, "dispatch_championship"), requirePermission("dispatch_championship"), async c => {
    await reconcileChampionshipGameCompletion(db, c.req.param("id"));
    return c.json({ accepted: true, gameId: c.req.param("id") });
  });
  app.use("/api/admin/championships/*", requireAuth(db), requirePermission("manage_championships"));
  app.get("/api/admin/championships", requireAuth(db), requirePermission("manage_championships"), async c => c.json({ events: await listProducerChampionships(db) }));
  app.post("/api/admin/championships/:id/reconcile", async c => {
    if (!await readChampionship(db, c.req.param("id"), true)) return c.json({ error: "Event not found" }, 404);
    return c.json(await reconcileChampionships(db, new Date().toISOString(), c.req.param("id")));
  });
  app.get("/api/admin/championships/:id/artwork/:preparation/attempts", async c => c.json({ attempts: await readChampionshipArtAttempts(db, c.req.param("id"), c.req.param("preparation")) }));
  app.post("/api/admin/championships/:id/artwork/:preparation/attempts/:attempt/reconcile", async c => {
    const body = await parseJsonBody(c, "Reconcile artwork provider attempt");
    if (typeof body?.note !== "string" || !body.note.trim() || !Number.isSafeInteger(body.costMicrousd) || body.costMicrousd < 0) return c.json({ error: "Provide an evidence note and confirmed nonnegative cost in micro-USD" }, 400);
    return c.json(await reconcileChampionshipArtAttempt(db, { eventId: c.req.param("id"), preparationId: c.req.param("preparation"), attemptId: c.req.param("attempt"), actorId: c.get("user")!.id, note: body.note, costMicrousd: body.costMicrousd }));
  });
  app.get("/api/admin/championships/:id/award-preview", requirePermission("manage_awards"), async c => c.json({ phases: await previewChampionshipAwards(db, c.req.param("id")) }));
  app.get("/api/admin/awards", requireAuth(db), requirePermission("manage_awards"), async c => {
    const eventId = c.req.query("eventId");
    if (!eventId) return c.json({ error: "Choose an event" }, 400);
    return c.json(await listEventAwards(db, eventId, c.req.query("after")));
  });
  app.get("/api/admin/awards/:id", requireAuth(db), requirePermission("manage_awards"), async c => c.json(await readAwardHistory(db, c.req.param("id"))));
  app.post("/api/admin/awards/:id/reinstate", requireAuth(db), requirePermission("manage_awards"), async c => {
    const body = await parseJsonBody(c, "Reinstate award");
    if (typeof body?.reason !== "string") return c.json({ error: "A reason is required" }, 400);
    return c.json(await reinstateAward(db, { grantId: c.req.param("id"), actorId: c.get("user")!.id, reason: body.reason, requestId: c.req.header("Idempotency-Key") ?? "" }));
  });
  app.post("/api/admin/championships", requireAuth(db), requirePermission("manage_championships"), async c => {
    const body = await parseJsonBody(c, "Create championship draft");
    if (!body || typeof body.slug !== "string" || typeof body.name !== "string" || typeof body.sourceSeasonId !== "string") return c.json({ error: "slug, name and sourceSeasonId are required" }, 400);
    const event = await createChampionshipDraft(db, { slug: body.slug, name: body.name, sourceSeasonId: body.sourceSeasonId, actorId: c.get("user")!.id });
    return c.json({ id: event.id, slug: event.slug, status: event.status }, 201);
  });
  app.get("/api/admin/championships/:id", async c => {
    const event = await readChampionship(db, c.req.param("id"), true);
    return event ? c.json(event) : c.json({ error: "Event not found" }, 404);
  });
  app.put("/api/admin/championships/:id", async c => {
    const body = await parseJsonBody(c, "Configure championship");
    if (!body || !(body.startDate === null || typeof body.startDate === "string")) return c.json({ error: "Explicit policies and startDate are required; undecided values must be null" }, 400);
    let policies;
    try {
      policies = parseChampionshipPolicies(body.policies);
      if (body.startDate !== null) championshipSchedule(body.startDate);
    }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : "Invalid policies" }, 400); }
    const event = await configureChampionshipDraft(db, c.req.param("id"), { policies, startDate: body.startDate });
    return c.json({ id: event.id, status: event.status });
  });
  app.post("/api/admin/championships/:id/lock", async c => {
    const event = await lockChampionshipRoster(db, c.req.param("id"), c.get("user")!.id, c.req.header("Idempotency-Key") ?? "");
    return c.json({ id: event.id, status: event.status });
  });
  app.post("/api/admin/championships/:id/activate", async c => {
    assertChampionshipSchedulerConfigured();
    assertGameLaunchConfigured();
    const result = await activateChampionship(db, c.req.param("id"), c.get("user")!.id, c.req.header("Idempotency-Key") ?? "");
    const scheduling = await requestChampionshipScheduleSync(c.req.param("id"), db);
    try { await prepareChampionshipAwards(db, c.req.param("id")); await deliverChampionshipAwards(db, c.req.param("id")); }
    catch (error) { console.warn("[championship] Award delivery needs retry", error instanceof Error ? error.message : "Unknown failure"); }
    return c.json({ ...result, scheduling });
  });
  app.post("/api/admin/championships/:id/pause", async c => {

    const result = await pauseChampionship(db, c.req.param("id"), c.get("user")!.id, c.req.header("Idempotency-Key") ?? "");
    return c.json({ ...result, scheduling: await requestChampionshipScheduleSync(c.req.param("id"), db) });
  });
  app.post("/api/admin/championships/:id/matches/:ordinal/dispatch", async c => {
    const ordinal = Number(c.req.param("ordinal"));
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 17) return c.json({ error: "Choose an exact match from 1 to 17" }, 400);
    const result = await dispatchChampionshipMatch(db, c.req.param("id"), ordinal);
    if (result.gameId) await launchExactGame(db, result.gameId);
    return c.json(result);
  });
  app.post("/api/admin/championships/:id/matches/:ordinal/replay", async c => {
    const ordinal = Number(c.req.param("ordinal"));
    const body = await parseJsonBody(c, "Replay cancelled championship match");
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 17 || typeof body?.expectedGameId !== "string" || typeof body?.reason !== "string") return c.json({ error: "Choose an exact cancelled match and provide a reason" }, 400);
    const result = await replayCancelledChampionshipMatch(db, { eventId: c.req.param("id"), ordinal, expectedGameId: body.expectedGameId, reason: body.reason, actorId: c.get("user")!.id, requestId: c.req.header("Idempotency-Key") ?? "" });
    if (result.gameId) await launchExactGame(db, result.gameId);
    return c.json(result);
  });
  app.post("/api/admin/championships/:id/matches/:ordinal/correct", requirePermission("manage_awards"), async c => {
    const body = await parseJsonBody(c, "Correct completed championship result");
    const ordinal = Number(c.req.param("ordinal"));
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 17 || typeof body?.expectedGameId !== "string" || !Number.isSafeInteger(body.expectedRevision)
      || !["resettle", "replay"].includes(String(body.mode)) || typeof body.reason !== "string") return c.json({ error: "Provide the exact completed game/revision, correction mode and reason" }, 400);
    const result = await correctChampionshipResult(db, { eventId: c.req.param("id"), ordinal, expectedGameId: body.expectedGameId, expectedRevision: body.expectedRevision as number,
      mode: body.mode as "resettle" | "replay", reason: body.reason, actorId: c.get("user")!.id, requestId: c.req.header("Idempotency-Key") ?? "" });
    const reconciliation = await reconcileChampionships(db, undefined, c.req.param("id"));
    return c.json({ ...result, reconciliation });
  });
  app.post("/api/admin/awards/:id/correct-recipient", requireAuth(db), requirePermission("manage_awards"), async c => {
    const body = await parseJsonBody(c, "Correct award recipient");
    if (!body || !["agent", "account"].includes(String(body.recipientType)) || typeof body.recipientId !== "string" || typeof body.reason !== "string"
      || !body.evidence || typeof body.evidence !== "object" || Array.isArray(body.evidence)) return c.json({ error: "Provide recipient, reason and correction evidence" }, 400);
    return c.json(await correctAwardRecipient(db, { grantId: c.req.param("id"), recipient: { type: body.recipientType as "agent" | "account", id: body.recipientId },
      evidence: body.evidence as Record<string, unknown>, reason: body.reason, actorId: c.get("user")!.id, requestId: c.req.header("Idempotency-Key") ?? "" }));
  });
  app.post("/api/admin/championships/:id/publication", async c => {
    const body = await parseJsonBody(c, "Publish championship");
    if (typeof body?.published !== "boolean") return c.json({ error: "published must be a boolean" }, 400);
    return c.json(await publishChampionship(db, c.req.param("id"), body.published));
  });
  app.post("/api/admin/award-definitions", requireAuth(db), requirePermission("manage_award_definitions"), async c => {
    const body = await parseJsonBody(c, "Create award definition");
    if (!body || typeof body.code !== "string" || typeof body.title !== "string" || typeof body.theme !== "string"
      || (body.recipientType !== "agent" && body.recipientType !== "account")) return c.json({ error: "code, title, theme and recipientType are required" }, 400);
    return c.json(await createAwardDefinition(db, { code: body.code, title: body.title, theme: body.theme, recipientType: body.recipientType }));
  });
  app.post("/api/admin/awards", requireAuth(db), requirePermission("manage_awards"), async c => {
    const body = await parseJsonBody(c, "Grant award");
    if (!body || typeof body.definitionCode !== "string" || typeof body.recipientId !== "string"
      || !["agent", "account"].includes(String(body.recipientType)) || typeof body.sourceKey !== "string" || typeof body.reason !== "string"
      || !body.evidence || typeof body.evidence !== "object" || Array.isArray(body.evidence)) return c.json({ error: "Explicit award recipient, source, reason and evidence are required" }, 400);
    return c.json(await grantAward(db, { definitionCode: body.definitionCode, recipient: { type: body.recipientType as "agent" | "account", id: body.recipientId },
      sourceKey: body.sourceKey, reason: body.reason, evidence: body.evidence as Record<string, unknown>,
      ...(typeof body.sourceSeasonId === "string" ? { sourceSeasonId: body.sourceSeasonId } : {}),
      ...(typeof body.sourceEventId === "string" ? { sourceEventId: body.sourceEventId } : {}),
      actorId: c.get("user")!.id, requestId: c.req.header("Idempotency-Key") ?? "" }));
  });
  app.post("/api/admin/awards/:id/revoke", requireAuth(db), requirePermission("manage_awards"), async c => {
    const body = await parseJsonBody(c, "Revoke award");
    if (typeof body?.reason !== "string") return c.json({ error: "A reason is required" }, 400);
    return c.json(await revokeAward(db, { grantId: c.req.param("id"), actorId: c.get("user")!.id, reason: body.reason, requestId: c.req.header("Idempotency-Key") ?? "" }));
  });
  return app;
}
