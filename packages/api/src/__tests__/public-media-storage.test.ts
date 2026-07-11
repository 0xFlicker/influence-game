import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { DrizzleDB } from "../db/index.js";
import {
  generatePresignedUpload,
} from "../lib/storage.js";
import {
  allocateHouseHighlightsTrailerArtifact,
  createPublicMediaUploadTarget,
  inspectPublicMediaArtifact,
  sanitizePublicMediaUploadTarget,
} from "../lib/public-media-storage.js";
import {
  assertSafeHouseHighlightsPlaybackMetadata,
  createHouseHighlightsPlaybackMetadata,
} from "../services/postgame-media-storage.js";
import { createUploadRoutes } from "../routes/upload.js";

const ENV_KEYS = [
  "NODE_ENV",
  "JWT_SECRET",
  "INFLUENCE_STORAGE_BACKEND",
  "INFLUENCE_LOCAL_UPLOAD_DIR",
  "LINODE_OBJ_ENDPOINT",
  "LINODE_OBJ_ACCESS_KEY",
  "LINODE_OBJ_SECRET_KEY",
  "LINODE_OBJ_BUCKET",
  "LINODE_PRIVATE_CONTENT_ENDPOINT",
  "LINODE_PRIVATE_CONTENT_ACCESS_KEY",
  "LINODE_PRIVATE_CONTENT_SECRET_KEY",
  "LINODE_PRIVATE_CONTENT_BUCKET",
] as const;

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("public House Highlights media storage", () => {
  let app: Hono;
  let savedEnv: Record<string, string | undefined>;
  let tempDir: string;

  beforeEach(async () => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    tempDir = await mkdtemp(path.join(tmpdir(), "influence-public-media-"));
    process.env.JWT_SECRET = "test-public-media-secret";
    process.env.INFLUENCE_STORAGE_BACKEND = "local";
    process.env.INFLUENCE_LOCAL_UPLOAD_DIR = tempDir;
    delete process.env.LINODE_OBJ_ENDPOINT;
    delete process.env.LINODE_OBJ_ACCESS_KEY;
    delete process.env.LINODE_OBJ_SECRET_KEY;
    delete process.env.LINODE_OBJ_BUCKET;
    delete process.env.LINODE_PRIVATE_CONTENT_ENDPOINT;
    delete process.env.LINODE_PRIVATE_CONTENT_ACCESS_KEY;
    delete process.env.LINODE_PRIVATE_CONTENT_SECRET_KEY;
    delete process.env.LINODE_PRIVATE_CONTENT_BUCKET;
    app = new Hono();
    app.route("/", createUploadRoutes({} as DrizzleDB));
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  test("keeps avatars small while allowing a constrained MP4 media target", async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024 + 1);
    const target = await createPublicMediaUploadTarget({
      gameId: "game-1",
      renderVersion: "rv_opaque_01",
      artifact: "video",
      attemptId: "attempt-1",
      leaseId: "lease-1",
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
      publicBaseUrl: "http://api.test",
    });

    const put = await app.request(target.uploadUrl, {
      method: "PUT",
      headers: target.uploadHeaders,
      body: bytes,
    });

    expect(put.status).toBe(204);
    expect((await inspectPublicMediaArtifact(target)).valid).toBe(true);

    const avatar = await generatePresignedUpload("pfp/user-1/too-large.png", "image/png");
    const avatarPut = await app.request(avatar.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: bytes,
    });
    expect(avatarPut.status).toBe(413);
  });

  test("uses fixed immutable keys and rejects unsafe identifiers", () => {
    expect(allocateHouseHighlightsTrailerArtifact({
      gameId: "game_1",
      renderVersion: "rv_opaque_01",
      artifact: "metadata",
    }).key).toBe(
      "postgame-media/house-highlights-trailers/game_1/rv_opaque_01/metadata.json",
    );
    expect(() => allocateHouseHighlightsTrailerArtifact({
      gameId: "../game",
      renderVersion: "rv_opaque_01",
      artifact: "video",
    })).toThrow("Invalid public media game ID");
  });

  test("serves local media with exact constraints, range support, CORS, and one use", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const target = await createPublicMediaUploadTarget({
      gameId: "game-1",
      renderVersion: "rv_opaque_02",
      artifact: "video",
      attemptId: "attempt-2",
      leaseId: "lease-2",
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
      publicBaseUrl: "http://api.test",
    });

    const wrongChecksum = await app.request(target.uploadUrl, {
      method: "PUT",
      headers: target.uploadHeaders,
      body: new Uint8Array([1, 2, 3, 5]),
    });
    expect(wrongChecksum.status).toBe(400);

    const accepted = await app.request(target.uploadUrl, {
      method: "PUT",
      headers: target.uploadHeaders,
      body: bytes,
    });
    expect(accepted.status).toBe(204);

    const replay = await app.request(target.uploadUrl, {
      method: "PUT",
      headers: target.uploadHeaders,
      body: bytes,
    });
    expect(replay.status).toBe(403);

    const replacementTarget = await createPublicMediaUploadTarget({
      gameId: "game-1",
      renderVersion: "rv_opaque_02",
      artifact: "video",
      attemptId: "attempt-2b-01",
      leaseId: "lease-2b-01",
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
      publicBaseUrl: "http://api.test",
    });
    const overwrite = await app.request(replacementTarget.uploadUrl, {
      method: "PUT",
      headers: replacementTarget.uploadHeaders,
      body: bytes,
    });
    expect(overwrite.status).toBe(400);

    const range = await app.request(target.publicUrl, { headers: { Range: "bytes=1-2" } });
    expect(range.status).toBe(206);
    expect(range.headers.get("Content-Range")).toBe("bytes 1-2/4");
    expect(range.headers.get("Accept-Ranges")).toBe("bytes");
    expect(range.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(Array.from(new Uint8Array(await range.arrayBuffer()))).toEqual([2, 3]);

    const head = await app.request(target.publicUrl, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Length")).toBe("4");
    expect(head.headers.get("ETag")).toBeTruthy();

    const captions = new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:01.000\nThe House.\n");
    const captionsTarget = await createPublicMediaUploadTarget({
      gameId: "game-1",
      renderVersion: "rv_opaque_02",
      artifact: "captions",
      attemptId: "attempt-2-vtt",
      leaseId: "lease-2-vtt",
      byteLength: captions.byteLength,
      sha256: sha256(captions),
      publicBaseUrl: "http://api.test",
    });
    expect((await app.request(captionsTarget.uploadUrl, {
      method: "PUT",
      headers: captionsTarget.uploadHeaders,
      body: captions,
    })).status).toBe(204);
    const captionsGet = await app.request(captionsTarget.publicUrl);
    expect(captionsGet.headers.get("Content-Type")).toBe("text/vtt");
    expect(captionsGet.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("does not use private storage configuration or leak bearer targets", async () => {
    process.env.INFLUENCE_STORAGE_BACKEND = "s3";
    process.env.LINODE_OBJ_ENDPOINT = "https://public.example.test";
    process.env.LINODE_OBJ_ACCESS_KEY = "public-key";
    process.env.LINODE_OBJ_SECRET_KEY = "public-secret";
    process.env.LINODE_OBJ_BUCKET = "public-media";
    process.env.LINODE_PRIVATE_CONTENT_ENDPOINT = "https://private.example.test";
    process.env.LINODE_PRIVATE_CONTENT_ACCESS_KEY = "private-key";
    process.env.LINODE_PRIVATE_CONTENT_SECRET_KEY = "private-secret";
    process.env.LINODE_PRIVATE_CONTENT_BUCKET = "private-media";
    const bytes = new Uint8Array([1]);
    const target = await createPublicMediaUploadTarget({
      gameId: "game-1",
      renderVersion: "rv_opaque_03",
      artifact: "captions",
      attemptId: "attempt-3",
      leaseId: "lease-3",
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    });

    expect(target.publicUrl).toBe(
      "https://public-media.public.example.test/postgame-media/house-highlights-trailers/game-1/rv_opaque_03/captions.vtt",
    );
    expect(target.uploadHeaders["if-none-match"]).toBe("*");
    expect(target.uploadHeaders["x-amz-acl"]).toBe("public-read");
    expect(new URL(target.uploadUrl).searchParams.get("X-Amz-SignedHeaders")).toContain("if-none-match");
    expect(new URL(target.uploadUrl).searchParams.get("X-Amz-SignedHeaders")).toContain("x-amz-acl");
    const sanitized = JSON.stringify(sanitizePublicMediaUploadTarget(target));
    expect(sanitized).not.toContain("X-Amz-");
    expect(sanitized).not.toContain("private.example.test");
    expect(sanitized).not.toContain("lease-3");
    expect(sanitized).not.toContain("uploadUrl");
  });

  test("allows only safe playback metadata", () => {
    const metadata = createHouseHighlightsPlaybackMetadata({
      durationMs: 19_800,
      width: 1920,
      height: 1080,
      title: "House Highlights",
      description: "The game, cut by The House.",
      videoUrl: "https://media.example.test/trailer.mp4",
      posterUrl: "https://media.example.test/poster.png",
      captionsUrl: "https://media.example.test/captions.vtt",
      renderVersion: "rv_opaque_01",
      contentHashes: {
        video: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        poster: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        captions: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      },
    });
    expect(metadata.version).toBe(1);
    expect(assertSafeHouseHighlightsPlaybackMetadata(JSON.parse(JSON.stringify(metadata)))).toEqual(metadata);
    expect(() => assertSafeHouseHighlightsPlaybackMetadata({
      ...metadata,
      rawCueIds: ["private"],
    })).toThrow("Unexpected playback metadata field");
    for (const forbiddenField of ["musicFilename", "objectKey", "leaseToken", "diagnostics"]) {
      expect(() => assertSafeHouseHighlightsPlaybackMetadata({
        ...metadata,
        [forbiddenField]: "private",
      })).toThrow("Unexpected playback metadata field");
    }
  });
});
