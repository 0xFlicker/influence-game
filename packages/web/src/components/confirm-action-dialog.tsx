"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function ConfirmActionDialog({ title, children, confirmLabel, disabled = false, onConfirm, onClose }: {
  title: string; children: ReactNode; confirmLabel: string; disabled?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} aria-label={title} onCancel={onClose}
    className="fixed inset-0 m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-white/20 bg-neutral-950 p-6 text-white shadow-xl backdrop:bg-black/80">
    <h2 className="text-xl font-semibold">{title}</h2>
    <div className="mt-3 space-y-3 text-sm leading-6 text-white/75">{children}</div>
    <div className="mt-6 flex flex-wrap justify-end gap-3">
      <button type="button" autoFocus className="rounded border border-white/25 px-4 py-2" onClick={onClose}>Cancel</button>
      <button type="button" disabled={disabled} className="rounded bg-indigo-600 px-4 py-2 font-medium disabled:opacity-50" onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </dialog>;
}
