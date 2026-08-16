import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { SignJWT } from "jose";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  createDeploymentControlToken,
  createSessionToken,
  verifyDeploymentControlToken,
  verifySessionToken,
} from "../middleware/auth.js";
import { createDeploymentControlRoutes } from "../routes/deployment-control.js";
import {
  acquireDeploymentAdmissionLease,
  advanceDeploymentAdmissionPhase,
  completeDeploymentAdmissionLease,
  getDeploymentAdmissionStatus,
  heartbeatDeploymentAdmissionLease,
  revokeDeploymentAdmissionLease,
} from "../services/deployment-admission.js";
import { acquireGameRunOwner } from "../services/game-ownership.js";
import { runPendingDeploymentRecoveryReconciliation } from "../services/deployment-recovery-reconciliation.js";
import { setupTestDB } from "./test-utils.js";

const CANDIDATE_SHA = "1".repeat(40);
const PROVENANCE = {
  candidateSha: CANDIDATE_SHA,
  sourceRepository: "0xFlicker/linode-iac",
  workflowRunId: 123,
  workflowRunAttempt: 1,
  actor: "release-operator",
};

describe("deployment admission lease", () => {
  test("records canonical Privy and Clerk operator identities during Resume", async () => {
    for (const revokedBy of ["did:privy:existing-user", "user_clerk"]) {
      const db = await setupTestDB();
      const acquired = await acquireDeploymentAdmissionLease(db, PROVENANCE);
      if (!acquired.ok) throw new Error(acquired.error);
      const validating = await advanceDeploymentAdmissionPhase(db, {
        leaseId: acquired.lease.id,
        fencingToken: acquired.lease.fencingToken,
        expectedPhase: "draining",
        nextPhase: "validating",
      });
      expect(validating.ok).toBeTrue();

      const resumed = await revokeDeploymentAdmissionLease(db, {
        leaseId: acquired.lease.id,
        expectedRevision: 2,
        revokedBy,
        reason: "operator recovery",
      });

      expect(resumed).toMatchObject({ ok: true, outcome: "revoked" });
      expect((await db.select().from(schema.deploymentAdmissionLeases))[0])
        .toMatchObject({ revokedBy });
      expect((await db.select().from(schema.deploymentRecoveryReconciliations))[0])
        .toMatchObject({ leaseId: acquired.lease.id, status: "pending" });
    }
  });

  test("blocks the authoritative waiting-to-in-progress transition without mutating the game", async () => {
    const db = await setupTestDB();
    const gameId = await insertWaitingGame(db);
    const acquired = await acquireDeploymentAdmissionLease(db, PROVENANCE);
    expect(acquired.ok).toBeTrue();

    const owner = await acquireGameRunOwner(db, gameId);

    expect(owner).toMatchObject({
      ok: false,
      statusCode: 409,
      code: "deployment_admission_closed",
      retryable: true,
    });
    expect(await gameStatus(db, gameId)).toBe("waiting");
    expect(await db.select().from(schema.gameRunOwners)).toHaveLength(0);
  });

  test("serializes a racing start and drain so the game is either counted or denied", async () => {
    const db = await setupTestDB();
    const gameId = await insertWaitingGame(db);

    const [owner, acquired] = await Promise.all([
      acquireGameRunOwner(db, gameId),
      acquireDeploymentAdmissionLease(db, PROVENANCE),
    ]);

    expect(acquired.ok).toBeTrue();
    const status = await getDeploymentAdmissionStatus(db);
    expect(status.lease?.phase).toBe("draining");
    if (owner.ok) {
      expect(await gameStatus(db, gameId)).toBe("in_progress");
      expect(status.activeGames.map((game) => game.id)).toContain(gameId);
      expect(status.activeGameCount).toBe(1);
    } else {
      expect(owner.code).toBe("deployment_admission_closed");
      expect(await gameStatus(db, gameId)).toBe("waiting");
      expect(status.activeGameCount).toBe(0);
    }
  });

  test("uses durable in-progress rows for the active set", async () => {
    const db = await setupTestDB();
    const gameId = await insertWaitingGame(db);
    await db.update(schema.games).set({
      status: "in_progress",
      startedAt: new Date().toISOString(),
    }).where(eq(schema.games.id, gameId));

    const acquired = await acquireDeploymentAdmissionLease(db, PROVENANCE);
    expect(acquired.ok).toBeTrue();
    const status = await getDeploymentAdmissionStatus(db);

    expect(status.activeGameCount).toBe(1);
    expect(status.activeGames).toEqual([
      expect.objectContaining({ id: gameId, status: "in_progress" }),
    ]);
  });

  test("heartbeat renews operational expiry without moving the absolute four-hour deadline", async () => {
    const db = await setupTestDB();
    const acquired = await acquireDeploymentAdmissionLease(db, PROVENANCE);
    if (!acquired.ok) throw new Error(acquired.error);
    const original = acquired.lease;
    await db.execute(sql`
      UPDATE deployment_admission_leases
      SET expires_at = (clock_timestamp() + interval '1 second')::text
      WHERE id = ${original.id}
    `);

    const heartbeat = await heartbeatDeploymentAdmissionLease(db, {
      leaseId: original.id,
      fencingToken: original.fencingToken,
    });

    expect(heartbeat.ok).toBeTrue();
    if (!heartbeat.ok) throw new Error(heartbeat.error);
    expect(Date.parse(heartbeat.lease.expiresAt)).toBeGreaterThan(Date.now() + 30_000);
    expect(heartbeat.lease.absoluteDeadlineAt).toBe(original.absoluteDeadlineAt);
    const absoluteDurationSeconds = (Date.parse(original.absoluteDeadlineAt) - Date.parse(original.acquiredAt)) / 1000;
    expect(absoluteDurationSeconds).toBeWithin(14_399, 14_401);
  });

  test("expiry before switching reopens starts and permanently stales the old fence", async () => {
    const db = await setupTestDB();
    const gameId = await insertWaitingGame(db);
    const acquired = await acquireDeploymentAdmissionLease(db, PROVENANCE);
    if (!acquired.ok) throw new Error(acquired.error);
    await expireLease(db, acquired.lease.id);

    const owner = await acquireGameRunOwner(db, gameId);
    expect(owner.ok).toBeTrue();
    const stale = await advanceDeploymentAdmissionPhase(db, {
      leaseId: acquired.lease.id,
      fencingToken: acquired.lease.fencingToken,
      expectedPhase: "draining",
      nextPhase: "validating",
    });
    expect(stale).toMatchObject({ ok: false, code: "lease_expired" });
    expect((await getDeploymentAdmissionStatus(db)).lease).toBeNull();
    expect((await db.select().from(schema.deploymentRecoveryReconciliations))[0])
      .toMatchObject({ leaseId: acquired.lease.id, status: "pending" });
  });

  test("switching remains closed after expiry until the host transaction resolves it", async () => {
    const db = await setupTestDB();
    const gameId = await insertWaitingGame(db);
    const acquired = await acquireDeploymentAdmissionLease(db, PROVENANCE);
    if (!acquired.ok) throw new Error(acquired.error);
    const validating = await advanceDeploymentAdmissionPhase(db, {
      leaseId: acquired.lease.id,
      fencingToken: acquired.lease.fencingToken,
      expectedPhase: "draining",
      nextPhase: "validating",
    });
    expect(validating.ok).toBeTrue();
    const switching = await advanceDeploymentAdmissionPhase(db, {
      leaseId: acquired.lease.id,
      fencingToken: acquired.lease.fencingToken,
      expectedPhase: "validating",
      nextPhase: "switching",
    });
    expect(switching.ok).toBeTrue();
    await expireLease(db, acquired.lease.id);

    const owner = await acquireGameRunOwner(db, gameId);

    expect(owner).toMatchObject({ ok: false, code: "deployment_admission_closed" });
    expect((await getDeploymentAdmissionStatus(db)).lease?.phase).toBe("switching");
  });

  test("durable acceptance or restoration reopens admission under a newer fence", async () => {
    const db = await setupTestDB();
    const firstGameId = await insertWaitingGame(db);
    const first = await acquireDeploymentAdmissionLease(db, PROVENANCE);
    if (!first.ok) throw new Error(first.error);
    await advanceDeploymentAdmissionPhase(db, {
      leaseId: first.lease.id,
      fencingToken: first.lease.fencingToken,
      expectedPhase: "draining",
      nextPhase: "validating",
    });
    await advanceDeploymentAdmissionPhase(db, {
      leaseId: first.lease.id,
      fencingToken: first.lease.fencingToken,
      expectedPhase: "validating",
      nextPhase: "switching",
    });
    await advanceDeploymentAdmissionPhase(db, {
      leaseId: first.lease.id,
      fencingToken: first.lease.fencingToken,
      expectedPhase: "switching",
      nextPhase: "accepting",
    });
    const accepted = await completeDeploymentAdmissionLease(db, {
      leaseId: first.lease.id,
      fencingToken: first.lease.fencingToken,
      outcome: "accepted",
      reason: "canonical probes passed",
    });
    expect(accepted.ok).toBeTrue();
    expect((await acquireGameRunOwner(db, firstGameId)).ok).toBeTrue();
    await db.update(schema.games).set({ status: "completed" })
      .where(eq(schema.games.id, firstGameId));

    const secondGameId = await insertWaitingGame(db);
    const second = await acquireDeploymentAdmissionLease(db, {
      ...PROVENANCE,
      workflowRunId: PROVENANCE.workflowRunId + 1,
    });
    if (!second.ok) throw new Error(second.error);
    expect(second.lease.fencingToken).toBe(first.lease.fencingToken + 1);
    const acceptedReplay = await completeDeploymentAdmissionLease(db, {
      leaseId: first.lease.id,
      fencingToken: first.lease.fencingToken,
      outcome: "accepted",
      reason: "canonical probes passed",
    });
    expect(acceptedReplay).toMatchObject({
      ok: true,
      lease: { id: first.lease.id, status: "accepted" },
    });
    if (!acceptedReplay.ok) throw new Error(acceptedReplay.error);
    expect(acceptedReplay.lease.revision).toBe(accepted.ok ? accepted.lease.revision : -1);
    expect(await completeDeploymentAdmissionLease(db, {
      leaseId: first.lease.id,
      fencingToken: first.lease.fencingToken,
      outcome: "accepted",
      reason: "different completion reason",
    })).toMatchObject({ ok: false, code: "stale_lease" });
    expect(await completeDeploymentAdmissionLease(db, {
      leaseId: first.lease.id,
      fencingToken: first.lease.fencingToken + 1,
      outcome: "accepted",
      reason: "canonical probes passed",
    })).toMatchObject({ ok: false, code: "stale_lease" });
    expect(await heartbeatDeploymentAdmissionLease(db, {
      leaseId: first.lease.id,
      fencingToken: first.lease.fencingToken,
    })).toMatchObject({ ok: false, code: "stale_lease" });
    await advanceDeploymentAdmissionPhase(db, {
      leaseId: second.lease.id,
      fencingToken: second.lease.fencingToken,
      expectedPhase: "draining",
      nextPhase: "validating",
    });
    await advanceDeploymentAdmissionPhase(db, {
      leaseId: second.lease.id,
      fencingToken: second.lease.fencingToken,
      expectedPhase: "validating",
      nextPhase: "switching",
    });
    await advanceDeploymentAdmissionPhase(db, {
      leaseId: second.lease.id,
      fencingToken: second.lease.fencingToken,
      expectedPhase: "switching",
      nextPhase: "restoring",
    });
    const restored = await completeDeploymentAdmissionLease(db, {
      leaseId: second.lease.id,
      fencingToken: second.lease.fencingToken,
      outcome: "restored",
      reason: "previous route restored",
    });
    expect(restored.ok).toBeTrue();
    expect(await completeDeploymentAdmissionLease(db, {
      leaseId: second.lease.id,
      fencingToken: second.lease.fencingToken,
      outcome: "restored",
      reason: "previous route restored",
    })).toMatchObject({ ok: true, lease: { status: "restored" } });
    expect((await acquireGameRunOwner(db, secondGameId)).ok).toBeTrue();
  });

  test("the switching CAS fails when a durable active game exists", async () => {
    const db = await setupTestDB();
    const gameId = await insertWaitingGame(db);
    await db.update(schema.games).set({ status: "in_progress" })
      .where(eq(schema.games.id, gameId));
    const acquired = await acquireDeploymentAdmissionLease(db, PROVENANCE);
    if (!acquired.ok) throw new Error(acquired.error);
    await advanceDeploymentAdmissionPhase(db, {
      leaseId: acquired.lease.id,
      fencingToken: acquired.lease.fencingToken,
      expectedPhase: "draining",
      nextPhase: "validating",
    });

    const switching = await advanceDeploymentAdmissionPhase(db, {
      leaseId: acquired.lease.id,
      fencingToken: acquired.lease.fencingToken,
      expectedPhase: "validating",
      nextPhase: "switching",
    });

    expect(switching).toMatchObject({ ok: false, code: "active_games_remaining" });
    expect((await getDeploymentAdmissionStatus(db)).lease?.phase).toBe("validating");
  });

  test("fails game starts closed when the admission database check is unavailable", async () => {
    const db = {
      transaction: async () => {
        throw new Error("database unavailable");
      },
    } as unknown as DrizzleDB;

    const owner = await acquireGameRunOwner(db, randomUUID());

    expect(owner).toMatchObject({
      ok: false,
      statusCode: 503,
      code: "deployment_admission_unavailable",
      retryable: true,
    });
    expect(owner.ok ? null : owner.error).not.toContain("database unavailable");
  });
});

