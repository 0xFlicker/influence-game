import { expect, test } from "bun:test";
import { resolve } from "node:path";

// SDK mocks stay in a child process so they cannot poison other web tests.
test("consent gates SDK, drops earlier activity, and revokes across tabs", () => {
  for (const country of ["US", "AU", "DE"]) {
    const result = Bun.spawnSync([process.execPath, "-e", `
      import { mock } from "bun:test";
      import { strict as assert } from "node:assert";
      const values = new Map();
      globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) };
      globalThis.window = new EventTarget();
      Object.defineProperty(globalThis, "navigator", { value: { doNotTrack: "0", globalPrivacyControl: false }, configurable: true });
      globalThis.fetch = async () => Response.json({ country: ${JSON.stringify(country)} });
      let initialized = 0, stopped = 0, optedOut = 0, optedIn = 0;
      let sdkConfig;
      const events = [];
      mock.module("posthog-js", () => ({ default: {
        init: (key, config) => { initialized++; sdkConfig = config; }, capture: name => events.push(name),
        identify: () => {}, reset: () => {}, get_property: () => null,
        opt_in_capturing: () => optedIn++, opt_out_capturing: () => optedOut++, clear_opt_in_out_capturing: () => {},
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
      if (consent.getAnalyticsConsent().country === "US") {
        assert.equal(consent.getAnalyticsConsent().recordings, true);
        consent.showAnalyticsNotice("/");
        consent.showAnalyticsNotice("/games");
        assert.equal(consent.getAnalyticsConsent().notice.path, null);
        assert.equal(consent.getAnalyticsConsent().choice, null);
        assert.equal(values.has("house:analytics-consent"), false);
        assert.equal(values.get("house:analytics-us-notice-shown"), "true");
        analytics.setAnalyticsIdentity(null, false);
        assert.equal(optedIn, 0);
      }
      consent.saveAnalyticsChoice({ analytics: true });
      await analytics.initializeAnalytics("test", "https://invalid.example");
      analytics.setAnalyticsIdentity(null, false);
      analytics.captureProductEvent("allowed");
      assert.deepEqual(events, ["allowed"]);
      assert.equal(sdkConfig.capture_pageleave, true);
      assert.equal(sdkConfig.capture_performance, undefined);
      // SDK-originated exit/performance events share our filtering and privacy
      // boundary even though they don't call captureProductEvent.
      const automaticEvent = event => ({ event, properties: {
        $current_url: "https://thehouse.game/games?private=secret#token",
        $prev_pageview_duration: 12,
      } });
      for (const eventName of ["$pageleave", "$web_vitals"]) {
        const captured = sdkConfig.before_send(automaticEvent(eventName));
        assert.equal(captured.properties.$current_url, "https://thehouse.game/games");
        assert.equal(captured.properties.$prev_pageview_duration, 12);
        assert.equal(captured.properties.channel, "web");
        assert.equal(captured.properties.environment, "production");
      }
      // The SDK invokes this same callback for rrweb Meta.href and SPA URLs.
      const maskReplayUrl = sdkConfig.session_recording.maskCapturedNetworkRequestFn;
      for (const name of [
        "https://thehouse.game/agents/create?private=secret#token",
        "https://user:password@thehouse.game/dashboard?code=secret#token",
      ]) {
        assert.equal(maskReplayUrl({ name }).name, new URL(name).origin + new URL(name).pathname);
      }
      assert.equal(maskReplayUrl({ name: "data:text/plain,secret" }), undefined);
      assert.equal(maskReplayUrl({ name: "not a URL" }), undefined);
      // An auth/private-route or staff exclusion must not write the SDK's
      // persistent opt-out flag, which every other tab reads on capture.
      const optOutsBeforeRouteChange = optedOut;
      analytics.suspendAnalytics();
      assert.equal(sdkConfig.before_send(automaticEvent("$pageleave")), null);
      analytics.captureProductEvent("private-page");
      assert.equal(analytics.analyticsActive(), false);
      assert.equal(optedOut, optOutsBeforeRouteChange);
      analytics.setAnalyticsIdentity(null, true);
      assert.equal(sdkConfig.before_send(automaticEvent("$web_vitals")), null);
      assert.equal(optedOut, optOutsBeforeRouteChange);
      analytics.setAnalyticsIdentity(null, false);
      assert.equal(analytics.analyticsActive(), true);
      assert.deepEqual(events, ["allowed"]);
      assert.equal(consent.getAnalyticsConsent().recordings, true);
      values.set("house:analytics-consent", JSON.stringify({ version: 1, analytics: false }));
      const event = new Event("storage"); Object.defineProperty(event, "key", { value: "house:analytics-consent" });
      window.dispatchEvent(event);
      assert.equal(sdkConfig.before_send(automaticEvent("$pageleave")), null);
      assert.equal(sdkConfig.before_send(automaticEvent("$web_vitals")), null);
      analytics.captureProductEvent("after-rejection");
      assert.equal(analytics.analyticsActive(), false);
      assert.deepEqual(events, ["allowed"]);
      assert.ok(stopped > 0 && optedOut > optOutsBeforeRouteChange);
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
