import { Nav } from "@/components/nav";
import { GameViewer } from "./game-viewer";
import { getGame, getGameTranscript, type GameDetail, type TranscriptEntry } from "@/lib/api";

interface Props {
  params: { id: string };
}

export async function generateMetadata({ params }: Props) {
  return {
    title: `Game #${params.id} — Influence`,
    description: "Watch this Influence game live or replay the transcript.",
  };
}

export default async function GameViewerPage({ params }: Props) {
  // Server-side fetch for initial render. Falls back gracefully if API is unavailable.
  let initialGame: GameDetail | undefined;
  let initialMessages: TranscriptEntry[] | undefined;

  try {
    initialGame = await getGame(params.id);
    if (initialGame.status === "completed" || initialGame.status === "cancelled") {
      initialMessages = await getGameTranscript(params.id);
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
            {initialGame ? `Game #${initialGame.gameNumber}` : `Game ${params.id}`}
          </h1>
          <p className="text-white/40 text-sm mt-1">
            Observer view — no sign-in required
          </p>
        </div>

        <GameViewer
          gameId={params.id}
          initialGame={initialGame}
          initialMessages={initialMessages}
        />
      </main>
    </div>
  );
}
