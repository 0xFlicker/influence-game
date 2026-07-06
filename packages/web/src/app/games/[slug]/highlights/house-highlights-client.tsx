"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getPostgameHighlights,
  type HouseHighlightsResponse,
} from "@/lib/api";
import { gameHref } from "@/lib/game-links";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { HouseHighlightsView } from "../components/house-highlights-view";

type HighlightsLoadState =
  | { status: "loading" }
  | { status: "loaded"; requestKey: string; response: HouseHighlightsResponse }
  | { status: "error"; requestKey: string; error: string };

export function HouseHighlightsClient({ gameSlug }: { gameSlug: string }) {
  const runtimeConfig = useRuntimeConfig();
  const requestKey = `${runtimeConfig.API_URL}:${gameSlug}`;
  const [loadState, setLoadState] = useState<HighlightsLoadState>({
    status: "loading",
  });

  useEffect(() => {
    if (!runtimeConfig.ready) return;

    let cancelled = false;

    getPostgameHighlights(gameSlug)
      .then((response) => {
        if (cancelled) return;
        setLoadState({ status: "loaded", requestKey, response });
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState({
          status: "error",
          requestKey,
          error:
            error instanceof Error
              ? error.message
              : "Highlights are unavailable for this game.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [gameSlug, requestKey, runtimeConfig.ready]);

  const visibleLoadState =
    loadState.status !== "loading" && loadState.requestKey === requestKey
      ? loadState
      : { status: "loading" as const };

  if (visibleLoadState.status === "loaded") {
    const loadedGameSlug =
      visibleLoadState.response.game.slug ?? visibleLoadState.response.game.id;

    return (
      <HouseHighlightsView
        response={visibleLoadState.response}
        gameSlug={loadedGameSlug}
      />
    );
  }

  if (visibleLoadState.status === "error") {
    return (
      <HighlightsStateCard
        tone="error"
        title="The House could not open this cut."
        message={visibleLoadState.error}
        gameSlug={gameSlug}
      />
    );
  }

  return (
    <HighlightsStateCard
      tone="loading"
      title="Opening House Highlights..."
      message="The House is loading the receipt trail."
      gameSlug={gameSlug}
    />
  );
}

function HighlightsStateCard({
  tone,
  title,
  message,
  gameSlug,
}: {
  tone: "loading" | "error";
  title: string;
  message: string;
  gameSlug: string;
}) {
  const toneClass =
    tone === "error"
      ? "border-red-300/20 bg-red-950/20"
      : "border-white/10 bg-white/[0.04]";
  const eyebrowClass =
    tone === "error" ? "text-red-100/55" : "text-white/35";

  return (
    <section className="flex min-h-[70vh] flex-col justify-center text-center">
      <div className={`rounded-lg border p-6 ${toneClass}`}>
        <div className={`text-xs font-semibold uppercase ${eyebrowClass}`}>
          House Highlights
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-white">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">{message}</p>
        {tone === "error" ? (
          <div className="mt-5 flex justify-center">
            <Link
              href={gameHref(gameSlug)}
              className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/[0.1]"
            >
              Back to game
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}
