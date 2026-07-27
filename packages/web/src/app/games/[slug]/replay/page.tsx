import { loadReplayPageData, ReplayPageShell } from "./replay-page";

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
  const data = await loadReplayPageData(slug);

  return (
    <ReplayPageShell
      slug={slug}
      initialGame={data.initialGame}
      initialMessages={data.initialMessages}
      initialReplayFrames={data.initialReplayFrames}
    />
  );
}
