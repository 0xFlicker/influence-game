"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { WerewolfView } from "@influence/engine/werewolf/observation";
import { werewolfReportEntry } from "@influence/engine/werewolf/report";
import { apiFetch, type AdminGameCostSummary, type AdminGameCostDetail } from "@/lib/api";
import { Nav } from "@/components/nav";
import { AdminGate } from "@/components/admin-gate";
import { ReplayVisualProductionPanel } from "../replay-visual-production-panel";
import styles from "./workspace.module.css";

type Section = "overview" | "production" | "costs" | "activity";
const sections: Section[] = ["overview", "production", "costs", "activity"];
const root = "/api/admin/werewolf";
type Row = { id: string; slug: string; status: string; createdAt: string; playerCount: number; hidden: boolean; progress: { day: number; phase: string } | null; error: string | null; cost: AdminGameCostSummary | null; production: { active: number; failed: number } };
type Detail = { id: string; slug: string; status: string; hidden: boolean; createdAt: string; endedAt: string | null; view: WerewolfView; capabilities: { stop: boolean; visibility: boolean; production: boolean } };
type Costs = { gameplay: AdminGameCostDetail; production: { knownCostMicrousd: number; unpricedAttempts: number; uncertainAttempts: number; attempts: Array<{ id: string; provider: string; model: string; status: string; costMicrousd: number | null }> } };
const money = (value: number) => `$${(value / 1_000_000).toFixed(4)}`;
const title = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
const href = (id: string, section: Section) => `/admin/werewolf/${id}${section === "overview" ? "" : `/${section}`}`;

function useRead<T>(url: string) {
  const [value, setValue] = useState<{ url: string; data: T } | null>(null), [error, setError] = useState<string | null>(null), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let inFlight = false;
    async function read() {
      if (inFlight) return; inFlight = true;
      try { const data = await apiFetch<T>(url, { signal: controller.signal, cache: "no-store" }); if (!controller.signal.aborted) { setValue({ url, data }); setError(null); } }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load this page"); }
      finally { inFlight = false; }
    }
    void read(); const timer = setInterval(() => void read(), 10_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [url, revision]);
  return { data: value?.url === url ? value.data : null, error, refresh: () => setRevision(r => r + 1) };
}

