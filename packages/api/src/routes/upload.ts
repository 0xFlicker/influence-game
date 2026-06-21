/**
 * Upload routes — presigned URL generation for browser-direct uploads.
 *
 *   POST /api/upload/pfp — get a presigned PUT URL for a profile picture
 */

import { Hono } from "hono";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import {
  generatePresignedUpload,
  getStorageBackend,
  isStorageConfigured,
  LocalUploadError,
  readLocalUpload,
  verifyLocalUploadToken,
  writeLocalUpload,
} from "../lib/storage.js";

// Allowed image MIME types for PFPs
const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

// Map MIME type to file extension
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createUploadRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  app.put("/api/upload/local", async (c) => {
    if (getStorageBackend() !== "local") {
      return c.json({ error: "Local file upload is not enabled" }, 404);
    }

    const key = c.req.query("key");
    const contentType = c.req.query("contentType");
    const expiresAt = Number(c.req.query("expiresAt"));
    const token = c.req.query("token");

    if (!key || !contentType || !token) {
      return c.json({ error: "Missing upload parameters" }, 400);
    }

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return c.json({ error: "Unsupported upload content type" }, 400);
    }

    if (!verifyLocalUploadToken(key, contentType, expiresAt, token)) {
      return c.json({ error: "Upload URL expired or invalid" }, 403);
    }

    const requestContentType = c.req.header("content-type")?.split(";")[0] ?? contentType;
    if (requestContentType !== contentType) {
      return c.json({ error: "Content-Type does not match signed upload" }, 400);
    }

    try {
      await writeLocalUpload(key, contentType, await c.req.arrayBuffer());
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof LocalUploadError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
  });

  app.get("/api/uploads/local", async (c) => {
    if (getStorageBackend() !== "local") {
      return c.json({ error: "Local file upload is not enabled" }, 404);
    }

    const key = c.req.query("key");
    if (!key) {
      return c.json({ error: "Missing upload key" }, 400);
    }

    try {
      const file = await readLocalUpload(key);
      if (!file) {
        return c.json({ error: "File not found" }, 404);
      }

      return new Response(file.body, {
        headers: {
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Type": file.contentType,
        },
      });
    } catch (error) {
      if (error instanceof LocalUploadError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/upload/pfp — get presigned URL for profile picture upload
  // -------------------------------------------------------------------------

  app.post("/api/upload/pfp", requireAuth(db), async (c) => {
    if (!isStorageConfigured()) {
      return c.json(
        { error: "File upload not available (object storage not configured)" },
        503,
      );
    }

    const body = await c.req.json<{ contentType?: string }>();
    const contentType = body.contentType;

    if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      return c.json(
        {
          error: `Invalid contentType. Must be one of: ${[...ALLOWED_CONTENT_TYPES].join(", ")}`,
        },
        400,
      );
    }

    const user = c.get("user");
    const ext = MIME_TO_EXT[contentType] ?? "bin";
    const key = `pfp/${user.id}/${randomUUID()}.${ext}`;

    const result = await generatePresignedUpload(
      key,
      contentType,
      300,
      new URL(c.req.url).origin,
    );

    return c.json({
      uploadUrl: result.uploadUrl,
      publicUrl: result.publicUrl,
      key: result.key,
    });
  });

  return app;
}
