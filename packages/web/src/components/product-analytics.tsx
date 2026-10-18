"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { capturePage, initializeAnalytics, recordBrowserSession, setAnalyticsIdentity } from "@/lib/product-analytics";

export function ProductAnalytics() {
  const pathname = usePathname();
  const config = useRuntimeConfig();
  const { ready, account } = useAuth();
  const internal = Boolean(account?.isAdmin || account?.roles.some(role => ["admin", "sysop", "producer"].includes(role)));
  useEffect(() => {
    if (!ready || !config.ready || !config.POSTHOG_PROJECT_TOKEN || location.hostname !== "thehouse.game") return;
    const privateRoute = /^\/(admin|oauth|sign-in|sign-up|callback)(\/|$)/.test(pathname);
    let active = true;
    void initializeAnalytics(config.POSTHOG_PROJECT_TOKEN, "https://us.i.posthog.com").then(() => {
      if (!active) return;
      setAnalyticsIdentity(account?.publicId ?? null, internal || privateRoute);
      capturePage(pathname);
      // Record onboarding only; all text and images are masked. Game playback is
      // measured with explicit events and doesn't need DOM recordings.
      recordBrowserSession(!privateRoute && (pathname === "/agents/create" || pathname === "/dashboard"));
    });
    return () => { active = false; recordBrowserSession(false); };
  }, [ready, config.ready, config.POSTHOG_PROJECT_TOKEN, pathname, account?.publicId, internal]);
  return null;
}
