import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { HouseHighlightsResponse } from "../lib/api";
import {
  highlightsLoadStateAfterRefreshError,
  HouseHighlightsClient,
  shouldSkipHighlightsRefresh,
} from "../app/games/[slug]/highlights/house-highlights-client";
import { generateMetadata } from "../app/games/[slug]/highlights/page";
import { HouseHighlightsView } from "../app/games/[slug]/components/house-highlights-view";
import {
  houseHighlightVisualBriefFixture,
  houseHighlightVisualCardFixture,
} from "./house-highlights-fixtures";

describe("HouseHighlightsView", () => {
  it("renders a client-loading shell before browser-side highlights data loads", () => {
    const html = renderToString(
      <HouseHighlightsClient gameSlug="edge-smoke-dusk" />,
    );

    expect(html).toContain("Opening House Highlights");
    expect(html).toContain("The House is loading the game facts.");
    expect(html).not.toContain("The House could not open this cut.");
  });

  it("renders initial server-loaded highlights without the loading-only shell", () => {
    const html = renderToString(
      <HouseHighlightsClient
        gameSlug="edge-smoke-dusk"
        initialResponse={mainCutFixture()}
      />,
    );

    expect(html).toContain("House Cut");
    expect(html).toContain("Ember was cut from inside the pact");
    expect(html).not.toContain("Opening House Highlights");
  });

  it("keeps server-loaded highlights visible when the browser refresh fails", () => {
    const initialResponse = mainCutFixture();
    const nextState = highlightsLoadStateAfterRefreshError(
      {
        status: "loaded",
        requestKey: "http://127.0.0.1:3000:edge-smoke-dusk",
        response: initialResponse,
      },
      "https://api.example.test:edge-smoke-dusk",
      "edge-smoke-dusk",
      new Error("Network down"),
    );

    expect(nextState).toMatchObject({
      status: "loaded",
      requestKey: "https://api.example.test:edge-smoke-dusk",
      response: initialResponse,
    });
  });

  it("does not immediately refetch matching server-loaded highlights", () => {
    expect(shouldSkipHighlightsRefresh(
      {
        status: "loaded",
        requestKey: "http://127.0.0.1:3000:edge-smoke-dusk",
        response: mainCutFixture(),
      },
      "http://127.0.0.1:3000:edge-smoke-dusk",
    )).toBe(true);
    expect(shouldSkipHighlightsRefresh(
      {
        status: "loaded",
        requestKey: "http://127.0.0.1:3000:edge-smoke-dusk",
        response: mainCutFixture(),
      },
      "https://api.example.test:edge-smoke-dusk",
    )).toBe(false);
  });

  it("renders a shareable House Cut with fact-forward visual cards", () => {
    const html = renderToString(
      <HouseHighlightsView response={mainCutFixture()} gameSlug="edge-smoke-dusk" />,
    );

    expect(html).toContain("House Cut");
    expect(html).toContain("This was the game where the pact collapsed one vote too late.");
    expect(html).toContain("Ember was cut from inside the pact");
    expect(html).toContain("Betrayal vote");
    expect(html).toContain("What happened");
    expect(html).toContain("Ember");
    expect(html).toContain("Nova");
    expect(html).toContain('src="https://cdn.example.test/avatars/ember-current.png"');
    expect(html).toContain('aria-label="View Ember portrait and stats"');
    expect(html).not.toContain('aria-label="View Ember Prime portrait and stats"');
    expect(html).toContain("Nova voted against Ember in Round 1.");
    expect(html).toContain("Ember was eliminated in Round 1.");
    expect(html).toContain("/games/edge-smoke-dusk/results#round-1");
    expect(html).toContain('aria-label="Share trailer"');
    expect(html).toContain("Share trailer");
    expect(html).not.toContain("Share scene");
    expect(html).toContain("/games/edge-smoke-dusk/replay");
    expect(html).toContain("house-highlight-visual-card");
    expect(html).toContain("Trailer");
    expect(html).toContain("/games/edge-smoke-dusk");
    expect(html).not.toContain("High confidence");
    expect(html).not.toContain("Abstract Vote Board");
    expect(html).not.toContain("Primary agent");
    expect(html).not.toContain("Deterministic overlays");
    expect(html).not.toContain("Receipt Badge");
    expect(html).not.toContain("Proof Link");
    expect(html).not.toContain("Vote record");
    expect(html).not.toContain("Alliance receipt");
    expect(html).not.toContain("Receipts");
    expect(html).not.toContain("scene facts");
    expect(html).not.toContain("scene fact");
    expect(html).not.toContain("scene House Cut");
    expect(html).not.toContain("rejectedCandidates");
    expect(html).not.toContain("sourcePointers");
    expect(html).not.toContain("payloadVersion");
    expect(html).not.toContain("posterDirection");
    expect(html).not.toContain("Vote card split across the alliance line");
  });

  it("marks a selected card from a shared scene URL", () => {
    const html = renderToString(
      <HouseHighlightsView
        response={mainCutFixture()}
        gameSlug="edge-smoke-dusk"
        selectedSceneId="alliance-cut:1:ember"
      />,
    );

    expect(html).toContain('id="scene-alliance-cut:1:ember"');
    expect(html).toContain('data-selected="true"');
  });

  it("generates scene-specific metadata for card share URLs", async () => {
    const originalApiBackendUrl = process.env.API_BACKEND_URL;
    const originalFetch = globalThis.fetch;
    process.env.API_BACKEND_URL = "http://127.0.0.1:3333";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(mainCutFixture()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    try {
      const metadata = await generateMetadata({
        params: Promise.resolve({ slug: "edge-smoke-dusk" }),
        searchParams: Promise.resolve({ scene: "alliance-cut:1:ember" }),
      });

      expect(metadata.title).toBe("Ember was cut from inside the pact — House Highlights");
      expect(metadata.description).toContain("Nova voted against Ember in Round 1");
      expect(metadata.openGraph?.images).toEqual([
        {
          url: "/games/edge-smoke-dusk/highlights/card-image/alliance-cut%3A1%3Aember",
          width: 1200,
          height: 630,
          alt: expect.stringContaining("Ember was cut from inside the pact"),
        },
      ]);
      expect((metadata.twitter as { card?: string } | null | undefined)?.card)
        .toBe("summary_large_image");
    } finally {
      if (originalApiBackendUrl === undefined) {
        delete process.env.API_BACKEND_URL;
      } else {
        process.env.API_BACKEND_URL = originalApiBackendUrl;
      }
      globalThis.fetch = originalFetch;
    }
  });

  it("renders a mini-highlight pack without needing one main thesis", () => {
    const fixture = mainCutFixture();
    const html = renderToString(
      <HouseHighlightsView
        gameSlug="edge-smoke-dusk"
        response={{
          ...fixture,
          highlights: {
            ...fixture.highlights,
            state: "mini_highlight_pack",
            thesis: null,
            cut: {
              kind: "mini_pack",
              title: "House Highlight Pack",
              thesis: null,
              shareCaption: "Standalone moments survived the evidence gate.",
              scenes: [],
            },
            scenes: [
              ...fixture.highlights.scenes,
              {
                ...fixture.highlights.scenes[0]!,
                id: "jury-judgment:final-vote",
                title: "The jury made the damage permanent",
                category: "jury_judgment",
                houseHook: "The final vote landed close enough for every ballot to matter.",
              },
            ],
          },
        }}
      />,
    );

    expect(html).toContain("Highlight Pack");
    expect(html).toContain("The House found sharp scenes, not one clean thesis.");
    expect(html).toContain("Ember was cut from inside the pact");
  });

  it("renders eligible no-cut artifacts without inventing scenes", () => {
    const fixture = mainCutFixture();
    const html = renderToString(
      <HouseHighlightsView
        gameSlug="edge-smoke-dusk"
        response={{
          ...fixture,
          highlights: {
            ...fixture.highlights,
            state: "no_cut",
            eligibility: {
              status: "eligible",
              reason: null,
              allianceReceiptCount: 2,
            },
            thesis: null,
            cut: null,
            scenes: [],
            noCutReason: "insufficient_scene_evidence",
          },
        }}
      />,
    );

    expect(html).toContain("The House declined the cut.");
    expect(html).toContain("Named-alliance facts exist");
    expect(html).toContain("Open results");
    expect(html).not.toContain("Scene 1");
  });

  it("renders unsupported artifacts without inventing alliance drama", () => {
    const fixture = mainCutFixture();
    const html = renderToString(
      <HouseHighlightsView
        gameSlug="edge-smoke-dusk"
        response={{
          ...fixture,
          highlights: {
            ...fixture.highlights,
            state: "unsupported_ineligible",
            eligibility: {
              status: "unsupported",
              reason: "missing_alliance_receipts",
              allianceReceiptCount: 0,
            },
            thesis: null,
            cut: null,
            scenes: [],
            noCutReason: "missing_alliance_receipts",
          },
        }}
      />,
    );

    expect(html).toContain("No V1 Highlights cut.");
    expect(html).toContain("will not invent alliance drama");
    expect(html).toContain("Open results");
    expect(html).not.toContain("Scene 1");
  });
});

function mainCutFixture(): HouseHighlightsResponse {
  return {
    ok: true,
    schemaVersion: 3,
    game: {
      id: "game-edge-smoke-dusk",
      slug: "edge-smoke-dusk",
      status: "completed",
      trackType: "custom",
      playerCount: 8,
      roundCount: 5,
    },
    highlights: {
      schemaVersion: 3,
      state: "main_cut",
      eligibility: {
        status: "eligible",
        reason: null,
        allianceReceiptCount: 2,
      },
      thesis: "This was the game where the pact collapsed one vote too late.",
      cut: {
        kind: "main",
        title: "House Cut",
        thesis: "This was the game where the pact collapsed one vote too late.",
        shareCaption: "The pact collapsed one vote too late.",
        scenes: [],
      },
      scenes: [{
        id: "alliance-cut:1:ember",
        title: "Ember was cut from inside the pact",
        category: "betrayal",
        involvedAgents: [
          { id: "ember", name: "Ember" },
          { id: "nova", name: "Nova" },
        ],
        houseHook: "Nova helped bury Ember.",
        setup: "Ember shared a named alliance before the vote turned.",
        conflict: "The pressure point came from inside the alliance record.",
        payoff: "Ember was eliminated in round 1.",
        receipts: [
          {
            id: "round:1:eliminated:ember",
            tier: "vote_record",
            label: "Round 1 elimination",
            description: "Ember was eliminated in round 1.",
            factRefs: ["round:1:eliminated:ember"],
          },
          {
            id: "alliance-cut:1:ember",
            tier: "alliance_receipt",
            label: "Alliance-member cut",
            description: "Nova voted out an alliance member.",
            factRefs: ["alliance:smoke-vote"],
          },
        ],
        deepLink: {
          surface: "results",
          label: "Open round result",
          round: 1,
          anchor: "round-1",
        },
        visualBrief: houseHighlightVisualBriefFixture({
            visualType: "betrayal_vote",
            templateLabel: "Betrayal vote",
            primaryAgents: [{ id: "ember", name: "Ember", avatarUrl: "https://cdn.example.test/avatars/ember.png" }],
            secondaryAgents: [{ id: "nova", name: "Nova", avatarUrl: "https://cdn.example.test/avatars/nova.png" }],
            backdrop: "abstract_vote_board",
          }),
          visualCard: houseHighlightVisualCardFixture({
            template: "hero_vote_action",
            title: "Ember was cut from inside the pact",
            eyebrow: "Betrayal vote",
            primaryAgents: [{
              id: "ember",
              name: "Ember",
              persona: "deceptive",
              avatarUrl: "https://cdn.example.test/avatars/ember.png",
              currentAgent: {
                name: "Ember Prime",
                avatarUrl: "https://cdn.example.test/avatars/ember-current.png",
                role: { key: "strategic", label: "Strategic" },
                competition: { gamesPlayed: 5, wins: 2, winRate: 0.4 },
              },
            }],
            secondaryAgents: [{ id: "nova", name: "Nova", avatarUrl: "https://cdn.example.test/avatars/nova.png" }],
            backdrop: "abstract_vote_board",
          facts: [
            "Nova voted against Ember in Round 1.",
            "Ember was eliminated in Round 1.",
          ],
        }),
      }],
      noCutReason: null,
      fallbackLinks: [
        { surface: "results", label: "Open results", round: null, anchor: "results" },
        { surface: "replay", label: "Open replay", round: 1, anchor: "replay" },
      ],
    },
  };
}
