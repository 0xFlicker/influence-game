"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_MODEL_CATALOG_ID } from "@influence/engine/model-defaults";
import {
  createGame,
  getProviderModels,
  type CreateGameParams,
  type GameProviderManifestEntry,
  type ModelReasoningPolicy,
  type PersonaKey,
  type ProviderModelInventoryEntry,
} from "@/lib/api";
import { CREATE_GAME_PLAYER_COUNTS } from "@/lib/game-creation";
import { ACTIVE_GAME, HOUSE_VENUE } from "@/lib/product-identity";

// ---------------------------------------------------------------------------
// Persona definitions (matches engine PERSONALITY_PROMPTS)
// ---------------------------------------------------------------------------

const PERSONAS: {
  key: PersonaKey;
  name: string;
  icon: string;
  desc: string;
}[] = [
  { key: "strategic", name: "Atlas", icon: "🎯", desc: "Calculated, targets threats" },
  { key: "deceptive", name: "Vera", icon: "🎭", desc: "Manipulates, spreads misinformation" },
  { key: "honest", name: "Finn", icon: "🤝", desc: "Transparent, builds real alliances" },
  { key: "paranoid", name: "Lyra", icon: "😱", desc: "Trusts no one, pre-empts elimination" },
  { key: "social", name: "Mira", icon: "💬", desc: "Charm and likability" },
  { key: "aggressive", name: "Rex", icon: "💥", desc: "Fast action, targets strong players" },
  { key: "loyalist", name: "Kael", icon: "🔥", desc: "Fierce loyalty, deadly if betrayed" },
  { key: "observer", name: "Echo", icon: "🕵️", desc: "Patient, watches, strikes late" },
  { key: "diplomat", name: "Sage", icon: "🌐", desc: "Coalition architect, indispensable" },
  { key: "wildcard", name: "Jace", icon: "🎲", desc: "Unpredictable by design" },
  { key: "contrarian", name: "Nyx", icon: "⚡", desc: "Challenges consensus, asks hard questions" },
  { key: "provocateur", name: "Rune", icon: "🔮", desc: "Weaponizes information, stirs conflict" },
  { key: "martyr", name: "Wren", icon: "🕊️", desc: "Sacrifices self to protect allies" },
];

const ALL_PERSONA_KEYS = PERSONAS.map((p) => p.key);

type GameModelOption = Pick<
  ProviderModelInventoryEntry,
  | "catalogId"
  | "displayName"
  | "configured"
  | "available"
  | "defaultReasoningPolicy"
  | "allowedReasoningPolicies"
> & { sublabel: string };

const GAME_MODELS: GameModelOption[] = [
  {
    catalogId: "openai:gpt-5-nano",
    displayName: "OpenAI gpt-5-nano",
    sublabel: "Fast baseline play",
    configured: true,
    available: null,
    defaultReasoningPolicy: "medium",
    allowedReasoningPolicies: ["action-policy", "low", "medium", "high"],
  },
  {
    catalogId: "openai:gpt-5-mini",
    displayName: "OpenAI gpt-5-mini",
    sublabel: "Stronger strategy",
    configured: true,
    available: null,
    defaultReasoningPolicy: "medium",
    allowedReasoningPolicies: ["action-policy", "low", "medium", "high"],
  },
  {
    catalogId: "openai:gpt-5.4-mini",
    displayName: "OpenAI gpt-5.4-mini",
    sublabel: "Most capable OpenAI 5.4 option",
    configured: true,
    available: null,
    defaultReasoningPolicy: "medium",
    allowedReasoningPolicies: ["action-policy", "low", "medium", "high"],
  },
  {
    catalogId: "openai:gpt-5.6-luna",
    displayName: "OpenAI gpt-5.6-luna",
    sublabel: "GPT-5.6 baseline play",
    configured: true,
    available: null,
    defaultReasoningPolicy: "medium",
    allowedReasoningPolicies: ["action-policy", "low", "medium", "high"],
  },
  {
    catalogId: "katana:grok-4-3",
    displayName: "xAI Grok 4.3",
    sublabel: "Reasoning-heavy strategy test",
    configured: true,
    available: null,
    defaultReasoningPolicy: "medium",
    allowedReasoningPolicies: ["action-policy", "low", "medium", "high"],
  },
  {
    catalogId: "katana:grok-4-5",
    displayName: "xAI Grok 4.5",
    sublabel: "Capable secondary fallback",
    configured: true,
    available: null,
    defaultReasoningPolicy: "action-policy",
    allowedReasoningPolicies: ["action-policy", "low", "medium", "high"],
  },
  {
    catalogId: "katana:glm-5-2",
    displayName: "Katana GLM 5.2",
    sublabel: "Low-cost tertiary fallback",
    configured: true,
    available: null,
    defaultReasoningPolicy: "action-policy",
    allowedReasoningPolicies: ["action-policy"],
  },
];

