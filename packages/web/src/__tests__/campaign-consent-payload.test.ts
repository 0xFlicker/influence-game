import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("browser sends explicit-choice metadata separately from regional permission through signup and sync", async () => {
  if (process.env.CAMPAIGN_CONSENT_PAYLOAD_TEST !== "1") {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, CAMPAIGN_CONSENT_PAYLOAD_TEST: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ code, errors: code ? stdout + stderr : "" }).toEqual({ code: 0, errors: "" });
    return;
  }
  const { Window } = await import("happy-dom");
  const dom = new Window({ url: "https://thehouse.game/season-1" });
  const keys = ["window", "document", "navigator", "location", "localStorage", "history"] as const;
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
  const requests: unknown[] = [];
  const posthogSessionId = "019abb29-2345-7000-a123-123456789abc";
  const openId = "019abb29-2345-7000-a123-123456789abd";
  mock.module("posthog-js", () => ({ default: {
    init: () => {},
    get_property: () => null,
    get_session_id: () => posthogSessionId,
    opt_in_capturing: () => {},
    opt_out_capturing: () => {},
    stopSessionRecording: () => {},
  } }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === "/analytics-region") return Response.json({ country: "US" });
    requests.push(JSON.parse(String(init?.body)));
    if (String(url) === "/api/share-links") {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sharing-session");
      return Response.json({ code: "7mK9pR2xQa" });
    }
    if (String(url).endsWith("/api/share-links/open")) {
      return Response.json({ openId, share_link_id: "opaque-link", sharing_account_id: "opaque-account", openedAt: "2026-11-27T08:00:00.000Z" });
    }
    return Response.json({ token: "test-token", user: {}, analytics: true, version: "v1" });
  }, { preconnect: originalFetch.preconnect });
  try {
    const consent = await import("../lib/analytics-consent");
    const api = await import("../lib/api");
    const analytics = await import("../lib/product-analytics");
    const campaign = await import("../lib/campaign-attribution");
    const { createHouseShareLink } = await import("../lib/house-share-link");
    api.storeAuthToken("sharing-session");
    expect(await createHouseShareLink("/rules", location.origin)).toBe("https://thehouse.game/s/7mK9pR2xQa");
    expect(requests.pop()).toEqual({ path: "/rules" });
    api.clearAuthToken();
    await api.loginWithPrivyToken("test", { intent: "sign_in" });
    await api.createManagedAuthentication("test");
    for (const request of requests.splice(0)) {
      for (const field of ["analytics", "advertising", "analyticsExplicit", "advertisingExplicit", "posthogSessionId"]) {
        expect(request).not.toHaveProperty(field);
      }
    }
    await consent.loadAnalyticsConsent();
    await api.loginWithPrivyToken("test", { intent: "sign_in" });
    expect(requests.pop()).toMatchObject({ analytics: true, analyticsExplicit: false });
    consent.saveAnalyticsChoice({ analytics: true, advertising: true });
    expect(await analytics.initializeAnalytics("test", "https://invalid.example")).toBe(true);
    expect(analytics.setAnalyticsIdentity(null, false)).toBe(true);
    await api.createManagedAuthentication("test");
    expect(requests.pop()).toMatchObject({ analytics: true, analyticsExplicit: true, posthogSessionId });
    await api.loginWithPrivyToken("test", { intent: "create_account", legalAcceptance: api.PRESENTED_LEGAL_ACCEPTANCE });
    expect(requests.pop()).toMatchObject({ posthogSessionId });
    await api.createAgent({ name: "Agent", personality: "Patient", gender: "female", creationRequestId: crypto.randomUUID() });
    expect(requests.pop()).toMatchObject({ posthogSessionId });
    await api.updateAgent("agent", { personality: "Calm" });
    expect(requests.pop()).toMatchObject({ posthogSessionId });
    await api.joinFreeQueue("agent");
    expect(requests.pop()).toMatchObject({ posthogSessionId });
    await api.retainCampaignAttribution(true, "v1");
    expect(requests.pop()).toMatchObject({ analytics: true, analyticsExplicit: true, explicitChoice: true, expectedVersion: "v1" });

    // A Mini App signup can beat the analytics effect. The ticket still
    // contributes first-touch credit and only the ticket leaves the URL.
    history.replaceState({}, "", "/games/small-room/replay?speed=2&house_share=signed&app=mini#scene");
    await api.loginWithFarcasterToken("test");
    expect(requests.pop()).toMatchObject({ analytics: true, attribution: { shareOpenId: openId } });
    expect(requests.pop()).toEqual({ ticket: "signed", analytics: true });
    expect(location.search).toBe("?speed=2&app=mini");
    expect(location.hash).toBe("#scene");
    expect(api.takeShareLinkOpenEvent()).toMatchObject({
      properties: { share_link_id: "opaque-link", sharing_account_id: "opaque-account" },
      timestamp: new Date("2026-11-27T08:00:00.000Z"),
    });
    expect(api.takeShareLinkOpenEvent()).toBeUndefined();
    campaign.retainCampaignTouch("?utm_source=paid&utm_campaign=later");
    await api.createManagedAuthentication("test");
    expect(requests.pop()).toMatchObject({ attribution: { shareOpenId: openId, campaign: "later" } });
    consent.saveAnalyticsChoice({ analytics: false, advertising: true });
    history.replaceState({}, "", "/rules?house_share=denied");
    await api.recordCurrentShareLinkOpen();
    expect(location.search).toBe("");
    await api.createManagedAuthentication("test");
    const adsOnly = requests.pop();
    expect(adsOnly).toMatchObject({ attribution: { campaign: "later" } });
    expect(adsOnly).not.toHaveProperty("attribution.shareOpenId");
    expect(requests).toHaveLength(0);

    consent.saveAnalyticsChoice({ analytics: true, advertising: true });
    campaign.clearCampaignAttribution();
    campaign.retainCampaignTouch("?utm_source=paid&utm_campaign=earlier");
    history.replaceState({}, "", "/rules?house_share=later-share");
    await api.recordCurrentShareLinkOpen();
    expect(requests.pop()).toEqual({ ticket: "later-share", analytics: true });
    await api.createManagedAuthentication("test");
    const paidFirst = requests.pop();
    expect(paidFirst).toMatchObject({ attribution: { campaign: "earlier" } });
    expect(paidFirst).not.toHaveProperty("attribution.shareOpenId");
    for (const analytics of [false, true]) for (const advertising of [false, true]) {
      consent.saveAnalyticsChoice({ analytics, advertising });
      await api.loginWithPrivyToken("test", { intent: "sign_in" });
      expect(requests.pop()).toMatchObject({ analytics, advertising, analyticsExplicit: analytics, advertisingExplicit: advertising });
      await api.retainCampaignAttribution(true, "v1");
      expect(requests.pop()).toMatchObject({ analytics, advertising, analyticsExplicit: analytics, advertisingExplicit: advertising });
    }
    consent.saveAnalyticsChoice({ analytics: false, advertising: false });
    await api.joinFreeQueue("agent");
    expect(requests.pop()).not.toHaveProperty("posthogSessionId");
    await api.retainCampaignAttribution(true, "v1");
    expect(requests.pop()).toMatchObject({ analytics: false, analyticsExplicit: false });
  } finally {
    globalThis.fetch = originalFetch;
    dom.close();
  }
});
