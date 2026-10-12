"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdminRead, useAdminSession, useAdminValue, type Operation } from "../admin-session";
import { productionLibraryFilters, type ProductionLibraryPage } from "@/lib/production-studio";
import styles from "./studio.module.css";

type NamingReview = {gameIds: string[]; calls: number; skipped: number; queued: boolean};
type NamingBaseline = Record<string,{revision:number;status:string}>;
export function ProductionLibrary() {
  const params = useSearchParams(), router = useRouter(), session = useAdminSession();
  const filters = productionLibraryFilters(new URLSearchParams(params));
  const query = new URLSearchParams(filters); query.set("limit", "25");
  if (params.get("cursor")) query.set("cursor", params.get("cursor")!);
  const page = useAdminRead<ProductionLibraryPage>(`/api/admin/production/library?${query}`);
  const resource = "/api/admin/production/library", key = `operation:${resource}:naming`, baselineKey = `ui:${resource}:naming-baseline`;
  const [selected, setSelected] = useAdminValue<string[]>(`draft:${resource}:selected`, []);
  const [replace, setReplace] = useAdminValue(`draft:${resource}:replace`, false);
  const [review, setReview] = useAdminValue<NamingReview | null>(`draft:${resource}:review`, null);
  const [notice, setNotice] = useAdminValue<string | null>(`ui:${resource}:notice`, null);
  const [preparing, setPreparing] = useAdminValue(`ui:${resource}:preparing`, false);
  const [operation] = useAdminValue<Operation | undefined>(key, undefined);
  const busy = preparing || operation?.phase === "submitting", unknown = operation?.phase === "unknown";
  const selectable = page.data?.items.filter(game => game.capabilities.episodeEdit && selected.includes(game.id)) ?? [];
  function change(key: string, value: string) {const next = new URLSearchParams(filters); if (value) next.set(key, value); else next.delete(key); setSelected([]); setReview(null); router.replace(`/admin/production?${next}`);}
  async function readNamingStates(gameIds:string[]):Promise<NamingBaseline> {
    const states = await Promise.all(gameIds.map(async id => {
      const value = await session.read<{episode:{revision:number;status:string}}>(`/api/admin/games/${encodeURIComponent(id)}/episode`);
      return [id,{revision:value.episode.revision,status:value.episode.status}] as const;
    }));
    return Object.fromEntries(states);
  }
  async function naming(preview: boolean) {
    if (session.pending(key) || session.get<boolean>(`ui:${resource}:preparing`)) return;
    const gameIds = preview ? selectable.map(game => game.id) : review?.gameIds ?? [];
    if (!gameIds.length || page.denied) return;
    setPreparing(true);
    setNotice(null);
    try {
      session.set(baselineKey,await readNamingStates(gameIds));
      const result = await session.execute<NamingReview>(key, "/api/admin/episodes/backfill", {gameIds, regenerate: replace, preview}, false, {accessResource:resource});
      if (result) {if (preview) setReview(result); else {setReview(null); setSelected([]); setNotice(`${result.calls} naming requests queued; ${result.skipped} skipped because their state changed.`); await page.refresh();}}
    } catch (error) {if (!session.get<boolean>(`access-denied:${resource}`)) setNotice(error instanceof Error ? error.message : "Naming request failed");}
    finally {if (!session.get<boolean>(`access-denied:${resource}`)) setPreparing(false);}
  }
  async function checkSaved() {
    const current = session.get<Operation>(key);
    if (current?.phase !== "unknown" || preparing) return;
    setPreparing(true);
    try {
      const gameIds = current.body.gameIds as string[], baseline = session.get<NamingBaseline>(baselineKey);
      if (!baseline) throw new Error("The earlier naming state is unavailable. Inspect the selected episodes before retrying.");
      const states = await readNamingStates(gameIds);
      if (session.get(key) !== current) return;
      const changed = gameIds.filter(id => states[id]!.revision !== baseline[id]!.revision || states[id]!.status !== baseline[id]!.status);
      const observed = current.body.preview === false && changed.length > 0;
      const text = observed ? `${changed.length} selected naming states changed. Review the saved episodes; no second batch was sent.`
        : current.body.preview === true ? "Saved episode states checked. Review the naming batch again; no queue request was sent."
        : "No naming state change is visible. Review the selected episodes before explicitly retrying.";
      session.set<Operation>(key,{...current,phase:observed ? "accepted" : "rejected",...(observed ? {result:{observed:true},error:undefined} : {error:text})});
      if (observed || current.body.preview === true) setReview(null);
      setNotice(text); await page.refresh();
    } catch (error) {if (!session.get<boolean>(`access-denied:${resource}`)) setNotice(error instanceof Error ? error.message : "Naming state could not be checked; the request outcome remains unknown.");}
    finally {if (!session.get<boolean>(`access-denied:${resource}`)) setPreparing(false);}
  }
  return <section className={styles.studio} aria-label="Production library" data-production-library>
    <header className={styles.heading}><div><p className={styles.label}>The House / Production</p><h1>Production Studio</h1><p className={styles.subtitle}>Watch, edit and repair completed episodes or accepted paused prefixes.</p></div><button onClick={() => void page.refresh()}>Refresh library</button></header>
    <div className={styles.libraryFilters}>
      <label>Game<select disabled={busy || unknown} aria-label="Game filter" value={filters.get("kind") ?? ""} onChange={event => change("kind", event.target.value)}><option value="">Both games</option><option value="influence">Influence</option><option value="werewolf">Werewolf</option></select></label>
      <label>Status<select disabled={busy || unknown} aria-label="Production status" value={filters.get("status") ?? ""} onChange={event => change("status", event.target.value)}><option value="">Completed and paused</option><option value="completed">Completed</option><option value="suspended">Paused</option></select></label>
      <label>Search<input disabled={busy || unknown} aria-label="Search production" type="search" value={filters.get("search") ?? ""} onChange={event => change("search", event.target.value)} maxLength={200} /></label>
      <label><input disabled={busy || unknown} type="checkbox" checked={filters.get("attention") === "needs_attention"} onChange={event => change("attention", event.target.checked ? "needs_attention" : "")} /> Needs attention</label>
    </div>
    {page.error && <p role="alert" className={styles.warning}>{page.error}</p>}
    {unknown && <p role="alert" className={styles.warning}>The naming batch outcome is unknown. Check each selected episode before retrying. <button disabled={busy} onClick={() => void checkSaved()}>Check saved naming batch</button></p>}
    {!page.data && !page.error && <p role="status">Loading bounded library page…</p>}
    {page.data && <>
      {page.data.items.some(game => game.capabilities.episodeEdit) && <div className={styles.batchTools}>
        <span>{selectable.length} selected on this page</span><label><input type="checkbox" checked={replace} disabled={busy || unknown} onChange={event => {setReplace(event.target.checked); setReview(null);}} /> Replace existing titles</label>
        <button disabled={busy || unknown || !selectable.length} onClick={() => void naming(true)}>Review naming batch</button>
        {review && <div className={styles.warning}><p>{review.calls} House naming calls · {review.skipped} skipped</p><ul>{review.gameIds.map(id => <li key={id}>{page.data!.items.find(game => game.id === id)?.title ?? id}</li>)}</ul><button disabled={busy || unknown || !review.calls} onClick={() => void naming(false)}>Queue {review.calls} naming requests</button><button disabled={busy || unknown} onClick={() => setReview(null)}>Cancel</button></div>}
      </div>}
      <div className={styles.libraryList}>{page.data.items.map(game => <article key={game.id} className={styles.libraryGame}>
        {game.capabilities.episodeEdit && <input type="checkbox" aria-label={`Select ${game.slug}`} checked={selected.includes(game.id)} disabled={busy || unknown} onChange={event => {setSelected(event.target.checked ? [...selected, game.id] : selected.filter(id => id !== game.id)); setReview(null);}} />}
        <div><h2>{game.title ?? game.slug}</h2><p>{game.gameKind === "werewolf" ? "Werewolf" : "Influence"} · {game.status === "suspended" ? "Paused" : "Completed"} · {game.playerCount} players{game.hidden ? " · Hidden" : ""}</p><p>{game.slug}{game.needsAttention ? " · Needs attention" : ""}</p></div>
        <Link href={`/admin/production/games/${encodeURIComponent(game.id)}?${new URLSearchParams({return: filters.toString()})}`}>Open studio →</Link>
      </article>)}</div>
      {!page.data.items.length && <p>No eligible games on this page.</p>}
      {page.data.nextCursor && <Link className={styles.nextPage} href={`/admin/production?${new URLSearchParams({...Object.fromEntries(filters), cursor: page.data.nextCursor})}`}>Next page →</Link>}
      {page.data.skippedInvalidPauses > 0 && <p className={styles.hint}>{page.data.skippedInvalidPauses} paused games have no validated production frontier.</p>}
    </>}
    {notice && <p role="status" className={styles.warning}>{notice}</p>}
  </section>;
}
