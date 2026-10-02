import type { Metadata } from "next";
import { HouseGameRoute } from "../house-route";
import { gameHighlightCardImageHref } from "@/lib/game-links";
import { getServerGameEntry, getServerPostgameHighlights } from "@/lib/server-api";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ scene?: string | string[] }>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const selectedSceneId = sceneParam(searchParams ? await searchParams : {});

  if (selectedSceneId) {
    try {
      if ((await getServerGameEntry(slug)).gameKind !== "influence") return {title:"The House"};
      const response = await getServerPostgameHighlights(slug);
      const scene = response.highlights.scenes.find((entry) => entry.id === selectedSceneId);
      if (scene) {
        const title = `${scene.title} — House Highlights`;
        const description = scene.visualCard.altText;
        const image = {
          url: gameHighlightCardImageHref(slug, scene.id),
          width: 1200,
          height: 630,
          alt: scene.visualCard.altText,
        };

        return {
          title,
          description,
          openGraph: {
            title,
            description,
            type: "article",
            images: [image],
          },
          twitter: {
            card: "summary_large_image",
            title,
            description,
            images: [image],
          },
        };
      }
    } catch (err) {
      console.error(`[HouseHighlightsMetadata] SSR fetch failed for slug="${slug}":`, err);
    }
  }

  return {
    title: "House Highlights — Influence",
    description: `A fact-backed House Highlights artifact for ${slug}.`,
  };
}

export default async function HouseHighlightsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const selectedSceneId = sceneParam(searchParams ? await searchParams : {});
  return <HouseGameRoute slug={slug} mode="highlights" scene={selectedSceneId ?? undefined} />;
}

function sceneParam(params: { scene?: string | string[] }): string | null {
  const scene = Array.isArray(params.scene) ? params.scene[0] : params.scene;
  return scene?.trim() || null;
}
