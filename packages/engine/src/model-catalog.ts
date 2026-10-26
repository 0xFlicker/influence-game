import { normalizeGameModelRouting, type GameModelRouting } from "./game-model-routing";
import { modelRouteMetadata } from "./model-route-metadata";
import type { OpenAIReasoningSummaryMode } from "./llm-client";
import anthropic from "./anthropic-catalog-snapshot.json";

export { DEFAULT_MODEL_CATALOG_ID, DEFAULT_MODEL_ID } from "./model-defaults";

export type ProviderProfileId = "openai" | "anthropic" | "lm-studio" | "katana" | "meta-muse" | "custom-openai-compatible";
export type ModelReasoningEffort = "low" | "medium" | "high";
export type ModelReasoningPolicy = "action-policy" | ModelReasoningEffort;
export type ModelEvaluationStatus = "game-ready" | "evaluation-candidate" | "disabled";

export interface ModelRequestCapabilities {
  supportsImageInput: boolean;
  supportsReasoningEffort: boolean;
  supportsToolReasoningEffort: boolean;
  usesMaxCompletionTokens: boolean;
  supportsTemperature: boolean;
  supportsOpenAIResponses: boolean;
  supportsPromptCacheRetention: boolean;
  supportsStructuredOutput: boolean;
  supportsTools: boolean;
  /** Audited hosted OpenAI capacity support; absent for unknown/historical metadata. */
  supportsFlexProcessing?: boolean;
  /** Native controls frozen with the route, never inferred again on recovery. */
  anthropic?: { apiVersion: "2026-10-21"; thinking: "adaptive" | "disabled" };
}

export interface ProviderProfile {
  id: ProviderProfileId;
  label: string;
  baseURL?: string;
  isLocal: boolean;
  openAIReasoningSummary?: OpenAIReasoningSummaryMode;
}

export interface ModelCatalogEntry {
  id: string;
  providerProfileId: ProviderProfileId;
  modelId: string;
  displayName: string;
  evaluationStatus: ModelEvaluationStatus;
  defaultReasoningPolicy: ModelReasoningPolicy;
  allowedReasoningEfforts: readonly ModelReasoningEffort[];
  capabilities: ModelRequestCapabilities;
  notes?: string;
  capabilityEvidence?: "documented" | "inferred";
}

export interface ResolvedModelCatalogEntry extends ModelCatalogEntry {
  capabilityEvidence: "documented" | "inferred";
  metadata: ReturnType<typeof modelRouteMetadata>;
}

export interface ResolvedModelSelection {
  catalogId: string;
  providerProfile: ProviderProfile;
  model: ModelCatalogEntry;
  modelId: string;
  reasoningPolicy: ModelReasoningPolicy;
}

export interface GameModelSelection {
  catalogId: string;
  reasoningPolicy?: ModelReasoningPolicy;
}

export interface GameProviderManifestEntry extends GameModelSelection {
  /** Required for fallback entries; primary calls remain governed by the game lifecycle. */
  maxCallsPerGame?: number;
}

export type GameProviderManifest = GameProviderManifestEntry[];

export interface ResolvedProviderManifestEntry extends ResolvedModelSelection {
  position: number;
  role: "primary" | "fallback";
  maxCallsPerGame?: number;
}

export const MAX_PROVIDER_MANIFEST_ENTRIES = 8;
export const MAX_PROVIDER_ENTRY_CALLS_PER_GAME = 10_000;
export const MAX_PROVIDER_MANIFEST_CALLS_PER_GAME = 25_000;

export const MODEL_REASONING_EFFORTS = ["low", "medium", "high"] as const;
export const MODEL_REASONING_POLICIES = ["action-policy", ...MODEL_REASONING_EFFORTS] as const;

export const PROVIDER_PROFILES: Record<ProviderProfileId, ProviderProfile> = {
  anthropic: { id: "anthropic", label: "Anthropic", isLocal: false },
  openai: {
    id: "openai",
    label: "OpenAI",
    isLocal: false,
    openAIReasoningSummary: "auto",
  },
  "lm-studio": {
    id: "lm-studio",
    label: "OpenAI-compatible local",
    isLocal: true,
  },
  katana: {
    id: "katana",
    label: "Katana (IMGNAI)",
    baseURL: "https://kat.imgnai.com/v1",
    isLocal: false,
  },
  "meta-muse": {
    id: "meta-muse",
    label: "Meta Muse",
    baseURL: "https://api.meta.ai/v1",
    isLocal: false,
  },
  "custom-openai-compatible": {
    id: "custom-openai-compatible",
    label: "OpenAI-compatible",
    isLocal: false,
  },
};

