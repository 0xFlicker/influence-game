import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { schema } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { createProviderModelRoutes } from "../routes/provider-models.js";
import { setupTestDB } from "./test-utils.js";

const USER_ID = "provider-inventory-user";

beforeAll(() => {
  process.env.JWT_SECRET = "provider-inventory-test-secret";
});

describe("provider model inventory", () => {
  test("requires authentication and exposes capability-aware approved choices", async () => {
    const db = await setupTestDB();
    await db.insert(schema.users).values({
      id: USER_ID,
      walletAddress: "0x9999999999999999999999999999999999999999",
      displayName: "Provider Inventory User",
    });
    const calls: string[] = [];
    const app = new Hono().route("/", createProviderModelRoutes(
      db,
      { OPENAI_API_KEY: "configured" } as NodeJS.ProcessEnv,
      {
        async listModelIds(providerProfileId) {
          calls.push(providerProfileId);
          return ["gpt-5-nano", "gpt-5-mini", "gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.6-luna"];
        },
      },
    ));

    expect((await app.request("/api/provider-models")).status).toBe(401);

    const token = await createSessionToken(USER_ID, { roles: ["sysop"], permissions: [] });
    const response = await app.request("/api/provider-models", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      models: Array<{
        catalogId: string;
        configured: boolean;
        available: boolean | null;
        allowedReasoningPolicies: string[];
      }>;
    };
    expect(body.status).toBe("complete");
    expect(calls).toEqual(["openai"]);
    expect(body.models.find((model) => model.catalogId === "openai:gpt-5.6-luna"))
      .toMatchObject({ configured: true, available: true });
    expect(body.models.find((model) => model.catalogId === "katana:grok-4-5"))
      .toMatchObject({ configured: false, available: null, allowedReasoningPolicies: ["action-policy", "low", "medium", "high"] });
    expect(body.models.find((model) => model.catalogId === "katana:glm-5-2"))
      .toMatchObject({ configured: false, allowedReasoningPolicies: ["action-policy"] });
  });

  test("returns a bounded unavailable inventory without exposing provider failures", async () => {
    const db = await setupTestDB();
    await db.insert(schema.users).values({
      id: USER_ID,
      walletAddress: "0x9999999999999999999999999999999999999999",
      displayName: "Provider Inventory User",
    });
    const app = new Hono().route("/", createProviderModelRoutes(
      db,
      {
        OPENAI_API_KEY: "secret-openai-key",
        API_KAT_IMGNAI_KEY: "secret-katana-key",
        API_KAT_IMGNAI_SECRET: "secret-katana-secret",
      } as NodeJS.ProcessEnv,
      {
        async listModelIds(providerProfileId) {
          if (providerProfileId === "katana") {
            throw new Error("secret-katana-key upstream response body");
          }
          return ["gpt-5.6-luna"];
        },
      },
    ));
    const token = await createSessionToken(USER_ID, { roles: ["sysop"], permissions: [] });
    const response = await app.request("/api/provider-models", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(responseText).not.toContain("secret-");
    const body = JSON.parse(responseText) as {
      status: string;
      models: Array<{ catalogId: string; configured: boolean; available: boolean | null }>;
    };
    expect(body.status).toBe("unavailable");
    expect(body.models.find((model) => model.catalogId === "openai:gpt-5.6-luna"))
      .toMatchObject({ configured: true, available: true });
    expect(body.models.find((model) => model.catalogId === "katana:grok-4-5"))
      .toMatchObject({ configured: true, available: null });
  });

  test("marks a catalog model unavailable when a successful provider listing omits it", async () => {
    const db = await setupTestDB();
    await db.insert(schema.users).values({
      id: USER_ID,
      walletAddress: "0x9999999999999999999999999999999999999999",
      displayName: "Provider Inventory User",
    });
    const app = new Hono().route("/", createProviderModelRoutes(
      db,
      {
        API_KAT_IMGNAI_KEY: "configured-key",
        API_KAT_IMGNAI_SECRET: "configured-secret",
      } as NodeJS.ProcessEnv,
      {
        async listModelIds() {
          return ["grok-4-5"];
        },
      },
    ));
    const token = await createSessionToken(USER_ID, { roles: ["sysop"], permissions: [] });
    const response = await app.request("/api/provider-models", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as {
      status: string;
      models: Array<{ catalogId: string; configured: boolean; available: boolean | null }>;
    };

    expect(body.status).toBe("complete");
    expect(body.models.find((model) => model.catalogId === "katana:grok-4-5"))
      .toMatchObject({ configured: true, available: true });
    expect(body.models.find((model) => model.catalogId === "katana:glm-5-2"))
      .toMatchObject({ configured: true, available: false });
  });
});
