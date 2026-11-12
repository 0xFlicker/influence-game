import { expect, spyOn, test } from "bun:test";

test("short results share keeps a static spoiler-free card and launches the short resolver", async () => {
  const {workAsyncStorage} = await import("next/dist/server/app-render/work-async-storage.external");
  const {generateMetadata} = await import("../app/s/[code]/page");
  const originalFetch = globalThis.fetch, originalOrigin = process.env.WEB_BASE_URL;
  process.env.WEB_BASE_URL = "https://thehouse.game";
  const requests: string[] = [];
  globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input); requests.push(url);
    if (url.endsWith("/api/share-links/7mK9pR2xQa")) return Response.json({path:"/games/village/results"});
    if (url.endsWith("/api/game-entries/village/card")) return Response.json({id:"g",slug:"village",gameKind:"werewolf",status:"completed",visibility:"unlisted",title:"Lanterns and Lies",description:"Private role revealed",coverUrl:"/winner.png",cast:[]});
    throw new Error(`Unexpected API request: ${url}`);
  }, {preconnect: originalFetch.preconnect});
  try {
    // Supply the request context consumed by Next's actual headers() function.
    const context = {forceStatic:true,route:"/s/[code]"} as Parameters<typeof workAsyncStorage.run>[0];
    const contextSpy = spyOn(workAsyncStorage, "getStore").mockReturnValue(context);
    const metadata = await generateMetadata({params:Promise.resolve({code:"7mK9pR2xQa"}),searchParams:Promise.resolve({})}).finally(() => contextSpy.mockRestore());
    expect(requests).toHaveLength(2);
    expect(metadata.alternates?.canonical).toBe("/games/village/results");
    expect(metadata.robots).toEqual({index:false,follow:false});
    expect(metadata.twitter && "card" in metadata.twitter && metadata.twitter.card).toBe("summary_large_image");
    expect(metadata.title).toContain("Lanterns and Lies");
    expect(JSON.stringify(metadata)).not.toContain("Private role revealed");
    expect(JSON.stringify(metadata)).not.toContain("winner.png");
    const mini = JSON.parse(String(metadata.other?.["fc:miniapp"]));
    expect(mini.button.title).toBe("View results");
    expect(mini.button.action.url).toBe("https://thehouse.game/s/7mK9pR2xQa?app=mini");
    expect(mini.imageUrl).toBe("https://thehouse.game/games/village/card-image?format=farcaster");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOrigin === undefined) delete process.env.WEB_BASE_URL; else process.env.WEB_BASE_URL = originalOrigin;
  }
});
