"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function ConfirmActionDialog({ title, children, confirmLabel, disabled = false, busy = false, danger = false, focusInput = false, showConfirm = true, onConfirm, onClose }: {
  title: string; children: ReactNode; confirmLabel: string; disabled?: boolean; busy?: boolean; danger?: boolean; focusInput?: boolean; showConfirm?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="fixed inset-0 m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-white/20 bg-neutral-950 p-6 text-white shadow-xl backdrop:bg-black/80">
    <h2 className="text-xl font-semibold">{title}</h2>
    <div className="mt-3 space-y-3 text-sm leading-6 text-white/75">{children}</div>
    <div className="mt-6 flex flex-wrap justify-end gap-3">
      <button type="button" autoFocus={!focusInput} disabled={busy} className="rounded border border-white/25 px-4 py-2" onClick={onClose}>Cancel</button>
      {showConfirm && <button type="button" disabled={disabled} className={`rounded px-4 py-2 font-medium disabled:opacity-50 ${danger ? "influence-button-danger" : "bg-indigo-600"}`} onClick={onConfirm}>{confirmLabel}</button>}
    </div>
  </dialog>;
}

export function TypedConfirmationDialog({ title, expected, confirmLabel, onConfirm, onClose }: {
  title: string; expected: string; confirmLabel: string;
  onConfirm: (confirmation: string) => Promise<void>; onClose: () => void;
}) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (pending || value !== expected) return;
    setPending(true);
    setError("");
    try { await onConfirm(value); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The action failed."); }
    finally { setPending(false); }
  }
  return <ConfirmActionDialog title={title} confirmLabel={pending ? "Deleting…" : confirmLabel}
    busy={pending} danger focusInput disabled={pending || value !== expected} onConfirm={() => void submit()} onClose={onClose}>
    <label htmlFor={inputId} className="block break-words">
      Type <strong className="text-white">{expected}</strong> to confirm.
    </label>
    <input id={inputId} autoComplete="off" spellCheck={false} autoFocus value={value} onChange={event => setValue(event.target.value)}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }}
      data-analytics-private disabled={pending}
      className="min-h-11 w-full rounded-lg border border-white/25 bg-neutral-900 px-3 text-white focus-visible:outline-2 focus-visible:outline-indigo-300" />
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </ConfirmActionDialog>;
}
