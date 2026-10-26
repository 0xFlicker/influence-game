import { GameModelRoutingError, readGameModelRouting, saveModelPreference } from "../services/game-model-routing.js";
import { Hono } from "hono";
import {
  createLlmClientFromEnv,
  MODEL_REASONING_POLICIES,
  MODEL_CATALOG, FREE_MODEL_CATALOG_IDS, PROVIDER_PROFILES,
  modelCatalogEntryById,
  preferredClaudeCatalogId,
  type ProviderProfileId,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

function providerConfigured(
  providerProfileId: string,
  env: NodeJS.ProcessEnv,
): boolean {
  if (providerProfileId === "openai") return Boolean(env.OPENAI_API_KEY?.trim());
  if (providerProfileId === "anthropic") return Boolean(env.ANTHROPIC_API_KEY?.trim());
  if (providerProfileId === "katana") {
    return Boolean(
      env.API_KAT_IMGNAI_KEY?.trim()
      && env.API_KAT_IMGNAI_SECRET?.trim(),
    );
  }
  if (providerProfileId === "meta-muse") return Boolean(env.META_MUSE_API_KEY?.trim());
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
    const privileged = c.get("userRoles").some(role => role === "admin" || role === "sysop");
    const inventory = await providerModelInventory(env, privileged, listModelIds);
    c.header("Cache-Control", "no-store");
    return c.json(inventory);
  });

  app.patch("/api/agent-profiles/:id/model-preference", requireAuth(db), async c => {
    const body = await c.req.json().catch(() => null);
    if (!body || Object.keys(body).some(key => key !== "modelPreference") || !Object.hasOwn(body, "modelPreference")) return c.json({ error: "Provide modelPreference" }, 400);
    try { return c.json(await saveModelPreference(db, c.get("user").id, c.req.param("id"), body.modelPreference)); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : "Invalid preference" }, error instanceof GameModelRoutingError ? error.status : 400); }
  });
  app.get("/api/model-routing/games/:id", requireAuth(db), async c => {
    try { return c.json(await readGameModelRouting(db, c.get("user").id, c.req.param("id"))); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : "Model settings unavailable" }, error instanceof GameModelRoutingError ? error.status : 400); }
  });
  app.put("/api/model-routing/games/:id", requireAuth(db), async c => {
    const body = await c.req.json().catch(() => null);
    try { return c.json(await readGameModelRouting(db, c.get("user").id, c.req.param("id"), body)); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : "Invalid model settings" }, error instanceof GameModelRoutingError ? error.status : 400); }
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
  const ids: string[] = [];
  for await (const model of llm.client.models.list()) ids.push(model.id);
  return ids;
}

export async function providerModelInventory(env: NodeJS.ProcessEnv, privileged: boolean, listModelIds = listConfiguredProviderModelIds) {
    const staticCatalog = MODEL_CATALOG;
    const configuredProviderIds = Object.values(PROVIDER_PROFILES).map(profile => profile.id).filter(id => providerConfigured(id, env));
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
    const failedCount = listings.filter(listing => !listing.available).length;
    const status = failedCount === 0 ? "complete" as const
      : failedCount === listings.length ? "unavailable" as const : "partial" as const;
    const providers = listings.map(listing => ({
      providerProfileId: listing.providerProfileId,
      displayName: listing.providerProfileId === "lm-studio" ? "LM Studio" : PROVIDER_PROFILES[listing.providerProfileId].label,
      status: listing.available ? "complete" as const : "unavailable" as const,
    }));
    const catalogById = new Map(staticCatalog.map((entry) => [entry.id, entry]));
    for (const listing of listings) {
      if (!listing.available || !listing.modelIds) continue;
      for (const modelId of listing.modelIds) {
        const catalogId = `${listing.providerProfileId}:${modelId}`;
        const entry = modelCatalogEntryById(catalogId);
        // Experimental text models remain selectable for operators; inferred
        // capabilities are labelled rather than treated as paid qualification.
        if (entry) {
          catalogById.set(catalogId, entry);
        }
      }
    }
    const catalog = [...catalogById.values()].filter(entry => entry.capabilities.supportsStructuredOutput
      && preferredClaudeCatalogId(entry.id) === entry.id
      && (privileged || FREE_MODEL_CATALOG_IDS.some(id => id === entry.id)));
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
      experimental: entry.evaluationStatus !== "game-ready",
      capabilityEvidence: entry.capabilityEvidence,
      metadata: entry.metadata,
    };
    });
  return { status, providers, models };
}
