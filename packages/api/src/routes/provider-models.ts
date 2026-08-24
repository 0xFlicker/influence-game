import { Hono } from "hono";
import {
  createLlmClientFromEnv,
  MODEL_REASONING_POLICIES,
  gameReadyCatalogEntries,
  type ProviderProfileId,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

function providerConfigured(
  providerProfileId: string,
  env: NodeJS.ProcessEnv,
): boolean {
  if (providerProfileId === "openai") return Boolean(env.OPENAI_API_KEY?.trim());
  if (providerProfileId === "katana") {
    return Boolean(
      env.API_KAT_IMGNAI_KEY?.trim()
      && env.API_KAT_IMGNAI_SECRET?.trim(),
    );
  }
  if (providerProfileId === "lm-studio" || providerProfileId === "custom-openai-compatible") {
    return Boolean(env.INFLUENCE_LLM_BASE_URL?.trim());
  }
  return false;
}

export function createProviderModelRoutes(
  db: DrizzleDB,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: {
    listModelIds?: (
      providerProfileId: ProviderProfileId,
      env: NodeJS.ProcessEnv,
    ) => Promise<readonly string[]>;
  } = {},
) {
  const app = new Hono<AuthEnv>();
  const listModelIds = dependencies.listModelIds ?? listConfiguredProviderModelIds;

  app.get("/api/provider-models", requireAuth(db), async (c) => {
    const catalog = gameReadyCatalogEntries();
    const configuredProviderIds = [...new Set(
      catalog
        .map((entry) => entry.providerProfileId)
        .filter((providerProfileId) => providerConfigured(providerProfileId, env)),
    )];
    const listings = await Promise.all(configuredProviderIds.map(async (providerProfileId) => {
      try {
        return {
          providerProfileId,
          modelIds: new Set(await listModelIds(providerProfileId, env)),
          available: true as const,
        };
      } catch {
        return {
          providerProfileId,
          modelIds: null,
          available: false as const,
        };
      }
    }));
    const listingByProvider = new Map(
      listings.map((listing) => [listing.providerProfileId, listing]),
    );
    const status = listings.some((listing) => !listing.available)
      ? "unavailable" as const
      : "complete" as const;
    const models = catalog.map((entry) => {
      const configured = providerConfigured(entry.providerProfileId, env);
      const listing = listingByProvider.get(entry.providerProfileId);
      return {
      catalogId: entry.id,
      providerProfileId: entry.providerProfileId,
      modelId: entry.modelId,
      displayName: entry.displayName,
      configured,
      available: !configured || !listing?.available
        ? null
        : listing.modelIds.has(entry.modelId),
      defaultReasoningPolicy: entry.defaultReasoningPolicy,
      allowedReasoningPolicies: MODEL_REASONING_POLICIES.filter(
        (policy) => policy === "action-policy" || entry.allowedReasoningEfforts.includes(policy),
      ),
      capabilities: entry.capabilities,
      notes: entry.notes ?? null,
    };
    });
    c.header("Cache-Control", "no-store");
    return c.json({
      status,
      models,
    });
  });

  return app;
}

async function listConfiguredProviderModelIds(
  providerProfileId: ProviderProfileId,
  env: NodeJS.ProcessEnv,
): Promise<readonly string[]> {
  const llm = createLlmClientFromEnv(env, {
    providerProfileId,
    maxRetries: 0,
    timeout: 5_000,
  });
  if (!llm) throw new Error("Provider is not configured");
  const models = await llm.client.models.list();
  return models.data.map((model) => model.id);
}
