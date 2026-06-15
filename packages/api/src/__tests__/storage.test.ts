import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { DrizzleDB } from "../db/index.js";
import { generatePresignedUpload, getStorageBackend } from "../lib/storage.js";
import { createUploadRoutes } from "../routes/upload.js";
import { assertPrivateContentStoragePointer } from "../services/game-evidence.js";
import { getPrivateTraceStorageConfig } from "../services/private-trace-storage.js";

const ENV_KEYS = [
  "NODE_ENV",
  "DOPPLER_CONFIG",
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

describe("local filesystem upload storage", () => {
  let app: Hono;
  let savedEnv: Record<string, string | undefined>;
  let tempDir: string;

  beforeEach(async () => {
    savedEnv = Object.fromEntries(
      ENV_KEYS.map((key) => [key, process.env[key]]),
    );
    tempDir = await mkdtemp(path.join(tmpdir(), "influence-upload-"));

    process.env.JWT_SECRET = "test-local-upload-secret";
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
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  test("accepts a signed local PUT and serves the saved file", async () => {
    const upload = await generatePresignedUpload("pfp/user-1/avatar.png", "image/png");
    const bytes = new Uint8Array([1, 2, 3]);

    const put = await app.request(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: new Blob([bytes], { type: "image/png" }),
    });

    expect(put.status).toBe(204);

    const get = await app.request(upload.publicUrl);
    expect(get.status).toBe(200);
    expect(get.headers.get("Content-Type")).toBe("image/png");
    expect(Array.from(new Uint8Array(await get.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  test("rejects tampered local upload URLs", async () => {
    const upload = await generatePresignedUpload("pfp/user-1/avatar.png", "image/png");
    const tamperedUrl = upload.uploadUrl.replace("token=", "token=bad");

    const res = await app.request(tamperedUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: new Blob([new Uint8Array([1])], { type: "image/png" }),
    });

    expect(res.status).toBe(403);
  });

  test("rejects unsupported local upload content types", async () => {
    const upload = await generatePresignedUpload("pfp/user-1/avatar.gif", "image/gif");

    const res = await app.request(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/gif" },
      body: new Blob([new Uint8Array([1])], { type: "image/gif" }),
    });

    expect(res.status).toBe(400);
  });

  test("rejects unsafe local storage keys", async () => {
    let error: Error | null = null;
    try {
      await generatePresignedUpload("../avatar.png", "image/png");
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }

    expect(error?.message).toBe("Invalid upload key");
  });

  test("does not auto-enable local storage in production", () => {
    process.env.NODE_ENV = "production";
    process.env.DOPPLER_CONFIG = "dev";
    delete process.env.INFLUENCE_STORAGE_BACKEND;

    expect(getStorageBackend()).toBe("disabled");
  });

  test("keeps private content storage separate from public profile-picture storage", () => {
    process.env.LINODE_OBJ_BUCKET = "public-profile-bucket";
    process.env.LINODE_PRIVATE_CONTENT_BUCKET = "private-content-bucket";

    expect(() => assertPrivateContentStoragePointer({
      provider: "linode_object_storage",
      bucket: "public-profile-bucket",
      key: "content/game-1/raw.jsonl",
    })).toThrow("public profile-picture bucket");

    expect(() => assertPrivateContentStoragePointer({
      provider: "linode_object_storage",
      bucket: "private-content-bucket",
      key: "pfp/user/avatar.png",
    })).toThrow("private object key");

    expect(() => assertPrivateContentStoragePointer({
      provider: "linode_object_storage",
      bucket: "other-private-bucket",
      key: "content/game-1/raw.jsonl",
    })).toThrow("configured private content bucket");

    expect(() => assertPrivateContentStoragePointer({
      provider: "linode_object_storage",
      bucket: "private-content-bucket",
      key: "games/game-1/raw.jsonl",
    })).toThrow("private object key");

    expect(() => assertPrivateContentStoragePointer({
      provider: "linode_object_storage",
      bucket: "private-content-bucket",
      key: "content/game-1/raw.jsonl",
    })).not.toThrow();
  });

  test("private trace storage can use credentials separate from profile-picture uploads", () => {
    process.env.LINODE_OBJ_ENDPOINT = "https://public-object-storage.example";
    process.env.LINODE_OBJ_ACCESS_KEY = "public-pfp-access-key";
    process.env.LINODE_OBJ_SECRET_KEY = "public-pfp-secret-key";
    process.env.LINODE_OBJ_BUCKET = "public-profile-bucket";
    process.env.LINODE_PRIVATE_CONTENT_ENDPOINT = "https://private-object-storage.example";
    process.env.LINODE_PRIVATE_CONTENT_ACCESS_KEY = "private-content-access-key";
    process.env.LINODE_PRIVATE_CONTENT_SECRET_KEY = "private-content-secret-key";
    process.env.LINODE_PRIVATE_CONTENT_BUCKET = "private-content-bucket";

    expect(getPrivateTraceStorageConfig()).toEqual({
      endpoint: "https://private-object-storage.example",
      accessKeyId: "private-content-access-key",
      secretAccessKey: "private-content-secret-key",
      bucket: "private-content-bucket",
    });
    expect(getStorageBackend()).toBe("local");
  });

  test("private trace storage requires private content credentials even when shared object storage is configured", () => {
    process.env.LINODE_OBJ_ENDPOINT = "https://shared-object-storage.example";
    process.env.LINODE_OBJ_ACCESS_KEY = "shared-access-key";
    process.env.LINODE_OBJ_SECRET_KEY = "shared-secret-key";
    process.env.LINODE_PRIVATE_CONTENT_BUCKET = "private-content-bucket";

    expect(() => getPrivateTraceStorageConfig()).toThrow(
      "LINODE_PRIVATE_CONTENT_ENDPOINT, LINODE_PRIVATE_CONTENT_ACCESS_KEY, LINODE_PRIVATE_CONTENT_SECRET_KEY must be set",
    );
  });
});
