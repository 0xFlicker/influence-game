import { Nav } from "@/components/nav";
import { redirect } from "next/navigation";
import { GameViewer } from "./game-viewer";
import {
  getGame,
  type GameDetail,
} from "@/lib/api";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ mode?: string | string[] }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return {
    title: `${slug} — Influence`,
    description: "Watch this Influence game live or replay the transcript.",
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
    initialGame = await getGame(slug);
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
            {initialGame ? `Game #${initialGame.gameNumber}` : slug}
          </h1>
        </div>

        <GameViewer
          gameId={slug}
          initialGame={initialGame}
        />
      </main>
    </div>
  );
}
