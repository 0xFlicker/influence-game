import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { seedRBAC } from "../db/rbac-seed.js";
import { schema } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { createProviderModelRoutes, providerModelInventory } from "../routes/provider-models.js";
import { setupTestDB } from "./test-utils.js";
import { modelCatalogEntryById } from "@influence/engine/model-catalog";

const USER_ID = "provider-inventory-user";

beforeAll(() => {
  process.env.JWT_SECRET = "provider-inventory-test-secret";
});

describe("provider model inventory", () => {
  test("xAI discovery exposes audited native equivalents and never revives Katana Grok", async () => {
    const inventory = await providerModelInventory({ XAI_API_KEY: "fixture", API_KAT_IMGNAI_KEY: "fixture", API_KAT_IMGNAI_SECRET: "fixture" }, true,
      async provider => provider === "xai" ? ["grok-4.3", "grok-4.6", "grok-imagine-image", "grok-future"] : ["grok-4-3", "grok-future"]);
    expect(inventory.models.find(model => model.catalogId === "xai:grok-4.3")).toMatchObject({ configured: true, available: true });
    expect(inventory.models.find(model => model.catalogId === "xai:grok-4.5")).toMatchObject({ configured: true, available: false });
    expect(inventory.models.some(model => model.catalogId.startsWith("katana:grok-"))).toBe(false);
    expect(inventory.models.some(model => model.catalogId.includes("grok-future") || model.catalogId.includes("grok-imagine"))).toBe(false);
  });
  test("even operator discovery offers only the current native Claude families", async () => {
    const inventory = await providerModelInventory({ ANTHROPIC_API_KEY: "fixture", API_KAT_IMGNAI_KEY: "fixture", API_KAT_IMGNAI_SECRET: "fixture" }, true,
      async provider => provider === "anthropic" ? ["claude-haiku-5-5", "claude-sonnet-4-6", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]
        : ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8", "claude-fable-5-1", "deepseek-v4-flash"]);
    expect(inventory.models.filter(model => model.modelId.startsWith("claude-")).map(model => model.catalogId).sort()).toEqual([
      "anthropic:claude-fable-5-1", "anthropic:claude-haiku-5-5", "anthropic:claude-opus-5-5", "anthropic:claude-sonnet-5-5",
    ]);
    expect(inventory.models.some(model => model.catalogId === "katana:deepseek-v4-flash")).toBe(true);
  });
  test("ordinary users receive free Haiku alongside existing choices, without premium Claude or GLM", async () => {
    const inventory = await providerModelInventory({ ANTHROPIC_API_KEY: "fixture", OPENAI_API_KEY: "fixture", API_KAT_IMGNAI_KEY: "fixture", API_KAT_IMGNAI_SECRET: "fixture", META_MUSE_API_KEY: "fixture" }, false,
      async provider => provider === "anthropic" ? ["claude-haiku-5-5", "claude-sonnet-5-5"] : provider === "openai" ? ["gpt-6-luna"] : provider === "katana" ? ["glm-5-3-flash-private", "deepseek-v4-flash"] : ["muse-spark-1.3-contributor"]);
    expect(inventory.models.map(model => model.catalogId).sort()).toEqual([
      "anthropic:claude-haiku-5-5", "katana:deepseek-v4-flash", "meta-muse:muse-spark-1.3-contributor", "openai:gpt-6-luna",
    ]);
    expect(inventory.models.find(model => model.catalogId === "anthropic:claude-haiku-5-5")).toMatchObject({ configured: true, available: true, metadata: { rateCard: { rates: { inputPer1M: 0.1, outputPer1M: 0.5 } } } });
  });

  test("OpenAI discovery exposes Sol rates and omits media models without hiding image-input text models", async () => {
    const excluded = ["gpt-image-2", "gpt-image-1-mini", "gpt-image-1.5", "chatgpt-image-latest", "gpt-image-1",
      "gpt-image-2-2026-04-21", "sora-2", "gpt-4o-transcribe", "omni-moderation-latest"];
    const inventory = await providerModelInventory({ OPENAI_API_KEY: "fixture" }, true,
      async () => ["gpt-6.1-sol", "gpt-6-luna", ...excluded]);
    expect(inventory.models.find(model => model.catalogId === "openai:gpt-6.1-sol")).toMatchObject({
      available: true, capabilityEvidence: "documented", capabilities: { supportsImageInput: true, supportsOpenAIResponses: true },
      metadata: { rateCard: { rates: { inputPer1M: 2, outputPer1M: 10 } } },
    });
    expect(inventory.models.find(model => model.catalogId === "openai:gpt-6-luna")?.available).toBe(true);
    for (const id of excluded) expect(inventory.models.some(model => model.catalogId === `openai:${id}`)).toBe(false);
  });

  test("inventory uses audited capabilities and filters known strict-output incompatibilities", async () => {
    const inventory = await providerModelInventory({ OPENAI_API_KEY: "fixture", API_KAT_IMGNAI_KEY: "fixture", API_KAT_IMGNAI_SECRET: "fixture" }, true,
      async provider => provider === "openai" ? ["gpt-6-astra", "gpt-5-mini-2025-08-07", "gpt-4o-2024-05-13", "o3-deep-research"]
        : ["glm-5-3-flash-private", "kimi-k3", "qwen3-coder-480b-a35b-private"]);
    expect(inventory.models.find(model => model.catalogId === "openai:gpt-5-mini-2025-08-07"))
      .toMatchObject({ capabilityEvidence: "documented", metadata: { rateCard: { rates: { inputPer1M: .25, outputPer1M: 2 } } } });
    expect(inventory.models.find(model => model.catalogId === "katana:glm-5-3-flash-private"))
      .toMatchObject({ allowedReasoningPolicies: ["action-policy", "low", "medium", "high"] });
    for (const id of ["openai:gpt-4o-2024-05-13", "openai:o3-deep-research", "katana:qwen3-coder-480b-a35b-private"]) {
      expect(inventory.models.some(model => model.catalogId === id)).toBe(false);
    }
  });

  test("projects the resolved catalog for documented and unknown discovered models", async () => {
    const inventory = await providerModelInventory({ API_KAT_IMGNAI_KEY: "fixture", API_KAT_IMGNAI_SECRET: "fixture" }, true,
      async () => ["kimi-k3", "unlisted-example"]);
    for (const id of ["katana:kimi-k3", "katana:unlisted-example"]) {
      const resolved = modelCatalogEntryById(id)!;
      const model = inventory.models.find(model => model.catalogId === id)!;
      expect(model.metadata).toEqual(resolved.metadata);
      expect(model.capabilities).toEqual(resolved.capabilities);
      expect(model.capabilityEvidence).toBe(resolved.capabilityEvidence);
      expect(model.notes).toBeNull();
    }
  });

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
          return ["gpt-5-nano", "gpt-5-mini", "gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.6-luna", "gpt-6-luna"];
        },
      },
    ));

    expect((await app.request("/api/provider-models")).status).toBe(401);

    await seedRBAC(db);
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "sysop"));
    await db.insert(schema.userRoles).values({ userId: USER_ID, roleId: role!.id });
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
    expect(body.models.find((model) => model.catalogId === "openai:gpt-6-luna"))
      .toMatchObject({
        configured: true,
        available: true,
        allowedReasoningPolicies: ["action-policy", "low", "medium", "high"],
        capabilities: { supportsImageInput: true, supportsOpenAIResponses: true, supportsTemperature: false },
      });
    expect(calls).toEqual(["openai"]);
    expect(body.models.find((model) => model.catalogId === "openai:gpt-6-luna"))
      .toMatchObject({ configured: true, available: true, allowedReasoningPolicies: ["action-policy", "low", "medium", "high"] });
    expect(body.models.find((model) => model.catalogId === "openai:gpt-5.6-luna"))
      .toMatchObject({ configured: true, available: true });
    expect(body.models.find((model) => model.catalogId === "xai:grok-4.5"))
      .toMatchObject({ configured: false, available: null, allowedReasoningPolicies: ["action-policy", "low", "medium", "high"] });
    expect(body.models.find((model) => model.catalogId === "katana:glm-5-2"))
      .toMatchObject({ configured: false, allowedReasoningPolicies: ["action-policy"] });
  });

  test("lists configured Meta Muse text models and never non-text Meta models", async () => {
    const db = await setupTestDB();
    await db.insert(schema.users).values({
      id: USER_ID,
      walletAddress: "0x9999999999999999999999999999999999999999",
      displayName: "Provider Inventory User",
    });
    const app = new Hono().route("/", createProviderModelRoutes(
      db,
      { META_MUSE_API_KEY: "configured" } as NodeJS.ProcessEnv,
      {
        async listModelIds(providerProfileId) {
          if (providerProfileId !== "meta-muse") throw new Error("unexpected provider");
          return ["muse-wonder-1.0", "sam-3.1", "muse-spark-1.3-contributor", "muse-voice-transcribe-1.0", "muse-spark-1.3", "muse-image-1.0", "muse-spark-1.2"];
        },
      },
    ));
    await seedRBAC(db);
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "sysop"));
    await db.insert(schema.userRoles).values({ userId: USER_ID, roleId: role!.id });
    const token = await createSessionToken(USER_ID, { roles: ["sysop"], permissions: [] });
    const response = await app.request("/api/provider-models", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      models: Array<{ catalogId: string; configured: boolean; available: boolean | null }>;
    };
    expect(body.status).toBe("complete");
    expect(body.models.find((model) => model.catalogId === "meta-muse:muse-spark-1.3-contributor"))
      .toMatchObject({ configured: true, available: true });
    expect(body.models.find((model) => model.catalogId === "meta-muse:muse-wonder-1.0"))
      .toMatchObject({ configured: true, available: true });
    expect(body.models.some((model) => model.catalogId === "meta-muse:muse-image-1.0")).toBe(false);
    expect(body.models.some((model) => model.catalogId === "meta-muse:sam-3.1")).toBe(false);
    expect(body.models.some((model) => model.catalogId === "meta-muse:muse-voice-transcribe-1.0")).toBe(false);
    expect(body.models.some((model) => model.catalogId === "meta-muse:muse-spark-1.2")).toBe(true);
  });

  test("returns a partial inventory with provider-specific failures and retains working listings", async () => {
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
    await seedRBAC(db);
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "sysop"));
    await db.insert(schema.userRoles).values({ userId: USER_ID, roleId: role!.id });
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
      providers: Array<{ providerProfileId: string; displayName: string; status: string }>;
      models: Array<{ catalogId: string; configured: boolean; available: boolean | null }>;
    };
    expect(body.status).toBe("partial");
    expect(body.providers).toEqual([
      { providerProfileId: "openai", displayName: "OpenAI", status: "complete" },
      { providerProfileId: "katana", displayName: "Katana (IMGNAI)", status: "unavailable" },
    ]);
    expect(body.models.find((model) => model.catalogId === "openai:gpt-5.6-luna"))
      .toMatchObject({ configured: true, available: true });
    expect(body.models.find((model) => model.catalogId === "katana:glm-5-2"))
      .toMatchObject({ configured: true, available: null });
  });

  test("offline local catalogs preserve discovered hosted models and unknown local availability", async () => {
    const inventory = await providerModelInventory({
      OPENAI_API_KEY: "configured", META_MUSE_API_KEY: "configured",
      API_KAT_IMGNAI_KEY: "configured", API_KAT_IMGNAI_SECRET: "configured",
      INFLUENCE_LLM_BASE_URL: "http://127.0.0.1:1234/v1",
    }, true, async provider => {
      if (provider === "lm-studio" || provider === "custom-openai-compatible") throw new Error("private upstream response");
      if (provider === "openai") return ["gpt-6-luna", "gpt-new-text-model"];
      if (provider === "katana") return ["deepseek-v4-flash"];
      return ["muse-spark-1.3-contributor"];
    });
    expect(inventory.status).toBe("partial");
    expect(inventory.providers.filter(provider => provider.status === "unavailable")).toEqual([
      { providerProfileId: "lm-studio", displayName: "LM Studio", status: "unavailable" },
      { providerProfileId: "custom-openai-compatible", displayName: "OpenAI-compatible", status: "unavailable" },
    ]);
    for (const catalogId of ["openai:gpt-new-text-model", "katana:deepseek-v4-flash", "meta-muse:muse-spark-1.3-contributor"]) {
      expect(inventory.models.find(model => model.catalogId === catalogId)).toMatchObject({ configured: true, available: true });
    }
    expect(inventory.models.filter(model => model.providerProfileId === "lm-studio").every(model => model.available === null)).toBe(true);
    expect(JSON.stringify(inventory)).not.toContain("private upstream response");
    expect(JSON.stringify(inventory)).not.toContain("127.0.0.1");
  });

  test("distinguishes all failed catalogs from no configured providers", async () => {
    const failed = await providerModelInventory({ OPENAI_API_KEY: "configured" }, true, async () => { throw new Error("offline"); });
    expect(failed.status).toBe("unavailable");
    expect(failed.providers).toEqual([{ providerProfileId: "openai", displayName: "OpenAI", status: "unavailable" }]);
    expect(failed.models.find(model => model.catalogId === "openai:gpt-6-luna")).toMatchObject({ configured: true, available: null });
    const empty = await providerModelInventory({}, true, async () => { throw new Error("must not run"); });
    expect(empty.status).toBe("complete");
    expect(empty.providers).toEqual([]);
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
    await seedRBAC(db);
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "sysop"));
    await db.insert(schema.userRoles).values({ userId: USER_ID, roleId: role!.id });
    const token = await createSessionToken(USER_ID, { roles: ["sysop"], permissions: [] });
    const response = await app.request("/api/provider-models", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as {
      status: string;
      models: Array<{ catalogId: string; configured: boolean; available: boolean | null }>;
    };

    expect(body.status).toBe("complete");
    expect(body.models.find((model) => model.catalogId === "katana:grok-4-5")).toBeUndefined();
    expect(body.models.find((model) => model.catalogId === "katana:glm-5-2"))
      .toMatchObject({ configured: true, available: false });
  });

  test("includes dynamically listed OpenAI and Katana models without reviving disabled catalog entries", async () => {
    const db = await setupTestDB();
    await db.insert(schema.users).values({
      id: USER_ID,
      walletAddress: "0x9999999999999999999999999999999999999999",
      displayName: "Provider Inventory User",
    });
    const app = new Hono().route("/", createProviderModelRoutes(
      db,
      {
        OPENAI_API_KEY: "configured-openai",
        API_KAT_IMGNAI_KEY: "configured-katana",
        API_KAT_IMGNAI_SECRET: "configured-katana-secret",
      } as NodeJS.ProcessEnv,
      {
        async listModelIds(providerProfileId) {
          return providerProfileId === "openai"
            ? ["gpt-5.6-luna", "gpt-5.7-test"]
            : ["grok-4-5", "deepseek-v3", "q-naifu-a3b"];
        },
      },
    ));
    await seedRBAC(db);
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "sysop"));
    await db.insert(schema.userRoles).values({ userId: USER_ID, roleId: role!.id });
    const token = await createSessionToken(USER_ID, { roles: ["sysop"], permissions: [] });
    const response = await app.request("/api/provider-models", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as {
      models: Array<{ catalogId: string; available: boolean | null }>;
    };

    expect(body.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ catalogId: "openai:gpt-5.7-test", available: true }),
      expect.objectContaining({ catalogId: "katana:deepseek-v3", available: true }),
    ]));
    expect(body.models.some((model) => model.catalogId === "katana:q-naifu-a3b"))
      .toBe(true);
  });
});
