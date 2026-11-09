import type { Metadata } from "next";
import { getServerGameEntry } from "@/lib/server-api";
import { HouseGameRoute } from "@/app/games/[slug]/house-route";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  try {
    const game = await getServerGameEntry((await params).slug);
    return { title: "Results — The House", alternates: { canonical: `/games/${encodeURIComponent(game.slug)}/results` } };
  } catch (error) {
    // Without a resolved identity, do not invent a canonical URL; the layout checks visibility.
    console.error("[Results] Metadata unavailable", error);
    return { title: "Results — The House" };
  }
}
export default async function GameResultsPage({params}: {params:Promise<{slug:string}>}) {
  return <HouseGameRoute slug={(await params).slug} mode="results" />;
}
