import type { OpenAIReasoningSummaryMode, LlmToolChoiceMode } from "./llm-client";

export { DEFAULT_MODEL_CATALOG_ID, DEFAULT_MODEL_ID } from "./model-defaults";

export type ProviderProfileId = "openai" | "lm-studio" | "katana" | "custom-openai-compatible";
export type ModelReasoningEffort = "low" | "medium" | "high";
export type ModelReasoningPolicy = "action-policy" | ModelReasoningEffort;
export type ModelEvaluationStatus = "game-ready" | "evaluation-candidate" | "disabled";

export interface ModelRequestCapabilities {
  supportsReasoningEffort: boolean;
  supportsToolReasoningEffort: boolean;
  usesMaxCompletionTokens: boolean;
  supportsTemperature: boolean;
  supportsOpenAIResponses: boolean;
  supportsStructuredOutput: boolean;
  supportsTools: boolean;
}

export interface ProviderProfile {
  id: ProviderProfileId;
  label: string;
  baseURL?: string;
  isLocal: boolean;
  defaultToolChoiceMode: LlmToolChoiceMode;
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
  preferredToolChoiceMode?: LlmToolChoiceMode;
  notes?: string;
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
export const DEFAULT_FALLBACK_CALL_CAP = 12;

export const MODEL_REASONING_EFFORTS = ["low", "medium", "high"] as const;
export const MODEL_REASONING_POLICIES = ["action-policy", ...MODEL_REASONING_EFFORTS] as const;

export const PROVIDER_PROFILES: Record<ProviderProfileId, ProviderProfile> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    isLocal: false,
    defaultToolChoiceMode: "named",
    openAIReasoningSummary: "auto",
  },
  "lm-studio": {
    id: "lm-studio",
    label: "OpenAI-compatible local",
    isLocal: true,
    defaultToolChoiceMode: "required",
  },
  katana: {
    id: "katana",
    label: "Katana (IMGNAI)",
    baseURL: "https://kat.imgnai.com/v1",
    isLocal: false,
    defaultToolChoiceMode: "named",
  },
  "custom-openai-compatible": {
    id: "custom-openai-compatible",
    label: "OpenAI-compatible",
    isLocal: false,
    defaultToolChoiceMode: "named",
  },
};

const OPENAI_GPT5_CAPABILITIES: ModelRequestCapabilities = {
  supportsReasoningEffort: true,
  supportsToolReasoningEffort: true,
  usesMaxCompletionTokens: true,
  supportsTemperature: false,
  supportsOpenAIResponses: true,
  supportsStructuredOutput: true,
  supportsTools: true,
};

const OPENAI_GPT54_CAPABILITIES: ModelRequestCapabilities = {
  ...OPENAI_GPT5_CAPABILITIES,
  supportsToolReasoningEffort: false,
};

const STANDARD_CHAT_CAPABILITIES: ModelRequestCapabilities = {
  supportsReasoningEffort: false,
  supportsToolReasoningEffort: false,
  usesMaxCompletionTokens: false,
  supportsTemperature: true,
  supportsOpenAIResponses: false,
  supportsStructuredOutput: true,
  supportsTools: true,
};

const KATANA_GROK_CAPABILITIES: ModelRequestCapabilities = {
  supportsReasoningEffort: true,
  supportsToolReasoningEffort: true,
  usesMaxCompletionTokens: false,
  supportsTemperature: true,
  supportsOpenAIResponses: false,
  supportsStructuredOutput: true,
  supportsTools: true,
};

const KATANA_GENERAL_CAPABILITIES: ModelRequestCapabilities = {
  ...STANDARD_CHAT_CAPABILITIES,
  supportsStructuredOutput: true,
  supportsTools: true,
};

const KATANA_JSON_SCHEMA_ONLY_CAPABILITIES: ModelRequestCapabilities = {
  ...KATANA_GENERAL_CAPABILITIES,
  supportsTools: false,
};

