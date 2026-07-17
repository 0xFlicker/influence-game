"use client";

import { useRef, useState } from "react";
import type { PublicPlayerIdentityRef } from "@/lib/api";
import { playerProfileHref } from "@/lib/player-profile-links";

export type PublicProfileShareFeedback = {
  tone: "success" | "neutral" | "error";
  message: string;
};

function isShareCancellation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
}

export async function sharePublicPlayerProfile({
  displayName,
  canonicalPath,
  origin,
  share,
  copy,
}: {
  displayName: string;
  canonicalPath: string;
  origin: string;
  share?: (data: ShareData) => Promise<void>;
  copy?: (url: string) => Promise<void>;
}): Promise<PublicProfileShareFeedback> {
  const url = new URL(canonicalPath, origin).toString();

  if (share) {
    try {
      await share({
        title: `${displayName} on Influence`,
        text: `View ${displayName}'s competitive profile on Influence.`,
        url,
      });
      return { tone: "success", message: "Share dialog opened." };
    } catch (error) {
      if (isShareCancellation(error)) {
        return { tone: "neutral", message: "Share cancelled." };
      }
    }
  }

  if (copy) {
    try {
      await copy(url);
      return { tone: "success", message: "Profile link copied." };
    } catch {
      // Browser capability failures stay generic on this public surface.
    }
  }

  return {
    tone: "error",
    message: "Unable to share this profile right now.",
  };
}

export function PublicProfileShareButton({
  identity,
}: {
  identity: PublicPlayerIdentityRef;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] =
    useState<PublicProfileShareFeedback | null>(null);
  const busyRef = useRef(false);
  const label = `Share ${identity.displayName} profile`;

  async function shareProfile(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFeedback(null);

    try {
      const nextFeedback = await sharePublicPlayerProfile({
        displayName: identity.displayName,
        canonicalPath: playerProfileHref(identity),
        origin: window.location.origin,
        share: typeof navigator.share === "function"
          ? (data) => navigator.share(data)
          : undefined,
        copy: navigator.clipboard?.writeText
          ? (url) => navigator.clipboard.writeText(url)
          : undefined,
      });
      setFeedback(nextFeedback);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-1 sm:items-end">
      <button
        type="button"
        aria-label={label}
        disabled={busy}
        onClick={() => void shareProfile()}
        className="influence-button-secondary inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-wait"
      >
        {busy ? "Sharing…" : "Share profile"}
      </button>
      <p
        role="status"
        aria-live="polite"
        className={`min-h-5 max-w-64 text-xs sm:text-right ${
          feedback?.tone === "error"
            ? "text-red-200/80"
            : feedback?.tone === "success"
              ? "text-emerald-200/80"
              : "influence-copy-muted"
        }`}
      >
        {feedback?.message ?? ""}
      </p>
    </div>
  );
}
