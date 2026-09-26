import { contentImageFixture, headPositionFixture } from "./content-image-fixture.js";
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
const VALID_DRAFT_PROFILE = {
  name: "Maris Vale",
  gender: "female" as const,
  backstory: null,
  personality: "A patient mediator.",
  strategyStyle: null,
  personaKey: "diplomat",
};

async function insertCompletedDraft(
  db: DrizzleDB,
  input: {
    id: string;
    agentProfileId?: string | null;
    userId?: string;
    profile?: typeof VALID_DRAFT_PROFILE;
  },
) {
  const profile = input.profile ?? VALID_DRAFT_PROFILE;
  await db.insert(schema.avatarGenerationRequests).values({
    id: input.id,
    userId: input.userId ?? USER_A_ID,
    agentProfileId: null,
    purpose: "agent_profile_completion",
    status: "completed",
    triggerSource: "web_ai_help_draft",
    provider: "katana",
    model: "gen",
    safeMetadata: {
      draftProfile: profile,
      profileFingerprint: avatarProfileFingerprint(profile),
      avatarUrl: "/api/uploads/local?key=pfp%2Fgenerated%2Fmira.png",
    },
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:01:00.000Z",
    completedAt: "2026-07-12T00:01:00.000Z",
  });
}

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
  const payload = method === "POST"
    && typeof body === "object"
    && body !== null
    && "personality" in body
    && !("creationRequestId" in body)
    ? { ...body, creationRequestId: randomUUID() }
    : body;
  return { method, headers, body: JSON.stringify(payload) };
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
    for (const key of ["pfp/maris-full.png", "pfp/11111111-1111-4111-8111-111111111111.png", "pfp/22222222-2222-4222-8222-222222222222.png"]) await contentImageFixture(key);
  });

  test("persists visual profile fields and protects performance edits from stale saves", async () => {
    const create = await app.request("/api/agent-profiles", jsonReq({
      name: "Visual Maris", personality: "A patient mediator.",
      fullBodyReferenceUrl: "/api/uploads/local?key=pfp%2Fmaris-full.png",
      headPosition: await headPositionFixture("/api/uploads/local?key=pfp%2Fmaris-full.png"),
      performanceInstructions: "Upright posture, quiet delivery, deliberate open-handed gestures.",
    }, tokenA));
    expect(create.status).toBe(201);
    const original = await create.json() as { id: string; profileRevisionId: string };
    const updated = await app.request(`/api/agent-profiles/${original.id}`, jsonReq({
      performanceInstructions: "Relaxed posture. Speaks softly, pauses before answering, avoids eye contact when nervous.",
      expectedRevisionId: original.profileRevisionId,
    }, tokenA, "PATCH"));
    expect(updated.status).toBe(200);
    const value = await updated.json() as { profileRevisionId: string; fullBodyReferenceUrl: string };
    expect(value.fullBodyReferenceUrl).toContain("key=pfp%2Fmaris-full.png");
    expect(value.profileRevisionId).not.toBe(original.profileRevisionId);
    const stale = await app.request(`/api/agent-profiles/${original.id}`, jsonReq({
      performanceInstructions: "Old tab instructions", expectedRevisionId: original.profileRevisionId,
    }, tokenA, "PATCH"));
    expect(stale.status).toBe(409);
    const foreign = await app.request(`/api/agent-profiles/${original.id}`, jsonReq({ fullBodyReferenceUrl: null }, tokenB, "PATCH"));
    expect(foreign.status).toBe(404);
  });

  test("rejects overlong or non-text visual performance instructions", async () => {
    for (const performanceInstructions of ["x".repeat(2001), { behavior: "bad shape" }]) {
      const response = await app.request("/api/agent-profiles", jsonReq({
        name: "Visual Maris", personality: "A patient mediator.", performanceInstructions,
      }, tokenA));
      expect(response.status).toBe(400);
    }
  });

  test("rejects pending generation attachment rather than saving a late portrait", async () => {
    const response = await app.request("/api/agent-profiles", jsonReq({ name: "Draft Arden", personality: "Careful", avatarGenerationRequestId: "pending-request" }, tokenA));
    expect(response.status).toBe(400);
    expect(await db.select().from(schema.agentProfiles)).toHaveLength(0);
    expect(await db.select().from(schema.agentContentRevisions)).toHaveLength(0);
  });

  test("submits selected assets and returns durable review IDs with response-loss replay", async () => {
    const response = await app.request("/api/agent-profiles", jsonReq({ name: "Draft Arden", personality: "Careful", avatarUrl: await contentImageFixture("pfp/selected.png") }, tokenA));
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string; contentRevisionId: string; receipt: { moderationRecordId: string } };
    expect(created.receipt.moderationRecordId).toBeTruthy();
    const input = { submissionId: randomUUID(), expectedContentRevisionId: created.contentRevisionId, visualDesign: "A green coat" };
    const update = await app.request(`/api/agent-profiles/${created.id}`, jsonReq(input, tokenA, "PATCH"));
    expect(update.status).toBe(200);
    const saved = await update.json();
    const replay = await app.request(`/api/agent-profiles/${created.id}`, jsonReq(input, tokenA, "PATCH"));
    expect(await replay.json()).toEqual(saved);
    expect(await db.select().from(schema.agentModerationReviews)).toHaveLength(2);
    expect(await db.select().from(schema.avatarGenerationRequests)).toHaveLength(0);
  });

  test("image-only and crop-only API submissions retain the competitive revision", async () => {
    const response = await app.request("/api/agent-profiles", jsonReq({ name: "Crop Arden", personality: "Careful" }, tokenA));
    const created = await response.json() as { id: string; contentRevisionId: string; currentRevisionId: string };
    const sourceUrl = await contentImageFixture("pfp/crop-api.png");
    let revision = created.contentRevisionId;
    for (const change of [{ avatarUrl: sourceUrl }, { portraitCrop: { sourceUrl, x: 0, y: 0, width: 0.5, height: 0.5 } }]) {
      const update = await app.request(`/api/agent-profiles/${created.id}`, jsonReq({ ...change, submissionId: randomUUID(), expectedContentRevisionId: revision }, tokenA, "PATCH"));
      expect(update.status).toBe(200);
      const saved = await update.json() as { contentRevisionId: string; currentRevisionId: string; receipt: { moderationRecordId: string } };
      expect(saved.currentRevisionId).toBe(created.currentRevisionId);
      expect(saved.receipt.moderationRecordId).toBeTruthy();
      revision = saved.contentRevisionId;
    }
    expect(await db.select().from(schema.agentModerationReviews)).toHaveLength(3);
  });

  // =========================================================================
  // Auth enforcement
  // =========================================================================

  describe("auth enforcement", () => {
    test("POST /api/agent-profiles requires auth", async () => {
      const res = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Aster Vale", personality: "Strategic" }),
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
    test("requires a UUID creationRequestId", async () => {
      const response = await app.request("/api/agent-profiles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenA}`,
        },
        body: JSON.stringify({ name: "Missing Request", personality: "Careful." }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "creationRequestId must be a UUID." });
    });

    test("replays only an equivalent idempotent creation without duplicating the profile, revision, or portrait request", async () => {
      const creationRequestId = randomUUID();
      const payload = {
        name: "Idempotent Iris",
        personality: "Keeps one plan.",
        creationRequestId,
      };
      const first = await app.request("/api/agent-profiles", jsonReq({
        ...payload,
      }, tokenA));
      expect(first.status).toBe(201);
      const original = await first.json() as { id: string; name: string };

      const replay = await app.request("/api/agent-profiles", jsonReq(payload, tokenA));
      expect(replay.status).toBe(201);
      expect(await replay.json()).toMatchObject({ id: original.id, name: original.name });

      const conflict = await app.request("/api/agent-profiles", jsonReq({
        name: "Ignored Retry Text",
        personality: "This payload must not replace the original.",
        creationRequestId,
      }, tokenA));
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({ code: "agent_creation_request_conflict" });
      expect(await db.select().from(schema.agentProfiles)).toHaveLength(1);
      expect(await db.select().from(schema.agentRevisions)).toHaveLength(1);
      expect(await db.select().from(schema.avatarGenerationRequests)).toHaveLength(0);
    });

    test("recovers a committed creation request only for its owner", async () => {
      const creationRequestId = randomUUID();
      const created = await app.request("/api/agent-profiles", jsonReq({
        name: "Recoverable Rowan",
        personality: "Finishes what was started.",
        creationRequestId,
      }, tokenA));
      const original = await created.json() as { id: string };

      const recovered = await app.request(
        `/api/agent-profiles/creation-requests/${creationRequestId}`,
        authGet(tokenA),
      );
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({ id: original.id, name: "Recoverable Rowan" });

      const foreign = await app.request(
        `/api/agent-profiles/creation-requests/${creationRequestId}`,
        authGet(tokenB),
      );
      expect(foreign.status).toBe(404);
    });

    test("creates an agent profile", async () => {
      const res = await app.request(
        "/api/agent-profiles",
        jsonReq(
          {
            name: "Aster Vale",
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
      expect(body.name).toBe("Aster Vale");
      expect(body.personality).toBe("Strategic calculator who keeps options open");
      expect(body.backstory).toBe("Grew up in a small town...");
      expect(body.personaKey).toBe("strategic");
      expect(body.gender).toBe("female");
      expect(body.receipt).toMatchObject({
        schemaVersion: 1,
        operation: "created",
        agent: {
          agentProfileId: body.id,
          identityDisposition: "created",
        },
        profileRevision: { outcome: "created", active: true },
        dailyFree: "not_enrolled",
      });
      expect(body.gamesPlayed).toBe(0);
      expect(body.gamesWon).toBe(0);
    });

    test("returns the generic name-taken contract for duplicates and House-catalog names", async () => {
      const first = await app.request("/api/agent-profiles", jsonReq({
        name: "Ember Compass",
        personality: "Careful and observant.",
      }, tokenB));
      expect(first.status).toBe(201);

      for (const name of ["  EMBER COMPASS  ", " atlas ", "null", " NULL ", "undefined", " UNDEFINED "]) {
        const res = await app.request("/api/agent-profiles", jsonReq({
          name,
          personality: "Must use a distinct global identity.",
        }, tokenA));
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({
          code: "agent_name_taken",
          error: "That agent name is already in use. Choose another name.",
          retryable: false,
        });
      }

      expect(await db.select().from(schema.agentProfiles)).toHaveLength(1);
      expect(await db.select().from(schema.agentRevisions)).toHaveLength(1);
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
        jsonReq({ name: "Aster Vale" }, tokenA),
      );
      expect(res.status).toBe(400);
    });

    test("rejects invalid personaKey", async () => {
      const res = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Aster Vale", personality: "Test", personaKey: "invalid" }, tokenA),
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
        jsonReq({ name: "Aster Vale", personality: "Test", gender: "unknown" }, tokenA),
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
      expect(body.avatarCompletion).toBeUndefined();
      expect(await db.select().from(schema.avatarGenerationRequests)).toHaveLength(0);
      expect(await db.select().from(schema.agentModerationReviews)).toHaveLength(1);
    });

    test("rejects an overlong draft name before generating a portrait", async () => {
      const res = await app.request(
        "/api/agent-profiles/avatar/generate-draft",
        jsonReq({
          name: "A".repeat(33),
          gender: "female",
          personality: "A patient mediator.",
        }, tokenA),
      );

      expect(res.status).toBe(400);
      expect(await db.select().from(schema.avatarGenerationRequests)).toHaveLength(0);
    });

    test("does not consume a completed draft when profile validation fails", async () => {
      const profile = {
        ...VALID_DRAFT_PROFILE,
        name: "M".repeat(81),
      };
      await insertCompletedDraft(db, {
        id: "invalid-profile-draft-request",
        agentProfileId: "draft-invalid-mira",
        profile,
      });

      const response = await app.request("/api/agent-profiles", jsonReq({
        ...profile,
        avatarGenerationRequestId: "invalid-profile-draft-request",
      }, tokenA));
      expect(response.status).toBe(400);

      const [request] = await db.select().from(schema.avatarGenerationRequests)
        .where(eq(schema.avatarGenerationRequests.id, "invalid-profile-draft-request"));
      expect(request?.safeMetadata).not.toHaveProperty("consumedAt");
    });

    test("records avatar change history when creating with an avatar", async () => {
      const res = await app.request(
        "/api/agent-profiles",
        jsonReq({
          name: "Atlas Avatar",
          personality: "Strategic",
          avatarUrl: "/api/uploads/local?key=pfp%2F11111111-1111-4111-8111-111111111111.png",
        }, tokenA),
      );

      expect(res.status).toBe(201);
      const body = await res.json() as { id: string; avatarUrl: string };
      expect(body.avatarUrl).toContain("/api/uploads/local?key=pfp%2F11111111-1111-4111-8111-111111111111.png");

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
          avatarUrl: "/api/uploads/local?key=pfp%2F22222222-2222-4222-8222-222222222222.png",
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
        jsonReq({ name: "Aster Vale", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const res = await app.request(`/api/agent-profiles/${id}`, authGet(tokenA));
      expect(res.status).toBe(200);
      const body = await res.json() as { name: string; avatarCompletion?: { status: string }; creationPayloadFingerprint?: string };
      expect(body.name).toBe("Aster Vale");
      expect(body.avatarCompletion).toBeUndefined();
      expect(body.creationPayloadFingerprint).toBeUndefined();
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
    test("rejects stale edits without overwriting newer strategy and accepts an exact response-loss replay", async () => {
      const createRes = await app.request("/api/agent-profiles", jsonReq({
        name: "Concurrency Casey",
        personality: "Keeps edits orderly.",
        strategyStyle: "Start with one plan.",
      }, tokenA));
      const original = await createRes.json() as { id: string; profileRevisionId: string };
      const strategyUpdate = {
        strategyStyle: "Commit to the verified coalition.",
        expectedRevisionId: original.profileRevisionId,
      };

      const first = await app.request(
        `/api/agent-profiles/${original.id}`,
        jsonReq(strategyUpdate, tokenA, "PATCH"),
      );
      expect(first.status).toBe(200);

      const exactReplay = await app.request(
        `/api/agent-profiles/${original.id}`,
        jsonReq(strategyUpdate, tokenA, "PATCH"),
      );
      expect(exactReplay.status).toBe(200);
      expect(await exactReplay.json()).toMatchObject({
        strategyStyle: strategyUpdate.strategyStyle,
      });

      const staleIdentityEdit = await app.request(
        `/api/agent-profiles/${original.id}`,
        jsonReq({
          name: "Stale Rename",
          strategyStyle: "Start with one plan.",
          expectedRevisionId: original.profileRevisionId,
        }, tokenA, "PATCH"),
      );
      expect(staleIdentityEdit.status).toBe(409);
      expect(await staleIdentityEdit.json()).toMatchObject({ code: "agent_profile_stale" });
      const [stored] = await db.select().from(schema.agentProfiles)
        .where(eq(schema.agentProfiles.id, original.id));
      expect(stored).toMatchObject({
        name: "Concurrency Casey",
        strategyStyle: "Commit to the verified coalition.",
      });
    });

    test("updates profile fields", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Aster Vale", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const res = await app.request(
        `/api/agent-profiles/${id}`,
        jsonReq({ name: "Atlas v2", backstory: "New backstory", gender: "non-binary" }, tokenA, "PATCH"),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as {
        id: string;
        name: string;
        backstory: string;
        gender: string;
        statsReset: boolean;
        receipt: {
          operation: string;
          agent: { agentProfileId: string; identityDisposition: string };
          profileRevision: { outcome: string; active: boolean };
        };
      };
      expect(body.name).toBe("Atlas v2");
      expect(body.backstory).toBe("New backstory");
      expect(body.gender).toBe("non-binary");
      expect(body.statsReset).toBe(false);
      expect(body.receipt).toMatchObject({
        operation: "updated",
        agent: { agentProfileId: body.id, identityDisposition: "preserved" },
        profileRevision: { outcome: "created", active: true },
      });
    });

    test("rejects cross-owner duplicate renames without applying other updates", async () => {
      const ownerA = await app.request("/api/agent-profiles", jsonReq({
        name: "Quiet Meridian",
        personality: "Quiet and deliberate.",
      }, tokenA));
      const { id } = await ownerA.json() as { id: string };
      const ownerB = await app.request("/api/agent-profiles", jsonReq({
        name: "Copper Warden",
        personality: "Protective and patient.",
      }, tokenB));
      expect(ownerB.status).toBe(201);
      const avatarEventsBefore = await db.select().from(schema.avatarChangeEvents);

      const res = await app.request(`/api/agent-profiles/${id}`, jsonReq({
        name: "  COPPER WARDEN  ",
        avatarUrl: await contentImageFixture("pfp/should-not-write.png"),
      }, tokenA, "PATCH"));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        code: "agent_name_taken",
        error: "That agent name is already in use. Choose another name.",
        retryable: false,
      });
      const [profile] = await db.select().from(schema.agentProfiles)
        .where(eq(schema.agentProfiles.id, id));
      expect(profile?.name).toBe("Quiet Meridian");
      expect(profile?.avatarUrl).toBeNull();
      expect(await db.select().from(schema.avatarChangeEvents)).toHaveLength(avatarEventsBefore.length);
    });

    test("records avatar replacement history", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({
          name: "Aster Vale",
          personality: "Strategic",
          avatarUrl: await contentImageFixture("pfp/old.png"),
        }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const res = await app.request(
        `/api/agent-profiles/${id}`,
        jsonReq({ avatarUrl: await contentImageFixture("pfp/new.png") }, tokenA, "PATCH"),
      );

      expect(res.status).toBe(200);
      const changes = await db
        .select()
        .from(schema.avatarChangeEvents);
      expect(changes.map((change) => change.source)).toEqual(["web_upload", "web_manual_update"]);
      expect(changes[1]!).toMatchObject({
        previousAvatarUrl: "http://localhost/api/uploads/local?key=pfp%2Fold.png",
        newAvatarUrl: "http://localhost/api/uploads/local?key=pfp%2Fnew.png",
      });
    });

    test("preserves lifetime stats when personality changes", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Aster Vale", personality: "Strategic" }, tokenA),
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
        jsonReq({ name: "Aster Vale", personality: "Strategic" }, tokenA),
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
        jsonReq({ name: "Aster Vale", personality: "Strategic" }, tokenA),
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
    test("archives a profile", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Aster Vale", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };

      const res = await app.request(`/api/agent-profiles/${id}`, authDelete(tokenA));
      expect(res.status).toBe(200);

      // Verify retained and archived
      const profiles = await db.select().from(schema.agentProfiles);
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.archivedAt).not.toBeNull();
    });

    test("archives a profile without deleting avatar audit history", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({
          name: "Aster Vale",
          personality: "Strategic",
          avatarUrl: await contentImageFixture("pfp/avatar.png"),
        }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };
      expect(await db.select().from(schema.avatarChangeEvents)).toHaveLength(1);

      const res = await app.request(`/api/agent-profiles/${id}`, authDelete(tokenA));
      expect(res.status).toBe(200);

      const profiles = await db.select().from(schema.agentProfiles)
        .where(eq(schema.agentProfiles.id, id));
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.archivedAt).not.toBeNull();
      const history = await db.select().from(schema.avatarChangeEvents)
        .where(eq(schema.avatarChangeEvents.agentProfileId, id));
      expect(history).toHaveLength(1);
      expect(history[0]!.newAvatarUrl).toContain("key=pfp%2Favatar.png");
    });

    test("terminalizes an attached portrait before archiving its Agent", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Pending Portrait", personality: "Strategic" }, tokenA),
      );
      const { id } = await createRes.json() as { id: string };
      await db.delete(schema.avatarChangeEvents);
      await db.delete(schema.avatarGenerationRequests);
      await db.insert(schema.avatarGenerationRequests).values({
        id: "delete-pending-portrait",
        userId: USER_A_ID,
        agentProfileId: id,
        purpose: "agent_profile_completion",
        status: "processing",
        triggerSource: "web_ai_help_draft",
        provider: "katana",
        model: "gen",
        providerRequestId: "provider-delete-pending",
        safeMetadata: { draftProfile: VALID_DRAFT_PROFILE },
      });

      const res = await app.request(`/api/agent-profiles/${id}`, authDelete(tokenA));
      expect(res.status).toBe(200);
      const [request] = await db.select().from(schema.avatarGenerationRequests);
      expect(request).toMatchObject({
        id: "delete-pending-portrait",
        status: "skipped",
        failureCode: "profile_archived",
      });
      const [event] = await db.select().from(schema.avatarChangeEvents);
      expect(event).toMatchObject({
        agentProfileId: id,
        generationRequestId: "delete-pending-portrait",
        status: "skipped",
      });
    });

    test("blocks deleting the standing Daily Free agent", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Aster Vale", personality: "Strategic" }, tokenA),
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
        jsonReq({ name: "Aster Vale", personality: "Strategic" }, tokenA),
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
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.archivedAt !== null).toBe(entries.length === 0);
    });

    test("returns 404 when deleting another user's profile", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Aster Vale", personality: "Strategic" }, tokenA),
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
        jsonReq({ name: "Aster Vale", personality: "Strategic" }, tokenA),
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
        jsonReq({ name: "Aster Vale", personality: "Strategic" }, tokenA),
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

    test("retains agentProfileId references in historical game_players", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Aster Vale", personality: "Strategic" }, tokenA),
      );
      const { id: profileId } = await createRes.json() as { id: string };

      const gameRes = await app.request(
        "/api/games",
        jsonReq({
          playerCount: 6,
          modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
          timingPreset: "fast",
        }, tokenA),
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

      await db.update(schema.games).set({ status: "completed", endedAt: new Date().toISOString() })
        .where(eq(schema.games.id, gameId));

      // Delete the profile
      const deleted = await app.request(`/api/agent-profiles/${profileId}`, authDelete(tokenA));
      expect(deleted.status).toBe(200);

      // Historical identity remains attached
      gamePlayers = await db.select().from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId));
      expect(gamePlayers[0]!.agentProfileId).toBe(profileId);
    });

    test("refuses to detach an agent from a live roster", async () => {
      const createRes = await app.request(
        "/api/agent-profiles",
        jsonReq({ name: "Live Aster", personality: "Strategic" }, tokenA),
      );
      const { id: profileId } = await createRes.json() as { id: string };
      const gameRes = await app.request(
        "/api/games",
        jsonReq({
          playerCount: 6,
          modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
          timingPreset: "fast",
        }, tokenA),
      );
      const { id: gameId } = await gameRes.json() as { id: string };
      expect((await app.request(
        `/api/games/${gameId}/join`,
        jsonReq({ agentProfileId: profileId }, tokenA),
      )).status).toBe(201);
      const before = (await db.select().from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.gameId, gameId)))[0]!;

      const response = await app.request(`/api/agent-profiles/${profileId}`, authDelete(tokenA));

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "active_game_exists" });
      expect((await db.select().from(schema.gamePlayers)
        .where(eq(schema.gamePlayers.id, before.id)))[0]).toEqual(before);
      expect((await db.select().from(schema.agentProfiles)
        .where(eq(schema.agentProfiles.id, profileId)))[0]?.id).toBe(profileId);
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
            name: "Aster Vale",
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
        jsonReq({
          playerCount: 6,
          modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
          timingPreset: "fast",
        }, tokenA),
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
      expect(persona.name).toBe("Aster Vale");
      expect(persona.personality).toBe("Strategic calculator");
      expect(persona.strategyHints).toBe("Alliance builder");
      expect(persona.personaKey).toBe("strategic");
    });

    test("rejects join with non-existent profile", async () => {
      const gameRes = await app.request(
        "/api/games",
        jsonReq({
          playerCount: 6,
          modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
          timingPreset: "fast",
        }, tokenA),
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
        jsonReq({ name: "Aster Vale", personality: "Strategic" }, tokenA),
      );
      const { id: profileId } = await createRes.json() as { id: string };

      const gameRes = await app.request(
        "/api/games",
        jsonReq({
          playerCount: 6,
          modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
          timingPreset: "fast",
        }, tokenA),
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

    test("advanced assistant uses one strict native tool with draft context and rejects malformed calls", async () => {
      await db.insert(schema.inferenceAccounts).values({ userId: USER_A_ID, overrides: { textBurst: 100 } }).onConflictDoNothing();
      const context = { name: "Arden", personaKey: "diplomat", gender: "non-binary", personality: "Calm", backstory: "History", strategyStyle: "Alliances", performanceInstructions: "", visualDesign: "", hasFullBody: false };
      const turn = { context, message: "Yes please", history: ["assistant: Would you like me to update their visuals?"] };
      expect((await app.request("/api/agent-profiles/edit-assistant", jsonReq(turn, ""))).status).toBe(401);
      expect((await app.request("/api/agent-profiles/edit-assistant", jsonReq({ ...turn, context: {} }, tokenA))).status).toBe(400);
      const savedKey = process.env.OPENAI_API_KEY, originalFetch = globalThis.fetch;
      process.env.OPENAI_API_KEY = "test-openai-key";
      let args = "{}", finish = "tool_calls", count = 1;
      const requests: Record<string, unknown>[] = [];
      globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input.toString(), init);
        requests.push(await request.json() as Record<string, unknown>);
        return Response.json({ id: "edit-test", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: Array.from({ length: count }, (_, i) => ({ id: `call-${i}`, type: "function", function: { name: "update_visuals", arguments: args } })) }, finish_reason: finish }] });
      }, { preconnect: originalFetch.preconnect });
      try {
        const result = await app.request("/api/agent-profiles/edit-assistant", jsonReq(turn, tokenA));
        expect(result.status).toBe(200);
        expect(await result.json()).toEqual({ tool: "update_visuals", fields: ["performanceInstructions", "visualDesign"] });
        expect(requests[0]).toMatchObject({ tool_choice: "required", parallel_tool_calls: false });
        expect(JSON.stringify(requests[0]?.messages)).toContain("hasFullBody");
        expect(JSON.stringify(requests[0]?.messages)).toContain("The Short List eliminates the fewest positive votes");
        for (const invalid of ["not json", "[]", '{"fields":["name"]}', '```json\n{}\n```']) {
          args = invalid;
          expect((await app.request("/api/agent-profiles/edit-assistant", jsonReq(turn, tokenA))).status).toBe(502);
        }
        args = "{}"; count = 2;
        expect((await app.request("/api/agent-profiles/edit-assistant", jsonReq(turn, tokenA))).status).toBe(502);
        count = 1; finish = "length";
        expect((await app.request("/api/agent-profiles/edit-assistant", jsonReq(turn, tokenA))).status).toBe(502);
        expect(await db.select().from(schema.agentProfiles)).toHaveLength(0);
      } finally { globalThis.fetch = originalFetch; restoreEnv("OPENAI_API_KEY", savedKey); }
    });

    test("creation assistant validates stage, draft and exact provider turns before effects", async () => {
      await db.insert(schema.inferenceAccounts).values({userId: USER_A_ID, overrides:{textBurst:100}}).onConflictDoNothing();
      const draft = { name: "Arden", personaKey: "diplomat", gender: "non-binary", personality: "Calm", backstory: "History", strategyStyle: "Alliances", performanceInstructions: "", visualDesign: "" };
      const turn = { stage: "review", message: "Yes", history: [], sections: [], draft };
      expect((await app.request("/api/agent-profiles/creation-assistant", jsonReq(turn, ""))).status).toBe(401);
      expect((await app.request("/api/agent-profiles/creation-assistant", jsonReq({ ...turn, stage: "constructor" }, tokenA))).status).toBe(400);
      expect((await app.request("/api/agent-profiles/creation-assistant", jsonReq({ ...turn, draft: {} }, tokenA))).status).toBe(400);
      const savedKey = process.env.OPENAI_API_KEY;
      const originalFetch = globalThis.fetch;
      process.env.OPENAI_API_KEY = "test-openai-key";
      let content = '{"command":"accept_character","reply":""}';
      let finishReason = "stop";
      const requests: Record<string, unknown>[] = [];
      globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input.toString(), init);
        requests.push(await request.json() as Record<string, unknown>);
        return Response.json({ id: "test", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }] });
      }, { preconnect: originalFetch.preconnect });
      try {
        const accepted = await app.request("/api/agent-profiles/creation-assistant", jsonReq(turn, tokenA));
        expect(accepted.status).toBe(200);
        expect(await accepted.json()).toEqual({ command: "accept_character", reply: "" });
        expect(requests[0]).toMatchObject({ service_tier: "default", reasoning_effort: "low", max_completion_tokens: 1200 });
        expect(requests[0]?.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true, schema: { additionalProperties: false, properties: { command: { enum: ["accept_character", "revise_character", "clarify", "end_abuse", "end_fatigue"] }, reply: { type: "string" } }, required: ["command", "reply"] } } });
        expect(JSON.stringify(requests[0]?.messages)).toContain("The Short List eliminates the fewest positive votes");
        expect(JSON.stringify(requests[0]?.messages)).toContain("Alliances");
        content = '{"command":"clarify","reply":"Empowerment can choose the format, but it grants no immunity. Would Arden seek that power?"}';
        const clarified = await app.request("/api/agent-profiles/creation-assistant", jsonReq({ ...turn, message: "What is empowerment?" }, tokenA));
        expect(clarified.status).toBe(200);
        expect(await clarified.json()).toEqual({ command: "clarify", reply: "Empowerment can choose the format, but it grants no immunity. Would Arden seek that power?" });
        for (const bad of ["Hello", "{}", '{"command":"generate_appearance","reply":""}', '{"command":"accept_character"}', '{"command":"accept_character","reply":"I approve"}', '{"command":"clarify","reply":""}', '{"command":"accept_character","reply":"","text":"extra"}', '```json\n{"command":"accept_character","reply":""}\n```', 'Result: {"command":"accept_character","reply":""}']) {
          content = bad;
          expect((await app.request("/api/agent-profiles/creation-assistant", jsonReq(turn, tokenA))).status).toBe(502);
        }
        content = '{"command":"accept_character","reply":""}'; finishReason = "length";
        expect((await app.request("/api/agent-profiles/creation-assistant", jsonReq(turn, tokenA))).status).toBe(502);
        expect(await db.select().from(schema.agentProfiles)).toHaveLength(0);
        globalThis.fetch = Object.assign(async () => { throw new DOMException("timed out", "AbortError"); }, { preconnect: originalFetch.preconnect });
        const timedOut = await app.request("/api/agent-profiles/creation-assistant", jsonReq(turn, tokenA));
        expect(timedOut.status).toBe(504);
        expect(await timedOut.json()).toMatchObject({ error: expect.stringContaining("Your text is still here") });
        const profileTimeout = await app.request("/api/agent-profiles/generate", jsonReq({ traits: "A patient fox" }, tokenB));
        expect(profileTimeout.status).toBe(504);
      } finally { globalThis.fetch = originalFetch; restoreEnv("OPENAI_API_KEY", savedKey); }
    });

    test("sends GPT-6 Luna for new and refined profiles", async () => {
      const envKeys = [
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "INFLUENCE_LLM_BASE_URL",
        "INFLUENCE_LLM_API_KEY",
      ] as const;
      const savedEnv = new Map<string, string | undefined>(
        envKeys.map((key) => [key, process.env[key]]),
      );
      const originalFetch = globalThis.fetch;
      const requestBodies: Array<Record<string, unknown>> = [];

      process.env.OPENAI_API_KEY = "test-openai-key";
      delete process.env.OPENAI_BASE_URL;
      delete process.env.INFLUENCE_LLM_BASE_URL;
      delete process.env.INFLUENCE_LLM_API_KEY;
      globalThis.fetch = Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input.toString(), init);
          requestBodies.push(await request.clone().json() as Record<string, unknown>);
          return new Response(JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion",
            created: 1,
            model: "gpt-6-luna",
            choices: [{
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({
                  name: "Nova Vale",
                  backstory: "Nova learned patience in crowded rooms.",
                  personality: "Nova listens before making a move.",
                  strategyStyle: "Nova builds a coalition and waits for leverage.",
                  performanceInstructions: "Measured delivery and open posture.",
                  visualDesign: "Short dark hair and a green coat.",
                  introQuips: ["I brought a plan and excellent snacks.", "Let's make this interesting.", "I know a shortcut to the good chairs."],
                  personaKey: "strategic",
                  gender: "female",
                }),
              },
              finish_reason: "stop",
            }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
        { preconnect: originalFetch.preconnect },
      );

      try {
        const generated = await app.request(
          "/api/agent-profiles/generate",
          jsonReq({ traits: "patient and observant" }, tokenA),
        );
        const refined = await app.request(
          "/api/agent-profiles/generate",
          jsonReq({
            existingProfile: {
              name: "Nova Vale",
              personality: "Quiet and patient",
            },
            traits: "add a sharper edge",
          }, tokenA),
        );

        const visualOnly = await app.request("/api/agent-profiles/generate", jsonReq({
          changeRequest: "Update their visuals", selectedFields: ["performanceInstructions", "visualDesign"],
          existingProfile: { name: "Original", personality: "Original personality", backstory: "Original history", strategyStyle: "Original strategy", personaKey: "strategic", gender: "female", performanceInstructions: "", visualDesign: "" },
        }, tokenA));
        expect(visualOnly.status).toBe(200);
        expect(await visualOnly.json()).toMatchObject({ name: "Original", personality: "Original personality", backstory: "Original history", strategyStyle: "Original strategy" });
        expect(generated.status).toBe(200);
        expect(refined.status).toBe(200);
        expect(requestBodies).toHaveLength(3);
        for (const body of requestBodies) expect(body).toMatchObject({ service_tier: "default", reasoning_effort: "low" });
        for (const body of requestBodies) expect(JSON.stringify(body.messages)).toContain("The Short List eliminates the fewest positive votes");
        expect(requestBodies.map((body) => body.model)).toEqual([
          "gpt-6-luna",
          "gpt-6-luna",
          "gpt-6-luna",
        ]);
      } finally {
        globalThis.fetch = originalFetch;
        for (const [key, value] of savedEnv) restoreEnv(key, value);
      }
    });

  });
});
