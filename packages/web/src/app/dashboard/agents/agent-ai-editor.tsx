"use client";

import { PERSONAS } from "@/lib/personas";
import { AGENT_CREATION_TRAIT_GROUPS, ALL_AGENT_CREATION_TRAITS, agentCreationTraitsForGroup, type AgentCreationTraitId } from "@influence/engine/agent-creation-traits";
import type { PersonaKey } from "@/lib/api";
import { useEffect, useRef, useState } from "react";

const PREBAKED_STUDIO_CHATTER = [
  "Running 10,000 imaginary character simulations…",
  "Multiplying one billion vectors. The vibes are looking promising…",
  "Consulting the tiny council of character designers…",
  "Calculating the optimal cape-to-chaos ratio…",
  "Checking whether the dragon has negotiation experience…",
  "Testing names for maximum dramatic entrance…",
  "Making sure the schemer has at least one redeeming quality…",
  "Spinning up a highly unofficial drama simulator…",
];

interface AgentAIEditorProps {
  isEditing: boolean;
  creationTraitIds: AgentCreationTraitId[];
  onCreationTraitIdsChange: (ids: AgentCreationTraitId[]) => void;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  canSend: boolean;
  busy: boolean;
  submitting: boolean;
  regenerateImages: boolean;
  onRegenerateImagesChange: (checked: boolean) => void;
  personaKey: PersonaKey | null;
  onPersonaKeyChange: (key: PersonaKey) => void;
  allowAIChoose: boolean;
  onAllowAIChooseChange: (allow: boolean) => void;
  status: string;
  activityPhase: "profile" | "images" | null;
  generationQuips: string[];
  assistantNote: string | null;
  error: string | null;
  onSaveDraft: () => void;
  onCancelGeneration: () => void;
  generationBusy: boolean;
  onCancel: () => void;
  submitDisabled: boolean;
  submitLabel: string;
}

