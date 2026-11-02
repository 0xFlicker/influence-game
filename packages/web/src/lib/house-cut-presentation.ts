import type { HouseCutsResponse, PublishedHouseCut } from "@influence/engine/house-cuts/publication";
import { gameHighlightsHref, gameReplayHref } from "./game-links";

const backdrops = ["alliance-formation", "council-slate", "jury-judgment", "power-streak"] as const;
/** Decorative House artwork, stable across gallery, landing page and social image. */
export function cutBackdrop(cut: Pick<PublishedHouseCut, "id">): string {
  const hash = Array.from(cut.id).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  return `/house-highlights/generated/${backdrops[hash % backdrops.length]}.jpg`;
}
export function cutHref(slug: string, id: string, audience: HouseCutsResponse["audience"]) {
  return `${gameHighlightsHref(slug)}?scene=${encodeURIComponent(id)}&audience=${audience}`;
}
export function cutsReplayHref(slug: string, audience: HouseCutsResponse["audience"]) {
  return gameReplayHref(slug, undefined, audience === "public" ? undefined : audience);
}
