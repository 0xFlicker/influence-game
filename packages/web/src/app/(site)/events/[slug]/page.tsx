import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { ChampionshipEventView } from "@/app/events/championship-view";
import type { ChampionshipView } from "@/lib/championship";
import { serverApiFetch, ServerApiError } from "@/lib/server-api";

export const metadata = { title: "Championship — The House" };
export default async function ChampionshipPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let event: ChampionshipView;
  try { event = await serverApiFetch<ChampionshipView>(`/api/championships/${encodeURIComponent(slug)}`, { cache: "no-store" }); }
  catch (error) { if (error instanceof ServerApiError && error.status === 404) notFound(); throw error; }
  return <div className="min-h-screen"><Nav /><main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-8 lg:px-12"><ChampionshipEventView event={event} /></main></div>;
}
