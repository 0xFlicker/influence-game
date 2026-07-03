"use client";

import Image from "next/image";
import { resolveApiUrl } from "@/lib/api";
import { PERSONAS } from "@/lib/personas";

const PERSONA_AVATAR_KEYS = [
  "honest", "strategic", "deceptive", "paranoid", "social",
  "aggressive", "loyalist", "observer", "diplomat", "wildcard",
  "contrarian", "provocateur", "martyr",
] as const;

const PERSONA_AVATARS: ReadonlySet<string> = new Set(PERSONA_AVATAR_KEYS);

interface AgentAvatarProps {
  avatarUrl?: string | null;
  personaKey?: string | null;
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

function normalizePersonaKey(value: string | null | undefined): string | null {
  const key = value?.trim().toLowerCase();
  return key && PERSONA_AVATARS.has(key) ? key : null;
}

function fallbackPersonaKey(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return PERSONA_AVATAR_KEYS[hash % PERSONA_AVATAR_KEYS.length] ?? "strategic";
}

function normalizeUploadedAvatarUrl(avatarUrl: string): string {
  const trimmed = avatarUrl.trim();
  if (trimmed.startsWith("/api/")) {
    return resolveApiUrl(trimmed);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (
      normalized.startsWith("x-amz-")
      || normalized === "expires"
      || normalized === "signature"
    ) {
      const stablePublicUrl = pathStyleS3PublicAvatarUrl(url);
      if (stablePublicUrl) return stablePublicUrl;

      url.search = "";
      url.hash = "";
      return url.toString();
    }
  }

  return trimmed;
}

function pathStyleS3PublicAvatarUrl(url: URL): string | null {
  const [bucket, ...keyParts] = url.pathname.split("/").filter(Boolean);
  if (!bucket || keyParts[0] !== "pfp") return null;
  return `https://${bucket}.${url.host}/${keyParts.join("/")}`;
}

export function resolveAgentAvatarUrl(
  avatarUrl: string | null | undefined,
  persona: string,
  name: string,
  personaKey?: string | null,
): string {
  if (avatarUrl) return normalizeUploadedAvatarUrl(avatarUrl);
  const key =
    normalizePersonaKey(personaKey) ??
    normalizePersonaKey(persona) ??
    fallbackPersonaKey(name);
  return `/avatars/personas/${key}.png`;
}

function getPersonaBadge(persona: string, personaKey?: string | null): { icon: string; title: string } | null {
  const key = normalizePersonaKey(personaKey) ?? normalizePersonaKey(persona);
  if (!key) return null;
  const p = PERSONAS.find((x) => x.key === key);
  return p ? { icon: p.icon, title: `${formatPersonaKey(key)} archetype` } : null;
}

function formatPersonaKey(key: string): string {
  return key
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function AgentAvatar({ avatarUrl, personaKey, persona, name, size = "8", hideBadge }: AgentAvatarProps) {
  const s = SIZE_CLASSES[size] ?? SIZE_CLASSES["8"]!;
  const src = resolveAgentAvatarUrl(avatarUrl, persona, name, personaKey);
  const badge = getPersonaBadge(persona, personaKey);

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
      {!hideBadge && badge && (
        <span
          className={`absolute ${s.badge} rounded-full bg-black/80 ring-1 ring-white/20 flex items-center justify-center ${s.badgeText} leading-none`}
          title={badge.title}
        >
          {badge.icon}
        </span>
      )}
    </div>
  );
}
