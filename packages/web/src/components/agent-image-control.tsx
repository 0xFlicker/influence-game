"use client";

import type { PersonaKey } from "@/lib/api";
import { AgentAvatarPreview } from "./agent-avatar-preview";

interface AgentImageControlProps {
  editLabel?: string;
  disabled?: boolean;
  onEdit?: () => void;
  currentUrl?: string | null;
  persona: PersonaKey;
  name: string;
  size?: "16" | "32";
  presentation?: "portrait" | "full-body";
}

export function AgentImageControl({ editLabel, disabled = false, onEdit, currentUrl, persona, name, size = "16", presentation = "portrait" }: AgentImageControlProps) {
  const displayUrl = currentUrl;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        {onEdit && displayUrl ? <button type="button" disabled={disabled} onClick={onEdit} aria-label={`Edit ${name || "Agent"} ${presentation === "full-body" ? "full-body image" : "portrait"}`} className="block rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400">
          {/* eslint-disable-next-line @next/next/no-img-element -- user-owned character image opens its crop editor */}
          <img src={displayUrl} alt={`${name || "Agent"} ${presentation}`} className={presentation === "full-body" ? "h-64 w-44 rounded-lg bg-black/20 object-contain" : "h-32 w-32 rounded-full object-cover"} />
        </button> : presentation === "full-body" ? (
          displayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- character reference, preserve entire framing
            <img src={displayUrl} alt={`${name || "Agent"} full-body reference`} className="h-64 w-44 rounded-lg bg-black/20 object-contain" />
          ) : <div className="flex h-64 w-44 items-center justify-center rounded-lg border border-white/15 p-4 text-center text-sm text-white/45">Generate a full-body reference with the assistant</div>
        ) : <AgentAvatarPreview
          avatarUrl={displayUrl}
          personaKey={persona}
          name={name}
          gamesPlayed={null}
          gamesWon={null}
          size={size}
        />}
      </div>

      {displayUrl && onEdit && <button
        type="button"
        onClick={onEdit}
        disabled={disabled}
        className="min-h-11 rounded-lg px-3 text-xs font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
      >
        {editLabel ?? "Adjust framing"}
      </button>}
    </div>
  );
}
