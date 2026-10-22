import type { Metadata } from "next";
import { HouseGameRoute } from "@/app/games/[slug]/house-route";
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
  return <HouseGameRoute slug={slug} mode="highlights" scene={scene} audience={audience} />;
}
