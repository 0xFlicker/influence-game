import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type { HouseHighlightsResponse } from "../lib/api";
import { HouseHighlightsView } from "../app/games/[slug]/components/house-highlights-view";

describe("HouseHighlightsView", () => {
  it("renders a shareable House Cut with receipts and proof links", () => {
    const html = renderToString(
      <HouseHighlightsView response={mainCutFixture()} gameSlug="edge-smoke-dusk" />,
    );

    expect(html).toContain("House Cut");
    expect(html).toContain("This was the game where the pact collapsed one vote too late.");
    expect(html).toContain("Ember was cut from inside the pact");
    expect(html).toContain("Vote record");
    expect(html).toContain("Alliance receipt");
    expect(html).toContain("/games/edge-smoke-dusk/results#round-1");
    expect(html).toContain("/games/edge-smoke-dusk/replay");
    expect(html).not.toContain("High confidence");
    expect(html).not.toContain("scene House Cut");
    expect(html).not.toContain("rejectedCandidates");
    expect(html).not.toContain("sourcePointers");
    expect(html).not.toContain("payloadVersion");
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
                houseHook: "The final vote landed close enough to hear every receipt.",
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
    expect(html).toContain("Alliance receipts exist");
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
    schemaVersion: 1,
    game: {
      id: "game-edge-smoke-dusk",
      slug: "edge-smoke-dusk",
      status: "completed",
      trackType: "custom",
      playerCount: 8,
      roundCount: 5,
    },
    highlights: {
      schemaVersion: 1,
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
        conflict: "The pressure point came from inside the receipt trail.",
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
        posterDirection: "Vote card split across the alliance line.",
      }],
      noCutReason: null,
      fallbackLinks: [
        { surface: "results", label: "Open results", round: null, anchor: "results" },
        { surface: "replay", label: "Open replay", round: 1, anchor: "replay" },
      ],
    },
  };
}
