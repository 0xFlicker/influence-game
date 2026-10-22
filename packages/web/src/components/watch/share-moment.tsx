"use client";
import {useId, useRef, useState} from "react";

/** Capture the clock in the click handler, before opening the system share sheet. */
export function ShareMoment({href, getHref}: {href?:string; getHref?:()=>string}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [url,setUrl] = useState("");
  const [feedback,setFeedback] = useState("");
  const pending = useRef(false);
  async function share() {
    if (pending.current) return;
    pending.current = true;
    const link = new URL(getHref?.() ?? href ?? "", window.location.origin).href;
    setUrl(link); setFeedback("");
    try {
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({title:"A moment in the House", text:"Watch from this moment.", url:link});
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
        }
      }
      dialog.current?.showModal();
    } finally { pending.current = false; }
  }
  return <>
    <button type="button" title="Share this moment" onClick={() => void share()} className="inline-flex h-10 shrink-0 items-center rounded-lg px-2 text-xs text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white">Share</button>
    <dialog ref={dialog} aria-labelledby={titleId} className="m-auto w-[min(24rem,90vw)] rounded-xl border border-white/25 bg-zinc-950 p-5 text-white shadow-2xl backdrop:bg-black/60" onClick={event => event.stopPropagation()}>
      <div className="mb-3 flex items-center justify-between gap-4"><h2 id={titleId} className="font-semibold">Share this moment</h2><button type="button" aria-label="Close share" onClick={() => dialog.current?.close()}>✕</button></div>
      <p className="mb-3 text-sm text-white/60">Starts here, with your playback settings.</p>
      <input aria-label="Replay share link" readOnly value={url} onFocus={event => event.currentTarget.select()} className="w-full rounded border border-white/20 bg-black p-2 text-xs" />
      <button type="button" className="mt-3 rounded-lg border border-white/20 px-3 py-2 text-sm" onClick={async () => {
        try { await navigator.clipboard.writeText(url); setFeedback("Link copied."); }
        catch { setFeedback("Select the link above to copy it."); }
      }}>Copy link</button>
      <p role="status" className="mt-2 text-xs text-white/70">{feedback}</p>
    </dialog>
  </>;
}
