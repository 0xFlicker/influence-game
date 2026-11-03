import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChampionshipEventView } from "../app/events/championship-view";
import { AwardShelf } from "../components/award-shelf";
import type { ChampionshipView } from "../lib/championship";

describe("championship presentation", () => {
  test("separates series/finale, connects to Season 0 and conceals unordered role spoilers", () => {
    const view: ChampionshipView = {
      id: "event", slug: "season-0-championship", name: "Season 0 Championship", status: "locked",
      season: { id: "season", slug: "season-0", name: "Season 0" },
      entries: [{ agentId: "agent", name: "Finalist", rank: 1, seasonPoints: 2646 }],
      matches: [{ ordinal: 1, gameKind: "werewolf", scheduledAt: "2026-12-01T00:00:00.000Z", status: "scheduled", gameSlug: null },
        { ordinal: 17, gameKind: "influence", scheduledAt: "2026-12-17T00:00:00.000Z", status: "scheduled", gameSlug: null }],
      lineups: [{ id: "opaque-lineup", roles: { agent: "werewolf" } }],
      policies: { points: null, roleComposition: null, equalScoreFallback: null, participationMinimumCompletedGames: null, ownerAttribution: null }, startDate: "2026-12-01",
    };
    const html = renderToStaticMarkup(<ChampionshipEventView event={view} />);
    expect(html).toContain("Werewolf series");
    expect(html).toContain("Influence finale");
    expect(html).toContain("00:00 UTC");
    expect(html).toContain("2,646 Season 0 points");
    expect(html).toContain('href="/games/free?season=season-0"');
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("not its scheduled match");
    expect(html).not.toContain("private-order");
    expect(html).not.toContain("href=\"/games/null");
  });
  test("award shelf uses accessible text and source-specific titles", () => {
    const html = renderToStaticMarkup(<AwardShelf awards={[{ id: "award", code: "season-0-top-eight", title: "Season 0 Top 8", theme: "season-0",
      awardedAt: "2026-12-01T00:00:00.000Z", sourceSeasonId: "season", sourceEventId: "event" }]} />);
    expect(html).toContain("Season 0 Top 8");
    expect(html).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<AwardShelf awards={[]} />)).toBe("");
  });
});
