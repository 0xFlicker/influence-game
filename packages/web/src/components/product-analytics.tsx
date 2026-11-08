"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { capturePage, initializeAnalytics, recordBrowserSession, setAnalyticsIdentity, suspendAnalytics } from "@/lib/product-analytics";
import { dismissAnalyticsNotice, getAnalyticsConsent, loadAnalyticsConsent, setAccountAnalyticsAllowed, useAnalyticsConsent } from "@/lib/analytics-consent";
import { bindCampaignAccount, clearCampaignAttribution } from "@/lib/campaign-attribution";
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
  const [retryAttempt, setRetryAttempt] = useState(0);
  const work = useRef<Promise<void>>(Promise.resolve());
  const lastAccount = useRef<string | null | undefined>(undefined);
  const lastChoiceRevision = useRef(0);
  const accountPreferenceVersion = useRef<string | undefined>(undefined);
  useEffect(() => {
    suspendAnalytics();
    if (!ready || !consent.ready) return;
    const publicId = account?.publicId ?? null;
    if (lastAccount.current !== publicId) {
      if (lastAccount.current) clearCampaignAttribution();
      bindCampaignAccount(publicId, false);
      lastAccount.current = publicId;
      accountPreferenceVersion.current = undefined;
      setAccountAnalyticsAllowed(null);
      lastChoiceRevision.current = consent.choiceRevision;
    }
    const explicitChoice = lastChoiceRevision.current !== consent.choiceRevision;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // Serialize preference writes; a slow allow request cannot land after withdrawal.
    work.current = work.current.then(async () => {
      if (!active) return;
      const api = await import("@/lib/api");
      if (!active) return;
      const token = api.getAuthToken();
      if (publicId && token) {
        const result = await api.retainCampaignAttribution(explicitChoice, accountPreferenceVersion.current);
        if (!active || api.getAuthToken() !== token) return;
        accountPreferenceVersion.current = result.version;
        lastChoiceRevision.current = consent.choiceRevision;
        setAccountAnalyticsAllowed(result.analytics);
      }
      if (!active || (publicId && !token) || !config.ready || !config.POSTHOG_PROJECT_TOKEN ||
        location.hostname !== "thehouse.game" || !getAnalyticsConsent().analytics || internal || privateRoute) return;
      bindCampaignAccount(publicId);
      await initializeAnalytics(config.POSTHOG_PROJECT_TOKEN, "https://k.thehouse.game");
      if (!active || api.getAuthToken() !== token || !getAnalyticsConsent().analytics) return;
      setAnalyticsIdentity(publicId, false);
      capturePage(pathname);
      if (publicId) {
        const result = await api.retainCampaignAttribution(false, accountPreferenceVersion.current);
        if (!active || api.getAuthToken() !== token) return;
        accountPreferenceVersion.current = result.version;
        setAccountAnalyticsAllowed(result.analytics);
      }
      if (active && getAnalyticsConsent().recordings) recordBrowserSession(pathname === "/agents/create" || pathname === "/dashboard");
    }).catch(() => {
      // A failed preference sync cannot authorize optional tracking.
      if (active) {
        suspendAnalytics();
        retryTimer = setTimeout(() => setRetryAttempt(value => value + 1), Math.min(30_000, 1000 * 2 ** Math.min(retryAttempt, 5)));
      }
      console.warn("[Analytics] Account preference sync unavailable; tracking remains stopped");
    });
    return () => { active = false; clearTimeout(retryTimer); recordBrowserSession(false); };
  }, [ready, config.ready, config.POSTHOG_PROJECT_TOKEN, pathname, account?.publicId, internal, privateRoute,
    consent.ready, consent.analytics, consent.choiceRevision, retryAttempt]);
  if (!ready || internal || privateRoute || pathname === "/privacy" || !config.POSTHOG_PROJECT_TOKEN) return null;
  return <AnalyticsPreference banner />;
}
