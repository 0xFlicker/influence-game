import { describe, expect, it } from "bun:test";
import type { HouseHighlightsResponse } from "../lib/api";
import { buildHouseHighlightsViewModel } from "../app/games/[slug]/components/house-highlights-model";

describe("house highlights model", () => {
  it("maps a main House Cut into scene cards with proof links", () => {
    const model = buildHouseHighlightsViewModel(mainCutFixture(), "edge-smoke-dusk");

    expect(model.badge).toBe("House Cut");
    expect(model.title).toBe("This was the game where the pact collapsed one vote too late.");
    expect(model.scenes[0]).toMatchObject({
      categoryLabel: "Betrayal",
      receiptSummary: "Vote record + Alliance receipt",
      proofLink: {
        href: "/games/edge-smoke-dusk/results#round-1",
        surface: "results",
      },
    });
  });

  it("encodes proof links for unusual game slugs", () => {
    const model = buildHouseHighlightsViewModel(mainCutFixture(), "edge smoke/dusk");

    expect(model.scenes[0]?.proofLink.href).toBe("/games/edge%20smoke%2Fdusk/results#round-1");
  });

  it("keeps no-cut states honest and points back to proof surfaces", () => {
    const fixture = mainCutFixture();
    const model = buildHouseHighlightsViewModel({
      ...fixture,
      highlights: {
        ...fixture.highlights,
        state: "no_cut",
        thesis: null,
        cut: null,
        scenes: [],
        noCutReason: "insufficient_scene_evidence",
      },
    }, "edge-smoke-dusk");

    expect(model.showNoCutState).toBe(true);
    expect(model.badge).toBe("No Cut");
    expect(model.noCutMessage).toContain("Alliance receipts exist");
    expect(model.fallbackLinks.map((link) => link.href)).toEqual([
      "/games/edge-smoke-dusk/results#results",
      "/games/edge-smoke-dusk/replay#replay",
    ]);
  });
});

export function mainCutFixture(): HouseHighlightsResponse {
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
        allianceReceiptCount: 3,
      },
      thesis: "This was the game where the pact collapsed one vote too late.",
      cut: {
        kind: "main",
        title: "House Cut",
        thesis: "This was the game where the pact collapsed one vote too late.",
        shareCaption: "The pact collapsed one vote too late.",
        scenes: [],
      },
      scenes: [
        {
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
        },
        {
          id: "alliance-formation:smoke-vote",
          title: "Smoke Vote Pair made the pact visible",
          category: "loyalty",
          involvedAgents: [
            { id: "ember", name: "Ember" },
            { id: "nova", name: "Nova" },
          ],
          houseHook: "Smoke Vote Pair left receipts before the room turned.",
          setup: "Smoke Vote Pair formed around Ember and Nova.",
          conflict: "The pact had to turn into public consequences.",
          payoff: "The alliance became the receipt that made the later turn legible.",
          receipts: [{
            id: "alliance:smoke-vote",
            tier: "alliance_receipt",
            label: "Smoke Vote Pair",
            description: "Named alliance with a recorded huddle outcome.",
            factRefs: ["alliance:smoke-vote"],
          }],
          deepLink: {
            surface: "results",
            label: "Open alliance receipts",
            round: 1,
            anchor: "round-1",
          },
          posterDirection: "Alliance title card.",
        },
        {
          id: "jury-judgment:final-vote",
          title: "The jury made the damage permanent",
          category: "jury_judgment",
          involvedAgents: [
            { id: "lilith", name: "Lilith" },
            { id: "shadowtech", name: "Shadowtech" },
          ],
          houseHook: "The final vote landed 4-3.",
          setup: "The social record had to survive the jury.",
          conflict: "Lilith and Shadowtech split the room into a final judgment.",
          payoff: "Lilith won by one vote.",
          receipts: [{
            id: "jury:final-vote",
            tier: "vote_record",
            label: "Final jury vote",
            description: "Final vote: 4-3.",
            factRefs: ["jury:final-vote"],
          }],
          deepLink: {
            surface: "results",
            label: "Open jury result",
            round: null,
            anchor: "jury",
          },
          posterDirection: "Final vote graphic.",
        },
      ],
      noCutReason: null,
      fallbackLinks: [
        { surface: "results", label: "Open results", round: null, anchor: "results" },
        { surface: "replay", label: "Open replay", round: 1, anchor: "replay" },
      ],
    },
  };
}