const THINKING_DEPTHS: Array<{
  value: ModelReasoningPolicy;
  label: string;
  sublabel: string;
}> = [
  { value: "action-policy", label: "Adaptive", sublabel: "Matches effort to each action" },
  { value: "low", label: "Low", sublabel: "Lighter deliberation" },
  { value: "medium", label: "Medium", sublabel: "Default strategy depth" },
  { value: "high", label: "High", sublabel: "Heavier deliberation" },
];

interface ProviderRouteEntry extends GameProviderManifestEntry {
  uiId: string;
}

let nextProviderRouteId = 1;
function providerRouteEntry(
  entry: GameProviderManifestEntry,
): ProviderRouteEntry {
  return { ...entry, uiId: `provider-route-${nextProviderRouteId++}` };
}

export const DEFAULT_PROVIDER_MANIFEST: GameProviderManifestEntry[] = [
  { catalogId: DEFAULT_MODEL_CATALOG_ID, reasoningPolicy: "medium" },
];

const RECOMMENDED_PROVIDER_FALLBACKS: GameProviderManifestEntry[] = [
  { catalogId: "katana:grok-4-5", reasoningPolicy: "action-policy", maxCallsPerGame: 12 },
  { catalogId: "katana:glm-5-2", reasoningPolicy: "action-policy", maxCallsPerGame: 24 },
];

export function moveProviderRouteEntry(
  entries: ProviderRouteEntry[],
  from: number,
  to: number,
): ProviderRouteEntry[] {
  if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) {
    return entries;
  }
  const next = [...entries];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next.map((entry, index) => index === 0
    ? { ...entry, maxCallsPerGame: undefined }
    : { ...entry, maxCallsPerGame: entry.maxCallsPerGame ?? 12 });
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface FormState {
  playerCount: CreateGameParams["playerCount"];
  providerRoute: ProviderRouteEntry[];
  personaPool: PersonaKey[];
  fillStrategy: "random" | "balanced";
  timingPreset: "fast" | "standard" | "slow" | "custom";
  maxRounds: number | "auto";
  visibility: "public" | "unlisted" | "private";
  viewerMode: "live" | "speedrun";
}

