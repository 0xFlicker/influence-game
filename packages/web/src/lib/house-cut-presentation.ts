import type { HouseCutsResponse, PublishedHouseCut } from "@influence/engine/house-cuts/publication";
import { gameHighlightsHref, gameReplayHref } from "./game-links";

const influenceBackdrops = ["alliance-formation", "council-slate", "jury-judgment", "power-streak"] as const;
const werewolfBackdrops = [
  "/visual/werewolf/opening-v1/alley.jpg",
  "/visual/werewolf/votes-v1/town-square.jpg",
  "/visual/werewolf/opening-v1/door.jpg",
] as const;
/** Decorative game-specific artwork, stable across gallery, landing page and social image. */
export function cutBackdrop(cut: Pick<PublishedHouseCut, "id">, gameKind: HouseCutsResponse["game"]["kind"]): string {
  const hash = Array.from(cut.id).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  if (gameKind === "werewolf") return werewolfBackdrops[hash % werewolfBackdrops.length]!;
  return `/house-highlights/generated/${influenceBackdrops[hash % influenceBackdrops.length]}.jpg`;
}
export function cutHref(slug: string, id: string, audience: HouseCutsResponse["audience"]) {
  return `${gameHighlightsHref(slug)}?scene=${encodeURIComponent(id)}&audience=${audience}`;
}
export function cutsReplayHref(slug: string, audience: HouseCutsResponse["audience"]) {
  return gameReplayHref(slug, undefined, audience === "public" ? undefined : audience);
}
