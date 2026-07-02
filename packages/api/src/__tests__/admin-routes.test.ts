import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { schema } from "../db/index.js";
import type { DrizzleDB } from "../db/index.js";
import { getPermissionsForAddress } from "../db/rbac.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { createSessionToken } from "../middleware/auth.js";
import { createAdminRoutes } from "../routes/admin.js";
import { appendGameEvents } from "../services/game-events.js";
import { writeGameCheckpoint } from "../services/game-checkpoints.js";
import { createEvidenceManifest } from "../services/game-evidence.js";
import {
  createCheckpointCapsule,
  createCanonicalEventFixture,
  enrichCapsuleForV1Candidate,
  insertGame,
  insertOwner,
} from "./durable-run-test-utils.js";
import { hashCanonicalEvent } from "../services/game-events.js";
import { setupTestDB } from "./test-utils.js";

const ADMIN_ADDRESS = "0xadmin000000000000000000000000000000000001";
const GAMER_ADDRESS = "0xgamer000000000000000000000000000000000001";
const SYSOP_ADDRESS = "0xsysop000000000000000000000000000000000001";

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-admin-routes";
  process.env.ADMIN_ADDRESS = SYSOP_ADDRESS;
  process.env.LINODE_OBJ_BUCKET = "public-profile-pictures";
  process.env.LINODE_PRIVATE_CONTENT_BUCKET = "private-content";
});

async function setupDB() {
  const db = await setupTestDB();
  await seedRBAC(db);
  return db;
}

async function assignRole(
  db: DrizzleDB,
  walletAddress: string,
  roleName: string,
) {
  const role = (await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(sql`${schema.roles.name} = ${roleName}`))[0];

  if (!role) {
    throw new Error(`Missing seeded role: ${roleName}`);
  }

  await db.insert(schema.addressRoles).values({
    walletAddress: walletAddress.toLowerCase(),
    roleId: role.id,
    grantedBy: "test",
  });
}

async function createUser(
  db: DrizzleDB,
  walletAddress: string,
  displayName: string,
) {
  const userId = randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    walletAddress: walletAddress.toLowerCase(),
    displayName,
  });
  return userId;
}

describe("gamer role seed", () => {
  test("resolves to create, fill, and start only", async () => {
    const db = await setupDB();
    await createUser(db, GAMER_ADDRESS, "Gamer");
    await assignRole(db, GAMER_ADDRESS, "gamer");

    const resolved = await getPermissionsForAddress(db, GAMER_ADDRESS);

    expect(resolved.roles).toEqual(["gamer"]);
    expect([...resolved.permissions].sort()).toEqual([
      "create_game",
      "fill_game",
      "start_game",
    ]);
    expect(resolved.permissions).not.toContain("stop_game");
    expect(resolved.permissions).not.toContain("manage_roles");
    expect(resolved.permissions).not.toContain("view_admin");
  });
});

describe("producer role seed", () => {
  test("resolves as a role marker without app permissions", async () => {
    const db = await setupDB();
    await createUser(db, "0xproducer0000000000000000000000000000001", "Producer");
    await assignRole(db, "0xproducer0000000000000000000000000000001", "producer");

    const resolved = await getPermissionsForAddress(
      db,
      "0xproducer0000000000000000000000000000001",
    );

    expect(resolved.roles).toEqual(["producer"]);
    expect(resolved.permissions).toEqual([]);
    expect(resolved.permissions).not.toContain("manage_roles");
    expect(resolved.permissions).not.toContain("view_admin");
  });
});

