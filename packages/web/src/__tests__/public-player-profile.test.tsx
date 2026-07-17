import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import PublicPlayerProfilePage, {
  generateMetadata,
} from "../app/profile/[id]/page";
import PublicPlayerProfileError from "../app/profile/[id]/error";
import PublicPlayerProfileLoading from "../app/profile/[id]/loading";
import PublicPlayerProfileNotFound from "../app/profile/[id]/not-found";
import { PublicPlayerProfileView } from "../app/profile/[id]/public-player-profile";
import {
  PublicProfileShareButton,
  sharePublicPlayerProfile,
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
  recentResults: [
    {
      gameSlug: "edge-smoke-dusk",
      agentName: "Atlas",
      placement: 1,
      lobbySize: 8,
      totalPoints: 95,
      earnedAt: "2026-07-15T12:00:00.000Z",
    },
  ],
  agents: [
    {
      name: "Atlas",
      avatarUrl: "https://cdn.example.test/atlas.png",
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
  it("renders the public resume in source order with every non-navigational agent", () => {
    const html = renderToString(<PublicPlayerProfileView profile={profileFixture} />);

    const identityIndex = html.indexOf("Flick");
    const seasonIndex = html.indexOf("Current season");
    const careerIndex = html.indexOf("Career");
    const resultsIndex = html.indexOf("Recent results");
    const rosterIndex = html.indexOf("Agent roster");

    expect(identityIndex).toBeGreaterThanOrEqual(0);
    expect(seasonIndex).toBeGreaterThan(identityIndex);
    expect(careerIndex).toBeGreaterThan(seasonIndex);
    expect(resultsIndex).toBeGreaterThan(careerIndex);
    expect(rosterIndex).toBeGreaterThan(resultsIndex);
    expect(html.replaceAll("<!-- -->", "")).toContain("@flick");
    expect(html).toContain("Architect standing");
    expect(html).toContain("#3");
    expect(html).toContain("Agent Champion");
    expect(html).toContain("Atlas");
    expect(html).toContain("Zeta");
    expect(html).toContain("No games yet");
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
        }}
      />,
    );

    expect(html).toContain("No current season is active.");
    expect(html).toContain("No public results yet.");
    expect(html).toContain("No career games yet.");
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
      const html = renderToString(page);

      expect(metadata.alternates?.canonical).toBe("/profile/flick");
      expect(metadata.openGraph?.url).toBe("/profile/flick");
      expect(metadata.title).toContain("Flick");
      expect((metadata.twitter as { card?: string } | null | undefined)?.card)
        .toBe("summary");
      expect(html).toContain("Flick");
      expect(requestedUrls.every((url) => url.endsWith(
        `/api/players/${profileFixture.identity.publicId}`,
      ))).toBe(true);
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
      const status = String(url).endsWith("/api/players/missing-player")
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
    const loadingHtml = renderToString(<PublicPlayerProfileLoading />);
    const errorHtml = renderToString(
      <PublicPlayerProfileError
        error={new Error("PRIVATE_UPSTREAM_DETAIL")}
        reset={() => {}}
      />,
    );
    const notFoundHtml = renderToString(<PublicPlayerProfileNotFound />);

    expect(loadingHtml).toContain('aria-label="Loading player profile"');
    expect(errorHtml).toContain("Try again");
    expect(errorHtml).toContain('href="/games"');
    expect(errorHtml).not.toContain("PRIVATE_UPSTREAM_DETAIL");
    expect(notFoundHtml).toContain("Player profile not found");
    expect(notFoundHtml).toContain('href="/"');
    expect(notFoundHtml).toContain('href="/games"');
  });
});

describe("public player profile sharing", () => {
  it("uses the shared handle-preferred path helper", () => {
    expect(playerProfileHref(profileFixture.identity)).toBe("/profile/flick");
    expect(playerProfileHref({
      ...profileFixture.identity,
      handle: null,
    })).toBe(`/profile/${profileFixture.identity.publicId}`);
  });

  it("uses native sharing first with the exact canonical URL", async () => {
    let sharedData: ShareData | undefined;
    let copied = false;
    const result = await sharePublicPlayerProfile({
      displayName: "Flick",
      canonicalPath: "/profile/flick",
      origin: "https://thehouse.game",
      share: async (data) => {
        sharedData = data;
      },
      copy: async () => {
        copied = true;
      },
    });

    expect(sharedData).toEqual({
      title: "Flick on Influence",
      text: "View Flick's competitive profile on Influence.",
      url: "https://thehouse.game/profile/flick",
    });
    expect(copied).toBe(false);
    expect(result).toEqual({
      tone: "success",
      message: "Share dialog opened.",
    });
  });

  it("treats native cancellation as neutral without copying", async () => {
    let copied = false;
    const result = await sharePublicPlayerProfile({
      displayName: "Flick",
      canonicalPath: "/profile/flick",
      origin: "https://thehouse.game",
      share: async () => {
        throw new DOMException("Cancelled", "AbortError");
      },
      copy: async () => {
        copied = true;
      },
    });

    expect(copied).toBe(false);
    expect(result).toEqual({
      tone: "neutral",
      message: "Share cancelled.",
    });
  });

  it("falls back from unavailable native sharing to the exact canonical clipboard URL", async () => {
    let copiedUrl = "";
    const result = await sharePublicPlayerProfile({
      displayName: "Flick",
      canonicalPath: "/profile/flick",
      origin: "https://thehouse.game",
      share: async () => {
        throw new Error("Native sharing unavailable");
      },
      copy: async (url) => {
        copiedUrl = url;
      },
    });

    expect(copiedUrl).toBe("https://thehouse.game/profile/flick");
    expect(result).toEqual({
      tone: "success",
      message: "Profile link copied.",
    });
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
