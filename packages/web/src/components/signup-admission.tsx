"use client";

import { useEffect, useRef, useState } from "react";
import { getSignupAvailability, providerAuthFetch, type SignupAvailability } from "@/lib/api";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { installSignupPrompt, registerCampaignRedemption } from "@/lib/signup-verification";
import { ConfirmActionDialog } from "./confirm-action-dialog";

type Turnstile = {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
};
type Prompt = { id: number; resolve: (token: string) => void; reject: (reason: Error) => void; next?: string; notice?: string };
const cancellation = () => new Error("Signup verification was cancelled.");

export function SignupAdmission() {
  const { TURNSTILE_SITE_KEY: siteKey } = useRuntimeConfig();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const active = useRef<Prompt | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    const uninstall = installSignupPrompt((next, notice) => new Promise((resolve, reject) => {
      active.current?.reject(cancellation());
      const request = { id: ++sequence.current, resolve, reject, next, notice };
      active.current = request;
      setPrompt(request);
    }));
    return () => { uninstall(); active.current?.reject(cancellation()); active.current = null; };
  }, []);

  useEffect(() => {
    const match = /^#signup_campaign=([A-Za-z0-9_-]{43})$/.exec(location.hash);
    if (!match) return;
    history.replaceState(history.state, "", location.pathname + location.search);
    registerCampaignRedemption(providerAuthFetch("/api/auth/signup-campaign/session", {
      method: "POST", credentials: "include", signal: AbortSignal.timeout(8000), body: JSON.stringify({ code: match[1] }),
    }));
  }, []);

  if (!prompt) return null;
  function finish(token?: string) {
    const request = active.current;
    if (request?.id !== prompt?.id) return;
    active.current = null;
    setPrompt(null);
    if (token) request?.resolve(token);
    else request?.reject(cancellation());
  }
  return <SignupPrompt key={prompt.id} next={prompt.next} siteKey={siteKey} initialNotice={prompt.notice} finish={finish} />;
}

function SignupPrompt({ next, siteKey, initialNotice, finish }: { next?: string; siteKey?: string; initialNotice?: string; finish: (token?: string) => void }) {
  const [status, setStatus] = useState<SignupAvailability | null>(next ? { available: false, nextAvailableAt: next, rate: 0 } : null);
  const [notice, setNotice] = useState(initialNotice ?? "");
  const [checking, setChecking] = useState(false);
  const [availabilityFailed, setAvailabilityFailed] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const [challenge, setChallenge] = useState(0);
  const [token, setToken] = useState("");
  const element = useRef<HTMLDivElement>(null);
  const turnstile = () => (window as Window & { turnstile?: Turnstile }).turnstile;
  const available = status?.available ?? false;

  async function check(signal?: AbortSignal) {
    setChecking(true);
    try {
      const result = await getSignupAvailability(signal);
      if (signal?.aborted) return;
      setStatus(result);
      setAvailabilityFailed(false);
    } catch {
      if (!signal?.aborted) setAvailabilityFailed(true);
    } finally {
      if (!signal?.aborted) setChecking(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void check(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (available || !status?.nextAvailableAt) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void check(controller.signal), Math.max(1000, Date.parse(status.nextAvailableAt) - Date.now()));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [available, status?.nextAvailableAt]);

  useEffect(() => {
    if (!available || !siteKey) return;
    if (turnstile()) {
      setScriptReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    function unavailable() {
      setScriptFailed(true);
      setNotice("Verification could not load. Try again.");
    }
    script.onload = () => {
      if (turnstile()) setScriptReady(true);
      else unavailable();
    };
    script.onerror = unavailable;
    document.head.appendChild(script);
    return () => {
      script.onload = script.onerror = null;
      script.remove();
    };
  }, [available, siteKey, challenge]);

  useEffect(() => {
    if (!available || !siteKey || !scriptReady || !element.current) return;
    const widget = turnstile();
    if (!widget) return;
    const id = widget.render(element.current, {
      sitekey: siteKey, action: "house_signup", size: "flexible", theme: "dark",
      callback: (value: string) => { setToken(value); },
      "expired-callback": () => { setToken(""); setNotice("Verification expired. Try again."); },
      "error-callback": () => { setToken(""); setNotice("Verification could not load. Try again."); },
    });
    return () => { if (id) widget.remove(id); };
  }, [available, siteKey, scriptReady, challenge]);

  const minutes = status?.nextAvailableAt
    ? Math.max(1, Math.ceil((Date.parse(status.nextAvailableAt) - Date.now()) / 60_000))
    : null;
  return (
    <ConfirmActionDialog title={available ? "Verify to create your account" : "Signup availability"}
      confirmLabel="Create account" showConfirm={available} disabled={!available || !token} onConfirm={() => finish(token)} onClose={() => finish()}>
      {!available && <p role="status">{minutes !== null
        ? `Signups are full. Try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`
        : checking ? "Checking signup availability…" : "Check whether a signup slot is available."}</p>}
      {available && siteKey && <div ref={element} data-analytics-private />}
      {available && !siteKey && <p role="alert">Human verification is temporarily unavailable.</p>}
      {availabilityFailed && <p role="alert">Signup availability is temporarily unavailable.</p>}
      {notice && <p role="alert">{notice}</p>}
      <div className="flex flex-wrap gap-4">
        {!available && <button type="button" disabled={checking} className="influence-link" onClick={() => void check()}>Check again</button>}
        {available && (scriptReady || scriptFailed) && notice && <button type="button" className="influence-link" onClick={() => {
          setToken(""); setNotice(""); setScriptFailed(false); setChallenge(value => value + 1);
        }}>Try again</button>}
        <a href="/sign-in" className="influence-link" onClick={() => finish()}>Sign in</a>
      </div>
    </ConfirmActionDialog>
  );
}