const OPENAI_GPT5_CAPABILITIES: ModelRequestCapabilities = {
  supportsImageInput: false,
  supportsReasoningEffort: true,
  supportsToolReasoningEffort: true,
  usesMaxCompletionTokens: true,
  supportsTemperature: false,
  supportsOpenAIResponses: true,
  supportsPromptCacheRetention: false,
  supportsStructuredOutput: true,
  supportsTools: true,
};

const OPENAI_GPT54_CAPABILITIES: ModelRequestCapabilities = {
  ...OPENAI_GPT5_CAPABILITIES,
  supportsToolReasoningEffort: false,
};

const OPENAI_GPT56_CAPABILITIES: ModelRequestCapabilities = {
  ...OPENAI_GPT54_CAPABILITIES,
  supportsPromptCacheRetention: true,
};

const STANDARD_CHAT_CAPABILITIES: ModelRequestCapabilities = {
  supportsImageInput: false,
  supportsReasoningEffort: false,
  supportsToolReasoningEffort: false,
  usesMaxCompletionTokens: false,
  supportsTemperature: true,
  supportsOpenAIResponses: false,
  supportsPromptCacheRetention: false,
  supportsStructuredOutput: true,
  supportsTools: true,
};

const KATANA_GROK_CAPABILITIES: ModelRequestCapabilities = {
  supportsImageInput: false,
  supportsReasoningEffort: true,
  supportsToolReasoningEffort: true,
  usesMaxCompletionTokens: false,
  supportsTemperature: true,
  supportsOpenAIResponses: false,
  supportsPromptCacheRetention: false,
  supportsStructuredOutput: true,
  supportsTools: true,
};

// Meta Muse dispatches through its own Responses adapter; the
// supportsOpenAIResponses flag stays false because it gates hosted-OpenAI
// byte-budget behavior. Meta documents image input; the Responses adapter preserves it.
const META_MUSE_CAPABILITIES: ModelRequestCapabilities = {
  supportsImageInput: true,
  supportsReasoningEffort: true,
  supportsToolReasoningEffort: true,
  usesMaxCompletionTokens: true,
  supportsTemperature: false,
  supportsOpenAIResponses: false,
  supportsPromptCacheRetention: false,
  supportsStructuredOutput: true,
  supportsTools: true,
};

type ModelDefinition = Omit<ModelCatalogEntry, "capabilities" | "allowedReasoningEfforts">;

