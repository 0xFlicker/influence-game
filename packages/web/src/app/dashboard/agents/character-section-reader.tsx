"use client";

import { useEffect, useRef } from "react";

export function CharacterSectionReader({ title, text, editDisabled, onClose, onEdit }: {
  title: string; text: string; editDisabled: boolean; onClose: () => void; onEdit: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} aria-labelledby="character-section-title" onCancel={event => { event.preventDefault(); onClose(); }} className="m-0 h-[100dvh] max-h-[100dvh] w-screen max-w-none bg-[#11111b] p-0 text-white backdrop:bg-black/80">
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-8"><h2 id="character-section-title" className="text-xl font-semibold">{title}</h2><button type="button" onClick={onClose} className="min-h-11 px-3 text-sm text-white/65">Close</button></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8"><p className="mx-auto max-w-3xl whitespace-pre-wrap break-words text-lg leading-8 text-white/85">{text || "No details yet."}</p></div>
      <footer className="shrink-0 border-t border-white/10 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8"><button type="button" disabled={editDisabled} onClick={() => { dialog.current?.close(); onEdit(); }} className="influence-button-primary min-h-11 w-full rounded-xl px-4 py-3 sm:mx-auto sm:block sm:max-w-3xl">Edit {title}</button><p className="mt-2 text-center text-xs text-white/45">Add this section to your next message.</p></footer>
    </div>
  </dialog>;
}
