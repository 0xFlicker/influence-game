"use client";

import { useEffect } from "react";

/** Sets document phase styling for the lobby-themed home hero. */
export function HomeLobbyPhase() {
  useEffect(() => {
    const root = document.documentElement;
    const previousPhase = root.dataset.phase;

    root.dataset.phase = "LOBBY";

    return () => {
      if (previousPhase) {
        root.dataset.phase = previousPhase;
      } else {
        delete root.dataset.phase;
      }
    };
  }, []);

  return null;
}
