import { Nav } from "@/components/nav";
import { GameViewer } from "./game-viewer";
import {
  getGame,
  getGameReplayWatchFrames,
  getGameTranscript,
  type GameDetail,
  type GameWatchReplayFrame,
  type TranscriptEntry,
} from "@/lib/api";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ mode?: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return {
    title: `${slug} — Influence`,
    description: "Watch this Influence game live or replay the transcript.",
  };
}

function normalizeCompletedMode(value: string | undefined): "replay" | "results" | null {
  return value === "replay" || value === "results" ? value : null;
}

export default async function GameViewerPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const query = searchParams ? await searchParams : {};
  const completedMode = normalizeCompletedMode(query.mode);

  let initialGame: GameDetail | undefined;
  let initialMessages: TranscriptEntry[] | undefined;
  let initialReplayFrames: GameWatchReplayFrame[] | undefined;

  try {
    initialGame = await getGame(slug);
    if (
      (initialGame.status === "completed" || initialGame.status === "cancelled") &&
      completedMode === "replay"
    ) {
      [initialMessages, initialReplayFrames] = await Promise.all([
        getGameTranscript(slug),
        getGameReplayWatchFrames(slug),
      ]);
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
            {initialGame ? `Game #${initialGame.gameNumber}` : slug}
          </h1>
        </div>

        <GameViewer
          gameId={slug}
          completedMode={completedMode}
          initialGame={initialGame}
          initialMessages={initialMessages}
          initialReplayFrames={initialReplayFrames}
        />
      </main>
    </div>
  );
}
