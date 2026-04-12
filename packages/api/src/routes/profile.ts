/**
 * Player Profile & Leaderboard REST API routes.
 *
 *   GET    /api/profile             — get current user's profile (with ELO)
 *   PATCH  /api/profile             — update display name
 *   GET    /api/leaderboard         — top 100 accounts by ELO
 */

import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  requireAuth,
  type AuthEnv,
} from "../middleware/auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import { getPublicDisplayName, isEmailLike } from "../lib/display-name.js";

// ---------------------------------------------------------------------------
// Factory — creates a Hono sub-app with injected DB
// ---------------------------------------------------------------------------

export function createProfileRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  // -------------------------------------------------------------------------
  // GET /api/profile — get current user's profile with ELO stats
  // -------------------------------------------------------------------------

  app.get("/api/profile", requireAuth(db), async (c) => {
    const user = c.get("user");

    const profile = (await db
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        walletAddress: schema.users.walletAddress,
        email: schema.users.email,
        rating: schema.users.rating,
        gamesPlayed: schema.users.gamesPlayed,
        gamesWon: schema.users.gamesWon,
        peakRating: schema.users.peakRating,
        lastGameAt: schema.users.lastGameAt,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, user.id)))[0];

    if (!profile) {
      return c.json({ error: "User not found" }, 404);
    }

    return c.json(profile);
  });

  // -------------------------------------------------------------------------
  // PATCH /api/profile — update display name
  // -------------------------------------------------------------------------

  app.patch("/api/profile", requireAuth(db), async (c) => {
    const user = c.get("user");
    const body = await parseJsonBody(c, "PATCH /api/profile");
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { displayName } = body as { displayName?: string };

    if (displayName === undefined || displayName === null) {
      return c.json({ error: "displayName is required" }, 400);
    }

    const trimmed = String(displayName).trim();
    if (trimmed.length === 0 || trimmed.length > 50) {
      return c.json({ error: "displayName must be 1-50 characters" }, 400);
    }
    if (isEmailLike(trimmed)) {
      return c.json({ error: "displayName cannot be an email address" }, 400);
    }

    await db.update(schema.users)
      .set({ displayName: trimmed })
      .where(eq(schema.users.id, user.id));

    const updated = (await db
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        walletAddress: schema.users.walletAddress,
        email: schema.users.email,
        rating: schema.users.rating,
        gamesPlayed: schema.users.gamesPlayed,
        gamesWon: schema.users.gamesWon,
        peakRating: schema.users.peakRating,
        lastGameAt: schema.users.lastGameAt,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, user.id)))[0];

    return c.json(updated);
  });

  // -------------------------------------------------------------------------
  // GET /api/leaderboard — top 100 accounts by ELO
  // -------------------------------------------------------------------------

  app.get("/api/leaderboard", async (c) => {
    const rows = await db
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        email: schema.users.email,
        walletAddress: schema.users.walletAddress,
        rating: schema.users.rating,
        gamesPlayed: schema.users.gamesPlayed,
        gamesWon: schema.users.gamesWon,
        peakRating: schema.users.peakRating,
      })
      .from(schema.users)
      .orderBy(desc(schema.users.rating))
      .limit(100);

    // Only include users who have played at least one game
    const leaderboard = rows
      .filter((r) => r.gamesPlayed > 0)
      .map((r, i) => ({
        rank: i + 1,
        userId: r.id,
        displayName: getPublicDisplayName(r),
        rating: r.rating,
        gamesPlayed: r.gamesPlayed,
        gamesWon: r.gamesWon,
        winRate: r.gamesPlayed > 0 ? r.gamesWon / r.gamesPlayed : 0,
        peakRating: r.peakRating,
      }));

    return c.json(leaderboard);
  });

  // -------------------------------------------------------------------------
  // GET /api/profile/invite-codes — get current user's invite codes
  // -------------------------------------------------------------------------

  app.get("/api/profile/invite-codes", requireAuth(db), async (c) => {
    const user = c.get("user");

    const codes = await db
      .select({
        id: schema.inviteCodes.id,
        code: schema.inviteCodes.code,
        usedById: schema.inviteCodes.usedById,
        usedAt: schema.inviteCodes.usedAt,
        createdAt: schema.inviteCodes.createdAt,
      })
      .from(schema.inviteCodes)
      .where(eq(schema.inviteCodes.ownerId, user.id));

    const available = codes.filter((c) => !c.usedById);
    const used = codes.filter((c) => c.usedById);

    return c.json({
      available: available.map((c) => ({ code: c.code, createdAt: c.createdAt })),
      used: used.map((c) => ({ code: c.code, usedAt: c.usedAt })),
      totalAvailable: available.length,
      totalUsed: used.length,
    });
  });

  return app;
}
