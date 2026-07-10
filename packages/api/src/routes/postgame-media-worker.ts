import { Hono } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { claimPostgameMedia, failPostgameMediaAttempt, finalizePostgameMedia, heartbeatPostgameMedia, reportPostgameMediaProgress } from "../services/postgame-media-worker.js";
import { isAuthorizedPostgameMediaWorker, workerTokenFromAuthorization } from "../services/postgame-media-worker-auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import {
  issuePostgameMediaUploadTargets,
  postgameMediaPublicArtifactLocations,
  postgameMediaPublicStorageIdentity,
  verifyPostgameMediaArtifacts,
  type PostgameMediaUploadDeclaration,
} from "../services/postgame-media-uploads.js";

export function createPostgameMediaWorkerRoutes(db: DrizzleDB) {
  const app = new Hono();

  app.use("/api/internal/postgame-media/*", async (c, next) => {
    if (!isAuthorizedPostgameMediaWorker(c.req.header("Authorization"))) {
      return c.json({ error: "Worker authentication required" }, 401);
    }
    await next();
  });

  app.post("/api/internal/postgame-media/claim", async (c) => {
    const workerToken = workerTokenFromAuthorization(c.req.header("Authorization"));
    if (!workerToken) return c.json({ error: "Worker authentication required" }, 401);
    let storage: ReturnType<typeof postgameMediaPublicStorageIdentity>;
    try {
      storage = postgameMediaPublicStorageIdentity();
    } catch {
      return c.json({ error: "Public media storage is not configured" }, 503);
    }
    const publicBaseUrl = postgameMediaPublicBaseUrl(c.req.url);
    const claim = await claimPostgameMedia(db, workerToken);
    if (!claim) return c.json({ claim: null });
    return c.json({
      claim: {
        ...claim,
        publicArtifacts: postgameMediaPublicArtifactLocations(
          claim.gameId,
          claim.artifactVersion,
          publicBaseUrl,
        ),
        storage,
      },
    });
  });

  app.post("/api/internal/postgame-media/:gameId/heartbeat", async (c) => {
    const body = await parseLeaseBody(c, "POST /api/internal/postgame-media/:gameId/heartbeat");
    if (!body) return c.json({ error: "gameId, attemptNumber, and leaseToken are required" }, 400);
    const ok = await heartbeatPostgameMedia(db, { ...body, gameId: c.req.param("gameId") });
    return ok ? c.json({ ok: true }) : c.json({ error: "Stale or invalid lease" }, 409);
  });

  app.post("/api/internal/postgame-media/:gameId/progress", async (c) => {
    const body = await parseLeaseBody(c, "POST /api/internal/postgame-media/:gameId/progress");
    const status = body && typeof body.raw.status === "string" ? body.raw.status : null;
    if (!body || !isProgressStatus(status)) {
      return c.json({ error: "attemptNumber, leaseToken, and a valid progress status are required" }, 400);
    }
    const diagnostics = recordOrUndefined(body.raw.diagnostics);
    const ok = await reportPostgameMediaProgress(db, {
      gameId: c.req.param("gameId"),
      attemptNumber: body.attemptNumber,
      leaseToken: body.leaseToken,
      status,
      ...(diagnostics ? { diagnostics } : {}),
    });
    return ok ? c.json({ ok: true }) : c.json({ error: "Stale or invalid lease" }, 409);
  });

  app.post("/api/internal/postgame-media/:gameId/failure", async (c) => {
    const body = await parseLeaseBody(c, "POST /api/internal/postgame-media/:gameId/failure");
    if (!body || typeof body.raw.category !== "string" || typeof body.raw.message !== "string") {
      return c.json({ error: "attemptNumber, leaseToken, category, and message are required" }, 400);
    }
    const diagnostics = recordOrUndefined(body.raw.diagnostics);
    const ok = await failPostgameMediaAttempt(db, {
      gameId: c.req.param("gameId"),
      attemptNumber: body.attemptNumber,
      leaseToken: body.leaseToken,
      category: body.raw.category,
      message: body.raw.message,
      ...(diagnostics ? { diagnostics } : {}),
    });
    return ok ? c.json({ ok: true }) : c.json({ error: "Stale or invalid lease" }, 409);
  });

  app.post("/api/internal/postgame-media/:gameId/upload-targets", async (c) => {
    const body = await parseLeaseBody(c, "POST /api/internal/postgame-media/:gameId/upload-targets");
    const declarations = body ? parseUploadDeclarations(body.raw.artifacts) : null;
    if (!body || !declarations) {
      return c.json({ error: "attemptNumber, leaseToken, and all four artifact declarations are required" }, 400);
    }
    const result = await issuePostgameMediaUploadTargets(db, {
      gameId: c.req.param("gameId"),
      attemptNumber: body.attemptNumber,
      leaseToken: body.leaseToken,
      declarations,
      uploadBaseUrl: new URL(c.req.url).origin,
      publicBaseUrl: postgameMediaPublicBaseUrl(c.req.url),
    });
    if (!result.ok) {
      const status = result.error === "invalid_artifacts" ? 400 : 409;
      return c.json({ error: result.error }, status);
    }
    return c.json({
      targets: result.targets.map((target) => ({
        targetId: target.targetId,
        artifact: target.artifact,
        filename: target.filename,
        objectKey: target.key,
        publicUrl: target.publicUrl,
        contentType: target.contentType,
        byteLength: target.byteLength,
        sha256: target.sha256,
        uploadUrl: target.uploadUrl,
        uploadHeaders: target.uploadHeaders,
      })),
    });
  });

  app.post("/api/internal/postgame-media/:gameId/finalize", async (c) => {
    const body = await parseLeaseBody(c, "POST /api/internal/postgame-media/:gameId/finalize");
    if (!body || !isFinalizeBody(body.raw)) {
      return c.json({ error: "A complete finalize payload is required" }, 400);
    }
    const result = await finalizePostgameMedia(db, {
      gameId: c.req.param("gameId"),
      attemptNumber: body.attemptNumber,
      leaseToken: body.leaseToken,
      renderDurationMs: body.raw.renderDurationMs,
      renderInputSnapshotHash: body.raw.renderInputSnapshotHash,
      renderInputSnapshotVersion: body.raw.renderInputSnapshotVersion,
      rendererVersion: body.raw.rendererVersion,
      timingContractVersion: body.raw.timingContractVersion,
      musicAssetId: body.raw.musicAssetId,
      artifacts: body.raw.artifacts,
      ...(recordOrUndefined(body.raw.cueMetadata) ? { cueMetadata: recordOrUndefined(body.raw.cueMetadata)! } : {}),
      ...(recordOrUndefined(body.raw.diagnostics) ? { diagnostics: recordOrUndefined(body.raw.diagnostics)! } : {}),
    }, {
      artifactVerifier: (context) => verifyPostgameMediaArtifacts(db, context),
    });
    return result.ok ? c.json(result) : c.json(result, 409);
  });

  return app;
}

