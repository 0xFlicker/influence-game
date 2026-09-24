"use client";

import { PERSONAS } from "@/lib/personas";
import { ALL_AGENT_CREATION_TRAITS, agentCreationTraitsForGroup, type AgentCreationTraitId } from "@influence/engine/agent-creation-traits";
import type { PersonaKey } from "@/lib/api";
import { useEffect, useRef, useState } from "react";

const SUGGESTION_GROUP_IDS = ["form", "vibe", "scene", "style", "roots", "background"] as const;
type SuggestionGroupId = (typeof SUGGESTION_GROUP_IDS)[number];
interface TraitSuggestion {
  groupId: SuggestionGroupId;
  traitId: AgentCreationTraitId;
}
const INITIAL_SUGGESTIONS: TraitSuggestion[] = [
  { groupId: "form", traitId: "dragon" },
  { groupId: "vibe", traitId: "heroic" },
  { groupId: "scene", traitId: "gamer" },
  { groupId: "style", traitId: "neon-noir" },
  { groupId: "roots", traitId: "multicultural" },
  { groupId: "background", traitId: "aristocrat" },
];

function randomTraitForGroup(groupId: SuggestionGroupId, excluded: readonly AgentCreationTraitId[]): AgentCreationTraitId {
  const groupTraits = agentCreationTraitsForGroup(groupId);
  const available = groupTraits.filter((trait) => !excluded.includes(trait.id));
  const pool = available.length > 0 ? available : groupTraits;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  if (!picked) throw new Error(`No character ingredients are available for ${groupId}`);
  return picked.id;
}

