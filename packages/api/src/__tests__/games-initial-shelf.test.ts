import { beforeEach, expect, test } from "bun:test";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { createGameRoutes } from "../routes/games.js";
import { DEFAULT_MODEL_CATALOG_ID } from "@influence/engine";
import { eq } from "drizzle-orm";

let db: DrizzleDB;
beforeEach(async () => { db = await setupTestDB(); });

test("bounded public shelf applies visibility and status before limit, with stable ties", async () => {
  const createdAt = "2026-10-01T12:00:00.000Z";
  const publicConfig = JSON.stringify({ providerManifest: [{ catalogId: DEFAULT_MODEL_CATALOG_ID }] });
  const unlistedConfig = JSON.stringify({ visibility: "unlisted", providerManifest: [{ catalogId: DEFAULT_MODEL_CATALOG_ID }] });
  await db.insert(schema.games).values([
    { id: "old", slug: "old", config: publicConfig, createdAt: "2026-09-01T00:00:00.000Z", status: "waiting" },
    { id: "a", slug: "a", config: publicConfig, createdAt, status: "waiting" },
    { id: "b", slug: "b", config: publicConfig, createdAt, status: "waiting" },
    { id: "hidden", slug: "hidden", config: publicConfig, createdAt: "2026-11-01T00:00:00.000Z", hiddenAt: "2026-11-02T00:00:00.000Z", status: "waiting" },
    { id: "unlisted", slug: "unlisted", config: unlistedConfig, createdAt: "2026-11-01T00:00:00.000Z", status: "waiting" },
    { id: "completed", slug: "completed", config: publicConfig, createdAt: "2026-11-01T00:00:00.000Z", status: "completed" },
  ]);
  const app = createGameRoutes(db);
  const response = await app.request("/api/games?status=waiting&limit=2");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const rows = await response.json() as Array<{id: string}>;
  expect(rows.map(row => row.id)).toEqual(["b", "a"]);
  expect(((await (await app.request("/api/games?status=waiting")).json()) as unknown[])).toHaveLength(3);
  for (const limit of ["0", "21", "1.5", "invalid"]) expect((await app.request(`/api/games?limit=${limit}`)).status).toBe(400);
  await db.update(schema.games).set({ hiddenAt: "2026-11-03T00:00:00.000Z" }).where(eq(schema.games.id, "b"));
  const refreshed = await (await app.request("/api/games?status=waiting&limit=2")).json() as Array<{id: string}>;
  expect(refreshed.map(row => row.id)).toEqual(["a", "old"]);
});

test("bounded shelf sorts valid creation times by instant across different offsets", async () => {
  const config = JSON.stringify({ providerManifest: [{ catalogId: DEFAULT_MODEL_CATALOG_ID }] });
  await db.insert(schema.games).values([
    { id: "utc", slug: "utc", config, createdAt: "2026-10-01T12:00:00Z" },
    { id: "early", slug: "early", config, createdAt: "2026-10-01T13:00:00+02:00" },
    { id: "later", slug: "later", config, createdAt: "2026-10-01T12:00:01" },
    { id: "bad", slug: "bad", config, createdAt: "invalid" },
  ]);
  const response = await createGameRoutes(db).request("/api/games?limit=4");
  expect(((await response.json()) as Array<{id: string}>).map(row => row.id)).toEqual(["later", "utc", "early", "bad"]);
});
