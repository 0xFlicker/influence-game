import type { PublicAward } from "@/lib/championship";

/** Shared account/agent award presentation; source-specific names preserve achievement context. */
export function AwardShelf({ awards, title = "Season 0 honors" }: { awards: PublicAward[]; title?: string }) {
  if (!awards.length) return null;
  return <section className="influence-panel rounded-xl p-5" aria-label={title}>
    <h2 className="influence-section-title">{title}</h2>
    <ul className="mt-4 flex flex-wrap gap-4">
      {awards.map(award => <li key={award.id} className="flex max-w-64 items-center gap-3 rounded-lg border border-amber-300/25 bg-amber-300/5 p-3">
        <SeasonZeroMark code={award.code} />
        <div><p className="text-sm font-semibold text-text-primary">{award.title}</p>
          <time dateTime={award.awardedAt} className="text-xs influence-copy-muted">{new Date(award.awardedAt).toISOString().slice(0, 10)}</time>
        </div>
      </li>)}
    </ul>
  </section>;
}
export function SeasonZeroMark({ code }: { code: string }) {
  const participant = code.includes("participant");
  const finalist = code.includes("top-eight");
  return <svg aria-hidden="true" viewBox="0 0 64 72" className="h-16 w-14 shrink-0 text-amber-200" fill="none">
    <path d="M32 3 58 16v29L32 68 6 45V16Z" stroke="currentColor" strokeWidth="2" />
    <path d="M32 8 53 19v24L32 62 11 43V19Z" stroke="currentColor" opacity=".3" />
    {participant ? <circle cx="32" cy="27" r="9" stroke="currentColor" strokeWidth="2" />
      : finalist ? <text x="32" y="35" textAnchor="middle" fill="currentColor" fontSize="24" fontFamily="serif">8</text>
      : code.includes("werewolf") ? <path d="m19 15 5 8 8-5 8 5 5-8-2 22-11 7-11-7Z" stroke="currentColor" strokeWidth="2" />
      : <path d="m18 23 7 6 7-12 7 12 7-6-3 17H21Z" stroke="currentColor" strokeWidth="2" />}
    <text x="32" y="54" textAnchor="middle" fill="currentColor" fontSize="10" fontFamily="sans-serif" letterSpacing="2">S0</text>
  </svg>;
}
