import { Nav } from "@/components/nav";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EpisodeLanding } from "../episode-landing";
import type { GameDetail } from "@/lib/api";
import { gameHref } from "@/lib/game-links";
import {
  getServerGame,
  getServerPostgameMedia,
} from "@/lib/server-api";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ mode?: string | string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  try {
    const game = await getServerGame(slug);
    if (game.status === "completed") {
      const media = await getServerPostgameMedia(slug);
      if (media.status === "ready") {
        const title = `${game.episode?.title ?? media.preview.title} — Influence`;
        const description = game.episode?.description ?? media.preview.description;
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

      if (!game.episode || game.episode.title === game.slug) return completedGameFallbackMetadata(slug);
    }
    if (game.episode && game.episode.title !== game.slug) {
      return { title: `${game.episode.title} — Influence`, description: game.episode.description, alternates: { canonical: gameHref(slug) } };
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

  try {
    initialGame = await getServerGame(slug);
  } catch (err) {
    console.error(`[GameViewerPage] SSR fetch failed for slug="${slug}":`, err);
    // Client-side EpisodeLanding will retry and show loadError if API remains unavailable
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 px-6 py-10 max-w-5xl mx-auto w-full">
        <EpisodeLanding slug={slug} initialGame={initialGame} />
      </main>
    </div>
  );
}
