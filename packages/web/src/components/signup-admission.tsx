"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { providerAuthFetch } from "@/lib/api";
import { useRuntimeConfig } from "@/lib/runtime-config";
import { installSignupPrompt, registerCampaignRedemption, type SignupStep } from "@/lib/signup-verification";
import { SignupAvailabilityNotice, useSignupAvailability } from "./signup-availability";

type Turnstile = {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
};
type Prompt = {
  id: number;
  step: SignupStep;
  resolve: (token?: string) => void;
  reject: (reason: Error) => void;
};
const cancellation = () => new Error("Signup verification was cancelled.");

type Outlet = "inline" | "modal" | "invite";
const SignupPresentationContext = createContext<{
  active: boolean;
  showing: Outlet | undefined;
  setOutlet: (outlet: Outlet, element: HTMLDivElement | null) => void;
  cancel: () => void;
} | null>(null);

export function useSignupPromptOutlet(outlet: Outlet) {
  const context = useContext(SignupPresentationContext);
  const setOutlet = context?.setOutlet;
  const ref = useCallback((element: HTMLDivElement | null) => {
    setOutlet?.(outlet, element);
  }, [outlet, setOutlet]);
  return { outletRef: ref, active: context?.active ?? false, showing: context?.showing === outlet, cancel: context?.cancel };
}

export function SignupAdmission({ children }: { children: ReactNode }) {
  const { TURNSTILE_SITE_KEY: siteKey } = useRuntimeConfig();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [outlets, setOutlets] = useState<Partial<Record<Outlet, HTMLDivElement | null>>>({});
  const active = useRef<Prompt | null>(null);
  const sequence = useRef(0);
  const setOutlet = useCallback((outlet: Outlet, element: HTMLDivElement | null) => {
    setOutlets(previous => previous[outlet] === element ? previous : { ...previous, [outlet]: element });
  }, []);
  const cancel = useCallback(() => {
    active.current?.reject(cancellation());
    active.current = null;
    setPrompt(null);
  }, []);

  useEffect(() => {
    const uninstall = installSignupPrompt(step => new Promise((resolve, reject) => {
      active.current?.reject(cancellation());
      const request = { id: ++sequence.current, resolve, reject, step };
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

  const outlet = outlets.invite ? "invite" : outlets.modal ? "modal" : outlets.inline ? "inline" : undefined;
  function finish(token?: string) {
    const request = active.current;
    if (!request || request.id !== prompt?.id) return;
    active.current = null;
    setPrompt(null);
    request.resolve(token);
  }
  return (
    <SignupPresentationContext.Provider value={{ active: Boolean(prompt), showing: prompt ? outlet : undefined, setOutlet, cancel }}>
      {children}
      {prompt && <SignupPrompt key={prompt.id} step={prompt.step} siteKey={siteKey}
        cancel={cancel} finish={finish} target={outlet ? outlets[outlet] : null}
        showSignIn={!outlet || outlet === "invite"} />}
    </SignupPresentationContext.Provider>
  );
}

function SignupPrompt({ step, siteKey, cancel, finish, target, showSignIn }: {
  step: SignupStep; siteKey?: string; cancel: () => void; finish: (token?: string) => void;
  target?: HTMLDivElement | null;
  showSignIn: boolean;
}) {
  const availability = useSignupAvailability(step.kind === "availability" ? step.nextAvailableAt : undefined);
  const [notice, setNotice] = useState(step.kind === "verification" ? step.notice ?? "" : "");
  const [challenge, setChallenge] = useState(0);
  const [token, setToken] = useState("");
  const element = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const available = availability.status?.available ?? false;
  const verify = available && step.kind === "verification";
  const title = verify ? "Verify to create your account" : "Signup availability";

  useEffect(() => {
    if (available && step.kind === "availability") finish();
  }, [available, finish, step.kind]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const standalone = dialog.current;
    standalone?.showModal();
    heading.current?.focus();
    return () => {
      standalone?.close();
      window.requestAnimationFrame(() => {
        if (previous?.isConnected && !previous.closest("[hidden]")) previous.focus();
      });
    };
  }, [target]);

  useEffect(() => {
    const container = element.current;
    if (!verify || !siteKey || !container) return;
    const turnstileWindow = window as Window & { turnstile?: Turnstile };
    let disposed = false;
    let removeWidget: (() => void) | undefined;
    let script: HTMLScriptElement | undefined;
    function unavailable() {
      if (!disposed) setNotice("Verification could not load. Try again.");
    }

    const showWidget = (widget: Turnstile | undefined) => {
      if (disposed) return;
      if (!widget) {
        unavailable();
        return;
      }
      const reset = (message: string) => {
        if (disposed) return;
        setToken("");
        setNotice(message);
      };
      try {
        const id = widget.render(container, {
          sitekey: siteKey, action: "house_signup", size: "flexible", theme: "dark",
          callback: (value: string) => { if (!disposed) setToken(value); },
          "expired-callback": () => reset("Verification expired. Try again."),
          "timeout-callback": () => reset("Verification timed out. Try again."),
          "error-callback": () => reset("Verification failed. Try again."),
        });
        if (id) removeWidget = () => widget.remove(id);
      } catch {
        unavailable();
      }
    };

    if (turnstileWindow.turnstile) {
      queueMicrotask(() => showWidget(turnstileWindow.turnstile));
    } else {
      script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => showWidget(turnstileWindow.turnstile);
      script.onerror = unavailable;
      document.head.appendChild(script);
    }
    return () => {
      disposed = true;
      removeWidget?.();
      if (script) {
        script.onload = script.onerror = null;
        script.remove();
      }
    };
  }, [verify, siteKey, challenge, target]);

  const content = (
    <section aria-labelledby={headingId} className="influence-copy space-y-4 text-sm">
      <h2 id={headingId} ref={heading} tabIndex={-1} className="influence-section-title text-xl outline-none">{title}</h2>
      {!available && <SignupAvailabilityNotice {...availability} />}
      {verify && siteKey && <div ref={element} data-analytics-private />}
      {verify && !siteKey && <p role="alert">Human verification is temporarily unavailable.</p>}
      {notice && <p role="alert">{notice}</p>}
      <div className="flex flex-wrap items-center gap-4">
        {verify && <button type="button" disabled={!token} onClick={() => finish(token)}
          className="influence-button-primary min-h-11 rounded-lg px-4 py-2 text-sm">Create account</button>}
        {verify && notice && <button type="button" className="influence-link min-h-11 py-2" onClick={() => {
          setToken(""); setNotice(""); setChallenge(value => value + 1);
        }}>Try again</button>}
        <button type="button" className="influence-link min-h-11 py-2" onClick={cancel}>Cancel</button>
        {showSignIn && <a href="/sign-in" className="influence-link inline-flex min-h-11 items-center" onClick={cancel}>Sign in</a>}
      </div>
    </section>
  );
  if (target) return createPortal(content, target);

  return (
    <dialog ref={dialog} aria-label={title}
      className="house-auth-panel fixed inset-0 m-auto w-[min(32rem,calc(100%-2rem))] rounded-3xl p-6 text-white backdrop:bg-black/75"
      onCancel={event => { event.preventDefault(); cancel(); }}>
      {content}
    </dialog>
  );
}