export function postgameMediaPublicBaseUrl(
  requestUrl: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.POSTGAME_MEDIA_PUBLIC_BASE_URL?.trim();
  if (!configured) return new URL(requestUrl).origin;
  const url = new URL(configured);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error("POSTGAME_MEDIA_PUBLIC_BASE_URL must be an HTTP(S) origin");
  }
  return url.origin;
}

function parseUploadDeclarations(value: unknown): PostgameMediaUploadDeclaration[] | null {
  if (!Array.isArray(value)) return null;
  const declarations: PostgameMediaUploadDeclaration[] = [];
  for (const entry of value) {
    if (
      entry === null
      || typeof entry !== "object"
      || Array.isArray(entry)
      || !("artifact" in entry)
      || !("contentType" in entry)
      || !("byteLength" in entry)
      || !("sha256" in entry)
      || !isArtifactKind(entry.artifact)
      || typeof entry.contentType !== "string"
      || typeof entry.byteLength !== "number"
      || !Number.isSafeInteger(entry.byteLength)
      || typeof entry.sha256 !== "string"
    ) return null;
    declarations.push({
      artifact: entry.artifact,
      contentType: entry.contentType,
      byteLength: entry.byteLength,
      sha256: entry.sha256,
    });
  }
  return declarations;
}

function isArtifactKind(value: unknown): value is PostgameMediaUploadDeclaration["artifact"] {
  return value === "video" || value === "poster" || value === "captions" || value === "metadata";
}

async function parseLeaseBody(c: Parameters<typeof parseJsonBody>[0], label: string) {
  const raw = await parseJsonBody(c, label);
  if (!raw || !Number.isInteger(raw.attemptNumber) || raw.attemptNumber <= 0 || typeof raw.leaseToken !== "string" || !raw.leaseToken) {
    return null;
  }
  return { raw, attemptNumber: raw.attemptNumber, leaseToken: raw.leaseToken };
}

function isProgressStatus(value: string | null): value is "rendering" | "composing" | "uploading" | "waiting_music" {
  return value === "rendering" || value === "composing" || value === "uploading" || value === "waiting_music";
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isFinalizeBody(value: Record<string, unknown>): value is Record<string, unknown> & {
  renderDurationMs: number;
  renderInputSnapshotHash: string;
  renderInputSnapshotVersion: number;
  rendererVersion: string;
  timingContractVersion: string;
  musicAssetId: string;
  artifacts: Parameters<typeof finalizePostgameMedia>[1]["artifacts"];
} {
  return Number.isInteger(value.renderDurationMs)
    && typeof value.renderInputSnapshotHash === "string"
    && Number.isInteger(value.renderInputSnapshotVersion)
    && typeof value.rendererVersion === "string"
    && typeof value.timingContractVersion === "string"
    && typeof value.musicAssetId === "string"
    && value.artifacts !== null
    && typeof value.artifacts === "object"
    && !Array.isArray(value.artifacts);
}
