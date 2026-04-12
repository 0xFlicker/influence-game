import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createProfileRoutes } from "../routes/profile.js";
import { createFreeQueueRoutes } from "../routes/free-queue.js";
import { schema } from "../db/index.js";
import type { DrizzleDB } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { setupTestDB } from "./test-utils.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-jwt-secret-profile-routes";
  process.env.ADMIN_ADDRESS = "0xadmin000000000000000000000000000000dead";
});

describe("public profile surfaces", () => {
  let db: DrizzleDB;
  let app: Hono;

  beforeEach(async () => {
    db = await setupTestDB();
    app = new Hono();
    app.route("/", createProfileRoutes(db));
    app.route("/", createFreeQueueRoutes(db));

    await db.insert(schema.users).values([
      {
        id: "email-user",
        email: "player@example.com",
        displayName: "player@example.com",
        rating: 1540,
        gamesPlayed: 8,
        gamesWon: 5,
        peakRating: 1600,
      },
      {
        id: "named-user",
        walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        email: "named@example.com",
        displayName: "Named Player",
        rating: 1490,
        gamesPlayed: 6,
        gamesWon: 2,
        peakRating: 1510,
      },
    ]);
  });

  test("sanitizes email-based names on the main leaderboard", async () => {
    const res = await app.request("/api/leaderboard");
    expect(res.status).toBe(200);

    const body = await res.json() as Array<{ userId: string; displayName: string; email?: string }>;
    expect(body.find((entry) => entry.userId === "email-user")?.displayName).toBe("Anonymous");
    expect(body.find((entry) => entry.userId === "named-user")?.displayName).toBe("Named Player");
    expect(body[0]).not.toHaveProperty("email");
  });

  test("sanitizes email-based names on the free queue leaderboard", async () => {
    const res = await app.request("/api/free-queue/leaderboard");
    expect(res.status).toBe(200);

    const body = await res.json() as Array<{ userId: string; displayName: string; email?: string }>;
    expect(body.find((entry) => entry.userId === "email-user")?.displayName).toBe("Anonymous");
    expect(body.find((entry) => entry.userId === "named-user")?.displayName).toBe("Named Player");
    expect(body[0]).not.toHaveProperty("email");
  });

  test("allows the logged-in user to see their own email on /api/profile", async () => {
    const token = await createSessionToken("email-user");
    const res = await app.request("/api/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { email: string | null };
    expect(body.email).toBe("player@example.com");
  });

  test("rejects email addresses as public display names", async () => {
    const token = await createSessionToken("named-user");
    const res = await app.request("/api/profile", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ displayName: "leak@example.com" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("cannot be an email address");
  });
});
