import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { createDeploymentControlToken } from "../middleware/auth.js";
import { createDeploymentControlRoutes } from "../routes/deployment-control.js";
import { createPostgameMediaWorkerRoutes } from "../routes/postgame-media-worker.js";
import {
  acquireDeploymentAdmissionLease,
  advanceDeploymentAdmissionPhase,
  revokeDeploymentAdmissionLease,
  validateDeploymentAdmissionActivationFence,
} from "../services/deployment-admission.js";
import {
  createRuntimeActivationController,
  readRuntimeStartupMode,
} from "../services/runtime-activation.js";
import { setupTestDB } from "./test-utils.js";

const PROVENANCE = {
  candidateSha: "6".repeat(40),
  sourceRepository: "0xFlicker/linode-iac",
  workflowRunId: 991,
  workflowRunAttempt: 2,
  actor: "release-operator",
};
const ACCEPTED_IDENTITY = {
  candidateSha: PROVENANCE.candidateSha,
  apiDigest: `sha256:${"a".repeat(64)}`,
  migrationSet: `sha256:${"b".repeat(64)}`,
};

describe("runtime startup mode", () => {
  test("defaults to active and fails fast on unsupported modes", () => {
    expect(readRuntimeStartupMode({})).toBe("active");
    expect(readRuntimeStartupMode({ INFLUENCE_API_STARTUP_MODE: "validation" })).toBe("validation");
    expect(() => readRuntimeStartupMode({ INFLUENCE_API_STARTUP_MODE: "passive" }))
      .toThrow("INFLUENCE_API_STARTUP_MODE must be active or validation");
  });

  test("validation mode serves without starting background runtime or render claims", async () => {
    let starts = 0;
    const runtime = createRuntimeActivationController({
      mode: "validation",
      validateFence: async () => ({ ok: true }),
      startRuntime: async () => { starts += 1; },
    });

    await runtime.initialize();

    expect(starts).toBe(0);
    expect(runtime.canClaimWork()).toBeFalse();
    expect(runtime.getStatus()).toEqual({
      protocolVersion: 1,
      startupMode: "validation",
      runtimeState: "validation",
      activatedLeaseId: null,
    });

    const previousWorkerToken = process.env.POSTGAME_MEDIA_WORKER_TOKEN;
    process.env.POSTGAME_MEDIA_WORKER_TOKEN = "validation-worker-token";
    try {
      const app = new Hono();
      app.route("/", createPostgameMediaWorkerRoutes({} as DrizzleDB, {
        canClaimWork: () => runtime.canClaimWork(),
      }));
      const response = await app.request("/api/internal/postgame-media/claim", {
        method: "POST",
        headers: { Authorization: "Bearer validation-worker-token" },
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "runtime_not_active" });
    } finally {
      if (previousWorkerToken === undefined) delete process.env.POSTGAME_MEDIA_WORKER_TOKEN;
      else process.env.POSTGAME_MEDIA_WORKER_TOKEN = previousWorkerToken;
    }
  });

  test("active mode initializes once and permits background claims", async () => {
    let starts = 0;
    const runtime = createRuntimeActivationController({
      mode: "active",
      validateFence: async () => ({ ok: true }),
      startRuntime: async () => { starts += 1; },
    });

    await Promise.all([runtime.initialize(), runtime.initialize()]);

    expect(starts).toBe(1);
    expect(runtime.canClaimWork()).toBeTrue();
    expect(runtime.getStatus().runtimeState).toBe("active");
  });
});

