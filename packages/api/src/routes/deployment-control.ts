import { Hono, type Context } from "hono";
import type { DrizzleDB } from "../db/index.js";
import type { DeploymentAdmissionPhase } from "../db/schema.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import {
  MIN_DEPLOYMENT_CONTROL_LEASE_TOKEN_SECONDS,
  requireDeploymentControlAuth,
  type DeploymentControlAuthEnv,
} from "../middleware/auth.js";
import {
  acquireDeploymentAdmissionLease,
  advanceDeploymentAdmissionPhase,
  completeDeploymentAdmissionLease,
  getDeploymentAdmissionStatus,
  heartbeatDeploymentAdmissionLease,
  type DeploymentAdmissionErrorCode,
} from "../services/deployment-admission.js";
import type { GameWorkerDrainStatus } from "../services/game-execution-worker.js";
import type { RuntimeActivationController } from "../services/runtime-activation.js";

const PHASES = new Set<DeploymentAdmissionPhase>([
  "draining",
  "validating",
  "switching",
  "accepting",
  "restoring",
]);

export function createDeploymentControlRoutes(
  db: DrizzleDB,
  options: {
    runtimeActivation?: RuntimeActivationController;
    gameWorkerDrainStatus?: () => GameWorkerDrainStatus | null;
  } = {},
) {
  const app = new Hono<DeploymentControlAuthEnv>();
  app.use("/api/internal/deployment-control/*", requireDeploymentControlAuth());

  app.post("/api/internal/deployment-control/leases", async (c) => {
    const controller = c.get("deploymentController");
    if (controller.expiresAt < Math.floor(Date.now() / 1000) + MIN_DEPLOYMENT_CONTROL_LEASE_TOKEN_SECONDS) {
      return c.json({
        error: "Deployment controller token expires before the absolute release recovery window",
        code: "controller_token_lifetime_insufficient",
        retryable: false,
      }, 401);
    }
    const body = recordOrNull(await parseJsonBody(c, "POST /api/internal/deployment-control/leases"));
    const candidateSha = stringValue(body?.candidateSha);
    const sourceRepository = stringValue(body?.sourceRepository);
    const workflowRunId = positiveInteger(body?.workflowRunId);
    const workflowRunAttempt = positiveInteger(body?.workflowRunAttempt);
    const actor = stringValue(body?.actor);
    if (!candidateSha || !sourceRepository || !workflowRunId || !workflowRunAttempt || !actor) {
      return c.json({ error: "Exact candidate and GitHub workflow provenance are required" }, 400);
    }
    const result = await acquireDeploymentAdmissionLease(db, {
      candidateSha,
      sourceRepository,
      workflowRunId,
      workflowRunAttempt,
      actor,
    });
    return result.ok
      ? c.json({ lease: result.lease }, 201)
      : c.json({ error: result.error, code: result.code, retryable: result.retryable }, errorStatus(result.code));
  });

  app.get("/api/internal/deployment-control/status", async (c) => {
    try {
      return c.json(await getDeploymentAdmissionStatus(db));
    } catch {
      return c.json({
        error: "Deployment admission state is temporarily unavailable",
        code: "deployment_admission_unavailable",
        retryable: true,
      }, 503);
    }
  });

  app.get("/api/internal/deployment-control/game-worker-drain-status", (c) => {
    const status = options.gameWorkerDrainStatus?.() ?? null;
    if (!status) {
      return c.json({
        error: "This API runtime is not an active game worker",
        code: "game_worker_not_running",
        retryable: false,
      }, 409);
    }
    return c.json(status);
  });

  app.post("/api/internal/deployment-control/leases/:leaseId/heartbeat", async (c) => {
    const fence = await parseFence(c, "heartbeat");
    if (!fence) return c.json({ error: "A valid lease ID and fencing token are required" }, 400);
    const result = await heartbeatDeploymentAdmissionLease(db, fence);
    return result.ok
      ? c.json({ lease: result.lease })
      : c.json({ error: result.error, code: result.code, retryable: result.retryable }, errorStatus(result.code));
  });

  app.post("/api/internal/deployment-control/leases/:leaseId/phase", async (c) => {
    const body = recordOrNull(await parseJsonBody(c, "POST /api/internal/deployment-control/leases/:leaseId/phase"));
    const fencingToken = positiveInteger(body?.fencingToken);
    const expectedPhase = phaseValue(body?.expectedPhase);
    const nextPhase = phaseValue(body?.nextPhase);
    if (!validUuid(c.req.param("leaseId")) || !fencingToken || !expectedPhase || !nextPhase) {
      return c.json({ error: "A valid fence and phase transition are required" }, 400);
    }
    const result = await advanceDeploymentAdmissionPhase(db, {
      leaseId: c.req.param("leaseId"),
      fencingToken,
      expectedPhase,
      nextPhase,
    });
    return result.ok
      ? c.json({ lease: result.lease })
      : c.json({ error: result.error, code: result.code, retryable: result.retryable }, errorStatus(result.code));
  });

  if (options.runtimeActivation) {
    app.post("/api/internal/deployment-control/leases/:leaseId/activate", async (c) => {
      const fence = await parseFence(c, "activate");
      if (!fence) return c.json({ error: "A valid lease ID and fencing token are required" }, 400);
      const result = await options.runtimeActivation!.activate(fence);
      if (!result.ok) {
        return c.json(
          { error: result.error, code: result.code, retryable: result.retryable },
          activationErrorStatus(result.code),
        );
      }
      return c.json({
        outcome: result.outcome,
        releaseControl: result.releaseControl,
      });
    });

    app.post("/api/internal/deployment-control/leases/:leaseId/accept", async (c) => {
      const body = recordOrNull(await parseJsonBody(c, "POST deployment-control accept"));
      const fence = fenceFromBody(c.req.param("leaseId"), body);
      const candidateSha = stringValue(body?.candidateSha);
      const apiDigest = stringValue(body?.apiDigest);
      const migrationSet = stringValue(body?.migrationSet);
      if (!fence || !candidateSha || !apiDigest || !migrationSet) {
        return c.json({ error: "A valid fence and exact accepted runtime identity are required" }, 400);
      }
      const result = await options.runtimeActivation!.accept(fence, {
        candidateSha,
        apiDigest,
        migrationSet,
      });
      return result.ok
        ? c.json({ outcome: result.outcome, releaseControl: result.releaseControl })
        : c.json(
            { error: result.error, code: result.code, retryable: result.retryable },
            activationErrorStatus(result.code),
          );
    });

    app.post("/api/internal/deployment-control/leases/:leaseId/abort-activation", async (c) => {
      const fence = await parseFence(c, "abort activation");
      if (!fence) return c.json({ error: "A valid lease ID and fencing token are required" }, 400);
      const result = await options.runtimeActivation!.abort(fence);
      return result.ok
        ? c.json({ outcome: result.outcome, releaseControl: result.releaseControl })
        : c.json(
            { error: result.error, code: result.code, retryable: result.retryable },
            activationErrorStatus(result.code),
          );
    });
  }

  app.post("/api/internal/deployment-control/leases/:leaseId/complete", async (c) => {
    const body = recordOrNull(await parseJsonBody(c, "POST /api/internal/deployment-control/leases/:leaseId/complete"));
    const fencingToken = positiveInteger(body?.fencingToken);
    const outcome = completionOutcome(body?.outcome);
    const reason = stringValue(body?.reason);
    if (!validUuid(c.req.param("leaseId")) || !fencingToken || !outcome || !reason) {
      return c.json({ error: "A valid fence, completion outcome, and reason are required" }, 400);
    }
    const result = await completeDeploymentAdmissionLease(db, {
      leaseId: c.req.param("leaseId"),
      fencingToken,
      outcome,
      reason,
    });
    return result.ok
      ? c.json({ lease: result.lease })
      : c.json({ error: result.error, code: result.code, retryable: result.retryable }, errorStatus(result.code));
  });

  app.post("/api/internal/deployment-control/leases/:leaseId/release", async (c) => {
    const body = recordOrNull(await parseJsonBody(c, "POST /api/internal/deployment-control/leases/:leaseId/release"));
    const fencingToken = positiveInteger(body?.fencingToken);
    const reason = stringValue(body?.reason);
    if (!validUuid(c.req.param("leaseId")) || !fencingToken || !reason) {
      return c.json({ error: "A valid fence and release reason are required" }, 400);
    }
    const result = await completeDeploymentAdmissionLease(db, {
      leaseId: c.req.param("leaseId"),
      fencingToken,
      outcome: "aborted",
      reason,
    });
    return result.ok
      ? c.json({ lease: result.lease })
      : c.json({ error: result.error, code: result.code, retryable: result.retryable }, errorStatus(result.code));
  });

  return app;
}

