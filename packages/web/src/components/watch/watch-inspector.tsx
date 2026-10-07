"use client";
import {useState} from "react";
const COMPACT_THINKING_TEXT_LIMIT = 260;
export interface WatchInspectorSection { reason?: string | null; cards: Array<{id: string; title: string; meta: string; body: string}> }
export function InspectorLabel({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active ? "true" : "false"}
      onClick={onClick}
      className={`grid place-items-center rounded-md text-[8px] uppercase tracking-[0.12em] ${
        active
          ? "border border-phase/20 bg-phase/[0.12] text-white/75"
          : "text-white/30 hover:bg-white/[0.03] hover:text-white/55"
      }`}
    >
      {children}
    </button>
  );
}

export function InspectorSection({
  title,
  meta,
  section,
  expandableCards = false,
}: {
  title: string;
  meta?: string;
  section: WatchInspectorSection;
  expandableCards?: boolean;
}) {
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/55">
          {title}
        </h3>
        {meta ? (
          <span className="truncate text-[7px] uppercase tracking-[0.12em] text-white/25">
            {meta}
          </span>
        ) : null}
      </div>
      {section.cards.length > 0 ? (
        <div className="space-y-3">
          {section.cards.map((card) => (
            <IntelligenceCard
              key={card.id}
              card={card}
              expandable={expandableCards}
            />
          ))}
        </div>
      ) : (
        <EmptyInspectorState reason={section.reason ?? "No intelligence available."} />
      )}
    </section>
  );
}

function IntelligenceCard({
  card,
  expandable,
}: {
  card: WatchInspectorSection["cards"][number];
  expandable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = expandable && card.body.length > COMPACT_THINKING_TEXT_LIMIT;
  const shouldClamp = expandable ? canExpand && !expanded : true;
  const bodyClassName = shouldClamp ? "line-clamp-5" : "";

  return (
    <div className="border-t border-white/5 pt-3 first:border-t-0 first:pt-0">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h4 className="truncate text-[10px] font-semibold text-white/80">{card.title}</h4>
        <span className="shrink-0 text-[7px] uppercase tracking-[0.12em] text-white/30">
          {card.meta}
        </span>
      </div>
      <p className={`${bodyClassName} whitespace-pre-wrap text-[10px] leading-5 text-white/65`}>
        {card.body}
      </p>
      {canExpand ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-white/45 transition-colors hover:border-white/20 hover:text-white/70"
          title={expanded ? "Collapse thinking" : "Expand thinking"}
        >
          {expanded ? "Show less" : "Show full"}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyInspectorState({ reason }: { reason: string }) {
  return (
    <p className="rounded-md border border-dashed border-white/10 px-3 py-4 text-[10px] leading-5 text-white/38">
      {reason}
    </p>
  );
}


export function WatchInspector({hero, sections}: {hero: import("react").ReactNode; sections: Array<{id: string; label: string; content: import("react").ReactNode}>}) {
  const [selected, setSelected] = useState("overview");
  const current = sections.find(section => section.id === selected) ?? sections[0];
  return <aside className="flex min-h-0 h-full flex-col overflow-hidden rounded-lg border border-white/10 bg-black/45 shadow-panel backdrop-blur-glass">
    {hero}
    <div className="grid h-11 shrink-0 gap-1 border-b border-white/10 px-2 py-1.5" style={{gridTemplateColumns: `repeat(${sections.length},minmax(0,1fr))`}} role="tablist" aria-label="Inspector sections">
      {sections.map(section => <InspectorLabel key={section.id} active={current?.id === section.id} onClick={() => setSelected(section.id)}>{section.label}</InspectorLabel>)}
    </div><div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">{current?.content}</div>
  </aside>;
}
