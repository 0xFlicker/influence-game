"use client";
import { useAdminSession, useAdminValue } from "../../../admin-session";
import { useEffect, useRef, useState } from "react";
import type { VisualPlayerAnchor, VisualShotContent } from "@influence/engine/visual-mode";

type Mode = "scene" | "establishing" | "groups" | "portraits";
interface Source { id: string; kind: "artifact" | "attempt"; imageId: string; label: string; participantIds: string[]; anchors: VisualPlayerAnchor[]; pointers: VisualShotContent["pointers"] }
interface Selection extends VisualShotContent { sourceId: string; role: "overview" | "group" }
interface Review { expectedRevision: number; planHash: string; mode: Mode; shots: Selection[] }
const button = "rounded border border-white/25 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40";

/** Reusable correction surface for saved image reviews; no generation or publication. */
export function ImageReviewEditor({ gameId, sceneId, apiPrefix, disabled, onSave, onClose, onRegenerate }: {
  gameId: string; sceneId: string; apiPrefix: string; disabled: boolean;
  onSave: (review: Review) => void; onClose: () => void; onRegenerate?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { node?.close(); document.body.style.overflow = overflow; };
  }, []);
  const [data, setData] = useState<{ expectedRevision: number; planHash: string; players: Array<{ id: string; name: string }>; sources: Source[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [image, setImage] = useState<{ sourceId: string; url: string } | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [tool, setTool] = useState<"head" | "pointer">("head");
  const session = useAdminSession(), draftKey = `draft:${apiPrefix}/${gameId}/visual:${sceneId}`;
  const [draft, setDraft] = useAdminValue<Review | null>(draftKey, null);
  const mode = draft?.mode ?? "groups", selections = draft?.shots ?? [];
  const conflict = Boolean(draft && data && (draft.planHash !== data.planHash || draft.expectedRevision !== data.expectedRevision || draft.shots.some(shot => !data.sources.some(source => source.id === shot.sourceId))));
  const updateDraft = (change: Partial<Review>) => { if (data) setDraft(current => ({ expectedRevision: data.expectedRevision, planHash: data.planHash, mode: "groups", shots: [], ...current, ...change })); };
  const setMode = (value: Mode) => updateDraft({ mode: value });
  const setSelections = (value: Selection[] | ((previous: Selection[]) => Selection[])) => updateDraft({ shots: typeof value === "function" ? value(selections) : value });
  useEffect(() => {
    let cancelled = false;
    session.read<NonNullable<typeof data>>(`${apiPrefix}/${gameId}/visual/scenes/${sceneId}/review`).then(result => {
      if (cancelled) return;
      setData(result); setSourceId(result.sources[0]?.id ?? ""); setPlayerId(result.players[0]?.id ?? "");
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Review unavailable"); });
    return () => { cancelled = true; };
  }, [apiPrefix, gameId, sceneId, session]);
  const source = data?.sources.find(s => s.id === sourceId);
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    session.read<{ imageUrl: string }>(`${apiPrefix}/${gameId}/visual/evidence/${source.kind}/${source.imageId}`).then(result => {
      if (!cancelled) { setError(null); setImage({ sourceId: source.id, url: result.imageUrl }); }
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Image unavailable"); });
    return () => { cancelled = true; };
  }, [source, apiPrefix, gameId, session]);
  const selected = selections.find(s => s.sourceId === sourceId);
  const choose = (role: Selection["role"] | "reject") => {
    if (!source) return;
    setSelections(current => {
      const retained = current.filter(s => s.sourceId !== source.id && !(role === "overview" && s.role === "overview"));
      return role === "reject" ? retained : [...retained, { sourceId: source.id, participantIds: source.participantIds,
        visibleParticipantIds: source.anchors.map(a => a.playerId), anchors: source.anchors, pointers: source.pointers, ...selected, role }];
    });
  };
  const mark = (x: number, y: number) => {
    if (!playerId || !selected || disabled) return;
    setSelections(current => current.map(s => {
      if (s.sourceId !== sourceId) return s;
      const anchors = s.anchors.filter(a => a.playerId !== playerId);
      const pointers = s.pointers.filter(p => p.playerId !== playerId);
      if (tool === "head") anchors.push({ playerId, label: 1, confidence: "clear", head: { x: Math.max(0, Math.min(.94, x - .03)), y: Math.max(0, Math.min(.92, y - .04)), width: .06, height: .08 } });
      else pointers.push({ playerId, x, y });
      return { ...s, participantIds: [...new Set([...s.participantIds, playerId])], anchors: anchors.map((a, i) => ({ ...a, label: i + 1 })), visibleParticipantIds: anchors.map(a => a.playerId), pointers };
    }));
  };
  const clear = () => setSelections(current => current.map(s => s.sourceId !== sourceId ? s : { ...s,
    anchors: s.anchors.filter(a => a.playerId !== playerId), visibleParticipantIds: s.visibleParticipantIds.filter(id => id !== playerId), pointers: s.pointers.filter(p => p.playerId !== playerId) }));
  const shots = mode === "portraits" ? [] : mode === "groups" ? selections.filter(s => s.role === "group") : mode === "scene" ? selections.filter(s => s.role === "overview") : selections;
  const ready = mode === "portraits" || (mode === "scene" ? shots.some(s => s.role === "overview") : shots.some(s => s.role === "group") && (mode !== "establishing" || shots.some(s => s.role === "overview")));
  const marker = selected?.anchors.find(a => a.playerId === playerId);
  return <dialog ref={dialog} aria-label="Correct image review" onCancel={event => { event.preventDefault(); if (!disabled) onClose(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-auto border-0 bg-[#08090d] p-4 text-white backdrop:bg-black/90 sm:p-6"><div className="mx-auto max-w-5xl space-y-3">
    <div className="flex items-center justify-between"><h3 className="font-semibold">Correct images</h3><div className="flex gap-2">{onRegenerate && <button className={button} disabled={disabled} onClick={onRegenerate}>Reject and regenerate</button>}<button className={button} onClick={onClose} disabled={disabled}>Close editor</button></div></div>
    <p className="text-sm text-white/70">Choose the pictures that work. Select a character, then click their head. Unmarked characters use a headshot and speech bubble over the picture. A speech pointer hides that headshot and points at your chosen spot.</p>
    {conflict && <p role="alert">This draft belongs to an earlier image revision. Review the saved version before proceeding. <button type="button" className={button} onClick={() => session.delete(draftKey)}>Discard older draft</button></p>}
    {error && <p role="alert" className="text-amber-200">{error}</p>}
    {!data ? <p role="status">Loading saved pictures…</p> : <>
      <label className="block text-sm">Presentation <select aria-label="Presentation" className="ml-2 rounded bg-neutral-900 p-2" value={mode} disabled={disabled} onChange={e => setMode(e.target.value as Mode)}>
        <option value="scene">Use the reviewed image</option><option value="establishing">Brief overview, then group shots</option><option value="groups">Group shots only</option><option value="portraits">Reject all images; use portraits</option>
      </select></label>
      <label className="block text-sm">Saved picture <select aria-label="Saved picture" className="ml-2 max-w-full rounded bg-neutral-900 p-2" value={sourceId} onChange={e => setSourceId(e.target.value)}>{data.sources.map(s => <option key={s.id} value={s.id}>{s.label}{selections.some(v => v.sourceId === s.id) ? " · selected" : ""}</option>)}</select></label>
      {source && <div className="flex flex-wrap gap-2"><button className={button} disabled={disabled} aria-pressed={selected?.role === "overview"} onClick={() => choose("overview")}>Use as overview</button><button className={button} disabled={disabled} aria-pressed={selected?.role === "group"} onClick={() => choose("group")}>Use as group shot</button><button className={button} disabled={disabled || !selected} onClick={() => choose("reject")}>Reject this picture</button></div>}
      {selected && <div className="flex flex-wrap items-center gap-2">
        <label>Character <select aria-label="Character to mark" className="rounded bg-neutral-900 p-2" value={playerId} onChange={e => setPlayerId(e.target.value)}>{data.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Mark <select aria-label="Marker type" className="rounded bg-neutral-900 p-2" value={tool} onChange={e => setTool(e.target.value as typeof tool)}><option value="head">Visible head</option><option value="pointer">Speech pointer only</option></select></label>
        <button className={button} onClick={clear} disabled={disabled}>Use headshot fallback</button>
        {marker && <label className="text-sm">Head size <input aria-label="Head size" type="range" min="0.02" max="0.3" step="0.005" value={marker.head.width} disabled={disabled} onChange={e => {
          const width = Number(e.target.value);
          setSelections(current => current.map(s => s.sourceId !== sourceId ? s : { ...s, anchors: s.anchors.map(a => a.playerId !== playerId ? a : { ...a, head: { ...a.head, width: Math.min(width, 1 - a.head.x), height: Math.min(width * 4 / 3, 1 - a.head.y) } }) }));
        }} /></label>}
      </div>}
      {image?.sourceId === sourceId ? <div className="relative mx-auto max-w-3xl">
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated evidence, natural aspect ratio is the coordinate space */}
        <img src={image.url} alt={source?.label ?? "Review image"} className="block h-auto w-full" />
        {selected && <button type="button" aria-label="Place character marker on image" className="absolute inset-0 cursor-crosshair" disabled={disabled} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); mark((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height); }} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); mark(.5, .5); } }} />}
        {selected?.anchors.map(a => <span key={a.playerId} className="pointer-events-none absolute border-2 border-emerald-300" style={{ left: `${a.head.x * 100}%`, top: `${a.head.y * 100}%`, width: `${a.head.width * 100}%`, height: `${a.head.height * 100}%` }}><span className="absolute bottom-full whitespace-nowrap bg-black/80 px-1 text-xs">{data.players.find(p => p.id === a.playerId)?.name}</span></span>)}
        {selected?.pointers.map(p => <span key={p.playerId} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-amber-300 px-1 text-xs text-black" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}>↘ {data.players.find(v => v.id === p.playerId)?.name}</span>)}
      </div> : source && <p role="status">Loading picture…</p>}
      <p className="text-sm text-white/60">{shots.length} selected pictures. {selected ? `${selected.anchors.length} marked heads in this picture.` : "This picture is excluded."}</p>
      <button className={button} disabled={disabled || !ready || conflict} onClick={() => onSave({ mode, shots, expectedRevision: data.expectedRevision, planHash: data.planHash })}>Save reviewed version</button>
    </>}
  </div></dialog>;
}
