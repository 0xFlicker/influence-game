import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { hashHouseHighlightsTrailerManifest, type HouseHighlightsTrailerManifest } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { createPostgameMediaWorkerRoutes } from "../routes/postgame-media-worker.js";
import { createUploadRoutes } from "../routes/upload.js";
import { getAdminPostgameMedia, getPublicPostgameMedia } from "../services/postgame-media.js";
import { reconcilePostgameMediaForGame, requestPostgameMedia } from "../services/postgame-media-coordinator.js";
import { claimPostgameMedia, finalizePostgameMedia, heartbeatPostgameMedia } from "../services/postgame-media-worker.js";
import { insertGame } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

describe("postgame media worker routes and leases", () => {
  let db: DrizzleDB;
  let uploadDir: string;
  let savedStorageBackend: string | undefined;
  let savedUploadDir: string | undefined;
  let savedJwtSecret: string | undefined;

  beforeEach(async () => {
    db = await setupTestDB();
    uploadDir = await mkdtemp(path.join(tmpdir(), "postgame-media-routes-"));
    savedStorageBackend = process.env.INFLUENCE_STORAGE_BACKEND;
    savedUploadDir = process.env.INFLUENCE_LOCAL_UPLOAD_DIR;
    savedJwtSecret = process.env.JWT_SECRET;
    process.env.INFLUENCE_STORAGE_BACKEND = "local";
    process.env.INFLUENCE_LOCAL_UPLOAD_DIR = uploadDir;
    process.env.JWT_SECRET = "postgame-media-route-test-secret";
    process.env.POSTGAME_MEDIA_WORKER_TOKEN = "current-worker-token";
    process.env.POSTGAME_MEDIA_WORKER_TOKEN_PREVIOUS = "previous-worker-token";
  });

  afterEach(async () => {
    restoreEnv("INFLUENCE_STORAGE_BACKEND", savedStorageBackend);
    restoreEnv("INFLUENCE_LOCAL_UPLOAD_DIR", savedUploadDir);
    restoreEnv("JWT_SECRET", savedJwtSecret);
    await rm(uploadDir, { recursive: true, force: true });
  });

  test("supports worker token rotation and never exposes persisted token hashes", async () => {
    const gameId = await insertQueuedMedia(db, "rotation");
    const app = new Hono();
    app.route("/", createPostgameMediaWorkerRoutes(db));

    const previous = await app.request("/api/internal/postgame-media/claim", {
      method: "POST",
      headers: { Authorization: "Bearer previous-worker-token" },
    });
    expect(previous.status).toBe(200);
    const claim = (await previous.json() as { claim: { leaseToken: string } }).claim;
    expect(claim.leaseToken).toBeTruthy();
    const denied = await app.request("/api/internal/postgame-media/claim", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-worker-token" },
    });
    expect(denied.status).toBe(401);

    const [row] = await db.select().from(schema.gamePostgameMedia)
      .where(eq(schema.gamePostgameMedia.gameId, gameId));
    expect(row?.workerIdHash).toMatch(/^sha256:/);
    expect(row?.leaseTokenHash).toMatch(/^sha256:/);
    const combined = JSON.stringify([
      await getPublicPostgameMedia(db, gameId),
      await getAdminPostgameMedia(db, gameId),
    ]);
    expect(combined).not.toContain(row?.workerIdHash ?? "");
    expect(combined).not.toContain(row?.leaseTokenHash ?? "");
    expect(combined).not.toContain("previous-worker-token");
  });

  test("reconciles missing and retryable failed-enqueue rows idempotently into waiting inputs", async () => {
    const gameId = "postgame-media-reconcile";
    await insertGame(db, { id: gameId, slug: "reconcile", status: "completed", config: { maxRounds: 8 } });
    expect((await reconcilePostgameMediaForGame(db, gameId)).outcome).toBe("waiting_inputs");
    expect((await reconcilePostgameMediaForGame(db, gameId)).outcome).toBe("waiting_inputs");
    const rows = await db.select().from(schema.gamePostgameMedia)
      .where(eq(schema.gamePostgameMedia.gameId, gameId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("waiting_inputs");

    const manifest = manifestFixture(gameId);
    await db.update(schema.gamePostgameMedia).set({
      status: "failed",
      artifactVersion: "rv_retryable-enqueue",
      renderInputSnapshot: manifest,
      renderInputSnapshotHash: hashHouseHighlightsTrailerManifest(manifest),
      renderInputSnapshotVersion: manifest.schemaVersion,
      rendererVersion: "remotion-v1",
      timingContractVersion: manifest.timingContractVersion,
      musicAssetId: "golden-verdict-max",
      failureCategory: "enqueue",
      failureMessage: "temporary enqueue failure",
    }).where(eq(schema.gamePostgameMedia.gameId, gameId));
    expect((await reconcilePostgameMediaForGame(db, gameId)).outcome).toBe("waiting_inputs");
    const [repaired] = await db.select().from(schema.gamePostgameMedia)
      .where(eq(schema.gamePostgameMedia.gameId, gameId));
    expect(repaired).toMatchObject({
      status: "waiting_inputs",
      renderInputSnapshot: null,
      artifactVersion: null,
      failureCategory: null,
    });
  });

  test("records safe durable audit history for an admin backfill request", async () => {
    const actorUserId = "postgame-media-actor";
    const gameId = "postgame-media-audit";
    await db.insert(schema.users).values({ id: actorUserId, walletAddress: "0xpostgamemediaactor" });
    await insertGame(db, { id: gameId, slug: "media-audit", status: "completed", config: { maxRounds: 8 } });

    const result = await requestPostgameMedia(db, {
      gameId,
      actorUserId,
      action: "backfill",
      reason: "Retry after token=do-not-store",
      source: "admin_route",
    });
    expect(result.outcome).toBe("waiting_inputs");
    const [audit] = await db.select().from(schema.gamePostgameMediaAuditEvents)
      .where(eq(schema.gamePostgameMediaAuditEvents.gameId, gameId));
    expect(audit).toMatchObject({
      actorUserId,
      action: "backfill",
      outcome: "waiting_inputs",
      source: "admin_route",
      reason: "Retry after [redacted]",
    });
    expect(JSON.stringify(audit)).not.toContain("do-not-store");
  });

  test("allows an unexpired lease to heartbeat and rejects it after expiry", async () => {
    const gameId = await insertQueuedMedia(db, "lease-validity");
    const now = new Date("2026-07-10T00:00:00.000Z");
    const claim = await claimPostgameMedia(db, "current-worker-token", now);
    expect(claim).not.toBeNull();
    const request = { gameId, attemptNumber: claim!.attemptNumber, leaseToken: claim!.leaseToken };
    expect(await heartbeatPostgameMedia(db, request, new Date(now.getTime() + 1_000))).toBe(true);

    await db.update(schema.gamePostgameMedia)
      .set({ leaseExpiresAt: new Date(now.getTime() - 1_000).toISOString() })
      .where(eq(schema.gamePostgameMedia.gameId, gameId));
    expect(await heartbeatPostgameMedia(db, request, new Date(now.getTime() + 2_000))).toBe(false);
  });

  test("atomically grants one claim, reclaims stale work, and rejects stale mutations", async () => {
    const gameId = await insertQueuedMedia(db, "claim-race");
    const now = new Date("2026-07-10T00:00:00.000Z");
    const claims = await Promise.all([
      claimPostgameMedia(db, "current-worker-token", now),
      claimPostgameMedia(db, "previous-worker-token", now),
    ]);
    const claim = claims.find((entry) => entry !== null);
    expect(claims.filter((entry) => entry !== null)).toHaveLength(1);

    await db.update(schema.gamePostgameMedia)
      .set({ leaseExpiresAt: new Date(now.getTime() - 1_000).toISOString() })
      .where(eq(schema.gamePostgameMedia.gameId, gameId));
    const reclaimed = await claimPostgameMedia(db, "previous-worker-token", new Date(now.getTime() + 2_000));
    expect(reclaimed?.attemptNumber).toBe((claim?.attemptNumber ?? 0) + 1);
    expect(reclaimed?.artifactVersion).not.toBe(claim?.artifactVersion);
    expect(await heartbeatPostgameMedia(db, {
      gameId,
      attemptNumber: claim!.attemptNumber,
      leaseToken: claim!.leaseToken,
    }, new Date(now.getTime() + 3_000))).toBe(false);
  });

  test("finalize enforces provenance and opaque storage prefix without replacing a ready version twice", async () => {
    const gameId = await insertQueuedMedia(db, "finalize");
    const claim = await claimPostgameMedia(db, "current-worker-token");
    expect(claim).not.toBeNull();
    const request = finalizeFixture(gameId, claim!);
    const wrongPrefix = await finalizePostgameMedia(db, {
      ...request,
      artifacts: artifactFixture(gameId, "wrong-version"),
    });
    expect(wrongPrefix).toEqual({ ok: false, error: "invalid_artifact_metadata" });
    const wrongProvenance = await finalizePostgameMedia(db, {
      ...request,
      renderInputSnapshotHash: "sha256:wrong",
    });
    expect(wrongProvenance).toEqual({ ok: false, error: "manifest_provenance_mismatch" });

    expect(await finalizePostgameMedia(db, request)).toEqual({ ok: true });
    expect(await finalizePostgameMedia(db, request)).toEqual({ ok: false, error: "stale_or_invalid_lease" });
    expect((await getPublicPostgameMedia(db, gameId)).status).toBe("ready");
  });

  test("issues lease-bound targets and publishes only after every uploaded object and safe metadata verify", async () => {
    const gameId = await insertQueuedMedia(db, "uploaded-bundle");
    const app = new Hono();
    app.route("/", createPostgameMediaWorkerRoutes(db));
    app.route("/", createUploadRoutes(db));

    const claimResponse = await app.request("/api/internal/postgame-media/claim", {
      method: "POST",
      headers: { Authorization: "Bearer current-worker-token" },
    });
    expect(claimResponse.status).toBe(200);
    const claim = (await claimResponse.json() as {
      claim: NonNullable<Awaited<ReturnType<typeof claimPostgameMedia>>> & {
        publicArtifacts: Array<{
          artifact: "video" | "poster" | "captions" | "metadata";
          objectKey: string;
          publicUrl: string;
        }>;
        storage: { provider: "local"; bucket: string };
      };
    }).claim;

    const video = new Uint8Array([0, 0, 0, 1, 9]);
    const poster = new Uint8Array([137, 80, 78, 71]);
    const captions = new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:01.000\nThe cast enters.\n");
    const publicUrl = (artifact: "video" | "poster" | "captions") =>
      claim.publicArtifacts.find((entry) => entry.artifact === artifact)!.publicUrl;
    const metadata = new TextEncoder().encode(JSON.stringify({
      schema: "influence.house-highlights.playback",
      version: 1,
      durationMs: 19_800,
      dimensions: { width: 1920, height: 1080 },
      title: "House Highlights",
      description: "The game, cut by The House.",
      videoUrl: publicUrl("video"),
      posterUrl: publicUrl("poster"),
      captionsUrl: publicUrl("captions"),
      renderVersion: claim.artifactVersion,
      contentHashes: {
        video: sha256(video),
        poster: sha256(poster),
        captions: sha256(captions),
      },
    }));
    const bodies = { video, poster, captions, metadata };
    const contentTypes = {
      video: "video/mp4",
      poster: "image/png",
      captions: "text/vtt",
      metadata: "application/json",
    } as const;
    const declarations = Object.entries(bodies).map(([artifact, body]) => ({
      artifact,
      contentType: contentTypes[artifact as keyof typeof contentTypes],
      byteLength: body.byteLength,
      sha256: sha256(body),
    }));
    const targetResponse = await app.request(`/api/internal/postgame-media/${gameId}/upload-targets`, {
      method: "POST",
      headers: {
        Authorization: "Bearer current-worker-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        attemptNumber: claim.attemptNumber,
        leaseToken: claim.leaseToken,
        artifacts: declarations,
      }),
    });
    expect(targetResponse.status).toBe(200);
    const targets = (await targetResponse.json() as {
      targets: Array<{
        artifact: keyof typeof bodies;
        objectKey: string;
        publicUrl: string;
        contentType: string;
        byteLength: number;
        sha256: string;
        uploadUrl: string;
        uploadHeaders: Record<string, string>;
      }>;
    }).targets;
    const target = (artifact: keyof typeof bodies) =>
      targets.find((entry) => entry.artifact === artifact)!;
    const finalizePayload = {
      attemptNumber: claim.attemptNumber,
      leaseToken: claim.leaseToken,
      renderDurationMs: 19_800,
      ...claim.provenance,
      artifacts: {
        preview: { title: "House Highlights", description: "The game, cut by The House." },
        video: { ...artifactFields(target("video")), width: 1920, height: 1080 },
        poster: { ...artifactFields(target("poster")), altText: "House Highlights trailer preview" },
        captions: { ...artifactFields(target("captions")), language: "en", label: "English" },
        manifest: artifactFields(target("metadata")),
        storage: claim.storage,
      },
    };
    const prematureFinalize = await app.request(`/api/internal/postgame-media/${gameId}/finalize`, {
      method: "POST",
      headers: {
        Authorization: "Bearer current-worker-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(finalizePayload),
    });
    expect(prematureFinalize.status).toBe(409);
    expect(await prematureFinalize.json()).toEqual({
      ok: false,
      error: "artifact_verification_failed",
    });

    for (const target of targets) {
      const upload = await app.request(target.uploadUrl, {
        method: "PUT",
        headers: target.uploadHeaders,
        body: bodies[target.artifact],
      });
      expect(upload.status).toBe(204);
    }

    const finalize = await app.request(`/api/internal/postgame-media/${gameId}/finalize`, {
      method: "POST",
      headers: {
        Authorization: "Bearer current-worker-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(finalizePayload),
    });
    expect(finalize.status).toBe(200);
    expect(await finalize.json()).toEqual({ ok: true });
    expect((await getPublicPostgameMedia(db, gameId)).status).toBe("ready");
  });
});

async function insertQueuedMedia(db: DrizzleDB, suffix: string): Promise<string> {
  const gameId = `postgame-media-${suffix}`;
  await insertGame(db, { id: gameId, slug: suffix, status: "completed", config: { maxRounds: 8 } });
  const manifest = manifestFixture(gameId);
  await db.insert(schema.gamePostgameMedia).values({
    gameId,
    mediaType: "house_highlights_trailer",
    status: "queued",
    renderVersion: 1,
    artifactVersion: "rv_fixture-version",
    attemptNumber: 1,
    renderInputSnapshot: manifest,
    renderInputSnapshotHash: hashHouseHighlightsTrailerManifest(manifest),
    renderInputSnapshotVersion: 1,
    rendererVersion: "remotion-v1",
    timingContractVersion: manifest.timingContractVersion,
    musicAssetId: "golden-verdict-max",
  });
  return gameId;
}

function finalizeFixture(gameId: string, claim: NonNullable<Awaited<ReturnType<typeof claimPostgameMedia>>>) {
  return {
    gameId,
    attemptNumber: claim.attemptNumber,
    leaseToken: claim.leaseToken,
    renderDurationMs: 19_800,
    ...claim.provenance,
    artifacts: artifactFixture(gameId, claim.artifactVersion),
  };
}

function artifactFixture(gameId: string, artifactVersion: string) {
  const root = `postgame-media/house-highlights-trailers/${gameId}/${artifactVersion}`;
  const url = `https://media.example.test/${root}`;
  const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  return {
    preview: { title: "House Highlights", description: "The game, cut by The House." },
    video: { publicUrl: `${url}/trailer.mp4`, objectKey: `${root}/trailer.mp4`, contentType: "video/mp4", byteLength: 10, sha256: digest, width: 1920, height: 1080 },
    poster: { publicUrl: `${url}/poster.png`, objectKey: `${root}/poster.png`, contentType: "image/png", byteLength: 10, sha256: digest, altText: "Trailer poster" },
    captions: { publicUrl: `${url}/captions.vtt`, objectKey: `${root}/captions.vtt`, contentType: "text/vtt", byteLength: 10, sha256: digest, language: "en", label: "English" },
    manifest: { publicUrl: `${url}/metadata.json`, objectKey: `${root}/metadata.json`, contentType: "application/json", byteLength: 10, sha256: digest },
    storage: { provider: "s3", bucket: "public-media" },
  };
}

function manifestFixture(gameId: string): HouseHighlightsTrailerManifest {
  const winner = { id: "winner", name: "Mira Solari", initials: "MS", avatarUrl: "/avatars/personas/strategic.png", placement: 1, status: "winner" as const };
  const runnerUp = { id: "runner-up", name: "Orion Vale", initials: "OV", avatarUrl: "/avatars/personas/honest.png", placement: 2, status: "finalist" as const };
  return {
    schemaVersion: 1,
    mediaType: "house_highlights_trailer",
    timingContractVersion: "house-highlights-trailer-timing-v1",
    game: { id: gameId, slug: "fixture", status: "completed" },
    frameRate: 30,
    width: 1920,
    height: 1080,
    cast: [winner, runnerUp],
    scenelets: [],
    finalVote: { finalists: [winner, runnerUp], groups: [{ finalist: winner, votes: 4, jurors: [runnerUp] }, { finalist: runnerUp, votes: 3, jurors: [winner] }], voteLabel: "4-3", winner },
    playerResults: [{ agent: winner, placementLabel: "1st", tags: ["Winner"] }],
    cueSheet: { schemaVersion: 1, timingContractVersion: "house-highlights-trailer-timing-v1", frameRate: 30, totalFrames: 474, totalDurationSeconds: 15.8, segments: [], markers: { finalVoteRevealSeconds: 5, winnerRevealSeconds: 10 } },
  };
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function artifactFields(target: {
  objectKey: string;
  publicUrl: string;
  contentType: string;
  byteLength: number;
  sha256: string;
}) {
  return {
    objectKey: target.objectKey,
    publicUrl: target.publicUrl,
    contentType: target.contentType,
    byteLength: target.byteLength,
    sha256: target.sha256,
  };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
