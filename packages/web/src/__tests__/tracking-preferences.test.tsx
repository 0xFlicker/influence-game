import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("purpose controls, disclosure, footer access, and advertising-only retention", async () => {
  if (process.env.TRACKING_PREFERENCES_TEST !== "1") {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, TRACKING_PREFERENCES_TEST: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, errors: code ? stdout + stderr : "" }).toEqual({ code: 0, errors: "" });
    return;
  }
  const { mock } = await import("bun:test");
  const { Window } = await import("happy-dom");
  const dom = new Window({ url: "https://thehouse.game/?utm_campaign=tagged" });
  for (const key of ["window", "document", "navigator", "location", "localStorage", "HTMLElement", "Element", "Node", "Event"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
  }
  globalThis.fetch = Object.assign(async () => Response.json({ country: "DE" }), { preconnect: fetch.preconnect });
  mock.module("next/navigation", () => ({ usePathname: () => "/" }));
  const consent = await import("../lib/analytics-consent");
  const attribution = await import("../lib/campaign-attribution");
  const { AnalyticsPreference } = await import("../components/analytics-preference");
  const { SiteFooter } = await import("../components/site-footer");
  const { render, fireEvent, act, cleanup, waitFor } = await import("@testing-library/react/pure");
  try {
    await consent.loadAnalyticsConsent();
    const view = render(<><AnalyticsPreference banner /><SiteFooter /></>);
    expect(view.getByText(/advertising measurement shares outcomes with Meta, Google, TikTok, and X/)).toBeTruthy();
    expect(view.getAllByRole("checkbox")).toHaveLength(2);
    const details = view.getByRole("button", { name: "Purpose details" });
    expect(details.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(details);
    expect(details.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(details.getAttribute("aria-controls")!)?.hidden).toBe(false);
    fireEvent.click(details);
    fireEvent.click(view.getByRole("checkbox", { name: "Advertising measurement" }));
    fireEvent.click(view.getByRole("button", { name: "Save choices" }));
    expect(consent.getAnalyticsConsent()).toMatchObject({ analytics: false, advertising: true });
    attribution.retainCampaignTouch(location.search);
    await act(async () => consent.setAccountAnalyticsAllowed(false, true));
    expect(attribution.getStoredCampaignAttribution().firstTouch?.campaign).toBe("tagged");
    expect(view.queryByRole("button", { name: "Tracking preferences" })).toBeNull();
    expect(view.queryByRole("region", { name: "Tracking preferences" })).toBeNull();
    expect(view.getByRole("link", { name: "Tracking preferences" }).getAttribute("href")).toBe("/privacy#analytics");
    // The footer opens the Privacy page, which renders the same controls inline.
    view.rerender(<AnalyticsPreference />);
    fireEvent.click(view.getByRole("checkbox", { name: "Advertising measurement" }));
    fireEvent.click(view.getByRole("button", { name: "Accept all" }));
    expect(consent.getAnalyticsConsent()).toMatchObject({ analytics: true, advertising: true });
    expect(view.getAllByRole("checkbox").every(input => (input as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Reject optional" }));
    expect(consent.getAnalyticsConsent()).toMatchObject({ analytics: false, advertising: false });
    expect(view.getAllByRole("checkbox").every(input => !(input as HTMLInputElement).checked)).toBe(true);
    expect(attribution.getStoredCampaignAttribution().firstTouch).toBeNull();
    expect(JSON.parse(localStorage.getItem("house:analytics-consent")!)).toEqual({ version: 2, analytics: false, advertising: false });
    cleanup();
    let account: string | null = null;
    let pathname = "/";
    const writes: Array<{ account: string | null; analytics: boolean; advertising: boolean; campaign?: string }> = [];
    mock.module("next/navigation", () => ({ usePathname: () => pathname }));
    mock.module("@/hooks/use-auth", () => ({ useAuth: () => ({ ready: true, account: account ? { publicId: account, roles: [], isAdmin: false } : null }) }));
    mock.module("@/lib/runtime-config", () => ({ useRuntimeConfig: () => ({ ready: true, POSTHOG_PROJECT_TOKEN: "" }) }));
    mock.module("@/lib/api", () => ({ getAuthToken: () => account, retainCampaignAttribution: async () => {
      const { analytics, advertising } = consent.getAnalyticsConsent();
      writes.push({ account, analytics, advertising, campaign: attribution.getStoredCampaignAttribution().firstTouch?.campaign });
      return { analytics, advertising, version: "v1" };
    } }));
    consent.saveAnalyticsChoice({ analytics: false, advertising: true });
    const { ProductAnalytics } = await import("../components/product-analytics");
    const tracking = render(<ProductAnalytics />);
    await waitFor(() => expect(attribution.getStoredCampaignAttribution().firstTouch?.campaign).toBe("tagged"));
    dom.history.replaceState(null, "", "/direct");
    pathname = "/direct";
    tracking.rerender(<ProductAnalytics />);
    expect(attribution.getStoredCampaignAttribution().firstTouch?.campaign).toBe("tagged");
    account = "account-a";
    tracking.rerender(<ProductAnalytics />);
    await waitFor(() => expect(writes.some(write => write.account === "account-a" && !write.analytics && write.advertising && write.campaign === "tagged")).toBe(true));
    account = "account-b";
    tracking.rerender(<ProductAnalytics />);
    await waitFor(() => expect(writes.some(write => write.account === "account-b")).toBe(true));
    expect(writes.filter(write => write.account === "account-b").every(write => write.campaign === undefined)).toBe(true);

  } finally { cleanup(); dom.close(); }
});
