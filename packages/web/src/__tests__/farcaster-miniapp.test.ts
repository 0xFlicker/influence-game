import { describe, expect, test } from "bun:test";
import {
  FARCASTER_BUTTON_TITLE,
  FARCASTER_PRODUCTION_ORIGIN,
  FARCASTER_SPLASH_BACKGROUND,
  buildMiniAppEmbed,
  buildMiniAppManifest,
  isMiniAppModeHint,
  serializeMiniAppEmbedMeta,
  withMiniAppQuery,
} from "../lib/farcaster-miniapp";

describe("farcaster mini app builders", () => {
  test("mode hint only accepts app=mini", () => {
    expect(isMiniAppModeHint("?app=mini")).toBe(true);
    expect(isMiniAppModeHint("app=mini&x=1")).toBe(true);
    expect(isMiniAppModeHint("?app=true")).toBe(false);
    expect(isMiniAppModeHint("")).toBe(false);
  });

  test("withMiniAppQuery preserves path and sets the hint", () => {
    expect(withMiniAppQuery("https://thehouse.game/")).toBe(
      "https://thehouse.game/?app=mini",
    );
    expect(withMiniAppQuery("https://thehouse.game/games")).toContain(
      "app=mini",
    );
  });

  test("embed uses version 1, 3:2 asset path, and short button title", () => {
    const embed = buildMiniAppEmbed(FARCASTER_PRODUCTION_ORIGIN);
    expect(embed.version).toBe("1");
    expect(embed.imageUrl).toBe(
      "https://thehouse.game/farcaster/embed.png",
    );
    expect(embed.button.title).toBe(FARCASTER_BUTTON_TITLE);
    expect(embed.button.title.length).toBeLessThanOrEqual(32);
    expect(embed.button.action.type).toBe("launch_frame");
    expect(embed.button.action.url).toContain("app=mini");
    expect(embed.button.action.splashBackgroundColor).toBe(
      FARCASTER_SPLASH_BACKGROUND,
    );
  });

  test("replay launches retain their path and settings on the app origin", () => {
    const embed = buildMiniAppEmbed(FARCASTER_PRODUCTION_ORIGIN, {
      path: "/games/village/replay?audience=omniscient&cursor=73&cue=game%3A73&t=1.25&speed=2&thinking=1&muted=0&volume=0.6",
      buttonTitle: "Watch replay",
    });
    const url = new URL(embed.button.action.url);
    expect(url.pathname).toBe("/games/village/replay");
    expect(url.searchParams.get("app")).toBe("mini");
    expect(url.searchParams.get("cue")).toBe("game:73");
    expect(url.searchParams.get("t")).toBe("1.25");
    expect(embed.button.title).toBe("Watch replay");
    expect(() => buildMiniAppEmbed(FARCASTER_PRODUCTION_ORIGIN, {path:"https://example.com/"})).toThrow();
    expect(() => buildMiniAppEmbed(FARCASTER_PRODUCTION_ORIGIN, {path:"//example.com/"})).toThrow();
  });

  test("manifest omits accountAssociation until committed", () => {
    const unsigned = buildMiniAppManifest({
      baseUrl: FARCASTER_PRODUCTION_ORIGIN,
      accountAssociation: null,
    });
    expect("accountAssociation" in unsigned).toBe(false);
    expect(unsigned.miniapp.name).toBe("Influence");
    expect(unsigned.miniapp.homeUrl).toContain("app=mini");
  });

  test("manifest includes committed association when provided", () => {
    const association = {
      header: "h",
      payload: "p",
      signature: "s",
    };
    const signed = buildMiniAppManifest({
      baseUrl: FARCASTER_PRODUCTION_ORIGIN,
      accountAssociation: association,
    });
    expect(signed.accountAssociation).toEqual(association);
  });

  test("serializeMiniAppEmbedMeta is JSON with fc-compatible shape", () => {
    const raw = serializeMiniAppEmbedMeta(FARCASTER_PRODUCTION_ORIGIN);
    const parsed = JSON.parse(raw) as { version: string; button: { title: string } };
    expect(parsed.version).toBe("1");
    expect(parsed.button.title).toBe(FARCASTER_BUTTON_TITLE);
  });
});
