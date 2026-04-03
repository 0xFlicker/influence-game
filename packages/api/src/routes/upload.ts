/**
 * Upload routes — presigned URL generation for browser-direct uploads.
 *
 *   POST /api/upload/pfp — get a presigned PUT URL for a profile picture
 */

import { Hono } from "hono";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { generatePresignedUpload, isStorageConfigured } from "../lib/storage.js";

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

    const result = await generatePresignedUpload(key, contentType);

    return c.json({
      uploadUrl: result.uploadUrl,
      publicUrl: result.publicUrl,
      key: result.key,
    });
  });

  return app;
}
