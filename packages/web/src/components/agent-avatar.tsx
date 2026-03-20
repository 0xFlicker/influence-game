"use client";

import Image from "next/image";

const PERSONA_AVATARS: ReadonlySet<string> = new Set([
  "honest", "strategic", "deceptive", "paranoid", "social",
  "aggressive", "loyalist", "observer", "diplomat", "wildcard",
]);

interface AgentAvatarProps {
  avatarUrl?: string | null;
  persona: string;
  name: string;
  /** Size in Tailwind units — maps to w-{size} h-{size}. Default 8. */
  size?: "6" | "8" | "10" | "12" | "16";
}

const SIZE_CLASSES: Record<string, { container: string; px: number }> = {
  "6": { container: "w-6 h-6", px: 24 },
  "8": { container: "w-8 h-8", px: 32 },
  "10": { container: "w-10 h-10", px: 40 },
  "12": { container: "w-12 h-12", px: 48 },
  "16": { container: "w-16 h-16", px: 64 },
};

function resolveAvatarUrl(avatarUrl: string | null | undefined, persona: string): string {
  if (avatarUrl) return avatarUrl;
  const key = PERSONA_AVATARS.has(persona) ? persona : "strategic";
  return `/avatars/personas/${key}.svg`;
}

export function AgentAvatar({ avatarUrl, persona, name, size = "8" }: AgentAvatarProps) {
  const s = SIZE_CLASSES[size] ?? SIZE_CLASSES["8"]!;
  const src = resolveAvatarUrl(avatarUrl, persona);

  return (
    <Image
      src={src}
      alt={name}
      width={s.px}
      height={s.px}
      className={`${s.container} rounded-full object-cover ring-1 ring-white/10`}
      unoptimized
    />
  );
}
