"use client";
import { HouseShareButton } from "@/components/house-share-button";
import { gameHref } from "@/lib/game-links";
import type { PublicPostgameMediaResponse } from "@/lib/api";
type ReadyPostgameMedia = Extract<PublicPostgameMediaResponse, { status: "ready" }>;

export function PostgameMediaPlayer({
  gameId,
  media,
}: {
  gameId: string;
  media: ReadyPostgameMedia;
}) {
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
        <HouseShareButton href={gameHref(gameId)} label="Share trailer" title={media.preview.title} text={media.preview.description} />
      </div>

      <video
        className="block aspect-video w-full bg-black"
        controls
        preload="metadata"
        crossOrigin="anonymous"
        playsInline
        poster={media.poster.url}
        aria-label={`${media.preview.title} trailer`}
      >
        <source src={media.video.url} type={media.video.contentType} />
        <track
          kind="captions"
          src={media.captions.url}
          srcLang={media.captions.language}
          label={media.captions.label}
        />
        Your browser does not support video playback.
      </video>


    </section>
  );
}