describe("deployment controller API", () => {
  test("accepts only the explicit service token type, audience, subject, and permission", async () => {
    process.env.JWT_SECRET = "deployment-admission-test-secret";
    const db = await setupTestDB();
    const app = new Hono();
    app.route("/", createDeploymentControlRoutes(db));
    const userToken = await createSessionToken("human-operator");
    const controllerToken = await createDeploymentControlToken("1h");

    expect(await verifySessionToken(controllerToken)).toBeNull();
    expect(await verifyDeploymentControlToken(controllerToken)).toEqual({
      subject: "influence-release-controller",
      audience: "influence-deployment-control",
      permission: "manage_deployment_admission",
      expiresAt: expect.any(Number),
    });
    expect((await app.request("/api/internal/deployment-control/status")).status).toBe(401);
    expect((await app.request("/api/internal/deployment-control/status", {
      headers: { Authorization: `Bearer ${userToken}` },
    })).status).toBe(401);
    expect((await app.request("/api/internal/deployment-control/status", {
      headers: { Authorization: `Bearer ${controllerToken}` },
    })).status).toBe(200);
  });

  test("rejects every malformed controller authority without mutating admission", async () => {
    const secret = "deployment-admission-test-secret";
    process.env.JWT_SECRET = secret;
    const db = await setupTestDB();
    const app = new Hono();
    app.route("/", createDeploymentControlRoutes(db));
    const cases = [
      ["type", { tokenType: "session" }],
      ["audience", { audience: "influence-api" }],
      ["subject", { subject: "human-operator" }],
      ["permission", { permission: "manage_users" }],
      ["signature", { signingSecret: "different-signing-secret" }],
      ["expiration", { expiresAt: Math.floor(Date.now() / 1000) - 60 }],
    ] as const;

    for (const [label, overrides] of cases) {
      const token = await controllerTokenFixture(secret, overrides);
      const response = await app.request(
        "/api/internal/deployment-control/leases",
        controllerPost(token, PROVENANCE),
      );
      expect({ label, status: response.status }).toEqual({ label, status: 401 });
      expect({ label, leases: await db.select().from(schema.deploymentAdmissionLeases) })
        .toEqual({ label, leases: [] });
    }
  });

  test("validates provenance before creating a lease and exposes the durable active set", async () => {
    process.env.JWT_SECRET = "deployment-admission-test-secret";
    const db = await setupTestDB();
    const gameId = await insertWaitingGame(db);
    await db.update(schema.games).set({ status: "in_progress" })
      .where(eq(schema.games.id, gameId));
    const app = new Hono();
    app.route("/", createDeploymentControlRoutes(db));
    const shortToken = await createDeploymentControlToken("4h");

    const tooShort = await app.request("/api/internal/deployment-control/leases", controllerPost(shortToken, PROVENANCE));
    expect(tooShort.status).toBe(401);
    expect(await tooShort.json()).toMatchObject({ code: "controller_token_lifetime_insufficient" });
    expect(await db.select().from(schema.deploymentAdmissionLeases)).toHaveLength(0);

    const token = await createDeploymentControlToken("6h");
    const invalid = await app.request("/api/internal/deployment-control/leases", controllerPost(token, {
      ...PROVENANCE,
      actor: "operator\nmarkdown",
    }));
    expect(invalid.status).toBe(400);
    expect(await db.select().from(schema.deploymentAdmissionLeases)).toHaveLength(0);

    const created = await app.request("/api/internal/deployment-control/leases", controllerPost(token, PROVENANCE));
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { lease: { id: string; fencingToken: number } };
    const lease = createdBody.lease;
    expect(lease.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(lease.fencingToken).toBe(1);

    const status = await app.request("/api/internal/deployment-control/status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await status.json()).toMatchObject({
      admissionBlocked: true,
      activeGameCount: 1,
      activeGames: [expect.objectContaining({ id: gameId })],
    });
  });

  test("release is fenced, audited, and cannot clear a newer lease", async () => {
    process.env.JWT_SECRET = "deployment-admission-test-secret";
    const db = await setupTestDB();
    const app = new Hono();
    app.route("/", createDeploymentControlRoutes(db));
    const token = await createDeploymentControlToken("6h");
    const created = await app.request("/api/internal/deployment-control/leases", controllerPost(token, PROVENANCE));
    const createdBody = await created.json() as { lease: { id: string; fencingToken: number } };
    const lease = createdBody.lease;

    const stale = await app.request(
      `/api/internal/deployment-control/leases/${lease.id}/release`,
      controllerPost(token, { fencingToken: lease.fencingToken + 1, reason: "stale release" }),
    );
    expect(stale.status).toBe(409);
    expect((await getDeploymentAdmissionStatus(db)).admissionBlocked).toBeTrue();

    const released = await app.request(
      `/api/internal/deployment-control/leases/${lease.id}/release`,
      controllerPost(token, { fencingToken: lease.fencingToken, reason: "candidate canceled" }),
    );
    expect(released.status).toBe(200);
    expect((await getDeploymentAdmissionStatus(db)).admissionBlocked).toBeFalse();
    expect((await db.select().from(schema.deploymentAdmissionLeases))[0]).toMatchObject({
      status: "aborted",
      completionReason: "candidate canceled",
    });
    expect((await db.select().from(schema.deploymentRecoveryReconciliations))[0]).toMatchObject({
      leaseId: lease.id,
      status: "pending",
      attempts: 0,
    });
  });
});