export function WerewolfAdmin({ gameId, section = "overview" }: { gameId?: string; section?: Section }) {
  return <div className={styles.page}><Nav /><AdminGate allowedRoles={["producer", "sysop"]}><main className={styles.main}>
    {gameId ? <GameWorkspace key={gameId} gameId={gameId} section={section} /> : <GameList />}
  </main></AdminGate></div>;
}
function Notice({ children }: { children: React.ReactNode }) { return <p role="alert" className={styles.notice}>{children}</p>; }
function GameList() {
  const { data, error, refresh } = useRead<Row[]>(root);
  const router = useRouter(), params = useSearchParams();
  const query = params.get("q") ?? "", filter = params.get("status") ?? "all", visibility = params.get("visibility") ?? "visible";
  function change(key: string, value: string) { const next = new URLSearchParams(params); next.set(key, value); router.replace(`/admin/werewolf?${next}`, { scroll: false }); }
  const rows = data?.filter(g => g.slug.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || g.status === filter) && (visibility === "all" || (visibility === "hidden") === g.hidden));
  return <>
    <Link href="/admin/games" className={styles.back}>← Administration</Link>
    <header className={styles.heading}><div><p className={styles.eyebrow}>Game operations & production</p><h1>Werewolf</h1><p>Follow the game. Inspect the spend. Prepare the scene.</p></div><button onClick={refresh}>Refresh</button></header>
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
  </>;
}
function GameWorkspace({ gameId, section }: { gameId: string; section: Section }) {
  const { data, error, refresh } = useRead<Detail>(`${root}/${encodeURIComponent(gameId)}`);
  const router = useRouter(), params = useSearchParams();
  const sectionHref = (id: string, section: Section) => `${href(id, section)}?${params}`;
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState<string | null>(null), [confirm, setConfirm] = useState(false);
  async function action(kind: "visibility" | "stop") {
    if (!data || busy) return; setBusy(true); setActionError(null);
    try { await apiFetch(kind === "stop" ? `/api/werewolf/${data.id}/stop` : `${root}/${data.id}/visibility`, { method: kind === "stop" ? "POST" : "PATCH", ...(kind === "visibility" ? { body: JSON.stringify({ hidden: !data.hidden }) } : {}) }); setConfirm(false); refresh(); }
    catch (e) { setActionError(e instanceof Error ? e.message : "Action failed"); } finally { setBusy(false); }
  }
  return <>
    <Link href={`/admin/werewolf?${params}`} className={styles.back}>← Werewolf games</Link>
    {error && <Notice>{error}</Notice>}
    {!data ? !error && <p role="status" className={styles.empty}>Loading game workspace…</p> : <>
      <header className={styles.heading}><div><p className={styles.eyebrow}>{title(data.status)} · Rules v{data.view.rulesVersion}{data.hidden ? " · Hidden" : ""}</p><h1>{data.slug}</h1><p>Day {data.view.day} · {title(data.view.phase)} · {data.view.players.filter(p => p.alive).length} of {data.view.players.length} alive</p></div><button onClick={refresh}>Refresh</button></header>
      <label className={styles.mobileNav}>Workspace section<select value={section} onChange={e => router.push(sectionHref(data.id, e.target.value as Section))}>{sections.map(s => <option key={s}>{s}</option>)}</select></label>
      <div className={styles.workspace}><nav aria-label="Game workspace" className={styles.side}>{sections.map(s => <Link key={s} href={sectionHref(data.id, s)} aria-current={s === section ? "page" : undefined}>{title(s)}</Link>)}</nav>
      <div className={styles.content}>
        {actionError && <Notice>{actionError}</Notice>}
        {section === "overview" && <>
          <section className={styles.surface}><h2>Game overview</h2><p>{data.view.outcome ? `${title(data.view.outcome.faction ?? "Draw")} · ${title(data.view.outcome.reason)}` : "The game has not reached a result."}</p><p className={styles.small}>Created {new Date(data.createdAt).toLocaleString()}</p>
          <div className={styles.actions}>{!data.hidden && <Link href={`/werewolf/${data.slug}`}>Open spectator view ↗</Link>}{data.capabilities.visibility && <button disabled={busy} onClick={() => void action("visibility")}>{data.hidden ? "Restore listing" : "Hide game"}</button>}{data.capabilities.stop && <button disabled={busy} onClick={() => setConfirm(true)}>Stop game</button>}</div>
          {confirm && <div className={styles.notice}><p>Stop this game? Accepted history is retained. A stopped game cannot resume.</p><button disabled={busy} onClick={() => void action("stop")}>Confirm stop</button><button onClick={() => setConfirm(false)}>Keep running</button></div>}
          <p className={styles.footnote}>Hiding removes public discovery and direct viewing. Admin records remain available.</p></section>
          <section className={styles.surface}><h2>Cast</h2><p className={styles.small}>Omniscient operations view · original roles</p><div className={styles.cast}>{data.view.players.map(p => <div key={p.id}><strong>{p.name}</strong><span>{title(p.role ?? "unknown")} · {p.alive ? "Alive" : "Eliminated"}</span></div>)}</div></section>
        </>}
        {section === "activity" && <section className={styles.surface}><h2>Game activity</h2><p className={styles.small}>Original contributions and resolved decisions. Includes private pack activity; no private model reasoning.</p><div className={styles.activity}>{data.view.entries.map((entry, index) => <article key={index} className={entry.kind === "phase" ? styles.phase : undefined}><p>{werewolfReportEntry(entry, data.view, true)}</p></article>)}</div></section>}
        {section === "costs" && <GameCosts gameId={data.id} />}
        {section === "production" && <><section className={styles.surface}><h2>Scene production</h2><p>Prepare lobby and private pack images from this game’s recorded cast. Good panels remain usable when others need repair.</p><p className={styles.small}>Production assets are admin-only for now. Publishing a version does not add it to the public Werewolf viewer.</p></section>{!data.capabilities.production ? <p className={styles.empty}>Producer or Sysop access is required for image production.</p> : data.status !== "completed" ? <p className={styles.empty}>Scene production becomes available when this game completes.</p> : <ReplayVisualProductionPanel gameId={data.id} onLocked={setBusy} werewolf />}</>}
      </div></div>
    </>}
  </>;
}
function GameCosts({ gameId }: { gameId: string }) {
  const { data, error } = useRead<Costs>(`${root}/${gameId}/costs`);
  if (error) return <Notice>{error}</Notice>;
  if (!data) return <p role="status">Loading cost records…</p>;
  const g = data.gameplay, p = data.production;
  return <>
    <section className={styles.surface}><h2>Gameplay spending</h2><p className={styles.small}>Recorded provider attempts, including retries. Actual and estimated amounts are separate.</p><dl className={styles.metrics}>
      <div><dt>Recorded actual</dt><dd>{g.state === "actual" ? money(g.actualCostMicrousd) : "N/C"}</dd></div><div><dt>Estimated</dt><dd>{g.estimatedCostMicrousd ? money(g.estimatedCostMicrousd) : "—"}</dd></div><div><dt>Calls / retries</dt><dd>{g.callCount} / {g.retryFailureSpend.retryCallCount}</dd></div><div><dt>Unpriced / failed</dt><dd>{g.unpricedCallCount} / {g.failedCallCount}</dd></div><div><dt>Input / cached tokens</dt><dd>{g.promptTokens.toLocaleString()} / {g.cachedTokens.toLocaleString()}</dd></div><div><dt>Output / reasoning tokens</dt><dd>{g.completionTokens.toLocaleString()} / {g.reasoningTokens.toLocaleString()}</dd></div></dl>
      <h3>Model usage</h3>{Object.entries(g.breakdowns.model ?? {}).map(([model, usage]) => <div key={model} className={styles.receipt}><strong>{model}</strong><span>{usage.callCount} calls · {usage.totalTokens.toLocaleString()} tokens · {usage.actualCostMicrousd ? `${money(usage.actualCostMicrousd)} actual` : usage.estimatedCostMicrousd ? `${money(usage.estimatedCostMicrousd)} estimated` : "N/C"}</span></div>)}
      <details><summary>Model breakdown and call evidence</summary><pre className={styles.evidence}>{JSON.stringify({ breakdowns: g.breakdowns, expensiveCalls: g.expensiveCalls, retryFailureSpend: g.retryFailureSpend, pricing: g.pricing }, null, 2)}</pre></details></section>
    <section className={styles.surface}><h2>Production spending</h2><dl className={styles.metrics}><div><dt>Known charges</dt><dd>{p.attempts.some(a => a.costMicrousd !== null) ? money(p.knownCostMicrousd) : "N/C"}</dd></div><div><dt>Unpriced attempts</dt><dd>{p.unpricedAttempts}</dd></div><div><dt>Uncertain charges</dt><dd>{p.uncertainAttempts}</dd></div></dl>{p.attempts.map(a => <div className={styles.receipt} key={a.id}><strong>{a.provider} · {a.model}</strong><span>{title(a.status)} · {a.costMicrousd === null ? "N/C" : money(a.costMicrousd)}</span></div>)}{!p.attempts.length && <p>No image-generation attempts recorded.</p>}</section>
  </>;
}
