import type { SeasonIdentity } from "@/lib/api";

// The advertised season, never the ambient accepting season.
export const SEASON_ONE_SLUG = "season-1-3588af22";
export const SEASON_ONE_HREF = `/seasons?season=${SEASON_ONE_SLUG}`;
export const campaignIdeaKey = (id: string) => `influence:campaign-idea:${id}`;

export function seasonOneCreationHref(
  seasons: SeasonIdentity[],
  now = Date.now(),
) {
  const season = seasons.find((item) => item.slug === SEASON_ONE_SLUG);
  if (
    !season ||
    season.status !== "active" ||
    (season.admissionStartsAt && Date.parse(season.admissionStartsAt) > now) ||
    (season.admissionClosesAt && Date.parse(season.admissionClosesAt) <= now)
  ) {
    throw new Error(
      "Season 1 is not accepting entries right now. Check the season page for details.",
    );
  }
  return `/agents/create?${new URLSearchParams({ flow: "daily_free", seasonId: season.id, season: season.slug })}`;
}
