import type { Metadata } from "next";
import { HouseCutsClient } from "@/app/games/[slug]/highlights/house-cuts-client";
import { getServerHouseCuts } from "@/lib/server-api";
import { Nav } from "@/components/nav";
import { getHighlightsShareMetadata } from "@/lib/server-share-metadata";
interface Props { params: Promise<{ slug: string }>; searchParams: Promise<{ scene?: string; audience?: string }> }
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { scene, audience } = await searchParams;
  return getHighlightsShareMetadata(slug, scene, audience);
}

export default async function HouseHighlightsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { scene, audience } = await searchParams;
  let initialData;
  try { initialData = await getServerHouseCuts(slug, audience); }
  catch { /* The client renders a retryable error if the API remains unavailable. */ }
  return <><Nav /><HouseCutsClient slug={slug} audience={audience} selectedId={scene} initialData={initialData} /></>;
}
