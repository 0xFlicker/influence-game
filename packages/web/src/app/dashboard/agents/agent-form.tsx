"use client";

import { useEffect, useState } from "react";
import {
  AGENT_GENDER_OPTIONS,
  avatarDraftProfileFingerprint,
  getDraftAgentAvatarGeneration,
  generatePersonality,
  requestDraftAgentAvatarGeneration,
  type AvatarCompletion,
  type PersonaKey,
  type SavedAgent,
  type CreateAgentParams,
  type AgentGender,
  type GeneratePersonalityParams,
} from "@/lib/api";
import { PERSONAS } from "@/lib/personas";
import { AvatarUpload } from "@/components/avatar-upload";
import { isAvatarCompletionPending, isSameAvatarCompletion } from "./avatar-completion";

interface AgentFormProps {
  initial?: SavedAgent;
  onSubmit: (params: CreateAgentParams) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  compact?: boolean;
}

export function AgentForm({ initial, onSubmit, onCancel, submitLabel = "Save Agent", compact = false }: AgentFormProps) {
  const isEditing = Boolean(initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [backstory, setBackstory] = useState(initial?.backstory ?? "");
  const [personality, setPersonality] = useState(initial?.personality ?? "");
  const [strategyStyle, setStrategyStyle] = useState(initial?.strategyStyle ?? "");
  const [personaKey, setPersonaKey] = useState<PersonaKey>(initial?.personaKey ?? "strategic");
  const [gender, setGender] = useState<AgentGender | "">(initial?.gender ?? "");
  const [explicitAvatarUrl, setExplicitAvatarUrl] = useState<string | undefined>(initial?.avatarUrl ?? undefined);
  const [draftAvatarUrl, setDraftAvatarUrl] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [portraitStarting, setPortraitStarting] = useState(false);
  const [draftAvatarCompletion, setDraftAvatarCompletion] = useState<AvatarCompletion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedPersona = PERSONAS.find((p) => p.key === personaKey)!;
  const currentProfileFingerprint = gender
    ? avatarDraftProfileFingerprint({
        name,
        gender,
        backstory: backstory || undefined,
        personality,
        strategyStyle: strategyStyle || undefined,
        personaKey,
      })
    : null;
  const draftIsStale = Boolean(
    draftAvatarCompletion?.profileFingerprint
    && draftAvatarCompletion.profileFingerprint !== currentProfileFingerprint,
  );
  const avatarUrl = explicitAvatarUrl ?? (draftIsStale ? undefined : draftAvatarUrl);
  const portraitPending = draftAvatarCompletion
    ? isAvatarCompletionPending(draftAvatarCompletion) && !draftIsStale
    : false;
  const generationPending = generating || portraitStarting || portraitPending;

  useEffect(() => {
    const requestId = draftAvatarCompletion?.generationRequestId;
    if (!requestId || !portraitPending) return;

    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await getDraftAgentAvatarGeneration(requestId);
        if (cancelled) return;
        setError(null);
        setDraftAvatarCompletion((current) => isSameAvatarCompletion(current, result.avatarCompletion)
          ? current
          : result.avatarCompletion);
        if (result.avatarCompletion.status === "completed" && result.avatarCompletion.avatarUrl) {
          setDraftAvatarUrl(result.avatarCompletion.avatarUrl);
          return;
        }
        if (isAvatarCompletionPending(result.avatarCompletion)) {
          timer = window.setTimeout(() => void poll(), 2_500);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("[AgentForm] Failed to refresh draft portrait status:", err);
          setError("Portrait status could not be refreshed. Waiting to try again; you can upload an image instead.");
          timer = window.setTimeout(() => void poll(), 5_000);
        }
      }
    };

    timer = window.setTimeout(() => void poll(), 2_500);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [draftAvatarCompletion?.generationRequestId, portraitPending]);

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
          gender: gender || undefined,
        };
      } else {
        params.archetype = personaKey;
        params.gender = gender || undefined;
      }
      const result = await generatePersonality(params);
      setName(result.name);
      setBackstory(result.backstory ?? "");
      setPersonality(result.personality);
      setStrategyStyle(result.strategyStyle ?? "");
      setPersonaKey(result.personaKey);
      setGender(result.gender);
      setGenerating(false);

      if (!explicitAvatarUrl) {
        await startDraftPortrait({
          name: result.name,
          gender: result.gender,
          backstory: result.backstory ?? undefined,
          personality: result.personality,
          strategyStyle: result.strategyStyle ?? undefined,
          personaKey: result.personaKey,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI generation failed. Try again or fill in manually.");
    } finally {
      setGenerating(false);
    }
  }

  async function startDraftPortrait(profile: Parameters<typeof requestDraftAgentAvatarGeneration>[0]) {
    setPortraitStarting(true);
    setDraftAvatarCompletion(null);
    setDraftAvatarUrl(undefined);
    setError(null);
    try {
      const draft = await requestDraftAgentAvatarGeneration(profile);
      setDraftAvatarCompletion(draft.avatarCompletion);
      if (draft.avatarCompletion.status === "completed" && draft.avatarCompletion.avatarUrl) {
        setDraftAvatarUrl(draft.avatarCompletion.avatarUrl);
      }
    } catch (err) {
      setDraftAvatarCompletion({
        status: "failed",
        reason: err instanceof Error ? err.message : "Portrait generation could not be started.",
        retryable: true,
      });
    } finally {
      setPortraitStarting(false);
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
    if (!gender) {
      setError("Select a gender for this agent.");
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
        gender,
        avatarUrl: explicitAvatarUrl,
        avatarGenerationRequestId: isEditing || explicitAvatarUrl || draftIsStale
          ? undefined
          : draftAvatarCompletion?.generationRequestId,
      });
    } catch (err) {
      setError(agentSaveErrorMessage(err));
      setSubmitting(false);
    }
  }

  const fullWidthClass = compact ? "md:col-span-2" : "";

  return (
    <form onSubmit={handleSubmit} className={compact ? "grid grid-cols-1 gap-5 md:grid-cols-2" : "space-y-5"}>
      {/* Avatar upload */}
      <div className={`${fullWidthClass} flex justify-center`}>
        <AvatarUpload
          currentUrl={avatarUrl}
          persona={personaKey}
          name={name || "Agent"}
          onUploaded={setExplicitAvatarUrl}
        />
      </div>

      {/* AI Help */}
      <div className={`${fullWidthClass} influence-panel-dashed flex items-center gap-3 rounded-lg p-3`}>
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
          disabled={generationPending}
          className="influence-button-primary shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium"
          aria-live="polite"
        >
          {generationPending && (
            <span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current/30 border-t-current align-[-1px]" aria-hidden="true" />
          )}
          {generationButtonLabel({ generating, portraitStarting, portraitPending })}
        </button>
      </div>
      {!explicitAvatarUrl && (draftIsStale || (draftAvatarCompletion && !isAvatarCompletionPending(draftAvatarCompletion))) && gender && name.trim() && personality.trim() && (
        <button
          type="button"
          onClick={() => void startDraftPortrait({
            name: name.trim(),
            gender,
            backstory: backstory.trim() || undefined,
            personality: personality.trim(),
            strategyStyle: strategyStyle.trim() || undefined,
            personaKey,
          })}
          disabled={portraitStarting}
          className={`${fullWidthClass} influence-button-secondary w-full rounded-lg px-3 py-2 text-xs`}
        >
          Regenerate portrait
        </button>
      )}

      {/* Agent name */}
      <div>
        <label className="influence-section-title block mb-2">
          Agent Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="e.g. ShadowPlay-7"
          maxLength={32}
          className="influence-field w-full rounded-lg px-4 py-2.5 text-sm"
        />
        <p className="influence-copy-muted text-xs mt-1">
          The name your agent uses in games. Other players will see this.
        </p>
      </div>

      {/* Gender selection */}
      <fieldset aria-describedby="agent-gender-help" aria-required="true">
        <legend className="influence-section-title block mb-2">
          Gender <span className="text-red-400" aria-hidden="true">*</span>
        </legend>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Gender">
          {AGENT_GENDER_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setGender(value)}
              role="radio"
              aria-checked={gender === value}
              data-selected={gender === value}
              className={`influence-selection-card rounded-lg px-3 py-2.5 text-sm transition-all ${
                gender === value ? "text-text-primary" : "influence-copy"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p id="agent-gender-help" className="influence-copy-muted text-xs mt-1">
          Used to guide portrait generation.
        </p>
      </fieldset>

      {/* Persona selection */}
      <div className={fullWidthClass}>
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
          rows={4}
          maxLength={500}
          className="influence-field w-full rounded-lg px-4 py-2.5 text-sm resize-none"
        />
        <p className="influence-copy-muted text-xs mt-1 text-right">{personality.length}/500</p>
      </div>

      {/* Strategy style */}
      <div className={fullWidthClass}>
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
        <p role="alert" className={`${fullWidthClass} text-red-400 text-sm rounded-lg px-4 py-2.5 border border-red-400/30 bg-red-400/10`}>
          {error}
        </p>
      )}

      {/* Actions */}
      <div className={`${fullWidthClass} flex gap-3 pt-1`}>
        <button
          type="button"
          onClick={onCancel}
          className="influence-button-secondary flex-1 text-sm py-2.5 rounded-lg"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || (!avatarUrl && (portraitStarting || portraitPending || draftIsStale))}
          className="influence-button-primary flex-1 text-sm py-2.5 rounded-lg font-medium"
        >
          {!avatarUrl && (portraitStarting || portraitPending)
            ? "Generating portrait..."
            : submitting
            ? isEditing ? "Saving..." : avatarUrl ? "Creating..." : "Starting portrait..."
            : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function agentSaveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to save agent.";
}

export function generationButtonLabel(input: {
  generating: boolean;
  portraitStarting: boolean;
  portraitPending: boolean;
}): string {
  if (input.generating) {
    return "Generating...";
  }
  if (input.portraitStarting || input.portraitPending) {
    return "Generating portrait...";
  }
  return "Generate";
}
