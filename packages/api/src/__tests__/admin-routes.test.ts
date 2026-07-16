import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { schema } from "../db/index.js";
import type { DrizzleDB } from "../db/index.js";
import { getPermissionsForAddress } from "../db/rbac.js";
import { seedRBAC } from "../db/rbac-seed.js";
import { createSessionToken } from "../middleware/auth.js";
import { createAdminRoutes } from "../routes/admin.js";
import { appendGameEvents } from "../services/game-events.js";
import { writeGameCheckpoint } from "../services/game-checkpoints.js";
import { createEvidenceManifest } from "../services/game-evidence.js";
import { recordProviderSpendForTrace } from "../services/provider-cost-accounting.js";
import { Phase, type PrivateDecisionTrace } from "@influence/engine";
import {
  createCheckpointCapsule,
  createCanonicalEventFixture,
  enrichCapsuleForV1Candidate,
  insertGame,
  insertOwner,
} from "./durable-run-test-utils.js";
import { hashCanonicalEvent } from "../services/game-events.js";
import { setupTestDB } from "./test-utils.js";
import { createSeason } from "../services/seasons.js";
import {
  captureGameCompletionSettlement,
  settleCapturedGameCompletion,
} from "../services/game-completion-settlement.js";

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

function createCostTrace(): PrivateDecisionTrace {
  return {
    version: 2,
    action: "vote",
    actor: { id: "atlas", name: "Atlas", role: "player" },
    phase: Phase.VOTE,
    round: 1,
    createdAt: "2026-07-03T12:00:00.000Z",
    model: {
      provider: "openai",
      providerProfileId: "openai",
      catalogId: "openai:gpt-5-nano",
      name: "gpt-5-nano",
    },
    prompt: { messages: [{ role: "user", content: "private prompt" }] },
    response: {
      raw: {
        id: "resp_admin_cost",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      },
      finishReason: "stop",
    },
  };
}

async function createPendingSettlementFixture(
  db: DrizzleDB,
  slug: string,
): Promise<{ gameId: string; ownerEpoch: string }> {
  const gameId = await insertGame(db, { slug, status: "in_progress" });
  const ownerEpoch = await insertOwner(db, gameId, {
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  const events = createCanonicalEventFixture(gameId);
  await appendGameEvents(db, { gameId, ownerEpoch, events });
  const finalEvent = events.at(-1)!;
  await captureGameCompletionSettlement(db, {
    gameId,
    ownerEpoch,
    finalEventSequence: finalEvent.sequence,
    finalEventHash: hashCanonicalEvent(finalEvent),
    terminalResult: {
      gameId,
      winnerId: null,
      winnerName: null,
      rounds: 1,
      transcript: [{
        round: 1,
        phase: Phase.END,
        timestamp: 1_720_000_000_000,
        from: "House",
        scope: "system",
        text: "private settlement transcript",
      }],
      eliminationOrder: [],
      rankedPlayerIds: [],
    },
    tokenUsage: {
      total: {
        promptTokens: 0,
        cachedTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        callCount: 0,
        emptyResponses: 0,
      },
      perAction: {},
    },
    resolvedModel: "test-model",
    calculatedCost: null,
    completionConfig: { modelTier: "budget", maxRounds: 1 },
    finishedAt: "2026-07-15T12:00:00.000Z",
  });
  await db.update(schema.games).set({ status: "suspended" })
    .where(eq(schema.games.id, gameId));
  await db.update(schema.gameRunOwners).set({
    status: "expired",
    failureReason: "completion_settlement_transient_failure",
    closedAt: "2026-07-15T12:01:00.000Z",
  }).where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch));
  await db.update(schema.gameCompletionSettlements).set({
    retryReadyAt: "2026-07-15T12:01:00.000Z",
    lastSafeFailureCode: "completion_settlement_transient_failure",
  }).where(eq(schema.gameCompletionSettlements.gameId, gameId));
  return { gameId, ownerEpoch };
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
    expect(resolved.permissions).not.toContain("retry_game_settlement");
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
    expect(resolved.permissions).not.toContain("retry_game_settlement");
  });
});