describe("terminal deployment recovery reconciliation", () => {
  test("uses one DB-backed claim and records success only while admission stays open", async () => {
    const db = await setupTestDB();
    const acquired = await acquireDeploymentAdmissionLease(db, PROVENANCE);
    if (!acquired.ok) throw new Error(acquired.error);
    const released = await completeDeploymentAdmissionLease(db, {
      leaseId: acquired.lease.id,
      fencingToken: acquired.lease.fencingToken,
      outcome: "aborted",
      reason: "controller aborted candidate validation",
    });
    expect(released.ok).toBeTrue();

    let calls = 0;
    let releaseRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    const recover = async () => {
      calls += 1;
      await recoveryGate;
      return { attempted: 1, recovered: 1, skipped: [] };
    };
    const first = runPendingDeploymentRecoveryReconciliation(db, recover);
    while (calls === 0) await Bun.sleep(1);
    const second = await runPendingDeploymentRecoveryReconciliation(db, recover);
    expect(second).toEqual({ outcome: "idle" });
    releaseRecovery();
    expect(await first).toMatchObject({ outcome: "succeeded", leaseId: acquired.lease.id });
    expect(calls).toBe(1);
    expect((await db.select().from(schema.deploymentRecoveryReconciliations))[0]).toMatchObject({
      status: "succeeded",
      attempts: 1,
      claimToken: null,
      claimExpiresAt: null,
      lastError: null,
    });
  });

  test("defers pending recovery during a newer drain and retries after recovery failure", async () => {
    const db = await setupTestDB();
    const firstLease = await acquireDeploymentAdmissionLease(db, PROVENANCE);
    if (!firstLease.ok) throw new Error(firstLease.error);
    await completeDeploymentAdmissionLease(db, {
      leaseId: firstLease.lease.id,
      fencingToken: firstLease.lease.fencingToken,
      outcome: "aborted",
      reason: "candidate controller aborted",
    });
    const newer = await acquireDeploymentAdmissionLease(db, { ...PROVENANCE, workflowRunId: 124 });
    if (!newer.ok) throw new Error(newer.error);
    let calls = 0;
    expect(await runPendingDeploymentRecoveryReconciliation(db, async () => {
      calls += 1;
      return { attempted: 0, recovered: 0, skipped: [] };
    })).toEqual({ outcome: "deferred" });
    expect(calls).toBe(0);
    await completeDeploymentAdmissionLease(db, {
      leaseId: newer.lease.id,
      fencingToken: newer.lease.fencingToken,
      outcome: "aborted",
      reason: "newer candidate controller aborted",
    });

    const failed = await runPendingDeploymentRecoveryReconciliation(db, async () => {
      calls += 1;
      throw new Error("transient recovery failure");
    });
    expect(failed).toMatchObject({ outcome: "retry", error: "transient recovery failure" });
    expect((await db.select().from(schema.deploymentRecoveryReconciliations)
      .where(eq(schema.deploymentRecoveryReconciliations.leaseId, firstLease.lease.id)))[0])
      .toMatchObject({ status: "pending", attempts: 1, lastError: "transient recovery failure" });
  });
});

