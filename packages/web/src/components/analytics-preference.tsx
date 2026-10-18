"use client";
import { useEffect, useState } from "react";
import { loadAnalyticsConsent, saveAnalyticsChoice, useAnalyticsConsent } from "@/lib/analytics-consent";
import { type AnalyticsChoice } from "@/lib/analytics-policy";

export function AnalyticsPreference({ banner = false }: { banner?: boolean }) {
  const consent = useAnalyticsConsent();
  const [error, setError] = useState(false);
  useEffect(() => { void loadAnalyticsConsent(); }, []);
  if (!consent.ready || (banner && ((consent.choice && !error) || consent.blocked))) return null;
  const choose = (choice: AnalyticsChoice) => setError(!saveAnalyticsChoice(choice));
  const button = "influence-button-secondary min-h-11 rounded-lg px-4 py-2 text-sm";
  return <section aria-label="Analytics preferences" data-analytics-private className={banner
    ? "fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-2xl rounded-xl border border-white/20 bg-[#171717] p-5 text-white shadow-2xl max-h-[80dvh] overflow-y-auto"
    : "space-y-4"}>
    <h2 className="text-lg font-semibold">Help improve The House</h2>
    <p className="mt-2 text-sm leading-relaxed">
      {consent.blocked ? "Your browser privacy signal or storage settings disable optional analytics."
        : consent.analytics ? "Analytics is on. We use PostHog cookies and browser storage to measure visits, agent creation, match entry, and game watch time."
          : "With your permission, we use PostHog cookies and browser storage to measure visits, agent creation, match entry, and game watch time."}
      {" "}Accepting also allows masked session recordings on dashboard and agent-creation pages. Recordings are currently {consent.recordings ? "on" : "off"}. You can change these choices anytime on our <a className="underline underline-offset-4" href="/privacy#analytics">Privacy page</a>.
    </p>
    {!consent.blocked && <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" className={button} onClick={() => choose({ analytics: true })}>
        Accept analytics
      </button>
      <button type="button" className={button} onClick={() => choose({ analytics: false })}>Reject optional tracking</button>
    </div>}
    {error && <p role="alert" className="mt-2 text-sm">Your choice applies for this visit but could not be saved in this browser.</p>}
  </section>;
}
