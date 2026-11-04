import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("production analytics initializes the SDK through the proxy only when allowed", async () => {
  // Keep SDK and React hook mocks isolated from the rest of the web suite.
  if (process.env.ANALYTICS_PROXY_TEST !== "1") {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, ANALYTICS_PROXY_TEST: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ code, errors: code ? stdout + stderr : "" }).toEqual({ code: 0, errors: "" });
    return;
  }

  const { Window } = await import("happy-dom");
  const dom = new Window({ url: "https://thehouse.game/" });
  const keys = ["window", "document", "navigator", "location", "HTMLElement", "Element", "Node", "Event"] as const;
  const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
  let allowed = false;
  let pathname = "/";
  let internal = false;
  const calls: Array<{ key: string; host: string; uiHost: string }> = [];
  mock.module("next/navigation", () => ({ usePathname: () => pathname }));
  mock.module("@/hooks/use-auth", () => ({ useAuth: () => ({ ready: true, account: internal ? { isAdmin: true, roles: [] } : null }) }));
  mock.module("@/lib/runtime-config", () => ({ useRuntimeConfig: () => ({ ready: true, POSTHOG_PROJECT_TOKEN: "project-token" }) }));
  mock.module("@/lib/analytics-consent", () => ({
    useAnalyticsConsent: () => ({ ready: true, analytics: allowed, recordings: false, notice: { path: null } }),
    getAnalyticsConsent: () => ({ analytics: allowed, recordings: false, choice: { analytics: true } }),
    subscribeAnalyticsConsent: () => () => {},
    loadAnalyticsConsent: async () => {},
    dismissAnalyticsNotice: () => {},
  }));
  mock.module("../components/analytics-preference", () => ({ AnalyticsPreference: () => null }));
  mock.module("posthog-js", () => ({ default: {
    init: (key: string, config: { api_host: string; ui_host: string }) => calls.push({ key, host: config.api_host, uiHost: config.ui_host }),
    stopSessionRecording: () => {}, startSessionRecording: () => {}, opt_out_capturing: () => {},
    opt_in_capturing: () => {}, clear_opt_in_out_capturing: () => {}, get_property: () => null,
    capture: () => {}, identify: () => {}, reset: () => {},
  } }));
  const { render, cleanup, waitFor } = await import("@testing-library/react/pure");
  const { ProductAnalytics } = await import("../components/product-analytics");
  try {
    const view = render(<ProductAnalytics />);
    expect(calls).toEqual([]);
    allowed = true;
    pathname = "/admin";
    view.rerender(<ProductAnalytics />);
    expect(calls).toEqual([]);
    pathname = "/";
    internal = true;
    view.rerender(<ProductAnalytics />);
    expect(calls).toEqual([]);
    internal = false;
    dom.location.href = "https://staging.thehouse.game/";
    view.rerender(<ProductAnalytics />);
    expect(calls).toEqual([]);
    dom.location.href = "https://thehouse.game/";
    // Trigger the effect again after changing the location.
    pathname = "/games";
    view.rerender(<ProductAnalytics />);
    await waitFor(() => expect(calls).toEqual([{ key: "project-token", host: "https://k.thehouse.game", uiHost: "https://us.posthog.com" }]));
  } finally {
    cleanup();
    dom.close();
    for (const key of keys) {
      const descriptor = original.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