async function insertWaitingGame(db: DrizzleDB): Promise<string> {
  const gameId = randomUUID();
  await db.insert(schema.games).values({
    id: gameId,
    slug: `admission-${gameId}`,
    config: JSON.stringify({
      modelSelection: { catalogId: "openai:gpt-5.6-luna", reasoningPolicy: "action-policy" },
    }),
    status: "waiting",
    minPlayers: 6,
    maxPlayers: 6,
  });
  await db.insert(schema.gamePlayers).values(
    Array.from({ length: 6 }, (_, index) => ({
      id: randomUUID(),
      gameId,
      persona: JSON.stringify({ name: `House ${index}`, personality: "Test" }),
      agentConfig: JSON.stringify({ model: "mock", temperature: 0 }),
    })),
  );
  return gameId;
}

async function gameStatus(db: DrizzleDB, gameId: string): Promise<string | undefined> {
  return (await db.select({ status: schema.games.status }).from(schema.games)
    .where(eq(schema.games.id, gameId)))[0]?.status;
}

async function expireLease(db: DrizzleDB, leaseId: string): Promise<void> {
  await db.execute(sql`
    UPDATE deployment_admission_leases
    SET
      expires_at = (clock_timestamp() - interval '1 second')::text,
      absolute_deadline_at = (clock_timestamp() - interval '1 second')::text
    WHERE id = ${leaseId}
  `);
}

function controllerPost(token: string, body: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

async function controllerTokenFixture(
  secret: string,
  overrides: {
    tokenType?: string;
    audience?: string;
    subject?: string;
    permission?: string;
    signingSecret?: string;
    expiresAt?: number;
  },
): Promise<string> {
  return new SignJWT({
    token_type: overrides.tokenType ?? "service",
    perms: [overrides.permission ?? "manage_deployment_admission"],
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(overrides.expiresAt ?? Math.floor(Date.now() / 1000) + 6 * 60 * 60)
    .setIssuer("influence-api")
    .setAudience(overrides.audience ?? "influence-deployment-control")
    .setSubject(overrides.subject ?? "influence-release-controller")
    .sign(new TextEncoder().encode(overrides.signingSecret ?? secret));
}
