import type { ReactNode } from "react";
import Link from "next/link";
import type { PublicPlayerIdentityRef } from "@/lib/api";

const PUBLIC_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/;

export function PlayerProfileLink({
  player,
  children,
  className,
}: {
  player?: PublicPlayerIdentityRef | null;
  children: ReactNode;
  className?: string;
}) {
  const identifier = publicPlayerIdentifier(player);
  if (!identifier) {
    return <span className={className}>{children}</span>;
  }

  return (
    <Link
      href={`/profile/${encodeURIComponent(identifier)}`}
      className={className}
    >
      {children}
    </Link>
  );
}

function publicPlayerIdentifier(
  player: PublicPlayerIdentityRef | null | undefined,
): string | null {
  if (!player || player.displayName.trim().toLowerCase() === "anonymous") {
    return null;
  }
  if (
    player.handle
    && player.handle.length >= 3
    && player.handle.length <= 30
    && HANDLE_PATTERN.test(player.handle)
  ) {
    return player.handle;
  }
  return PUBLIC_ID_PATTERN.test(player.publicId) ? player.publicId : null;
}
