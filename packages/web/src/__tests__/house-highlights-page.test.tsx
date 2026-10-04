import { afterEach, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { HouseCutsView } from "../app/games/[slug]/highlights/house-cuts-client";
import { generateMetadata } from "../app/games/[slug]/highlights/page";
import { houseCutsFixture } from "./house-cuts-fixture";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
test("shared gallery renders selected cards and audience-specific links for both games", () => {
  for (const audience of ["public", "mystery", "omniscient"] as const) {
    const data = houseCutsFixture(audience);
    const html = renderToString(<HouseCutsView slug={data.game.slug} data={data} />);
    expect(html).toContain("A Seer claim changes the argument");
    expect(html).toContain("Watch this moment");
    expect(html).toContain(`scene=v1-1&amp;audience=${audience}`);
    expect(html).not.toContain("rationale");
  }
});
test("empty, failed, unprepared and crossed-audience cards never invent content", () => {
  const data = houseCutsFixture("mystery");
  expect(renderToString(<HouseCutsView slug="x" data={data} selectedId="other-audience-1" />)).not.toContain("A Seer claim changes");
  for (const status of ["not_prepared", "pending", "failed", "ready"] as const) {
    const html = renderToString(<HouseCutsView slug="x" data={{ ...data, status, publication: null }} />);
    expect(html).not.toContain("A Seer claim changes");
    expect(html).toContain(status === "ready" ? "No House Cuts" : status === "failed" ? "couldn’t" : status === "pending" ? "aren’t ready" : "not been prepared");
  }
});
test("share metadata uses published text and preserves explicit spoiler audience", async () => {
  globalThis.fetch = (async () => Response.json(houseCutsFixture("omniscient"))) as unknown as typeof fetch;
  const metadata = await generateMetadata({ params: Promise.resolve({ slug: "edge-smoke-dusk" }), searchParams: Promise.resolve({ scene: "v1-1", audience: "omniscient" }) });
  expect(metadata.title).toContain("A Seer claim changes the argument");
  expect(metadata.title).toContain("Full spoilers");
  expect(JSON.stringify(metadata.openGraph?.images)).toContain("?audience=omniscient");
});
