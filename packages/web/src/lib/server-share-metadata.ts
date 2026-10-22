import type { Metadata } from "next";
import { getServerHouseCuts, getServerPublicPlayerProfile } from "./server-api";

export async function getHighlightsShareMetadata(slug: string, scene?: string, audience?: string): Promise<Metadata> {
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

export async function getProfileShareMetadata(identifier: string, game?: string): Promise<Metadata> {
  const result = await getServerPublicPlayerProfile(identifier, game === "influence" || game === "werewolf" ? game : "all");
  if (result.status !== "found") return { title: "Profile unavailable — The House", robots: { index: false } };
  const title = `${result.profile.identity.displayName} — The House`;
  const description = `View ${result.profile.identity.displayName}'s current season standing, career record, House game history, and agent roster.`;
  return { title, description, openGraph: {title, description, type: "website"}, twitter: {card: "summary", title, description} };
}
