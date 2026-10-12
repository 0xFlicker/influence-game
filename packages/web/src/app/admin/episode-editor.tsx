"use client";
import type { EpisodePresentation, EpisodePreview } from "@/lib/api";
import { accessDenied, useAdminRead, useAdminSession, useAdminValue, type Operation } from "./admin-session";
import { usePostgameMediaOperation } from "./admin-postgame-media";

type EpisodeRead = EpisodePreview & { failure: string | null };
type Notice = { kind: "success" | "error"; text: string };
function savedEditMatches(body: Record<string, unknown>, episode: EpisodePresentation) {
  return body.title === episode.title && body.description === episode.description && body.locked === episode.locked
    && body.coverUrl === episode.coverUrl && JSON.stringify(body.frameOrder) === JSON.stringify(episode.frameOrder);
}

/** Inline form; Studio owns its dialog, navigation and focus restoration. */
export function EpisodeEditor({ gameId, onSaved }: { gameId: string; onSaved: () => Promise<void> }) {
  const session = useAdminSession();
  const resource = `/api/admin/games/${encodeURIComponent(gameId)}/episode`;
  const query = useAdminRead<EpisodeRead>(resource), media = usePostgameMediaOperation(gameId);
  const draftKey = `draft:${resource}`, saveKey = `operation:${resource}:save`, namingKey = `operation:${resource}:naming`;
  const [savedDraft, setDraft] = useAdminValue<EpisodePresentation | null>(draftKey, null);
  const [saveOperation] = useAdminValue<Operation | undefined>(saveKey, undefined);
  const [namingOperation] = useAdminValue<Operation | undefined>(namingKey, undefined);
  const [notice, setNotice] = useAdminValue<Notice | null>(`ui:${resource}:notice`, null);
  const data = query.data, draft = savedDraft ?? data?.episode;
  const pending = saveOperation?.phase === "submitting" || namingOperation?.phase === "submitting" || media.pending;
  const unknown = saveOperation?.phase === "unknown" || namingOperation?.phase === "unknown" || media.unknown;
  const conflict = Boolean(savedDraft && data && savedDraft.revision !== data.episode.revision);
  const disabled = pending || unknown || query.denied;
  const framesById = new Map(data?.frames.map(frame => [frame.id, frame]));
  const ordered = draft?.frameOrder.flatMap(id => framesById.get(id) ?? []) ?? [];
  const frames = [...ordered, ...(data?.frames.filter(frame => !draft?.frameOrder.includes(frame.id)) ?? [])];
  const fail = (error: unknown) => {
    if (!accessDenied(error)) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Episode request failed." });
  };
  function adoptSavedRevision(body: Record<string, unknown>, next: EpisodeRead) {
    if (!savedEditMatches(body, next.episode)) return;
    setDraft(current => current && current.revision === body.revision
      ? { ...current, revision: next.episode.revision, status: next.episode.status } : current);
  }
  async function save() {
    if (!draft || !data || disabled || conflict) return;
    const body = { title: draft.title, description: draft.description, locked: draft.locked, revision: draft.revision,
      coverUrl: draft.coverUrl, frameOrder: draft.frameOrder };
    setNotice(null);
    try {
      const result = await session.execute<{ saved: true }>(saveKey, resource, body, false, { method: "PATCH" });
      if (!result) return;
      const next = await query.refresh();
      if (next.error || !next.data || !session.get(saveKey)) return;
      adoptSavedRevision(body, next.data);
      setNotice({ kind: "success", text: "Presentation saved." }); await onSaved();
    } catch (error) { fail(error); }
  }
  async function nameEpisode() {
    if (!data || disabled || data.episode.locked || ["queued", "generating"].includes(data.episode.status)) return;
    setNotice(null);
    session.set(`ui:${resource}:naming-baseline`, { revision: data.episode.revision, status: data.episode.status });
    try {
      const result = await session.execute<{ calls: number }>(namingKey, "/api/admin/episodes/backfill",
        { gameIds: [gameId], regenerate: true, preview: false }, false, { accessResource: resource });
      if (!result) return;
      if (!result.calls) throw new Error("Naming was not queued. The game may be hidden, not started, protected, or already queued. Refresh to check its status.");
      const next = await query.refresh();
      if (next.error || !session.get(namingKey)) return;
      setNotice({ kind: "success", text: "One House naming request queued. Refresh to see the result." }); await onSaved();
    } catch (error) { fail(error); }
  }
  async function checkSaved(key: string) {
    const current = session.get<Operation>(key);
    if (current?.phase !== "unknown") return;
    const next = await query.refresh();
    if (next.error || !next.data || session.get(key) !== current) return;
    const baseline = session.get<{ revision: number; status: string }>(`ui:${resource}:naming-baseline`);
    if (key === namingKey && !baseline) { setNotice({ kind: "error", text: "The prior naming state is unavailable. Inspect the saved presentation before retrying." }); return; }
    const observed = key === saveKey ? savedEditMatches(current.body, next.data.episode) && next.data.episode.revision > Number(current.body.revision)
      : next.data.episode.revision !== baseline!.revision || next.data.episode.status !== baseline!.status;
    const text = observed ? key === saveKey ? "The saved presentation matches this edit. No second save was sent."
      : "Naming state changed since the request. Review the saved presentation; no second naming request was sent."
      : "No matching change is visible. Review the saved presentation before retrying.";
    session.set<Operation>(key, { ...current, phase: observed ? "accepted" : "rejected",
      ...(observed ? { result: { observed: true }, error: undefined } : { error: text }) });
    if (observed && key === saveKey) adoptSavedRevision(current.body, next.data);
    setNotice({ kind: observed ? "success" : "error", text });
    if (observed) await onSaved();
  }
  return <section className="episode-editor" aria-label="Edit episode presentation">
    {!draft && !query.error && <p>Loading presentation…</p>}
    {conflict && <p role="alert">This draft belongs to an earlier episode revision. Review the saved presentation before saving. <button disabled={disabled} onClick={() => session.delete(draftKey)}>Discard older draft</button></p>}
    {saveOperation?.phase === "unknown" && <p role="alert">The save outcome is unknown. <button disabled={query.isFetching} onClick={() => void checkSaved(saveKey)}>Check saved presentation</button></p>}
    {namingOperation?.phase === "unknown" && <p role="alert">The naming request outcome is unknown. <button disabled={query.isFetching} onClick={() => void checkSaved(namingKey)}>Check saved naming state</button></p>}
    {media.unknown && <p role="alert">The trailer request outcome is unknown. <button disabled={media.isFetching} onClick={() => void media.checkSaved()}>Check saved trailer state</button></p>}
    {draft && <><p className="mt-3 text-sm text-white/50">House naming: {data?.episode.status ?? draft.status}{data?.failure ? ` · ${data.failure}` : ""}</p>
      <label>Title<input disabled={disabled} maxLength={90} value={draft.title} onInput={event => setDraft({ ...draft, title: event.currentTarget.value })} /></label>
      <label>Description<textarea disabled={disabled} rows={3} maxLength={280} value={draft.description} onInput={event => setDraft({ ...draft, description: event.currentTarget.value })} /></label>
      <label>Cover<select disabled={disabled} value={draft.coverUrl ?? ""} onChange={event => setDraft({ ...draft, coverUrl: event.target.value || null })}><option value="">Automatic scene / cast artwork</option>{data?.frames.filter(frame => frame.imageUrl).map(frame => <option key={frame.id} value={frame.imageUrl}>{frame.label} · {frame.id.slice(0, 8)}</option>)}{data?.media.status === "ready" && <option value={data.media.poster.url}>Trailer poster</option>}</select></label>
      <fieldset><legend className="text-sm">Preview sequence</legend>{frames.map((frame, index) => <div key={frame.id} className="flex items-center justify-between gap-2 py-1 text-sm"><span>{frame.label}</span><button disabled={disabled || index === 0} aria-label={`Move ${frame.label} earlier`} onClick={() => { const next = [...frames]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; setDraft({ ...draft, frameOrder: next.map(row => row.id) }); }}>↑ Earlier</button></div>)}</fieldset>
      <label><input disabled={disabled} type="checkbox" checked={draft.locked} onChange={event => setDraft({ ...draft, locked: event.target.checked })} /> Protect these edits from House regeneration</label>
      <div className="editor-actions"><button disabled={disabled || conflict || !data} onClick={() => void save()}>Save presentation</button>
        <button disabled={disabled || !data || data.episode.locked || ["queued", "generating"].includes(data.episode.status)} onClick={() => void nameEpisode()}>{data?.episode.status === "unrequested" ? "Generate title & description" : data?.episode.status === "failed" ? "Retry title & description" : "Regenerate title & description"}</button>
        <button disabled={pending || query.isFetching} onClick={() => void query.refresh()}>Refresh saved presentation</button>
        <button disabled={disabled || !media.action} onClick={() => void media.submit("Episode library presentation")}>{media.confirming ? "Confirm trailer & poster request" : media.action === "rerender" ? "Redo trailer & poster" : "Backfill trailer & poster"}</button>
      </div>{media.confirming && <p>A ready trailer is public. Confirm to request a new immutable trailer and poster.</p>}</>}
    {query.error && <p role="alert">{query.error}</p>}
    {notice && <p role={notice.kind === "error" ? "alert" : "status"} className="mt-3">{notice.text}</p>}
    {media.error && <p role="alert">{media.error}</p>}
    {media.notice && <p role={media.notice.kind === "error" ? "alert" : "status"} className="mt-3">{media.notice.text}</p>}
  </section>;
}
