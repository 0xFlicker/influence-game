import { beforeEach, expect, test } from "bun:test";
import {
  campaignAttributionProperties,
  bindCampaignAccount,
  clearCampaignAttribution,
  getStoredCampaignAttribution,
  isWithinAttributionWindow,
  parseCampaignTouch,
  retainCampaignTouch,
} from "../lib/campaign-attribution";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  },
});

beforeEach(() => {
  store.clear();
  clearCampaignAttribution();
});

test("tagged touch parses creative, audience, click ID and variant identities", () => {
  const touch = parseCampaignTouch(
    "?utm_source=meta&utm_medium=cpc&utm_campaign=season1&utm_content=video-a&utm_term=strategy-fans&fbclid=fb.123&landing_variant=hero-b&onboarding_variant=guided&starter_prompt=rival-duo&starter_skill=bluffing",
    new Date("2026-01-01T00:00:00Z"),
  );
  expect(touch).toEqual({
    touchedAt: "2026-01-01T00:00:00.000Z",
    source: "meta",
    medium: "cpc",
    campaign: "season1",
    creative: "video-a",
    audience: "strategy-fans",
    clickId: "fb.123",
    clickIdParam: "fbclid",
    landingVariant: "hero-b",
    onboardingVariant: "guided",
    starterPromptId: "rival-duo",
    starterSkillId: "bluffing",
  });
});

test("direct and invalid touches stay explicitly unknown", () => {
  expect(parseCampaignTouch("")).toBeNull();
  expect(parseCampaignTouch("?utm_source=not%20valid%21")).toBeNull();
  expect(parseCampaignTouch("?gclid=bad%20click")).toBeNull();
});

test("first touch is retained and direct visits never overwrite last non-direct", () => {
  retainCampaignTouch("?utm_source=meta&utm_campaign=season1&utm_content=video-a", new Date("2026-01-01T00:00:00Z"));
  retainCampaignTouch("", new Date("2026-01-02T00:00:00Z"));
  let stored = getStoredCampaignAttribution();
  expect(stored.firstTouch?.campaign).toBe("season1");
  expect(stored.lastNonDirectTouch?.campaign).toBe("season1");

  retainCampaignTouch("?utm_source=google&utm_campaign=season1b&gclid=g-1", new Date("2026-01-03T00:00:00Z"));
  stored = getStoredCampaignAttribution();
  expect(stored.firstTouch?.source).toBe("meta");
  expect(stored.lastNonDirectTouch?.source).toBe("google");
  const properties = campaignAttributionProperties(stored);
  expect(properties.utm_campaign).toBe("season1b");
  expect(properties.first_utm_campaign).toBe("season1");
  expect(properties.gclid).toBe("g-1");
});

test("attribution window is ninety days from the touch", () => {
  const touch = parseCampaignTouch("?utm_source=meta", new Date("2026-01-01T00:00:00Z"));
  expect(isWithinAttributionWindow(touch, new Date("2026-03-01T00:00:00Z"))).toBe(true);
  expect(isWithinAttributionWindow(touch, new Date("2026-06-01T00:00:00Z"))).toBe(false);
  expect(isWithinAttributionWindow(null, new Date())).toBe(false);
});


test("withdrawal clears the optional account marker as well as campaign touches", () => {
  bindCampaignAccount("account-a");
  retainCampaignTouch("?utm_campaign=season1");
  clearCampaignAttribution();
  expect(store.has("house:campaign-account")).toBe(false);
  expect(getStoredCampaignAttribution().firstTouch).toBeNull();
  bindCampaignAccount("account-b", false);
  expect(store.has("house:campaign-account")).toBe(false);
});


test("X click attribution survives the browser-to-account payload and is cleared on withdrawal", () => {
  const touch = parseCampaignTouch("?utm_source=x&twclid=x-click-123");
  expect(touch).toMatchObject({ source: "x", clickId: "x-click-123", clickIdParam: "twclid" });
  retainCampaignTouch("?twclid=x-click-123");
  expect(campaignAttributionProperties()).toMatchObject({ twclid: "x-click-123", first_twclid: "x-click-123" });
  clearCampaignAttribution();
  expect(campaignAttributionProperties()).toEqual({});
  expect(parseCampaignTouch("?twclid=bad%20id")).toBeNull();
});
