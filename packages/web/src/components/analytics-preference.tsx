"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { dismissAnalyticsNotice, loadAnalyticsConsent, saveAnalyticsChoice, showAnalyticsNotice, useAnalyticsConsent } from "@/lib/analytics-consent";
import { type AnalyticsChoice } from "@/lib/analytics-policy";

export function AnalyticsPreference({ banner = false }: { banner?: boolean }) {
  const consent = useAnalyticsConsent();
  const pathname = usePathname();
  const [error, setError] = useState(false);
  useEffect(() => { void loadAnalyticsConsent(); }, []);
  useEffect(() => {
    if (banner && consent.ready && consent.country === "US" && !consent.choice && !consent.blocked) showAnalyticsNotice(pathname);
  }, [banner, consent.ready, consent.country, consent.choice, consent.blocked, pathname]);
  if (!consent.ready || (banner && ((consent.choice && !error) || consent.blocked))) return null;
  if (banner && consent.country === "US" && consent.notice.seen && consent.notice.path !== pathname) return null;
  const choose = (choice: AnalyticsChoice) => setError(!saveAnalyticsChoice(choice));
  const button = "influence-button-secondary min-h-11 rounded-lg px-4 py-2 text-sm";
  return <section aria-label="Analytics preferences" data-analytics-private className={banner
    ? "fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-2xl rounded-xl border border-white/20 bg-[#171717] p-5 text-white shadow-2xl max-h-[80dvh] overflow-y-auto lg:bottom-0 lg:left-0 lg:right-0 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-x-8 lg:rounded-none lg:border-x-0 lg:border-b-0 lg:px-8 lg:py-4"
    : "space-y-4"}>
    <div>
      <h2 className="text-lg font-semibold">Help improve The House</h2>
      <p className="mt-2 text-sm leading-relaxed">
        {consent.blocked ? "Your browser privacy signal or storage settings disable optional analytics."
          : consent.analytics ? "Analytics is on. We use PostHog cookies and browser storage to measure visits, agent creation, match entry, and game watch time, and diagnose navigation problems."
            : "With your permission, we use PostHog cookies and browser storage to measure visits, agent creation, match entry, and game watch time, and diagnose navigation problems."}
        {!banner && <> Analytics includes masked session recordings on dashboard and agent-creation pages. Recordings are currently {consent.recordings ? "on" : "off"}.</>}
        {" "}Learn how analytics works and change your choices anytime in our <a className="underline underline-offset-4" href="/privacy#analytics">Privacy policy</a>.
      </p>
    </div>
    {!consent.blocked && <div className={`mt-4 flex flex-wrap gap-2${banner ? " lg:mt-0 lg:flex-nowrap" : ""}`}>
      <button type="button" className={button} onClick={() => banner && consent.country === "US" ? dismissAnalyticsNotice() : choose({ analytics: true })}>
        {banner && consent.country === "US" ? "Got it" : "Accept analytics"}
      </button>
      <button type="button" className={button} onClick={() => choose({ analytics: false })}>Reject optional tracking</button>
    </div>}
    {error && <p role="alert" className={`mt-2 text-sm${banner ? " lg:col-span-2" : ""}`}>Your choice applies for this visit but could not be saved in this browser.</p>}
  </section>;
}