describe("fence-aware runtime activation", () => {
  test("stale and revoked fences cannot activate candidate-owned background work", async () => {
    const db = await setupTestDB();
    const acquired = await acquireDeploymentAdmissionLease(db, PROVENANCE);
    if (!acquired.ok) throw new Error(acquired.error);
    let starts = 0;
    const runtime = createRuntimeActivationController({
      mode: "validation",
      validateFence: (fence) => validateDeploymentAdmissionActivationFence(db, fence),
      startRuntime: async () => { starts += 1; },
    });
    await runtime.initialize();

    const stale = await runtime.activate({
      leaseId: acquired.lease.id,
      fencingToken: acquired.lease.fencingToken + 1,
    });
    expect(stale).toMatchObject({ ok: false, code: "stale_lease" });

    const revoked = await revokeDeploymentAdmissionLease(db, {
      leaseId: acquired.lease.id,
      expectedRevision: acquired.lease.revision,
      revokedBy: "operator-id",
      reason: "candidate validation canceled",
    });
    expect(revoked.ok).toBeTrue();
    const afterRevoke = await runtime.activate({
      leaseId: acquired.lease.id,
      fencingToken: acquired.lease.fencingToken,
    });
    expect(afterRevoke).toMatchObject({ ok: false, code: "lease_expired" });
    expect(starts).toBe(0);
    expect(runtime.canClaimWork()).toBeFalse();
  });

  test("controller-authenticated activation is idempotent only for the accepted fence", async () => {
    process.env.JWT_SECRET = "runtime-activation-test-secret";
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
    const switching = await advanceDeploymentAdmissionPhase(db, {
      leaseId: acquired.lease.id,
      fencingToken: acquired.lease.fencingToken,
      expectedPhase: "validating",
      nextPhase: "switching",
    });
    expect(switching.ok).toBeTrue();
    const accepting = await advanceDeploymentAdmissionPhase(db, {
      leaseId: acquired.lease.id,
      fencingToken: acquired.lease.fencingToken,
      expectedPhase: "switching",
      nextPhase: "accepting",
    });
    expect(accepting.ok).toBeTrue();

    let starts = 0;
    const runtime = createRuntimeActivationController({
      mode: "validation",
      validateFence: (fence) => validateDeploymentAdmissionActivationFence(db, fence),
      startRuntime: async () => { starts += 1; },
    });
    await runtime.initialize();
    const app = new Hono();
    app.route("/", createDeploymentControlRoutes(db, { runtimeActivation: runtime }));
    const token = await createDeploymentControlToken("6h");
    const endpoint = `/api/internal/deployment-control/leases/${acquired.lease.id}/activate`;
    const body = { fencingToken: acquired.lease.fencingToken };

    expect((await app.request(endpoint, postJson(body))).status).toBe(401);
    const first = await app.request(endpoint, postJson(body, token));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({
      outcome: "activated",
      releaseControl: {
        protocolVersion: 1,
        startupMode: "validation",
        runtimeState: "standby",
        activatedLeaseId: acquired.lease.id,
      },
    });
    expect(JSON.stringify(firstBody)).not.toContain("fencingToken");

    const repeated = await app.request(endpoint, postJson(body, token));
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ outcome: "already_active" });
    const different = await runtime.activate({
      leaseId: "11111111-1111-4111-8111-111111111111",
      fencingToken: acquired.lease.fencingToken + 1,
    });
    expect(different).toMatchObject({
      ok: false,
      code: "runtime_activation_fence_conflict",
    });
    expect(starts).toBe(0);
    expect(runtime.canClaimWork()).toBeFalse();

    const accept = await app.request(
      `/api/internal/deployment-control/leases/${acquired.lease.id}/accept`,
      postJson({ fencingToken: acquired.lease.fencingToken, ...ACCEPTED_IDENTITY }, token),
    );
    expect(accept.status).toBe(200);
    expect(await accept.json()).toMatchObject({
      outcome: "accepted",
      releaseControl: { runtimeState: "active" },
    });
    expect(starts).toBe(1);
    expect(runtime.canClaimWork()).toBeTrue();
  });

  test("a failed initializer leaves validation closed and retryable", async () => {
    const fence = {
      leaseId: "11111111-1111-4111-8111-111111111111",
      fencingToken: 4,
    };
    let attempts = 0;
    const runtime = createRuntimeActivationController({
      mode: "validation",
      validateFence: async () => ({ ok: true }),
      startRuntime: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("startup recovery failed");
      },
      logger: { error() {} },
    });
    await runtime.initialize();

    expect(await runtime.activate(fence)).toMatchObject({ ok: true, outcome: "activated" });
    expect(await runtime.accept(fence, ACCEPTED_IDENTITY)).toMatchObject({
      ok: false,
      code: "runtime_activation_failed",
      retryable: true,
    });
    expect(runtime.getStatus().runtimeState).toBe("standby");
    expect(runtime.canClaimWork()).toBeFalse();
    expect(await runtime.accept(fence, ACCEPTED_IDENTITY)).toMatchObject({ ok: true, outcome: "accepted" });
    expect(attempts).toBe(2);
  });

  test("explicit restoration abort cancels an in-flight accepted startup before claims open", async () => {
    const fence = {
      leaseId: "11111111-1111-4111-8111-111111111111",
      fencingToken: 4,
    };
    let observedAbort = false;
    let signalRuntimeStarted!: () => void;
    const runtimeStarted = new Promise<void>((resolve) => { signalRuntimeStarted = resolve; });
    const runtime = createRuntimeActivationController({
      mode: "validation",
      validateFence: async () => ({ ok: true }),
      startRuntime: ({ signal }) => new Promise((resolve, reject) => {
        signalRuntimeStarted();
        signal.addEventListener("abort", () => {
          observedAbort = true;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }),
      logger: { error() {} },
    });
    expect(await runtime.activate(fence)).toMatchObject({ ok: true, outcome: "activated" });
    const accepting = runtime.accept(fence, ACCEPTED_IDENTITY);
    await runtimeStarted;
    const aborted = await runtime.abort(fence);

    expect(await accepting).toMatchObject({ ok: false, code: "runtime_activation_aborted" });
    expect(aborted).toMatchObject({ ok: true, outcome: "aborted" });
    expect(observedAbort).toBeTrue();
    expect(runtime.getStatus().runtimeState).toBe("validation");
    expect(runtime.canClaimWork()).toBeFalse();
  });

  test("restoration abort is idempotent before activation starts", async () => {
    const runtime = createRuntimeActivationController({
      mode: "validation",
      validateFence: async () => ({ ok: true }),
      startRuntime: () => undefined,
    });
    await runtime.initialize();

    expect(await runtime.abort({
      leaseId: "11111111-1111-4111-8111-111111111111",
      fencingToken: 4,
    })).toMatchObject({ ok: true, outcome: "aborted" });
    expect(runtime.getStatus().runtimeState).toBe("validation");
  });

  test("concurrent activation is single-flight for one fence and rejects substitution", async () => {
    const fence = {
      leaseId: "11111111-1111-4111-8111-111111111111",
      fencingToken: 4,
    };
    let releaseValidation!: () => void;
    const validation = new Promise<void>((resolve) => { releaseValidation = resolve; });
    let validations = 0;
    const runtime = createRuntimeActivationController({
      mode: "validation",
      validateFence: async () => {
        validations += 1;
        await validation;
        return { ok: true };
      },
      startRuntime: () => undefined,
    });

    const first = runtime.activate(fence);
    const repeated = runtime.activate(fence);
    expect(await runtime.activate({ ...fence, fencingToken: 5 })).toMatchObject({
      ok: false,
      code: "runtime_activation_fence_conflict",
    });
    releaseValidation();

    expect(await first).toMatchObject({ ok: true, outcome: "activated" });
    expect(await repeated).toMatchObject({ ok: true, outcome: "activated" });
    expect(validations).toBe(1);
  });
});

function postJson(body: Record<string, unknown>, token?: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  };
}