const MODEL_DEFINITIONS: readonly ModelDefinition[] = [
  ...Object.entries(anthropic.models).map(([modelId, facts]): ModelDefinition => ({
    id: `anthropic:${modelId}`, providerProfileId: "anthropic", modelId,
    displayName: facts.displayName,
    evaluationStatus: modelId === "claude-haiku-5-5" ? "game-ready" : "evaluation-candidate",
    defaultReasoningPolicy: facts.adaptive ? "low" : "action-policy",
  })),
  {
    "id": "katana:glm-5-3-flash-private",
    "providerProfileId": "katana",
    "modelId": "glm-5-3-flash-private",
    "displayName": "GLM Flash",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "katana:deepseek-v4-flash",
    "providerProfileId": "katana",
    "modelId": "deepseek-v4-flash",
    "displayName": "DeepSeek Flash",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "openai:gpt-5-nano",
    "providerProfileId": "openai",
    "modelId": "gpt-5-nano",
    "displayName": "OpenAI gpt-5-nano",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "openai:gpt-5-mini",
    "providerProfileId": "openai",
    "modelId": "gpt-5-mini",
    "displayName": "OpenAI gpt-5-mini",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "openai:gpt-5.4-nano",
    "providerProfileId": "openai",
    "modelId": "gpt-5.4-nano",
    "displayName": "OpenAI gpt-5.4-nano",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "openai:gpt-5.4-mini",
    "providerProfileId": "openai",
    "modelId": "gpt-5.4-mini",
    "displayName": "OpenAI gpt-5.4-mini",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "openai:gpt-5.6-luna",
    "providerProfileId": "openai",
    "modelId": "gpt-5.6-luna",
    "displayName": "OpenAI gpt-5.6-luna",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "openai:gpt-6-luna",
    "providerProfileId": "openai",
    "modelId": "gpt-6-luna",
    "displayName": "OpenAI gpt-6-luna",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "openai:gpt-6.1-sol",
    "providerProfileId": "openai",
    "modelId": "gpt-6.1-sol",
    "displayName": "OpenAI gpt-6.1-sol",
    "evaluationStatus": "evaluation-candidate",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "openai:gpt-6.1-terra",
    "providerProfileId": "openai",
    "modelId": "gpt-6.1-terra",
    "displayName": "OpenAI gpt-6.1-terra",
    "evaluationStatus": "evaluation-candidate",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "katana:grok-4-6",
    "providerProfileId": "katana",
    "modelId": "grok-4-6",
    "displayName": "xAI Grok 4.6",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "katana:grok-4-3",
    "providerProfileId": "katana",
    "modelId": "grok-4-3",
    "displayName": "xAI Grok 4.3",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "katana:grok-4-5",
    "providerProfileId": "katana",
    "modelId": "grok-4-5",
    "displayName": "xAI Grok 4.5",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "katana:grok-4-20-multi-agent",
    "providerProfileId": "katana",
    "modelId": "grok-4-20-multi-agent",
    "displayName": "xAI Grok multi-agent",
    "evaluationStatus": "evaluation-candidate",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "katana:q-naifu-a3b",
    "providerProfileId": "katana",
    "modelId": "q-naifu-a3b",
    "displayName": "Katana q-naifu-a3b",
    "evaluationStatus": "disabled",
    "defaultReasoningPolicy": "action-policy",
    "notes": "Failed local API-backed Influence evaluation: JSON Schema transport worked, but core vote/revote/strategy decisions were repeatedly empty or semantically invalid and advanced via fallbacks."
  },
  {
    "id": "katana:glm-5-2",
    "providerProfileId": "katana",
    "modelId": "glm-5-2",
    "displayName": "Katana GLM 5.2",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "meta-muse:muse-spark-1.3",
    "providerProfileId": "meta-muse",
    "modelId": "muse-spark-1.3",
    "displayName": "Meta Muse Spark 1.3",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "meta-muse:muse-spark-1.3-contributor",
    "providerProfileId": "meta-muse",
    "modelId": "muse-spark-1.3-contributor",
    "displayName": "Meta Muse Spark 1.3 Contributor",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  },
  {
    "id": "meta-muse:muse-wonder-1.0",
    "providerProfileId": "meta-muse",
    "modelId": "muse-wonder-1.0",
    "displayName": "Meta Muse Wonder 1.0",
    "evaluationStatus": "game-ready",
    "defaultReasoningPolicy": "action-policy"
  }
];

export const MODEL_CATALOG: readonly ResolvedModelCatalogEntry[] = MODEL_DEFINITIONS.map(resolveCatalogMetadata);
const MODEL_BY_ID = new Map(MODEL_CATALOG.map((entry) => [entry.id, entry]));
const MODEL_BY_PROVIDER_AND_MODEL = new Map(
  MODEL_CATALOG.map((entry) => [`${entry.providerProfileId}:${entry.modelId}`, entry]),
);

// Discovery lists every provider product, not just game decision models. Apply
// this at catalog resolution so exact IDs cannot bypass the same restriction.
// Image-input text models remain eligible; these are non-decision model families.
const NON_DECISION_MODEL_ID = /(?:embedding|whisper|dall-e|tts|segmentation|(?:^|\/)sam-|muse-image|muse-video|muse-voice|(?:chat)?gpt-image|image-gen|realtime|audio|transcribe|moderation|search-api|(?:^|\/)sora(?:-|$)|(?:^|\/)gpt-live(?:-|$))/i;

function dynamicOpenAICompatibleCatalogEntry(catalogId: string): ModelCatalogEntry | undefined {
  const [profileId, ...modelParts] = catalogId.split(":");
  if (
    profileId !== "openai"
    && profileId !== "anthropic"
    && profileId !== "katana"
    && profileId !== "lm-studio"
    && profileId !== "custom-openai-compatible"
    && profileId !== "meta-muse"
  ) {
    return undefined;
  }
  const modelId = modelParts.join(":").trim();
  if (!modelId || modelId.includes(":") || modelId.length > 200 || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(modelId) || NON_DECISION_MODEL_ID.test(modelId)) return undefined;
  const providerProfileId = profileId;
  // Native request controls are frozen from audited facts, never guessed from
  // a newly discovered name. Add a snapshot entry before enabling a new Claude.
  if (providerProfileId === "anthropic") return undefined;
  const label = providerProfileId === "openai"
    ? "OpenAI"
    : providerProfileId === "katana"
    ? "Katana"
    : providerProfileId === "lm-studio"
      ? "LM Studio"
      : "OpenAI-compatible";
  return {
    id: catalogId,
    providerProfileId,
    modelId,
    displayName: `${label} ${modelId}`,
    evaluationStatus: "evaluation-candidate",
    defaultReasoningPolicy: "action-policy",
    allowedReasoningEfforts: inferUnlistedModelCapabilities(modelId, providerProfileId)
      .supportsReasoningEffort
      ? MODEL_REASONING_EFFORTS
      : [],
    capabilities: inferUnlistedModelCapabilities(modelId, providerProfileId),
    capabilityEvidence: "inferred",
  };
}

