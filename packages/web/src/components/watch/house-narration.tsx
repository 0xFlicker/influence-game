export type NarrationWindow = {elapsedMs: number; durationMs: number};

/** Derived entirely from the recording clock: seeking and pausing have no timers to reset. */
export function narrationWindow(elapsedMs: number, durationMs: number): NarrationWindow | null {
  return Number.isFinite(elapsedMs) && Number.isFinite(durationMs) && durationMs > 0 && elapsedMs >= 0 && elapsedMs < durationMs
    ? {elapsedMs, durationMs} : null;
}

export function narrationPages(text: string): string[] {
  const words = text.trim().split(/\s+/), pages: string[] = [];
  let page = "";
  for (const word of words) {
    if (page && page.length + word.length + 1 > 190) {pages.push(page); page = "";}
    page += `${page ? " " : ""}${word}`;
  }
  if (page) pages.push(page);
  return pages;
}

/** Shared by the live player and Remotion; summary is the accepted spoken text. */
export function HouseNarration({text, window, logoUrl = "/logo.png", bottom = 16}: {
  text: string; window: NarrationWindow | null; logoUrl?: string; bottom?: number;
}) {
  if (!window || !text.trim()) return null;
  const pages = narrationPages(text);
  const page = Math.min(pages.length - 1, Math.floor(window.elapsedMs / window.durationMs * pages.length));
  return <div data-house-narration className="pointer-events-none absolute inset-0 z-40" style={{background:"linear-gradient(transparent 45%,rgba(0,0,0,.22))"}}>
    <section aria-label="The House narration" className="absolute inset-x-3 mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-white/25 bg-black/90 px-4 py-3 text-white shadow-2xl sm:inset-x-6" style={{bottom}}>
      {/* eslint-disable-next-line @next/next/no-img-element -- existing bundled House logo, shared with exports */}
      <img src={logoUrl} alt="The House" className="h-12 w-12 shrink-0 object-contain" />
      <div className="min-w-0 flex-1"><p className="mb-1 text-[10px] uppercase tracking-[.2em] text-amber-100">The House</p>
        <p className="text-sm leading-snug sm:text-lg" data-house-narration-text>{pages[page]}</p>
        {pages.length > 1 && <p className="mt-1 text-right text-[10px] text-white/60">{page + 1} / {pages.length}</p>}
      </div>
    </section>
  </div>;
}
