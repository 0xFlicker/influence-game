import type { OpenAIReasoningSummaryMode, LlmToolChoiceMode, ModelTier } from "./llm-client";

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
  legacyTier?: ModelTier;
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

export const MODEL_REASONING_EFFORTS = ["low", "medium", "high"] as const;
export const MODEL_REASONING_POLICIES = ["action-policy", ...MODEL_REASONING_EFFORTS] as const;

export const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  budget: "gpt-5-nano",
  standard: "gpt-5-mini",
  premium: "gpt-5.4-mini",
};

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
    legacyTier: "budget",
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
    legacyTier: "standard",
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
    legacyTier: "premium",
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
    evaluationStatus: "evaluation-candidate",
    defaultReasoningPolicy: "action-policy",
    allowedReasoningEfforts: [],
    capabilities: KATANA_GENERAL_CAPABILITIES,
    notes: "Back-burner record; not selectable until evaluated for Influence games.",
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
  const catalogId = typeof record.catalogId === "string"
    ? record.catalogId
    : typeof record.modelCatalogId === "string"
      ? record.modelCatalogId
      : undefined;
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

export function modelCatalogEntryById(catalogId: string): ModelCatalogEntry | undefined {
  return MODEL_BY_ID.get(catalogId) ?? dynamicOpenAICompatibleCatalogEntry(catalogId);
}

export function providerProfileById(profileId: ProviderProfileId): ProviderProfile {
  return PROVIDER_PROFILES[profileId];
}

export function tierToCatalogId(tier: string | null | undefined): string {
  const normalized: ModelTier = tier === "premium" || tier === "standard" || tier === "budget"
    ? tier
    : "budget";
  return `openai:${DEFAULT_TIER_MODELS[normalized]}`;
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
  legacyTier: string | null | undefined,
): string {
  return formatResolvedModelSelectionLabel(resolveModelSelection(selection, legacyTier));
}

export function resolveModelSelection(
  selection: GameModelSelection | null | undefined,
  legacyTier: string | null | undefined,
): ResolvedModelSelection {
  const catalogId = selection?.catalogId ?? tierToCatalogId(legacyTier);
  const entry = selection?.catalogId
    ? modelCatalogEntryById(selection.catalogId)
    : modelCatalogEntryById(catalogId);
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
