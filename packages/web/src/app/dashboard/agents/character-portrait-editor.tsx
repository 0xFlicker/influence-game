"use client";

import { useEffect, useRef, useState } from "react";
import { squarePortraitCrop, portraitHeadRectangle, type PortraitCrop, type CharacterHeadPosition, type HeadRectangle } from "@influence/engine/character-portrait";
import { apiFetch } from "@/lib/api";

/** Original image coordinates are the authority; the preview and exported pixels use the same rectangle. */
export function CharacterPortraitEditor({ sourceUrl, initialCrop, initialHead, confirmHead = false, name, onApply, onClose, onPendingChange, onFailure }: {
  sourceUrl: string; initialCrop?: PortraitCrop | null; initialHead?: CharacterHeadPosition | null; confirmHead?: boolean; name: string;
  onApply: (value: { avatarUrl: string; portraitCrop: PortraitCrop; headPosition: CharacterHeadPosition | null }) => void;
  onClose: () => void; onPendingChange: (pending: boolean) => void; onFailure: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const epoch = useRef(0);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [crop, setCrop] = useState<PortraitCrop | null>(null);
  const [head, setHead] = useState<HeadRectangle>(initialHead?.sourceUrl === sourceUrl ? initialHead.rect : { x: 0.35, y: 0.04, width: 0.3, height: 0.16 });
  const drag = useRef<{ x: number; y: number; rect: HeadRectangle; resize: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    const mountedEpoch = ++epoch.current;
    element?.showModal();
    return () => { epoch.current = mountedEpoch + 1; element?.close(); };
  }, []);
  function adjust(x: number, y: number, side: number) {
    if (size) setCrop(squarePortraitCrop(sourceUrl, size, x, y, side));
  }
  async function apply() {
    if (!crop || busy) return;
    const current = epoch.current;
    setBusy(true); setError(null); onPendingChange(true);
    try {
      const result = await apiFetch<{ avatarUrl: string; portraitCrop: PortraitCrop; headPosition: CharacterHeadPosition | null }>("/api/agent-profiles/portrait-crop", {
        method: "POST", body: JSON.stringify({ ...crop, ...(confirmHead ? { headRectangle: head } : {}) }), signal: AbortSignal.timeout(30_000),
      });
      if (current !== epoch.current) return;
      onApply(result);
      onClose();
    } catch (cause) {
      if (current !== epoch.current) return;
      setError(cause instanceof Error ? cause.message : "Portrait export failed. Try again.");
      onFailure();
    } finally {
      if (current === epoch.current) { setBusy(false); onPendingChange(false); }
    }
  }
  const headFitsCrop = !confirmHead || Boolean(crop && portraitHeadRectangle({ sourceUrl, sourceHash: "", sourceWidth: size?.width ?? 0, sourceHeight: size?.height ?? 0, rect: head }, crop));
  const side = size && crop ? crop.width * size.width : 0;
  return <dialog ref={dialog} aria-labelledby="portrait-editor-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }} className="influence-modal m-auto w-[min(960px,95vw)] max-h-[90vh] overflow-auto rounded-2xl border border-white/15 bg-[#11111b] p-5 text-white backdrop:bg-black/80 sm:p-7">
    <div className="flex items-start justify-between gap-4"><div><h2 id="portrait-editor-title" className="text-xl font-semibold">Character images</h2><p className="mt-2 text-sm text-white/55">Frame {name || "your character"}’s portrait. {confirmHead ? "Confirm the gold head box for speech placement; the violet box controls the portrait crop." : "The full-body original stays intact."}</p></div><button type="button" disabled={busy} onClick={onClose} className="influence-button-secondary rounded-lg px-3 py-2">Close</button></div>
    <div className="mt-6 grid gap-6 sm:grid-cols-[minmax(0,1fr)_260px]">
      <div className="flex items-center justify-center rounded-xl bg-black/25 p-3">
        <div className="relative overflow-hidden" onPointerDown={event => {
          const mode = (event.target as HTMLElement).dataset.headDrag;
          if (!mode || busy) return;
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, rect: head, resize: mode === "resize" };
        }} onPointerMove={event => {
          if (!drag.current) return;
          const bounds = event.currentTarget.getBoundingClientRect(), start = drag.current;
          const dx = (event.clientX - start.x) / bounds.width, dy = (event.clientY - start.y) / bounds.height;
          setHead(start.resize ? { ...start.rect, width: Math.max(.01, Math.min(1 - start.rect.x, start.rect.width + dx)), height: Math.max(.01, Math.min(1 - start.rect.y, start.rect.height + dy)) }
            : { ...start.rect, x: Math.max(0, Math.min(1 - start.rect.width, start.rect.x + dx)), y: Math.max(0, Math.min(1 - start.rect.height, start.rect.y + dy)) });
        }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- original image coordinates are required for crop editing */}
          <img src={sourceUrl} alt={`${name} full image`} className="max-h-[55vh] w-auto max-w-full object-contain" onError={() => setError("The source image could not be loaded. Close and try again.")} onLoad={(event) => {
            const next = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
            setSize(next);
            setCrop(initialCrop?.sourceUrl === sourceUrl ? initialCrop : squarePortraitCrop(sourceUrl, next, next.width * 0.3, next.height * 0.03, Math.min(next.width, next.height) * 0.4));
          }} />
          {crop && <div aria-hidden="true" className="pointer-events-none absolute border-2 border-violet-300 shadow-[0_0_0_999px_rgba(0,0,0,0.15)]" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }} />}
          {confirmHead && <>
            <div data-head-drag="move" aria-label="Head box; drag to move" className="absolute touch-none cursor-move border-2 border-amber-300" style={{ left: `${head.x * 100}%`, top: `${head.y * 100}%`, width: `${head.width * 100}%`, height: `${head.height * 100}%` }}>
              <span className="pointer-events-none absolute -top-5 left-0 bg-black/80 px-1 text-xs text-amber-200">Head</span>
              <span data-head-drag="resize" aria-label="Resize head box" className="absolute -bottom-2 -right-2 h-5 w-5 cursor-se-resize rounded-sm border border-black bg-amber-300" />
            </div>
            <div aria-label="Speech placement preview" className="pointer-events-none absolute left-[5%] w-[90%] rounded-xl border border-white/25 bg-black/85 px-3 py-2 text-center text-xs" style={{ top: `${Math.min(88, (head.y + head.height) * 100 + 3)}%` }}>Hello, I’m {name || "your character"}.</div>
          </>}
        </div>
      </div>
      <div className="space-y-5">
        <div className="mx-auto aspect-square w-40 overflow-hidden rounded-full border border-white/15 bg-black/30 relative" aria-label="Portrait crop preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- display the selected rectangle without another render */}
          {crop && <img alt={`${name} portrait preview`} src={sourceUrl} className="absolute max-w-none" style={{ width: `${100 / crop.width}%`, height: `${100 / crop.height}%`, left: `${-100 * crop.x / crop.width}%`, top: `${-100 * crop.y / crop.height}%` }} />}
        </div>
        {confirmHead && <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 text-sm font-medium text-amber-200">Head position</legend>
          <p className="text-xs text-white/55">{initialHead ? "Review the detected or previously selected position." : "No confirmed position yet. Move the suggested box around the entire head."} Drag the gold box and its corner, or use these keyboard-accessible controls.</p>
          {(["x", "y", "width", "height"] as const).map(key => <label key={key} className="block text-xs">{({ x: "Head horizontal position", y: "Head vertical position", width: "Head width", height: "Head height" })[key]}<input type="range" min={key === "x" || key === "y" ? 0 : .01} max={key === "x" ? 1 - head.width : key === "y" ? 1 - head.height : key === "width" ? 1 - head.x : 1 - head.y} step="0.001" value={head[key]} onInput={event => setHead({ ...head, [key]: Number(event.currentTarget.value) })} className="mt-1 w-full accent-amber-300" /></label>)}
        </fieldset>}
        {size && crop && <>
          <label className="block text-sm">Horizontal position<input aria-label="Horizontal position" type="range" min="0" max={Math.max(0, size.width - side)} step="1" value={crop.x * size.width} onInput={(e) => adjust(Number(e.currentTarget.value), crop.y * size.height, side)} disabled={busy} className="mt-2 w-full accent-violet-400" /></label>
          <label className="block text-sm">Vertical position<input aria-label="Vertical position" type="range" min="0" max={Math.max(0, size.height - side)} step="1" value={crop.y * size.height} onInput={(e) => adjust(crop.x * size.width, Number(e.currentTarget.value), side)} disabled={busy} className="mt-2 w-full accent-violet-400" /></label>
          <label className="block text-sm">Frame size<input aria-label="Frame size" type="range" min={Math.min(32, size.width, size.height)} max={Math.min(size.width, size.height)} step="1" value={side} onInput={(e) => { const next = Number(e.currentTarget.value); adjust(crop.x * size.width + (side - next) / 2, crop.y * size.height + (side - next) / 2, next); }} disabled={busy} className="mt-2 w-full accent-violet-400" /></label>
        </>}
        <p className="text-xs leading-5 text-white/45">Include hair and a little shoulder room. Cropping uses this image’s pixels and costs no generation allowance.</p>
        {!headFitsCrop && <p role="status" className="text-sm text-amber-200">Expand or move the violet portrait crop to include the entire gold head box.</p>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <button type="button" disabled={!crop || busy || !size || !headFitsCrop} onClick={() => void apply()} className="influence-button-primary w-full rounded-lg px-4 py-3 disabled:opacity-50">{busy ? "Exporting portrait…" : confirmHead ? "Confirm head and portrait" : "Use portrait in draft"}</button>
      </div>
    </div>
  </dialog>;
}
