import { expect, test } from "bun:test";
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
  const keys = ["window", "document", "navigator", "location", "localStorage"] as const;
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
  const requests: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === "/analytics-region") return Response.json({ country: "US" });
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ token: "test-token", user: {}, analytics: true, version: "v1" });
  }, { preconnect: originalFetch.preconnect });
  try {
    const consent = await import("../lib/analytics-consent");
    const api = await import("../lib/api");
    await consent.loadAnalyticsConsent();
    await api.loginWithPrivyToken("test", { intent: "sign_in" });
    expect(requests.pop()).toMatchObject({ analytics: true, analyticsExplicit: false });
    consent.saveAnalyticsChoice({ analytics: true });
    await api.createManagedAuthentication("test");
    expect(requests.pop()).toMatchObject({ analytics: true, analyticsExplicit: true });
    await api.retainCampaignAttribution(true, "v1");
    expect(requests.pop()).toMatchObject({ analytics: true, analyticsExplicit: true, explicitChoice: true, expectedVersion: "v1" });
    consent.saveAnalyticsChoice({ analytics: false });
    await api.retainCampaignAttribution(true, "v1");
    expect(requests.pop()).toMatchObject({ analytics: false, analyticsExplicit: false });
  } finally {
    globalThis.fetch = originalFetch;
    dom.close();
  }
});
