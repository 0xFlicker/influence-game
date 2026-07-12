"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PersonaKey } from "@/lib/api";
import { getPersonaLabel } from "@/lib/personas";
import { AgentAvatar, type AgentAvatarSize } from "./agent-avatar";

interface AgentAvatarPreviewProps {
  avatarUrl?: string | null;
  personaKey?: PersonaKey | null;
  name: string;
  gamesPlayed: number;
  gamesWon: number;
  size?: Exclude<AgentAvatarSize, "6" | "32">;
}

export function AgentAvatarPreview({
  avatarUrl,
  personaKey,
  name,
  gamesPlayed,
  gamesWon,
  size = "10",
}: AgentAvatarPreviewProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const previewId = useId();
  const winRate = gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0;
  const open = !dismissed && (hovered || focused || pinned);

  useEffect(() => {
    if (!pinned) return;

    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPinned(false);
        setDismissed(true);
      }
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPinned(false);
        setDismissed(true);
      }
    };

    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [pinned]);

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onMouseEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={`View ${name} portrait and stats`}
        aria-describedby={previewId}
        aria-expanded={open}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={() => {
          setFocused(false);
          setDismissed(false);
        }}
        onClick={() => {
          setPinned((current) => {
            setDismissed(current);
            return !current;
          });
        }}
        className="block rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <AgentAvatar
          avatarUrl={avatarUrl}
          personaKey={personaKey}
          persona={personaKey ?? "strategic"}
          name={name}
          size={size}
        />
      </button>

      <div
        id={previewId}
        role="tooltip"
        className={`influence-panel pointer-events-none absolute left-0 top-full z-50 mt-2 w-56 origin-top-left rounded-xl p-4 shadow-2xl transition duration-150 ${
          open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0"
        }`}
      >
        <div className="flex justify-center">
          <AgentAvatar
            avatarUrl={avatarUrl}
            personaKey={personaKey}
            persona={personaKey ?? "strategic"}
            name={name}
            size="32"
          />
        </div>
        <div className="mt-3 text-center">
          <p className="truncate text-sm font-semibold text-text-primary">{name}</p>
          <p className="influence-copy-muted mt-0.5 text-xs">{getPersonaLabel(personaKey)}</p>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-center">
          <Stat value={gamesPlayed} label={gamesPlayed === 1 ? "game" : "games"} />
          <Stat value={gamesWon} label={gamesWon === 1 ? "win" : "wins"} />
          <Stat value={`${winRate}%`} label="win rate" />
        </dl>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <dt className="influence-copy-muted text-[10px] uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-text-primary">{value}</dd>
    </div>
  );
}
