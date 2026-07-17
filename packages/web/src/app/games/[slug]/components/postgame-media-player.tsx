"use client";

import { useState } from "react";
import { gameHref } from "@/lib/game-links";
import type { PublicPostgameMediaResponse } from "@/lib/api";

type ReadyPostgameMedia = Extract<PublicPostgameMediaResponse, { status: "ready" }>;

export type ShareFeedback = {
  tone: "success" | "neutral" | "error";
  message: string;
};

function isShareCancellation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
}

export function shareFeedbackClassName(feedback: ShareFeedback | null): string {
  if (feedback?.tone === "error") return "text-xs text-red-200/80";
  if (feedback?.tone === "success") return "text-xs text-emerald-200/80";
  return "text-xs text-white/45";
}

export async function sharePostgameTrailer({
  gameId,
  origin,
  title,
  text,
  share,
  copy,
}: {
  gameId: string;
  origin: string;
  title: string;
  text: string;
  share?: (data: ShareData) => Promise<void>;
  copy?: (url: string) => Promise<void>;
}): Promise<ShareFeedback> {
  return sharePostgameLink({
    href: gameHref(gameId),
    origin,
    title,
    text,
    unavailableMessage: "Unable to share this trailer right now.",
    share,
    copy,
  });
}

export async function sharePostgameLink({
  href,
  origin,
  title,
  text,
  unavailableMessage,
  share,
  copy,
}: {
  href: string;
  origin: string;
  title: string;
  text: string;
  unavailableMessage: string;
  share?: (data: ShareData) => Promise<void>;
  copy?: (url: string) => Promise<void>;
}): Promise<ShareFeedback> {
  const url = new URL(href, origin).toString();

  if (share) {
    try {
      await share({ title, text, url });
      return { tone: "success", message: "Share dialog opened." };
    } catch (error) {
      if (isShareCancellation(error)) {
        return { tone: "neutral", message: "Share cancelled." };
      }
      // Copying the canonical page is a useful fallback when native sharing fails.
    }
  }

  if (copy) {
    try {
      await copy(url);
      return { tone: "success", message: "Share link copied." };
    } catch {
      // The public player deliberately keeps platform errors out of the UI.
    }
  }

  return { tone: "error", message: unavailableMessage };
}

export function usePostgameShare({
  href,
  title,
  text,
  unavailableMessage,
}: {
  href: string;
  title: string;
  text: string;
  unavailableMessage: string;
}) {
  const [feedback, setFeedback] = useState<ShareFeedback | null>(null);

  async function shareLink(): Promise<void> {
    const result = await sharePostgameLink({
      href,
      origin: window.location.origin,
      title,
      text,
      unavailableMessage,
      share: typeof navigator.share === "function"
        ? (data) => navigator.share(data)
        : undefined,
      copy: navigator.clipboard?.writeText
        ? (url) => navigator.clipboard.writeText(url)
        : undefined,
    });
    setFeedback(result);
  }

  return { feedback, shareLink };
}

export function usePostgameTrailerShare({
  gameId,
  title,
  text,
}: {
  gameId: string;
  title: string;
  text: string;
}) {
  const { feedback, shareLink } = usePostgameShare({
    href: gameHref(gameId),
    title,
    text,
    unavailableMessage: "Unable to share this trailer right now.",
  });
  return { feedback, shareTrailer: shareLink };
}

export function PostgameMediaPlayer({
  gameId,
  media,
}: {
  gameId: string;
  media: ReadyPostgameMedia;
}) {
  const { feedback, shareTrailer } = usePostgameTrailerShare({
    gameId,
    title: media.preview.title,
    text: media.preview.description,
  });

  return (
    <section
      className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]"
      aria-labelledby="postgame-trailer-title"
      data-testid="postgame-media-player"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/35">
            House Highlights trailer
          </div>
          <h2 id="postgame-trailer-title" className="mt-1 text-lg font-semibold text-white">
            {media.preview.title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-white/55">
            {media.preview.description}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void shareTrailer()}
          className="min-h-11 shrink-0 rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phase/60"
          aria-label="Share trailer"
        >
          Share trailer
        </button>
      </div>

      <video
        className="block aspect-video w-full bg-black"
        controls
        preload="metadata"
        poster={media.poster.url}
        aria-label={`${media.preview.title} trailer`}
      >
        <source src={media.video.url} type={media.video.contentType} />
        <track
          kind="captions"
          src={media.captions.url}
          srcLang={media.captions.language}
          label={media.captions.label}
          default
        />
        Your browser does not support video playback.
      </video>

      <div className="min-h-8 px-4 py-2 sm:px-5">
        <p
          className={shareFeedbackClassName(feedback)}
          role="status"
          aria-live="polite"
        >
          {feedback?.message ?? ""}
        </p>
      </div>
    </section>
  );
}
