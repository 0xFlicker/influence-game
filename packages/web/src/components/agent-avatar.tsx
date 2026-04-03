"use client";

import Image from "next/image";
import { PERSONAS } from "@/lib/personas";

const PERSONA_AVATARS: ReadonlySet<string> = new Set([
  "honest", "strategic", "deceptive", "paranoid", "social",
  "aggressive", "loyalist", "observer", "diplomat", "wildcard",
  "contrarian", "provocateur", "martyr",
]);

interface AgentAvatarProps {
  avatarUrl?: string | null;
  persona: string;
  name: string;
  /** Size in Tailwind units — maps to w-{size} h-{size}. Default 8. */
  size?: "6" | "8" | "10" | "12" | "16";
  /** Hide the persona badge overlay. Default false. */
  hideBadge?: boolean;
}

const SIZE_CLASSES: Record<string, { container: string; px: number; badge: string; badgeText: string }> = {
  "6":  { container: "w-6 h-6",   px: 24, badge: "w-3 h-3 -bottom-0.5 -right-0.5",   badgeText: "text-[8px]" },
  "8":  { container: "w-8 h-8",   px: 32, badge: "w-4 h-4 -bottom-0.5 -right-0.5",   badgeText: "text-[10px]" },
  "10": { container: "w-10 h-10", px: 40, badge: "w-5 h-5 -bottom-0.5 -right-0.5",   badgeText: "text-xs" },
  "12": { container: "w-12 h-12", px: 48, badge: "w-6 h-6 -bottom-0.5 -right-0.5",   badgeText: "text-sm" },
  "16": { container: "w-16 h-16", px: 64, badge: "w-7 h-7 -bottom-0.5 -right-0.5",   badgeText: "text-base" },
};

function resolveAvatarUrl(avatarUrl: string | null | undefined, persona: string): string {
  if (avatarUrl) return avatarUrl;
  const key = PERSONA_AVATARS.has(persona) ? persona : "strategic";
  return `/avatars/personas/${key}.svg`;
}

function getPersonaEmoji(persona: string): string | null {
  const p = PERSONAS.find((x) => x.key === persona);
  return p?.icon ?? null;
}

export function AgentAvatar({ avatarUrl, persona, name, size = "8", hideBadge }: AgentAvatarProps) {
  const s = SIZE_CLASSES[size] ?? SIZE_CLASSES["8"]!;
  const src = resolveAvatarUrl(avatarUrl, persona);
  const emoji = getPersonaEmoji(persona);

  return (
    <div className={`relative ${s.container} shrink-0`}>
      <Image
        src={src}
        alt={name}
        width={s.px}
        height={s.px}
        className={`${s.container} rounded-full object-cover ring-1 ring-white/10`}
        unoptimized
      />
      {!hideBadge && emoji && (
        <span
          className={`absolute ${s.badge} rounded-full bg-black/80 ring-1 ring-white/20 flex items-center justify-center ${s.badgeText} leading-none`}
          title={persona}
        >
          {emoji}
        </span>
      )}
    </div>
  );
}
