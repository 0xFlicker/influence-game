import { Nav } from "@/components/nav";
import { WerewolfViewer } from "../werewolf-viewer";
export const metadata = { title: "Watch Werewolf — The House", description: "Watch a Werewolf game in Mystery or Omniscient mode." };
export default async function WerewolfGamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <div className="influence-page min-h-screen"><Nav /><main className="mx-auto max-w-6xl px-4 py-8 sm:px-6"><WerewolfViewer slug={slug} /></main></div>;
}
