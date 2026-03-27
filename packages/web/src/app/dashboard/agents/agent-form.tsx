"use client";

import { useState } from "react";
import {
  generatePersonality,
  type PersonaKey,
  type SavedAgent,
  type CreateAgentParams,
  type GeneratePersonalityParams,
} from "@/lib/api";
import { PERSONAS } from "@/lib/personas";
import { AvatarUpload } from "@/components/avatar-upload";

interface AgentFormProps {
  initial?: SavedAgent;
  onSubmit: (params: CreateAgentParams) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

export function AgentForm({ initial, onSubmit, onCancel, submitLabel = "Save Agent" }: AgentFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [backstory, setBackstory] = useState(initial?.backstory ?? "");
  const [personality, setPersonality] = useState(initial?.personality ?? "");
  const [strategyStyle, setStrategyStyle] = useState(initial?.strategyStyle ?? "");
  const [personaKey, setPersonaKey] = useState<PersonaKey>(initial?.personaKey ?? "strategic");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(initial?.avatarUrl ?? undefined);
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPersona = PERSONAS.find((p) => p.key === personaKey)!;

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const params: GeneratePersonalityParams = {};
      // If there's existing content, use refinement mode
      if (name.trim() || backstory.trim() || personality.trim()) {
        params.existingProfile = {
          name: name.trim() || undefined,
          backstory: backstory.trim() || undefined,
          personality: personality.trim() || undefined,
          strategyStyle: strategyStyle.trim() || undefined,
          personaKey,
        };
      } else {
        params.archetype = personaKey;
      }
      const result = await generatePersonality(params);
      setName(result.name);
      setBackstory(result.backstory ?? "");
      setPersonality(result.personality);
      setStrategyStyle(result.strategyStyle ?? "");
      setPersonaKey(result.personaKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI generation failed. Try again or fill in manually.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Agent name is required.");
      return;
    }
    if (!personality.trim()) {
      setError("Personality description is required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await onSubmit({
        name: name.trim(),
        personality: personality.trim(),
        backstory: backstory.trim() || undefined,
        strategyStyle: strategyStyle.trim() || undefined,
        personaKey,
        avatarUrl,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agent.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Avatar upload */}
      <div className="flex justify-center">
        <AvatarUpload
          currentUrl={avatarUrl}
          persona={personaKey}
          name={name || "Agent"}
          onUploaded={setAvatarUrl}
        />
      </div>

      {/* AI Help */}
      <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-indigo-500/30 bg-indigo-950/20">
        <div className="flex-1 min-w-0">
          <p className="text-white/60 text-xs">
            {name.trim() || personality.trim()
              ? "Refine your agent with AI — enhances existing fields."
              : "Let AI generate a complete personality from scratch."}
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="shrink-0 bg-indigo-600/80 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
        >
          {generating ? "Generating..." : "AI Help"}
        </button>
      </div>

      {/* Agent name */}
      <div>
        <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
          Agent Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. ShadowPlay-7"
          maxLength={32}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-white/20 text-sm outline-none focus:border-indigo-500 transition-colors"
        />
        <p className="text-white/25 text-xs mt-1">
          The name your agent uses in games. Other players will see this.
        </p>
      </div>

      {/* Persona selection */}
      <div>
        <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
          Base Persona
        </label>
        <div className="grid grid-cols-5 gap-2 mb-2">
          {PERSONAS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPersonaKey(p.key)}
              className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-all ${
                personaKey === p.key
                  ? "border-indigo-500 bg-indigo-600/20 text-white"
                  : "border-white/10 text-white/40 hover:border-white/20 hover:text-white/60"
              }`}
            >
              <span className="text-base">{p.icon}</span>
              <span className="text-[10px] leading-tight text-center">{p.name}</span>
            </button>
          ))}
        </div>
        <p className="text-white/30 text-xs italic">
          {selectedPersona.icon} {selectedPersona.name}: {selectedPersona.description}
        </p>
      </div>

      {/* Backstory */}
      <div>
        <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
          Backstory{" "}
          <span className="text-white/25 normal-case font-normal">(optional)</span>
        </label>
        <textarea
          value={backstory}
          onChange={(e) => setBackstory(e.target.value)}
          placeholder="Where did your agent come from? What drives them? What's their story?"
          rows={4}
          maxLength={1000}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-white/20 text-sm outline-none focus:border-indigo-500 transition-colors resize-none"
        />
        <p className="text-white/25 text-xs mt-1 text-right">{backstory.length}/1000</p>
      </div>

      {/* Personality description */}
      <div>
        <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
          Personality
        </label>
        <textarea
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder="How does your agent behave in social situations? How do they speak? What makes them tick?"
          rows={3}
          maxLength={500}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-white/20 text-sm outline-none focus:border-indigo-500 transition-colors resize-none"
        />
        <p className="text-white/25 text-xs mt-1 text-right">{personality.length}/500</p>
      </div>

      {/* Strategy style */}
      <div>
        <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
          Strategy Style{" "}
          <span className="text-white/25 normal-case font-normal">(optional)</span>
        </label>
        <textarea
          value={strategyStyle}
          onChange={(e) => setStrategyStyle(e.target.value)}
          placeholder="Any specific tactics or strategic approach for this agent..."
          rows={2}
          maxLength={300}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-white/20 text-sm outline-none focus:border-indigo-500 transition-colors resize-none"
        />
      </div>

      {/* Error */}
      {error && (
        <p className="text-red-400 text-sm bg-red-900/20 border border-red-900/40 rounded-lg px-4 py-2.5">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border border-white/10 hover:border-white/20 text-white/60 hover:text-white text-sm py-2.5 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm py-2.5 rounded-lg font-medium transition-colors"
        >
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
