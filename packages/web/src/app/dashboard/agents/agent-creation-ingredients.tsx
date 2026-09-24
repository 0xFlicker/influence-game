"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AGENT_CREATION_TRAIT_GROUPS, ALL_AGENT_CREATION_TRAITS, type AgentCreationTraitId } from "@influence/engine/agent-creation-traits";

const GROUPS = {
  character: ["scene", "strategy", "gender"],
  appearance: ["form", "style"],
} as const;
const INITIAL: Record<"character" | "appearance", AgentCreationTraitId[]> = {
  character: ["gamer", "streamer", "inventor", "alliance-builder", "under-the-radar", "deal-maker", "aristocrat", "small-town", "working-class", "gender-male", "gender-female", "gender-non-binary"],
  appearance: ["furry", "dragon", "robot", "neon-noir", "storybook", "scrappy-diy"],
};

/** Keep swipe/trackpad scrolling and fade only edges with hidden pills. */
function PillRow({ children, label }: { children: ReactNode; label: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = viewport.current;
    const inner = content.current;
    if (!element || !inner) return;
    const update = () => {
      const left = element.scrollLeft > 1;
      const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      element.style.maskImage = `linear-gradient(to right, ${left ? "transparent" : "black"}, black 18px, black calc(100% - 18px), ${right ? "transparent" : "black"})`;
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    observer?.observe(inner);
    element.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); element.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [children]);
  return <div ref={viewport} role="group" aria-label={label} className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><div ref={content} className="flex w-max min-w-full gap-2 px-1 py-1">{children}</div></div>;
}

/** Starter ideas add explicit generation ingredients without sending a request. */
export function AgentCreationIngredients({ selected, onChange, disabled, mode }: {
  mode: "character" | "appearance";
  selected: AgentCreationTraitId[]; onChange: (ids: AgentCreationTraitId[]) => void; disabled: boolean;
}) {
  const [suggestions, setSuggestions] = useState(INITIAL[mode]);
  const groups = AGENT_CREATION_TRAIT_GROUPS
    .filter(group => (GROUPS[mode] as readonly string[]).includes(group.id))
    .sort((a, b) => (GROUPS[mode] as readonly string[]).indexOf(a.id) - (GROUPS[mode] as readonly string[]).indexOf(b.id))
    .map(group => group.id === "scene" ? {
      ...group,
      traits: AGENT_CREATION_TRAIT_GROUPS.filter(candidate => candidate.id === "scene" || candidate.id === "background").flatMap(candidate => [...candidate.traits]),
    } : group);
  function shuffle() {
    setSuggestions(groups.flatMap(group => {
      const available = group.traits.filter(trait => !selected.includes(trait.id) && !suggestions.includes(trait.id));
      const fallback = group.traits.filter(trait => !selected.includes(trait.id));
      const pool = available.length ? available : fallback;
      return [...pool].sort(() => Math.random() - 0.5).slice(0, 3).map(trait => trait.id);
    }));
  }
  return <div className="space-y-2">
    <div className="flex items-center justify-between"><span className="text-xs text-white/45">{mode === "appearance" ? "Visual ingredients" : "Character ingredients"}</span><button type="button" onClick={shuffle} disabled={disabled} className="min-h-9 px-2 text-xs text-violet-200 disabled:opacity-40">✦ Surprise me</button></div>
    <div aria-label="Character ingredient suggestions" className="space-y-1">
      {groups.map(group => <div key={group.id} className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[10px] text-white/45">{group.id === "scene" ? "Background" : group.id === "strategy" ? "Strategy" : group.id === "gender" ? "Gender" : group.id === "form" ? "Form" : "Style"}</span>
        <PillRow label={`${group.id === "scene" ? "Background" : group.label} suggestions`}>{suggestions.filter(id => group.traits.some(trait => trait.id === id) && !selected.includes(id)).map(id => <button key={id} type="button" disabled={disabled || selected.length >= 12} onClick={() => { onChange([...selected, id]); setSuggestions(current => current.filter(value => value !== id)); }} aria-label={`Add ${ALL_AGENT_CREATION_TRAITS.find(trait => trait.id === id)?.label} ingredient`} className="min-h-9 shrink-0 rounded-full border border-white/15 bg-white/[.035] px-3 text-xs text-white/75 disabled:opacity-40">{ALL_AGENT_CREATION_TRAITS.find(trait => trait.id === id)?.label}</button>)}</PillRow>
      </div>)}
    </div>
    {!!selected.length && <div aria-label="Selected character ingredients" className="flex max-h-24 flex-wrap gap-2 overflow-y-auto">{selected.map(id => {
      const label = ALL_AGENT_CREATION_TRAITS.find(trait => trait.id === id)?.label;
      return <button key={id} type="button" disabled={disabled} onClick={() => onChange(selected.filter(value => value !== id))} aria-label={`Remove ${label} ingredient`} className="min-h-9 rounded-full border border-violet-300/40 bg-violet-400/15 px-3 text-xs text-violet-100 disabled:opacity-40">{label} <span aria-hidden="true">×</span></button>;
    })}</div>}
  </div>;
}
