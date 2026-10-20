import { test, expect } from "bun:test";
import { bundlePath, fetchReplay, ReplayAssets } from "./assets";
import {influenceOpening} from "../../app/games/[slug]/components/influence-opening";
test("bundle paths cannot escape into arbitrary local files", () => {
  for (const path of ["../secret", "/etc/passwd", "."])
    expect(() => bundlePath("/tmp/bundle", path)).toThrow();
  expect(bundlePath("/tmp/bundle", "assets/abc")).toBe(
    "/tmp/bundle/assets/abc",
  );
});

test("Influence opening freezes every media reference instead of reading the live public tree", async () => {
  const visited: string[] = [];
  class RecordingAssets extends ReplayAssets {
    override async cache(source: string) {
      visited.push(source);
      return `assets/frozen-${visited.length}`;
    }
  }
  const assets = new RecordingAssets("/tmp/unused-bundle", "/tmp/unused-public", new URL("http://localhost"), new AbortController().signal);
  const cue = influenceOpening("g",[{id:"a",name:"A",avatarUrl:"/avatar.png"}])[2]!;
  const picture = await assets.freeze({kind:"influence-opening",cue,fullBodyUrl:"/body.png",portraitUrl:"/portrait.png",fallbackPortraitUrl:"/fallback.png"});
  expect(visited).toEqual(expect.arrayContaining([
    cue.opening.backgroundUrl, cue.opening.entranceVideoUrl, cue.opening.posterUrl,
    cue.opening.logoUrl, cue.opening.musicUrl, "/avatar.png", "/body.png", "/portrait.png", "/fallback.png",
  ]));
  expect(visited).toHaveLength(9);
  expect(picture.cue.opening.entranceVideoUrl).toStartWith("assets/");
  expect(picture.cue.opening.musicUrl).toStartWith("assets/");
  expect(picture.fullBodyUrl).toStartWith("assets/");
});
test("API credentials do not follow an asset redirect to another origin", async () => {
  let received: string | null = null,
    authorized = false;
  const target = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      received = request.headers.get("authorization");
      return new Response("image");
    },
  });
  const source = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      authorized = request.headers.get("authorization") === "Bearer test-only";
      return Response.redirect(target.url, 302);
    },
  });
  try {
    await fetchReplay(
      source.url,
      source.url,
      "test-only",
      AbortSignal.timeout(5000),
    );
    expect(authorized).toBe(true);
    expect(received).toBeNull();
  } finally {
    source.stop(true);
    target.stop(true);
  }
});
