"use client";

import { useId, useRef, useState } from "react";
import { createHouseShareLink } from "@/lib/house-share-link";
import { shareHouseLink } from "@/lib/share-link";

export function ShareIcon() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 15V3m-4 4 4-4 4 4M7 10H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" />
  </svg>;
}

export function HouseShareButton({ href, getHref, label = "Share", title = "The House", text, description }: {
  href?: string; getHref?: () => string; label?: string; title?: string; text?: string; description?: string;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const captured = useRef("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);

  async function prepare() {
    const generation = ++request.current;
    setUrl(""); setBusy(true); setFeedback(""); setFailed(false);
    try {
      const link = await createHouseShareLink(captured.current, window.location.origin);
      if (generation === request.current) setUrl(link);
    } catch (error) {
      if (generation === request.current) {
        setFailed(true); setFeedback(error instanceof Error ? error.message : "Couldn't create a share link. Try again.");
      }
    } finally { if (generation === request.current) setBusy(false); }
  }
  function open() {
    // Freeze the clock synchronously. Retrying must share this same captured moment.
    captured.current = getHref?.() ?? href ?? "/";
    dialog.current?.showModal();
    void prepare();
  }
  function close() { request.current++; dialog.current?.close(); }
  async function share() {
    const result = await shareHouseLink({ url, title, text: text ?? "", unavailableMessage: "Select the link above to copy it.",
      share: typeof navigator.share === "function" ? data => navigator.share(data) : undefined,
      copy: navigator.clipboard ? value => navigator.clipboard.writeText(value) : undefined });
    setFeedback(result.message);
  }
  return <>
    <button type="button" aria-label={label} title={label} onClick={open} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"><ShareIcon /></button>
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={() => { request.current++; }} className="m-auto w-[min(24rem,90vw)] rounded-xl border border-white/25 bg-zinc-950 p-5 text-white shadow-2xl backdrop:bg-black/60" onClick={event => event.stopPropagation()}>
      <div className="mb-3 flex items-center justify-between gap-4"><h2 id={titleId} className="font-semibold">{label}</h2><button type="button" aria-label="Close share" onClick={close}>✕</button></div>
      {description && <p className="mb-3 text-sm text-white/60">{description}</p>}
      {busy && <p role="status">Preparing link…</p>}
      {url && <>
        <input aria-label="House share link" readOnly value={url} onFocus={event => event.currentTarget.select()} className="w-full rounded border border-white/20 bg-black p-2 text-xs" />
        <div className="mt-3 flex items-center gap-3">
          {/* A fresh click preserves native-share user activation after the network request. */}
          <button type="button" aria-label="Share link" title="Share link" onClick={() => void share()} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/20"><ShareIcon /></button>
          <button type="button" className="min-h-11 rounded-lg border border-white/20 px-3 text-sm" onClick={async () => {
            try { await navigator.clipboard.writeText(url); setFeedback("Link copied."); }
            catch { setFeedback("Select the link above to copy it."); }
          }}>Copy link</button>
        </div>
      </>}
      {failed && <button type="button" onClick={() => void prepare()} className="mt-3 underline">Try again</button>}
      <p role="status" aria-live="polite" className="mt-2 text-xs text-white/70">{feedback}</p>
    </dialog>
  </>;
}