export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  {
    id: "openai:gpt-5-nano",
    providerProfileId: "openai",
    modelId: "gpt-5-nano",
    displayName: "OpenAI gpt-5-nano",
    evaluationStatus: "game-ready",
    defaultReasoningPolicy: "action-policy",
    allowedReasoningEfforts: MODEL_REASONING_EFFORTS,
    capabilities: OPENAI_GPT5_CAPABILITIES,
  },
  {
    id: "openai:gpt-5-mini",
    providerProfileId: "openai",
    modelId: "gpt-5-mini",
    displayName: "OpenAI gpt-5-mini",
    evaluationStatus: "game-ready",
    defaultReasoningPolicy: "action-policy",
    allowedReasoningEfforts: MODEL_REASONING_EFFORTS,
    capabilities: OPENAI_GPT5_CAPABILITIES,
  },
  {
    id: "openai:gpt-5.4-nano",
    providerProfileId: "openai",
    modelId: "gpt-5.4-nano",
    displayName: "OpenAI gpt-5.4-nano",
    evaluationStatus: "game-ready",
    defaultReasoningPolicy: "action-policy",
    allowedReasoningEfforts: MODEL_REASONING_EFFORTS,
    capabilities: OPENAI_GPT54_CAPABILITIES,
  },
  {
    id: "openai:gpt-5.4-mini",
    providerProfileId: "openai",
    modelId: "gpt-5.4-mini",
    displayName: "OpenAI gpt-5.4-mini",
    evaluationStatus: "game-ready",
    defaultReasoningPolicy: "action-policy",
    allowedReasoningEfforts: MODEL_REASONING_EFFORTS,
    capabilities: OPENAI_GPT54_CAPABILITIES,
  },
  {
    id: "openai:gpt-5.6-luna",
    providerProfileId: "openai",
    modelId: "gpt-5.6-luna",
    displayName: "OpenAI gpt-5.6-luna",
    evaluationStatus: "game-ready",
    defaultReasoningPolicy: "action-policy",
    allowedReasoningEfforts: MODEL_REASONING_EFFORTS,
    capabilities: OPENAI_GPT54_CAPABILITIES,
    notes: "GPT-5.6 Luna — cost-sensitive high-volume tier ($1/$0.10/$6 per 1M tokens).",
  },
  {
    id: "katana:grok-4-3",
    providerProfileId: "katana",
    modelId: "grok-4-3",
    displayName: "xAI Grok 4.3",
    evaluationStatus: "game-ready",
    defaultReasoningPolicy: "action-policy",
    allowedReasoningEfforts: MODEL_REASONING_EFFORTS,
    capabilities: KATANA_GROK_CAPABILITIES,
    notes: "Initial router-backed Grok candidate for low/medium/high reasoning evaluation.",
  },
  {
    id: "katana:grok-4-5",
    providerProfileId: "katana",
    modelId: "grok-4-5",
    displayName: "xAI Grok 4.5",
    evaluationStatus: "game-ready",
    defaultReasoningPolicy: "action-policy",
    allowedReasoningEfforts: MODEL_REASONING_EFFORTS,
    capabilities: KATANA_GROK_CAPABILITIES,
    notes: "Approved secondary fallback for provider-resilient Influence games.",
  },
  {
    id: "katana:grok-4-20-multi-agent",
    providerProfileId: "katana",
    modelId: "grok-4-20-multi-agent",
    displayName: "xAI Grok multi-agent",
    evaluationStatus: "evaluation-candidate",
    defaultReasoningPolicy: "action-policy",
    allowedReasoningEfforts: MODEL_REASONING_EFFORTS,
    capabilities: KATANA_GROK_CAPABILITIES,
    notes: "Back-burner record; not selectable until evaluated for Influence games.",
  },
  {
    id: "katana:q-naifu-a3b",
    providerProfileId: "katana",
    modelId: "q-naifu-a3b",
    displayName: "Katana q-naifu-a3b",
    evaluationStatus: "disabled",
    defaultReasoningPolicy: "action-policy",
    allowedReasoningEfforts: [],
    capabilities: KATANA_JSON_SCHEMA_ONLY_CAPABILITIES,
    preferredToolChoiceMode: "json_schema",
    notes: "Failed local API-backed Influence evaluation: JSON Schema transport worked, but core vote/revote/strategy decisions were repeatedly empty or semantically invalid and advanced via fallbacks.",
  },
  {
    id: "katana:glm-5-2",
    providerProfileId: "katana",
    modelId: "glm-5-2",
    displayName: "Katana GLM 5.2",
    evaluationStatus: "game-ready",
    defaultReasoningPolicy: "action-policy",
    allowedReasoningEfforts: [],
    capabilities: KATANA_GENERAL_CAPABILITIES,
    notes: "Approved low-cost tertiary fallback for provider-resilient Influence games.",
  },
];

const MODEL_BY_ID = new Map(MODEL_CATALOG.map((entry) => [entry.id, entry]));
const MODEL_BY_PROVIDER_AND_MODEL = new Map(
  MODEL_CATALOG.map((entry) => [`${entry.providerProfileId}:${entry.modelId}`, entry]),
);

function dynamicOpenAICompatibleCatalogEntry(catalogId: string): ModelCatalogEntry | undefined {
  const [profileId, ...modelParts] = catalogId.split(":");
  if (profileId !== "katana" && profileId !== "lm-studio" && profileId !== "custom-openai-compatible") {
    return undefined;
  }
  const modelId = modelParts.join(":").trim();
  if (!modelId || modelId.includes(":")) return undefined;
  const providerProfileId = profileId;
  const label = providerProfileId === "katana"
    ? "Katana"
    : providerProfileId === "lm-studio"
      ? "LM Studio"
      : "OpenAI-compatible";
  return {
    id: catalogId,
    providerProfileId,
    modelId,
    displayName: `${label} ${modelId}`,
    evaluationStatus: "game-ready",
    defaultReasoningPolicy: "action-policy",
    allowedReasoningEfforts: providerProfileId === "katana" && modelId.startsWith("grok-")
      ? MODEL_REASONING_EFFORTS
      : [],
    capabilities: inferModelCapabilities(modelId, providerProfileId),
    notes: `Dynamic ${label} text-model selection for local API-backed evaluation.`,
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
    if (model.evaluationStatus !== "game-ready") {
      return providerManifestError(`model ${selection.catalogId} is not game-ready`);
    }
    if (!model.capabilities.supportsStructuredOutput || !model.capabilities.supportsTools) {
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

export function modelCatalogEntryById(catalogId: string): ModelCatalogEntry | undefined {
  return MODEL_BY_ID.get(catalogId) ?? dynamicOpenAICompatibleCatalogEntry(catalogId);
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
  const catalogEntry = MODEL_BY_PROVIDER_AND_MODEL.get(`${providerProfileId}:${modelId}`);
  if (catalogEntry) return catalogEntry.capabilities;
  if (providerProfileId === "katana" && modelId.startsWith("grok-")) return KATANA_GROK_CAPABILITIES;
  if (/^gpt-5\.[4-9]/.test(modelId)) return OPENAI_GPT54_CAPABILITIES;
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

export function formatProviderManifestLabel(
  manifest: GameProviderManifest,
): string {
  return resolveProviderManifest(manifest)
    .map((entry) => formatResolvedModelSelectionLabel(entry))
    .join(" → ");
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
  config: { providerManifest?: unknown; modelSelection?: unknown },
): ResolvedProviderManifestEntry[] {
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
    throw new Error("Game provider manifest is required");
  }
  return resolveProviderManifest([legacySelection]);
}
