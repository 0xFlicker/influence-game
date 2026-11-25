import { AwardIcons } from "../components/award-icons";
import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import PublicPlayerProfilePage, {
  generateMetadata,
} from "../app/(site)/profile/[id]/page";
import PublicPlayerHistoryPage from "../app/(site)/profile/[id]/history/page";
import PublicPlayerProfileError from "../app/(site)/profile/[id]/error";
import PublicPlayerProfileLoading from "../app/(site)/profile/[id]/loading";
import PublicPlayerProfileNotFound from "../app/(site)/profile/[id]/not-found";
import { PublicPlayerProfileView } from "../app/profile/[id]/public-player-profile";
import {
  PublicProfileShareButton,
} from "../app/profile/[id]/public-profile-share-button";
import type {
  PublicPlayerProfile,
  PublicPlayerProfileEnvelope,
} from "../lib/api";
import { playerProfileHref } from "../lib/player-profile-links";
import {
  getServerPublicPlayerProfile,
  ServerApiError,
} from "../lib/server-api";
import {
  InfluenceAuthContext,
  type InfluenceAuthState,
} from "../hooks/use-auth";

const anonymousAuthState: InfluenceAuthState = {
  ready: true,
  authenticated: false,
  account: null,
  hydrationError: false,
  openSignIn: () => {},
  openCreateAccount: () => {},
  openPrivySignIn: () => {},
  resetPrivyIdentity: async () => {},
  requestPrivyProof: async () => null,
  beginAuthenticationAttempt: () => ({ generation: "profile-test" }),
  isAuthenticationAttemptCurrent: () => true,
  cancelAuthenticationAttempt: () => {},
  completeAuthenticationAttempt: async () => false,
  runFarcasterMiniAppLogin: async () => "failed",
  logout: async () => {},
  needsInvite: false,
  dismissInvite: () => {},
  submitInvite: async () => {},
  inviteError: null,
  submittingInvite: false,
};

function renderWithAnonymousAuth(node: ReactNode): string {
  return renderToString(
    <InfluenceAuthContext.Provider value={anonymousAuthState}>
      {node}
    </InfluenceAuthContext.Provider>,
  );
}

const profileFixture: PublicPlayerProfile = {
  identity: {
    publicId: "6ec4c81b-e382-4a97-bc0e-07d7f1d35658",
    handle: "flick",
    displayName: "Flick",
  },
  currentSeason: {
    season: {
      slug: "season-0",
      name: "Season 0",
      status: "active",
    },
    architectStanding: {
      rank: 3,
      totalPointsHundredths: 12875,
      wins: 2,
      contributions: [
        {
          agentName: "Atlas",
          sourcePoints: 95,
          weightPercent: 100,
          weightedPointsHundredths: 9500,
        },
      ],
    },
    honors: {
      agentChampion: true,
      architectChampion: false,
    },
  },
  career: {
    rating: 1540,
    peakRating: 1600,
    gamesPlayed: 8,
    wins: 5,
    winRate: 0.625,
  },
  werewolfRecord: { wins: 3, losses: 2, draws: 1 },
  recentResults: [
    {
      gameSlug: "edge-smoke-dusk",
      agentName: "Atlas",
      gameKind: "influence", gameId: "game", playerId: "seat", agentProfileId: null, gameTitle: "edge-smoke-dusk", totalPlayers: 8,
      result: { outcome: "win", placement: 1, totalPoints: 95, eliminated: false, rounds: 6 },
      completedAt: "2026-07-15T12:00:00.000Z",
    },
  ],
  agents: [
    {
      name: "Atlas",
      avatarUrl: "https://cdn.example.test/atlas.png",
      fullBodyImageUrl: "/api/public/agents/atlas/art?kind=full-body",
      werewolfRecord: { wins: 3, losses: 2, draws: 1 },
      role: { key: "strategic", label: "Strategic" },
      competition: {
        gamesPlayed: 8,
        wins: 5,
        winRate: 0.625,
      },
    },
    {
      name: "Zeta",
      avatarUrl: null,
      fullBodyImageUrl: null,
      werewolfRecord: { wins: 0, losses: 0, draws: 0 },
      role: null,
      competition: {
        gamesPlayed: 0,
        wins: 0,
        winRate: 0,
      },
    },
  ],
};

function foundEnvelope(
  profile: PublicPlayerProfile = profileFixture,
): PublicPlayerProfileEnvelope {
  return {
    schemaVersion: 1,
    status: "found",
    profile,
  };
}

