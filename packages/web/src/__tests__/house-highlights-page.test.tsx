import { afterEach, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { HouseCutsView } from "../app/games/[slug]/highlights/house-cuts-client";
import { generateMetadata } from "../app/(site)/games/[slug]/highlights/page";
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
    expect(html).toContain(audience === "public" ? "/house-highlights/generated/" : "/visual/werewolf/");
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
  expect(JSON.stringify(metadata.title)).toContain("A Seer claim changes the argument");
  expect(JSON.stringify(metadata.title)).toContain("Full spoilers");
  expect(JSON.stringify(metadata.openGraph?.images)).toContain("?audience=omniscient");
});

test("shared Cut is a landing page with a single headline, background and working next steps", () => {
  const data = houseCutsFixture("mystery");
  const cut = data.publication!.cuts[0]!;
  cut.replayHref = null;
  const html = renderToString(<HouseCutsView slug={data.game.slug} data={data} selectedId={cut.id} />);
  expect(html.match(/<h1/g)).toHaveLength(1);
  expect(html).toContain("/visual/werewolf/");
  expect(html).not.toContain("/house-highlights/generated/");
  expect(html).toContain('href="/agents/create"');
  expect(html).toContain('href="/games/edge-smoke-dusk/replay?audience=mystery"');
  expect(html).toContain("Watch the replay");
  expect(html).toContain("Explore this game");
  expect(html).not.toContain("Open Cut");
  expect(html).not.toContain("audience=omniscient");
});
