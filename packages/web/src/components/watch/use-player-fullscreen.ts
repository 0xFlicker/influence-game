"use client";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Fullscreen the existing element: never portal or remount the director. */
export function usePlayerFullscreen(frame: RefObject<HTMLElement | null>) {
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const fallback = useRef(false);
  const exit = useCallback(async () => {
    try {
      if (document.fullscreenElement === frame.current) await document.exitFullscreen();
      if (fallback.current) {
        const element = frame.current;
        if (element?.hasAttribute("popover")) element.hidePopover();
        element?.removeAttribute("popover");
        fallback.current = false;
      }
      setFullscreen(false);
      button.current?.focus();
    } catch { setError("Could not exit fullscreen. Press Escape to return."); }
  }, [frame]);
  const enter = useCallback(async () => {
    const element = frame.current;
    if (!element) return;
    setError(null);
    if (element.requestFullscreen && document.fullscreenEnabled !== false) {
      try { await element.requestFullscreen(); setFullscreen(true); return; }
      catch (cause) { console.info("Native fullscreen unavailable; using viewport fullscreen.", cause); }
    }
    fallback.current = true;
    // A manual popover uses the top layer, escaping filtered theater ancestors.
    if (element.showPopover) {
      try { element.setAttribute("popover", "manual"); element.showPopover(); }
      catch (cause) { element.removeAttribute("popover"); console.warn("Top-layer fullscreen unavailable; using fixed viewport.", cause); }
    }
    setFullscreen(true);
  }, [frame]);
  useEffect(() => {
    const change = () => {
      if (fallback.current) return;
      const active = document.fullscreenElement === frame.current;
      setFullscreen(active);
      if (!active) button.current?.focus();
    };
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, [frame]);
  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const restore: Array<() => void> = [];
    if (fallback.current) {
      let branch: HTMLElement | null = frame.current;
      while (branch?.parentElement) {
        for (const sibling of Array.from(branch.parentElement.children)) {
          if (sibling instanceof HTMLElement && sibling !== branch) {
            const inert = sibling.inert;
            sibling.inert = true;
            restore.push(() => { sibling.inert = inert; });
          }
        }
        branch = branch.parentElement;
        if (!frame.current?.hasAttribute("popover")) {
          const ancestor = branch;
          const style = ancestor.style.cssText;
          for (const property of ["transform", "filter", "backdrop-filter", "perspective", "contain", "will-change"]) ancestor.style.setProperty(property, "none", "important");
          restore.push(() => { ancestor.style.cssText = style; });
        }
      }
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); void exit(); }
      if (event.key === "Tab") {
        const controls = Array.from(frame.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input') ?? []).filter((node) => node.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { restore.reverse().forEach((reset) => reset()); document.body.style.overflow = previous; document.removeEventListener("keydown", key); };
  }, [fullscreen, exit, frame]);
  return { fullscreen, button, error, toggle: () => fullscreen ? exit() : enter() };
}
