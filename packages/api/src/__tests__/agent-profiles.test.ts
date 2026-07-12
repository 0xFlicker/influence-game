/**
 * Agent Profile REST API endpoint tests.
 *
 * Uses Hono's test client and PostgreSQL test database.
 */

import { describe, test, expect, beforeEach, beforeAll } from "bun:test";
import { Hono } from "hono";
import { schema } from "../db/index.js";
import type { DrizzleDB } from "../db/index.js";
import {
  createAgentProfileRoutes,
  resolveAgentProfileGenerationLlm,
} from "../routes/agent-profiles.js";
import { createGameRoutes } from "../routes/games.js";
import { createSessionToken } from "../middleware/auth.js";
import { randomUUID } from "crypto";
import { setupTestDB } from "./test-utils.js";
import { eq } from "drizzle-orm";
import { joinQueue } from "../services/queue-enrollment.js";
import { createSeason } from "../services/seasons.js";
import { avatarProfileFingerprint } from "../services/avatar-generation.js";

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

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
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
            gender: "female",
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
      expect(body.gender).toBe("female");
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
      const body = await res.json() as { error: string };
      expect(body.error).toContain("contrarian");
      expect(body.error).toContain("provocateur");
      expect(body.error).toContain("martyr");
      expect(body.error).not.toContain("broker");
    });

    test("rejects invalid gender", async () => {
      const res = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Test", gender: "unknown" }, tokenA),
      );
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("gender");
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
      expect(body.gender).toBeNull();
      expect(body.avatarCompletion).toMatchObject({
        status: "skipped",
        failureCode: "provider_not_configured",
      });

      const generations = await db.select().from(schema.avatarGenerationRequests);
      expect(generations).toHaveLength(1);
      expect(generations[0]!.triggerSource).toBe("web_create_default");
    });

    test("reuses an AI Help draft portrait attempt instead of requesting again on create", async () => {
      const draftRes = await app.request(
        "/api/agent-profiles/avatar/generate-draft",
        jsonReq({
          name: "Mira",
          gender: "female",
          personality: "A patient mediator.",
          backstory: "She grew up translating between rival communities.",
          strategyStyle: "Build stable coalitions.",
          personaKey: "diplomat",
        }, tokenA),
      );
      expect(draftRes.status).toBe(200);
      const draft = await draftRes.json() as {
        avatarCompletion: { generationRequestId: string; status: string };
      };
      expect(draft.avatarCompletion.status).toBe("skipped");
      expect(draft.avatarCompletion.generationRequestId).toBeTruthy();

      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({
          name: "Mira",
          gender: "female",
          personality: "A patient mediator.",
          backstory: "She grew up translating between rival communities.",
          strategyStyle: "Build stable coalitions.",
          personaKey: "diplomat",
          avatarGenerationRequestId: draft.avatarCompletion.generationRequestId,
        }, tokenA),
      );
      expect(createRes.status).toBe(201);
      expect(await createRes.json()).toMatchObject({
        avatarUrl: null,
        avatarCompletion: { status: "skipped" },
      });

      const generations = await db.select().from(schema.avatarGenerationRequests);
      expect(generations).toHaveLength(1);
      expect(generations[0]!.agentProfileId).toStartWith("draft-");
    });

    test("attaches a completed AI Help portrait as generated media", async () => {
      await db.insert(schema.avatarGenerationRequests).values({
        id: "completed-draft-request",
        userId: USER_A_ID,
        agentProfileId: "draft-completed-mira",
        purpose: "agent_profile_completion",
        status: "completed",
        triggerSource: "web_user_prompt",
        provider: "katana",
        model: "gen",
        safeMetadata: {
          draftProfile: {
            name: "Mira",
            gender: "female",
            backstory: null,
            personality: "A patient mediator.",
            strategyStyle: null,
            personaKey: "diplomat",
          },
          profileFingerprint: avatarProfileFingerprint({
            name: "Mira",
            gender: "female",
            backstory: null,
            personality: "A patient mediator.",
            strategyStyle: null,
            personaKey: "diplomat",
          }),
          avatarUrl: "/api/uploads/local?key=pfp%2Fgenerated%2Fmira.png",
        },
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:01:00.000Z",
        completedAt: "2026-07-12T00:01:00.000Z",
      });

      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({
          name: "Mira",
          gender: "female",
          personality: "A patient mediator.",
          personaKey: "diplomat",
          avatarGenerationRequestId: "completed-draft-request",
        }, tokenA),
      );
      expect(createRes.status).toBe(201);
      const created = await createRes.json() as { avatarUrl: string };
      expect(created.avatarUrl).toContain("pfp%2Fgenerated%2Fmira.png");

      const [change] = await db.select().from(schema.avatarChangeEvents);
      expect(change).toMatchObject({
        source: "web_generated_completion",
        generationRequestId: "completed-draft-request",
      });
      expect(await db.select().from(schema.avatarGenerationRequests)).toHaveLength(1);

      const duplicate = await app.request(
        "/api/agent-profiles",
        jsonReq({
          name: "Mira",
          gender: "female",
          personality: "A patient mediator.",
          personaKey: "diplomat",
          avatarGenerationRequestId: "completed-draft-request",
        }, tokenA),
      );
      expect(duplicate.status).toBe(400);
    });

    test("keeps an explicit upload authoritative over an unrelated draft", async () => {
      await db.insert(schema.avatarGenerationRequests).values({
        id: "ignored-draft-request",
        userId: USER_A_ID,
        agentProfileId: "draft-ignored",
        purpose: "agent_profile_completion",
        status: "completed",
        triggerSource: "web_ai_help_draft",
        provider: "katana",
        model: "gen",
        safeMetadata: {
          draftProfile: { name: "Other", gender: "male", personality: "Other", backstory: null, strategyStyle: null, personaKey: "strategic" },
          profileFingerprint: "different",
          avatarUrl: "/api/uploads/local?key=generated.png",
        },
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:01:00.000Z",
        completedAt: "2026-07-12T00:01:00.000Z",
      });

      const res = await app.request("/api/agent-profiles", jsonReq({
        name: "Uploaded Mira",
        gender: "female",
        personality: "A patient mediator.",
        avatarUrl: "/api/uploads/local?key=uploaded.png",
        avatarGenerationRequestId: "ignored-draft-request",
      }, tokenA));
      expect(res.status).toBe(201);
      const [change] = await db.select().from(schema.avatarChangeEvents);
      expect(change).toMatchObject({ source: "web_upload", generationRequestId: null });
      expect(change!.newAvatarUrl).toContain("uploaded.png");
    });

    test("skips automatic avatar generation when the user has no quota allowance", async () => {
      const saved = {
        key: process.env.API_KAT_IMGNAI_KEY,
        secret: process.env.API_KAT_IMGNAI_SECRET,
        quota: process.env.INFLUENCE_AVATAR_GENERATION_FREE_QUOTA,
      };
      process.env.API_KAT_IMGNAI_KEY = "kat-key";
      process.env.API_KAT_IMGNAI_SECRET = "kat-secret";
      process.env.INFLUENCE_AVATAR_GENERATION_FREE_QUOTA = "1";

      try {
        await db.insert(schema.avatarGenerationRequests).values({
          id: "existing-generation",
          userId: USER_B_ID,
          agentProfileId: "prior-agent",
          purpose: "agent_profile_completion",
          status: "completed",
          triggerSource: "web_create_default",
          provider: "katana",
          model: "gen",
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        });

        const res = await app.request(
          "/api/agent-profiles",
          jsonReq({ name: "Quota Agent", personality: "Quiet", gender: "male" }, tokenB),
        );
        expect(res.status).toBe(201);
        expect(await res.json()).toMatchObject({
          avatarUrl: null,
          avatarCompletion: {
            status: "skipped",
            failureCode: "quota_exhausted",
          },
        });
      } finally {
        restoreEnv("API_KAT_IMGNAI_KEY", saved.key);
        restoreEnv("API_KAT_IMGNAI_SECRET", saved.secret);
        restoreEnv("INFLUENCE_AVATAR_GENERATION_FREE_QUOTA", saved.quota);
      }
    });

    test("records avatar change history when creating with an avatar", async () => {
      const res = await app.request(
        "/api/agent-profiles",
        jsonReq({
          name: "Atlas Avatar",
          personality: "Strategic",
          avatarUrl: "/api/uploads/local?key=pfp%2Fuser-a%2Fatlas.png",
        }, tokenA),
      );

      expect(res.status).toBe(201);
      const body = await res.json() as { id: string; avatarUrl: string };
      expect(body.avatarUrl).toContain("/api/uploads/local?key=pfp%2Fuser-a%2Fatlas.png");

      const changes = await db.select().from(schema.avatarChangeEvents);
      expect(changes).toHaveLength(1);
      expect(changes[0]!).toMatchObject({
        agentProfileId: body.id,
        source: "web_upload",
        status: "completed",
        previousAvatarUrl: null,
        newAvatarUrl: body.avatarUrl,
      });
      expect(await db.select().from(schema.avatarGenerationRequests)).toHaveLength(0);
    });

    test("requests generated avatar completion for an owned avatarless profile", async () => {
      delete process.env.API_KAT_IMGNAI_KEY;
      delete process.env.API_KAT_IMGNAI_SECRET;
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "No Avatar", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const res = await app.request(
        `/api/agent-profiles/${id}/avatar/generate`,
        jsonReq({}, tokenA),
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { avatarCompletion: { status: string; reason: string } };
      expect(body.avatarCompletion.status).toBe("skipped");
      expect(body.avatarCompletion.reason).toContain("not configured");

      const statusRes = await app.request(`/api/agent-profiles/${id}/avatar/generation`, authGet(tokenA));
      expect(statusRes.status).toBe(200);
      const statusBody = await statusRes.json() as { avatarCompletion: { status: string } };
      expect(statusBody.avatarCompletion.status).toBe("skipped");
    });

    test("does not let another user request avatar generation", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Private Avatar", personality: "Hidden" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const res = await app.request(
        `/api/agent-profiles/${id}/avatar/generate`,
        jsonReq({}, tokenB),
      );

      expect(res.status).toBe(404);
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

    test("includes latest avatar completion only for profiles with a generation request", async () => {
      delete process.env.API_KAT_IMGNAI_KEY;
      delete process.env.API_KAT_IMGNAI_SECRET;
      const withRequestRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Requested Avatar", personality: "Strategic" }, tokenA),
      );
      const withoutRequestRes = await app.request(
        "/api/agent-profiles",
        jsonReq({
          name: "No Request",
          personality: "Quiet",
          avatarUrl: "/api/uploads/local?key=pfp%2Fuser-a%2Fno-request.png",
        }, tokenA),
      );
      const { id: withRequestId } = await withRequestRes.json() as { id: string };
      const { id: withoutRequestId } = await withoutRequestRes.json() as { id: string };

      await app.request(
        `/api/agent-profiles/${withRequestId}/avatar/generate`,
        jsonReq({}, tokenA),
      );

      const res = await app.request("/api/agent-profiles", authGet(tokenA));
      expect(res.status).toBe(200);
      const body = await res.json() as Array<{
        id: string;
        avatarCompletion?: { status: string; reason?: string; generationRequestId?: string };
      }>;
      const requested = body.find((agent) => agent.id === withRequestId);
      const noRequest = body.find((agent) => agent.id === withoutRequestId);

      expect(requested?.avatarCompletion?.status).toBe("skipped");
      expect(requested?.avatarCompletion?.reason).toContain("not configured");
      expect(requested?.avatarCompletion?.generationRequestId).toBeTruthy();
      expect(noRequest?.avatarCompletion).toBeUndefined();

      const statusRes = await app.request(
        `/api/agent-profiles/avatar-generations?ids=${withRequestId},${withoutRequestId}`,
        authGet(tokenA),
      );
      expect(statusRes.status).toBe(200);
      const statusBody = await statusRes.json() as {
        avatarCompletions: Record<string, { status: string; reason?: string }>;
      };
      expect(statusBody.avatarCompletions[withRequestId]?.status).toBe("skipped");
      expect(statusBody.avatarCompletions[withoutRequestId]).toBeUndefined();
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
        jsonReq({ name: "Atlas v2", backstory: "New backstory", gender: "non-binary" }, tokenA, "PATCH"),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { name: string; backstory: string; gender: string; statsReset: boolean };
      expect(body.name).toBe("Atlas v2");
      expect(body.backstory).toBe("New backstory");
      expect(body.gender).toBe("non-binary");
      expect(body.statsReset).toBe(false);
    });

    test("records avatar replacement history", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({
          name: "Atlas",
          personality: "Strategic",
          avatarUrl: "https://cdn.example/old.png",
        }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const res = await app.request(
        `/api/agent-profiles/${id}`,
        jsonReq({ avatarUrl: "https://cdn.example/new.png" }, tokenA, "PATCH"),
      );

      expect(res.status).toBe(200);
      const changes = await db
        .select()
        .from(schema.avatarChangeEvents);
      expect(changes.map((change) => change.source)).toEqual(["web_upload", "web_manual_update"]);
      expect(changes[1]!).toMatchObject({
        previousAvatarUrl: "https://cdn.example/old.png",
        newAvatarUrl: "https://cdn.example/new.png",
      });
    });

    test("preserves lifetime stats when personality changes", async () => {
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
      expect(body.statsReset).toBe(false);
      expect(body.gamesPlayed).toBe(5);
      expect(body.gamesWon).toBe(2);
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

    test("deletes a profile without deleting avatar audit history", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({
          name: "Atlas",
          personality: "Strategic",
          avatarUrl: "https://cdn.example/avatar.png",
        }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };
      expect(await db.select().from(schema.avatarChangeEvents)).toHaveLength(1);

      const res = await app.request(`/api/agent-profiles/${id}`, authDelete(tokenA));
      expect(res.status).toBe(200);

      const profiles = await db.select().from(schema.agentProfiles)
        .where(eq(schema.agentProfiles.id, id));
      expect(profiles).toHaveLength(0);
      const history = await db.select().from(schema.avatarChangeEvents)
        .where(eq(schema.avatarChangeEvents.agentProfileId, id));
      expect(history).toHaveLength(1);
      expect(history[0]!.newAvatarUrl).toBe("https://cdn.example/avatar.png");
    });

    test("blocks deleting the standing Daily Free agent", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };
      await db.insert(schema.freeGameQueue).values({
        id: randomUUID(),
        userId: USER_A_ID,
        agentProfileId: id,
      });

      const res = await app.request(`/api/agent-profiles/${id}`, authDelete(tokenA));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "daily_free_entry_exists" });
      expect(await db.select().from(schema.agentProfiles)).toHaveLength(1);
    });

    test("linearizes standing enrollment against deleting the same agent", async () => {
      await createSeason(db, { slug: "delete-race", name: "Delete Race" });
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const [joinResult, deleteResult] = await Promise.allSettled([
        joinQueue(db, { userId: USER_A_ID }, { queueType: "daily-free", agentId: id }),
        app.request(`/api/agent-profiles/${id}`, authDelete(tokenA)),
      ]);
      const deleteResponse = deleteResult.status === "fulfilled" ? deleteResult.value : null;
      expect(deleteResult.status).toBe("fulfilled");
      expect([200, 409]).toContain(deleteResponse!.status);
      if (joinResult.status === "rejected") {
        expect(joinResult.reason).toMatchObject({ code: "agent_not_found" });
        expect(deleteResponse!.status).toBe(200);
      } else {
        expect(deleteResponse!.status).toBe(409);
      }
      const profiles = await db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, id));
      const entries = await db.select().from(schema.freeGameQueue).where(eq(schema.freeGameQueue.agentProfileId, id));
      expect(profiles.length).toBe(entries.length);
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

    test("returns a clear conflict instead of breaking linked producer season history", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };
      const revision = (await db.select().from(schema.agentRevisions)
        .where(eq(schema.agentRevisions.agentProfileId, id)))[0]!;
      await db.insert(schema.agentCompetitionRatings).values({
        agentProfileId: id,
        effectiveRevisionId: revision.id,
        mu: 25,
        sigma: 25 / 3,
        gamesPlayed: 1,
        ratingPolicyVersion: "competition-rating-v1",
      });

      const res = await app.request(`/api/agent-profiles/${id}`, authDelete(tokenA));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "rated_history_exists" });
      expect(await db.select().from(schema.agentProfiles)
        .where(eq(schema.agentProfiles.id, id))).toHaveLength(1);
    });

    test("returns the same conflict when a pregame rating snapshot references the agent", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Atlas", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };
      const revision = (await db.select().from(schema.agentRevisions)
        .where(eq(schema.agentRevisions.agentProfileId, id)))[0]!;
      const seasonId = randomUUID();
      const gameId = randomUUID();
      await db.insert(schema.seasons).values({
        id: seasonId,
        slug: `snapshot-${seasonId}`,
        name: "Snapshot Season",
        status: "active",
      });
      await db.insert(schema.games).values({
        id: gameId,
        slug: `snapshot-${gameId}`,
        config: "{}",
        status: "waiting",
        trackType: "free",
        seasonId,
      });
      await db.insert(schema.competitionRatingSnapshots).values({
        id: randomUUID(),
        gameId,
        agentProfileId: id,
        agentRevisionId: revision.id,
        mu: 25,
        sigma: 25 / 3,
        ratingPolicyVersion: "competition-rating-v1",
      });

      const res = await app.request(`/api/agent-profiles/${id}`, authDelete(tokenA));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "rated_history_exists" });
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

    test("returns 503 when no LLM provider is configured", async () => {
      const savedKey = process.env.OPENAI_API_KEY;
      const savedInfluenceKey = process.env.INFLUENCE_LLM_API_KEY;
      const savedBaseUrl = process.env.INFLUENCE_LLM_BASE_URL;
      const savedOpenAIBaseUrl = process.env.OPENAI_BASE_URL;
      const savedLmStudioBaseUrl = process.env.LM_STUDIO_BASE_URL;
      delete process.env.OPENAI_API_KEY;
      delete process.env.INFLUENCE_LLM_API_KEY;
      delete process.env.INFLUENCE_LLM_BASE_URL;
      delete process.env.OPENAI_BASE_URL;
      delete process.env.LM_STUDIO_BASE_URL;

      try {
        const res = await app.request(
          "/api/agent-profiles/generate",
          jsonReq({ traits: "charming, witty" }, tokenA),
        );
        expect(res.status).toBe(503);
      } finally {
        if (savedKey) process.env.OPENAI_API_KEY = savedKey;
        if (savedInfluenceKey) process.env.INFLUENCE_LLM_API_KEY = savedInfluenceKey;
        if (savedBaseUrl) process.env.INFLUENCE_LLM_BASE_URL = savedBaseUrl;
        if (savedOpenAIBaseUrl) process.env.OPENAI_BASE_URL = savedOpenAIBaseUrl;
        if (savedLmStudioBaseUrl) process.env.LM_STUDIO_BASE_URL = savedLmStudioBaseUrl;
      }
    });

    // LLM integration test — only runs when hosted OpenAI is configured.
    const llmTest = resolveAgentProfileGenerationLlm() ? test : test.skip;

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
        gender: "male" | "female" | "non-binary";
      };
      expect(body.name).toBeTruthy();
      expect(body.personality).toBeTruthy();
      expect(body.personaKey).toBeTruthy();
      expect(["male", "female", "non-binary"]).toContain(body.gender);
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
