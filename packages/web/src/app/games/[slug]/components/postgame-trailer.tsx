"use client";

import { useEffect, useState } from "react";
import { getPostgameMedia, type PublicPostgameMediaResponse } from "@/lib/api";
import { PostgameMediaPlayer } from "./postgame-media-player";

/** Shared optional trailer surface. Publication can arrive while the game entry is open. */
export function PostgameTrailer({ gameId, initialMedia }: { gameId: string; initialMedia?: PublicPostgameMediaResponse }) {
  const [media, setMedia] = useState(initialMedia);
  const [loading, setLoading] = useState(initialMedia === undefined);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const response = await getPostgameMedia(gameId);
        if (cancelled) return;
        setMedia(response); setFailed(false);
        if (response.status !== "ready" && response.status !== "failed" && response.status !== "waiting_music") timer = setTimeout(refresh, 10_000);
      } catch {
        if (!cancelled) setFailed(true);
      } finally { if (!cancelled) setLoading(false); }
    }
    if (initialMedia?.status !== "ready" || retry > 0) void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [gameId, initialMedia, retry]);
  if (media?.status === "ready") return <PostgameMediaPlayer gameId={gameId} media={media} />;
  return <>
    {media && !failed ? <PostgameMediaState status={media.status} /> : <PostgameMediaUnavailable loading={loading} />}
    {failed && <button className="mt-2 text-sm underline" onClick={() => { setLoading(true); setFailed(false); setRetry(value => value + 1); }}>Check again</button>}
  </>;
}

export function postgameMediaStateCopy(
  status: Exclude<PublicPostgameMediaResponse["status"], "ready">,
): { title: string; description: string } {
  switch (status) {
    case "queued":
    case "rendering":
      return {
        title: "Trailer in preparation",
        description: "The House is preparing this completed game's trailer.",
      };
    case "failed":
      return {
        title: "Trailer unavailable",
        description: "This completed game's trailer is not available right now.",
      };
    case "not_requested":
    case "waiting_inputs":
    case "waiting_music":
      return {
        title: "Trailer not available yet",
        description: "The House has not published a trailer for this completed game.",
      };
  }
}

function PostgameMediaState({
  status,
}: {
  status: Exclude<PublicPostgameMediaResponse["status"], "ready">;
}) {
  const copy = postgameMediaStateCopy(status);
  return (
    <section
      className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-4 sm:px-5"
      aria-labelledby="postgame-media-state-title"
      data-testid={`postgame-media-state-${status}`}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/35">House Highlights trailer</div>
      <h3 id="postgame-media-state-title" className="mt-1 text-base font-semibold text-white">{copy.title}</h3>
      <p className="mt-1 text-sm leading-6 text-white/55">{copy.description}</p>
    </section>
  );
}

function PostgameMediaUnavailable({ loading }: { loading: boolean }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-4 sm:px-5" aria-live="polite">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/35">House Highlights trailer</div>
      <h3 className="mt-1 text-base font-semibold text-white">
        {loading ? "Checking trailer availability" : "Trailer availability unavailable"}
      </h3>
      <p className="mt-1 text-sm leading-6 text-white/55">
        Browse the completed game while the trailer status is unavailable.
      </p>
    </section>
  );
}
