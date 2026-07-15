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
}

export function AgentForm({ initial, onSubmit, onCancel, submitLabel = "Save Agent" }: AgentFormProps) {
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
  const [generatedWithAi, setGeneratedWithAi] = useState(false);
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
  const generationActivity = resolveGenerationActivity({
    generating,
    portraitStarting,
    portraitPending,
    draftAvatarCompletion,
    draftIsStale,
    submitting,
    generatedWithAi,
    isEditing,
    hasAvatar: Boolean(avatarUrl),
  });

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
    setGeneratedWithAi(false);
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
      setGeneratedWithAi(true);
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

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Avatar upload */}
      <div className="flex justify-center">
        <AvatarUpload
          currentUrl={avatarUrl}
          persona={personaKey}
          name={name || "Agent"}
          onUploaded={setExplicitAvatarUrl}
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
          disabled={generating || portraitStarting || portraitPending}
          className="influence-button-primary shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium"
        >
          {generating ? "Generating..." : portraitStarting || portraitPending ? "Generating portrait..." : "AI Help"}
        </button>
      </div>
      {generationActivity && (
        <div
          role="status"
          aria-live="polite"
          className="influence-panel flex items-start gap-3 rounded-lg px-3 py-2.5"
        >
          {generationActivity.busy && (
            <span className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent/30 border-t-accent" aria-hidden="true" />
          )}
          <div className="min-w-0 text-xs">
            <p className="text-text-primary font-medium">
              {generationActivity.title}
            </p>
            <p className="influence-copy-muted mt-0.5">
              {generationActivity.detail}
            </p>
          </div>
        </div>
      )}
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
          className="influence-button-secondary w-full rounded-lg px-3 py-2 text-xs"
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
          onChange={(e) => setName(e.target.value)}
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
        <p role="alert" className="text-red-400 text-sm rounded-lg px-4 py-2.5 border border-red-400/30 bg-red-400/10">
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

function resolveGenerationActivity(input: {
  generating: boolean;
  portraitStarting: boolean;
  portraitPending: boolean;
  draftAvatarCompletion: AvatarCompletion | null;
  draftIsStale: boolean;
  submitting: boolean;
  generatedWithAi: boolean;
  isEditing: boolean;
  hasAvatar: boolean;
}): { title: string; detail: string; busy: boolean } | null {
  if (input.generating) {
    return {
      title: "Generating agent details...",
      detail: "Portrait generation starts as soon as these details are ready.",
      busy: true,
    };
  }
  if (input.portraitStarting || input.portraitPending) {
    return {
      title: "Generating portrait...",
      detail: "You can review the agent while the portrait is being created.",
      busy: true,
    };
  }
  if (input.draftIsStale) {
    return {
      title: "Portrait needs refresh",
      detail: "Agent details changed. Regenerate the portrait before saving.",
      busy: false,
    };
  }
  if (input.draftAvatarCompletion?.status === "completed") {
    return {
      title: "Portrait ready",
      detail: "The generated portrait will be saved with this agent.",
      busy: false,
    };
  }
  if (input.draftAvatarCompletion) {
    return {
      title: "Portrait not generated",
      detail: input.draftAvatarCompletion.reason ?? "Portrait generation could not be completed.",
      busy: false,
    };
  }
  if (input.submitting) {
    return {
      title: input.isEditing
        ? "Saving changes..."
        : input.hasAvatar ? "Creating agent..." : "Creating agent and starting portrait...",
      detail: !input.hasAvatar && !input.isEditing
        ? "Portrait status will stay visible after this form closes."
        : "Review the details, then save when ready.",
      busy: true,
    };
  }
  if (input.generatedWithAi) {
    return {
      title: input.isEditing ? "Updated details ready" : "Agent details ready",
      detail: "Review the details, then save when ready.",
      busy: false,
    };
  }
  return null;
}
