import { DEFAULT_MODEL_CATALOG_ID, normalizeProviderManifest, resolveProviderManifest, resolveProviderManifestFromGameConfig, type GameModelSelection, type GameProviderManifest, type ResolvedProviderManifestEntry } from "./model-catalog";

export const FREE_MODEL_CATALOG_IDS = ["openai:gpt-6-luna", "katana:glm-5-3-flash-private", "katana:deepseek-v4-flash", "meta-muse:muse-spark-1.3-contributor"] as const;
export type ModelPreference = "default" | GameModelSelection;

/** Small game configuration only. Provider evidence and contexts remain in object storage. */
export interface GameModelRouting {
  version: 1;
  defaultManifest: GameProviderManifest;
  houseManifest: GameProviderManifest;
  excludedCatalogIds: string[];
  overrides: Record<string, ModelPreference>;
  /** Actor IDs, not profile IDs. Written once at the atomic game-start boundary. */
  contestants?: Record<string, GameProviderManifest>;
  /** Runtime metadata is frozen with assignments, never re-inferred on resume. */
  frozenRoutes?: { default: ResolvedProviderManifestEntry[]; house: ResolvedProviderManifestEntry[]; contestants: Record<string, ResolvedProviderManifestEntry[]> };
}

export function normalizeModelPreference(value: unknown): ModelPreference {
  if (value === "default" || value === undefined || value === null) return "default";
  return normalizeProviderManifest([value])[0]!;
}

