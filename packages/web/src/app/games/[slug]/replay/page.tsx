import { Nav } from "@/components/nav";
import type {
  GameDetail,
  GameWatchReplayFrame,
  TranscriptEntry,
} from "@/lib/api";
import {
  getServerGame,
  getServerGameReplayWatchFrames,
  getServerGameTranscript,
} from "@/lib/server-api";
import { GameViewer } from "../game-viewer";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return {
    title: `Replay: ${slug} — Influence`,
    description: "Watch the public replay for this completed Influence game.",
  };
}

export default async function GameReplayPage({ params }: Props) {
  const { slug } = await params;
  let initialGame: GameDetail | undefined;
  let initialMessages: TranscriptEntry[] | undefined;
  let initialReplayFrames: GameWatchReplayFrame[] | undefined;

  try {
    initialGame = await getServerGame(slug);
    if (initialGame.status === "completed" || initialGame.status === "cancelled") {
      [initialMessages, initialReplayFrames] = await Promise.all([
        getServerGameTranscript(slug),
        getServerGameReplayWatchFrames(slug),
      ]);
    }
  } catch (err) {
    console.error(`[GameReplayPage] SSR fetch failed for slug="${slug}":`, err);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Nav />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">
            {initialGame?.slug ?? slug}
          </h1>
        </div>

        <GameViewer
          gameId={slug}
          completedMode="replay"
          initialGame={initialGame}
          initialMessages={initialMessages}
          initialReplayFrames={initialReplayFrames}
        />
      </main>
    </div>
  );
}
