"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { capturePage, initializeAnalytics, recordBrowserSession, setAnalyticsIdentity, suspendAnalytics } from "@/lib/product-analytics";
import { dismissAnalyticsNotice, loadAnalyticsConsent, useAnalyticsConsent } from "@/lib/analytics-consent";
import { AnalyticsPreference } from "./analytics-preference";

export function ProductAnalytics() {
  const pathname = usePathname();
  const config = useRuntimeConfig();
  const consent = useAnalyticsConsent();
  const { ready, account } = useAuth();
  const internal = Boolean(account?.isAdmin || account?.roles.some(role => ["admin", "sysop", "producer"].includes(role)));
  const privateRoute = /^\/(admin|oauth|sign-in|sign-up|callback)(\/|$)/.test(pathname);
  useEffect(() => { void loadAnalyticsConsent(); }, []);
  useEffect(() => {
    if (consent.notice.path !== null && consent.notice.path !== pathname) dismissAnalyticsNotice();
  }, [pathname, consent.notice.path]);
  useEffect(() => {
    if (!ready || !config.ready || !config.POSTHOG_PROJECT_TOKEN || location.hostname !== "thehouse.game" || !consent.ready || !consent.analytics || internal || privateRoute) {
      suspendAnalytics();
      return;
    }
    let active = true;
    void initializeAnalytics(config.POSTHOG_PROJECT_TOKEN, "https://k.thehouse.game").then(() => {
      if (!active) return;
      setAnalyticsIdentity(account?.publicId ?? null, internal || privateRoute);
      if (account?.publicId) {
        // Authorized account linking: persist the browser-retained touches
        // server-side so MCP/API conversions share the same attribution.
        void import("@/lib/api")
          .then(({ retainCampaignAttribution }) => retainCampaignAttribution())
          .catch(() => undefined);
      }
      capturePage(pathname);
      // Record onboarding only; all text and images are masked. Game playback is
      // measured with explicit events and doesn't need DOM recordings.
      recordBrowserSession(!privateRoute && (pathname === "/agents/create" || pathname === "/dashboard"));
    });
    return () => { active = false; recordBrowserSession(false); };
  }, [ready, config.ready, config.POSTHOG_PROJECT_TOKEN, pathname, account?.publicId, internal, privateRoute, consent.ready, consent.analytics]);
  useEffect(() => {
    recordBrowserSession(consent.recordings && !privateRoute && (pathname === "/agents/create" || pathname === "/dashboard"));
  }, [consent.recordings, privateRoute, pathname]);
  if (!ready || internal || privateRoute || pathname === "/privacy" || !config.POSTHOG_PROJECT_TOKEN) return null;
  return <AnalyticsPreference banner />;
}