const DEFAULT_STATE: FormState = {
  playerCount: 6,
  providerRoute: DEFAULT_PROVIDER_MANIFEST.map(providerRouteEntry),
  personaPool: [...ALL_PERSONA_KEYS],
  fillStrategy: "balanced",
  timingPreset: "standard",
  maxRounds: "auto",
  visibility: "public",
  viewerMode: "speedrun",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { value: T; label: string; sublabel?: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="text-sm text-white/60 mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const isDisabled = disabled || opt.disabled;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={isDisabled}
              onClick={() => !isDisabled && onChange(opt.value)}
              className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                value === opt.value
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : isDisabled
                    ? "border-white/5 text-white/20 cursor-not-allowed"
                    : "border-white/10 text-white/60 hover:border-white/30 hover:text-white"
              }`}
            >
              {opt.label}
              {opt.sublabel && (
                <span className="block text-xs opacity-60 mt-0.5">{opt.sublabel}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-white/10 rounded-xl p-6">
      <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function routeEntryError(
  entry: ProviderRouteEntry,
  index: number,
  model?: GameModelOption,
): string | null {
  if (!entry.catalogId) return "Select a model.";
  if (model?.configured === false) return "This provider is not configured.";
  if (model?.available === false) return "This model is not currently available from its provider.";
  if (
    index > 0
    && (!Number.isSafeInteger(entry.maxCallsPerGame) || (entry.maxCallsPerGame ?? 0) < 1)
  ) {
    return "Set a positive whole-number call limit for this fallback.";
  }
  return null;
}

function ProviderRouteEditor({
  entries,
  models,
  inventoryUnavailable,
  onChange,
}: {
  entries: ProviderRouteEntry[];
  models: GameModelOption[];
  inventoryUnavailable: boolean;
  onChange: (entries: ProviderRouteEntry[]) => void;
}) {
  const modelSelectRefs = useRef<Record<string, HTMLSelectElement | null>>({});
  const pendingFocusId = useRef<string | null>(null);

  useEffect(() => {
    const pending = pendingFocusId.current;
    if (!pending) return;
    pendingFocusId.current = null;
    window.requestAnimationFrame(() => modelSelectRefs.current[pending]?.focus());
  }, [entries]);

  function updateEntry(index: number, update: Partial<ProviderRouteEntry>) {
    onChange(entries.map((entry, entryIndex) => entryIndex === index
      ? { ...entry, ...update }
      : entry));
  }

  function selectModel(index: number, catalogId: string) {
    const model = models.find((option) => option.catalogId === catalogId);
    const currentPolicy = entries[index]!.reasoningPolicy;
    updateEntry(index, {
      catalogId,
      reasoningPolicy: model?.allowedReasoningPolicies.includes(currentPolicy)
        ? currentPolicy
        : model?.defaultReasoningPolicy ?? "action-policy",
    });
  }

  function move(index: number, nextIndex: number) {
    pendingFocusId.current = entries[index]!.uiId;
    onChange(moveProviderRouteEntry(entries, index, nextIndex));
  }

  function remove(index: number) {
    if (entries.length === 1) return;
    const nextEntries = entries
      .filter((_, entryIndex) => entryIndex !== index)
      .map((entry, entryIndex) => entryIndex === 0
        ? { ...entry, maxCallsPerGame: undefined }
        : entry);
    pendingFocusId.current = nextEntries[Math.min(index, nextEntries.length - 1)]!.uiId;
    onChange(nextEntries);
  }

  function addFallback() {
    const used = new Set(entries.map((entry) => entry.catalogId));
    const available = models.find((model) => !used.has(model.catalogId));
    if (!available) return;
    const next = providerRouteEntry({
      catalogId: available.catalogId,
      reasoningPolicy: available.defaultReasoningPolicy,
      maxCallsPerGame: 12,
    });
    pendingFocusId.current = next.uiId;
    onChange([...entries, next]);
  }

  const canAdd = models.some(
    (model) => !entries.some((entry) => entry.catalogId === model.catalogId),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-white">Provider route</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-white/45">
            Every call starts with Primary. If it cannot return a usable result, the game follows
            these fallbacks in order. This exact route is sealed when the game is created.
          </p>
        </div>
        <span className="text-xs tabular-nums text-white/35">
          {entries.length} {entries.length === 1 ? "model" : "models"}
        </span>
      </div>

      {inventoryUnavailable && (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100" role="status">
          Live model inventory is unavailable. Known validated IDs remain selectable; retry by reopening this form.
        </p>
      )}

      <div className="space-y-3">
        {entries.map((entry, index) => {
          const selectedModel = models.find((model) => model.catalogId === entry.catalogId);
          const allowedPolicies = selectedModel?.allowedReasoningPolicies ?? ["action-policy"];
          const error = routeEntryError(entry, index, selectedModel);
          return (
            <fieldset
              key={entry.uiId}
              className={`rounded-xl border p-4 transition-colors ${
                index === 0
                  ? "border-indigo-500/45 bg-indigo-500/[0.08]"
                  : "border-white/10 bg-white/[0.025]"
              }`}
            >
              <legend className="sr-only">
                {index === 0 ? "Primary model" : `Fallback ${index}`}
              </legend>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                    index === 0
                      ? "bg-indigo-500/25 text-indigo-100"
                      : "bg-white/[0.07] text-white/55"
                  }`}>
                    {index === 0 ? "Primary" : `Fallback ${index}`}
                  </span>
                  {selectedModel && !selectedModel.configured && (
                    <span className="text-xs text-amber-200/70">Credentials not detected</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, index - 1)}
                    disabled={index === 0}
                    aria-label={`Move ${index === 0 ? "primary" : `fallback ${index}`} up`}
                    className="rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-white/55 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, index + 1)}
                    disabled={index === entries.length - 1}
                    aria-label={`Move ${index === 0 ? "primary" : `fallback ${index}`} down`}
                    className="rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-white/55 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    disabled={entries.length === 1}
                    aria-label={`Remove ${index === 0 ? "primary" : `fallback ${index}`}`}
                    className="ml-1 rounded-md px-2.5 py-1.5 text-xs text-red-300/70 transition-colors hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-25"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className={`grid gap-4 ${index === 0 ? "md:grid-cols-1" : "md:grid-cols-[minmax(0,1fr)_11rem]"}`}>
                <label className="block">
                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-white/40">
                    Model
                  </span>
                  <select
                    ref={(node) => { modelSelectRefs.current[entry.uiId] = node; }}
                    value={entry.catalogId}
                    onChange={(event) => selectModel(index, event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#09090c] px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-indigo-500"
                  >
                    {models.map((model) => {
                      const selectedElsewhere = entries.some(
                        (other, otherIndex) => otherIndex !== index && other.catalogId === model.catalogId,
                      );
                      const unavailable = !model.configured || model.available === false;
                      return (
                        <option
                          key={model.catalogId}
                          value={model.catalogId}
                          disabled={selectedElsewhere || unavailable}
                        >
                          {model.displayName}
                          {selectedElsewhere
                            ? " (already used)"
                            : unavailable
                              ? " (unavailable)"
                              : ""}
                        </option>
                      );
                    })}
                  </select>
                  {selectedModel?.sublabel && (
                    <span className="mt-1.5 block text-xs text-white/35">{selectedModel.sublabel}</span>
                  )}
                </label>

                {index > 0 && (
                  <label className="block">
                    <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-white/40">
                      Max calls / game
                    </span>
                    <input
                      type="number"
                      aria-label={`Fallback ${index} max calls per game`}
                      min={1}
                      max={10000}
                      step={1}
                      value={entry.maxCallsPerGame ?? ""}
                      onChange={(event) => updateEntry(index, {
                        maxCallsPerGame: event.target.value === "" ? undefined : Number(event.target.value),
                      })}
                      className="w-full rounded-lg border border-white/10 bg-[#09090c] px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-indigo-500"
                    />
                    <span className="mt-1.5 block text-xs text-white/35">Hard fallback dispatch cap</span>
                  </label>
                )}
              </div>

              <div className="mt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-white/40">
                  Reasoning
                </p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`${index === 0 ? "Primary" : `Fallback ${index}`} reasoning`}>
                  {THINKING_DEPTHS.filter((option) => allowedPolicies.includes(option.value)).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={entry.reasoningPolicy === option.value}
                      onClick={() => updateEntry(index, { reasoningPolicy: option.value })}
                      className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        entry.reasoningPolicy === option.value
                          ? "border-indigo-500 bg-indigo-600 text-white"
                          : "border-white/10 text-white/55 hover:border-white/25 hover:text-white"
                      }`}
                    >
                      <span className="font-medium">{option.label}</span>
                      <span className="ml-2 opacity-55">{option.sublabel}</span>
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="mt-3 text-xs text-red-300" role="alert">{error}</p>}
            </fieldset>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addFallback}
        disabled={!canAdd}
        className="w-full rounded-lg border border-dashed border-white/15 px-4 py-3 text-sm text-white/50 transition-colors hover:border-indigo-400/50 hover:bg-indigo-500/[0.05] hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-30"
      >
        + Add fallback
      </button>
      <p className="sr-only" aria-live="polite">
        Provider route contains {entries.length} entries.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create game form
// ---------------------------------------------------------------------------

export function CreateGameForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(DEFAULT_STATE);
  const [models, setModels] = useState<GameModelOption[]>(GAME_MODELS);
  const [inventoryUnavailable, setInventoryUnavailable] = useState(false);
  const providerRouteEdited = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getProviderModels().then((inventory) => {
      if (!active) return;
      const staticById = new Map(GAME_MODELS.map((model) => [model.catalogId, model]));
      setModels(inventory.models.map((model) => ({
        catalogId: model.catalogId,
        displayName: model.displayName,
        configured: model.configured,
        available: model.available,
        defaultReasoningPolicy: model.defaultReasoningPolicy,
        allowedReasoningPolicies: model.allowedReasoningPolicies,
        sublabel: staticById.get(model.catalogId)?.sublabel ?? model.notes ?? "Available for explicit testing",
      })));
      setInventoryUnavailable(inventory.status !== "complete");
      if (!providerRouteEdited.current && inventory.status === "complete") {
        const configuredModelIds = new Set(
          inventory.models
            .filter((model) => model.configured && model.available !== false)
            .map((model) => model.catalogId),
        );
        setForm((current) => ({
          ...current,
          providerRoute: [
            ...DEFAULT_PROVIDER_MANIFEST,
            ...RECOMMENDED_PROVIDER_FALLBACKS.filter(
              (entry) => configuredModelIds.has(entry.catalogId),
            ),
          ].map(providerRouteEntry),
        }));
      }
    }).catch(() => {
      if (active) setInventoryUnavailable(true);
    });
    return () => { active = false; };
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function togglePersona(key: PersonaKey) {
    setForm((prev) => {
      const pool = prev.personaPool.includes(key)
        ? prev.personaPool.filter((k) => k !== key)
        : [...prev.personaPool, key];
      // Must keep at least 2
      if (pool.length < 2) return prev;
      return { ...prev, personaPool: pool };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.personaPool.length < 2) {
      setError("Select at least 2 personas.");
      return;
    }
    const routeError = form.providerRoute
      .map((entry, index) => routeEntryError(
        entry,
        index,
        models.find((model) => model.catalogId === entry.catalogId),
      ))
      .find((message): message is string => Boolean(message));
    if (routeError) {
      setError(routeError);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { providerRoute, ...gameParams } = form;
      const params: CreateGameParams = {
        ...gameParams,
        providerManifest: providerRoute.map((entry) => ({
          catalogId: entry.catalogId,
          reasoningPolicy: entry.reasoningPolicy,
          ...(entry.maxCallsPerGame === undefined
            ? {}
            : { maxCallsPerGame: entry.maxCallsPerGame }),
        })),
      };
      const { slug } = await createGame(params);
      router.push(`/games/${slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create game.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Game */}
      <SectionCard title="Game">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-white text-lg font-semibold">
              {ACTIVE_GAME.name}
            </p>
            <p className="text-sm text-white/50 mt-1">
              Selected ruleset for {HOUSE_VENUE.name}. Other games are not
              selectable in this pass.
            </p>
          </div>
          <span className="w-fit rounded-sm border border-emerald-500/35 bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
            Selected
          </span>
        </div>
      </SectionCard>

      {/* Players */}
      <SectionCard title="Players">
        <RadioGroup
          label="Player count"
          value={String(form.playerCount) as never}
          options={CREATE_GAME_PLAYER_COUNTS.map((n) => ({
            value: String(n) as never,
            label: String(n),
          }))}
          onChange={(v) => set("playerCount", parseInt(v) as FormState["playerCount"])}
        />
      </SectionCard>

      {/* Provider route */}
      <SectionCard title="Models">
        <ProviderRouteEditor
          entries={form.providerRoute}
          models={models}
          inventoryUnavailable={inventoryUnavailable}
          onChange={(providerRoute) => {
            providerRouteEdited.current = true;
            set("providerRoute", providerRoute);
          }}
        />
      </SectionCard>

      {/* Persona pool */}
      <SectionCard title="Persona Pool">
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-white/60">
              Select personas ({form.personaPool.length}/{PERSONAS.length} selected)
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => set("personaPool", [...ALL_PERSONA_KEYS])}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                All
              </button>
              <span className="text-white/20">·</span>
              <button
                type="button"
                onClick={() =>
                  setForm((p) => ({
                    ...p,
                    personaPool: ALL_PERSONA_KEYS.slice(0, 2),
                  }))
                }
                className="text-xs text-white/40 hover:text-white/60 transition-colors"
              >
                Min
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {PERSONAS.map((p) => {
              const selected = form.personaPool.includes(p.key);
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => togglePersona(p.key)}
                  className={`border rounded-xl p-3 text-left transition-colors ${
                    selected
                      ? "border-indigo-500/60 bg-indigo-500/10"
                      : "border-white/10 hover:border-white/20"
                  }`}
                >
                  <span className="text-xl block mb-1">{p.icon}</span>
                  <span
                    className={`text-sm font-medium block ${selected ? "text-white" : "text-white/50"}`}
                  >
                    {p.name}
                  </span>
                  <span className="text-xs text-white/30 leading-tight block mt-0.5">
                    {p.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <RadioGroup
          label="Fill strategy"
          value={form.fillStrategy}
          options={[
            { value: "balanced", label: "Balanced", sublabel: "No duplicates until needed" },
            { value: "random", label: "Random", sublabel: "Pure random from pool" },
          ]}
          onChange={(v) => set("fillStrategy", v)}
        />
      </SectionCard>

      {/* Game Mode */}
      <SectionCard title="Game Mode">
        <RadioGroup
          label="Viewer mode"
          value={form.viewerMode}
          options={[
            { value: "speedrun" as const, label: "Speed-run", sublabel: "Instant, for testing" },
            { value: "live" as const, label: "Live", sublabel: "Paced for viewers" },
          ]}
          onChange={(v) => set("viewerMode", v as "live" | "speedrun")}
        />
      </SectionCard>

      {/* Timing */}
      <SectionCard title="Timing Config">
        <RadioGroup
          label="Preset"
          value={form.timingPreset}
          options={[
            { value: "fast", label: "Fast", sublabel: "20s phases" },
            { value: "standard", label: "Standard", sublabel: "30s phases" },
            { value: "slow", label: "Slow", sublabel: "60s phases" },
            { value: "custom", label: "Custom" },
          ]}
          onChange={(v) => set("timingPreset", v)}
        />

        <div>
          <label className="block text-sm text-white/60 mb-2">Max rounds</label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => set("maxRounds", "auto")}
              className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                form.maxRounds === "auto"
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : "border-white/10 text-white/60 hover:border-white/30 hover:text-white"
              }`}
            >
              Auto
            </button>
            <input
              type="number"
              min={5}
              max={30}
              value={form.maxRounds === "auto" ? "" : form.maxRounds}
              placeholder="e.g. 9"
              onChange={(e) => {
                const v = parseInt(e.target.value);
                if (!isNaN(v)) set("maxRounds", v);
              }}
              onFocus={() => {
                if (form.maxRounds === "auto") set("maxRounds", 9);
              }}
              className="w-24 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-indigo-500 text-sm"
            />
          </div>
        </div>
      </SectionCard>

      {/* Visibility */}
      <SectionCard title="Visibility">
        <RadioGroup
          label="Who can see this game"
          value={form.visibility}
          options={[
            { value: "public", label: "Public", sublabel: "Listed, anonymous viewable" },
            { value: "unlisted", label: "Unlisted", sublabel: "Link-only" },
            { value: "private", label: "Private", sublabel: "Admin + players only" },
          ]}
          onChange={(v) => set("visibility", v)}
        />
      </SectionCard>

      {/* Submit */}
      <div className="flex items-center justify-end pt-2">
        <div className="flex items-center gap-3">
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {submitting ? "Creating…" : `Create ${ACTIVE_GAME.name} Game`}
          </button>
        </div>
      </div>
    </form>
  );
}
