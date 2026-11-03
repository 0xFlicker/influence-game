import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderToStaticMarkup } from "react-dom/server";
import { createFormatKernelViewerScenario } from "@influence/engine/fixtures/format-kernel-viewer";
import { completedWerewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { projectWerewolfProductionWatch } from "@influence/engine/werewolf/watch";
import { configuredPublicMediaDelivery, publicMediaDeliveryView, resolvePublicMediaUrl } from "./public-media-delivery";
import { fetchReplay, ReplayAssets, sha256 } from "./replay-export/assets";
import { buildExportCues } from "./replay-export/cues";
import { resolveAgentAvatarUrl } from "../components/agent-avatar";
import { VisualPresentationFrame } from "../app/games/[slug]/components/visual-presentation";
import { WerewolfContentFrame } from "../components/games/werewolf/werewolf-watch-stage";
import { werewolfMomentCues } from "../components/games/werewolf/werewolf-watch-model";
import type { GameWatchReplayFrame } from "./api";

const old = "https://influence-assets-stg.us-iad-10.linodeobjects.com";
const target = "https://assets-staging.thehouse.game";
const keys = ["NEXT_PUBLIC_HOUSE_OBJECT_STORAGE_PROVIDER", "NEXT_PUBLIC_HOUSE_PUBLIC_BASE_URL", "NEXT_PUBLIC_HOUSE_LEGACY_PUBLIC_BASE_URLS"];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.NEXT_PUBLIC_HOUSE_OBJECT_STORAGE_PROVIDER = "aws";
  process.env.NEXT_PUBLIC_HOUSE_PUBLIC_BASE_URL = target;
  process.env.NEXT_PUBLIC_HOUSE_LEGACY_PUBLIC_BASE_URLS = `${old},https://us-iad-10.linodeobjects.com/influence-assets-stg`;
});
afterEach(() => { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

test("exact public origins preserve keys and reject cross-environment or credential URLs", () => {
  expect(resolvePublicMediaUrl(`${old}/pfp/a%20%23.png?X-Amz-Signature=expired`)).toBe(`${target}/pfp/a%20%23.png`);
  expect(resolvePublicMediaUrl("https://us-iad-10.linodeobjects.com/influence-assets-stg/characters/a.png")).toBe(`${target}/characters/a.png`);
  expect(resolvePublicMediaUrl(`${old}/postgame-media/a.mp4?view=preview&X-Amz-Signature=expired#t=1`)).toBe(`${target}/postgame-media/a.mp4?view=preview#t=1`);
  expect(() => resolvePublicMediaUrl(`${old}/pfp/a.png?versionId=retained-source-version`)).toThrow("retained-version mapping");
  for (const url of ["https://influence-assets-prd.us-iad-10.linodeobjects.com/pfp/a.png", `${old}.evil.test/pfp/a.png`, `${old}/pfp/%2e%2e%2fprivate`, `https://user:secret@${new URL(old).host}/pfp/a.png`, "/api/private/image", "assets/pinned-image"]) expect(resolvePublicMediaUrl(url)).toBe(url);
});

test("incomplete AWS delivery fails instead of silently fetching the old origin", () => {
  delete process.env.NEXT_PUBLIC_HOUSE_PUBLIC_BASE_URL;
  expect(() => configuredPublicMediaDelivery()).toThrow();
  delete process.env.NEXT_PUBLIC_HOUSE_OBJECT_STORAGE_PROVIDER;
  expect(resolvePublicMediaUrl(`${old}/pfp/a.png`)).toBe(`${old}/pfp/a.png`);
});

test("a display view preserves canonical source identity, map keys, prose and hashes", () => {
  const source = { sourceHash: "sha256:" + "a".repeat(64), avatarUrl: `${old}/pfp/a.png`, fullBodies: { a: `${old}/characters/a.png` }, assets: { [`${old}/pfp/a.png`]: "original-byte-hash" }, text: `${old}/pfp/a.png`, settings: { fps: 30 } };
  const before = JSON.stringify(source), hash = sha256(before);
  const view = publicMediaDeliveryView(source);
  expect(view.avatarUrl).toBe(`${target}/pfp/a.png`);
  expect(view.fullBodies.a).toBe(`${target}/characters/a.png`);
  expect(view.assets).toEqual(source.assets);
  expect(view.text).toBe(source.text);
  expect(view.sourceHash).toBe(source.sourceHash);
  expect(sha256(JSON.stringify(source))).toBe(hash);
  expect(resolveAgentAvatarUrl(source.avatarUrl, "", "Synthetic")).toBe(view.avatarUrl);
});

test("replay redirects resolve before authentication and never forward the API token to the CDN", async () => {
  const requests: Request[] = [];
  const fake = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init); requests.push(request);
    return request.url.startsWith("https://api.example.test") ? Response.redirect(`${old}/pfp/a.png`, 302) : new Response("synthetic");
  }, { preconnect: () => {} });
  const api = new URL("https://api.example.test");
  await fetchReplay(new URL("/api/media", api), api, "synthetic-api-token", AbortSignal.timeout(5000), fake);
  expect(requests.map(row => row.url)).toEqual(["https://api.example.test/api/media", `${target}/pfp/a.png`]);
  expect(requests[0]!.headers.get("Authorization")).toBe("Bearer synthetic-api-token");
  expect(requests[1]!.headers.has("Authorization")).toBe(false);
});

