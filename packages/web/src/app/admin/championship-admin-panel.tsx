"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch, listSeasons, type SeasonIdentity } from "@/lib/api";
import type { ChampionshipPolicies } from "@influence/engine/championship";
import type { ChampionshipView } from "@/lib/championship";
import { usePermissions } from "@/hooks/use-permissions";
import { useAdminValue } from "./admin-session";
import { ChampionshipAwardControls } from "./championship-award-controls";

export const controlClass = "mt-1 block w-full rounded-lg border border-white/20 bg-surface-raised px-3 py-2 text-sm";
export const actionClass = "influence-button-secondary rounded-lg px-3 py-2 text-sm disabled:opacity-40";
type ProducerEvent = Omit<ChampionshipView, "matches" | "season"> & { published: boolean; unresolvedPolicies: string[]; season: ChampionshipView["season"] & { status: string };
  audit: Array<{ id: string; action: string; reason: string; createdAt: string }>; matches: Array<ChampionshipView["matches"][number] & { gameStatus?: string | null }> };
const policyLabels: Record<string, string> = { roleComposition: "role composition", points: "Werewolf points", equalScoreFallback: "equal-score fallback", participationMinimumCompletedGames: "participation threshold", ownerAttribution: "architect attribution" };
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
    const controller = new AbortController(); setEvent(null);
    if (selected) void apiFetch<ProducerEvent>(`/api/admin/championships/${selected}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setEvent(value); }).catch(cause => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
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
    <header><h2 id="championship-operations" className="text-2xl font-semibold">Championship operations</h2><p className="mt-2 influence-copy">Set up the field, review awards, and operate the 17-day event. Publication and activation are separate actions.</p></header>
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
      {event.status === "draft" ? <DraftPolicies key={`${event.id}:${JSON.stringify(event.policies)}:${event.startDate}`} event={event} disabled={disabled} run={run} onError={setError} /> : <p className="influence-copy">The field and competition builds are frozen. Live agent edits remain independent.</p>}
      <div className="flex flex-wrap gap-3">
        {event.status === "draft" ? <button className={actionClass} disabled={disabled || event.season.status !== "final" || event.unresolvedPolicies.length > 0 || !event.startDate} onClick={() => void run("Lock roster", `/api/admin/championships/${event.id}/lock`)}>Lock top-eight roster</button> : null}
        <button className={actionClass} disabled={disabled} onClick={() => void run(event.published ? "Unpublish" : "Publish", `/api/admin/championships/${event.id}/publication`, { published: !event.published })}>{event.published ? "Unpublish event" : "Publish event"}</button>
        {["locked", "paused"].includes(event.status) ? <button className={actionClass} disabled={disabled} onClick={() => void run("Activate schedule", `/api/admin/championships/${event.id}/activate`)}>{event.status === "paused" ? "Resume schedule" : "Activate 17-game schedule"}</button> : null}
        {event.status === "running" ? <button className={actionClass} disabled={disabled} onClick={() => void run("Pause future starts", `/api/admin/championships/${event.id}/pause`)}>Pause future starts</button> : null}
        {["running", "paused", "final"].includes(event.status) ? <button className={actionClass} disabled={disabled} onClick={() => void run("Reconcile event", `/api/admin/championships/${event.id}/reconcile`)}>Reconcile this event</button> : null}
      </div>
      {event.status === "draft" ? <p className="text-sm influence-copy-muted">Roster lock needs a finalized source season, a start date, and all policy choices. Open choices: {event.unresolvedPolicies.map(key => policyLabels[key] ?? key).join(", ") || "none"}.</p> : null}
      {event.status === "locked" || event.status === "paused" ? <p className="text-sm influence-copy-muted">Activation enables scheduled starts. Overdue matches catch up and may overlap.</p> : null}
      <section><h3 className="text-lg font-semibold">Match schedule</h3><ol className="mt-3 space-y-2">{event.matches.map(match => <li key={match.ordinal} className="influence-panel flex flex-wrap items-center justify-between gap-3 rounded-lg p-3"><span>Day {match.ordinal} · {match.gameKind} · {match.scheduledAt.slice(0, 10)} 00:00 UTC · {match.status}{match.gameStatus && match.gameStatus !== match.status ? ` (${match.gameStatus})` : ""}</span><div className="flex gap-3">{match.gameSlug ? <Link className="underline" href={`/games/${match.gameSlug}`}>Open game</Link> : null}{event.status === "running" && match.status === "scheduled" ? <button className={actionClass} disabled={disabled || Date.parse(match.scheduledAt) > Date.now()} onClick={() => void run(`Retry day ${match.ordinal}`, `/api/admin/championships/${event.id}/matches/${match.ordinal}/dispatch`)}>Dispatch / retry exact match</button> : null}</div></li>)}</ol></section>
      {hasPermission("manage_awards") ? <ChampionshipAwardControls key={`${event.id}:${revision}`} eventId={event.id} disabled={disabled} run={run} /> : null}
      <details className="influence-panel rounded-xl p-4"><summary>Event audit history</summary><ol className="mt-3 space-y-2">{event.audit.map(row => <li key={row.id} className="text-sm">{row.createdAt} · {row.action} · {row.reason}</li>)}</ol></details>
    </> : null}
    {receipt ? <details className="influence-panel rounded-lg p-4"><summary>Last operation receipt</summary><pre className="mt-3 whitespace-pre-wrap break-all text-xs">{JSON.stringify(receipt, null, 2)}</pre></details> : null}
  </section>;
}
function DraftPolicies({ event, disabled, run, onError }: { event: ProducerEvent; disabled: boolean; run: RunChampionshipAction; onError: (message: string) => void }) {
  const [date, setDate] = useState(event.startDate ?? "");
  const [roles, setRoles] = useState(Object.fromEntries(["werewolf", "seer", "doctor", "villager"].map(key => [key, String(event.policies.roleComposition?.[key as keyof NonNullable<ChampionshipPolicies["roleComposition"]>] ?? "")])));
  const [points, setPoints] = useState(Object.fromEntries(["win", "loss", "draw"].map(key => [key, String(event.policies.points?.[key as "win" | "loss" | "draw"] ?? "")])));
  const [tie, setTie] = useState(event.policies.equalScoreFallback ?? ""), [owner, setOwner] = useState(event.policies.ownerAttribution ?? ""), [participation, setParticipation] = useState(String(event.policies.participationMinimumCompletedGames ?? ""));
  function numbers(values: Record<string, string>) { if (Object.values(values).every(value => value === "")) return null; if (Object.values(values).some(value => value === "")) throw new Error("Complete every value in a role or points group, or leave the whole group undecided."); return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)])); }
  return <form className="influence-panel space-y-4 rounded-xl p-5" onSubmit={e => { e.preventDefault(); try {
    const policies = { roleComposition: numbers(roles), points: numbers(points), equalScoreFallback: tie || null, ownerAttribution: owner || null, participationMinimumCompletedGames: participation === "" ? null : Number(participation) };
    void run("Save draft policies", `/api/admin/championships/${event.id}`, { policies, startDate: date || null }, "PUT");
  } catch (cause) { onError(String(cause)); } }}>
    <h3 className="text-lg font-semibold">Draft policies</h3><p className="text-sm influence-copy-muted">Blank choices stay undecided. Season 0 score is the first series tie-break.</p>
    <label className="block">First Werewolf day (UTC)<input type="date" className={controlClass} disabled={disabled} value={date} onChange={e => setDate(e.target.value)} /></label>
    <fieldset disabled={disabled}><legend>Competitive roles in each eight-agent match</legend><div className="grid gap-3 sm:grid-cols-4">{Object.entries(roles).map(([key, value]) => <label key={key} className="capitalize">{key}<input type="number" min={0} step={1} className={controlClass} value={value} onChange={e => setRoles(old => ({ ...old, [key]: e.target.value }))} /></label>)}</div></fieldset>
    <fieldset disabled={disabled}><legend>Werewolf points per match</legend><div className="grid gap-3 sm:grid-cols-3">{Object.entries(points).map(([key, value]) => <label key={key} className="capitalize">{key}<input type="number" min={0} step={1} className={controlClass} value={value} onChange={e => setPoints(old => ({ ...old, [key]: e.target.value }))} /></label>)}</div></fieldset>
    <div className="grid gap-4 sm:grid-cols-2"><label>When both series and Season 0 scores tie<select aria-label="When both series and Season 0 scores tie" disabled={disabled} className={controlClass} value={tie} onChange={e => setTie(e.target.value as typeof tie)}><option value="">Undecided</option><option value="season_rank">Final season rank</option><option value="shared_place">Shared place</option></select></label>
    <label>Minimum completed games for participation<input disabled={disabled} type="number" min={1} step={1} className={controlClass} value={participation} onChange={e => setParticipation(e.target.value)} /></label>
    <label>Architect attribution<select aria-label="Architect attribution" disabled={disabled} className={controlClass} value={owner} onChange={e => setOwner(e.target.value as typeof owner)}><option value="">Undecided</option><option value="qualification">Recorded qualification / season evidence</option><option value="award">Owner when allocation is prepared</option></select></label></div>
    <p className="text-sm influence-copy-muted">An Influence draw still needs an explicit product decision; no automatic rerun is selected here.</p>
    <button type="submit" disabled={disabled} className={actionClass}>Save draft policies</button>
  </form>;
}
