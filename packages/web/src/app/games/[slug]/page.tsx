import { Nav } from "@/components/nav";
import { GameViewer } from "./game-viewer";
import { getGame, getGameTranscript, type GameDetail, type TranscriptEntry } from "@/lib/api";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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
  const sp = await searchParams;
  const mode = typeof sp.mode === "string" ? sp.mode : undefined;

  let initialGame: GameDetail | undefined;
  let initialMessages: TranscriptEntry[] | undefined;

  try {
    initialGame = await getGame(slug);
    if (initialGame.status === "completed" || initialGame.status === "cancelled") {
      initialMessages = await getGameTranscript(slug);
    }
  } catch {
    // API unavailable or game not found — client will handle it
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
          initialMessages={initialMessages}
          mode={mode}
        />
      </main>
    </div>
  );
}
