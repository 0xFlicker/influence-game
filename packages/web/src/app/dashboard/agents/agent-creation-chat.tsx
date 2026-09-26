"use client";

import { useRef, useState } from "react";
import { decodeCreationCommand, type CreationStage } from "@influence/engine/agent-creation-assistant";
import { apiFetch } from "@/lib/api";
import { PERSONAS } from "@/lib/personas";
import { ALL_AGENT_CREATION_TRAITS, type AgentCreationTraitId } from "@influence/engine/agent-creation-traits";
import { CharacterFormation } from "./character-formation";
import { CharacterSectionReader } from "./character-section-reader";
import { AgentCreationIngredients } from "./agent-creation-ingredients";

const labels = { name: "Name", personaKey: "Archetype", gender: "Gender", personality: "Character prompt", strategyStyle: "Strategy", backstory: "Backstory", performanceInstructions: "Performance", visualDesign: "Appearance" };
export type CharacterSection = keyof typeof labels;
export type CharacterChatProfile = Record<CharacterSection, string>;
const replies = {
  character: "What kind of character would you like to play as? Tell me their personality, their story, or how they would play the game.",
  review: "Does that feel right to you? You can say yes, tell me what to change, or edit a section above.",
  appearance: "What do they look like? Describe their face, body, clothing, colors, or any distinctive details.",
  portrait: "Your character is ready to look over. Confirm this headshot when it feels right, or tell me what to change about their appearance.",
};

