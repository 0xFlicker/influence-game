import { describe, expect, it } from "bun:test";
import GameViewerPage from "../app/(site)/games/[slug]/page";
import GameReplayPage from "../app/(site)/games/[slug]/replay/page";

describe("game route compatibility redirects", () => {
  it("keeps replay identity and mode owned by the route", async () => {
    const page = await GameReplayPage({
      params: Promise.resolve({slug: "requested-game"}),
      searchParams: Promise.resolve({slug: "other-game", mode: "results", startSequence: "999", audience: "omniscient", cursor: "12"}),
    });
    expect(page.props).toEqual({slug: "requested-game", mode: "replay", audience: "omniscient", cursor: "12"});
  });

  it("redirects legacy results mode URLs to the route-owned results page", async () => {
    await expectLegacyModeRedirect("results", "/games/edge%20smoke%2Fdusk/results");
  });

  it("redirects legacy replay mode URLs to the route-owned replay page", async () => {
    await expectLegacyModeRedirect("replay", "/games/edge%20smoke%2Fdusk/replay");
  });
});

async function expectLegacyModeRedirect(mode: string, expectedPath: string): Promise<void> {
  try {
    await GameViewerPage({
      params: Promise.resolve({ slug: "edge smoke/dusk" }),
      searchParams: Promise.resolve({ mode }),
    });
    throw new Error("Expected legacy mode URL to redirect.");
  } catch (err) {
    const digest = typeof err === "object" && err && "digest" in err
      ? String((err as { digest?: unknown }).digest)
      : "";
    expect(digest).toContain("NEXT_REDIRECT");
    expect(digest).toContain(expectedPath);
  }
}
