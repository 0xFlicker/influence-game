import { cutHref } from "./house-cut-presentation";
import type { Metadata } from "next";
import { getServerHouseCuts, getServerPublicPlayerProfile } from "./server-api";
import { playerProfileHref } from "./player-profile-links";

export async function getHighlightsShareMetadata(slug: string, scene?: string, audience?: string): Promise<Metadata> {
  try {
    const response = await getServerHouseCuts(slug, audience);
    const cut = response.publication?.cuts.find(c => c.id === scene);
    const title = cut ? `${cut.title} — House Cuts${response.audience === "omniscient" ? " · Full spoilers" : ""}` : "House Cuts — The House";
    const description = cut?.context ?? `Selected moments from ${slug}.`;
    const images = cut ? [{ url: `/games/${encodeURIComponent(slug)}/highlights/card-image/${encodeURIComponent(cut.id)}?audience=${response.audience}`, width: 1200, height: 630, alt: cut.title }] : [];
    const url = cut ? cutHref(slug, cut.id, response.audience) : `/games/${encodeURIComponent(slug)}/highlights?audience=${response.audience}`;
    // A cut is its own page; only remove the default audience from canonical URLs.
    const defaultAudience = response.game.kind === "werewolf" ? "mystery" : "public";
    const canonicalBase = `/games/${encodeURIComponent(response.game.slug)}/highlights`;
    const canonicalQuery = new URLSearchParams();
    if (cut) canonicalQuery.set("scene", cut.id);
    if (response.audience !== defaultAudience) canonicalQuery.set("audience", response.audience);
    const canonical = `${canonicalBase}${canonicalQuery.size ? `?${canonicalQuery}` : ""}`;
    return { title: { absolute: title }, description, alternates: { canonical }, openGraph: { type: "website", url, title, description, images }, twitter: { card: "summary_large_image", title, description, images } };
  } catch {
    return { title: "House Cuts — The House", description: "Selected moments from the House." };
  }

}

export async function getProfileShareMetadata(identifier: string, game?: string): Promise<Metadata> {
  const result = await getServerPublicPlayerProfile(identifier, game === "influence" || game === "werewolf" ? game : "all");
  if (result.status !== "found") return { title: "Profile unavailable — The House", robots: { index: false } };
  const title = `${result.profile.identity.displayName} — The House`;
  const description = `View ${result.profile.identity.displayName}'s current season standing, career record, House game history, and agent roster.`;
  const canonical = playerProfileHref(result.profile.identity);
  const images = [{ url: `${canonical}/card-image`, width: 1200, height: 630, alt: `${result.profile.identity.displayName} — player profile at The House` }];
  return { title, description, openGraph: {title, description, type: "website", url: canonical, images}, twitter: {card: "summary_large_image", title, description, images} };
}
