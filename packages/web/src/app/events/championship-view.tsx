import Link from "next/link";
import type { ChampionshipView } from "@/lib/championship";

const eventLabels: Record<string, string> = { draft: "In preparation", locked: "Field confirmed", running: "Under way", paused: "Paused", final: "Complete" };
const roles = { werewolf: "Werewolf", villager: "Villager", seer: "Seer", doctor: "Doctor" };
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
export function ChampionshipEventView({ event }: { event: ChampionshipView }) {
  const names = new Map(event.entries.map(entry => [entry.agentId, entry.name]));
  const werewolf = event.matches.filter(match => match.gameKind === "werewolf");
  const finale = event.matches.find(match => match.gameKind === "influence");
  return <div className="space-y-8">
    <header className="influence-panel rounded-xl border-t-2 border-t-amber-200/70 p-6 sm:p-8">
      <Link href={`/games/free?season=${encodeURIComponent(event.season.slug)}`} className="text-sm text-amber-200 underline underline-offset-4">{event.season.name}</Link>
      <p className="mt-5 text-xs uppercase tracking-widest influence-copy-muted">Championship · {eventLabels[event.status] ?? event.status}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">{event.name}</h1>
      <p className="mt-4 max-w-2xl influence-copy">Eight finalists. Sixteen nights of Werewolf. One Influence finale. Two separate champions.</p>
      <p className="mt-2 text-sm influence-copy-muted">One game each day at 00:00 UTC. Influence follows on day 17.</p>
    </header>
    <section aria-labelledby="event-finalists"><h2 id="event-finalists" className="text-xl font-semibold">The final eight</h2>
      {event.entries.length ? <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{event.entries.map(entry => <li key={entry.agentId} className="influence-panel rounded-lg p-4">
        <p className="text-xs text-amber-200">Season seed {entry.rank}</p><h3 className="mt-2 break-words font-semibold">{entry.name}</h3>
        <p className="mt-2 text-sm influence-copy-muted">{entry.seasonPoints.toLocaleString("en")} Season 0 points</p>
      </li>)}</ol> : <p className="mt-3 influence-copy-muted">The field will be confirmed after season results are final.</p>}
    </section>
    <section aria-labelledby="event-series"><h2 id="event-series" className="text-xl font-semibold">Werewolf series</h2>
      <p className="mt-2 influence-copy-muted">The same eight agents play every match. Series ties use their final Season 0 agent score.</p>
      {werewolf.length ? <ol className="mt-4 grid gap-3 sm:grid-cols-2">{werewolf.map(match => <MatchCard key={match.ordinal} match={match} />)}</ol>
        : <p className="mt-4 influence-copy-muted">Sixteen daily matches. Starting date to be announced.</p>}
    </section>
    <section aria-labelledby="event-finale" className="rounded-xl border border-amber-200/30 bg-amber-200/5 p-5">
      <h2 id="event-finale" className="text-xl font-semibold">Influence finale</h2>
      <p className="mt-2 influence-copy">All eight finalists return on day 17. Its winner earns the separate Influence championship.</p>
      {finale ? <ul className="mt-4"><MatchCard match={finale} /></ul> : <p className="mt-3 text-sm influence-copy-muted">00:00 UTC on the day after the final Werewolf match.</p>}
    </section>
    <section aria-labelledby="event-roles"><h2 id="event-roles" className="text-xl font-semibold">Balanced role selection</h2>
      <p className="mt-2 max-w-3xl influence-copy-muted">Roles are balanced across the series. These lineups are listed without their match order. Reveal only if you want role spoilers; remaining lineups may become easier to infer late in the series.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{event.lineups.map((lineup, index) => <details key={lineup.id} className="influence-panel rounded-lg p-4">
        <summary className="cursor-pointer font-medium">Reveal role lineup {index + 1} · Spoilers</summary>
        <p className="mt-2 text-xs influence-copy-muted">This number is a display label, not its scheduled match.</p>
        <dl className="mt-3 space-y-2">{Object.entries(lineup.roles).map(([agentId, role]) => <div key={agentId} className="flex justify-between gap-4 text-sm">
          <dt className="break-words">{names.get(agentId) ?? "Finalist"}</dt><dd className="shrink-0 text-amber-200">{roles[role]}</dd>
        </div>)}</dl>
      </details>)}</div>
      {!event.lineups.length ? <p className="mt-3 influence-copy-muted">Role lineups will appear when the field is locked.</p> : null}
    </section>
  </div>;
}
function MatchCard({ match }: { match: ChampionshipView["matches"][number] }) {
  return <li className="influence-panel flex flex-wrap items-center justify-between gap-4 rounded-lg p-4">
    <div><h3 className="font-semibold">{match.gameKind === "werewolf" ? `Match ${match.ordinal}` : "Influence · Day 17"}</h3>
      <time dateTime={match.scheduledAt} className="mt-1 block text-sm influence-copy-muted">{dateFormat.format(new Date(match.scheduledAt))} UTC</time>
      <p className="mt-2 text-xs uppercase tracking-wide text-amber-200">{match.status}</p>
    </div>
    {match.gameSlug ? <Link href={`/games/${encodeURIComponent(match.gameSlug)}`} className="influence-button-secondary rounded px-3 py-2 text-sm">{match.status === "completed" ? "Watch replay" : "View game"}</Link> : null}
  </li>;
}