describe("public player profile", () => {
  it("features published artwork, links to public history, and shows both records", () => {
    const html = renderToString(<PublicPlayerProfileView profile={profileFixture} />);

    const identityIndex = html.indexOf("Flick");
    const seasonIndex = html.indexOf("Influence season");
    const careerIndex = html.indexOf("Influence competitive record");
    const resultsIndex = html.indexOf("Game history");
    const rosterIndex = html.indexOf("Saved competitors");

    expect(identityIndex).toBeGreaterThanOrEqual(0);
    expect(resultsIndex).toBeGreaterThan(identityIndex);
    expect(careerIndex).toBeGreaterThan(resultsIndex);
    expect(seasonIndex).toBeGreaterThan(careerIndex);
    expect(rosterIndex).toBeGreaterThan(seasonIndex);
    expect(html).toContain('href="/profile/flick/history"');
    expect(html).toContain('alt="Full-body portrait of Atlas"');
    expect(html).toContain('aria-label="Next agent"');
    expect(html).toContain("Recent Werewolf record");
    expect(html).not.toContain("edge-smoke-dusk");
    expect(html.replaceAll("<!-- -->", "")).toContain("@flick");
    expect(html).toContain("Architect standing");
    expect(html).toContain("#3");
    expect(html).toContain("Agent Champion");
    expect(html).toContain("Atlas");
    expect(html).toContain("Zeta");
    expect(html).toContain("No public results yet.");
    expect(html).toContain('aria-label="View Atlas portrait and stats"');
    expect(html).toContain('aria-label="View Zeta portrait and stats"');
    expect(html).toContain("w-12 h-12");
    expect(html).not.toContain('href="/agents/');
    expect(html).not.toContain("Wallet");
    expect(html).not.toContain("Email");
    expect(html).not.toContain("Edit agent");
    expect(html).not.toContain("Dashboard");
  });

  it("renders truthful no-season, no-results, and empty-career states", () => {
    const html = renderToString(
      <PublicPlayerProfileView
        profile={{
          ...profileFixture,
          currentSeason: null,
          career: {
            rating: 1200,
            peakRating: 1200,
            gamesPlayed: 0,
            wins: 0,
            winRate: 0,
          },
          recentResults: [],
          werewolfRecord: { wins: 0, losses: 0, draws: 0 },
        }}
      />,
    );

    expect(html).toContain("No current season is active.");
    expect(html).toContain("No public Werewolf results yet.");
    expect(html).toContain("No Influence career games yet.");
    expect(html).toContain("Zeta");
  });

  it("prefers the handle for shared links and metadata without redirecting UUID routes", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(String(url));
      return Response.json(foundEnvelope());
    }) as typeof fetch;

    try {
      const metadata = await generateMetadata({
        params: Promise.resolve({ id: profileFixture.identity.publicId }),
      });
      const page = await PublicPlayerProfilePage({
        params: Promise.resolve({ id: profileFixture.identity.publicId }),
      });
      const html = renderWithAnonymousAuth(page);

      expect(metadata.alternates?.canonical).toBe("/profile/flick");
      expect(metadata.openGraph?.url).toBe("/profile/flick");
      expect(metadata.title).toContain("Flick");
      expect((metadata.twitter as { card?: string } | null | undefined)?.card)
        .toBe("summary_large_image");
      expect(JSON.stringify(metadata.openGraph?.images)).toContain("/profile/flick/card-image");
      const miniapp = JSON.parse(String(metadata.other?.["fc:miniapp"]));
      expect(miniapp.imageUrl).toContain("/profile/flick/card-image?format=farcaster");
      expect(miniapp.button.action.url).toContain("/profile/flick?app=mini");
      expect(html).toContain("Flick");
      expect(requestedUrls).toContainEqual(expect.stringContaining(`/api/players/${profileFixture.identity.publicId}?game=all`));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses the public UUID as canonical when the player has no handle", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json(foundEnvelope({
      ...profileFixture,
      identity: {
        ...profileFixture.identity,
        handle: null,
      },
    }))) as unknown as typeof fetch;

    try {
      const metadata = await generateMetadata({
        params: Promise.resolve({ id: profileFixture.identity.publicId }),
      });

      expect(metadata.alternates?.canonical).toBe(
        `/profile/${profileFixture.identity.publicId}`,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps only API 404 responses to the route not-found boundary", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => {
      const status = String(url).includes("/api/players/missing-player")
        ? 404
        : 503;
      return new Response("Unavailable", { status });
    }) as typeof fetch;

    try {
      await expect(PublicPlayerProfilePage({
        params: Promise.resolve({ id: "missing-player" }),
      })).rejects.toMatchObject({
        digest: "NEXT_HTTP_ERROR_FALLBACK;404",
      });
      await expect(PublicPlayerProfilePage({
        params: Promise.resolve({ id: "service-outage" }),
      })).rejects.toBeInstanceOf(ServerApiError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fetches the anonymous profile uncached and without authorization", async () => {
    const originalFetch = globalThis.fetch;
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (
      _url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      requestInit = init;
      return Response.json(foundEnvelope());
    }) as typeof fetch;

    try {
      await getServerPublicPlayerProfile("flick");

      expect(requestInit?.cache).toBe("no-store");
      expect(new Headers(requestInit?.headers).has("Authorization")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("provides explicit generic loading, retry, and terminal not-found surfaces", () => {
    const loadingHtml = renderWithAnonymousAuth(<PublicPlayerProfileLoading />);
    const errorHtml = renderWithAnonymousAuth(
      <PublicPlayerProfileError
        error={new Error("PRIVATE_UPSTREAM_DETAIL")}
        reset={() => {}}
      />,
    );
    const notFoundHtml = renderWithAnonymousAuth(<PublicPlayerProfileNotFound />);

    expect(loadingHtml).toContain('aria-label="Loading player profile"');
    expect(errorHtml).toContain("Try again");
    expect(errorHtml).toContain('href="/games"');
    expect(errorHtml).not.toContain("PRIVATE_UPSTREAM_DETAIL");
    expect(notFoundHtml).toContain("Player profile not found");
    expect(notFoundHtml).toContain('href="/"');
    expect(notFoundHtml).toContain('href="/games"');
  });
});

it("renders history filters, results, and an older-games cursor on the dedicated route", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => {
    expect(String(url)).toEndWith("/api/players/flick/history?game=influence&cursor=current");
    return Response.json({ identity: profileFixture.identity, items: profileFixture.recentResults, nextCursor: "next" });
  }) as typeof fetch;
  try {
    const page = await PublicPlayerHistoryPage({ params: Promise.resolve({ id: "flick" }), searchParams: Promise.resolve({ game: "influence", cursor: "current" }) });
    const html = renderWithAnonymousAuth(page);
    expect(html).toContain('href="/profile/flick"');
    expect(html).toContain('href="/profile/flick/history?game=werewolf"');
    expect(html).toContain('href="/profile/flick/history?game=influence&amp;cursor=next"');
    expect(html).toContain('href="/games/edge-smoke-dusk/results"');
  } finally { globalThis.fetch = originalFetch; }
});

