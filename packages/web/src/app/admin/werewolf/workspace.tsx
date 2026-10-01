"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { WerewolfView } from "@influence/engine/werewolf/observation";
import { werewolfReportEntry } from "@influence/engine/werewolf/report";
import { apiFetch, type AdminGameCostSummary, type AdminGameCostDetail } from "@/lib/api";
import { ReplayVisualProductionPanel, type Inventory } from "../replay-visual-production-panel";
import { adminReadOptions, useAdminRead, useAdminSession, accessDenied } from "../admin-session";
import { CostEvidence } from "../cost-evidence";
import styles from "./workspace.module.css";

type Section = "overview" | "production" | "costs" | "activity";
const sections: Section[] = ["overview", "production", "costs", "activity"];
const root = "/api/admin/werewolf";
type Row = { id: string; slug: string; status: string; createdAt: string; playerCount: number; hidden: boolean; progress: { day: number; phase: string } | null; error: string | null; cost: AdminGameCostSummary | null; production: { active: number; failed: number } };
export type Detail = { id: string; slug: string; status: string; hidden: boolean; createdAt: string; endedAt: string | null; snapshot: Pick<WerewolfView, "rulesVersion" | "day" | "phase" | "cursor" | "players" | "outcome">; capabilities: { stop: boolean; visibility: boolean; production: boolean } };
type Costs = { gameplay: AdminGameCostDetail; production: { knownCostMicrousd: number; unpricedAttempts: number; uncertainAttempts: number; attempts: Array<{ id: string; provider: string; model: string; status: string; costMicrousd: number | null }> } };
const money = (value: number) => `$${(value / 1_000_000).toFixed(4)}`;
const title = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
const href = (id: string, section: Section) => `/admin/werewolf/${id}${section === "overview" ? "" : `/${section}`}`;
function Notice({ children }: { children: React.ReactNode }) { return <div role="alert" className={styles.notice}>{children}</div>; }
export function GameList() {
  const { data, error, refresh } = useAdminRead<Row[]>(root, 10_000);
  const router = useRouter(), params = useSearchParams();
  const query = params.get("q") ?? "", filter = params.get("status") ?? "all", visibility = params.get("visibility") ?? "visible";
  function change(key: string, value: string) { const next = new URLSearchParams(params); next.set(key, value); router.replace(`/admin/werewolf?${next}`, { scroll: false }); }
  const rows = data?.filter(g => g.slug.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || g.status === filter) && (visibility === "all" || (visibility === "hidden") === g.hidden));
  return <div className={styles.main}>
    <Link href="/admin/games" className={styles.back}>← Administration</Link>
    <header className={styles.heading}><div><p className={styles.eyebrow}>Game operations & production</p><h1>Werewolf</h1><p>Follow the game. Inspect the spend. Prepare the scene.</p></div><button onClick={() => void refresh()}>Refresh</button></header>
    <div className={styles.filters}><label>Find a game<input value={query} onChange={e => change("q", e.target.value)} placeholder="Search by game name" /></label>
      <label>Status<select value={filter} onChange={e => change("status", e.target.value)}>{["all", "in_progress", "completed", "suspended", "cancelled"].map(v => <option key={v} value={v}>{title(v)}</option>)}</select></label>
      <label>Visibility<select value={visibility} onChange={e => change("visibility", e.target.value)}>{["visible", "hidden", "all"].map(v => <option key={v} value={v}>{title(v)}</option>)}</select></label></div>
    {error && <Notice>{error}</Notice>}
    {!data && !error && <p role="status" className={styles.empty}>Loading Werewolf games…</p>}
    {rows?.length === 0 && <p className={styles.empty}>No games match these filters. <Link href="/werewolf">Open the Werewolf lobby</Link></p>}
    <div className={styles.list}>{rows?.map(game => <article key={game.id} className={styles.row}>
      <div><p className={styles.eyebrow}>{title(game.status)}{game.hidden ? " · Hidden" : ""}</p><h2>{game.slug}</h2><p>{game.playerCount} players · {game.progress ? `Day ${game.progress.day} · ${title(game.progress.phase)}` : "State unavailable"}</p>{game.error && <p className={styles.warning}>{game.error}</p>}</div>
      <div><span className={styles.small}>Gameplay cost</span><strong className={styles.number}>{game.cost?.state === "actual" ? money(game.cost.actualCostMicrousd) : game.cost?.state === "estimated" ? `~${money(game.cost.estimatedCostMicrousd)}` : "N/C"}</strong><span className={styles.small}>{game.cost?.callCount ?? 0} recorded calls</span></div>
      <div><span className={styles.small}>Production</span><span>{game.production.active ? `${game.production.active} active jobs` : game.production.failed ? `${game.production.failed} jobs need attention` : "Ready to inspect"}</span></div>
      <Link className={styles.open} href={`${href(game.id, "overview")}?${params}`}>Open <span aria-hidden>↗</span></Link>
    </article>)}</div>
    <p className={styles.footnote}>Latest 100 games · N/C means no collected price, not zero spend.</p>
  </div>;
}

