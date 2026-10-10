"use client";
import { useEffect } from "react";
interface Commands { toggle(): void; advance(): void; back(): void; previousChapter(): void; nextChapter(): void; speed(value: number): void; interact?(): void }
/** One command owner per mounted player; controls and editable regions keep their keys. */
export function useWatchKeyboard(commands: Commands) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof Element && event.target.closest("input,textarea,select,button,a,summary,[contenteditable=true],[role=dialog],[role=slider]")) return;
      const action = event.key === " " ? commands.toggle : event.key === "Enter" || event.key === "ArrowRight" ? commands.advance : event.key === "ArrowLeft" ? commands.back : event.key === "[" ? commands.previousChapter : event.key === "]" ? commands.nextChapter : null;
      if (action) { event.preventDefault(); commands.interact?.(); action(); }
      else if (/^[1-4]$/.test(event.key)) { event.preventDefault(); commands.speed([0.5, 1, 2, 4][Number(event.key) - 1]!); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commands]);
}