export function AgentAIEditor({
  isEditing,
  creationTraitIds,
  onCreationTraitIdsChange,
  value,
  onChange,
  onSend,
  canSend,
  busy,
  submitting,
  regenerateImages,
  onRegenerateImagesChange,
  personaKey,
  onPersonaKeyChange,
  allowAIChoose,
  onAllowAIChooseChange,
  status,
  activityPhase,
  generationQuips,
  assistantNote,
  error,
  onSaveDraft,
  onCancelGeneration,
  generationBusy,
  onCancel,
  submitDisabled,
  submitLabel,
}: AgentAIEditorProps) {
  const ingredientPickerRef = useRef<HTMLDetailsElement>(null);
  const archetypePickerRef = useRef<HTMLDetailsElement>(null);
  const [activityLineIndex, setActivityLineIndex] = useState(0);
  const selectedPersona = PERSONAS.find((persona) => persona.key === personaKey);
  const selectedArchetypeLabel = allowAIChoose ? "Let AI choose" : selectedPersona?.name ?? "Strategist";
  const activityLines = activityPhase === "images" && generationQuips.length > 0
    ? generationQuips
    : PREBAKED_STUDIO_CHATTER;

  useEffect(() => {
    if (!activityPhase) return;
    const timer = window.setInterval(() => {
      setActivityLineIndex((index) => (index + 1) % activityLines.length);
    }, 2_800);
    return () => window.clearInterval(timer);
  }, [activityPhase, activityLines.length]);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!archetypePickerRef.current?.contains(event.target as Node)) {
        archetypePickerRef.current?.removeAttribute("open");
      }
    }
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  function send() {
    ingredientPickerRef.current?.removeAttribute("open");
    onSend();
  }

  function surpriseMe() {
    const pick = <T,>(items: readonly T[]): T | undefined => items[Math.floor(Math.random() * items.length)];
    const formTraits = agentCreationTraitsForGroup("form").filter((trait) => trait.id !== "anthropomorphic");
    const selected = [
      pick(formTraits)?.id,
      pick(agentCreationTraitsForGroup("vibe"))?.id,
      pick(agentCreationTraitsForGroup("scene"))?.id,
      pick(agentCreationTraitsForGroup("style"))?.id,
      ...(Math.random() < 0.35 ? [pick(agentCreationTraitsForGroup("roots"))?.id] : []),
      ...(Math.random() < 0.35 ? [pick(agentCreationTraitsForGroup("background"))?.id] : []),
    ].filter((id): id is AgentCreationTraitId => id !== undefined);
    onCreationTraitIdsChange(selected);
  }

  function toggleTrait(id: AgentCreationTraitId) {
    const selected = creationTraitIds.includes(id);
    if (selected) onCreationTraitIdsChange(creationTraitIds.filter((current) => current !== id));
    else if (creationTraitIds.length < 12) onCreationTraitIdsChange([...creationTraitIds, id]);
  }

  const selectedTraits = ALL_AGENT_CREATION_TRAITS
    .filter((trait) => creationTraitIds.includes(trait.id));


  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <div className="mx-auto w-full px-4 pb-3 pt-4 sm:px-6 lg:px-8">
        <section className="w-full rounded-2xl border border-white/12 bg-surface/95 p-3 shadow-2xl shadow-black/30 sm:p-4" aria-label="AI Agent editor">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
            <div>
              <p className="text-sm font-semibold text-text-primary">AI editor</p>
              <p className="mt-0.5 text-xs text-white/45">{isEditing ? "Describe a change and I’ll update this draft." : "Describe the Agent you want to create."}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="text-xs text-white/45">Archetype</span>
              <details
                ref={archetypePickerRef}
                className="group relative"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    archetypePickerRef.current?.removeAttribute("open");
                    archetypePickerRef.current?.querySelector("summary")?.focus();
                  }
                }}
              >
                <summary
                  aria-label="Base archetype"
                  aria-disabled={busy || submitting}
                  onClick={(event) => {
                    if (busy || submitting) event.preventDefault();
                  }}
                  className={`flex min-h-10 max-w-56 cursor-pointer list-none items-center gap-2 rounded-lg border border-white/15 bg-white/[0.035] px-3 py-2 text-sm text-white/85 transition-colors hover:border-white/25 hover:bg-white/[0.06] marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phase/70 ${busy || submitting ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <span className="max-w-40 truncate">{allowAIChoose ? "✦ " : `${selectedPersona?.icon ?? "♟️"} `}{selectedArchetypeLabel}</span>
                  <span aria-hidden="true" className="ml-auto text-xs text-white/40 transition-transform group-open:rotate-180">⌄</span>
                </summary>
                <div aria-label="Archetype choices" className="absolute bottom-full right-0 z-50 mb-2 max-h-[min(52vh,26rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-white/15 bg-[#14141b] p-3 shadow-2xl shadow-black/50 ring-1 ring-black/30 sm:p-3.5">
                  <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">Choose a play style</p>
                  <button
                    type="button"
                    aria-pressed={allowAIChoose}
                    onClick={() => {
                      onAllowAIChooseChange(true);
                      archetypePickerRef.current?.removeAttribute("open");
                      archetypePickerRef.current?.querySelector("summary")?.focus();
                    }}
                    disabled={busy || submitting}
                    className={`mb-2 flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${allowAIChoose ? "border-phase/55 bg-phase/10" : "border-white/10 bg-white/[0.025] hover:border-white/25 hover:bg-white/[0.05]"}`}
                  >
                    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-phase/15 text-base text-phase">✦</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-white/90">Let AI choose</span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-white/45">Pick the best fit from all valid archetypes.</span>
                    </span>
                    {allowAIChoose && <span aria-hidden="true" className="text-sm text-phase">✓</span>}
                  </button>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {PERSONAS.map((persona) => {
                      const selected = !allowAIChoose && (personaKey ?? "strategic") === persona.key;
                      return <button
                        key={persona.key}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          onPersonaKeyChange(persona.key);
                          archetypePickerRef.current?.removeAttribute("open");
                          archetypePickerRef.current?.querySelector("summary")?.focus();
                        }}
                        disabled={busy || submitting}
                        className={`flex min-w-0 items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-50 ${selected ? "border-phase/50 bg-phase/[0.09]" : "border-transparent bg-white/[0.02] hover:border-white/12 hover:bg-white/[0.05]"}`}
                      >
                        <span aria-hidden="true" className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-white/[0.06] text-sm">{persona.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-white/85">
                            <span className="truncate">{persona.name}</span>
                            {selected && <span aria-hidden="true" className="text-phase">✓</span>}
                          </span>
                          <span className="mt-0.5 block text-[10px] leading-4 text-white/45">{persona.description}</span>
                        </span>
                      </button>;
                    })}
                  </div>
                </div>
              </details>
              <p className="hidden text-xs text-white/40 lg:block" aria-live="polite">{status}</p>
            </div>
          </div>
          {activityPhase && <div className="mb-3 flex items-center gap-3 overflow-hidden rounded-xl border border-phase/20 bg-gradient-to-r from-phase/[0.10] via-white/[0.035] to-transparent px-3 py-3 sm:px-4" aria-label="AI generation activity">
            <div className="relative grid size-10 shrink-0 place-items-center rounded-full border border-phase/25 bg-phase/10 text-lg text-phase">
              <span className="absolute inset-0 rounded-full border border-phase/30 motion-safe:animate-ping motion-reduce:animate-none" aria-hidden="true" />
              <span className="relative" aria-hidden="true">✦</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-phase" aria-live="polite">
                {activityPhase === "profile" ? "Inventing your character" : "Making your character’s look"}
              </p>
              <p className="mt-1 truncate text-sm text-white/75" aria-live="off" key={`${activityPhase}-${activityLineIndex}`}>
                {activityPhase === "images" && generationQuips.length > 0
                  ? `“${activityLines[activityLineIndex % activityLines.length]}”`
                  : activityLines[activityLineIndex % activityLines.length]}
              </p>
            </div>
            <div className="hidden shrink-0 items-center gap-1.5 sm:flex" aria-hidden="true">
              {[0, 1, 2].map((dot) => <span key={dot} className={`size-1.5 rounded-full bg-phase/80 motion-safe:animate-pulse motion-reduce:animate-none ${dot === 1 ? "[animation-delay:180ms]" : dot === 2 ? "[animation-delay:360ms]" : ""}`} />)}
            </div>
          </div>}
          {!isEditing && <div className="mb-3 rounded-xl border border-white/8 bg-black/10 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-xs font-medium text-white/55">Character ingredients</span>
              <button type="button" onClick={surpriseMe} disabled={busy || submitting} className="min-h-8 rounded-lg border border-phase/35 px-2.5 text-xs font-semibold text-phase hover:bg-phase/10 disabled:opacity-50">Surprise me</button>
              <details ref={ingredientPickerRef} className="group relative">
                <summary className="flex min-h-8 cursor-pointer list-none items-center rounded-lg border border-white/15 px-2.5 text-xs text-white/70 marker:hidden hover:bg-white/5">Browse pills <span className="ml-1 text-white/40">⌄</span></summary>
                <div className="absolute bottom-full right-0 z-40 mb-2 max-h-[min(55vh,26rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-white/15 bg-[#15151c] p-3 shadow-2xl">
                  {AGENT_CREATION_TRAIT_GROUPS.map((group) => <fieldset key={group.id} className="mb-3 last:mb-0">
                    <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">{group.label}</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {group.traits.map((trait) => {
                        const selected = creationTraitIds.includes(trait.id);
                        return <button key={trait.id} type="button" aria-pressed={selected} onClick={() => toggleTrait(trait.id)} disabled={busy || submitting || (!selected && creationTraitIds.length >= 12)} className={`min-h-8 rounded-full border px-2.5 text-xs transition-colors disabled:opacity-45 ${selected ? "border-phase/70 bg-phase/20 text-white" : "border-white/12 bg-white/[0.03] text-white/65 hover:border-white/30 hover:text-white"}`}>{trait.label}</button>;
                      })}
                    </div>
                    {group.id === "roots" && <p className="mt-1.5 text-[11px] leading-4 text-white/40">Surprise me may add a broad life-root or language ingredient. Describe specific cultural identities yourself; culture is never costume.</p>}
                  </fieldset>)}
                </div>
              </details>
            </div>
            {selectedTraits.length > 0
              ? <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Selected character ingredients">
                {selectedTraits.map((trait) => <button key={trait.id} type="button" onClick={() => toggleTrait(trait.id)} disabled={busy || submitting} aria-label={`Remove ${trait.label}`} className="min-h-7 rounded-full border border-phase/30 bg-phase/10 px-2.5 text-[11px] text-white/80 hover:border-phase/60">{trait.label} <span aria-hidden="true" className="ml-1 text-white/45">×</span></button>)}
              </div>
              : <p className="mt-1 text-[11px] text-white/35">Pick a few, or let Surprise me build a varied character.</p>}
          </div>}
          {assistantNote && <p role="status" className="mb-3 rounded-xl bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/70">{assistantNote}</p>}
          <div className="flex items-end gap-3">
            <label htmlFor="agent-ai-change-request" className="sr-only">{isEditing ? "What would you like to change about this Agent?" : "What should this Agent be like?"}</label>
            <textarea
              id="agent-ai-change-request"
              value={value}
              onInput={(event) => onChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (canSend) send();
                }
              }}
              maxLength={2_000}
              rows={3}
              placeholder={isEditing ? "What would you like to change about this Agent?" : "What should this Agent be like?"}
              className="influence-field min-h-24 min-w-0 flex-1 resize-y rounded-xl px-4 py-3 text-base leading-6 placeholder:text-white/35 sm:min-h-28"
              disabled={busy || submitting}
            />
            <button type="button" onClick={send} disabled={!canSend} className="influence-button-primary min-h-12 shrink-0 rounded-xl px-5 text-sm font-semibold sm:px-7">{busy ? activityPhase === "images" ? "Making art…" : "Creating…" : "Send"}</button>
          </div>
          <label className="mt-3 flex min-h-10 cursor-pointer items-center gap-2 px-1 text-xs text-white/55">
            <input type="checkbox" checked={regenerateImages} onChange={(event) => onRegenerateImagesChange(event.target.checked)} disabled={busy || submitting} className="size-4 accent-phase" />
            Also generate {isEditing ? "a new portrait and full-body reference" : "the portrait and full-body reference"}
          </label>
          {error && <p role="alert" className="mt-2 px-1 text-xs leading-5 text-red-300">{error}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/8 pt-3">
            <span className="mr-auto hidden text-xs text-white/35 sm:inline">AI changes stay in this draft until you save.</span>
            <button type="button" onClick={onSaveDraft} className="influence-button-secondary min-h-10 rounded-lg px-3 text-xs sm:text-sm">Save draft</button>
            {generationBusy && <button type="button" onClick={onCancelGeneration} className="influence-button-secondary min-h-10 rounded-lg px-3 text-xs sm:text-sm">Cancel generation</button>}
            <button type="button" onClick={onCancel} className="influence-button-secondary min-h-10 rounded-lg px-3 text-xs sm:text-sm">Cancel</button>
            <button type="submit" disabled={submitDisabled} className="influence-button-primary min-h-10 rounded-lg px-4 text-xs font-semibold sm:px-5 sm:text-sm">{submitting ? isEditing ? "Saving…" : "Creating…" : submitLabel}</button>
          </div>
        </section>
      </div>
    </div>
  );
}