export function GameWorkspace({ gameId, children }: { gameId: string; children: React.ReactNode }) {
  const path = usePathname(), params = useSearchParams();
  const suffix = path.slice(`/admin/werewolf/${gameId}`.length).replace(/^\//, "");
  const valid = suffix === "" || sections.includes(suffix as Section);
  const route = (suffix || "overview") as Section;
  const session = useAdminSession(), client = useQueryClient();
  const { data, error, denied, refresh } = useAdminRead<Detail>(`${root}/${gameId}`, 10_000);
  const [displayed, setDisplayed] = useState<Section>(route);
  const [pending, setPending] = useState<Section | null>(null), [navigationError, setNavigationError] = useState<string | null>(null);
  const [failedTarget, setFailedTarget] = useState<Section | null>(null);
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false), [actionError, setActionError] = useState<string | null>(null);
  const intent = useRef(0), pane = useRef<HTMLDivElement>(null);
  const previous = useRef<Section>(route), committedClick = useRef<Section | null>(null);
  const canonicalId = useRef(gameId);
  if (data) canonicalId.current = data.id;
  useEffect(() => {
    if (!denied && data?.capabilities.production !== false) return;
    const family = `/api/admin/production/games/${canonicalId.current}`;
    session.set(`access-version:${family}`, (session.get<number>(`access-version:${family}`) ?? 0) + 1);
    session.set(`access-denied:${family}`, true);
    session.clearMatching(key => (key.startsWith("operation:") || key.startsWith("draft:") || key.startsWith("ui:")) && key.includes(family));
    const filter = { predicate: (query: {queryKey: readonly unknown[]}) => query.queryKey[0] === "admin" && query.queryKey[1] === session.scope && String(query.queryKey[2]).startsWith(`${family}/`) };
    void client.cancelQueries(filter); client.removeQueries(filter);
  }, [denied, data?.capabilities.production, session, client]);
  async function prepare(next: Section) {
    // UUID routes can load costs/activity alongside summary; a slug must resolve first.
    const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(gameId);
    const summary = data ?? (next === "production" || !uuid ? await client.fetchQuery(adminReadOptions<Detail>(session, `${root}/${gameId}`)) : undefined);
    const id = summary?.id ?? gameId;
    if (next === "costs") await client.fetchQuery(adminReadOptions<Costs>(session, `${root}/${id}/costs`));
    if (next === "activity") await client.fetchQuery(adminReadOptions<WerewolfView>(session, `${root}/${id}/activity`));
    if (next === "production" && summary?.capabilities.production && summary.status === "completed") {
      try { await client.fetchQuery(adminReadOptions<Inventory>(session, `/api/admin/production/games/${id}/visual`)); }
      catch (cause) { if (!accessDenied(cause)) throw cause; void refresh(); }
    }
  }
  useEffect(() => {
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(gameId) && (route === "costs" || route === "activity")) {
      void client.prefetchQuery(adminReadOptions(session, `${root}/${gameId}/${route}`));
    }
  }, [gameId, route, client, session]);
  function prefetch(next: Section) {
    if (!data) return;
    if (next === "costs") void client.prefetchQuery(adminReadOptions(session, `${root}/${data.id}/${next}`));
  }
  async function navigate(next: Section, push = true) {
    const ticket = ++intent.current;
    setPending(next); setNavigationError(null); setFailedTarget(null);
    try {
      await prepare(next);
      if (ticket !== intent.current || !session.active) return;
      setDisplayed(next); setPending(null);
      // These leaf pages have no server data. Next integrates native history with
      // usePathname; avoid an unnecessary RSC navigation racing the prepared pane.
      if (push) { committedClick.current = next; window.history.pushState(null, "", `${href(gameId, next)}?${params}`); }
    } catch (cause) {
      if (ticket !== intent.current || !session.active) return;
      setPending(null); setFailedTarget(next); setNavigationError(cause instanceof Error ? cause.message : "Section unavailable");
      // A history navigation already changed URL: show that destination's local error.
      if (!push) setDisplayed(next);
    }
  }
  const navigateRef = useRef(navigate); navigateRef.current = navigate;
  useEffect(() => {
    if (!valid) { intent.current++; return; }
    if (committedClick.current === route) { committedClick.current = null; return; }
    if (route === previous.current) { intent.current++; setPending(null); return; }
    void navigateRef.current(route, false);
  }, [route, valid]);
  useLayoutEffect(() => {
    if (previous.current === displayed) return;
    previous.current = displayed;
    pane.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, [displayed]);
  useEffect(() => () => { intent.current++; }, []);
  async function action(kind: "visibility" | "stop") {
    if (!data) return;
    setBusy(true); setActionError(null);
    try {
      await apiFetch(kind === "stop" ? `/api/werewolf/${data.id}/stop` : `${root}/${data.id}/visibility`, { method: kind === "stop" ? "POST" : "PATCH", ...(kind === "visibility" ? { body: JSON.stringify({ hidden: !data.hidden }) } : {}) });
      if (!session.active) return;
      setConfirm(false); await client.invalidateQueries({ queryKey: ["admin", session.scope, root] }); await refresh();
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Action failed"); } finally { setBusy(false); }
  }
  if (!valid) return <>{children}</>;
  return <div className={styles.main}>
    <Link href={`/admin/werewolf?${params}`} className={styles.back}>← Werewolf games</Link>
    {error && <Notice>{error} <button onClick={() => void refresh()}>Retry</button></Notice>}
    {!data ? !error && <p role="status" className={styles.empty}>Loading game workspace…</p> : <>
      <header className={styles.heading} data-game-header><div><p className={styles.eyebrow}>{title(data.status)} · Rules v{data.snapshot.rulesVersion}{data.hidden ? " · Hidden" : ""}</p><h1>{data.slug}</h1><p>Current status · Day {data.snapshot.day} · {title(data.snapshot.phase)} · {data.snapshot.players.filter(p => p.alive).length} of {data.snapshot.players.length} alive</p></div><button onClick={() => void refresh()}>Refresh</button></header>
      <label className={styles.mobileNav}>Workspace section<select value={pending ?? displayed} onChange={event => void navigate(event.target.value as Section)}>{sections.map(section => <option key={section} value={section}>{title(section)}</option>)}</select></label>
      <nav aria-label="Game workspace" className={styles.side}>{sections.map(section => <Link key={section} href={`${href(gameId, section)}?${params}`} aria-current={route === section ? "page" : undefined} onMouseEnter={() => prefetch(section)} onFocus={() => prefetch(section)} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); void navigate(section); }}>{title(section)}{pending === section ? " …" : ""}</Link>)}</nav>
      <div className={styles.navigationStatus} aria-live="polite">{pending ? `Opening ${title(pending)} · showing ${title(displayed)}` : title(displayed)}{pending && <button onClick={() => { intent.current++; setPending(null); if (route !== displayed) window.history.replaceState(null, "", `${href(gameId, displayed)}?${params}`); }}>Cancel</button>}</div>
      {navigationError && <Notice>{navigationError} <button onClick={() => { if (failedTarget) void navigate(failedTarget, route !== failedTarget); }}>Retry</button><button onClick={() => { setNavigationError(null); setFailedTarget(null); }}>Dismiss</button></Notice>}
      <div className={styles.stage}>
        <div ref={pane} className={styles.content} data-workspace-section={displayed} inert={pending !== null}>
          {actionError && <Notice>{actionError}</Notice>}
          {displayed === "overview" && <>
          <section className={styles.surface}><h2 tabIndex={-1}>Game overview</h2><p>{data.snapshot.outcome ? `${title(data.snapshot.outcome.faction ?? "Draw")} · ${title(data.snapshot.outcome.reason)}` : "The game has not reached a result."}</p><p className={styles.small}>Created {new Date(data.createdAt).toLocaleString()}</p>
          <div className={styles.actions}>{!data.hidden && <Link href={`/werewolf/${data.slug}`}>Open spectator view ↗</Link>}{data.capabilities.visibility && <button disabled={busy} onClick={() => void action("visibility")}>{data.hidden ? "Restore listing" : "Hide game"}</button>}{data.capabilities.stop && <button disabled={busy} onClick={() => setConfirm(true)}>Stop game</button>}</div>
          {confirm && <div className={styles.notice}><p>Stop this game? Accepted history is retained. A stopped game cannot resume.</p><button disabled={busy} onClick={() => void action("stop")}>Confirm stop</button><button onClick={() => setConfirm(false)}>Keep running</button></div>}
          <p className={styles.footnote}>Hiding removes public discovery and direct viewing. Admin records remain available.</p></section>
          <section className={styles.surface}><h2>Cast</h2><p className={styles.small}>Omniscient operations view · original roles</p><div className={styles.cast}>{data.snapshot.players.map(p => <div key={p.id}><strong>{p.name}</strong><span>{title(p.role ?? "unknown")} · {p.alive ? "Alive" : "Eliminated"}</span></div>)}</div></section>

          </>}
          {displayed === "activity" && <Activity gameId={data.id} currentCursor={data.snapshot.cursor} />}
          {displayed === "costs" && <GameCosts gameId={data.id} />}
          {displayed === "production" && <><section className={styles.surface}><h2 tabIndex={-1}>Scene production</h2><p>Prepare lobby and private pack images from this game’s recorded cast. Good panels remain usable when others need repair.</p><p className={styles.small}>Draft images stay private. Publish a reviewed version for viewers to use in this game’s replay.</p></section>{!data.capabilities.production ? <p className={styles.empty}>Producer or Sysop access is required for image production.</p> : data.status !== "completed" ? <p className={styles.empty}>Scene production becomes available when this game completes.</p> : <ReplayVisualProductionPanel gameId={data.id} onLocked={() => {}} werewolf />}</>}
        </div>
      </div>
    </>}{children}
  </div>;
}
function Activity({ gameId, currentCursor }: { gameId: string; currentCursor: number }) {
  const { data, error, refresh } = useAdminRead<WerewolfView>(`${root}/${gameId}/activity`);
  return <section className={styles.surface}><h2 tabIndex={-1}>Game activity</h2><p className={styles.small}>Original contributions and resolved decisions. Includes private pack activity; no private model reasoning.</p>
    {error && <Notice>{error}</Notice>}
    {!data ? !error && <p role="status">Loading activity…</p> : <><p className={styles.small}>Snapshot · Day {data.day} · {data.phase} · {data.cursor === currentCursor ? "Current" : "Earlier than current status"} <button onClick={() => void refresh()}>Refresh activity</button></p><div className={styles.activity}>{data.entries.map((entry, index) => <article key={index} className={entry.kind === "phase" ? styles.phase : undefined}><p>{werewolfReportEntry(entry, data, true)}</p></article>)}</div></>}
  </section>;
}
function GameCosts({ gameId }: { gameId: string }) {
  const { data, error, refresh } = useAdminRead<Costs>(`${root}/${gameId}/costs`);
  return <>{error && <Notice>{error} <button onClick={() => void refresh()}>Retry costs</button></Notice>}{!data ? !error && <p role="status">Loading cost records…</p> : <>
    <section className={styles.surface}><h2 tabIndex={-1}>Gameplay spending</h2><CostEvidence detail={data.gameplay} /></section>
    <section className={styles.surface}><h2>Production spending</h2><dl className={styles.metrics}><div><dt>Known charges</dt><dd>{data.production.attempts.some(attempt => attempt.costMicrousd !== null) ? money(data.production.knownCostMicrousd) : "Not reported"}</dd></div><div><dt>Unpriced attempts</dt><dd>{data.production.unpricedAttempts}</dd></div><div><dt>Uncertain charges</dt><dd>{data.production.uncertainAttempts}</dd></div></dl>{data.production.attempts.map(attempt => <div className={styles.receipt} key={attempt.id}><strong>{attempt.provider} · {attempt.model}</strong><span>{title(attempt.status)} · {attempt.costMicrousd === null ? "Not reported" : money(attempt.costMicrousd)}</span></div>)}{!data.production.attempts.length && <p>No image-generation attempts recorded.</p>}</section>
  </>}</>;
}
