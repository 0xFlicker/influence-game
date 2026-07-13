import { Nav } from "@/components/nav";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GameViewer } from "./game-viewer";
import {
  getGame,
  type GameDetail,
} from "@/lib/api";
import { gameHref } from "@/lib/game-links";
import { getServerPostgameMedia } from "@/lib/server-api";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ mode?: string | string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  try {
    const game = await getGame(slug);
    if (game.status === "completed") {
      const media = await getServerPostgameMedia(slug);
      if (media.status === "ready") {
        const title = `${media.preview.title} — Influence`;
        const description = media.preview.description;
        const image = {
          url: media.poster.url,
          alt: media.poster.altText,
        };
        return {
          title,
          description,
          alternates: { canonical: gameHref(slug) },
          openGraph: {
            title,
            description,
            type: "website",
            images: [image],
          },
          twitter: {
            card: "summary_large_image",
            title,
            description,
            images: [media.poster.url],
          },
        };
      }

      return completedGameFallbackMetadata(slug);
    }
  } catch (err) {
    console.error(`[GameViewerMetadata] postgame media SSR fetch failed for slug="${slug}":`, err);
  }

  return {
    title: `${slug} — Influence`,
    description: "Watch this Influence game live or replay the transcript.",
  };
}

function completedGameFallbackMetadata(slug: string): Metadata {
  return {
    title: "Completed Game — Influence",
    description: "Watch the spoiler-safe postgame entry for this completed Influence game.",
    alternates: { canonical: gameHref(slug) },
    openGraph: {
      title: "Completed Game — Influence",
      description: "Watch the spoiler-safe postgame entry for this completed Influence game.",
      type: "website",
    },
    twitter: {
      card: "summary",
      title: "Completed Game — Influence",
      description: "Watch the spoiler-safe postgame entry for this completed Influence game.",
    },
  };
}

export default async function GameViewerPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const mode = Array.isArray(resolvedSearchParams.mode)
    ? resolvedSearchParams.mode[0]
    : resolvedSearchParams.mode;

  if (mode === "results") {
    redirect(`/games/${encodeURIComponent(slug)}/results`);
  }
  if (mode === "replay") {
    redirect(`/games/${encodeURIComponent(slug)}/replay`);
  }

  let initialGame: GameDetail | undefined;
  let initialPostgameMedia: Awaited<ReturnType<typeof getServerPostgameMedia>> | undefined;

  try {
    initialGame = await getGame(slug);
    if (initialGame.status === "completed") {
      try {
        initialPostgameMedia = await getServerPostgameMedia(slug);
      } catch (err) {
        console.error(`[GameViewerPage] postgame media SSR fetch failed for slug="${slug}":`, err);
      }
    }
  } catch (err) {
    console.error(`[GameViewerPage] SSR fetch failed for slug="${slug}":`, err);
    // Client-side GameViewer will retry and show loadError if API remains unavailable
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 px-6 py-10 max-w-5xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">
            {initialGame?.slug ?? slug}
          </h1>
        </div>

        <GameViewer
          gameId={slug}
          initialGame={initialGame}
          initialPostgameMedia={initialPostgameMedia}
        />
      </main>
    </div>
  );
}
