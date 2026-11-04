"use client";
import { RetryGameButton } from "./retry-game-button";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch, listSeasons, type SeasonIdentity } from "@/lib/api";
import { SEASON_ZERO_CHAMPIONSHIP_POLICIES } from "@influence/engine/championship";
import type { ChampionshipView } from "@/lib/championship";
import { usePermissions } from "@/hooks/use-permissions";
import { useAdminValue } from "./admin-session";
import { ChampionshipResultCorrection } from "./championship-result-correction";

export const controlClass = "mt-1 block w-full rounded-lg border border-white/20 bg-surface-raised px-3 py-2 text-sm";
export const actionClass = "influence-button-secondary rounded-lg px-3 py-2 text-sm disabled:opacity-40";
type ProducerEvent = Omit<ChampionshipView, "matches" | "season"> & { published: boolean; unresolvedPolicies: string[]; season: ChampionshipView["season"] & { status: string };
  resultHistory?: Array<{ ordinal: number; revision: number; gameId: string; entryId: string; outcome: string; points: number; policyVersion: string; canonicalSequence: number | null }>;
  artwork?: Array<{ id: string; agentId: string; rank: number; selected: boolean; status: string; error: string | null; avatarUrl: string | null; bodyUrl: string | null }>;
  audit: Array<{ id: string; action: string; reason: string; createdAt: string }>; matches: Array<ChampionshipView["matches"][number] & { gameStatus?: string | null; gameId?: string | null; resultRevision?: number }> };
type EventSummary = Pick<ProducerEvent, "id" | "name" | "slug" | "status" | "published">;
type Operation = { path: string; method: "POST" | "PUT"; body: unknown; key: string; label: string };
export type RunChampionshipAction = (label: string, path: string, body?: unknown, method?: "POST" | "PUT") => Promise<void>;