test("fresh replay asset preparation fetches identical bytes through the alias and retains the frozen input", async () => {
  const root = await mkdtemp(join(tmpdir(), "house-delivery-fixture-"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  const seen: string[] = [];
  const fake = Object.assign(async (input: Parameters<typeof fetch>[0]) => { seen.push(String(input)); return new Response(png, { headers: { "Content-Type": "image/png" } }); }, { preconnect: () => {} });
  try {
    const assets = new ReplayAssets(root, root, new URL("https://api.example.test"), AbortSignal.timeout(10000), "synthetic-api-token", fake);
    const source = { sourceHash: "sha256:" + "b".repeat(64), avatarUrl: `${old}/pfp/fixture.png` };
    const before = JSON.stringify(source);
    const frozen = await assets.freeze(source);
    expect(seen).toEqual([`${target}/pfp/fixture.png`]);
    expect(frozen.avatarUrl).toBe(`assets/${sha256(png)}`);
    expect(await readFile(join(root, frozen.avatarUrl))).toEqual(png);
    expect(assets.table[frozen.avatarUrl]?.sha256).toBe(sha256(png));
    expect(JSON.stringify(source)).toBe(before);
    expect(frozen.sourceHash).toBe(source.sourceHash);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the shared Influence presentation renderer resolves frozen portraits without changing the cue", () => {
  const fixture = createFormatKernelViewerScenario("safety_bounce_tie");
  const players = fixture.roster.map(player => ({ ...player, persona: "", avatarUrl: `${old}/pfp/${player.id}.png`, status: "alive" as const, shielded: false }));
  const frames: GameWatchReplayFrame[] = fixture.decisions.map(event => ({ schemaVersion: 3, gameId: "g", slug: "g", sequence: event.sequence, eventType: event.type, timestamp: Date.parse(event.timestamp), round: event.round, phase: event.phase ?? "INIT", players, viewerDecisionEvent: event, counts: { totalPlayers: players.length, alivePlayers: players.length, eliminatedPlayers: 0, unknownPlayers: 0 } }));
  const cues = buildExportCues({ kind: "influence", game: { id: "g", slug: "g", status: "completed", gameKernel: "format", players }, messages: [], frames, thoughts: {}, visual: { enabled: false, status: null, portraits: {}, scenes: [] } });
  const item = cues.find(cue => cue.picture.kind === "influence" && cue.picture.beat?.kind === "safety-chain")!;
  if (item.picture.kind !== "influence" || !item.picture.beat) throw new Error("Missing fixture");
  const before = JSON.stringify(item);
  const markup = renderToStaticMarkup(<VisualPresentationFrame beat={item.picture.beat} rooms={item.picture.rooms} roster={item.picture.roster} elapsedMs={1200} reducedMotion />);
  expect(markup).toContain(`${target}/pfp/`);
  expect(markup).not.toContain(old);
  expect(JSON.stringify(item)).toBe(before);
});

test("a Werewolf dissolve resolves both current and retained neighbor images", async () => {
  const events = await completedWerewolfResultsFixture("village", "storage-delivery-dissolve");
  const projected = projectWerewolfProductionWatch(events, "mystery");
  const cues = buildExportCues({ kind: "werewolf", windows: [{ ...projected, audience: "mystery", status: "completed", slug: "fixture", publicationCutoff: "now", media: {} }], thoughts: [] });
  const item = cues.find(cue => cue.picture.kind === "werewolf")!;
  if (item.picture.kind !== "werewolf") throw new Error("Missing fixture");
  const source = structuredClone(item.picture.cue.moment);
  source.chapterId = "introduction";
  source.mediaKey = null;
  for (const player of source.snapshot.players) player.fullBodyReferenceUrl = `${old}/characters/${player.id}.png`;
  const [first, second] = source.snapshot.players;
  if (!first || !second) throw new Error("Missing players");
  const make = (actorId: string, cursor: number) => werewolfMomentCues({ ...source, cursor, entry: { kind: "speech", day: 0, actorId, audience: "public", text: "Synthetic introduction.", cue: null } })[0]!;
  const previousCue = make(first.id, 1), cue = make(second.id, 2);
  const before = JSON.stringify({ previousCue, cue });
  const markup = renderToStaticMarkup(<WerewolfContentFrame cue={cue} previousCue={previousCue} scene={null} elapsed={100} reduced={false} />);
  expect(markup).toContain('data-solo-layer="outgoing"');
  expect(markup).toContain(`${target}/characters/${first.id}.png`);
  expect(markup).toContain(`${target}/characters/${second.id}.png`);
  expect(markup).not.toContain(old);
  expect(JSON.stringify({ previousCue, cue })).toBe(before);
});

test("the shared Werewolf result renderer resolves historical portraits without changing its source", async () => {
  const events = await completedWerewolfResultsFixture("village", "storage-delivery-fixture");
  const projected = projectWerewolfProductionWatch(events, "mystery");
  const cues = buildExportCues({ kind: "werewolf", windows: [{ ...projected, audience: "mystery", status: "completed", slug: "fixture", publicationCutoff: "now", media: {} }], thoughts: [] });
  const item = cues.find(cue => cue.picture.kind === "werewolf" && !cue.picture.cue.ballot && !cue.picture.cue.reprise && cue.picture.cue.moment.entry.kind === "vote" && Boolean(cue.picture.cue.moment.entry.result.eliminatedId))!;
  if (item.picture.kind !== "werewolf") throw new Error("Missing fixture");
  for (const player of item.picture.cue.moment.snapshot.players) player.fullBodyReferenceUrl = `${old}/characters/${player.id}.png`;
  const before = JSON.stringify(item);
  const markup = renderToStaticMarkup(<WerewolfContentFrame cue={item.picture.cue} scene={null} elapsed={6000} reduced />);
  expect(markup).toContain(`${target}/characters/`);
  expect(markup).not.toContain(old);
  expect(JSON.stringify(item)).toBe(before);
});
