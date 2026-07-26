"use client";

import {
  useRef,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

interface UpdateDiagramLightboxProps {
  anchorProps: AnchorHTMLAttributes<HTMLAnchorElement>;
  children: ReactNode;
  href: string;
}

export function centeredScrollLeft(scrollWidth: number, clientWidth: number) {
  return Math.max(0, (scrollWidth - clientWidth) / 2);
}

export function UpdateDiagramLightbox({
  anchorProps,
  children,
  href,
}: UpdateDiagramLightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  function openDialog(event: MouseEvent<HTMLAnchorElement>) {
    anchorProps.onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    if (!dialogRef.current?.open) dialogRef.current?.showModal();

    requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      scroller.scrollLeft = centeredScrollLeft(
        scroller.scrollWidth,
        scroller.clientWidth,
      );
    });
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) closeDialog();
  }

  const previewClassName = anchorProps.className
    ? `${anchorProps.className} group relative block max-w-full rounded-xl border border-white/10 bg-black/30 p-2 pt-12 shadow-panel`
    : "group relative block max-w-full rounded-xl border border-white/10 bg-black/30 p-2 pt-12 shadow-panel";

  return (
    <>
      <a
        {...anchorProps}
        href={href}
        className={previewClassName}
        aria-haspopup="dialog"
        onClick={openDialog}
      >
        {children}
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 grid size-9 place-items-center rounded-md border border-white/20 bg-black/75 text-white shadow-lg transition group-hover:border-cyan-100/50 group-hover:bg-black/90"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
          </svg>
        </span>
      </a>

      <dialog
        ref={dialogRef}
        aria-label="Full-size architecture diagram"
        className="m-auto h-[92dvh] w-[96vw] max-w-[80rem] overflow-hidden rounded-xl border border-white/15 bg-[#08090d] p-0 text-white shadow-2xl backdrop:bg-black/85"
        onClick={closeFromBackdrop}
      >
        <div className="flex h-full min-h-0 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
            <p className="text-sm font-semibold">Full-size diagram</p>
            <div className="flex items-center gap-3">
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-cyan-100/75 underline"
              >
                Open SVG
              </a>
              <button
                type="button"
                onClick={closeDialog}
                aria-label="Close full-size diagram"
                className="grid size-9 place-items-center rounded-md border border-white/15 text-xl leading-none text-white/80 hover:border-white/30 hover:text-white"
              >
                ×
              </button>
            </div>
          </header>
          <div
            ref={scrollerRef}
            className="min-h-0 flex-1 overflow-auto p-4 sm:p-6"
          >
            <div className="mx-auto min-w-[64rem] max-w-[80rem]">
              {children}
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
