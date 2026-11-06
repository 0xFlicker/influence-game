"use client";

import {useEffect, useRef} from "react";
import {formatPresentationMetadata, type LaunchFormatId} from "@influence/engine/format-presentation-metadata";

/** Interactive viewer chrome; movies show the timed rules reveal instead. */
export function FormatRulesDialog({formatId, onClose}: {formatId: LaunchFormatId; onClose: () => void}) {
  const close = useRef<HTMLButtonElement>(null);
  const metadata = formatPresentationMetadata(formatId);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {event.preventDefault(); event.stopPropagation(); onClose();}
      else if (event.key === "Tab") {event.preventDefault(); close.current?.focus();}
    };
    document.addEventListener("keydown", handleKey, true);
    return () => {document.removeEventListener("keydown", handleKey, true); previous?.focus();};
  }, [onClose]);
  return <div data-replay-controls className="absolute inset-0 z-[100] flex items-center justify-center bg-black/75 p-3" onClick={event => {event.stopPropagation(); if (event.target === event.currentTarget) onClose();}}>
    <section role="dialog" aria-modal="true" aria-labelledby="active-format-rules-title" className="w-full max-w-lg rounded-xl border border-cyan-200/50 bg-slate-950 p-3 text-white shadow-2xl sm:p-4">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-widest text-cyan-100/70">Current format</p>
        <h2 id="active-format-rules-title" className="text-base font-semibold">{metadata.displayName}</h2></div>
        <button ref={close} type="button" aria-label="Close format rules" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded border border-white/30 text-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-100">×</button></div>
      <p className="mt-2 text-sm leading-5 text-white/90">{metadata.conciseRules}</p>
      <p className="sr-only">Playback is paused. Resume when ready.</p>
    </section>
  </div>;
}
