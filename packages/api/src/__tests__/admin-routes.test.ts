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
  insertGame,
  insertOwner,
} from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

const ADMIN_ADDRESS = "0xadmin000000000000000000000000000000000001";
const GAMER_ADDRESS = "0xgamer000000000000000000000000000000000001";
const SYSOP_ADDRESS = "0xsysop000000000000000000000000000000000001";

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-admin-routes";
  process.env.ADMIN_ADDRESS = SYSOP_ADDRESS;
  process.env.LINODE_OBJ_BUCKET = "public-profile-pictures";
  process.env.LINODE_PRIVATE_EVIDENCE_BUCKET = "private-evidence";
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

  test("allows admin users to inspect a durable run by slug", async () => {
    const gameId = await insertGame(db, { slug: "admin-durable-run" });
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createCanonicalEventFixture(gameId);
    const privatePlayerNote = "PRIVATE_PLAYER_CONTINUITY_SENTINEL";
    const privateStrategyPacket = "PRIVATE_STRATEGY_PACKET_SENTINEL";
    const privateHouseSummary = "PRIVATE_HOUSE_CONTINUITY_SENTINEL";
    await appendGameEvents(db, { gameId, ownerEpoch, events });
    const capsule = createCheckpointCapsule(events);
    capsule.snapshotManifest = {
      version: 1,
      components: {
        projectionTruth: { status: "captured", version: 1 },
        xstateActor: { status: "captured", version: 1 },
        phaseAccumulators: { status: "captured", version: 1 },
        playerContinuity: { status: "private_reference_only", version: 1 },
        houseContinuity: { status: "private_reference_only", version: 1 },
        transcriptCursor: { status: "captured", version: 1 },
        tokenCursor: { status: "captured", version: 1 },
        ownerEpoch: { status: "captured", version: 1 },
      },
    };
    capsule.boundaryCertificate = {
      gameId,
      boundarySequence: capsule.lastEventSequence,
      checkpointReason: capsule.checkpointKind,
      eventCommitReceipt: null,
      noPendingEffectsAsserted: true,
    };
    capsule.transcriptCursor = {
      entries: 12,
      durableBoundary: true,
      lastEntryId: "transcript-entry-12",
    };
    capsule.playerContinuityCapsules = Object.values(capsule.projection.players)
      .filter((player) => player.status !== "eliminated")
      .map((player, index) => ({
        playerId: player.id,
        playerName: player.name,
        strategyPacket: {
          revisionId: `strategy-packet-${index}`,
          previousRevisionId: null,
          updatedAtRound: capsule.round,
          updatedAtPhase: capsule.phase,
          objective: `${privateStrategyPacket} ${player.name}`,
          targetPosture: "keep target pressure private",
          coalitionPosture: "hold an alliance read",
          nextSocialProbe: "ask a bounded question",
          strategicLens: "vote_math",
          strategicLensRationale: "vote pressure is the current useful frame",
          uncertainty: "whether the alliance will hold",
          reviseTrigger: "new contradiction appears",
          changedSincePrevious: "initial packet",
        },
        reflectionSummary: {
          certainties: ["the board has a vote boundary"],
          suspicions: ["one player is hedging"],
          allies: [],
          threats: [],
          plan: "preserve private continuity without leaking it",
          strategicLens: "broad_read",
          strategicLensRationale: "test fixture only",
        },
        notes: [{ subject: "continuity", note: `${privatePlayerNote} ${player.name}` }],
        commitments: ["keep the promise private"],
        relationships: { allies: [], threats: [] },
        powerActionMemory: null,
        roundHistory: [{ round: capsule.round, note: "private round read" }],
      }));
    capsule.houseContinuityCapsule = {
      revisionId: "house-continuity-1",
      previousRevisionId: null,
      updatedAtRound: capsule.round,
      updatedAtPhase: capsule.phase,
      summary: privateHouseSummary,
      alliances: [{
        name: "test alliance",
        members: ["Atlas", "Mira"],
        status: "speculative",
        confidence: "medium",
        evidence: ["private alliance read"],
      }],
      tensions: ["private tension read"],
      promises: ["private promise ledger"],
      voteBlocs: ["private vote bloc"],
      mingleDiscoveries: ["private room read"],
      playerTrajectories: [{
        playerName: "Atlas",
        currentRead: "private trajectory",
        pressurePoints: ["private pressure"],
      }],
      storyArcs: [{
        title: "private arc",
        summary: "private arc summary",
        involvedPlayers: ["Atlas"],
        status: "emerging",
      }],
      droppedThreads: [],
      openQuestions: ["private open question"],
      changedSincePrevious: "initial House continuity",
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
        bucket: "private-evidence",
        key: `evidence/${gameId}/round-1/response.json`,
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
          hydrateable: boolean;
          passport: {
            verdict: string;
            stamps: Array<{ id: string; status: string; blocking: boolean }>;
          };
        }>;
      };
      evidence: { totalCount: number; storage: { providerCounts: Record<string, number> } };
      diagnostics: unknown[];
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.game.id).toBe(gameId);
    expect(body.eventLog).toMatchObject({
      status: "complete",
      rowCount: events.length,
    });
    expect(body.projection.status).toBe("complete");
    expect(body.checkpoints.count).toBe(1);
    expect(body.checkpoints.entries[0]).toMatchObject({
      hydrateable: false,
      passport: { verdict: "hydration_candidate" },
    });
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
    expect(serialized).not.toContain("private-evidence");
    expect(serialized).not.toContain(`evidence/${gameId}/round-1/response.json`);
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