describe("public player profile sharing", () => {
  it("uses the shared handle-preferred path helper", () => {
    expect(playerProfileHref(profileFixture.identity)).toBe("/profile/flick");
    expect(playerProfileHref({
      ...profileFixture.identity,
      handle: null,
    })).toBe(`/profile/${profileFixture.identity.publicId}`);
  });

  it("renders an accessible 44px share control and live feedback region", () => {
    const html = renderToString(
      <PublicProfileShareButton identity={profileFixture.identity} />,
    );

    expect(html).toContain('aria-label="Share Flick profile"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("min-h-11");
  });
});


it("renders compact, labelled agent badge controls without persistent title/date text", () => {
  const award = { id: "participant", code: "season-0-agent-participant", title: "Season 0 Participant", theme: "season-0", awardedAt: "2026-11-03T00:00:00Z", sourceSeasonId: "s0", sourceEventId: null };
  const html = renderToString(<AwardIcons awards={[award]} agentName="Arden Vale" />);
  expect(html).toContain('aria-label="Arden Vale: Season 0 Participant"');
  expect(html).toContain('aria-label="Arden Vale badges"');
  expect(html).not.toContain(">Season 0 Participant<");
  expect(html).not.toContain("2026-11-03");
  const profile = { ...profileFixture, agents: [{ ...profileFixture.agents[0]!, awards: [award] }] };
  const page = renderToString(<PublicPlayerProfileView profile={profile} />);
  const card = page.slice(page.indexOf("<article"), page.indexOf("</article>"));
  expect(card).toContain("Season 0 Participant");
  expect(card).not.toContain('href="/agents/');
});
