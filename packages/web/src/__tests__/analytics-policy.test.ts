import { expect, test } from "bun:test";
import { analyticsMode, analyticsPermission, countryFromCloudflare, parseAnalyticsChoice, visitAnalyticsNotice } from "../lib/analytics-policy";
import { GET } from "../app/analytics-region/route";

test("US analytics and recordings default on; every other region requires acceptance", () => {
  for (const country of ["US"]) {
    expect(analyticsMode(country)).toBe("opt-out");
    expect(analyticsPermission(country, null, false)).toEqual({ analytics: true, advertising: true, recordings: true });
  }
  for (const country of [null, "AU", "XX", "T1", "GB", "DE", "FR", "CA", "NZ", "us", "invalid"]) {
    expect(analyticsPermission(country, null, false)).toEqual({ analytics: false, advertising: false, recordings: false });
  }
});

test("explicit rejection wins in every region; browser signals override acceptance", () => {
  for (const country of [null, "US", "AU", "DE"]) {
    expect(analyticsPermission(country, { analytics: false, advertising: false }, false)).toEqual({ analytics: false, advertising: false, recordings: false });
    expect(analyticsPermission(country, { analytics: true, advertising: true }, false)).toEqual({ analytics: true, advertising: true, recordings: true });
    expect(analyticsPermission(country, { analytics: true, advertising: true }, true)).toEqual({ analytics: false, advertising: false, recordings: false });
  }
});

test("unrecognized consent never counts as acceptance", () => {
  for (const value of [null, "{}", "null", "broken", '{"version":2,"analytics":true}', '{"version":1,"analytics":"yes"}']) {
    expect(parseAnalyticsChoice(value)).toBeNull();
  }
  expect(parseAnalyticsChoice('{"version":1,"analytics":false}')).toEqual({ analytics: false, advertising: false });
});

test("country lookup fails closed and cannot be shared by caches", async () => {
  expect(countryFromCloudflare(new Headers({ "cf-ipcountry": "US" }))).toBeNull();
  for (const country of ["XX", "T1", "us", "US,DE", ""]) {
    expect(countryFromCloudflare(new Headers({ "cf-ray": "edge", "cf-ipcountry": country }))).toBeNull();
  }
  const response = GET(new Request("https://thehouse.game/analytics-region", { headers: { "cf-ray": "edge", "cf-ipcountry": "US" } }));
  expect(await response.json()).toEqual({ country: "US", mode: "opt-out" });
  expect(response.headers.get("cache-control")).toContain("private, no-store");
  expect(response.headers.get("cdn-cache-control")).toBe("no-store");
  expect(await GET(new Request("https://thehouse.game/analytics-region?country=US")).json()).toEqual({ country: null, mode: "opt-in" });
});


test("US notice is shown once and navigation never creates an analytics choice", () => {
  const first = visitAnalyticsNotice({ seen: false, path: null }, "/");
  expect(first).toEqual({ seen: true, path: "/" });
  expect(visitAnalyticsNotice(first, "/")).toBe(first);
  const next = visitAnalyticsNotice(first, "/games");
  expect(next).toEqual({ seen: true, path: null });
  expect(visitAnalyticsNotice(next, "/")).toBe(next);
  expect(visitAnalyticsNotice({ seen: true, path: null }, "/")).toEqual({ seen: true, path: null });
  expect(analyticsPermission("DE", null, false).analytics).toBe(false);
});

test("independent purpose choices and legacy consent", () => {
  for (const country of ["US", "DE", null]) for (const analytics of [false, true]) for (const advertising of [false, true]) {
    const choice = parseAnalyticsChoice(JSON.stringify({ version: 2, analytics, advertising }));
    expect(analyticsPermission(country, choice, false)).toEqual({ analytics, advertising, recordings: analytics });
    expect(analyticsPermission(country, choice, true)).toEqual({ analytics: false, advertising: false, recordings: false });
  }
  const legacy = parseAnalyticsChoice('{"version":1,"analytics":true}');
  expect(analyticsPermission("DE", legacy, false)).toEqual({ analytics: true, advertising: false, recordings: true });
  expect(analyticsPermission("US", legacy, false).advertising).toBe(true);
  expect(legacy?.advertising).toBeUndefined();
  expect(analyticsPermission("US", parseAnalyticsChoice('{"version":1,"analytics":false}'), false).advertising).toBe(false);
});
