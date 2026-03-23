/**
 * Agent Profile REST API endpoint tests.
 *
 * Uses Hono's test client and PostgreSQL test database.
 */

import { describe, test, expect, beforeEach, beforeAll } from "bun:test";
import { Hono } from "hono";
import { schema } from "../db/index.js";
import type { DrizzleDB } from "../db/index.js";
import { createAgentProfileRoutes } from "../routes/agent-profiles.js";
import { createGameRoutes } from "../routes/games.js";
import { createSessionToken } from "../middleware/auth.js";
import { randomUUID } from "crypto";
import { setupTestDB } from "./test-utils.js";

// ---------------------------------------------------------------------------
// Set required env vars for auth
// ---------------------------------------------------------------------------

const TEST_ADMIN_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests";
  process.env.ADMIN_ADDRESS = TEST_ADMIN_ADDRESS;
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const USER_A_ID = "user-a-id";
const USER_B_ID = "user-b-id";

async function setupApp() {
  const db = await setupTestDB();

  await db.insert(schema.users)
    .values([
      {
        id: USER_A_ID,
        walletAddress: TEST_ADMIN_ADDRESS,
        email: "usera@test.com",
        displayName: "User A",
      },
      {
        id: USER_B_ID,
        walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        email: "userb@test.com",
        displayName: "User B",
      },
    ]);

  const tokenA = await createSessionToken(USER_A_ID, {
    roles: ["sysop"],
    permissions: ["manage_roles", "create_game", "start_game", "join_game", "stop_game", "fill_game", "view_admin"],
  });
  const tokenB = await createSessionToken(USER_B_ID, {
    roles: ["player"],
    permissions: ["join_game"],
  });

  const app = new Hono();
  app.route("/", createAgentProfileRoutes(db));
  app.route("/", createGameRoutes(db));

  return { app, db, tokenA, tokenB };
}

function jsonReq(body: unknown, token?: string, method = "POST"): RequestInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return { method, headers, body: JSON.stringify(body) };
}

function authGet(token: string): RequestInit {
  return {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  };
}

