import type { Metadata } from "next";
import { getResultsCardMetadata } from "@/lib/server-player-card";
import { HouseGameRoute } from "@/app/games/[slug]/house-route";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return getResultsCardMetadata((await params).slug);
}
export default async function GameResultsPage({params}: {params:Promise<{slug:string}>}) {
  return <HouseGameRoute slug={(await params).slug} mode="results" />;
}
