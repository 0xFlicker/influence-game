import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChampionshipEventView, featuredChampionshipMatch } from "../app/events/championship-view";
import { AwardShelf } from "../components/award-shelf";
import type { ChampionshipView } from "../lib/championship";

describe("championship presentation", () => {
  test("separates series/finale, connects to Season 0 and conceals unordered role spoilers", () => {
    const view: ChampionshipView = {
      id: "event", slug: "season-0-championship", name: "Season 0 Championship", status: "locked",
      season: { id: "season", slug: "season-0", name: "Season 0" },
      entries: [{ agentId: "agent", name: "Finalist", rank: 1, seasonPoints: 2646, transparentBodyUrl: "/frozen-cutout.png" }],
      matches: [{ ordinal: 1, gameKind: "werewolf", scheduledAt: "2026-12-01T00:00:00.000Z", status: "scheduled", gameSlug: null },
        { ordinal: 17, gameKind: "influence", scheduledAt: "2026-12-17T00:00:00.000Z", status: "scheduled", gameSlug: null }],
      lineups: [{ id: "opaque-lineup", roles: { agent: "werewolf" } }],
      policies: { points: null, roleComposition: null, equalScoreFallback: null, participationMinimumCompletedGames: null, ownerAttribution: null }, startDate: "2026-12-01",
    };
    view.standings = { series: [
      { agentId: "agent", name: "Finalist", points: 8.5, played: 16, wins: 8, seasonPoints: 2646 },
      { agentId: "other", name: "Other", points: 8.5, played: 16, wins: 8, seasonPoints: 2646 },
    ], werewolfWinners: ["agent", "other"], influenceWinners: [], resolutionPending: false };
    const html = renderToStaticMarkup(<ChampionshipEventView event={view} />);
    expect(html).toContain("/frozen-cutout.png");
    const headshot = renderToStaticMarkup(<ChampionshipEventView event={{...view, entries: [{...view.entries[0]!, transparentBodyUrl:null, bodyUrl:"/opaque-body.png", avatarUrl:"/existing-headshot.png"}]}} />);
    expect(headshot).toContain("/existing-headshot.png");
    expect(headshot).not.toContain("/opaque-body.png");
    expect(html).toContain("championship full-body portrait");
    expect(html).toContain("8.5");
    expect(html.match(/· Champion/g)).toHaveLength(2);
    expect(html).toContain("Werewolf series");
    expect(html).toContain("Influence finale");
    expect(html).toContain("00:00 UTC");
    expect(html).toContain("2,646 Season 0 points");
    expect(html).toContain('href="/seasons?season=season-0"');
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("not its scheduled match");
    expect(html).not.toContain("private-order");
    expect(html).not.toContain("href=\"/games/null");
    const werewolf = renderToStaticMarkup(<ChampionshipEventView event={{...view, matches: [{...view.matches[0]!, gameSlug: "werewolf-game", status: "completed"}]}} />);
    expect(werewolf).toContain('aria-label="Werewolf viewing mode"');
    const finale = renderToStaticMarkup(<ChampionshipEventView event={{...view, matches: [{...view.matches[1]!, gameSlug: "influence-game", status: "completed"}]}} />);
    expect(finale).toContain('data-game-kind="influence"');
    expect(finale).not.toContain('aria-label="Werewolf viewing mode"');

  });
  test("features the live match, otherwise the latest completed replay without changing schedule order", () => {
    const matches: ChampionshipView["matches"] = [1,2,3].map(ordinal => ({ordinal,gameKind:"werewolf",scheduledAt:"2026-12-01T00:00:00Z",status:ordinal < 3 ? "completed" : "scheduled",gameSlug:ordinal < 3 ? `game-${ordinal}` : null}));
    expect(featuredChampionshipMatch(matches)?.ordinal).toBe(2);
    matches[2] = {...matches[2]!,status:"running",gameSlug:"game-3"};
    expect(featuredChampionshipMatch(matches)?.ordinal).toBe(3);
    expect(matches.map(match=>match.ordinal)).toEqual([1,2,3]);
  });
  test("award shelf uses accessible text and source-specific titles", () => {
    const html = renderToStaticMarkup(<AwardShelf awards={[{ id: "award", code: "season-0-top-eight", title: "Season 0 Top 8", theme: "season-0",
      awardedAt: "2026-12-01T00:00:00.000Z", sourceSeasonId: "season", sourceEventId: "event" }]} />);
    expect(html).toContain("Season 0 Top 8");
    expect(html).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<AwardShelf awards={[]} />)).toBe("");
    const custom = renderToStaticMarkup(<AwardShelf awards={[{ id: "custom", code: "helper", title: "Community helper", theme: "house", awardedAt: "2026-12-01T00:00:00Z", sourceSeasonId: null, sourceEventId: null }]} />);
    expect(custom).toContain("Community helper");
    expect(custom).not.toContain("Season 0 honors");
    expect(custom).not.toContain(">S0<");
  });
});
