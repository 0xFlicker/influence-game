import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SeasonStandings } from "../app/games/free/free-game-content";
import type { SeasonDashboard } from "../lib/api";

describe("season standings", () => {
  test("renders the win-led Agent Crown with accessible tabs and no hidden machinery", () => {
    const html = renderToStaticMarkup(
      <SeasonStandings dashboard={dashboard()} loading={false} seasons={[dashboard().season]} onSelectSeason={() => {}} />,
    );
    expect(html).toContain("Agent Crown");
    expect(html).toContain("Architect Crown");
    expect(html).toContain("aria-selected=\"true\"");
    expect(html).toContain("Atlas");
    expect(html).toContain("120");
    expect(html).toContain("Wins lead");
    expect(html).not.toContain("sigma");
    expect(html).not.toContain("recalibr");
    expect(html).not.toContain("magnitude");
  });

  test("renders a clear empty season without falling back to account ELO", () => {
    const empty = dashboard();
    empty.agentStandings = [];
    empty.architectStandings = [];
    const html = renderToStaticMarkup(
      <SeasonStandings dashboard={empty} loading={false} seasons={[empty.season]} onSelectSeason={() => {}} />,
    );
    expect(html).toContain("No eligible results in this season yet");
    expect(html).not.toContain("ELO");
  });

  test("renders archived crown snapshots and a same-owner sweep", () => {
    const final = dashboard();
    final.season.status = "final";
    final.season.finalizedAt = "2026-08-01T00:00:00.000Z";
    final.honors = {
      agentChampion: {
        agentId: "atlas",
        agentName: "Atlas Archive",
        ownerId: "owner-1",
        ownerName: "Architect Archive",
        points: 120,
      },
      architectChampion: {
        ownerId: "owner-1",
        ownerName: "Architect Archive",
        pointsHundredths: 12000,
        contributions: [],
      },
    };
    const html = renderToStaticMarkup(
      <SeasonStandings dashboard={final} loading={false} seasons={[final.season]} onSelectSeason={() => {}} />,
    );
    expect(html).toContain("Agent Champion");
    expect(html).toContain("Atlas Archive");
    expect(html).toContain("Architect Champion");
    expect(html).toContain("Dual Crown sweep");
  });
});

function dashboard(): SeasonDashboard {
  return {
    schemaVersion: 1,
    season: {
      id: "season-1",
      slug: "summer-2026",
      name: "Summer 2026",
      status: "active",
      ratedPool: "free",
      admissionStartsAt: null,
      admissionClosesAt: null,
      finalizedAt: null,
    },
    agentStandings: [{
      rank: 1,
      agentId: "atlas",
      agentName: "Atlas",
      ownerId: "owner-1",
      ownerName: "Architect",
      totalPoints: 120,
      gamesPlayed: 2,
      wins: 1,
      runnerUpFinishes: 1,
      averageNormalizedPlacement: 0.9,
    }],
    architectStandings: [{
      rank: 1,
      ownerId: "owner-1",
      ownerName: "Architect",
      totalPointsHundredths: 12000,
      wins: 1,
      contributions: [{
        agentId: "atlas",
        agentName: "Atlas",
        sourcePoints: 120,
        weightPercent: 100,
        weightedPointsHundredths: 12000,
      }],
    }],
    honors: null,
  };
}
