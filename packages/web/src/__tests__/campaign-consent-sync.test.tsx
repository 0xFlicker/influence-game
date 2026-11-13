import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("account sync serializes withdrawal and does not leak attribution across account switches", async () => {
  if (process.env.CAMPAIGN_SYNC_TEST !== "1") {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, CAMPAIGN_SYNC_TEST: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ code, errors: code ? stdout + stderr : "" }).toEqual({ code: 0, errors: "" });
    return;
  }
  const { Window } = await import("happy-dom");
  const dom = new Window({ url: "https://thehouse.game/season-1" });
  const keys = ["window", "document", "navigator", "location", "localStorage", "HTMLElement", "Element", "Node", "Event"] as const;
  const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async () => Response.json({ country: "US" }), { preconnect: originalFetch.preconnect });
  let account = "account-a";
  const pending: Array<{ account: string; analytics: boolean; advertising: boolean; explicit: boolean; expectedVersion?: string; attribution: unknown; resolve: (result: { analytics: boolean; advertising: boolean; version: string }) => void }> = [];
  let initialized = 0;
  mock.module("next/navigation", () => ({ usePathname: () => "/season-1" }));
  mock.module("@/hooks/use-auth", () => ({ useAuth: () => ({ ready: true, account: { publicId: account, roles: [], isAdmin: false } }) }));
  mock.module("@/lib/runtime-config", () => ({ useRuntimeConfig: () => ({ ready: true, POSTHOG_PROJECT_TOKEN: "test" }) }));
  mock.module("../components/analytics-preference", () => ({ AnalyticsPreference: () => null }));
  const consent = await import("../lib/analytics-consent");
  const attribution = await import("../lib/campaign-attribution");
  mock.module("@/lib/api", () => ({
    getAuthToken: () => account,
    retainCampaignAttribution: (explicit = false, expectedVersion?: string) => new Promise<{ analytics: boolean; advertising: boolean; version: string }>(resolve => {
      pending.push({ account, analytics: consent.getAnalyticsConsent().analytics, advertising: consent.getAnalyticsConsent().advertising, explicit, expectedVersion,
        attribution: attribution.getStoredCampaignAttribution(), resolve });
    }),
  }));
  mock.module("posthog-js", () => ({ default: {
    init: () => initialized++, stopSessionRecording: () => {}, startSessionRecording: () => {},
    opt_out_capturing: () => {}, opt_in_capturing: () => {}, clear_opt_in_out_capturing: () => {},
    get_property: () => null, capture: () => {}, identify: () => {}, reset: () => {},
  } }));
  const { render, cleanup, waitFor, act } = await import("@testing-library/react/pure");
  const { ProductAnalytics } = await import("../components/product-analytics");
  try {
    await consent.loadAnalyticsConsent();
    attribution.retainCampaignTouch("?utm_campaign=drama");
    const view = render(<ProductAnalytics />);
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0]).toMatchObject({ account: "account-a", analytics: true, explicit: false });
    // Withdrawal while the allow request is still in flight must win.
    await act(async () => { consent.saveAnalyticsChoice({ analytics: false, advertising: false }); });
    expect(pending).toHaveLength(1);
    await act(async () => { pending[0]!.resolve({ analytics: true, advertising: true, version: "allowed-v1" }); });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1]).toMatchObject({ analytics: false, advertising: false, explicit: true, attribution: { firstTouch: null, lastNonDirectTouch: null } });
    expect(initialized).toBe(0);
    await act(async () => { pending[1]!.resolve({ analytics: false, advertising: false, version: "denied-v2" }); });
    expect(consent.getAnalyticsConsent().analytics).toBe(false);
    expect(consent.getAnalyticsConsent().advertising).toBe(false);
    // A fresh explicit enable can lift the account denial.
    await act(async () => { consent.saveAnalyticsChoice({ analytics: true, advertising: true }); });
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(pending[2]).toMatchObject({ analytics: true, explicit: true, expectedVersion: "denied-v2" });
    // Switch accounts before the old request resolves; its result cannot identify the new account.
    attribution.retainCampaignTouch("?utm_campaign=private-to-a");
    account = "account-b";
    view.rerender(<ProductAnalytics />);
    await act(async () => { pending[2]!.resolve({ analytics: true, advertising: true, version: "allowed-v1" }); });
    await waitFor(() => expect(pending).toHaveLength(4));
    expect(pending[3]).toMatchObject({ account: "account-b", explicit: false, attribution: { firstTouch: null, lastNonDirectTouch: null } });
    expect(initialized).toBe(0);
    expect(pending[3]!.expectedVersion).toBeUndefined();
    await act(async () => { pending[3]!.resolve({ analytics: false, advertising: false, version: "denied-v2" }); });
    expect(consent.getAnalyticsConsent().analytics).toBe(false);
    expect(consent.getAnalyticsConsent().advertising).toBe(false);
  } finally {
    cleanup();
    for (const request of pending) request.resolve({ analytics: false, advertising: false, version: "denied-v2" });
    await act(async () => {});
    globalThis.fetch = originalFetch;
    dom.close();
    for (const key of keys) {
      const descriptor = original.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