async function parseFence(
  c: Context<DeploymentControlAuthEnv>,
  action: string,
): Promise<{ leaseId: string; fencingToken: number } | null> {
  const body = recordOrNull(await parseJsonBody(c, `POST deployment-control ${action}`));
  return fenceFromBody(c.req.param("leaseId"), body);
}

function fenceFromBody(
  leaseId: string | undefined,
  body: Record<string, unknown> | null,
): { leaseId: string; fencingToken: number } | null {
  const fencingToken = positiveInteger(body?.fencingToken);
  return leaseId && validUuid(leaseId) && fencingToken ? { leaseId, fencingToken } : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function phaseValue(value: unknown): DeploymentAdmissionPhase | null {
  return typeof value === "string" && PHASES.has(value as DeploymentAdmissionPhase)
    ? value as DeploymentAdmissionPhase
    : null;
}

function completionOutcome(value: unknown): "accepted" | "restored" | "aborted" | null {
  return value === "accepted" || value === "restored" || value === "aborted" ? value : null;
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function errorStatus(code: DeploymentAdmissionErrorCode): 400 | 409 | 503 {
  if (code === "invalid_provenance" || code === "invalid_transition") return 400;
  if (code === "deployment_admission_unavailable") return 503;
  return 409;
}

function activationErrorStatus(code: string): 409 | 503 {
  return code === "deployment_admission_unavailable" || code === "runtime_activation_failed"
    ? 503
    : 409;
}
