"use client";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { dismissAnalyticsNotice, loadAnalyticsConsent, saveAnalyticsChoice, showAnalyticsNotice, useAnalyticsConsent } from "@/lib/analytics-consent";

export function AnalyticsPreference({ banner = false }: { banner?: boolean }) {
  const consent = useAnalyticsConsent();
  const pathname = usePathname();
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const panel = useRef<HTMLElement>(null);
  const reopen = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (open) panel.current?.focus();
    else if (restoreFocus.current) { reopen.current?.focus(); restoreFocus.current = false; }
  }, [open, consent.choiceRevision, consent.notice.path]);
  const [draft, setDraft] = useState<{ analytics: boolean; advertising: boolean } | null>(null);
  const analytics = !consent.blocked && (draft?.analytics ?? consent.analytics);
  const advertising = !consent.blocked && (draft?.advertising ?? consent.advertising);
  useEffect(() => { void loadAnalyticsConsent(); }, []);
  const complete = consent.choice?.advertising !== undefined;
  useEffect(() => {
    if (banner && consent.ready && consent.country === "US" && !complete && !consent.blocked) showAnalyticsNotice(pathname);
  }, [banner, consent.ready, consent.country, complete, consent.blocked, pathname]);
  if (!consent.ready) return null;
  const hidden = banner && !open && !error && (complete || consent.blocked || (consent.country === "US" && consent.notice.seen && consent.notice.path !== pathname));
  const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary";
  const button = `influence-button-secondary min-h-11 rounded-lg px-2 py-2 text-xs sm:text-sm ${focus}`;
  if (hidden) return <button ref={reopen} type="button" className={`${button} fixed bottom-2 left-2 z-50 bg-surface`} onClick={() => { setDraft(null); setDetailsOpen(false); setOpen(true); }}>Tracking preferences</button>;
  const choose = (analytics: boolean, advertising: boolean) => {
    const saved = saveAnalyticsChoice({ analytics, advertising });
    setError(!saved);
    if (saved) { restoreFocus.current = banner; setOpen(false); }
  };
  return <section ref={panel} tabIndex={-1} aria-label="Tracking preferences" data-analytics-private className={banner
    ? "fixed bottom-0 left-0 right-0 z-50 max-h-[100dvh] overflow-y-auto border-t border-border-strong bg-surface-raised px-4 py-3 text-text-primary shadow-2xl"
    : "text-text-primary"}>
    <div className={`grid gap-x-8 gap-y-2 ${banner ? "lg:grid-cols-[minmax(0,1fr)_clamp(24rem,36vw,40rem)] lg:items-center" : ""}`}>
      <div className="min-w-0">
        <h2 className="sr-only">Cookies &amp; tracking</h2>
        <p className="text-sm leading-snug text-text-secondary">Essential cookies stay on. Optional analytics improve The House; advertising measurement shares outcomes with Meta, Google, TikTok, and X.</p>
        <div className="flex flex-wrap items-center gap-x-6">
          <fieldset className="grid min-w-0 w-full max-w-sm grid-cols-2 gap-x-4 text-sm sm:w-auto sm:flex sm:gap-x-6">
            <legend className="sr-only">Optional tracking purposes</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 leading-snug"><input className={`h-4 w-4 shrink-0 [color-scheme:dark] accent-[rgb(var(--accent-rgb))] ${focus}`} type="checkbox" aria-label="Product analytics and diagnostics" checked={analytics} disabled={consent.blocked} onChange={event => setDraft({ analytics: event.target.checked, advertising })} />Product analytics</label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 leading-snug"><input className={`h-4 w-4 shrink-0 [color-scheme:dark] accent-[rgb(var(--accent-rgb))] ${focus}`} type="checkbox" aria-label="Advertising measurement" checked={advertising} disabled={consent.blocked} onChange={event => setDraft({ analytics, advertising: event.target.checked })} />Advertising measurement</label>
          </fieldset>
          <div className="flex flex-wrap items-center gap-x-4 text-xs">
            <button type="button" aria-expanded={detailsOpen} aria-controls={detailsId} className={`flex min-h-8 items-center gap-1.5 ${focus}`} onClick={() => setDetailsOpen(value => !value)}><span aria-hidden="true">{detailsOpen ? "▾" : "▸"}</span><span className="underline underline-offset-4">Purpose details</span></button>
            <a className={`flex min-h-8 items-center underline underline-offset-4 ${focus}`} href="/privacy#analytics">Privacy policy</a>
            {banner && (open || consent.country === "US") && <button type="button" className={`min-h-8 underline underline-offset-4 ${focus}`} onClick={() => { restoreFocus.current = true; dismissAnalyticsNotice(); setOpen(false); }}>Close</button>}
          </div>
        </div>
        {consent.blocked && <p className="text-sm">Your browser privacy signal or storage settings disable both optional purposes.</p>}
      </div>
      <div id={detailsId} hidden={!detailsOpen} className="order-1 max-h-[25dvh] space-y-2 overflow-y-auto border-t border-border-strong py-2 text-sm leading-snug lg:order-2 lg:col-span-full" tabIndex={detailsOpen ? 0 : undefined}>
        <p><strong>Essential functionality — always active.</strong> Sign-in, security, and remembering your preferences.</p>
        <p><strong>Product analytics and diagnostics.</strong> PostHog usage analytics, performance and error reports, and masked session recordings help improve The House.</p>
        <p><strong>Advertising measurement.</strong> Campaign attribution and conversion delivery to Meta, Google, TikTok, and X measure which ads lead to signups, agent readiness, and season entry.</p>
      </div>
      {!consent.blocked && <div className={`order-2 grid grid-cols-3 gap-2 lg:order-1 ${banner ? "sticky bottom-0 bg-surface-raised lg:static" : ""}`}>
        <button type="button" className={`${button} min-w-0`} onClick={() => choose(true, true)}>Accept all</button>
        <button type="button" className={`${button} min-w-0`} onClick={() => choose(false, false)}>Reject optional</button>
        <button type="button" className={`${button} min-w-0`} onClick={() => choose(analytics, advertising)}>Save choices</button>
      </div>}
      {error && <p role="alert" className="order-3 text-sm lg:col-span-full">Your choices apply for this visit but could not be saved in this browser.</p>}
    </div>
  </section>;
}
