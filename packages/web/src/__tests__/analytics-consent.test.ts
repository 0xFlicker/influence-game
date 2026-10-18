import { expect, test } from "bun:test";
import { resolve } from "node:path";

// SDK mocks stay in a child process so they cannot poison other web tests.
test("consent gates SDK, drops earlier activity, and revokes across tabs", () => {
  for (const country of ["US", "DE"]) {
    const result = Bun.spawnSync([process.execPath, "-e", `
      import { mock } from "bun:test";
      import { strict as assert } from "node:assert";
      const values = new Map();
      globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) };
      globalThis.window = new EventTarget();
      Object.defineProperty(globalThis, "navigator", { value: { doNotTrack: "0", globalPrivacyControl: false }, configurable: true });
      globalThis.fetch = async () => Response.json({ country: ${JSON.stringify(country)} });
      let initialized = 0, stopped = 0, optedOut = 0;
      const events = [];
      mock.module("posthog-js", () => ({ default: {
        init: () => initialized++, capture: name => events.push(name),
        identify: () => {}, reset: () => {}, get_property: () => null,
        opt_in_capturing: () => {}, opt_out_capturing: () => optedOut++,
        stopSessionRecording: () => stopped++, startSessionRecording: () => {},
      } }));
      const consent = await import("./src/lib/analytics-consent");
      const analytics = await import("./src/lib/product-analytics");
      analytics.captureProductEvent("before-region");
      await analytics.initializeAnalytics("test", "https://invalid.example");
      assert.equal(initialized, 0);
      await consent.loadAnalyticsConsent();
      await analytics.initializeAnalytics("test", "https://invalid.example");
      assert.equal(initialized, ${country === "US" ? 1 : 0});
      consent.saveAnalyticsChoice({ analytics: true });
      await analytics.initializeAnalytics("test", "https://invalid.example");
      analytics.setAnalyticsIdentity(null, false);
      analytics.captureProductEvent("allowed");
      assert.deepEqual(events, ["allowed"]);
      assert.equal(consent.getAnalyticsConsent().recordings, true);
      values.set("house:analytics-consent", JSON.stringify({ version: 1, analytics: false }));
      const event = new Event("storage"); Object.defineProperty(event, "key", { value: "house:analytics-consent" });
      window.dispatchEvent(event);
      analytics.captureProductEvent("after-rejection");
      assert.equal(analytics.analyticsActive(), false);
      assert.deepEqual(events, ["allowed"]);
      assert.ok(stopped > 0 && optedOut > 0);
      navigator.globalPrivacyControl = true;
      values.set("house:analytics-consent", JSON.stringify({ version: 1, analytics: true }));
      window.dispatchEvent(event);
      assert.equal(consent.getAnalyticsConsent().analytics, false);
      assert.equal(consent.getAnalyticsConsent().recordings, false);
    `], { cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  }
});
