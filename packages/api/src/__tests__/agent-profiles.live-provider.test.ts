import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { schema, type DrizzleDB } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import {
  createAgentProfileRoutes,
  resolveAgentProfileGenerationLlm,
} from "../routes/agent-profiles.js";
import { setupTestDB } from "./test-utils.js";

const USER_ID = "live-provider-profile-user";

let app: Hono;
let db: DrizzleDB;
let token: string;

beforeAll(() => {
  process.env.JWT_SECRET = "live-provider-agent-profile-test-secret";
  if (!resolveAgentProfileGenerationLlm()) {
    throw new Error(
      "Live-provider agent-profile tests require a hosted OPENAI_API_KEY.",
    );
  }
});

beforeEach(async () => {
  db = await setupTestDB();
  await db.insert(schema.users).values({
    id: USER_ID,
    email: `${randomUUID()}@live-provider.test`,
    displayName: "Live Provider Tester",
  });
  token = await createSessionToken(USER_ID, {
    roles: ["player"],
    permissions: [],
  });
  app = new Hono();
  app.route("/", createAgentProfileRoutes(db));
});

function jsonReq(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  };
}

describe("POST /api/agent-profiles/generate (live provider)", () => {
  test("generates a personality from traits", async () => {
    const res = await app.request(
      "/api/agent-profiles/generate",
      jsonReq({
        traits: "charming, manipulative, always smiling",
        occupation: "used car salesman",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      name: string;
      personality: string;
      personaKey: string;
      gender: "male" | "female" | "non-binary";
    };
    expect(body.name).toBeTruthy();
    expect(body.personality).toBeTruthy();
    expect(body.personaKey).toBeTruthy();
    expect(["male", "female", "non-binary"]).toContain(body.gender);
  }, 30_000);

  test("generates a personality from archetype only", async () => {
    const res = await app.request(
      "/api/agent-profiles/generate",
      jsonReq({ archetype: "wildcard" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { personaKey: string };
    expect(body.personaKey).toBeTruthy();
  }, 30_000);

  test("refines an existing profile", async () => {
    const res = await app.request(
      "/api/agent-profiles/generate",
      jsonReq({
        existingProfile: {
          name: "Rex",
          personality: "Aggressive and loud",
          backstory: "Former bouncer",
        },
        traits: "add some vulnerability, a soft side",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; backstory: string };
    expect(body.name).toBeTruthy();
    expect(body.backstory).toBeTruthy();
  }, 30_000);
});
