import { Nav } from "@/components/nav";
import { getGame, type GameDetail } from "@/lib/api";
import { GameViewer } from "../game-viewer";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return {
    title: `Results: ${slug} — Influence`,
    description: "Inspect the final public results for this Influence game.",
  };
}

export default async function GameResultsPage({ params }: Props) {
  const { slug } = await params;
  let initialGame: GameDetail | undefined;

  try {
    initialGame = await getGame(slug);
  } catch (err) {
    console.error(`[GameResultsPage] SSR fetch failed for slug="${slug}":`, err);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Nav />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">
            {initialGame ? `Game #${initialGame.gameNumber}` : slug}
          </h1>
        </div>

        <GameViewer
          gameId={slug}
          completedMode="results"
          initialGame={initialGame}
        />
      </main>
    </div>
  );
}