export function normalizeReasoningPolicy(value: unknown): ModelReasoningPolicy | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace("_", "-");
  if (normalized === "action" || normalized === "action-policy" || normalized === "auto") {
    return "action-policy";
  }
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return null;
}

export function normalizeGameModelSelection(value: unknown): GameModelSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const catalogId = typeof record.catalogId === "string" ? record.catalogId : undefined;
  if (!catalogId) return null;
  const hasReasoningPolicy = Object.prototype.hasOwnProperty.call(record, "reasoningPolicy");
  const reasoningPolicy = hasReasoningPolicy
    ? normalizeReasoningPolicy(record.reasoningPolicy)
    : null;
  if (hasReasoningPolicy && !reasoningPolicy) return null;
  return {
    catalogId,
    ...(reasoningPolicy && { reasoningPolicy }),
  };
}

const PROVIDER_MANIFEST_ENTRY_KEYS = new Set([
  "catalogId",
  "reasoningPolicy",
  "maxCallsPerGame",
]);

function providerManifestError(message: string): never {
  throw new Error(`Invalid provider manifest: ${message}`);
}

/**
 * Validate and freeze the provider/model route selected at game creation.
 * Credentials and mutable provider-health state never belong in this value.
 */
export function normalizeProviderManifest(value: unknown): GameProviderManifest {
  if (!Array.isArray(value) || value.length === 0) {
    return providerManifestError("at least one entry is required");
  }
  if (value.length > MAX_PROVIDER_MANIFEST_ENTRIES) {
    return providerManifestError(`at most ${MAX_PROVIDER_MANIFEST_ENTRIES} entries are allowed`);
  }

  const seen = new Set<string>();
  let totalFallbackCalls = 0;
  const normalized = value.map((rawEntry, index): GameProviderManifestEntry => {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      return providerManifestError(`entry ${index + 1} must be an object`);
    }
    const record = rawEntry as Record<string, unknown>;
    const unknownKey = Object.keys(record).find((key) => !PROVIDER_MANIFEST_ENTRY_KEYS.has(key));
    if (unknownKey) {
      return providerManifestError(`entry ${index + 1} contains unsupported field ${unknownKey}`);
    }
    const selection = normalizeGameModelSelection(record);
    if (!selection) {
      return providerManifestError(`entry ${index + 1} has an invalid model selection`);
    }
    if (seen.has(selection.catalogId)) {
      return providerManifestError(`duplicate model ${selection.catalogId}`);
    }
    seen.add(selection.catalogId);

    const model = modelCatalogEntryById(selection.catalogId);
    if (!model) {
      return providerManifestError(`entry ${index + 1} references unknown model ${selection.catalogId}`);
    }
    if (!model.capabilities.supportsStructuredOutput) {
      return providerManifestError(`model ${selection.catalogId} is incompatible with Influence decisions`);
    }

    const reasoningPolicy = selection.reasoningPolicy ?? model.defaultReasoningPolicy;
    if (
      reasoningPolicy !== "action-policy"
      && !model.allowedReasoningEfforts.includes(reasoningPolicy)
    ) {
      return providerManifestError(
        `model ${selection.catalogId} does not support ${reasoningPolicy} reasoning`,
      );
    }

    if (index === 0) {
      if (Object.prototype.hasOwnProperty.call(record, "maxCallsPerGame")) {
        return providerManifestError("the primary entry cannot set maxCallsPerGame");
      }
      return {
        catalogId: selection.catalogId,
        reasoningPolicy,
      };
    }

    const maxCallsPerGame = record.maxCallsPerGame;
    if (!Number.isSafeInteger(maxCallsPerGame) || (maxCallsPerGame as number) < 1) {
      return providerManifestError(
        `fallback entry ${index + 1} requires a positive integer maxCallsPerGame`,
      );
    }
    if ((maxCallsPerGame as number) > MAX_PROVIDER_ENTRY_CALLS_PER_GAME) {
      return providerManifestError(
        `maxCallsPerGame must be at most ${MAX_PROVIDER_ENTRY_CALLS_PER_GAME}`,
      );
    }
    totalFallbackCalls += maxCallsPerGame as number;
    if (!Number.isSafeInteger(totalFallbackCalls) || totalFallbackCalls > MAX_PROVIDER_MANIFEST_CALLS_PER_GAME) {
      return providerManifestError(
        `fallback call budget must total at most ${MAX_PROVIDER_MANIFEST_CALLS_PER_GAME}`,
      );
    }
    return {
      catalogId: selection.catalogId,
      reasoningPolicy,
      maxCallsPerGame: maxCallsPerGame as number,
    };
  });

  return normalized;
}