export function ChampionshipAdminPanel() {
  const { hasPermission } = usePermissions();
  const [events, setEvents] = useState<EventSummary[]>([]), [seasons, setSeasons] = useState<SeasonIdentity[]>([]);
  const [selected, setSelected] = useAdminValue("ui:championship:selected", ""), [event, setEvent] = useState<ProducerEvent | null>(null);
  const [revision, setRevision] = useState(0), [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useAdminValue<Operation | null>("ui:championship:pending", null), [busy, setBusy] = useAdminValue("ui:championship:busy", false);
  const [name, setName] = useState("Season 0 Championship"), [slug, setSlug] = useState("season-0-championship"), [seasonId, setSeasonId] = useState("");
  const [receipt, setReceipt] = useAdminValue<unknown>("ui:championship:receipt", null);
  const reload = useCallback(async () => {
    const [result, sourceSeasons] = await Promise.all([apiFetch<{ events: EventSummary[] }>("/api/admin/championships"), listSeasons()]);
    setEvents(result.events); setSeasons(sourceSeasons);
  }, []);
  useEffect(() => { let active = true; void reload().catch(cause => { if (active) setError(String(cause)); }); return () => { active = false; }; }, [reload]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Retain the current view while refreshing: unmounting it loses scroll, focus and edits.
    setEvent(current => current?.id === selected ? current : null);
    async function refreshEvent() {
      try {
        const value = await apiFetch<ProducerEvent>(`/api/admin/championships/${selected}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setEvent(value);
        if (value.status === "preparing") timer = setTimeout(() => void refreshEvent(), 5000);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(String(cause));
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) setEvent(null);
        else timer = setTimeout(() => void refreshEvent(), 5000);
      }
    }
    if (selected) void refreshEvent();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [selected, revision]);
  async function submit(operation: Operation) {
    setBusy(true); setError(null); setPending(operation);
    try {
      const result = await apiFetch<{ id?: string }>(operation.path, { method: operation.method, headers: { "Idempotency-Key": operation.key }, body: JSON.stringify(operation.body) });
      setPending(null); setReceipt({ operation: operation.label, result });
      if (operation.path === "/api/admin/championships" && result.id) setSelected(result.id);
      await reload(); setRevision(value => value + 1);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status < 500) setPending(null);
      if (cause instanceof ApiError && [401, 403].includes(cause.status)) { setEvent(null); setEvents([]); setSelected(""); setReceipt(null); }
      setError(cause instanceof Error ? cause.message : "The response was unavailable. Retry the same operation.");
    } finally { setBusy(false); }
  }
  const run: RunChampionshipAction = async (label, path, body = {}, method = "POST") => { if (!pending && !busy) await submit({ label, path, body, method, key: crypto.randomUUID() }); };
  const disabled = busy || pending !== null;
  return <section className="space-y-6" aria-labelledby="championship-operations">
    <header><h2 id="championship-operations" className="text-2xl font-semibold">Championship operations</h2><p className="mt-2 influence-copy">Set up the field and operate the 17-day event. Publication and activation are separate actions.</p></header>
    {error ? <p role="alert" className="rounded-lg border border-red-400/30 p-3 text-red-300">{error}</p> : null}
    {pending && !busy ? <div className="influence-panel rounded-lg p-4"><p>The outcome of “{pending.label}” is not confirmed. Retry uses the same request.</p><button className={actionClass} onClick={() => void submit(pending)}>Retry {pending.label}</button></div> : null}
    <details className="influence-panel rounded-xl p-5"><summary className="cursor-pointer font-semibold">Create an event draft</summary>
      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void run("Create draft", "/api/admin/championships", { name, slug, sourceSeasonId: seasonId }); }}>
        <label>Name<input required className={controlClass} value={name} onChange={e => setName(e.target.value)} disabled={disabled} /></label>
        <label>Public URL name<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" className={controlClass} value={slug} onChange={e => setSlug(e.target.value)} disabled={disabled} /></label>
        <label>Source season<select aria-label="Source season" required className={controlClass} value={seasonId} onChange={e => setSeasonId(e.target.value)} disabled={disabled}><option value="">Choose a season</option>{seasons.map(season => <option key={season.id} value={season.id}>{season.name} · {season.status}</option>)}</select></label>
        <button className={actionClass} disabled={disabled} type="submit">Create draft</button>
      </form>
    </details>
    <label className="block">Event<select aria-label="Event" className={controlClass} value={selected} disabled={disabled} onChange={e => { setSelected(e.target.value); setReceipt(null); setError(null); }}><option value="">Choose an event</option>{events.map(row => <option key={row.id} value={row.id}>{row.name} · {row.status}</option>)}</select></label><p className="text-xs influence-copy-muted">Up to 100 recent events.</p>
    {selected && !event ? <p>Loading event…</p> : null}
    {event?.id === selected ? <>
      <div className="influence-panel space-y-3 rounded-xl p-5"><h3 className="text-xl font-semibold">{event.name}</h3><p>{event.status} · {event.published ? "Published" : "Unpublished"} · {event.season.name} ({event.season.status})</p>
        <p>Eight agents · sixteen daily Werewolf matches · Influence on day 17 · 00:00 UTC</p>
        <div className="flex flex-wrap gap-3"><Link href="/admin/seasons" className="underline">Season operations</Link>{event.published ? <Link className="underline" href={`/events/${event.slug}`}>View public event</Link> : null}<button className={actionClass} disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh event</button></div>
      </div>
      {event.status === "draft" ? <ChampionshipDraftSetup key={event.id} event={event} disabled={disabled} run={run} /> : <p className="influence-copy">{event.status === "preparing" ? "Competition revisions are being prepared. The final field is confirmed after required artwork is ready." : "The field and competition builds are frozen. Live agent edits remain independent."}</p>}
      <div className="flex flex-wrap gap-3">
        {event.status === "draft" ? <button className={actionClass} disabled={disabled || event.season.status !== "final" || event.unresolvedPolicies.length > 0 || !event.startDate} onClick={() => void run("Lock roster", `/api/admin/championships/${event.id}/lock`)}>Lock top-eight roster</button> : null}
        <button className={actionClass} disabled={disabled} onClick={() => void run(event.published ? "Unpublish" : "Publish", `/api/admin/championships/${event.id}/publication`, { published: !event.published })}>{event.published ? "Unpublish event" : "Publish event"}</button>
        {["locked", "paused"].includes(event.status) ? <button className={actionClass} disabled={disabled} onClick={() => void run("Activate schedule", `/api/admin/championships/${event.id}/activate`)}>{event.status === "paused" ? "Resume schedule" : "Activate 17-game schedule"}</button> : null}
        {event.status === "running" ? <button className={actionClass} disabled={disabled} onClick={() => void run("Pause future starts", `/api/admin/championships/${event.id}/pause`)}>Pause future starts</button> : null}
        {["running", "paused", "final"].includes(event.status) ? <button className={actionClass} disabled={disabled} onClick={() => void run("Reconcile event", `/api/admin/championships/${event.id}/reconcile`)}>Reconcile this event</button> : null}
      </div>
      {event.status === "draft" ? <p className="text-sm influence-copy-muted">Save the event setup and finalize the source season before locking the top-eight roster.</p> : null}
      {event.status === "locked" || event.status === "paused" ? <p className="text-sm influence-copy-muted">Activation enables scheduled starts. Overdue matches catch up and may overlap.</p> : null}
      {event.status === "preparing" ? <p role="status">Preparing required headshot and full-body artwork automatically. The roster locks when all eight are ready; owners do not need to take any action.</p> : null}
      {event.artwork?.length ? <section><h3 className="text-lg font-semibold">Championship artwork</h3><ul className="mt-3 space-y-2">{event.artwork.map(row => <li key={row.id} className="influence-panel rounded-lg p-3"><Link className="underline" href={`/agents/${row.agentId}`}>Season rank {row.rank}</Link> · {row.selected ? row.status : "Not selected"}{row.avatarUrl ? <a className="ml-3 underline" href={row.avatarUrl} target="_blank" rel="noreferrer">View headshot</a> : null}{row.bodyUrl ? <a className="ml-3 underline" href={row.bodyUrl} target="_blank" rel="noreferrer">View full body</a> : null}{row.error && row.selected ? <p className="mt-1 break-words text-sm">{row.error} · Preparation will retry. Existing evidence is retained.</p> : null}</li>)}</ul></section> : null}
      <section><h3 className="text-lg font-semibold">Match schedule</h3><ol className="mt-3 space-y-2">{event.matches.map(match => <li key={match.ordinal} className="influence-panel flex flex-wrap items-center justify-between gap-3 rounded-lg p-3"><span>Day {match.ordinal} · {match.gameKind} · {match.scheduledAt.slice(0, 10)} 00:00 UTC · {match.status}{match.gameStatus && match.gameStatus !== match.status ? ` (${match.gameStatus})` : ""}</span><div className="flex gap-3">{match.gameSlug ? <Link className="underline" href={`/games/${match.gameSlug}`}>Open game</Link> : null}{event.status === "running" && match.status === "scheduled" ? <button className={actionClass} disabled={disabled || Date.parse(match.scheduledAt) > Date.now()} onClick={() => void run(`Retry day ${match.ordinal}`, `/api/admin/championships/${event.id}/matches/${match.ordinal}/dispatch`)}>Dispatch / retry exact match</button> : null}{event.status === "running" && match.gameId && ["suspended", "cancelled"].includes(match.gameStatus ?? "") && hasPermission("start_game") && hasPermission("stop_game") && hasPermission("hide_game") ? <RetryGameButton gameId={match.gameId} disabled={disabled} onRetried={() => setRevision(value => value + 1)} /> : null}</div>{match.gameStatus === "completed" && match.gameId && hasPermission("manage_awards") ? <ChampionshipResultCorrection key={`${match.gameId}:${match.resultRevision}`} eventId={event.id} ordinal={match.ordinal} gameId={match.gameId} revision={match.resultRevision ?? 0} disabled={disabled} run={run} /> : null}</li>)}</ol></section>
      {event.resultHistory?.length ? <details className="influence-panel rounded-lg p-4"><summary>Scoring revision history</summary><ul className="mt-3 space-y-2 text-sm">{event.resultHistory.map(row => <li key={`${row.ordinal}:${row.revision}:${row.entryId}`}>Day {row.ordinal} · revision {row.revision} · {row.outcome} · {row.points} points · <Link className="underline" href={`/games/${row.gameId}`}>Original game</Link> · entry {row.entryId}</li>)}</ul></details> : null}
      <p className="text-sm influence-copy-muted">Badges are awarded automatically: season crowns and participation at season finalization, Top 8 when the championship activates, and champion badges when results settle.</p>
      <details className="influence-panel rounded-xl p-4"><summary>Event audit history</summary><ol className="mt-3 space-y-2">{event.audit.map(row => <li key={row.id} className="break-words text-sm">{row.createdAt} · {row.action} · {row.reason}</li>)}</ol></details>
    </> : null}
    {receipt ? <details className="influence-panel rounded-lg p-4"><summary>Last operation receipt</summary><pre className="mt-3 whitespace-pre-wrap break-all text-xs">{JSON.stringify(receipt, null, 2)}</pre></details> : null}
  </section>;
}
/** Agreed Season 0 rules are fixed here; only the calendar date needs setup. */
export function championshipDraftSetup(startDate: string) {
  return { policies: structuredClone(SEASON_ZERO_CHAMPIONSHIP_POLICIES), startDate: startDate || null };
}

export function ChampionshipDraftSetup({ event, disabled, run }: {
  event: Pick<ProducerEvent, "id" | "startDate">; disabled: boolean; run: RunChampionshipAction;
}) {
  const [date, setDate] = useState(event.startDate ?? "");
  return <form className="influence-panel space-y-4 rounded-xl p-5" onSubmit={e => {
    e.preventDefault();
    void run("Save event setup", `/api/admin/championships/${event.id}`, championshipDraftSetup(date), "PUT");
  }}>
    <h3 className="text-lg font-semibold">Event setup</h3>
    <label className="block">First Werewolf day (UTC)<input type="date" className={controlClass} disabled={disabled} value={date} onChange={e => setDate(e.target.value)} /></label>
    <section aria-label="Season 0 championship rules" className="space-y-2 text-sm influence-copy">
      <h4 className="font-semibold text-text-primary">Season 0 championship rules</h4>
      <p>The same top eight agents play 16 daily Werewolf matches, then the Influence finale on day 17. Every match starts at midnight UTC.</p>
      <p>Each Werewolf match has 2 wolves, 1 seer, 1 doctor and 4 villagers. Balanced role selection gives each agent 4 wolf, 2 seer, 2 doctor and 8 villager assignments across the series.</p>
      <p>A faction win earns 1 point, a loss 0 and a true draw ½, regardless of survival. Crashed or aborted matches are recovered or replayed.</p>
      <p>Series ties go to the higher frozen Season 0 agent score. Equal Season 0 scores share the championship. The Influence finale uses the game’s normal tie handling.</p>
      <p>Participation badges go to each player and agent that completed at least one Season 0 game. Season winners are recorded at season close; championship winners and their architects are recorded when the championship ledger locks.</p>
    </section>
    <button type="submit" disabled={disabled} className={actionClass}>Save event setup</button>
  </form>;
}
