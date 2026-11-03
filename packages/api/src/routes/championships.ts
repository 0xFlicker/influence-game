import { activateChampionship, pauseChampionship, dispatchChampionshipMatch } from "../services/championship-dispatch.js";
import { reconcileChampionships } from "../services/championship-runtime.js";
import { isPostgresUniqueViolation } from "../lib/postgres-errors.js";
import { resolvePublicPlayer } from "../services/public-player-identity.js";
import { Hono } from "hono";
import { championshipSchedule, parseChampionshipPolicies } from "@influence/engine/championship";
import type { DrizzleDB } from "../db/index.js";
import { requireAuth, requirePermission, requireServiceAuth, type AuthEnv } from "../middleware/auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import { ChampionshipError, configureChampionshipDraft, createChampionshipDraft, lockChampionshipRoster, publishChampionship, readChampionship } from "../services/championships.js";
import { grantAward, revokeAward, publicAgentAwards, publicAccountAwards, createAwardDefinition, publicAwardDefinitions } from "../services/awards.js";

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
  app.post("/api/internal/championships/reconcile", requireServiceAuth(db, "dispatch_championship"), requirePermission("dispatch_championship"), async c => c.json(await reconcileChampionships(db)));
  app.use("/api/admin/championships/*", requireAuth(db), requirePermission("manage_championships"));
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
  app.post("/api/admin/championships/:id/activate", async c => c.json(await activateChampionship(db, c.req.param("id"), c.get("user")!.id, c.req.header("Idempotency-Key") ?? "")));
  app.post("/api/admin/championships/:id/pause", async c => c.json(await pauseChampionship(db, c.req.param("id"), c.get("user")!.id, c.req.header("Idempotency-Key") ?? "")));
  app.post("/api/admin/championships/:id/matches/:ordinal/dispatch", async c => {
    const ordinal = Number(c.req.param("ordinal"));
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 17) return c.json({ error: "Choose an exact match from 1 to 17" }, 400);
    return c.json(await dispatchChampionshipMatch(db, c.req.param("id"), ordinal));
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
