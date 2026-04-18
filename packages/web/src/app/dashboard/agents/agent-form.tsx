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
      <div className="influence-panel-dashed flex items-center gap-3 rounded-lg p-3">
        <div className="flex-1 min-w-0">
          <p className="influence-copy text-xs">
            {name.trim() || personality.trim()
              ? "Refine your agent with AI — enhances existing fields."
              : "Let AI generate a complete personality from scratch."}
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="influence-button-primary shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium"
        >
          {generating ? "Generating..." : "AI Help"}
        </button>
      </div>

      {/* Agent name */}
      <div>
        <label className="influence-section-title block mb-2">
          Agent Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. ShadowPlay-7"
          maxLength={32}
          className="influence-field w-full rounded-lg px-4 py-2.5 text-sm"
        />
        <p className="influence-copy-muted text-xs mt-1">
          The name your agent uses in games. Other players will see this.
        </p>
      </div>

      {/* Persona selection */}
      <div>
        <label className="influence-section-title block mb-2">
          Base Persona
        </label>
        <div className="grid grid-cols-5 gap-2 mb-2">
          {PERSONAS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPersonaKey(p.key)}
              className={`influence-selection-card flex flex-col items-center gap-1 p-2 rounded-lg text-xs transition-all ${
                personaKey === p.key
                  ? "text-text-primary"
                  : "influence-copy"
              }`}
              data-selected={personaKey === p.key}
            >
              <span className="text-base">{p.icon}</span>
              <span className="text-[10px] leading-tight text-center">{p.name}</span>
            </button>
          ))}
        </div>
        <p className="influence-copy-muted text-xs italic">
          {selectedPersona.icon} {selectedPersona.name}: {selectedPersona.description}
        </p>
      </div>

      {/* Backstory */}
      <div>
        <label className="influence-section-title block mb-2">
          Backstory{" "}
          <span className="influence-copy-muted normal-case font-normal">(optional)</span>
        </label>
        <textarea
          value={backstory}
          onChange={(e) => setBackstory(e.target.value)}
          placeholder="Where did your agent come from? What drives them? What's their story?"
          rows={4}
          maxLength={1000}
          className="influence-field w-full rounded-lg px-4 py-2.5 text-sm resize-none"
        />
        <p className="influence-copy-muted text-xs mt-1 text-right">{backstory.length}/1000</p>
      </div>

      {/* Personality description */}
      <div>
        <label className="influence-section-title block mb-2">
          Personality
        </label>
        <textarea
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          placeholder="How does your agent behave in social situations? How do they speak? What makes them tick?"
          rows={3}
          maxLength={500}
          className="influence-field w-full rounded-lg px-4 py-2.5 text-sm resize-none"
        />
        <p className="influence-copy-muted text-xs mt-1 text-right">{personality.length}/500</p>
      </div>

      {/* Strategy style */}
      <div>
        <label className="influence-section-title block mb-2">
          Strategy Style{" "}
          <span className="influence-copy-muted normal-case font-normal">(optional)</span>
        </label>
        <textarea
          value={strategyStyle}
          onChange={(e) => setStrategyStyle(e.target.value)}
          placeholder="Any specific tactics or strategic approach for this agent..."
          rows={2}
          maxLength={300}
          className="influence-field w-full rounded-lg px-4 py-2.5 text-sm resize-none"
        />
      </div>

      {/* Error */}
      {error && (
        <p className="text-red-400 text-sm rounded-lg px-4 py-2.5 border border-red-400/30 bg-red-400/10">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="influence-button-secondary flex-1 text-sm py-2.5 rounded-lg"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="influence-button-primary flex-1 text-sm py-2.5 rounded-lg font-medium"
        >
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