/** Parse the repeatable CLI `catalog-id,key=value` provider-entry syntax. */
export function parseProviderManifestEntry(value: string): GameProviderManifestEntry {
  const [catalogIdPart, ...settings] = value.split(",");
  const catalogId = catalogIdPart?.trim();
  if (!catalogId) throw new Error("Provider entry requires a catalog id");
  const entry: GameProviderManifestEntry = { catalogId };
  for (const setting of settings) {
    const [rawKey, rawValue] = setting.split("=", 2);
    const key = rawKey?.trim();
    const settingValue = rawValue?.trim();
    if (!key || !settingValue) {
      throw new Error(`Invalid provider entry setting: ${setting}`);
    }
    if (key === "reasoning" || key === "reasoning-policy") {
      const reasoningPolicy = normalizeReasoningPolicy(settingValue);
      if (!reasoningPolicy) throw new Error(`Invalid provider entry reasoning policy: ${settingValue}`);
      entry.reasoningPolicy = reasoningPolicy;
    } else if (key === "max-calls" || key === "maxCallsPerGame") {
      entry.maxCallsPerGame = Number(settingValue);
    } else {
      throw new Error(`Unknown provider entry setting: ${key}`);
    }
  }
  return entry;
}

/** Resolve audited facts once, before any API, UI or runtime consumer reads a model. */
function resolveCatalogMetadata(entry: ModelDefinition & Partial<Pick<ModelCatalogEntry, "capabilities" | "allowedReasoningEfforts">>): ResolvedModelCatalogEntry {
  const metadata = modelRouteMetadata(entry.id);
  const documented = metadata.documented;
  if (documented) return { ...entry, metadata, capabilityEvidence: "documented", capabilities: { ...documented.capabilities },
    allowedReasoningEfforts: documented.allowedReasoningEfforts };
  if (!entry.capabilities || !entry.allowedReasoningEfforts) throw new Error(`Missing audited model facts: ${entry.id}`);
  // Unknown modalities may be attempted through the strict adapter; they are
  // not presented as documented support in the catalog.
  return { ...entry, metadata, allowedReasoningEfforts: entry.allowedReasoningEfforts, capabilityEvidence: entry.capabilityEvidence ?? "inferred",
    capabilities: entry.capabilityEvidence === "inferred" ? { ...entry.capabilities, supportsImageInput: true } : entry.capabilities };
}

export function modelCatalogEntryById(catalogId: string): ResolvedModelCatalogEntry | undefined {
  const known = MODEL_BY_ID.get(catalogId);
  if (known) return known;
  const entry = dynamicOpenAICompatibleCatalogEntry(catalogId);
  const resolved = entry ? resolveCatalogMetadata(entry) : undefined;
  return resolved;
}

export function providerProfileById(profileId: ProviderProfileId): ProviderProfile {
  return PROVIDER_PROFILES[profileId];
}

export function resolveCatalogIdForModel(
  modelId: string,
  providerProfileId: ProviderProfileId = "openai",
): string | undefined {
  return MODEL_BY_PROVIDER_AND_MODEL.get(`${providerProfileId}:${modelId}`)?.id;
}

export function inferModelCapabilities(
  modelId: string,
  providerProfileId: ProviderProfileId = "openai",
): ModelRequestCapabilities {
  return modelCatalogEntryById(`${providerProfileId}:${modelId}`)?.capabilities
    ?? inferUnlistedModelCapabilities(modelId, providerProfileId);
}

