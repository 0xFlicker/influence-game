import { expect, test } from "bun:test";
import { resolve } from "node:path";

// SDK mocks stay in a child process so they cannot poison other web tests.
test("consent gates SDK, drops earlier activity, and revokes across tabs", () => {
  for (const country of ["US", "AU", "DE"]) {
    const result = Bun.spawnSync([process.execPath, "-e", `
      import { mock } from "bun:test";
      import { strict as assert } from "node:assert";
      const values = new Map();
      globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
      globalThis.window = new EventTarget();
      Object.defineProperty(globalThis, "navigator", { value: { doNotTrack: "0", globalPrivacyControl: false }, configurable: true });
      globalThis.fetch = async () => Response.json({ country: ${JSON.stringify(country)} });
      let initialized = 0, stopped = 0, optedOut = 0, optedIn = 0;
      let sdkConfig;
      const events = [];
      const errors = [];
      const sendException = value => sdkConfig.before_send({ event: "$exception", properties: {
        $exception_list: [{ type: "Error", value }], $exception_values: ["SECRET"],
        $current_url: "https://thehouse.game/private-SECRET", cookie: "SECRET",
      } });
      mock.module("posthog-js", () => ({ default: {
        init: (key, config) => { initialized++; sdkConfig = config; }, capture: name => events.push(name),
        captureException: error => errors.push(sendException(error.message)),
        identify: () => {}, reset: () => {}, get_property: () => null,
        opt_in_capturing: () => optedIn++, opt_out_capturing: () => optedOut++, clear_opt_in_out_capturing: () => {},
        stopSessionRecording: () => stopped++, startSessionRecording: () => {},
      } }));
      const consent = await import("./src/lib/analytics-consent");
      const analytics = await import("./src/lib/product-analytics");
      analytics.captureProductEvent("before-region");
      analytics.captureProductException(new Error("before-region"));
      assert.equal(errors.length, 0);
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
        analytics.captureProductException(new TypeError("Cannot read properties of undefined (reading 'SECRET')"));
        assert.equal(errors.pop().properties.$exception_list[0].value, "Code tried to read a property from a missing value.");
      }
      consent.saveAnalyticsChoice({ analytics: true, advertising: false });
      await analytics.initializeAnalytics("test", "https://invalid.example");
      analytics.setAnalyticsIdentity(null, false);
      analytics.captureProductEvent("allowed");
      assert.deepEqual(events, ["allowed"]);
      assert.equal(sdkConfig.capture_pageleave, true);
      assert.equal(sdkConfig.capture_performance, undefined);
      assert.equal(sdkConfig.capture_exceptions, false);
      assert.equal(sdkConfig.opt_out_persistence_by_default, true);
      analytics.captureProductException(new Error("Replay source failed to load"));
      assert.equal(errors.length, 1);
      assert.equal(errors[0].properties.$exception_list[0].value, "An unexpected error interrupted the web application.");
      assert.equal(errors[0].properties.no_frames_reason, "no_first_party_coordinates");
      assert.ok(!JSON.stringify(errors).includes("SECRET"));
      assert.equal(sendException("Unexpected SDK exception"), null);
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
      analytics.captureProductException(new Error("excluded"));
      assert.equal(errors.length, 1);
      assert.equal(sdkConfig.before_send({ event: "$exception", properties: {} }), null);
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
      values.set("house:campaign-attribution", JSON.stringify({ firstTouch: { campaign: "season1" } }));
      values.set("house:analytics-consent", JSON.stringify({ version: 1, analytics: false }));
      const event = new Event("storage"); Object.defineProperty(event, "key", { value: "house:analytics-consent" });
      window.dispatchEvent(event);
      assert.equal(values.has("house:campaign-attribution"), false);
      assert.equal(sdkConfig.before_send(automaticEvent("$pageleave")), null);
      assert.equal(sdkConfig.before_send(automaticEvent("$web_vitals")), null);
      analytics.captureProductEvent("after-rejection");
      analytics.captureProductException(new Error("rejected"));
      assert.equal(errors.length, 1);
      assert.equal(sdkConfig.before_send({ event: "$exception", properties: {} }), null);
      assert.equal(analytics.analyticsActive(), false);
      assert.deepEqual(events, ["allowed"]);
      assert.ok(stopped > 0 && optedOut > optOutsBeforeRouteChange);
      consent.setAccountAnalyticsAllowed(false, false);
      const revision = consent.getAnalyticsConsent().choiceRevision;
      values.delete("house:analytics-consent");
      window.dispatchEvent(event);
      assert.equal(consent.getAnalyticsConsent().choiceRevision, revision);
      assert.equal(consent.getAnalyticsConsent().analytics, false);
      assert.equal(consent.getAnalyticsConsent().advertising, false);
      navigator.globalPrivacyControl = true;
      values.set("house:analytics-consent", JSON.stringify({ version: 1, analytics: true }));
      window.dispatchEvent(event);
      assert.equal(consent.getAnalyticsConsent().analytics, false);
      assert.equal(consent.getAnalyticsConsent().recordings, false);
      assert.equal(consent.getAnalyticsConsent().advertising, false);
    `], { cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  }
});

test("startup storage and SDK failures are contained, with recovery through the existing gate", () => {
  const result = Bun.spawnSync([process.execPath, "-e", `
    import { mock } from "bun:test";
    import { strict as assert } from "node:assert";
    const values = new Map([["house:analytics-consent", JSON.stringify({version: 2, analytics: true, advertising: false})]]);
    globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    globalThis.window = new EventTarget();
    globalThis.fetch = async () => { throw new Error("SECRET region failure"); };
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    const events = [];
    let tries = 0;
    let config;
    const client = {
      init: (_key, options, name) => {
        if (++tries === 1) throw new Error("SECRET cookie failure");
        assert.equal(name, "houseAnalyticsRecovery");
        config = options;
        return client;
      },
      captureException: error => events.push(config.before_send({ event: "$exception", properties: {
        $exception_list: [{ type: error.name, value: error.message }], token: "SECRET",
        authorization: "SECRET", "$set": { note: "SECRET" },
      }, "$set_once": { value: "SECRET" }, "$set": { value: "SECRET" } })),
      get_property: () => null, opt_in_capturing: () => {}, clear_opt_in_out_capturing: () => {},
      stopSessionRecording: () => { throw new Error("SECRET recorder failure"); },
      opt_out_capturing: () => { throw new Error("SECRET persistent opt-out failure"); },
    };
    mock.module("posthog-js", () => ({ default: client }));
    const consent = await import("./src/lib/analytics-consent");
    const analytics = await import("./src/lib/product-analytics");
    consent.subscribeAnalyticsConsent(() => { throw new Error("SECRET subscriber failure"); });
    await consent.loadAnalyticsConsent();
    assert.equal(consent.getAnalyticsConsent().ready, true);
    assert.equal(consent.getAnalyticsConsent().country, null);
    assert.equal(consent.getAnalyticsConsent().analytics, true);
    assert.equal(await analytics.initializeAnalytics("public-project-key", "https://invalid.example"), false);
    assert.equal(analytics.analyticsActive(), false);
    assert.equal(await analytics.initializeAnalytics("public-project-key", "https://invalid.example"), true);
    assert.equal(analytics.setAnalyticsIdentity(null, false), true);
    analytics.captureProductException(new Error("SECRET content"));
    assert.equal(events.length, 1);
    assert.equal(events[0].properties.token, "public-project-key");
    assert.equal(events[0].$set, undefined);
    assert.equal(events[0].$set_once, undefined);
    assert.equal(consent.saveAnalyticsChoice({analytics: false, advertising: false}), true);
    assert.equal(analytics.analyticsActive(), false);
    analytics.captureProductException(new Error("SECRET after withdrawal"));
    assert.equal(events.length, 1);
    assert.ok(warnings.some(args => args.includes("sdk_initialization_failed")));
    assert.ok(warnings.some(args => args.includes("sdk_opt_out_failed")));
    Object.defineProperty(navigator, "globalPrivacyControl", { get() { throw new Error("SECRET browser preferences"); } });
    const storageEvent = new Event("storage");
    Object.defineProperty(storageEvent, "key", { value: "house:analytics-consent" });
    window.dispatchEvent(storageEvent);
    consent.saveAnalyticsChoice({analytics: true, advertising: true});
    assert.equal(consent.getAnalyticsConsent().blocked, true);
    assert.equal(analytics.analyticsActive(), false);
    assert.ok(!JSON.stringify({warnings, events}).includes("SECRET"));
  `], { cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" });
  expect({ exit: result.exitCode, stderr: result.stderr.toString() }).toEqual({ exit: 0, stderr: "" });
});
