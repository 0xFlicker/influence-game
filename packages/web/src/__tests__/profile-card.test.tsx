import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderAgentCard, renderPlayerCard, publicAgentId, profileCardQueue } from "../lib/profile-card";
import { getProfileShareMetadata } from "../lib/server-share-metadata";
import type { PublicAgentProfile, PublicPlayerProfile } from "../lib/api";
import { GET as getAgentCard } from "../app/(site)/agents/[id]/card-image/route";
import { GET as getPlayerCard } from "../app/(site)/profile/[id]/card-image/route";

const agent: PublicAgentProfile = { name: "Test Agent", profileHref: "/agents/agent-1", avatarUrl: null, role: null,
  owner: null, competition: { gamesPlayed: 0, wins: 0, winRate: 0 }, awards: [], recentResults: [] };
const player: PublicPlayerProfile = { identity: { publicId: "p1", handle: "player", displayName: "Test Player" }, currentSeason: null,
  career: { rating: 1000, peakRating: 1000, gamesPlayed: 0, wins: 0, winRate: 0 }, recentResults: [], agents: [agent] };

test("cards render PNGs using only fixed public artwork routes, preferring the body for agents", async () => {
  const original = globalThis.fetch, requests: string[] = [];
  const png = await readFile(`${import.meta.dir}/../../public/avatars/personas/strategic.png`);
  globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requests.push(String(url));
    expect(init?.redirect).toBe("error");
    return new Response(png, { headers: { "content-type": "image/png" } });
  }) as typeof fetch;
  try {
    const image = await renderAgentCard(agent);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEndWith("/api/public/agents/agent-1/art?kind=body");
    const playerImage = await renderPlayerCard(player);
    expect((await playerImage.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect(requests[2]).toEndWith("/api/public/agents/agent-1/art?kind=portrait");
    const farcaster = Buffer.from(await (await renderPlayerCard(player, true)).arrayBuffer());
    expect(farcaster.readUInt32BE(16)).toBe(1200);
    expect(farcaster.readUInt32BE(20)).toBe(800);
    expect((await (await renderAgentCard({ ...agent, name: "W".repeat(32) })).arrayBuffer()).byteLength).toBeGreaterThan(1000);
  } finally { globalThis.fetch = original; }
});

test("profile image endpoint returns a retryable error when its rendering queue is full", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const active = Array.from({ length: 11 }, (_, i) => profileCardQueue.run(`busy-${i}`, async () => { await gate; return new Response(); }));
  try {
    const response = await getAgentCard(new Request("https://thehouse.game/agents/agent-1/card-image"), { params: Promise.resolve({ id: "agent-1" }) });
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
  } finally { release(); await Promise.all(active); }
});