function rollSuggestionSet(excluded: readonly AgentCreationTraitId[] = []): TraitSuggestion[] {
  const picked = [...excluded];
  return SUGGESTION_GROUP_IDS.map((groupId) => {
    const id = randomTraitForGroup(groupId, picked);
    picked.push(id);
    return { groupId, traitId: id };
  });
}

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
  const editorRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const focusPromptOnExpand = useRef(false);
  const collapseAfterGeneration = useRef(false);
  const archetypePickerRef = useRef<HTMLDetailsElement>(null);
  const [activityLineIndex, setActivityLineIndex] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [suggestions, setSuggestions] = useState<TraitSuggestion[]>(isEditing ? [] : INITIAL_SUGGESTIONS);
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

  useEffect(() => {
    if (!expanded) return;
    function collapseOnOutsidePointer(event: PointerEvent) {
      if (editorRef.current?.contains(event.target as Node)) return;
      if (busy || activityPhase) {
        collapseAfterGeneration.current = true;
        return;
      }
      setExpanded(false);
    }
    window.addEventListener("pointerdown", collapseOnOutsidePointer, true);
    return () => window.removeEventListener("pointerdown", collapseOnOutsidePointer, true);
  }, [expanded, busy, activityPhase]);

  useEffect(() => {
    if (busy || activityPhase || !collapseAfterGeneration.current) return;
    const timer = window.setTimeout(() => {
      collapseAfterGeneration.current = false;
      setExpanded(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [busy, activityPhase]);

  useEffect(() => {
    if (!expanded || !focusPromptOnExpand.current) return;
    focusPromptOnExpand.current = false;
    promptRef.current?.focus();
  }, [expanded]);

  function send() {
    onSend();
  }

  function addSuggestion(suggestion: TraitSuggestion, index: number) {
    const { traitId, groupId } = suggestion;
    if (!creationTraitIds.includes(traitId) && creationTraitIds.length < 12) {
      onCreationTraitIdsChange([...creationTraitIds, traitId]);
    }
    const remaining = suggestions.filter((_, suggestionIndex) => suggestionIndex !== index);
    const replacement = randomTraitForGroup(groupId, [
      ...creationTraitIds,
      traitId,
      ...remaining.map(({ traitId: remainingId }) => remainingId),
    ]);
    setSuggestions([...remaining, { groupId, traitId: replacement }]);
  }

  function rollAllSuggestions() {
    setSuggestions(rollSuggestionSet([...creationTraitIds, ...suggestions.map(({ traitId }) => traitId)]));
  }

  function expandAndFocusPrompt() {
    focusPromptOnExpand.current = true;
    setExpanded(true);
  }

  const selectedTraits = creationTraitIds
    .map((id) => ALL_AGENT_CREATION_TRAITS.find((trait) => trait.id === id))
    .filter((trait) => trait !== undefined);


  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <div className="mx-auto w-full px-4 pb-3 pt-4 sm:px-6 lg:px-8">
        <section
          ref={editorRef}
          className={`w-full ${expanded ? "rounded-2xl border border-white/12 bg-surface/95 p-3 shadow-2xl shadow-black/30 sm:p-4" : ""}`}
          aria-label="Agent Workshop"
          onClick={(event) => {
            if (!expanded && !(event.target instanceof HTMLButtonElement)) expandAndFocusPrompt();
          }}
          onBlurCapture={(event) => {
            const nextTarget = event.relatedTarget;
            if (expanded && !busy && !activityPhase && (!nextTarget || !event.currentTarget.contains(nextTarget as Node))) setExpanded(false);
          }}
        >
          {expanded && <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
            <div>
              <p className="text-sm font-semibold text-text-primary">Agent Workshop</p>
              <p className="mt-0.5 text-xs text-white/45">{isEditing ? "Tell me what you want to change." : "Bring your next character to life."}</p>
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
          </div>}
          {expanded && activityPhase && <div className="mb-3 flex items-center gap-3 overflow-hidden rounded-xl border border-phase/20 bg-gradient-to-r from-phase/[0.10] via-white/[0.035] to-transparent px-3 py-3 sm:px-4" aria-label="AI generation activity">
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
          {expanded && !isEditing && <div className="mb-2 flex min-w-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Character ingredient suggestions">
            <button
              type="button"
              onClick={rollAllSuggestions}
              disabled={busy || submitting}
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-phase/35 bg-phase/[0.06] px-3 text-xs font-semibold text-phase transition-colors hover:border-phase/60 hover:bg-phase/10 disabled:opacity-50"
            >
              <span aria-hidden="true">✦</span> Surprise me
            </button>
            {suggestions.map((suggestion, index) => {
              const trait = ALL_AGENT_CREATION_TRAITS.find((candidate) => candidate.id === suggestion.traitId);
              if (!trait) return null;
              return <button
                key={`${index}-${suggestion.groupId}-${suggestion.traitId}`}
                type="button"
                onClick={() => addSuggestion(suggestion, index)}
                disabled={busy || submitting || creationTraitIds.length >= 12}
                aria-label={`Add ${trait.label} ingredient`}
                className="inline-flex min-h-7 shrink-0 items-center rounded-full border border-white/12 bg-white/[0.025] px-2.5 text-[11px] text-white/60 transition-colors hover:border-phase/35 hover:bg-phase/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                {trait.label}
              </button>;
            })}
          </div>}
          {expanded && assistantNote && <p role="status" className="mb-3 rounded-xl bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/70">{assistantNote}</p>}
          <div className={expanded ? "flex items-end gap-3" : ""}>
            <label htmlFor="agent-ai-change-request" className="sr-only">{isEditing ? "What would you like to change about this Agent?" : "What should this Agent be like?"}</label>
            <div className={`min-w-0 ${expanded ? "flex-1 rounded-xl" : "w-full rounded-full shadow-lg shadow-black/25"} overflow-hidden border border-white/15 bg-black/30 transition-colors focus-within:border-phase/60 ${expanded ? "focus-within:ring-1 focus-within:ring-phase/25" : ""}`}>
              {expanded && selectedTraits.length > 0 && <div className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Selected character ingredients">
                {selectedTraits.map((trait) => <span key={trait.id} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-phase/40 bg-phase/15 pl-3 pr-1 text-sm font-medium text-white shadow-sm shadow-black/20">
                  <span>{trait.label}</span>
                  <button
                    type="button"
                    onClick={() => onCreationTraitIdsChange(creationTraitIds.filter((id) => id !== trait.id))}
                    disabled={busy || submitting}
                    aria-label={`Remove ${trait.label} ingredient`}
                    className="grid size-7 place-items-center rounded-full text-base leading-none text-white/55 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-45"
                  >
                    ×
                  </button>
                </span>)}
              </div>}
              <textarea
                ref={promptRef}
                id="agent-ai-change-request"
                value={value}
                onInput={(event) => onChange(event.currentTarget.value)}
                onFocus={() => { if (!expanded) setExpanded(true); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (!expanded) expandAndFocusPrompt();
                    else if (canSend) send();
                  }
                }}
                maxLength={2_000}
                rows={expanded ? 3 : 1}
                placeholder={expanded
                  ? isEditing ? "What would you like to change about this Agent?" : "What should this Agent be like?"
                  : isEditing ? "Tell me what to change…" : "Describe your Agent…"}
                className={`block w-full border-0 bg-transparent text-base leading-6 text-white outline-none placeholder:text-white/35 focus:outline-none focus:ring-0 ${expanded ? "min-h-24 resize-y px-4 py-3 sm:min-h-28" : "h-12 resize-none px-5 py-3"}`}
                disabled={busy || submitting}
              />
            </div>
            {expanded && <button type="button" onClick={send} disabled={!canSend} aria-label="Send Agent request" className="influence-button-primary min-h-12 shrink-0 rounded-xl px-5 text-sm font-semibold sm:px-7">{busy ? activityPhase === "images" ? "Making art…" : "Creating…" : "Send"}</button>}
          </div>
          {expanded && <label className="mt-3 flex min-h-10 cursor-pointer items-center gap-2 px-1 text-xs text-white/55">
            <input type="checkbox" checked={regenerateImages} onChange={(event) => onRegenerateImagesChange(event.target.checked)} disabled={busy || submitting} className="size-4 accent-phase" />
            Also generate {isEditing ? "a new portrait and full-body reference" : "the portrait and full-body reference"}
          </label>}
          {expanded && error && <p role="alert" className="mt-2 px-1 text-xs leading-5 text-red-300">{error}</p>}
          <div className={`mt-3 flex flex-wrap items-center justify-end gap-2 ${expanded ? "border-t border-white/8 pt-3" : "px-1"}`}>
            {expanded && <span className="mr-auto hidden text-xs text-white/35 sm:inline">AI changes stay in this draft until you save.</span>}
            {expanded && <button type="button" onClick={onSaveDraft} className="influence-button-secondary min-h-10 rounded-lg px-3 text-xs sm:text-sm">Save draft</button>}
            {expanded && generationBusy && <button type="button" onClick={onCancelGeneration} className="influence-button-secondary min-h-10 rounded-lg px-3 text-xs sm:text-sm">Cancel generation</button>}
            <button type="button" onClick={onCancel} className="influence-button-secondary min-h-10 rounded-lg px-3 text-xs sm:text-sm">Cancel</button>
            <button type="submit" disabled={submitDisabled} className="influence-button-primary min-h-10 rounded-lg px-4 text-xs font-semibold sm:px-5 sm:text-sm">{submitting ? isEditing ? "Saving…" : "Creating…" : submitLabel}</button>
          </div>
        </section>
      </div>
    </div>
  );
}
