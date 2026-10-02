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

export async function loadReplayPageData(slug: string): Promise<{
  initialGame: GameDetail | undefined;
  initialMessages: TranscriptEntry[] | undefined;
  initialReplayFrames: GameWatchReplayFrame[] | undefined;
}> {
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

  return { initialGame, initialMessages, initialReplayFrames };
}
