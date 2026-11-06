import { grantAward, revokeAward } from "../services/awards.js";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createProfileRoutes } from "../routes/profile.js";
import { createFreeQueueRoutes } from "../routes/free-queue.js";
import { schema } from "../db/index.js";
import type { DrizzleDB } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { setupTestDB } from "./test-utils.js";
import { PUBLIC_IDENTITY_LAUNCH_CUTOFF } from "../services/authenticated-public-identity.js";

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
        createdAt: PUBLIC_IDENTITY_LAUNCH_CUTOFF,
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
        handle: "named-player",
        rating: 1490,
        gamesPlayed: 6,
        gamesWon: 2,
        peakRating: 1510,
      },
    ]);
  });

  test("invite codes report whether invitation signup is enabled", async () => {
    await db.insert(schema.inviteCodes).values({ id: "invite-1", code: "INVITE01", ownerId: "named-user" });
    const token = await createSessionToken("named-user");
    const headers = { Authorization: `Bearer ${token}` };
    const disabled = await app.request("/api/profile/invite-codes", { headers });
    expect(await disabled.json()).toMatchObject({ enabled: false, totalAvailable: 1 });
    await db.insert(schema.appSettings).values({ key: "invite_required", value: "true" }).onConflictDoUpdate({ target: schema.appSettings.key, set: { value: "true" } });
    const enabled = await app.request("/api/profile/invite-codes", { headers });
    expect(await enabled.json()).toMatchObject({ enabled: true, available: [{ code: "INVITE01" }] });
  });

  test("private profile returns only its earned active badges on read and identity update", async () => {
    const grant = await grantAward(db, { definitionCode: "season-0-account-participant", recipient: { type: "account", id: "named-user" }, actorId: "named-user", sourceKey: "private-profile", requestId: "private-profile-grant", reason: "PRIVATE_REASON", evidence: { secret: "PRIVATE_EVIDENCE" } });
    const token = await createSessionToken("named-user");
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    for (const method of ["GET", "PATCH"]) {
      const response = await app.request("/api/profile", { method, headers, ...(method === "PATCH" ? { body: JSON.stringify({ displayName: "Named Player", handle: "named-player" }) } : {}) });
      expect(response.status).toBe(200);
      const body = await response.json() as { awards: Array<{ title: string }> };
      expect(body.awards).toHaveLength(1);
      expect(body.awards[0]!.title).toBe("Season 0 Participant");
      expect(JSON.stringify(body.awards)).not.toContain("PRIVATE_");
    }
    const otherToken = await createSessionToken("email-user");
    const other = await app.request("/api/profile", { headers: { Authorization: `Bearer ${otherToken}` } });
    expect((await other.json() as { awards: unknown[] }).awards).toEqual([]);
    await revokeAward(db, { grantId: grant.id, actorId: "named-user", reason: "fixture", requestId: "private-profile-revoke" });
    const revoked = await app.request("/api/profile", { headers });
    expect((await revoked.json() as { awards: unknown[] }).awards).toEqual([]);
    expect((await app.request("/api/profile")).status).toBe(401);
  });

  test("sanitizes email-based names on the main leaderboard", async () => {
    const res = await app.request("/api/leaderboard");
    expect(res.status).toBe(200);

    const body = await res.json() as Array<{
      displayName: string;
      player: { publicId: string; handle: string | null; displayName: string } | null;
      email?: string;
      userId?: string;
    }>;
    expect(body.find((entry) => entry.displayName === "Anonymous")?.player).toBeNull();
    expect(body.find((entry) => entry.displayName === "Named Player")?.player).toMatchObject({
      handle: "named-player",
      displayName: "Named Player",
    });
    expect(body.every((entry) => !("userId" in entry))).toBe(true);
    expect(body[0]).not.toHaveProperty("email");
  });

  test("sanitizes email-based names on the free queue leaderboard", async () => {
    const res = await app.request("/api/free-queue/leaderboard");
    expect(res.status).toBe(200);

    const body = await res.json() as Array<{
      displayName: string;
      player: { publicId: string; handle: string | null; displayName: string } | null;
      email?: string;
      userId?: string;
    }>;
    expect(body.find((entry) => entry.displayName === "Anonymous")?.player).toBeNull();
    expect(body.find((entry) => entry.displayName === "Named Player")?.player).toMatchObject({
      handle: "named-player",
      displayName: "Named Player",
    });
    expect(body.every((entry) => !("userId" in entry))).toBe(true);
    expect(body[0]).not.toHaveProperty("email");
  });

  test("allows the logged-in user to see their own email on /api/profile", async () => {
    const token = await createSessionToken("email-user");
    const res = await app.request("/api/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      email: string | null;
      publicId: string;
      handle: string | null;
      displayName: string;
      publicIdentityOnboarding: { state: string };
    };
    expect(body.email).toBe("player@example.com");
    expect(body.publicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.displayName).toBe("Anonymous");
    expect(body.handle).toBeNull();
    expect(body.publicIdentityOnboarding.state).toBe("required");
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

  test("classifies legacy, exact-cutoff, and complete identities from one server cutoff", async () => {
    await db.insert(schema.users).values([
      {
        id: "legacy-incomplete",
        displayName: "Player",
        createdAt: "2026-07-16T23:59:59.999999Z",
      },
      {
        id: "boundary-incomplete",
        displayName: "Player",
        createdAt: PUBLIC_IDENTITY_LAUNCH_CUTOFF,
      },
      {
        id: "complete-old",
        displayName: "Complete Player",
        handle: "complete-player",
        createdAt: "not-a-timestamp",
      },
    ]);

    for (const [id, expected] of [
      ["legacy-incomplete", "deferrable"],
      ["boundary-incomplete", "required"],
      ["complete-old", "complete"],
    ] as const) {
      const token = await createSessionToken(id);
      const res = await app.request("/api/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as {
        publicIdentityOnboarding: { state: string; diagnosticCode: string | null };
      };
      expect(body.publicIdentityOnboarding.state).toBe(expected);
      if (id === "complete-old") {
        expect(body.publicIdentityOnboarding.diagnosticCode).toBeNull();
      }
    }
  });

  test("atomically completes and replaces display name plus handle", async () => {
    const token = await createSessionToken("email-user");
    const first = await app.request("/api/profile", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ displayName: "Flick", handle: "flick" }),
    });

    expect(first.status).toBe(200);
    const completed = await first.json() as {
      publicId: string;
      displayName: string;
      handle: string;
      publicIdentityOnboarding: { state: string };
    };
    expect(completed.displayName).toBe("Flick");
    expect(completed.handle).toBe("flick");
    expect(completed.publicIdentityOnboarding.state).toBe("complete");

    const replacement = await app.request("/api/profile", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ displayName: "Ox Flick", handle: "oxflick" }),
    });
    expect(replacement.status).toBe(200);
    const replaced = await replacement.json() as typeof completed;
    expect(replaced.publicId).toBe(completed.publicId);
    expect(replaced.handle).toBe("oxflick");
  });

  test("maps only the named handle collision to a suggestion and preserves the old identity", async () => {
    const token = await createSessionToken("named-user");
    await db.insert(schema.users).values({
      id: "handle-owner",
      displayName: "Flick",
      handle: "flick",
    });

    const res = await app.request("/api/profile", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ displayName: "Changed Name", handle: "flick" }),
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { code: string; suggestion: string };
    expect(body.code).toBe("HANDLE_TAKEN");
    expect(body.suggestion).toBe("changed-name");

    const [stored] = await db
      .select({ displayName: schema.users.displayName, handle: schema.users.handle })
      .from(schema.users)
      .where(eq(schema.users.id, "named-user"));
    expect(stored).toEqual({ displayName: "Named Player", handle: "named-player" });
  });

  test("suggests a deterministic available handle without claiming it", async () => {
    await db.insert(schema.users).values({
      id: "flick-owner",
      displayName: "Flick",
      handle: "flick",
    });
    const token = await createSessionToken("named-user");
    const res = await app.request("/api/profile/handle-suggestion?displayName=Flick", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestion: "flick-2" });
  });
});
