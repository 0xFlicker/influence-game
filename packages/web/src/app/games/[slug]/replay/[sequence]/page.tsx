import { parseReplaySequenceParam } from "@/lib/game-links";
import { loadReplayPageData, ReplayPageShell } from "../replay-page";

interface Props {
  params: Promise<{ slug: string; sequence: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { slug, sequence } = await params;
  const startSequence = parseReplaySequenceParam(sequence);
  if (startSequence === undefined) {
    return {
      title: `Replay: ${slug} — Influence`,
      description: "Watch the public replay for this completed Influence game.",
    };
  }
  return {
    title: `Replay @ ${startSequence}: ${slug} — Influence`,
    description: `Watch the public replay for this completed Influence game, starting at event sequence ${startSequence}.`,
  };
}

export default async function GameReplayAtSequencePage({ params }: Props) {
  const { slug, sequence } = await params;
  const startSequence = parseReplaySequenceParam(sequence);
  const data = await loadReplayPageData(slug);

  return (
    <ReplayPageShell
      slug={slug}
      initialGame={data.initialGame}
      initialMessages={data.initialMessages}
      initialReplayFrames={data.initialReplayFrames}
      startSequence={startSequence}
    />
  );
}