export function AgentCreationChat({ profile, onGenerate, onAppearance, avatarUrl, busy, blocked, headRequired, hasImage, onHeadshot, onAdvanced, onCancel, onSaveDraft, submitDisabled, submitLabel, creationTraitIds = [], onCreationTraitIdsChange }: {
  creationTraitIds?: AgentCreationTraitId[]; onCreationTraitIdsChange?: (ids: AgentCreationTraitId[]) => void;
  profile: CharacterChatProfile;
  onGenerate: (message: string, sections: CharacterSection[]) => Promise<boolean>;
  onAppearance: (description: string) => Promise<boolean>;
  avatarUrl?: string; busy: boolean; blocked: boolean; headRequired: boolean; hasImage: boolean;
  onHeadshot: () => void; onAdvanced: () => void; onCancel: () => void; onSaveDraft: () => void;
  submitDisabled: boolean; submitLabel: string;
}) {
  const [stageOverride, setStage] = useState<CreationStage | null>(null);
  const stage = stageOverride ?? (profile.personality ? "review" : "character");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [sections, setSections] = useState<CharacterSection[]>([]);
  const [reading, setReading] = useState<CharacterSection | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const locked = busy || pending || blocked;
  const ingredientMode = stage === "character" || stage === "review" ? "character" : "appearance";
  const showIngredients = stage === "character" || stage === "appearance";
  const hasIngredients = showIngredients && creationTraitIds.length > 0;
  const working = pending || busy;
  const visibleMessages = (submitted !== null
    ? [{ role: "user", text: submitted }]
    : messages.length ? messages : [{ role: "assistant", text: replies[stage] }]
  ).slice(-2);


  function selectSection(section: CharacterSection) {
    setReading(null);
    setSelectionVersion(current => current + 1);
    setSections(current => current.includes(section) ? current : [...current, section]);
    if (section !== "visualDesign" && (stage === "appearance" || stage === "portrait")) setStage("review");
    composer.current?.focus();
  }

  function advanceAfterApproval() {
    setStage(hasImage ? "portrait" : "appearance");
    return hasImage
      ? headRequired ? replies.portrait : "Your character and images are ready. You can create your Agent, or tell me what else to change."
      : replies.appearance;
  }

  function approveCharacter() {
    if (stage !== "review" || locked || inFlight.current || ended) return;
    const reply = advanceAfterApproval();
    setMessages(current => [...current,
      { role: "user", text: "Yes, this character feels right." },
      { role: "assistant", text: reply },
    ]);
    setInput(""); setSections([]); setError(null);
    onCreationTraitIdsChange?.([]);
    composer.current?.focus();
  }

  async function send(text = input) {
    if (inFlight.current || locked || ended || (!text.trim() && !hasIngredients)) return;
    const ingredientLabels = creationTraitIds.map(id => ALL_AGENT_CREATION_TRAITS.find(trait => trait.id === id)?.label).join(", ");
    const request = hasIngredients ? `${text.trim() || (ingredientMode === "appearance" ? "Describe their appearance using these visual ingredients." : "Create a character from these ingredients.")}\nSelected character ingredients: ${ingredientLabels}` : text;
    const originalInput = input;
    let succeeded = false;
    setSubmitted([text.trim(), hasIngredients ? ingredientLabels : ""].filter(Boolean).join(" · "));
    setInput("");
    inFlight.current = true; setPending(true); setError(null);
    try {
      const result = await apiFetch<unknown>("/api/agent-profiles/creation-assistant", {
        method: "POST", body: JSON.stringify({ stage, message: request, history: messages.slice(-24).map(message => `${message.role}: ${message.text}`.slice(0, 2000)), sections }),
        signal: AbortSignal.timeout(60_000),
      });
      const command = decodeCreationCommand(JSON.stringify(result), stage);
      let reply: string;
      if (command === "end_abuse" || command === "end_fatigue") {
        setEnded(true);
        reply = command === "end_abuse" ? "I’m ending this conversation here. Your draft is still available in Advanced create." : "We seem to be going in circles, so I’m going to stop here. Your draft is still available in Advanced create.";
      } else if (command === "accept_character") {
        reply = advanceAfterApproval();
      } else if (command === "revise_character") {
        if (!await onGenerate(request, sections)) return;
        setStage("review"); reply = replies.review;
      } else if (command === "generate_appearance" || command === "revise_appearance") {
        if (!await onAppearance(request)) return;
        setStage("portrait"); reply = replies.portrait;
      } else {
        reply = stage === "review" ? "Tell me what you’d like changed, or say yes if the character feels right." : replies[stage];
      }
      setMessages(current => [...current, { role: "user", text: [text.trim(), hasIngredients ? ingredientLabels : ""].filter(Boolean).join(" · ") }, { role: "assistant", text: reply }]);
      onCreationTraitIdsChange?.([]);
      succeeded = true;
      setInput(""); setSections([]);
    } catch (cause) {
      setError(cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")
        ? "The character assistant took too long to respond. Your text and ingredients are still here—please try again."
        : cause instanceof Error ? cause.message : "The assistant could not complete this turn. Try again.");
    } finally {
      if (!succeeded) setInput(originalInput);
      setSubmitted(null); inFlight.current = false; setPending(false);
    }
  }

  return <>
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-8">
      <div><p className="text-xs uppercase tracking-[.2em] text-violet-300">Create your Agent</p><h1 className="text-lg font-semibold">{profile.name || "Who will you be?"}</h1></div>
      <div className="flex gap-2"><button type="button" disabled={locked} onClick={onAdvanced} className="min-h-11 rounded-lg px-3 text-sm text-white/65 disabled:opacity-40">Advanced create</button><button type="button" disabled={pending} onClick={onCancel} className="min-h-11 rounded-lg px-3 text-sm text-white/65">Close</button></div>
    </header>
    <section aria-label="Character fixtures" className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(ellipse_at_50%_42%,rgba(139,92,246,0.09),transparent_62%)] px-4 py-3 sm:px-8">
      {working && (stage === "appearance" || stage === "portrait") ? <CharacterFormation name={profile.name} /> : <div className="mx-auto flex min-h-full max-w-5xl flex-col">
      {stage === "character" && !profile.personality && !avatarUrl ? <div className="agent-creation-empty mx-auto flex min-h-56 w-full max-w-3xl flex-1 flex-col items-center justify-center py-4 text-center sm:min-h-64 sm:py-8">
        <div className="agent-creation-empty-mark flex size-24 items-center justify-center rounded-full border border-amber-200/20 bg-amber-200/[.035] shadow-[0_0_72px_rgba(211,164,80,0.09)] sm:size-40">
          {/* eslint-disable-next-line @next/next/no-img-element -- the existing House brand asset */}
          <img src="/logo.png" alt="" className="size-20 object-contain mix-blend-screen sm:size-32" />
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-tight text-white/90 sm:mt-6 sm:text-2xl">Your character starts here.</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-white/55">Start with a name, a motive, or a way they would play. The House will help you shape the rest.</p>
      </div> : <div className="flex items-start gap-4">
        {busy ? <div role="status" className="hidden h-24 w-24 shrink-0 flex-col items-center justify-center gap-2 rounded-2xl bg-violet-500/10 text-xs text-violet-200 sm:flex"><span className="h-7 w-7 animate-spin rounded-full border-2 border-violet-300/20 border-t-violet-300" />Creating…</div> : avatarUrl ? <button type="button" onClick={onHeadshot} disabled={locked} className="shrink-0" aria-label={headRequired ? "Confirm this headshot" : "Adjust headshot"}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the selected draft portrait */}
          <img src={avatarUrl} alt={`${profile.name} headshot`} className="h-24 w-24 rounded-2xl object-cover" />
        </button> : null}
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
          {(Object.keys(labels) as CharacterSection[]).filter(() => stage !== "character" || profile.personality).map(section => <button key={section} type="button" disabled={locked} onClick={() => setReading(section)} aria-label={`Read ${labels[section]}`} className={`min-w-0 rounded-lg border p-2 text-left ${sections.includes(section) ? "border-violet-300/60 bg-violet-400/10" : "border-white/10"}`}>
            <span className="flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-wide text-white/45">{labels[section]}</span><span aria-hidden="true" className="text-sm text-violet-200">↗</span></span>
            <span className="mt-2 line-clamp-2 text-sm leading-5">{section === "personaKey" ? PERSONAS.find(persona => persona.key === profile[section])?.name : profile[section]}</span>
          </button>)}
          {stage === "character" && !profile.personality && <p className="col-span-2 py-3 text-sm text-white/55">Your name, archetype, and character prompt will take shape here.</p>}
        </div>
      </div>}
      {!ended && showIngredients && onCreationTraitIdsChange && <div hidden={working} className={`agent-creation-ingredients mx-auto w-full max-w-3xl py-4 ${stage === "appearance" ? "order-first border-b border-white/10" : "border-t border-white/10"}`}><AgentCreationIngredients key={ingredientMode} mode={ingredientMode} selected={creationTraitIds} onChange={onCreationTraitIdsChange} disabled={locked} /></div>}
      </div>}
    </section>
    <footer className="shrink-0 border-t border-white/10 bg-[#11111b] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-20px_48px_rgba(0,0,0,0.18)] sm:px-8">
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <div role="log" aria-label="Character creation conversation" aria-live="polite" aria-relevant="additions text" className="max-h-[32dvh] space-y-2 overflow-y-auto px-1 pb-2">
          {visibleMessages.map((message, index) => <p key={`${messages.length}-${index}-${message.text}`} className={`w-fit max-w-[90%] rounded-2xl border px-3 py-2 text-sm leading-6 sm:max-w-xl ${message.role === "user" ? "ml-auto rounded-br-sm border-violet-300/20 bg-violet-400/15 text-violet-100" : "rounded-bl-sm border-white/10 bg-white/[.055] text-white/80"}`}>{message.text}</p>)}
          {working && <div role="status" aria-label="Assistant typing" className="flex w-fit gap-1 rounded-2xl rounded-bl-sm border border-white/10 bg-white/[.055] px-4 py-3">{[0, 1, 2].map(dot => <span key={dot} aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-white/60 motion-reduce:animate-none" style={{ animationDelay: `${dot * 180}ms` }} />)}</div>}
        </div>
        {stage === "review" && !ended && !working && <button type="button" disabled={locked} onClick={approveCharacter} className="influence-button-primary min-h-11 rounded-lg px-4 text-sm">Yes, that feels right</button>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        {!working && !!sections.length && <div className="flex flex-wrap gap-2">{sections.map(section => <button key={`${section}-${selectionVersion}`} type="button" disabled={locked} onClick={() => setSections(current => current.filter(value => value !== section))} aria-label={`Remove change ${labels[section]}`} className="creation-section-pill rounded-full border border-violet-300/30 bg-violet-400/10 px-3 py-1 text-xs">Change {labels[section]} <span aria-hidden="true">×</span></button>)}</div>}
        {!working && !ended && <label htmlFor="agent-creation-message" className="block text-xs font-medium uppercase tracking-[.14em] text-violet-200/80">Your message</label>}
        {!ended && <div className={working ? "relative h-12" : "relative"}>
          <textarea id="agent-creation-message" hidden={working} ref={composer} aria-label="Message the character assistant" placeholder={stage === "appearance" || stage === "portrait" ? "Describe their look…" : "Tell me about your character…"} value={input} maxLength={1400} disabled={locked} onInput={event => setInput(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} rows={2} className="influence-field agent-creation-composer max-h-32 min-h-20 w-full resize-none rounded-2xl py-3 pl-4 pr-14 text-base" />
          <button type="button" aria-label={working ? "Assistant working" : "Send"} aria-busy={working} disabled={locked || (!input.trim() && !hasIngredients)} onClick={() => void send()} className={`group absolute bottom-2 right-2 flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 ${working ? "" : "disabled:opacity-35"}`}>
            <span className="flex size-8 items-center justify-center rounded-full bg-violet-400 text-[#11111b] transition-colors group-hover:bg-violet-300">
              {working ? <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current/25 border-t-current motion-reduce:animate-none" /> : <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>}
            </span>
          </button>
        </div>}

        <div className={working ? "hidden" : "flex flex-wrap items-center gap-2"}>
          {hasImage && headRequired && <button type="button" disabled={locked} onClick={onHeadshot} className="influence-button-primary min-h-11 rounded-lg px-3 text-sm">Confirm this headshot</button>}
          {stage !== "review" && hasImage && !headRequired && <button type="submit" disabled={locked || submitDisabled} className="influence-button-primary min-h-11 rounded-lg px-3 text-sm">{submitLabel}</button>}
          <button type="button" onClick={onSaveDraft} className="ml-auto min-h-11 px-2 text-xs text-white/50">Save draft</button>
        </div>
      </div>
    </footer>
    {reading && <CharacterSectionReader title={labels[reading]} text={reading === "personaKey" ? PERSONAS.find(persona => persona.key === profile[reading])?.name ?? profile[reading] : profile[reading]} editDisabled={locked || ended} onClose={() => setReading(null)} onEdit={() => selectSection(reading)} />}
  </>;
}