function authDelete(token: string): RequestInit {
  return {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Agent Profile API", () => {
  let app: Hono;
  let db: DrizzleDB;
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    ({ app, db, tokenA, tokenB } = await setupApp());
  });

  // =========================================================================
  // Auth enforcement
  // =========================================================================

  describe("auth enforcement", () => {
    test("POST /api/agent-profiles requires auth", async () => {
      const res = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Strategic" }),
      );
      expect(res.status).toBe(401);
    });

    test("GET /api/agent-profiles requires auth", async () => {
      const res = await app.request("/api/agent-profiles");
      expect(res.status).toBe(401);
    });

    test("GET /api/agent-profiles/:id requires auth", async () => {
      const res = await app.request(`/api/agent-profiles/${randomUUID()}`);
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // POST /api/agent-profiles
  // =========================================================================

  describe("POST /api/agent-profiles", () => {
    test("creates an agent profile", async () => {
      const res = await app.request(
        "/api/agent-profiles",
        jsonReq(
          {
            name: "Atlas",
            personality: "Strategic calculator who keeps options open",
            backstory: "Grew up in a small town...",
            strategyStyle: "Alliance-focused",
            personaKey: "strategic",
          },
          tokenA,
        ),
      );

      expect(res.status).toBe(201);
      const body = await res.json() as Record<string, unknown>;
      expect(body.id).toBeTruthy();
      expect(body.name).toBe("Atlas");
      expect(body.personality).toBe("Strategic calculator who keeps options open");
      expect(body.backstory).toBe("Grew up in a small town...");
      expect(body.personaKey).toBe("strategic");
      expect(body.gamesPlayed).toBe(0);
      expect(body.gamesWon).toBe(0);
    });

    test("rejects missing name", async () => {
      const res = await app.request(
        "/api/agent-profiles",
        jsonReq({ personality: "Test" }, tokenA),
      );
      expect(res.status).toBe(400);
    });

    test("rejects missing personality", async () => {
      const res = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas" }, tokenA),
      );
      expect(res.status).toBe(400);
    });

    test("rejects invalid personaKey", async () => {
      const res = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Test", personaKey: "invalid" }, tokenA),
      );
      expect(res.status).toBe(400);
    });

    test("creates profile with minimal fields", async () => {
      const res = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Minimalist", personality: "Quiet observer" }, tokenA),
      );
      expect(res.status).toBe(201);
      const body = await res.json() as Record<string, unknown>;
      expect(body.backstory).toBeNull();
      expect(body.strategyStyle).toBeNull();
      expect(body.personaKey).toBeNull();
    });
  });

  // =========================================================================
  // GET /api/agent-profiles
  // =========================================================================

  describe("GET /api/agent-profiles", () => {
    test("returns empty array for user with no profiles", async () => {
      const res = await app.request("/api/agent-profiles", authGet(tokenA));
      expect(res.status).toBe(200);
      const body = await res.json() as unknown[];
      expect(body).toEqual([]);
    });

    test("returns only the authenticated user's profiles", async () => {
      await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "A1", personality: "P1" }, tokenA),
      );
      await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "A2", personality: "P2" }, tokenA),
      );
      await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "B1", personality: "P3" }, tokenB),
      );

      const resA = await app.request("/api/agent-profiles", authGet(tokenA));
      const bodyA = await resA.json() as Array<{ name: string }>;
      expect(bodyA).toHaveLength(2);

      const resB = await app.request("/api/agent-profiles", authGet(tokenB));
      const bodyB = await resB.json() as Array<{ name: string }>;
      expect(bodyB).toHaveLength(1);
      expect(bodyB[0]!.name).toBe("B1");
    });
  });

  // =========================================================================
  // GET /api/agent-profiles/:id
  // =========================================================================

  describe("GET /api/agent-profiles/:id", () => {
    test("returns a specific profile", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const res = await app.request(`/api/agent-profiles/${id}`, authGet(tokenA));
      expect(res.status).toBe(200);
      const body = await res.json() as { name: string };
      expect(body.name).toBe("Atlas");
    });

    test("returns 404 for non-existent profile", async () => {
      const res = await app.request(`/api/agent-profiles/${randomUUID()}`, authGet(tokenA));
      expect(res.status).toBe(404);
    });

    test("returns 404 when accessing another user's profile", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Secret", personality: "Hidden" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const res = await app.request(`/api/agent-profiles/${id}`, authGet(tokenB));
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // PATCH /api/agent-profiles/:id
  // =========================================================================

  describe("PATCH /api/agent-profiles/:id", () => {
    test("updates profile fields", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const res = await app.request(
        `/api/agent-profiles/${id}`,
        jsonReq({ name: "Atlas v2", backstory: "New backstory" }, tokenA, "PATCH"),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { name: string; backstory: string; statsReset: boolean };
      expect(body.name).toBe("Atlas v2");
      expect(body.backstory).toBe("New backstory");
      expect(body.statsReset).toBe(false);
    });

    test("resets stats when personality changes and games have been played", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      // Simulate games played
      const { eq } = await import("drizzle-orm");
      await db.update(schema.agentProfiles)
        .set({ gamesPlayed: 5, gamesWon: 2 })
        .where(eq(schema.agentProfiles.id, id));

      const res = await app.request(
        `/api/agent-profiles/${id}`,
        jsonReq({ personality: "New personality" }, tokenA, "PATCH"),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { gamesPlayed: number; gamesWon: number; statsReset: boolean };
      expect(body.statsReset).toBe(true);
      expect(body.gamesPlayed).toBe(0);
      expect(body.gamesWon).toBe(0);
    });

    test("returns 404 when updating another user's profile", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const res = await app.request(
        `/api/agent-profiles/${id}`,
        jsonReq({ name: "Hijacked" }, tokenB, "PATCH"),
      );
      expect(res.status).toBe(404);
    });

    test("rejects invalid personaKey on update", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const res = await app.request(
        `/api/agent-profiles/${id}`,
        jsonReq({ personaKey: "invalid" }, tokenA, "PATCH"),
      );
      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // DELETE /api/agent-profiles/:id
  // =========================================================================

  describe("DELETE /api/agent-profiles/:id", () => {
    test("deletes a profile", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const res = await app.request(`/api/agent-profiles/${id}`, authDelete(tokenA));
      expect(res.status).toBe(200);

      // Verify deleted
      const profiles = await db.select().from(schema.agentProfiles);
      expect(profiles).toHaveLength(0);
    });

    test("returns 404 when deleting another user's profile", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const res = await app.request(`/api/agent-profiles/${id}`, authDelete(tokenB));
      expect(res.status).toBe(404);

      // Verify NOT deleted
      const profiles = await db.select().from(schema.agentProfiles);
      expect(profiles).toHaveLength(1);
    });

    test("clears agentProfileId references in game_players", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Strategic" }, tokenA),
      );
      const { id: profileId } = await createRes.json() as { id: string };

      const gameRes = await app.request(
        "/api/games",
        jsonReq({ playerCount: 6, modelTier: "budget", timingPreset: "fast" }, tokenA),
      );
      const { id: gameId } = await gameRes.json() as { id: string };

      const joinRes = await app.request(
        `/api/games/${gameId}/join`,
        jsonReq({ agentProfileId: profileId }, tokenA),
      );
      expect(joinRes.status).toBe(201);

      // Verify the game_player has agentProfileId set
      const { eq } = await import("drizzle-orm");
      let gamePlayers = await db.select().from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId));
      expect(gamePlayers[0]!.agentProfileId).toBe(profileId);

      // Delete the profile
      await app.request(`/api/agent-profiles/${profileId}`, authDelete(tokenA));

      // Verify agentProfileId is now null
      gamePlayers = await db.select().from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId));
      expect(gamePlayers[0]!.agentProfileId).toBeNull();
    });
  });

  // =========================================================================
  // Join game with saved profile
  // =========================================================================

  describe("join game with agent profile", () => {
    test("joins a game using a saved agent profile", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq(
          {
            name: "Atlas",
            personality: "Strategic calculator",
            strategyStyle: "Alliance builder",
            personaKey: "strategic",
          },
          tokenA,
        ),
      );
      const { id: profileId } = await createRes.json() as { id: string };

      const gameRes = await app.request(
        "/api/games",
        jsonReq({ playerCount: 6, modelTier: "budget", timingPreset: "fast" }, tokenA),
      );
      const { id: gameId } = await gameRes.json() as { id: string };

      const joinRes = await app.request(
        `/api/games/${gameId}/join`,
        jsonReq({ agentProfileId: profileId }, tokenA),
      );
      expect(joinRes.status).toBe(201);

      const players = await db.select().from(schema.gamePlayers);
      expect(players).toHaveLength(1);
      expect(players[0]!.agentProfileId).toBe(profileId);

      const persona = JSON.parse(players[0]!.persona);
      expect(persona.name).toBe("Atlas");
      expect(persona.personality).toBe("Strategic calculator");
      expect(persona.strategyHints).toBe("Alliance builder");
      expect(persona.personaKey).toBe("strategic");
    });

    test("rejects join with non-existent profile", async () => {
      const gameRes = await app.request(
        "/api/games",
        jsonReq({ playerCount: 6, modelTier: "budget", timingPreset: "fast" }, tokenA),
      );
      const { id: gameId } = await gameRes.json() as { id: string };

      const res = await app.request(
        `/api/games/${gameId}/join`,
        jsonReq({ agentProfileId: randomUUID() }, tokenA),
      );
      expect(res.status).toBe(404);
    });

    test("rejects join with another user's profile", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Strategic" }, tokenA),
      );
      const { id: profileId } = await createRes.json() as { id: string };

      const gameRes = await app.request(
        "/api/games",
        jsonReq({ playerCount: 6, modelTier: "budget", timingPreset: "fast" }, tokenA),
      );
      const { id: gameId } = await gameRes.json() as { id: string };

      const res = await app.request(
        `/api/games/${gameId}/join`,
        jsonReq({ agentProfileId: profileId }, tokenB),
      );
      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // POST /api/agent-profiles/generate — AI personality builder
  // =========================================================================

  describe("POST /api/agent-profiles/generate", () => {
    test("requires auth", async () => {
      const res = await app.request(
        "/api/agent-profiles/generate",
        jsonReq({ traits: "charming, witty" }),
      );
      expect(res.status).toBe(401);
    });

    test("rejects empty input", async () => {
      const res = await app.request(
        "/api/agent-profiles/generate",
        jsonReq({}, tokenA),
      );
      expect(res.status).toBe(400);
    });

    test("returns 503 when OPENAI_API_KEY is not set", async () => {
      const savedKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        const res = await app.request(
          "/api/agent-profiles/generate",
          jsonReq({ traits: "charming, witty" }, tokenA),
        );
        expect(res.status).toBe(503);
      } finally {
        if (savedKey) process.env.OPENAI_API_KEY = savedKey;
      }
    });

    // LLM integration test — only runs with OPENAI_API_KEY set (doppler run)
    const llmTest = process.env.OPENAI_API_KEY ? test : test.skip;

    llmTest("generates a personality from traits", async () => {
      const res = await app.request(
        "/api/agent-profiles/generate",
        jsonReq({ traits: "charming, manipulative, always smiling", occupation: "used car salesman" }, tokenA),
      );
      expect(res.status).toBe(200);

      const body = await res.json() as {
        name: string;
        backstory: string | null;
        personality: string;
        strategyStyle: string | null;
        personaKey: string;
      };
      expect(body.name).toBeTruthy();
      expect(body.personality).toBeTruthy();
      expect(body.personaKey).toBeTruthy();
    }, 15_000);

    llmTest("generates a personality from archetype only", async () => {
      const res = await app.request(
        "/api/agent-profiles/generate",
        jsonReq({ archetype: "wildcard" }, tokenA),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { personaKey: string };
      expect(body.personaKey).toBeTruthy();
    }, 15_000);

    llmTest("refines an existing profile", async () => {
      const res = await app.request(
        "/api/agent-profiles/generate",
        jsonReq({
          existingProfile: {
            name: "Rex",
            personality: "Aggressive and loud",
            backstory: "Former bouncer",
          },
          traits: "add some vulnerability, a soft side",
        }, tokenA),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { name: string; backstory: string };
      expect(body.name).toBeTruthy();
      expect(body.backstory).toBeTruthy();
    }, 15_000);
  });
});
