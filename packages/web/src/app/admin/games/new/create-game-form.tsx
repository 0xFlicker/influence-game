"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createGame, estimateCost, type CreateGameParams, type PersonaKey } from "@/lib/api";

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
];

const ALL_PERSONA_KEYS = PERSONAS.map((p) => p.key);

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface FormState {
  playerCount: 4 | 6 | 8 | 10 | 12;
  slotType: "all_ai" | "mixed";
  modelTier: "budget" | "standard" | "premium";
  personaPool: PersonaKey[];
  fillStrategy: "random" | "balanced";
  timingPreset: "fast" | "standard" | "slow" | "custom";
  maxRounds: number | "auto";
  visibility: "public" | "unlisted" | "private";
  viewerMode: "live" | "speedrun";
}

const DEFAULT_STATE: FormState = {
  playerCount: 6,
  slotType: "all_ai",
  modelTier: "budget",
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

// ---------------------------------------------------------------------------
// Create game form
// ---------------------------------------------------------------------------

export function CreateGameForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(DEFAULT_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    setSubmitting(true);
    try {
      const params: CreateGameParams = {
        ...form,
        playerCount: form.playerCount,
      };
      const { slug } = await createGame(params);
      router.push(`/games/${slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create game.");
      setSubmitting(false);
    }
  }

  const costEstimate = estimateCost(form.playerCount, form.modelTier);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Players */}
      <SectionCard title="Players">
        <RadioGroup
          label="Player count"
          value={String(form.playerCount) as never}
          options={[4, 6, 8, 10, 12].map((n) => ({
            value: String(n) as never,
            label: String(n),
          }))}
          onChange={(v) => set("playerCount", parseInt(v) as FormState["playerCount"])}
        />
        <RadioGroup
          label="Slot type"
          value={form.slotType}
          options={[
            { value: "all_ai", label: "All AI" },
            { value: "mixed", label: "Mixed (coming soon)", disabled: true },
          ]}
          onChange={(v) => set("slotType", v)}
        />
      </SectionCard>

      {/* Model tier */}
      <SectionCard title="Model Tier">
        <RadioGroup
          label="Select model"
          value={form.modelTier}
          options={[
            { value: "budget", label: "Budget", sublabel: "gpt-4o-mini" },
            { value: "standard", label: "Standard", sublabel: "gpt-4o" },
            { value: "premium", label: "Premium", sublabel: "o1-mini" },
          ]}
          onChange={(v) => set("modelTier", v)}
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
      <div className="flex items-center justify-between pt-2">
        <p className="text-sm text-white/40">
          Cost estimate:{" "}
          <span className="text-white/70 font-medium">{costEstimate}/game</span>
        </p>
        <div className="flex items-center gap-3">
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {submitting ? "Creating…" : "Create Game"}
          </button>
        </div>
      </div>
    </form>
  );
}
