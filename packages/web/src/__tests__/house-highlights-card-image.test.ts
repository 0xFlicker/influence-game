import { afterEach, describe, expect, it } from "bun:test";
import type { HouseHighlightsResponse } from "../lib/api";
import { sceneForCardImage } from "../app/games/[slug]/highlights/card-image/card-image-data";
import {
  avatarSrcForImage,
  generatedBackgroundForImage,
  GET,
} from "../app/games/[slug]/highlights/card-image/[sceneId]/route";
import {
  houseHighlightVisualBriefFixture,
  houseHighlightVisualCardFixture,
} from "./house-highlights-fixtures";

const originalApiBackendUrl = process.env.API_BACKEND_URL;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalApiBackendUrl === undefined) {
    delete process.env.API_BACKEND_URL;
  } else {
    process.env.API_BACKEND_URL = originalApiBackendUrl;
  }
  globalThis.fetch = originalFetch;
});

describe("house highlights card image", () => {
  it("finds scenes by encoded share image ids", () => {
    const scene = sceneForCardImage(mainCutFixture(), "alliance-cut%3A1%3Aember");

    expect(scene?.id).toBe("alliance-cut:1:ember");
    expect(scene?.visualCard.factLines.map((fact) => fact.text)).toContain(
      "Nova voted against Ember in Round 1.",
    );
  });

  it("returns null for missing scenes", () => {
    expect(sceneForCardImage(mainCutFixture(), "missing-scene")).toBeNull();
  });

  it("resolves relative avatar URLs against the server API origin for share images", () => {
    process.env.API_BACKEND_URL = "http://127.0.0.1:3333";

    expect(avatarSrcForImage("/api/uploads/local?key=avatars/ember.png")).toBe(
      "http://127.0.0.1:3333/api/uploads/local?key=avatars/ember.png",
    );
    expect(avatarSrcForImage("https://cdn.example.test/avatars/ember.png")).toBe(
      "https://cdn.example.test/avatars/ember.png",
    );
    expect(avatarSrcForImage("/avatars/personas/strategic.png", "http://localhost:3001/card.png")).toBe(
      "http://localhost:3001/avatars/personas/strategic.png",
    );
  });

  it("resolves generated backgrounds against the share image origin", () => {
    expect(generatedBackgroundForImage("betrayal_vote", "http://localhost:3001/card.png")).toBe(
      "http://localhost:3001/house-highlights/generated/betrayal-vote.jpg",
    );
    expect(generatedBackgroundForImage("mystery_visual", "http://localhost:3001/card.png")).toBeNull();
  });

  it("renders a png response for a valid scene without auth headers", async () => {
    process.env.API_BACKEND_URL = "http://127.0.0.1:3333";
    let requestedHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (
      _url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      requestedHeaders = init?.headers;
      return new Response(JSON.stringify(mainCutFixture()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const response = await GET(new Request("http://example.test/card.png"), {
      params: Promise.resolve({
        slug: "edge-smoke-dusk",
        sceneId: "alliance-cut%3A1%3Aember",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
    expect(JSON.stringify(requestedHeaders)).not.toContain("Authorization");
  });

  it("renders a generic png for missing scenes without exposing diagnostics", async () => {
    process.env.API_BACKEND_URL = "http://127.0.0.1:3333";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(mainCutFixture()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const response = await GET(new Request("http://example.test/card.png"), {
      params: Promise.resolve({
        slug: "edge-smoke-dusk",
        sceneId: "missing-scene",
      }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("image/png");
  });

  it("does not cache transient card image failures", async () => {
    process.env.API_BACKEND_URL = "http://127.0.0.1:3333";
    globalThis.fetch = (async () =>
      new Response("Unavailable", { status: 503 })) as unknown as typeof fetch;

    const response = await GET(new Request("http://example.test/card.png"), {
      params: Promise.resolve({
        slug: "edge-smoke-dusk",
        sceneId: "alliance-cut%3A1%3Aember",
      }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

function mainCutFixture(): HouseHighlightsResponse {
  return {
    ok: true,
    schemaVersion: 2,
    game: {
      id: "game-edge-smoke-dusk",
      slug: "edge-smoke-dusk",
      status: "completed",
      trackType: "custom",
      playerCount: 8,
      roundCount: 5,
    },
    highlights: {
      schemaVersion: 2,
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
        conflict: "The pressure point came from inside the public record.",
        payoff: "Ember was eliminated in round 1.",
        receipts: [{
          id: "round:1:eliminated:ember",
          tier: "vote_record",
          label: "Round 1 elimination",
          description: "Ember was eliminated in round 1.",
          factRefs: ["round:1:eliminated:ember"],
        }],
        deepLink: {
          surface: "results",
          label: "Open round result",
          round: 1,
          anchor: "round-1",
        },
        visualBrief: houseHighlightVisualBriefFixture({
          visualType: "betrayal_vote",
          templateLabel: "Betrayal vote",
          primaryAgents: [{ id: "ember", name: "Ember", avatarUrl: "/api/uploads/local?key=avatars/ember.png" }],
          secondaryAgents: [{ id: "nova", name: "Nova", avatarUrl: "https://cdn.example.test/avatars/nova.png" }],
          backdrop: "abstract_vote_board",
        }),
        visualCard: houseHighlightVisualCardFixture({
          template: "hero_vote_action",
          title: "Ember was cut from inside the pact",
          eyebrow: "Betrayal vote",
          primaryAgents: [{ id: "ember", name: "Ember", avatarUrl: "/api/uploads/local?key=avatars/ember.png" }],
          secondaryAgents: [{ id: "nova", name: "Nova", avatarUrl: "https://cdn.example.test/avatars/nova.png" }],
          backdrop: "abstract_vote_board",
          facts: [
            "Nova voted against Ember in Round 1.",
            "Ember was eliminated in Round 1.",
          ],
        }),
      }],
      noCutReason: null,
      fallbackLinks: [],
    },
  };
}
