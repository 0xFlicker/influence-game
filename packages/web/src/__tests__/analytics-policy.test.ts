import { expect, test } from "bun:test";
import { analyticsMode, analyticsPermission, countryFromCloudflare, parseAnalyticsChoice } from "../lib/analytics-policy";
import { GET } from "../app/analytics-region/route";

test("only reviewed countries get default analytics; recordings always need acceptance", () => {
  for (const country of ["US", "AU"]) {
    expect(analyticsMode(country)).toBe("opt-out");
    expect(analyticsPermission(country, null, false)).toEqual({ analytics: true, recordings: false });
  }
  for (const country of [null, "XX", "T1", "GB", "DE", "FR", "CA", "NZ", "us", "invalid"]) {
    expect(analyticsPermission(country, null, false)).toEqual({ analytics: false, recordings: false });
  }
});

test("explicit rejection wins in every region; browser signals override acceptance", () => {
  for (const country of [null, "US", "AU", "DE"]) {
    expect(analyticsPermission(country, { analytics: false }, false)).toEqual({ analytics: false, recordings: false });
    expect(analyticsPermission(country, { analytics: true }, false)).toEqual({ analytics: true, recordings: true });
    expect(analyticsPermission(country, { analytics: true }, true)).toEqual({ analytics: false, recordings: false });
  }
});

test("unrecognized consent never counts as acceptance", () => {
  for (const value of [null, "{}", "null", "broken", '{"version":2,"analytics":true}', '{"version":1,"analytics":"yes"}']) {
    expect(parseAnalyticsChoice(value)).toBeNull();
  }
  expect(parseAnalyticsChoice('{"version":1,"analytics":false}')).toEqual({ analytics: false });
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
