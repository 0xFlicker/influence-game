"use client";

import { useEffect, useRef, useState } from "react";
import { squarePortraitCrop, type PortraitCrop } from "@influence/engine/character-portrait";
import { apiFetch } from "@/lib/api";

/** Original image coordinates are the authority; the preview and exported pixels use the same rectangle. */
export function CharacterPortraitEditor({ sourceUrl, initialCrop, name, onApply, onClose, onPendingChange, onFailure }: {
  sourceUrl: string; initialCrop?: PortraitCrop | null; name: string;
  onApply: (value: { avatarUrl: string; portraitCrop: PortraitCrop }) => void;
  onClose: () => void; onPendingChange: (pending: boolean) => void; onFailure: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const epoch = useRef(0);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [crop, setCrop] = useState<PortraitCrop | null>(null);
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
      const result = await apiFetch<{ avatarUrl: string; portraitCrop: PortraitCrop }>("/api/agent-profiles/portrait-crop", {
        method: "POST", body: JSON.stringify(crop), signal: AbortSignal.timeout(30_000),
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
  const side = size && crop ? crop.width * size.width : 0;
  return <dialog ref={dialog} aria-labelledby="portrait-editor-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }} className="influence-modal m-auto w-[min(960px,95vw)] max-h-[90vh] overflow-auto rounded-2xl border border-white/15 bg-[#11111b] p-5 text-white backdrop:bg-black/80 sm:p-7">
    <div className="flex items-start justify-between gap-4"><div><h2 id="portrait-editor-title" className="text-xl font-semibold">Character images</h2><p className="mt-2 text-sm text-white/55">Frame {name || "your character"}’s face. The full-body original stays intact.</p></div><button type="button" disabled={busy} onClick={onClose} className="influence-button-secondary rounded-lg px-3 py-2">Close</button></div>
    <div className="mt-6 grid gap-6 sm:grid-cols-[minmax(0,1fr)_260px]">
      <div className="flex items-center justify-center rounded-xl bg-black/25 p-3">
        <div className="relative overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- original image coordinates are required for crop editing */}
          <img src={sourceUrl} alt={`${name} full image`} className="max-h-[55vh] w-auto max-w-full object-contain" onError={() => setError("The source image could not be loaded. Close and try again.")} onLoad={(event) => {
            const next = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
            setSize(next);
            setCrop(initialCrop?.sourceUrl === sourceUrl ? initialCrop : squarePortraitCrop(sourceUrl, next, next.width * 0.3, next.height * 0.03, Math.min(next.width, next.height) * 0.4));
          }} />
          {crop && <div aria-hidden="true" className="pointer-events-none absolute border-2 border-violet-300 shadow-[0_0_0_999px_rgba(0,0,0,0.15)]" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }} />}
        </div>
      </div>
      <div className="space-y-5">
        <div className="mx-auto aspect-square w-40 overflow-hidden rounded-full border border-white/15 bg-black/30 relative" aria-label="Portrait crop preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- display the selected rectangle without another render */}
          {crop && <img alt={`${name} portrait preview`} src={sourceUrl} className="absolute max-w-none" style={{ width: `${100 / crop.width}%`, height: `${100 / crop.height}%`, left: `${-100 * crop.x / crop.width}%`, top: `${-100 * crop.y / crop.height}%` }} />}
        </div>
        {size && crop && <>
          <label className="block text-sm">Horizontal position<input aria-label="Horizontal position" type="range" min="0" max={Math.max(0, size.width - side)} step="1" value={crop.x * size.width} onInput={(e) => adjust(Number(e.currentTarget.value), crop.y * size.height, side)} disabled={busy} className="mt-2 w-full accent-violet-400" /></label>
          <label className="block text-sm">Vertical position<input aria-label="Vertical position" type="range" min="0" max={Math.max(0, size.height - side)} step="1" value={crop.y * size.height} onInput={(e) => adjust(crop.x * size.width, Number(e.currentTarget.value), side)} disabled={busy} className="mt-2 w-full accent-violet-400" /></label>
          <label className="block text-sm">Frame size<input aria-label="Frame size" type="range" min={Math.min(32, size.width, size.height)} max={Math.min(size.width, size.height)} step="1" value={side} onInput={(e) => { const next = Number(e.currentTarget.value); adjust(crop.x * size.width + (side - next) / 2, crop.y * size.height + (side - next) / 2, next); }} disabled={busy} className="mt-2 w-full accent-violet-400" /></label>
        </>}
        <p className="text-xs leading-5 text-white/45">Include hair and a little shoulder room. Cropping uses this image’s pixels and costs no generation allowance.</p>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <button type="button" disabled={!crop || busy || !size} onClick={() => void apply()} className="influence-button-primary w-full rounded-lg px-4 py-3 disabled:opacity-50">{busy ? "Exporting portrait…" : "Use portrait in draft"}</button>
      </div>
    </div>
  </dialog>;
}
