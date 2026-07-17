/**
 * Player Profile & Leaderboard REST API routes.
 *
 *   GET    /api/profile             — get current user's profile (with ELO)
 *   PATCH  /api/profile             — update public display name and handle
 *   GET    /api/leaderboard         — top 100 accounts by ELO
 */

import { Hono } from "hono";
import { eq, desc, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  requireAuth,
  type AuthEnv,
} from "../middleware/auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import {
  getPublicDisplayName,
  hasSafePublicDisplayName,
  isEmailLike,
} from "../lib/display-name.js";
import {
  isPublicPlayerHandleConflict,
  normalizePublicPlayerHandle,
  suggestPublicPlayerHandle,
  validatePublicPlayerHandle,
} from "../lib/public-player-identity.js";
import { projectAuthenticatedPublicIdentity } from "../services/authenticated-public-identity.js";

// ---------------------------------------------------------------------------
// Factory — creates a Hono sub-app with injected DB
// ---------------------------------------------------------------------------

export function createProfileRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  app.get("/api/profile/handle-suggestion", requireAuth(db), async (c) => {
    const displayName = c.req.query("displayName")?.trim() ?? "";
    if (!isValidDisplayName(displayName)) {
      return c.json({ error: "A valid displayName is required" }, 400);
    }

    const suggestion = await suggestAvailableHandle(db, displayName, c.get("user").id);
    if (!suggestion) {
      return c.json({ error: "Could not find an available handle" }, 409);
    }
    return c.json({ suggestion });
  });

  // -------------------------------------------------------------------------
  // GET /api/profile — get current user's profile with ELO stats
  // -------------------------------------------------------------------------

  app.get("/api/profile", requireAuth(db), async (c) => {
    const user = c.get("user");

    const profile = await loadPrivateProfile(db, user.id);

    if (!profile) {
      return c.json({ error: "User not found" }, 404);
    }

    return c.json(toPrivateProfileResponse(profile));
  });

  // -------------------------------------------------------------------------
  // PATCH /api/profile — update public display name and handle
  // -------------------------------------------------------------------------

  app.patch("/api/profile", requireAuth(db), async (c) => {
    const user = c.get("user");
    const body = await parseJsonBody(c, "PATCH /api/profile");
    if (!body) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { displayName, handle } = body as { displayName?: string; handle?: string };

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

    const current = await loadPrivateProfile(db, user.id);
    if (!current) {
      return c.json({ error: "User not found" }, 404);
    }
    if (!hasSafePublicDisplayName({
      displayName: trimmed,
      email: current.email,
      walletAddress: current.walletAddress,
    })) {
      return c.json({ error: "displayName must not be an account placeholder" }, 400);
    }

    if (handle === undefined && current.handle === null) {
      return c.json({ error: "handle is required" }, 400);
    }
    const normalizedHandle = handle === undefined
      ? current.handle!
      : normalizePublicPlayerHandle(String(handle));
    const handleValidation = validatePublicPlayerHandle(normalizedHandle);
    if (!handleValidation.ok) {
      return c.json({
        error: `handle is invalid: ${handleValidation.reason}`,
        code: "INVALID_HANDLE",
      }, 400);
    }

    try {
      const updated = (await db.update(schema.users)
        .set({
          displayName: trimmed,
          handle: handleValidation.handle,
        })
        .where(eq(schema.users.id, user.id))
        .returning())[0];
      if (!updated) {
        return c.json({ error: "User not found" }, 404);
      }
      return c.json(toPrivateProfileResponse(updated));
    } catch (error) {
      if (!isPublicPlayerHandleConflict(error)) {
        throw error;
      }
      const suggestion = await suggestAvailableHandle(db, trimmed, user.id);
      return c.json({
        error: "That handle is already taken",
        code: "HANDLE_TAKEN",
        suggestion,
      }, 409);
    }
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

async function loadPrivateProfile(db: DrizzleDB, userId: string) {
  return (await db
    .select({
      id: schema.users.id,
      publicId: schema.users.publicId,
      handle: schema.users.handle,
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
    .where(eq(schema.users.id, userId)))[0];
}

function toPrivateProfileResponse(profile: NonNullable<Awaited<ReturnType<typeof loadPrivateProfile>>>) {
  return {
    ...profile,
    ...projectAuthenticatedPublicIdentity(profile),
  };
}

function isValidDisplayName(displayName: string): boolean {
  return displayName.length > 0 && displayName.length <= 50 && !isEmailLike(displayName);
}

async function suggestAvailableHandle(
  db: DrizzleDB,
  displayName: string,
  currentUserId: string,
): Promise<string | null> {
  return suggestPublicPlayerHandle(displayName, async (candidate) => {
    const owner = (await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.handle}) = ${candidate}`)
      .limit(1))[0];
    return !owner || owner.id === currentUserId;
  });
}