test("agent cards use a public headshot if no transparent body is available", async () => {
  const original = globalThis.fetch, requests: string[] = [];
  const png = await readFile(`${import.meta.dir}/../../public/avatars/personas/strategic.png`);
  globalThis.fetch = Object.assign(async (url: Parameters<typeof fetch>[0]) => {
    requests.push(String(url));
    return String(url).endsWith("kind=body") ? new Response(null, { status: 404 }) : new Response(png, { headers: { "content-type": "image/png" } });
  }, { preconnect: original.preconnect });
  try {
    expect((await (await renderAgentCard(agent)).arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect(requests.map(url => new URL(url).searchParams.get("kind"))).toEqual(["body", "portrait", "portrait"]);
  } finally { globalThis.fetch = original; }
});

test("player cards leave artwork capacity for other requests", async () => {
  const original = globalThis.fetch;
  const png = await readFile(`${import.meta.dir}/../../public/avatars/personas/strategic.png`);
  let active = 0, peak = 0;
  globalThis.fetch = Object.assign(async () => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return new Response(png, { headers: { "content-type": "image/png" } });
  }, { preconnect: original.preconnect });
  try {
    const agents = Array.from({ length: 4 }, (_, i) => ({ ...agent, profileHref: `/agents/agent-${i}` }));
    expect((await (await renderPlayerCard({ ...player, agents })).arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect(peak).toBe(1);
  } finally { globalThis.fetch = original; }
});

test("profile cards render only earned public award marks in both image formats", async () => {
  const original = globalThis.fetch;
  const png = await readFile(`${import.meta.dir}/../../public/avatars/personas/strategic.png`);
  globalThis.fetch = Object.assign(async () => new Response(png, { headers: { "content-type": "image/png" } }), { preconnect: original.preconnect });
  const award = (id: string, code: string, theme = "season-0") => ({ id, code, theme, title: id, awardedAt: "2026-11-03", sourceSeasonId: "season", sourceEventId: null });
  const awards = [award("one", "participant"), award("two", "top-eight"), award("three", "werewolf-champion"), award("four", "influence-champion"), award("five", "future", "future")];
  const render = async (value: Response) => Buffer.from(await value.arrayBuffer());
  try {
    for (const farcaster of [false, true]) {
      const empty = await render(await renderAgentCard(agent, farcaster));
      const marked = await render(await renderAgentCard({ ...agent, awards: [awards[0]!] }, farcaster));
      expect(marked.equals(empty)).toBe(false);
      const four = await render(await renderPlayerCard({ ...player, awards: awards.slice(0, 4) }, farcaster));
      const five = await render(await renderPlayerCard({ ...player, awards }, farcaster));
      expect(five.equals(four)).toBe(false);
      const six = await render(await renderPlayerCard({ ...player, awards: [...awards, award("six", "future", "future")] }, farcaster));
      expect(six.equals(five)).toBe(false);
      const generic = await render(await renderPlayerCard({ ...player, awards: [awards[4]!] }, farcaster));
      const noAwards = await render(await renderPlayerCard(player, farcaster));
      expect(generic.equals(noAwards)).toBe(false);
    }
  } finally { globalThis.fetch = original; }
}, 90_000);

test("card renderer rejects artwork withdrawn while rendering", async () => {
  const original = globalThis.fetch;
  const png = await readFile(`${import.meta.dir}/../../public/avatars/personas/strategic.png`);
  let reads = 0;
  globalThis.fetch = Object.assign(async () => ++reads === 1
    ? new Response(png, { headers: { "content-type": "image/png" } })
    : new Response(null, { status: 404 }), { preconnect: original.preconnect });
  try { await expect(renderAgentCard(agent)).rejects.toThrow("artwork changed"); }
  finally { globalThis.fetch = original; }
});

test("agent image endpoint rechecks public visibility after rendering", async () => {
  const original = globalThis.fetch;
  const png = await readFile(`${import.meta.dir}/../../public/avatars/personas/strategic.png`);
  let profiles = 0;
  globalThis.fetch = Object.assign(async (url: Parameters<typeof fetch>[0]) => {
    if (String(url).includes("/art?")) return new Response(png, { headers: { "content-type": "image/png" } });
    return ++profiles === 1 ? Response.json({ schemaVersion: 1, status: "found", profile: agent }) : new Response("not found", { status: 404 });
  }, { preconnect: original.preconnect });
  try {
    const response = await getAgentCard(new Request("https://thehouse.game/agents/agent-1/card-image"), { params: Promise.resolve({ id: "agent-1" }) });
    expect(response.status).toBe(404);
    expect(profiles).toBe(2);
  } finally { globalThis.fetch = original; }
});

test("agent and player cards reject an award revoked during rendering", async () => {
  const original = globalThis.fetch;
  const png = await readFile(`${import.meta.dir}/../../public/avatars/personas/strategic.png`);
  const award = { id: "award", code: "season-0-account-participant", theme: "season-0", title: "Season 0 Participant", awardedAt: "2026-11-03", sourceSeasonId: "season", sourceEventId: null };
  try {
    for (const kind of ["agent", "player"] as const) {
      let reads = 0;
      globalThis.fetch = Object.assign(async (url: Parameters<typeof fetch>[0]) => {
        if (String(url).includes("/art?")) return new Response(png, { headers: { "content-type": "image/png" } });
        const profile = kind === "agent" ? agent : player;
        return Response.json({ schemaVersion: 1, status: "found", profile: { ...profile, awards: ++reads === 1 ? [award] : [] } });
      }, { preconnect: original.preconnect });
      const request = new Request(`https://thehouse.game/${kind}/id/card-image`);
      const context = { params: Promise.resolve({ id: "id" }) };
      const response = kind === "agent" ? await getAgentCard(request, context) : await getPlayerCard(request, context);
      expect(reads).toBe(2);
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("1");
    }
  } finally { globalThis.fetch = original; }
});

test("profile short-link metadata points at the same player card and rejects unsafe roster references", async () => {
  expect(publicAgentId("https://evil.test/agents/agent-1")).toBeNull();
  expect(publicAgentId("/agents/../private")).toBeNull();
  const original = globalThis.fetch;
  globalThis.fetch = Object.assign(async () => Response.json({ schemaVersion: 1, status: "found", profile: player }), { preconnect: original.preconnect });
  try {
    const metadata = await getProfileShareMetadata("p1");
    expect(JSON.stringify(metadata.openGraph?.images)).toContain("/profile/player/card-image");
    expect(JSON.stringify(metadata.twitter)).toContain("summary_large_image");
  } finally { globalThis.fetch = original; }
});
