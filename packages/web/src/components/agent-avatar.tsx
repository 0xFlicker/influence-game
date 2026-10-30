"use client";

import Image from "next/image";
import {useState} from "react";
import { resolveApiUrl } from "@/lib/api";
import { getHousePortraitKey, HOUSE_PORTRAIT_KEYS } from "@influence/engine/house-personas";

const PERSONA_AVATARS: ReadonlySet<string> = new Set(HOUSE_PORTRAIT_KEYS);

interface AgentAvatarProps {
  avatarUrl?: string | null;
  personaKey?: string | null;
  persona: string;
  name: string;
  /** Size in Tailwind units — maps to w-{size} h-{size}. Default 8. */
  size?: AgentAvatarSize;
}

const SIZE_CLASSES = {
  "6":  { container: "w-6 h-6",   px: 24 },
  "8":  { container: "w-8 h-8",   px: 32 },
  "10": { container: "w-10 h-10", px: 40 },
  "12": { container: "w-12 h-12", px: 48 },
  "16": { container: "w-16 h-16", px: 64 },
  "32": { container: "w-32 h-32", px: 128 },
} as const;

export type AgentAvatarSize = keyof typeof SIZE_CLASSES;

function normalizePersonaKey(value: string | null | undefined): string | null {
  const key = value?.trim().toLowerCase();
  return key && PERSONA_AVATARS.has(key) ? key : null;
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
    getHousePortraitKey(name);
  return `/avatars/personas/${key}.png`;
}

export function AgentAvatar({ avatarUrl, personaKey, persona, name, size = "8" }: AgentAvatarProps) {
  const s = SIZE_CLASSES[size];
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const requested = resolveAgentAvatarUrl(avatarUrl, persona, name, personaKey);

  const src = failedSource === requested ? resolveAgentAvatarUrl(null, persona, name, personaKey) : requested;

  return (
    <div className={`relative ${s.container} shrink-0`}>
      <Image
        src={src}
        alt={name}
        width={s.px}
        height={s.px}
        className={`${s.container} rounded-full object-cover ring-1 ring-white/10`}
        onError={() => setFailedSource(requested)}
        unoptimized
      />
    </div>
  );
}
