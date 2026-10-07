import type { Metadata } from "next";
import { HouseGameRoute } from "../house-route";
import { getServerHouseCuts } from "@/lib/server-api";
interface Props { params: Promise<{ slug: string }>; searchParams: Promise<{ scene?: string; audience?: string }> }
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { scene, audience } = await searchParams;
  try {
    const response = await getServerHouseCuts(slug, audience);
    const cut = response.publication?.cuts.find(c => c.id === scene);
    const title = cut ? `${cut.title} — House Cuts${response.audience === "omniscient" ? " · Full spoilers" : ""}` : "House Cuts — The House";
    const description = cut?.context ?? `Selected moments from ${slug}.`;
    const images = cut ? [{ url: `/games/${encodeURIComponent(slug)}/highlights/card-image/${encodeURIComponent(cut.id)}?audience=${response.audience}`, width: 1200, height: 630, alt: cut.title }] : [];
    return { title, description, openGraph: { title, description, images }, twitter: { card: "summary_large_image", title, description, images } };
  } catch {
    return { title: "House Cuts — The House", description: "Selected moments from the House." };
  }
}
export default async function HouseHighlightsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { scene, audience } = await searchParams;
  return <HouseGameRoute slug={slug} mode="highlights" scene={scene} audience={audience} />;
}