describe("admin route RBAC", () => {
  let db: DrizzleDB;
  let app: Hono;
  let adminToken: string;
  let gamerToken: string;
  let sysopToken: string;
  let adminUserId: string;
  let sysopUserId: string;

  beforeEach(async () => {
    db = await setupDB();

    adminUserId = await createUser(db, ADMIN_ADDRESS, "Admin");
    const gamerUserId = await createUser(db, GAMER_ADDRESS, "Gamer");
    sysopUserId = await createUser(db, SYSOP_ADDRESS, "Sysop");
    await assignRole(db, ADMIN_ADDRESS, "admin");
    await assignRole(db, GAMER_ADDRESS, "gamer");

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
        "manage_postgame_media",
        "retry_game_settlement",
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
        "manage_cost_accounting",
        "manage_postgame_media",
        "retry_game_settlement",
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

  test("grants completion settlement retry only to admin and sysop seed roles", async () => {
    const admin = await getPermissionsForAddress(db, ADMIN_ADDRESS);
    const sysop = await getPermissionsForAddress(db, SYSOP_ADDRESS);
    const gamer = await getPermissionsForAddress(db, GAMER_ADDRESS);

    expect(admin.permissions).toContain("retry_game_settlement");
    expect(sysop.permissions).toContain("retry_game_settlement");
    expect(gamer.permissions).not.toContain("retry_game_settlement");
  });

  test("audits denied, invalid, successful, repeated, and repair-blocked settlement retries", async () => {
    const deniedFixture = await createPendingSettlementFixture(db, "admin-settlement-denied");
    const readOnlyUserId = await createUser(
      db,
      "0xreadonly0000000000000000000000000000000001",
      "Read only",
    );
    const producerUserId = await createUser(
      db,
      "0xproducerretry000000000000000000000000000001",
      "Producer",
    );
    const readOnlyToken = await createSessionToken(readOnlyUserId, {
      roles: ["admin-reader"],
      permissions: ["view_admin"],
    });
    const producerToken = await createSessionToken(producerUserId, {
      roles: ["producer"],
      permissions: [],
    });
    const denied = await app.request(
      `/api/admin/games/${deniedFixture.gameId}/completion-settlement/retry`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${gamerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "operator review", confirmation: "RETRY_SETTLEMENT" }),
      },
    );
    expect(denied.status).toBe(403);
    const repeatedDenied = await app.request(
      `/api/admin/games/${deniedFixture.gameId}/completion-settlement/retry`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${gamerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "operator review", confirmation: "RETRY_SETTLEMENT" }),
      },
    );
    expect(repeatedDenied.status).toBe(403);
    for (const token of [readOnlyToken, producerToken]) {
      const response = await app.request(
        `/api/admin/games/${deniedFixture.gameId}/completion-settlement/retry`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "operator review", confirmation: "RETRY_SETTLEMENT" }),
        },
      );
      expect(response.status).toBe(403);
    }

    const successFixture = await createPendingSettlementFixture(db, "admin-settlement-success");
    const invalid = await app.request(
      `/api/admin/games/${successFixture.gameId}/completion-settlement/retry`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "operator review", confirmation: "retry" }),
      },
    );
    expect(invalid.status).toBe(400);

    const completed = await app.request(
      `/api/admin/games/${successFixture.gameId}/completion-settlement/retry`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "operator verified the runner is gone", confirmation: "RETRY_SETTLEMENT" }),
      },
    );
    expect(completed.status).toBe(200);
    const completedBody = await completed.json() as Record<string, unknown>;
    expect(completedBody.outcome).toBe("completed");
    expect(JSON.stringify(completedBody)).not.toContain("private settlement transcript");
    expect(JSON.stringify(completedBody)).not.toContain("payload");

    const repeated = await app.request(
      `/api/admin/games/${successFixture.gameId}/completion-settlement/retry`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${sysopToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "verify idempotent completion", confirmation: "RETRY_SETTLEMENT" }),
      },
    );
    expect(repeated.status).toBe(200);
    expect((await repeated.json() as Record<string, unknown>).outcome).toBe("already_completed");

    const notReadyFixture = await createPendingSettlementFixture(db, "admin-settlement-not-ready");
    await db.update(schema.gameCompletionSettlements).set({ retryReadyAt: null })
      .where(eq(schema.gameCompletionSettlements.gameId, notReadyFixture.gameId));
    const notReady = await app.request(
      `/api/admin/games/${notReadyFixture.gameId}/completion-settlement/retry`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "operator review", confirmation: "RETRY_SETTLEMENT" }),
      },
    );
    expect(notReady.status).toBe(409);
    expect((await notReady.json() as Record<string, unknown>).code).toBe("invalid_state");

    const failedFixture = await createPendingSettlementFixture(db, "admin-settlement-failed");
    const failureApp = new Hono();
    failureApp.route("/", createAdminRoutes(db, {
      completionSettlement: {
        settleCapturedGameCompletion: async () => {
          throw new Error("private injected failure detail");
        },
      },
    }));
    const failed = await failureApp.request(
      `/api/admin/games/${failedFixture.gameId}/completion-settlement/retry`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "operator review", confirmation: "RETRY_SETTLEMENT" }),
      },
    );
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("private injected failure detail");

    const ambiguousFixture = await createPendingSettlementFixture(db, "admin-settlement-ambiguous");
    const ambiguousApp = new Hono();
    ambiguousApp.route("/", createAdminRoutes(db, {
      completionSettlement: {
        settleCapturedGameCompletion: async (settlementDb, gameId, context) => {
          await settleCapturedGameCompletion(settlementDb, gameId, context);
          throw new Error("commit acknowledgement lost");
        },
      },
    }));
    const ambiguous = await ambiguousApp.request(
      `/api/admin/games/${ambiguousFixture.gameId}/completion-settlement/retry`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "operator verifies ambiguous commit",
          confirmation: "RETRY_SETTLEMENT",
        }),
      },
    );
    expect(ambiguous.status).toBe(200);
    expect((await ambiguous.json() as Record<string, unknown>).outcome).toBe("already_completed");

    const repairFixture = await createPendingSettlementFixture(db, "admin-settlement-repair");
    await db.update(schema.gameCompletionSettlements).set({
      state: "repair_required",
      retryReadyAt: null,
      lastSafeFailureCode: "completion_boundary_conflict",
    }).where(eq(schema.gameCompletionSettlements.gameId, repairFixture.gameId));
    const repair = await app.request(
      `/api/admin/games/${repairFixture.gameId}/completion-settlement/retry`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "operator review", confirmation: "RETRY_SETTLEMENT" }),
      },
    );
    expect(repair.status).toBe(409);
    expect((await repair.json() as Record<string, unknown>).code).toBe("repair_blocked");

    const settlementAudits = await db.select({
      id: schema.gameCompletionSettlementAttempts.id,
      requestAttemptId: schema.gameCompletionSettlementAttempts.requestAttemptId,
      gameId: schema.gameCompletionSettlementAttempts.gameId,
      settlementId: schema.gameCompletionSettlementAttempts.settlementId,
      actorUserId: schema.gameCompletionSettlementAttempts.actorUserId,
      outcome: schema.gameCompletionSettlementAttempts.outcome,
      requestedReason: schema.gameCompletionSettlementAttempts.requestedReason,
      priorState: schema.gameCompletionSettlementAttempts.priorState,
      resultingState: schema.gameCompletionSettlementAttempts.resultingState,
      resultHash: schema.gameCompletionSettlementAttempts.resultHash,
      safeFailureCode: schema.gameCompletionSettlementAttempts.safeFailureCode,
      safeMetadata: schema.gameCompletionSettlementAttempts.safeMetadata,
      createdAt: schema.gameCompletionSettlementAttempts.createdAt,
    }).from(schema.gameCompletionSettlementAttempts);
    const outcomes = settlementAudits.map((row) => row.outcome);
    expect(outcomes).toContain("denied");
    expect(outcomes).toContain("invalid_state");
    expect(outcomes).toContain("requested");
    expect(outcomes).toContain("succeeded");
    expect(outcomes).toContain("already_completed");
    expect(outcomes).toContain("repair_blocked");
    expect(outcomes).toContain("failed");
    expect(outcomes.filter((outcome) => outcome === "denied")).toHaveLength(3);
    const requestedAudits = settlementAudits.filter((row) => row.outcome === "requested");
    expect(requestedAudits).toHaveLength(6);
    for (const requested of requestedAudits) {
      const terminal = settlementAudits.find((row) => row.requestAttemptId === requested.id);
      expect(terminal).toBeDefined();
      expect(terminal).toMatchObject({
        gameId: requested.gameId,
        settlementId: requested.settlementId,
        actorUserId: requested.actorUserId,
        requestedReason: requested.requestedReason,
        priorState: requested.priorState,
        resultHash: requested.resultHash,
      });
      expect(terminal?.createdAt).toBeString();
    }
    expect(JSON.stringify(settlementAudits))
      .not.toContain("private settlement transcript");
  });

  test("returns confirmed ambiguous settlement success when audit finalization is deferred", async () => {
    const fixture = await createPendingSettlementFixture(db, "admin-settlement-audit-deferred");
    const auditDeferredApp = new Hono();
    auditDeferredApp.route("/", createAdminRoutes(db, {
      completionSettlement: {
        settleCapturedGameCompletion: async (settlementDb, gameId, context) => {
          await settleCapturedGameCompletion(settlementDb, gameId, context);
          throw new Error("commit acknowledgement lost");
        },
        finalizeRequestedOperatorAudit: async () => {
          throw new Error("audit store unavailable");
        },
      },
    }));

    const response = await auditDeferredApp.request(
      `/api/admin/games/${fixture.gameId}/completion-settlement/retry`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "operator confirms ambiguous commit",
          confirmation: "RETRY_SETTLEMENT",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect((await response.json() as Record<string, unknown>).outcome).toBe("already_completed");
  });

  test("admin game history uses slug and persisted season identity", async () => {
    const season = await createSeason(db, { slug: "season-zero", name: "Season 0" });
    const gameId = await insertGame(db, { slug: "admin-season-game" });
    await db.update(schema.games).set({ seasonId: season.id }).where(eq(schema.games.id, gameId));

    const res = await app.request("/api/admin/games", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const rows = await res.json() as Array<Record<string, unknown>>;

    expect(rows[0]).toMatchObject({
      id: gameId,
      slug: "admin-season-game",
      seasonId: season.id,
      season: { id: season.id, slug: "season-zero", name: "Season 0" },
      completionSettlement: { state: "not_applicable", retryEligible: false },
    });
    expect(rows[0]).not.toHaveProperty("gameNumber");
  });

  test("auto-suffixes conflicting imported profiles without rewriting historical persona", async () => {
    const existingOwner = await createUser(
      db,
      "0xexisting0000000000000000000000000000000001",
      "Existing Owner",
    );
    await db.insert(schema.agentProfiles).values({
      id: "existing-atlas-two",
      userId: existingOwner,
      name: "Atlas II",
      personality: "Already owns the first available suffix.",
    });

    const persona = JSON.stringify({
      name: "Atlas",
      personality: "Historical imported behavior.",
    });
    const response = await app.request("/api/admin/import-game", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: 1,
        game: {
          id: "source-import-game",
          slug: "source-import-game",
          config: JSON.stringify({ modelTier: "budget" }),
          status: "completed",
          trackType: "custom",
          minPlayers: 1,
          maxPlayers: 1,
          startedAt: "2026-07-01T00:00:00.000Z",
          endedAt: "2026-07-01T01:00:00.000Z",
          hiddenAt: null,
        },
        players: [{
          id: "source-import-player",
          userId: "source-import-user",
          agentProfileId: "source-import-profile",
          persona,
          agentConfig: JSON.stringify({ model: "test", temperature: 0.7 }),
          agentProfile: {
            id: "source-import-profile",
            userId: "source-import-user",
            name: "Atlas",
            personality: "Historical imported behavior.",
          },
        }],
        transcripts: [],
        result: null,
        agentMemories: [],
      }),
    });

    expect(response.status).toBe(201);
    const [profile] = await db.select().from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, "source-import-profile"));
    expect(profile?.name).toBe("Atlas III");
    const [seat] = await db.select().from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.agentProfileId, "source-import-profile"));
    expect(seat?.persona).toBe(persona);
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

  test("shows the practical free queue view and removes an entry directly", async () => {
    await createSeason(db, { slug: "admin-queue", name: "Admin Queue" });
    const ownerId = await createUser(db, "0xqueue00000000000000000000000000000000001", "Queue Owner");
    await db.insert(schema.agentProfiles).values({
      id: "admin-queue-agent",
      userId: ownerId,
      name: "Queue Atlas",
      personality: "Patient",
      gamesPlayed: 0,
      gamesWon: 0,
    });
    await db.insert(schema.freeGameQueue).values({
      id: "admin-queue-entry",
      userId: ownerId,
      agentProfileId: "admin-queue-agent",
      consecutiveMisses: 2,
    });

    const read = await app.request("/api/admin/free-queue", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(read.status).toBe(200);
    const body = await read.json() as Record<string, unknown> & { entries: Array<Record<string, unknown>> };
    expect(body.eligibleCount).toBe(1);
    expect(body.availableHumanSeats).toBe(12);
    expect(body.entries[0]).toMatchObject({
      userId: ownerId,
      ownerLabel: "Queue Owner",
      agentName: "Queue Atlas",
      status: "eligible",
      consecutiveMisses: 2,
    });
    expect(JSON.stringify(body)).not.toContain("walletAddress");
    expect(JSON.stringify(body)).not.toContain("email");

    const readOnlyToken = await createSessionToken(adminUserId, {
      roles: ["admin-reader"],
      permissions: ["view_admin"],
    });
    const deniedRemoval = await app.request(`/api/admin/free-queue/${ownerId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${readOnlyToken}` },
    });
    expect(deniedRemoval.status).toBe(403);

    const removed = await app.request(`/api/admin/free-queue/${ownerId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(removed.status).toBe(200);
    expect(await db.select().from(schema.freeGameQueue)).toEqual([]);
    expect(await db.select().from(schema.freeQueuePromptSuppressions)).toHaveLength(1);
  });

  test("keeps highlights diagnostics behind admin read permission", async () => {
    const denied = await app.request("/api/admin/games/missing/postgame/highlights/diagnostics", {
      headers: { Authorization: `Bearer ${gamerToken}` },
    });
    expect(denied.status).toBe(403);

    const allowed = await app.request("/api/admin/games/missing/postgame/highlights/diagnostics", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(allowed.status).toBe(404);
    const body = (await allowed.json()) as { status: string };
    expect(body.status).toBe("not_found");
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
        draftProfile: { personality: "private draft personality" },
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
    expect(JSON.stringify(generations)).not.toContain("private draft personality");
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

  test("allows admin read users to inspect game costs", async () => {
    const gameId = await insertGame(db, { slug: "admin-cost-game" });
    const ownerEpoch = await insertOwner(db, gameId);
    await recordProviderSpendForTrace(db, {
      gameId,
      ownerEpoch,
      trace: createCostTrace(),
    });

    const listRes = await app.request("/api/admin/games", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as Array<{ id: string; cost?: { callCount: number; estimatedCostMicrousd: number } | null }>;
    const row = list.find((game) => game.id === gameId);
    expect(row?.cost?.callCount).toBe(1);
    expect(row?.cost?.estimatedCostMicrousd).toBeGreaterThan(0);

    const detailRes = await app.request("/api/admin/games/admin-cost-game/costs", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json() as Record<string, unknown>;
    expect(detail.callCount).toBe(1);
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("traceManifestId");
    expect(serialized).not.toContain("storageKey");
    expect(serialized).not.toContain("sourceKey");
  });

  test("keeps cost reads admin-only and cost mutations behind manage_cost_accounting", async () => {
    const gameId = await insertGame(db, { slug: "admin-cost-backfill" });
    const ownerEpoch = await insertOwner(db, gameId);
    await db.insert(schema.gameEvidenceManifests).values({
      id: "secret-route-manifest-id",
      gameId,
      ownerEpoch,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      metadata: { action: "vote" },
    });

    const gamerRead = await app.request("/api/admin/games/admin-cost-backfill/costs", {
      headers: { Authorization: `Bearer ${gamerToken}` },
    });
    expect(gamerRead.status).toBe(403);

    const adminMissingBackfill = await app.request("/api/admin/games/missing-admin-cost-backfill/costs/backfill", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(adminMissingBackfill.status).toBe(403);

    const adminBackfill = await app.request("/api/admin/games/admin-cost-backfill/costs/backfill", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(adminBackfill.status).toBe(403);

    const sysopBackfill = await app.request("/api/admin/games/admin-cost-backfill/costs/backfill", {
      method: "POST",
      headers: { Authorization: `Bearer ${sysopToken}` },
    });
    expect(sysopBackfill.status).toBe(200);
    const body = await sysopBackfill.json() as { gameId: string; rebuilt: boolean; diagnostics: string[] };
    expect(body.gameId).toBe(gameId);
    expect(body.rebuilt).toBeTrue();
    expect(body.diagnostics).toEqual(["trace_manifest:missing_usage"]);
    expect(JSON.stringify(body)).not.toContain("secret-route-manifest-id");

    const audits = await db.select().from(schema.gameCostAccountingAuditEvents);
    const deniedAudits = audits.filter((event) => event.outcome === "denied");
    expect(deniedAudits).toHaveLength(2);
    expect(deniedAudits.every((event) => event.gameId === null)).toBeTrue();
    expect(deniedAudits.every((event) => event.actorUserId === adminUserId)).toBeTrue();
    expect(audits.some((event) => (
      event.outcome === "succeeded" &&
      event.gameId === gameId &&
      event.actorUserId === sysopUserId
    ))).toBeTrue();
  });

  test("keeps postgame media diagnostics admin-only and requires explicit managed actions", async () => {
    const gamerRead = await app.request("/api/admin/games/missing/postgame/media", {
      headers: { Authorization: `Bearer ${gamerToken}` },
    });
    expect(gamerRead.status).toBe(403);

    const adminRead = await app.request("/api/admin/games/missing/postgame/media", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(adminRead.status).toBe(404);

    const invalidRequest = await app.request("/api/admin/games/missing/postgame/media/backfill", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "repair missing work", confirmation: "RERENDER" }),
    });
    expect(invalidRequest.status).toBe(400);

    const confirmedRequest = await app.request("/api/admin/games/missing/postgame/media/backfill", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "repair missing work", confirmation: "BACKFILL" }),
    });
    expect(confirmedRequest.status).toBe(404);
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
