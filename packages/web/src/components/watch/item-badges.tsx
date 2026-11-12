/** Held-item badges for player chrome. Callers supply items only when the audience may see them. */
export function ItemBadges({ items, compact = false }: { items?: readonly string[] | null; compact?: boolean }) {
  if (!items?.length) return null;
  return <span className="inline-flex shrink-0 items-center gap-1 align-middle">
    {items.map((item) => <span key={item} data-item-badge={item} title={`Holds ${item}`} className="inline-flex items-center gap-1 rounded-full border border-amber-200/40 bg-amber-950/60 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-100">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3">
        <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </svg>
      {!compact && item}
    </span>)}
  </span>;
}