export function assertModelEntitlement(preference: ModelPreference, privileged: boolean): void {
  if (!privileged && preference !== "default" && !FREE_MODEL_CATALOG_IDS.some(id => id === preference.catalogId)) {
    throw new Error("This model is available to admins and sysops only");
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid model routing object");
  return value as Record<string, unknown>;
}

export function normalizeGameModelRouting(value: unknown): GameModelRouting {
  const input = record(value);
  if (input.version !== 1 || Object.keys(input).some(key => !["version", "defaultManifest", "houseManifest", "excludedCatalogIds", "overrides", "contestants", "frozenRoutes"].includes(key))) throw new Error("Invalid model routing version or field");
  const excluded = input.excludedCatalogIds ?? [];
  if (!Array.isArray(excluded) || excluded.some(id => typeof id !== "string") || new Set(excluded).size !== excluded.length) throw new Error("Choose distinct model exclusions");
  const normalize = (manifest: unknown) => {
    const result = normalizeProviderManifest(manifest);
    if (result.some(entry => excluded.includes(entry.catalogId))) throw new Error("An excluded model is selected in a route");
    if (result.some(entry => entry.catalogId.startsWith("katana:gpt-6-luna"))) throw new Error("Luna must use the OpenAI Flex route");
    return result;
  };
  const overrides = Object.fromEntries(Object.entries(record(input.overrides ?? {})).map(([id, preference]) => {
    if (!id || id.length > 100) throw new Error("Invalid cast override ID");
    const selected = normalizeModelPreference(preference);
    if (selected !== "default" && excluded.includes(selected.catalogId)) throw new Error("An excluded model is selected for a contestant");
    return [id, selected];
  }));
  return { version: 1, defaultManifest: normalize(input.defaultManifest), houseManifest: normalize(input.houseManifest),
    excludedCatalogIds: excluded, overrides,
    ...(input.contestants !== undefined && { contestants: Object.fromEntries(Object.entries(record(input.contestants)).map(([id, route]) => [id, normalize(route)])) }) };
}

export function contestantManifest(policy: GameModelRouting, preference: ModelPreference, visualMode = false): GameProviderManifest {
  const primary = preference === "default" ? policy.defaultManifest[0]! : preference;
  if (primary.catalogId.startsWith("katana:gpt-6-luna")) throw new Error("Luna must use the OpenAI Flex route");
  if (policy.excludedCatalogIds.includes(primary.catalogId)) throw new Error(`Model ${primary.catalogId} is excluded from this game`);
  const route = normalizeProviderManifest([primary, ...policy.defaultManifest.slice(1).filter(entry => entry.catalogId !== primary.catalogId)]);
  const resolved = resolveProviderManifest(route);
  if (visualMode && !resolved[0]!.model.capabilities.supportsImageInput) throw new Error(`Model ${primary.catalogId} cannot receive this game's image context`);
  return route.filter((_, i) => i === 0 || !visualMode || resolved[i]!.model.capabilities.supportsImageInput);
}

export function sealGameModelRouting(policy: GameModelRouting, seats: Array<{ id: string; preference?: ModelPreference }>, visualMode = false): GameModelRouting {
  if (policy.contestants) throw new Error("Game model assignments are already sealed");
  if (new Set(seats.map(seat => seat.id)).size !== seats.length) throw new Error("Duplicate contestant ID");
  if (Object.keys(policy.overrides).some(id => !seats.some(seat => seat.id === id))) throw new Error("A model override references a missing cast member");
  const contestants = Object.fromEntries(seats.map(seat => [seat.id,
    contestantManifest(policy, policy.overrides[seat.id] ?? seat.preference ?? "default", visualMode)]));
  return { ...policy, contestants, frozenRoutes: { default: resolveProviderManifest(policy.defaultManifest), house: resolveProviderManifest(policy.houseManifest),
    contestants: Object.fromEntries(Object.entries(contestants).map(([id, route]) => [id, resolveProviderManifest(route)])) } };
}

export function actorProviderManifest(config: Record<string, unknown>, actor: { id?: string | null; role: string }): ResolvedProviderManifestEntry[] {
  if (config.modelRouting === undefined) return resolveProviderManifestFromGameConfig(config);
  const stored = config.modelRouting as GameModelRouting;
  const house = actor.role === "house" || actor.role === "system" || actor.role === "producer";
  if (stored.contestants) {
    const route = house ? stored.frozenRoutes?.house : stored.frozenRoutes?.contestants[actor.id ?? ""];
    if (!route?.length || route.some((entry, i) => entry.position !== i || entry.catalogId !== `${entry.providerProfile.id}:${entry.modelId}` || entry.model.id !== entry.catalogId)) throw new Error("Corrupt frozen model runtime");
    return route;
  }
  const policy = normalizeGameModelRouting(config.modelRouting);
  if (house) return resolveProviderManifest(policy.houseManifest);
  const manifest = actor.id ? policy.contestants?.[actor.id] : undefined;
  if (!manifest) throw new Error(`No sealed model assignment for actor ${actor.id ?? "unknown"}`);
  return resolveProviderManifest(manifest);
}

/** Read sealed authority unchanged; normalize new templates and waiting lobbies. */
export function gameModelPolicy(config: Record<string, unknown>): GameModelRouting {
  if (config.modelRouting !== undefined) {
    const stored = config.modelRouting as GameModelRouting;
    if (stored.contestants) {
      if (stored.version !== 1) throw new Error("Invalid frozen model routing version");
      actorProviderManifest(config, { role: "house" });
      for (const id of Object.keys(stored.contestants)) actorProviderManifest(config, { id, role: "player" });
      return stored;
    }
    return normalizeGameModelRouting(stored);
  }
  const manifest = resolveProviderManifestFromGameConfig(config.providerManifest === undefined && config.modelSelection === undefined ? { providerManifest: [{ catalogId: DEFAULT_MODEL_CATALOG_ID }] } : config).map(({ catalogId, reasoningPolicy, maxCallsPerGame }) => ({ catalogId, reasoningPolicy, ...(maxCallsPerGame !== undefined && { maxCallsPerGame }) }));
  return normalizeGameModelRouting({ version: 1, defaultManifest: manifest, houseManifest: manifest, excludedCatalogIds: [], overrides: {} });
}
