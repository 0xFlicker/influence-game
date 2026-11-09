import type { MetadataRoute } from "next";
import { enabledGameKinds } from "@influence/engine/game-availability";
import { serverApiFetch } from "@/lib/server-api";
import { getAllPosts } from "@/lib/updates";

const ORIGIN = "https://thehouse.game";

// Seasons are created after deployment, so the sitemap must read them at request time.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const data = await serverApiFetch<unknown>("/api/seasons", {
    cache: "no-store",
    credentials: "omit",
  });
  if (!data || typeof data !== "object" || !("seasons" in data) || !Array.isArray(data.seasons)) {
    throw new Error("Invalid public seasons response for sitemap");
  }
  const seasons = data.seasons.map((season: unknown) => {
    if (!season || typeof season !== "object" || !("slug" in season) || typeof season.slug !== "string" || !season.slug.trim()) {
      throw new Error("Invalid public season slug for sitemap");
    }
    return encodeURIComponent(season.slug);
  });
  const paths = [
    "", "/games", "/games/public", "/games/free", "/seasons", "/rules", "/rules?game=werewolf",
    "/about", "/get-mcp", "/updates", "/terms", "/privacy",
    ...enabledGameKinds().map((kind) => `/games/type/${kind}`),
    ...getAllPosts().map((post) => `/updates/${encodeURIComponent(post.slug)}`),
    ...seasons.flatMap((slug: string) => [`/seasons?season=${slug}`, `/games/season/${slug}`]),
  ];
  return [...new Set(paths)].map((path) => ({ url: `${ORIGIN}${path}` }));
}