describe("admin route RBAC", () => {
  let db: DrizzleDB;
  let app: Hono;
  let adminToken: string;
  let gamerToken: string;
  let sysopToken: string;

  beforeEach(async () => {
    db = await setupDB();

    const adminUserId = await createUser(db, ADMIN_ADDRESS, "Admin");
    const gamerUserId = await createUser(db, GAMER_ADDRESS, "Gamer");
    const sysopUserId = await createUser(db, SYSOP_ADDRESS, "Sysop");

    adminToken = await createSessionToken(adminUserId, {
      roles: ["admin"],
      permissions: [
        "create_game",
        "start_game",
        "stop_game",
        "fill_game",
        "view_admin",
        "schedule_free_game",
        "hide_game",
      ],
    });

    gamerToken = await createSessionToken(gamerUserId, {
      roles: ["gamer"],
      permissions: [
        "create_game",
        "start_game",
        "fill_game",
      ],
    });

    sysopToken = await createSessionToken(sysopUserId, {
      roles: ["sysop"],
      permissions: [
        "manage_roles",
        "create_game",
        "start_game",
        "join_game",
        "stop_game",
        "fill_game",
        "view_admin",
        "schedule_free_game",
        "hide_game",
      ],
    });

    app = new Hono();
    app.route("/", createAdminRoutes(db));
  });

  test("allows admin read routes without manage_roles", async () => {
    const res = await app.request("/api/admin/games", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
  });

  test("keeps role-management routes locked to manage_roles", async () => {
    const res = await app.request("/api/admin/roles", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(403);
  });

  test("does not grant gamer access to admin read routes", async () => {
    const res = await app.request("/api/admin/games", {
      headers: { Authorization: `Bearer ${gamerToken}` },
    });

    expect(res.status).toBe(403);
  });

  test("allows admin users to inspect avatar generation and change history without raw prompts", async () => {
    const ownerId = await createUser(db, "0xavatar0000000000000000000000000000000001", "Avatar Owner");
    await db.insert(schema.agentProfiles).values({
      id: "admin-avatar-agent",
      userId: ownerId,
      name: "Avatar Agent",
      personality: "A watchable player.",
      personaKey: "diplomat",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });
    await db.insert(schema.avatarGenerationRequests).values({
      id: "admin-avatar-generation",
      userId: ownerId,
      agentProfileId: "admin-avatar-agent",
      purpose: "agent_profile_completion",
      status: "failed",
      triggerSource: "web_user_prompt",
      provider: "katana",
      model: "gen",
      providerRequestId: "katana-request",
      estimatedCostMicrousd: 15600,
      failureCode: "provider_failed",
      failureMessage: "Provider failed safely",
      safeMetadata: {
        promptHash: "safe-hash",
        prompt: "raw prompt should not leak",
        providerAssetUrl: "https://provider.example/avatar.png",
        width: 1024,
      },
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:01.000Z",
      completedAt: "2026-07-02T00:00:01.000Z",
    });
    await db.insert(schema.avatarChangeEvents).values({
      id: "admin-avatar-change",
      userId: ownerId,
      agentProfileId: "admin-avatar-agent",
      generationRequestId: "admin-avatar-generation",
      source: "generation_failed",
      status: "failed",
      actorUserId: ownerId,
      previousAvatarUrl: null,
      newAvatarUrl: null,
      safeMetadata: {
        reason: "provider_failed",
        secretToken: "do-not-leak",
      },
      createdAt: "2026-07-02T00:00:01.000Z",
    });

    const generationsRes = await app.request("/api/admin/avatar-generations", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(generationsRes.status).toBe(200);
    const generations = await generationsRes.json() as Array<{ safeMetadata: Record<string, unknown>; failureCode: string }>;
    expect(generations).toHaveLength(1);
    expect(generations[0]!.failureCode).toBe("provider_failed");
    expect(JSON.stringify(generations)).not.toContain("raw prompt");
    expect(JSON.stringify(generations)).not.toContain("provider.example");
    expect(generations[0]!.safeMetadata.width).toBe(1024);

    const changesRes = await app.request("/api/admin/avatar-changes", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(changesRes.status).toBe(200);
    const changes = await changesRes.json() as Array<{ safeMetadata: Record<string, unknown>; source: string }>;
    expect(changes).toHaveLength(1);
    expect(changes[0]!.source).toBe("generation_failed");
    expect(JSON.stringify(changes)).not.toContain("do-not-leak");
  });

  test("denies gamer access to avatar diagnostics", async () => {
    const res = await app.request("/api/admin/avatar-generations", {
      headers: { Authorization: `Bearer ${gamerToken}` },
    });

    expect(res.status).toBe(403);
  });

  test("allows admin users to inspect a durable run by slug", async () => {
    const gameId = await insertGame(db, { slug: "admin-durable-run" });
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createCanonicalEventFixture(gameId);
    const privatePlayerNote = "PRIVATE_PLAYER_CONTINUITY_SENTINEL";
    const privateStrategyPacket = "PRIVATE_STRATEGY_PACKET_SENTINEL";
    const privateHouseSummary = "PRIVATE_HOUSE_CONTINUITY_SENTINEL";
    await appendGameEvents(db, { gameId, ownerEpoch, events });
    const baseCapsule = createCheckpointCapsule(events);
    const eventHeadHash = hashCanonicalEvent(events.at(-1)!);
    const capsule = enrichCapsuleForV1Candidate(baseCapsule, { ownerEpoch, eventHeadHash });
    capsule.playerContinuityCapsules = (capsule.playerContinuityCapsules ?? []).map((playerCapsule, index) => ({
      ...playerCapsule,
      strategyPacket: {
        revisionId: `strategy-packet-${index}`,
        previousRevisionId: null,
        updatedAtRound: capsule.round,
        updatedAtPhase: capsule.phase,
        objective: `${privateStrategyPacket} ${playerCapsule.playerName}`,
        targetPosture: "keep target pressure private",
        coalitionPosture: "hold an alliance read",
        nextSocialProbe: "ask a bounded question",
        strategicLens: "vote_math",
        strategicLensRationale: "vote pressure is the current useful frame",
        uncertainty: "whether the alliance will hold",
        reviseTrigger: "new contradiction appears",
        changedSincePrevious: "initial packet",
      },
      notes: [{ subject: "continuity", note: `${privatePlayerNote} ${playerCapsule.playerName}` }],
      roundHistory: [{ round: capsule.round, note: "private round read" }],
    }));
    capsule.houseContinuityCapsule = {
      ...capsule.houseContinuityCapsule!,
      summary: privateHouseSummary,
      alliances: [{
        name: "test alliance",
        members: ["Atlas", "Mira"],
        status: "speculative",
        confidence: "medium",
        evidence: ["private alliance read"],
      }],
    };
    const checkpoint = await writeGameCheckpoint(db, {
      gameId,
      ownerEpoch,
      checkpoint: capsule,
    });
    const evidence = await createEvidenceManifest(db, {
      gameId,
      ownerEpoch,
      eventSequence: 2,
      evidenceType: "llm_response",
      retentionClass: "debug",
      storage: {
        provider: "linode_object_storage",
        bucket: "private-content",
        key: `content/${gameId}/round-1/response.json`,
      },
      sourcePointers: [{
        kind: "agent_turn",
        actorId: "atlas",
        action: "vote",
      }],
      metadata: {
        prompt: "raw prompt should stay private",
        response: "raw response should stay private",
        thinking: "private reasoning should stay private",
        reasoningContext: "private context should stay private",
      },
    });

    expect(checkpoint.ok).toBeTrue();
    expect(evidence.ok).toBeTrue();

    const res = await app.request("/api/admin/games/admin-durable-run/durable-run", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schemaVersion: number;
      game: { id: string };
      eventLog: { status: string; rowCount: number };
      projection: { status: string };
      checkpoints: {
        count: number;
        entries: Array<{
          passport: {
            verdict: string;
            stamps: Array<{ id: string; status: string; blocking: boolean }>;
          };
        }>;
      };
      evidence: { totalCount: number; storage: { providerCounts: Record<string, number> } };
      diagnostics: unknown[];
    };
    expect(body.schemaVersion).toBe(2);
    expect(body.game.id).toBe(gameId);
    expect(body.eventLog).toMatchObject({
      status: "complete",
      rowCount: events.length,
    });
    expect(body.projection.status).toBe("complete");
    expect(body.checkpoints.count).toBe(1);
    expect(body.checkpoints.entries[0]).toMatchObject({
      passport: { verdict: "hydration_candidate" },
    });
    const checkpointEntry = body.checkpoints.entries[0];
    expect(checkpointEntry).toBeDefined();
    if (!checkpointEntry) throw new Error("missing checkpoint entry");
    expect("hydrateable" in checkpointEntry).toBeFalse();
    expect("hydrationStatus" in checkpointEntry).toBeFalse();
    expect("degradedReason" in checkpointEntry).toBeFalse();
    expect(body.checkpoints.entries[0]?.passport.stamps.every((stamp) => (
      stamp.status === "passed" && stamp.blocking === false
    ))).toBeTrue();
    expect(body.evidence).toMatchObject({
      totalCount: 1,
      storage: { providerCounts: { linode_object_storage: 1 } },
    });
    expect(body.diagnostics).toEqual([]);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(ownerEpoch);
    expect(serialized).not.toContain("manifestId");
    expect(serialized).not.toContain("storageBucket");
    expect(serialized).not.toContain("storageKey");
    expect(serialized).not.toContain("sourcePointers");
    expect(serialized).not.toContain("strategyPacket");
    expect(serialized).not.toContain(privatePlayerNote);
    expect(serialized).not.toContain(privateStrategyPacket);
    expect(serialized).not.toContain(privateHouseSummary);
    expect(serialized).not.toContain("private-content");
    expect(serialized).not.toContain(`content/${gameId}/round-1/response.json`);
    expect(serialized).not.toContain("raw prompt");
    expect(serialized).not.toContain("raw response");
    expect(serialized).not.toContain("thinking");
    expect(serialized).not.toContain("reasoningContext");
  });

  test("requires authentication for durable run inspection", async () => {
    const res = await app.request("/api/admin/games/missing/durable-run");

    expect(res.status).toBe(401);
  });

  test("denies gamer access to durable run inspection", async () => {
    const gameId = await insertGame(db, { slug: "gamer-denied-durable-run" });

    const res = await app.request(`/api/admin/games/${gameId}/durable-run`, {
      headers: { Authorization: `Bearer ${gamerToken}` },
    });

    expect(res.status).toBe(403);
  });

  test("returns not found for unknown durable run IDs", async () => {
    const res = await app.request("/api/admin/games/missing-durable-run/durable-run", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Game not found" });
  });

  test("allows sysop to access role-management routes", async () => {
    const res = await app.request("/api/admin/roles", {
      headers: { Authorization: `Bearer ${sysopToken}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.some((role) => role.name === "gamer")).toBeTrue();
  });
});
