/**
 * Admin routes for RBAC management.
 *
 * Role-management endpoints require `manage_roles`.
 * Read-only admin surfaces require `view_admin` (or `manage_roles`).
 * Cost-accounting mutations require `manage_cost_accounting` (or `manage_roles`).
 *
 * GET    /api/admin/roles           — List all roles with their permissions
 * GET    /api/admin/permissions     — List all permissions
 * GET    /api/admin/address-roles   — List all address-role assignments
 * POST   /api/admin/address-roles   — Assign role to address
 * DELETE /api/admin/address-roles   — Revoke role from address
 * GET    /api/admin/users           — List all users with their resolved roles
 */

import { Hono, type Context } from "hono";
import { eq, sql, isNull, and, or, asc, like, desc, inArray } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { getPermissionsForAddress } from "../db/rbac.js";
import {
  requireAuth,
  requirePermission,
  type AuthEnv,
} from "../middleware/auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import { generateInviteCode } from "../lib/invite-codes.js";
import { getRedactedKernelHealthByGameId } from "../services/game-kernel-health.js";
import { getDurableRunInspection } from "../services/game-durable-run.js";
import { tryRefreshGameWatchStateSummary } from "../services/game-watch-state-summary.js";
import {
  backfillGameCostAccounting,
  getGameCostDetail,
  getGameCostSummaryMap,
} from "../services/provider-cost-accounting.js";
import {
  getPostgameHighlightsDiagnostics,
  type PostgameHighlightsReadStatus,
} from "../services/postgame-highlights.js";
import { getAdminPostgameMedia } from "../services/postgame-media.js";
import { requestPostgameMedia, type PostgameMediaRequestAction } from "../services/postgame-media-coordinator.js";
import { modelLabelFromConfig } from "../lib/model-label.js";
import { getGameSeasonIdentityMap } from "../lib/game-season.js";
import { generateUniqueSlug } from "../lib/slug.js";
import { randomUUID } from "crypto";
import { getPublicDisplayName } from "../lib/display-name.js";
import { removeStandingDailyAgentByAdmin } from "../services/queue-enrollment.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAdminRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  const requireAdminRead = requirePermission("view_admin", "manage_roles");
  const requireRoleManagement = requirePermission("manage_roles");
  const requirePostgameMediaManagement = requirePermission("manage_postgame_media", "manage_roles");
  const requireFreeQueueManagement = requirePermission("schedule_free_game", "manage_roles");
  const canManageCostAccounting = (permissions: string[]) => (
    permissions.includes("manage_cost_accounting") || permissions.includes("manage_roles")
  );

  async function findAdminGameId(idOrSlug: string): Promise<string | null> {
    const game = (await db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(sql`${schema.games.id} = ${idOrSlug} OR ${schema.games.slug} = ${idOrSlug}`))[0];
    return game?.id ?? null;
  }

  // All admin routes require authentication. Permissions are applied per-route.
  app.use("/api/admin/*", requireAuth(db));

  // -------------------------------------------------------------------------
  // GET /api/admin/roles — list all roles with their permissions
  // -------------------------------------------------------------------------

  app.get("/api/admin/roles", requireRoleManagement, async (c) => {
    const allRoles = await db.select().from(schema.roles);

    const rolesWithPerms = await Promise.all(allRoles.map(async (role) => {
      const permRows = await db
        .select({ name: schema.permissions.name })
        .from(schema.rolePermissions)
        .innerJoin(
          schema.permissions,
          sql`${schema.rolePermissions.permissionId} = ${schema.permissions.id}`,
        )
        .where(sql`${schema.rolePermissions.roleId} = ${role.id}`);

      return {
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem === 1,
        permissions: permRows.map((p) => p.name),
        createdAt: role.createdAt,
      };
    }));

    return c.json(rolesWithPerms);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/permissions — list all permissions
  // -------------------------------------------------------------------------

  app.get("/api/admin/permissions", requireRoleManagement, async (c) => {
    const allPerms = await db.select().from(schema.permissions);
    return c.json(allPerms);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/address-roles — list all address-role assignments
  // -------------------------------------------------------------------------

  app.get("/api/admin/address-roles", requireRoleManagement, async (c) => {
    const assignments = await db
      .select({
        walletAddress: schema.addressRoles.walletAddress,
        roleId: schema.addressRoles.roleId,
        roleName: schema.roles.name,
        grantedBy: schema.addressRoles.grantedBy,
        grantedAt: schema.addressRoles.grantedAt,
      })
      .from(schema.addressRoles)
      .innerJoin(
        schema.roles,
        sql`${schema.addressRoles.roleId} = ${schema.roles.id}`,
      );

    return c.json(assignments);
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/address-roles — assign role to address
  // -------------------------------------------------------------------------

  app.post("/api/admin/address-roles", requireRoleManagement, async (c) => {
    const body = await parseJsonBody(c, "POST /api/admin/address-roles");
    if (!body?.walletAddress || !body?.roleId) {
      return c.json(
        { error: "walletAddress and roleId are required" },
        400,
      );
    }

    const walletAddress = (body.walletAddress as string).toLowerCase();
    const roleId = body.roleId as string;

    // Verify role exists
    const role = (await db
      .select()
      .from(schema.roles)
      .where(sql`${schema.roles.id} = ${roleId}`))[0];

    if (!role) {
      return c.json({ error: "Role not found" }, 404);
    }

    // Check if already assigned
    const existing = (await db
      .select()
      .from(schema.addressRoles)
      .where(
        sql`${schema.addressRoles.walletAddress} = ${walletAddress} AND ${schema.addressRoles.roleId} = ${roleId}`,
      ))[0];

    if (existing) {
      return c.json({ error: "Role already assigned to this address" }, 409);
    }

    const granter = c.get("user");
    await db.insert(schema.addressRoles)
      .values({
        walletAddress,
        roleId,
        grantedBy: granter.walletAddress ?? granter.id,
      });

    return c.json({
      walletAddress,
      roleId,
      roleName: role.name,
      grantedBy: granter.walletAddress ?? granter.id,
    }, 201);
  });

  // -------------------------------------------------------------------------
  // DELETE /api/admin/address-roles — revoke role from address
  // -------------------------------------------------------------------------

  app.delete("/api/admin/address-roles", requireRoleManagement, async (c) => {
    const body = await parseJsonBody(c, "DELETE /api/admin/address-roles");
    if (!body?.walletAddress || !body?.roleId) {
      return c.json(
        { error: "walletAddress and roleId are required" },
        400,
      );
    }

    const walletAddress = (body.walletAddress as string).toLowerCase();
    const roleId = body.roleId as string;

    // Sysop lockout protection: cannot revoke sysop from yourself if you're the last sysop
    const role = (await db
      .select()
      .from(schema.roles)
      .where(sql`${schema.roles.id} = ${roleId}`))[0];

    if (role?.name === "sysop") {
      const currentUser = c.get("user");
      const isSelf =
        currentUser.walletAddress?.toLowerCase() === walletAddress;

      if (isSelf) {
        // Count remaining sysops
        const sysopCount = (await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.addressRoles)
          .where(sql`${schema.addressRoles.roleId} = ${roleId}`))[0];

        if (sysopCount && sysopCount.count <= 1) {
          return c.json(
            { error: "Cannot revoke sysop role — you are the last sysop" },
            403,
          );
        }
      }
    }

    // Check if assignment exists
    const existing = (await db
      .select()
      .from(schema.addressRoles)
      .where(
        sql`${schema.addressRoles.walletAddress} = ${walletAddress} AND ${schema.addressRoles.roleId} = ${roleId}`,
      ))[0];

    if (!existing) {
      return c.json({ error: "Role assignment not found" }, 404);
    }

    // Delete the assignment
    await db.delete(schema.addressRoles)
      .where(
        sql`${schema.addressRoles.walletAddress} = ${walletAddress} AND ${schema.addressRoles.roleId} = ${roleId}`,
      );

    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/users — list all users with their resolved roles
  // -------------------------------------------------------------------------

  app.get("/api/admin/users", requireRoleManagement, async (c) => {
    const allUsers = await db.select().from(schema.users);

    const usersWithRoles = await Promise.all(allUsers.map(async (user) => {
      const resolved = user.walletAddress
        ? await getPermissionsForAddress(db, user.walletAddress)
        : { roles: [], permissions: [] };

      return {
        id: user.id,
        walletAddress: user.walletAddress,
        email: user.email,
        displayName: user.displayName,
        roles: resolved.roles,
        permissions: resolved.permissions,
        createdAt: user.createdAt,
      };
    }));

    return c.json(usersWithRoles);
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/agents — list all agent profiles across all users
  // -------------------------------------------------------------------------

  app.get("/api/admin/agents", requireAdminRead, async (c) => {
    const profiles = await db
      .select({
        id: schema.agentProfiles.id,
        userId: schema.agentProfiles.userId,
        name: schema.agentProfiles.name,
        backstory: schema.agentProfiles.backstory,
        personality: schema.agentProfiles.personality,
        strategyStyle: schema.agentProfiles.strategyStyle,
        personaKey: schema.agentProfiles.personaKey,
        avatarUrl: schema.agentProfiles.avatarUrl,
        gamesPlayed: schema.agentProfiles.gamesPlayed,
        gamesWon: schema.agentProfiles.gamesWon,
        createdAt: schema.agentProfiles.createdAt,
        updatedAt: schema.agentProfiles.updatedAt,
        ownerWallet: schema.users.walletAddress,
        ownerDisplayName: schema.users.displayName,
        ownerEmail: schema.users.email,
      })
      .from(schema.agentProfiles)
      .innerJoin(schema.users, sql`${schema.agentProfiles.userId} = ${schema.users.id}`);

    return c.json(profiles);
  });

  app.get("/api/admin/free-queue", requireAdminRead, async (c) => {
    const rows = await db.select({
      userId: schema.freeGameQueue.userId,
      agentProfileId: schema.freeGameQueue.agentProfileId,
      agentName: schema.agentProfiles.name,
      joinedAt: schema.freeGameQueue.joinedAt,
      consecutiveMisses: schema.freeGameQueue.consecutiveMisses,
      displayName: schema.users.displayName,
      email: schema.users.email,
      walletAddress: schema.users.walletAddress,
    }).from(schema.freeGameQueue)
      .innerJoin(schema.agentProfiles, eq(schema.freeGameQueue.agentProfileId, schema.agentProfiles.id))
      .innerJoin(schema.users, eq(schema.freeGameQueue.userId, schema.users.id))
      .orderBy(asc(schema.freeGameQueue.joinedAt));

    const gameRows = rows.length === 0 ? [] : await db.select({
        userId: schema.gamePlayers.userId,
        id: schema.games.id,
        slug: schema.games.slug,
        status: schema.games.status,
        createdAt: schema.games.createdAt,
      }).from(schema.gamePlayers)
        .innerJoin(schema.games, eq(schema.gamePlayers.gameId, schema.games.id))
        .where(and(
          inArray(schema.gamePlayers.userId, rows.map((row) => row.userId)),
          eq(schema.games.trackType, "free"),
        )).orderBy(desc(schema.games.createdAt));
    const lastGameByOwner = new Map<string, (typeof gameRows)[number]>();
    const activeGameByOwner = new Map<string, (typeof gameRows)[number]>();
    for (const game of gameRows) {
      if (!game.userId) continue;
      if (!lastGameByOwner.has(game.userId)) lastGameByOwner.set(game.userId, game);
      if (["waiting", "in_progress", "suspended"].includes(game.status)
        && !activeGameByOwner.has(game.userId)) {
        activeGameByOwner.set(game.userId, game);
      }
    }
    const entries = rows.map((row) => {
      const activeGame = activeGameByOwner.get(row.userId);
      const lastGame = lastGameByOwner.get(row.userId);
      return {
        userId: row.userId,
        ownerLabel: getPublicDisplayName(row),
        agentProfileId: row.agentProfileId,
        agentName: row.agentName,
        joinedAt: row.joinedAt,
        consecutiveMisses: row.consecutiveMisses,
        status: activeGame ? "in-game" as const : "eligible" as const,
        activeGame: activeGame ? {
          id: activeGame.id,
          slug: activeGame.slug ?? activeGame.id,
          status: activeGame.status,
        } : null,
        lastGame: lastGame ? {
          id: lastGame.id,
          slug: lastGame.slug ?? lastGame.id,
          status: lastGame.status,
          createdAt: lastGame.createdAt,
        } : null,
      };
    });
    const eligibleEntries = entries.filter((entry) => entry.status === "eligible");
    return c.json({
      eligibleCount: eligibleEntries.length,
      availableHumanSeats: 12,
      longestWaitSince: eligibleEntries[0]?.joinedAt ?? null,
      entries,
    });
  });

  app.delete("/api/admin/free-queue/:userId", requireFreeQueueManagement, async (c) => {
    return c.json(await removeStandingDailyAgentByAdmin(db, c.req.param("userId")));
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/avatar-generations — list generated-avatar attempts
  // -------------------------------------------------------------------------

  app.get("/api/admin/avatar-generations", requireAdminRead, async (c) => {
    const limit = clampAdminLimit(Number(c.req.query("limit") ?? 50));
    const rows = await db
      .select({
        id: schema.avatarGenerationRequests.id,
        userId: schema.avatarGenerationRequests.userId,
        agentProfileId: schema.avatarGenerationRequests.agentProfileId,
        agentName: schema.agentProfiles.name,
        purpose: schema.avatarGenerationRequests.purpose,
        status: schema.avatarGenerationRequests.status,
        triggerSource: schema.avatarGenerationRequests.triggerSource,
        provider: schema.avatarGenerationRequests.provider,
        model: schema.avatarGenerationRequests.model,
        providerRequestId: schema.avatarGenerationRequests.providerRequestId,
        estimatedCostMicrousd: schema.avatarGenerationRequests.estimatedCostMicrousd,
        failureCode: schema.avatarGenerationRequests.failureCode,
        failureMessage: schema.avatarGenerationRequests.failureMessage,
        safeMetadata: schema.avatarGenerationRequests.safeMetadata,
        createdAt: schema.avatarGenerationRequests.createdAt,
        updatedAt: schema.avatarGenerationRequests.updatedAt,
        completedAt: schema.avatarGenerationRequests.completedAt,
      })
      .from(schema.avatarGenerationRequests)
      .leftJoin(schema.agentProfiles, eq(schema.avatarGenerationRequests.agentProfileId, schema.agentProfiles.id))
      .orderBy(desc(schema.avatarGenerationRequests.createdAt))
      .limit(limit);

    return c.json(rows.map((row) => ({
      ...row,
      safeMetadata: redactAvatarAdminMetadata(row.safeMetadata),
    })));
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/avatar-changes — list avatar mutation history
  // -------------------------------------------------------------------------

  app.get("/api/admin/avatar-changes", requireAdminRead, async (c) => {
    const limit = clampAdminLimit(Number(c.req.query("limit") ?? 50));
    const rows = await db
      .select({
        id: schema.avatarChangeEvents.id,
        userId: schema.avatarChangeEvents.userId,
        agentProfileId: schema.avatarChangeEvents.agentProfileId,
        agentName: schema.agentProfiles.name,
        generationRequestId: schema.avatarChangeEvents.generationRequestId,
        source: schema.avatarChangeEvents.source,
        status: schema.avatarChangeEvents.status,
        actorUserId: schema.avatarChangeEvents.actorUserId,
        previousAvatarUrl: schema.avatarChangeEvents.previousAvatarUrl,
        newAvatarUrl: schema.avatarChangeEvents.newAvatarUrl,
        safeMetadata: schema.avatarChangeEvents.safeMetadata,
        createdAt: schema.avatarChangeEvents.createdAt,
      })
      .from(schema.avatarChangeEvents)
      .leftJoin(schema.agentProfiles, eq(schema.avatarChangeEvents.agentProfileId, schema.agentProfiles.id))
      .orderBy(desc(schema.avatarChangeEvents.createdAt))
      .limit(limit);

    return c.json(rows.map((row) => ({
      ...row,
      safeMetadata: redactAvatarAdminMetadata(row.safeMetadata),
    })));
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/games — list all games including hidden ones
  // -------------------------------------------------------------------------

  app.get("/api/admin/games/:idOrSlug/durable-run", requireAdminRead, async (c) => {
    const result = await getDurableRunInspection(db, c.req.param("idOrSlug"));
    if (!result.ok) {
      return c.json({ error: result.error }, result.statusCode);
    }
    return c.json(result.response);
  });

  app.get("/api/admin/games/:idOrSlug/costs", requireAdminRead, async (c) => {
    const result = await getGameCostDetail(db, c.req.param("idOrSlug"));
    if (!result.ok) {
      return c.json({ error: result.error }, result.statusCode);
    }
    return c.json(result.detail);
  });

  app.get("/api/admin/games/:idOrSlug/postgame/highlights/diagnostics", requireAdminRead, async (c) => {
    const result = await getPostgameHighlightsDiagnostics(db, c.req.param("idOrSlug"));
    if (!result.ok) {
      return postgameHighlightsErrorResponse(c, result);
    }
    return c.json(result);
  });

  app.get("/api/admin/games/:idOrSlug/postgame/media", requireAdminRead, async (c) => {
    const gameId = await findAdminGameId(c.req.param("idOrSlug") ?? "");
    if (!gameId) return c.json({ error: "Game not found" }, 404);
    return c.json(await getAdminPostgameMedia(db, gameId));
  });

  const requestPostgameMediaAction = (action: PostgameMediaRequestAction) => async (c: Context<AuthEnv>) => {
    const body = await parseJsonBody(c, `POST /api/admin/games/:idOrSlug/postgame/media/${action}`);
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const confirmation = typeof body?.confirmation === "string" ? body.confirmation : "";
    if (!reason || confirmation !== action.toUpperCase()) {
      return c.json({ error: `reason and confirmation ${action.toUpperCase()} are required` }, 400);
    }
    const gameId = await findAdminGameId(c.req.param("idOrSlug") ?? "");
    if (!gameId) return c.json({ error: "Game not found" }, 404);
    const result = await requestPostgameMedia(db, {
      gameId,
      actorUserId: c.get("user").id,
      action,
      reason,
      source: "admin_route",
    });
    if (result.outcome === "not_completed") {
      return c.json({ error: "Postgame media can only be requested for completed games" }, 409);
    }
    return c.json(result, result.outcome === "queued" ? 202 : 200);
  };

  app.post(
    "/api/admin/games/:idOrSlug/postgame/media/backfill",
    requirePostgameMediaManagement,
    requestPostgameMediaAction("backfill"),
  );
  app.post(
    "/api/admin/games/:idOrSlug/postgame/media/rerender",
    requirePostgameMediaManagement,
    requestPostgameMediaAction("rerender"),
  );

  app.post("/api/admin/games/:idOrSlug/costs/backfill", async (c) => {
    const userPermissions = c.get("userPermissions") ?? [];
    const user = c.get("user");

    if (!canManageCostAccounting(userPermissions)) {
      await db.insert(schema.gameCostAccountingAuditEvents).values({
        id: randomUUID(),
        actorUserId: user.id,
        action: "backfill_game",
        outcome: "denied",
        safeMetadata: { reason: "insufficient_permissions" },
      });
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    const gameId = await findAdminGameId(c.req.param("idOrSlug"));
    if (!gameId) {
      return c.json({ error: "Game not found" }, 404);
    }

    try {
      const result = await backfillGameCostAccounting(db, gameId, {
        actorUserId: user.id,
      });
      return c.json(result);
    } catch (error) {
      await db.insert(schema.gameCostAccountingAuditEvents).values({
        id: randomUUID(),
        gameId,
        actorUserId: user.id,
        action: "backfill_game",
        outcome: "failed",
        safeMetadata: {
          error: error instanceof Error ? error.name : "UnknownError",
        },
      });
      throw error;
    }
  });

  app.get("/api/admin/games", requireAdminRead, async (c) => {
    const rows = await db.select().from(schema.games);
    const kernelHealthByGameId = await getRedactedKernelHealthByGameId(db, rows.map((game) => game.id));
    const costSummaryByGameId = await getGameCostSummaryMap(db, rows.map((game) => game.id));
    const seasonById = await getGameSeasonIdentityMap(db, rows.map((game) => game.seasonId));

    const summaries = await Promise.all(rows.map(async (game) => {
      const config = JSON.parse(game.config);
      const players = await db
        .select()
        .from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, game.id));

      const result = await db
        .select()
        .from(schema.gameResults)
        .where(eq(schema.gameResults.gameId, game.id));

      const winnerPlayer = result[0]?.winnerId
        ? players.find((p) => p.id === result[0]!.winnerId)
        : null;
      const winnerPersona = winnerPlayer
        ? JSON.parse(winnerPlayer.persona)
        : null;

      return {
        id: game.id,
        slug: game.slug,
        status: game.status,
        playerCount: game.maxPlayers ?? config.maxPlayers ?? players.length,
        currentRound: 0,
        maxRounds: config.maxRounds ?? 10,
        currentPhase: game.status === "completed" ? "END" : game.status === "suspended" ? "SUSPENDED" : "INIT",
        phaseTimeRemaining: null,
        alivePlayers: players.length,
        eliminatedPlayers: 0,
        modelTier: config.modelTier ?? "budget",
        modelSelection: config.modelSelection,
        modelLabel: modelLabelFromConfig(config),
        visibility: config.visibility ?? "public",
        viewerMode: config.viewerMode ?? "speedrun",
        trackType: game.trackType,
        seasonId: game.seasonId ?? undefined,
        season: game.seasonId ? seasonById.get(game.seasonId) : undefined,
        winner: winnerPersona?.name ?? undefined,
        winnerPersona: winnerPersona?.personality ?? undefined,
        errorInfo: config.errorInfo ?? undefined,
        createdAt: game.createdAt,
        startedAt: game.startedAt ?? undefined,
        completedAt: game.endedAt ?? undefined,
        hidden: !!game.hiddenAt,
        hiddenAt: game.hiddenAt ?? undefined,
        kernelHealth: kernelHealthByGameId.get(game.id),
        cost: costSummaryByGameId.get(game.id) ?? null,
      };
    }));

    return c.json(summaries);
  });

  // =========================================================================
  // Invite Code Management
  // =========================================================================

  // -------------------------------------------------------------------------
  // GET /api/admin/settings/invite — get invite code settings
  // -------------------------------------------------------------------------

  app.get("/api/admin/settings/invite", requireAdminRead, async (c) => {
    const setting = (await db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, "invite_required")))[0];

    return c.json({
      inviteRequired: setting?.value === "true",
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/admin/settings/invite — toggle invite code requirement
  // -------------------------------------------------------------------------

  app.patch("/api/admin/settings/invite", requireAdminRead, async (c) => {
    const body = await parseJsonBody(c, "PATCH /api/admin/settings/invite");
    if (body?.inviteRequired === undefined) {
      return c.json({ error: "inviteRequired is required" }, 400);
    }

    const value = body.inviteRequired ? "true" : "false";
    const now = new Date().toISOString();

    await db
      .insert(schema.appSettings)
      .values({ key: "invite_required", value, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value, updatedAt: now },
      });

    return c.json({ inviteRequired: body.inviteRequired });
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/invite-codes — list invite codes with filters
  // -------------------------------------------------------------------------

  app.get("/api/admin/invite-codes", requireAdminRead, async (c) => {
    const userId = c.req.query("userId");
    const status = c.req.query("status"); // "available" | "used" | undefined (all)

    let query = db
      .select({
        id: schema.inviteCodes.id,
        code: schema.inviteCodes.code,
        ownerId: schema.inviteCodes.ownerId,
        usedById: schema.inviteCodes.usedById,
        usedAt: schema.inviteCodes.usedAt,
        createdAt: schema.inviteCodes.createdAt,
        ownerDisplayName: schema.users.displayName,
      })
      .from(schema.inviteCodes)
      .innerJoin(schema.users, eq(schema.inviteCodes.ownerId, schema.users.id))
      .$dynamic();

    const conditions = [];
    if (userId) conditions.push(eq(schema.inviteCodes.ownerId, userId));
    if (status === "available") conditions.push(isNull(schema.inviteCodes.usedById));
    if (status === "used") conditions.push(sql`${schema.inviteCodes.usedById} IS NOT NULL`);
    if (conditions.length > 0) query = query.where(and(...conditions));

    const rows = await query;
    return c.json(rows);
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/invite-codes — generate codes for a user
  // -------------------------------------------------------------------------

  app.post("/api/admin/invite-codes", requireAdminRead, async (c) => {
    const body = await parseJsonBody(c, "POST /api/admin/invite-codes");
    if (!body?.userId) {
      return c.json({ error: "userId is required" }, 400);
    }

    const count = Math.min(Math.max(Number(body.count) || 5, 1), 100);
    const userId = body.userId as string;

    // Verify user exists
    const user = (await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId)))[0];

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const codes = Array.from({ length: count }, () => ({
      id: randomUUID(),
      code: generateInviteCode(),
      ownerId: userId,
    }));

    await db.insert(schema.inviteCodes).values(codes);

    return c.json({
      generated: count,
      codes: codes.map((c) => c.code),
    }, 201);
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/invite-codes/refill — bulk refill: ensure min codes
  // -------------------------------------------------------------------------

  app.post("/api/admin/invite-codes/refill", requireAdminRead, async (c) => {
    const body = await parseJsonBody(c, "POST /api/admin/invite-codes/refill");
    const minCodes = Math.min(Math.max(Number(body?.minCodes) || 5, 1), 100);
    const minAgeDays = Number(body?.minAgeDays) || 0;

    // Get eligible users
    const cutoff = minAgeDays > 0
      ? new Date(Date.now() - minAgeDays * 86400000).toISOString()
      : null;

    let usersQuery = db
      .select({ id: schema.users.id })
      .from(schema.users)
      .$dynamic();

    if (cutoff) {
      usersQuery = usersQuery.where(
        sql`${schema.users.createdAt} <= ${cutoff}`,
      );
    }

    const eligibleUsers = await usersQuery;
    let totalGenerated = 0;

    for (const user of eligibleUsers) {
      // Count available (unused) codes
      const countResult = (await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.inviteCodes)
        .where(
          and(
            eq(schema.inviteCodes.ownerId, user.id),
            isNull(schema.inviteCodes.usedById),
          ),
        ))[0];

      const available = Number(countResult?.count ?? 0);
      const needed = minCodes - available;

      if (needed > 0) {
        const codes = Array.from({ length: needed }, () => ({
          id: randomUUID(),
          code: generateInviteCode(),
          ownerId: user.id,
        }));
        await db.insert(schema.inviteCodes).values(codes);
        totalGenerated += needed;
      }
    }

    return c.json({
      usersProcessed: eligibleUsers.length,
      totalGenerated,
    });
  });

  // =========================================================================
  // Game Export / Import / Remote Games
  // =========================================================================

  // -------------------------------------------------------------------------
  // GET /api/admin/export-game/:idOrSlug — export a complete game as JSON
  // -------------------------------------------------------------------------

  app.get("/api/admin/export-game/:idOrSlug", requireAdminRead, async (c) => {
    const idOrSlug = c.req.param("idOrSlug");

    const game = (await db
      .select()
      .from(schema.games)
      .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug))))[0];

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    // Players with inlined agent profiles
    const players = await db
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, game.id));

    const agentProfileIds = players
      .map((p) => p.agentProfileId)
      .filter((id): id is string => id != null);

    const agentProfileMap = new Map<string, typeof schema.agentProfiles.$inferSelect>();
    if (agentProfileIds.length > 0) {
      const profiles = await db
        .select()
        .from(schema.agentProfiles)
        .where(
          or(...agentProfileIds.map((id) => eq(schema.agentProfiles.id, id))),
        );
      for (const p of profiles) agentProfileMap.set(p.id, p);
    }

    const playersExport = players.map((p) => ({
      id: p.id,
      gameId: p.gameId,
      userId: p.userId,
      agentProfileId: p.agentProfileId,
      persona: p.persona,
      agentConfig: p.agentConfig,
      joinedAt: p.joinedAt,
      agentProfile: p.agentProfileId
        ? agentProfileMap.get(p.agentProfileId) ?? null
        : null,
    }));

    // Transcripts (omit serial ID)
    const transcriptRows = await db
      .select({
        gameId: schema.transcripts.gameId,
        round: schema.transcripts.round,
        phase: schema.transcripts.phase,
        fromPlayerId: schema.transcripts.fromPlayerId,
        scope: schema.transcripts.scope,
        toPlayerIds: schema.transcripts.toPlayerIds,
        roomId: schema.transcripts.roomId,
        roomMetadata: schema.transcripts.roomMetadata,
        text: schema.transcripts.text,
        thinking: schema.transcripts.thinking,
        timestamp: schema.transcripts.timestamp,
        createdAt: schema.transcripts.createdAt,
      })
      .from(schema.transcripts)
      .where(eq(schema.transcripts.gameId, game.id))
      .orderBy(asc(schema.transcripts.timestamp));

    // Game results
    const resultRow = (await db
      .select()
      .from(schema.gameResults)
      .where(eq(schema.gameResults.gameId, game.id)))[0] ?? null;

    // Agent memories
    const memories = await db
      .select()
      .from(schema.agentMemories)
      .where(eq(schema.agentMemories.gameId, game.id));

    // Build export (omit createdById)
    const { createdById: _omit, ...gameData } = game;

    return c.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      sourceEnv: process.env.SOURCE_ENV ?? "unknown",
      game: gameData,
      players: playersExport,
      transcripts: transcriptRows,
      result: resultRow,
      agentMemories: memories,
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/admin/import-game — import a previously exported game
  // -------------------------------------------------------------------------

  app.post("/api/admin/import-game", requireAdminRead, async (c) => {
    const body = await parseJsonBody(c, "POST /api/admin/import-game");
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Mode 1: Remote fetch — { sourceUrl, slug } → fetch export from remote env
    // Mode 2: Direct import — { version, game, players, transcripts, ... }
    let exportData = body;
    if (body.sourceUrl && body.slug) {
      const authHeader = c.req.header("Authorization");
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(body.sourceUrl as string);
      } catch {
        return c.json({ error: "Invalid sourceUrl" }, 400);
      }
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return c.json({ error: "Only http/https URLs are allowed" }, 400);
      }

      const exportUrl = `${parsedUrl.origin}/api/admin/export-game/${encodeURIComponent(body.slug as string)}`;
      const headers: Record<string, string> = { Accept: "application/json" };
      if (authHeader) headers["Authorization"] = authHeader;

      try {
        const resp = await fetch(exportUrl, { headers });
        if (!resp.ok) {
          const detail = await resp.text();
          return c.json({
            error: `Remote export failed (${resp.status})`,
            detail,
          }, resp.status as 502);
        }
        exportData = await resp.json();
      } catch (err) {
        return c.json({
          error: "Failed to fetch export from remote environment",
          detail: err instanceof Error ? err.message : String(err),
        }, 502);
      }
    }

    // Validate required fields
    if (exportData.version !== 1) {
      return c.json({ error: "Unsupported export version" }, 400);
    }
    if (!exportData.game || !exportData.players || !exportData.transcripts) {
      return c.json({ error: "Missing required fields: game, players, transcripts" }, 400);
    }

    const importedGame = exportData.game as Record<string, unknown>;
    const importedPlayers = exportData.players as Array<Record<string, unknown>>;
    const importedTranscripts = exportData.transcripts as Array<Record<string, unknown>>;
    const importedResult = exportData.result as Record<string, unknown> | null;
    const importedMemories = (exportData.agentMemories ?? []) as Array<Record<string, unknown>>;

    // Resolve slug collision
    let slug = importedGame.slug as string | null;
    if (slug) {
      const existing = (await db
        .select({ slug: schema.games.slug })
        .from(schema.games)
        .where(eq(schema.games.slug, slug)))[0];

      if (existing) {
        // Find next available -copy-N suffix
        const likePattern = `${slug}-copy-%`;
        const copies = await db
          .select({ slug: schema.games.slug })
          .from(schema.games)
          .where(like(schema.games.slug, likePattern));

        const maxN = copies.reduce((max, row) => {
          const match = (row.slug ?? "").match(/-copy-(\d+)$/);
          return match?.[1] ? Math.max(max, parseInt(match[1], 10)) : max;
        }, 0);

        slug = `${slug}-copy-${maxN + 1}`;
      }
    }
    if (!slug) {
      slug = await generateUniqueSlug(async (candidate) => {
        const existing = await db
          .select({ id: schema.games.id })
          .from(schema.games)
          .where(eq(schema.games.slug, candidate));
        return existing.length > 0;
      });
    }

    // UUID remapping tables
    const gameIdMap = new Map<string, string>(); // old game id → new game id
    const playerIdMap = new Map<string, string>(); // old player id → new player id
    const userIdMap = new Map<string, string>(); // old user id → new synthetic user id
    const resultIdMap = new Map<string, string>(); // old result id → new result id
    const memoryIdMap = new Map<string, string>(); // old memory id → new memory id

    const newGameId = randomUUID();
    gameIdMap.set(importedGame.id as string, newGameId);

    try {
      await db.transaction(async (tx) => {
        // 1. Create synthetic users for each player's userId
        const seenUserIds = new Set<string>();
        for (const player of importedPlayers) {
          const oldUserId = player.userId as string | null;
          if (!oldUserId || seenUserIds.has(oldUserId)) continue;
          seenUserIds.add(oldUserId);

          const newUserId = randomUUID();
          userIdMap.set(oldUserId, newUserId);

          // Derive display name from persona
          let displayName = "Imported Player";
          try {
            const persona = JSON.parse(player.persona as string);
            if (persona.name) displayName = persona.name;
          } catch { /* ignore parse errors */ }

          await tx.insert(schema.users).values({
            id: newUserId,
            walletAddress: `imported-${oldUserId}`,
            displayName,
          });
        }

        // 2. Create/reuse agent profiles
        for (const player of importedPlayers) {
          const profile = player.agentProfile as Record<string, unknown> | null;
          if (!profile) continue;

          const profileId = profile.id as string;
          // Check if agent profile already exists
          const existing = (await tx
            .select({ id: schema.agentProfiles.id })
            .from(schema.agentProfiles)
            .where(eq(schema.agentProfiles.id, profileId)))[0];

          if (!existing) {
            const ownerId = userIdMap.get(profile.userId as string) ?? (profile.userId as string);
            await tx.insert(schema.agentProfiles).values({
              id: profileId,
              userId: ownerId,
              name: profile.name as string,
              backstory: (profile.backstory as string) ?? null,
              personality: profile.personality as string,
              strategyStyle: (profile.strategyStyle as string) ?? null,
              personaKey: (profile.personaKey as string) ?? null,
              avatarUrl: (profile.avatarUrl as string) ?? null,
              gamesPlayed: (profile.gamesPlayed as number) ?? 0,
              gamesWon: (profile.gamesWon as number) ?? 0,
            });
          }
        }

        // 3. Insert game
        await tx.insert(schema.games).values({
          id: newGameId,
          slug,
          config: importedGame.config as string,
          status: importedGame.status as "waiting" | "in_progress" | "completed" | "cancelled",
          trackType: importedGame.trackType as "custom" | "free",
          minPlayers: importedGame.minPlayers as number,
          maxPlayers: importedGame.maxPlayers as number,
          createdById: null, // omitted per spec
          startedAt: (importedGame.startedAt as string) ?? null,
          endedAt: (importedGame.endedAt as string) ?? null,
          hiddenAt: (importedGame.hiddenAt as string) ?? null,
        });

        // 4. Insert game players with new IDs
        for (const player of importedPlayers) {
          const oldPlayerId = player.id as string;
          const newPlayerId = randomUUID();
          playerIdMap.set(oldPlayerId, newPlayerId);

          await tx.insert(schema.gamePlayers).values({
            id: newPlayerId,
            gameId: newGameId,
            userId: userIdMap.get(player.userId as string) ?? null,
            agentProfileId: (player.agentProfileId as string) ?? null,
            persona: player.persona as string,
            agentConfig: player.agentConfig as string,
          });
        }

        const remapPlayerRef = (value: unknown): unknown => {
          if (!value || typeof value !== "object") return value;
          const ref = value as Record<string, unknown>;
          return {
            ...ref,
            id: typeof ref.id === "string" ? (playerIdMap.get(ref.id) ?? ref.id) : ref.id,
          };
        };

        const remapRoomMetadata = (value: unknown): string | null => {
          if (!value) return null;
          try {
            const metadata = typeof value === "string" ? JSON.parse(value) : value;
            if (!metadata || typeof metadata !== "object") {
              return typeof value === "string" ? value : JSON.stringify(value);
            }

            const record = metadata as Record<string, unknown>;
            const diagnostics = record.diagnostics && typeof record.diagnostics === "object"
              ? record.diagnostics as Record<string, unknown>
              : undefined;

            const remapped = {
              ...record,
              rooms: Array.isArray(record.rooms)
                ? record.rooms.map((room) => {
                    if (!room || typeof room !== "object") return room;
                    const roomRecord = room as Record<string, unknown>;
                    return {
                      ...roomRecord,
                      playerIds: Array.isArray(roomRecord.playerIds)
                        ? roomRecord.playerIds.map((id) => typeof id === "string" ? (playerIdMap.get(id) ?? id) : id)
                        : roomRecord.playerIds,
                    };
                  })
                : record.rooms,
              ...(diagnostics && {
                diagnostics: {
                  ...diagnostics,
                  eligiblePlayers: Array.isArray(diagnostics.eligiblePlayers)
                    ? diagnostics.eligiblePlayers.map(remapPlayerRef)
                    : diagnostics.eligiblePlayers,
                  choices: Array.isArray(diagnostics.choices)
                    ? diagnostics.choices.map((choice) => {
                        if (!choice || typeof choice !== "object") return choice;
                        const choiceRecord = choice as Record<string, unknown>;
                        return {
                          ...choiceRecord,
                          player: remapPlayerRef(choiceRecord.player),
                        };
                      })
                    : diagnostics.choices,
                  allocatedRooms: Array.isArray(diagnostics.allocatedRooms)
                    ? diagnostics.allocatedRooms.map((room) => {
                        if (!room || typeof room !== "object") return room;
                        const roomRecord = room as Record<string, unknown>;
                        return {
                          ...roomRecord,
                          players: Array.isArray(roomRecord.players)
                            ? roomRecord.players.map(remapPlayerRef)
                            : roomRecord.players,
                        };
                      })
                    : diagnostics.allocatedRooms,
                },
              }),
            };
            return JSON.stringify(remapped);
          } catch {
            return typeof value === "string" ? value : null;
          }
        };

        // 5. Insert transcripts (remapping fromPlayerId, toPlayerIds, and room metadata)
        for (const t of importedTranscripts) {
          const fromPlayerId = t.fromPlayerId as string | null;
          const remappedFrom = fromPlayerId ? (playerIdMap.get(fromPlayerId) ?? fromPlayerId) : null;

          let remappedToPlayerIds: string | null = null;
          if (t.toPlayerIds) {
            try {
              const toIds = JSON.parse(t.toPlayerIds as string) as string[];
              const remapped = toIds.map((id) => playerIdMap.get(id) ?? id);
              remappedToPlayerIds = JSON.stringify(remapped);
            } catch {
              remappedToPlayerIds = t.toPlayerIds as string;
            }
          }

          await tx.insert(schema.transcripts).values({
            gameId: newGameId,
            round: t.round as number,
            phase: t.phase as string,
            fromPlayerId: remappedFrom,
            scope: t.scope as "public" | "mingle" | "whisper" | "system" | "diary" | "thinking" | "huddle",
            toPlayerIds: remappedToPlayerIds,
            roomId: (t.roomId as number) ?? null,
            roomMetadata: remapRoomMetadata(t.roomMetadata),
            text: t.text as string,
            thinking: (t.thinking as string | null) ?? null,
            timestamp: t.timestamp as number,
          });
        }

        // 6. Insert game result (remap winnerId)
        if (importedResult) {
          const newResultId = randomUUID();
          resultIdMap.set(importedResult.id as string, newResultId);

          const oldWinnerId = importedResult.winnerId as string | null;
          const newWinnerId = oldWinnerId ? (playerIdMap.get(oldWinnerId) ?? oldWinnerId) : null;

          await tx.insert(schema.gameResults).values({
            id: newResultId,
            gameId: newGameId,
            winnerId: newWinnerId,
            roundsPlayed: importedResult.roundsPlayed as number,
            tokenUsage: importedResult.tokenUsage as string,
          });
        }

        // 7. Insert agent memories (remap agentId)
        for (const m of importedMemories) {
          const newMemId = randomUUID();
          memoryIdMap.set(m.id as string, newMemId);

          const oldAgentId = m.agentId as string;
          const newAgentId = playerIdMap.get(oldAgentId) ?? oldAgentId;

          await tx.insert(schema.agentMemories).values({
            id: newMemId,
            gameId: newGameId,
            agentId: newAgentId,
            round: m.round as number,
            memoryType: m.memoryType as string,
            subject: (m.subject as string) ?? null,
            content: m.content as string,
          });
        }
      });
      await tryRefreshGameWatchStateSummary(db, newGameId, "admin_import");

      return c.json({ id: newGameId, gameId: newGameId, slug }, 201);
    } catch (err) {
      console.error("[import-game] Transaction failed:", err);
      return c.json({
        error: "Import failed — transaction rolled back",
        detail: err instanceof Error ? err.message : String(err),
      }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/remote-games — proxy to another env's game list
  // -------------------------------------------------------------------------

  app.get("/api/admin/remote-games", requireAdminRead, async (c) => {
    const url = c.req.query("url");
    if (!url) {
      return c.json({ error: "url query parameter is required" }, 400);
    }

    // Validate URL shape (basic safety check)
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return c.json({ error: "Invalid URL" }, 400);
    }

    // Only allow http/https
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return c.json({ error: "Only http/https URLs are allowed" }, 400);
    }

    // Forward the user's JWT to the remote env
    const authHeader = c.req.header("Authorization");
    const targetUrl = `${parsedUrl.origin}/api/games?status=completed`;

    try {
      const headers: Record<string, string> = {
        "Accept": "application/json",
      };
      if (authHeader) {
        headers["Authorization"] = authHeader;
      }

      const resp = await fetch(targetUrl, { headers });

      if (!resp.ok) {
        return c.json({
          error: `Remote server returned ${resp.status}`,
          detail: await resp.text(),
        }, resp.status as 400);
      }

      const data = await resp.json();
      return c.json(data);
    } catch (err) {
      return c.json({
        error: "Failed to fetch from remote environment",
        detail: err instanceof Error ? err.message : String(err),
      }, 502);
    }
  });

  return app;
}

function postgameHighlightsErrorResponse(
  c: Context<AuthEnv>,
  result: { status: PostgameHighlightsReadStatus; error: string },
) {
  if (result.status === "not_found") {
    return c.json({ error: result.error, status: result.status }, 404);
  }
  return c.json({ error: result.error, status: result.status }, 409);
}

function clampAdminLimit(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(Math.floor(value), 200));
}

function redactAvatarAdminMetadata(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) return null;
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll("_", "");
    if (
      normalized.includes("prompt")
      || normalized.includes("secret")
      || normalized.includes("token")
      || normalized.includes("originaldataurl")
      || normalized.includes("providerasseturl")
      || normalized === "draftprofile"
    ) {
      continue;
    }
    redacted[key] = entry;
  }
  return redacted;
}