function inferUnlistedModelCapabilities(modelId: string, providerProfileId: ProviderProfileId): ModelRequestCapabilities {
  if (providerProfileId === "katana" && modelId.startsWith("grok-")) return KATANA_GROK_CAPABILITIES;
  if (providerProfileId === "meta-muse" && modelId.startsWith("muse-")) return META_MUSE_CAPABILITIES;
  if (/^gpt-5\.[6-9]/.test(modelId)) return OPENAI_GPT56_CAPABILITIES;
  if (/^gpt-5\.[4-5]/.test(modelId)) return OPENAI_GPT54_CAPABILITIES;
  if (/^o\d/.test(modelId) || modelId.startsWith("gpt-5")) return OPENAI_GPT5_CAPABILITIES;
  return STANDARD_CHAT_CAPABILITIES;
}

export function gameReadyCatalogEntries(): ModelCatalogEntry[] {
  return MODEL_CATALOG.filter((entry) => entry.evaluationStatus === "game-ready");
}

export function formatModelReasoningPolicy(policy: ModelReasoningPolicy): string {
  switch (policy) {
    case "action-policy":
      return "Adaptive";
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
  }
}

export function formatResolvedModelSelectionLabel(selection: ResolvedModelSelection): string {
  return `${selection.model.displayName} · ${formatModelReasoningPolicy(selection.reasoningPolicy)}`;
}

export function formatGameModelSelectionLabel(
  selection: GameModelSelection | null | undefined,
): string {
  return formatResolvedModelSelectionLabel(resolveModelSelection(selection));
}

export function resolveModelSelection(
  selection: GameModelSelection | null | undefined,
): ResolvedModelSelection {
  if (!selection) {
    throw new Error("Game model selection is required");
  }
  const catalogId = selection.catalogId;
  const entry = modelCatalogEntryById(catalogId);
  if (!entry) {
    throw new Error(`Unknown model catalog entry: ${catalogId}`);
  }
  const reasoningPolicy = selection?.reasoningPolicy ?? entry.defaultReasoningPolicy;
  if (
    reasoningPolicy !== "action-policy"
    && !entry.allowedReasoningEfforts.includes(reasoningPolicy)
  ) {
    throw new Error(`Unsupported reasoning policy ${reasoningPolicy} for model catalog entry ${entry.id}`);
  }
  return {
    catalogId: entry.id,
    providerProfile: providerProfileById(entry.providerProfileId),
    model: entry,
    modelId: entry.modelId,
    reasoningPolicy,
  };
}

export function resolveProviderManifest(
  manifest: unknown,
): ResolvedProviderManifestEntry[] {
  return normalizeProviderManifest(manifest).map((entry, position) => ({
    ...resolveModelSelection(entry),
    position,
    role: position === 0 ? "primary" : "fallback",
    ...(entry.maxCallsPerGame !== undefined && {
      maxCallsPerGame: entry.maxCallsPerGame,
    }),
  }));
}

/** Read the new manifest authority, falling back only for pre-migration stored games. */
export function resolveProviderManifestFromGameConfig(
  config: { providerManifest?: unknown; modelSelection?: unknown; modelRouting?: unknown },
): ResolvedProviderManifestEntry[] {
  if (config.modelRouting !== undefined) {
    const frozen = config.modelRouting as GameModelRouting;
    if (frozen.contestants) {
      if (!frozen.frozenRoutes?.default.length) throw new Error("Missing frozen default model runtime");
      return frozen.frozenRoutes.default;
    }
    return resolveProviderManifest(normalizeGameModelRouting(config.modelRouting).defaultManifest);
  }
  if (config.providerManifest !== undefined) {
    const manifest = resolveProviderManifest(config.providerManifest);
    if (config.modelSelection !== undefined) {
      const legacySelection = normalizeGameModelSelection(config.modelSelection);
      if (!legacySelection) {
        throw new Error("Invalid legacy model selection projection");
      }
      const legacyPrimary = resolveModelSelection(legacySelection);
      const manifestPrimary = manifest[0]!;
      if (
        legacyPrimary.catalogId !== manifestPrimary.catalogId
        || legacyPrimary.reasoningPolicy !== manifestPrimary.reasoningPolicy
      ) {
        throw new Error("Game provider manifest does not match its legacy primary projection");
      }
    }
    return manifest;
  }
  const legacySelection = normalizeGameModelSelection(config.modelSelection);
  if (!legacySelection) {
    throw new Error(config.modelSelection !== undefined ? "Invalid model selection" : "Game provider manifest is required");
  }
  return resolveProviderManifest([legacySelection]);
}
