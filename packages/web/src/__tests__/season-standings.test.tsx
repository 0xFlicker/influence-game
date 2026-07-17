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
    expect(html).toContain('href="/profile/architect"');
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
        owner: {
          publicId: "f7ad2112-7471-4a73-ab2c-02685db3ba40",
          handle: "architect-archive",
          displayName: "Architect Archive",
        },
        ownerName: "Architect Archive",
        points: 120,
      },
      architectChampion: {
        owner: {
          publicId: "f7ad2112-7471-4a73-ab2c-02685db3ba40",
          handle: "architect-archive",
          displayName: "Architect Archive",
        },
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
    expect(html).toContain('href="/profile/architect-archive"');
  });

  test("does not invent profile links or a dual crown when identities are absent", () => {
    const legacy = dashboard();
    legacy.schemaVersion = 1;
    legacy.agentStandings[0]!.owner = undefined;
    legacy.architectStandings[0]!.owner = undefined;
    legacy.honors = {
      agentChampion: {
        agentId: "atlas",
        agentName: "Atlas",
        ownerName: "Anonymous architect",
        points: 120,
      },
      architectChampion: {
        ownerName: "Anonymous architect",
        pointsHundredths: 12000,
        contributions: [],
      },
    };

    const html = renderToStaticMarkup(
      <SeasonStandings dashboard={legacy} loading={false} seasons={[legacy.season]} onSelectSeason={() => {}} />,
    );
    expect(html).not.toContain('href="/profile/');
    expect(html).not.toContain("Dual Crown sweep");
  });
});

function dashboard(): SeasonDashboard {
  return {
    schemaVersion: 2,
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
      owner: {
        publicId: "8a54b663-f14e-4287-a5e2-40b4dcc8afeb",
        handle: "architect",
        displayName: "Architect",
      },
      ownerName: "Architect",
      totalPoints: 120,
      gamesPlayed: 2,
      wins: 1,
      runnerUpFinishes: 1,
      averageNormalizedPlacement: 0.9,
    }],
    architectStandings: [{
      rank: 1,
      owner: {
        publicId: "8a54b663-f14e-4287-a5e2-40b4dcc8afeb",
        handle: "architect",
        displayName: "Architect",
      },
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
