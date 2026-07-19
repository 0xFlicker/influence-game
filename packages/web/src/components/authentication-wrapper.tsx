"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClerkPasswordFlow, type ManagedAuthMode, type PasswordFlowIntent } from "@/components/clerk-password-flow";
import {
  E2ELayeredPasswordFlow,
  isLayeredAuthE2EAdapterEnabled,
} from "@/components/e2e-layered-password-flow";
import { useAuth } from "@/hooks/use-auth";
import type { ProviderAuthenticationAttempt } from "@/lib/auth-session-coordinator";

type AuthenticationRequestDetail = {
  intent?: PasswordFlowIntent;
  email?: string;
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function AuthenticationWrapper({
  managedAuthMode,
  presentation = "modal",
  initialIntent = "sign_in",
  initialEmail = "",
  onInlineComplete,
}: {
  managedAuthMode: ManagedAuthMode;
  presentation?: "modal" | "inline";
  initialIntent?: PasswordFlowIntent;
  initialEmail?: string;
  onInlineComplete?: () => void;
}) {
  const {
    beginAuthenticationAttempt,
    cancelAuthenticationAttempt,
    openPrivySignIn,
  } = useAuth();
  const [open, setOpen] = useState(presentation === "inline");
  const [intent, setIntent] = useState<PasswordFlowIntent>(initialIntent);
  const [email, setEmail] = useState(initialEmail);
  const [attempt, setAttempt] =
    useState<ProviderAuthenticationAttempt | null>(null);
  const [reversePrivyToken, setReversePrivyToken] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const invokingControlRef = useRef<HTMLElement | null>(null);

  const restoreInvokingFocus = useCallback(() => {
    const control = invokingControlRef.current;
    invokingControlRef.current = null;
    window.requestAnimationFrame(() => control?.focus());
  }, []);

  const close = useCallback((cancelAttempt: boolean) => {
    if (cancelAttempt) cancelAuthenticationAttempt();
    setReversePrivyToken(null);
    setAttempt(null);
    if (presentation === "inline") {
      setIntent("sign_in");
      setEmail("");
      queueMicrotask(() => setAttempt(beginAuthenticationAttempt()));
      return;
    }
    setOpen(false);
    restoreInvokingFocus();
  }, [
    beginAuthenticationAttempt,
    cancelAuthenticationAttempt,
    presentation,
    restoreInvokingFocus,
  ]);

  const start = useCallback((request: AuthenticationRequestDetail) => {
    cancelAuthenticationAttempt();
    invokingControlRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setIntent(request.intent ?? "sign_in");
    setEmail(request.email ?? "");
    setReversePrivyToken(null);
    setAttempt(beginAuthenticationAttempt());
    setOpen(true);
  }, [beginAuthenticationAttempt, cancelAuthenticationAttempt]);

  useEffect(() => {
    if (presentation === "inline") {
      let cancelled = false;
      let started = false;
      queueMicrotask(() => {
        if (cancelled) return;
        started = true;
        setAttempt(beginAuthenticationAttempt());
      });
      return () => {
        cancelled = true;
        if (started) cancelAuthenticationAttempt();
      };
    }

    const signIn = () => start({ intent: "sign_in" });
    const createAccount = () => start({ intent: "create_account" });
    const linkPassword = (event: Event) => {
      const detail = (event as CustomEvent<AuthenticationRequestDetail>).detail;
      start({ intent: "link_password", email: detail?.email });
    };
    const resetPassword = (event: Event) => {
      const detail = (event as CustomEvent<AuthenticationRequestDetail>).detail;
      start({ intent: "reset_password", email: detail?.email });
    };
    window.addEventListener("auth:open-sign-in", signIn);
    window.addEventListener("auth:open-create-account", createAccount);
    window.addEventListener("auth:open-link-password", linkPassword);
    window.addEventListener("auth:open-reset-password", resetPassword);
    return () => {
      window.removeEventListener("auth:open-sign-in", signIn);
      window.removeEventListener("auth:open-create-account", createAccount);
      window.removeEventListener("auth:open-link-password", linkPassword);
      window.removeEventListener("auth:open-reset-password", resetPassword);
    };
  }, [
    beginAuthenticationAttempt,
    cancelAuthenticationAttempt,
    presentation,
    start,
  ]);

  useEffect(() => {
    if (!open || presentation !== "modal") return;
    const dialog = dialogRef.current;
    const previouslyHidden = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const heading = dialog?.querySelector<HTMLElement>("h2");
    heading?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previouslyHidden;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open, presentation]);

  if (!open || (!attempt && !reversePrivyToken)) return null;

  const PasswordFlow = isLayeredAuthE2EAdapterEnabled()
    ? E2ELayeredPasswordFlow
    : ClerkPasswordFlow;
  const flow = reversePrivyToken && !attempt ? (
    <ReversePrivyLinkConfirmation
      mode={managedAuthMode}
      onContinue={() => {
        setIntent("sign_in");
        setAttempt(beginAuthenticationAttempt());
      }}
      onCancel={() => close(true)}
    />
  ) : attempt ? (
    <PasswordFlow
      key={`${intent}:${attempt.generation}`}
      intent={intent}
      mode={managedAuthMode}
      attempt={attempt}
      initialEmail={email}
      presentation={presentation}
      reversePrivyToken={reversePrivyToken ?? undefined}
      onIntentChange={setIntent}
      onComplete={() => {
        if (presentation === "inline") {
          onInlineComplete?.();
        } else {
          close(intent === "reset_password");
        }
      }}
      onCancel={() => close(true)}
      onContinueWithPrivy={() => {
        setAttempt(null);
        openPrivySignIn((outcome) => {
          if (outcome.kind === "link_required") {
            setReversePrivyToken(outcome.token);
            return;
          }
          if (outcome.kind === "cancelled") {
            setAttempt(beginAuthenticationAttempt());
          }
        });
      }}
    />
  ) : null;

  if (presentation === "inline") {
    return (
      <section aria-label="Authentication" className="influence-panel rounded-xl p-6">
        {flow}
      </section>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-8"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) close(true);
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Influence authentication"
        tabIndex={-1}
        className="influence-panel relative max-h-full w-full max-w-md overflow-y-auto rounded-xl p-6 shadow-2xl outline-none"
      >
        <button
          type="button"
          aria-label="Close authentication"
          className="influence-button-secondary absolute right-4 top-4 min-h-11 min-w-11 rounded-lg px-3 py-2 text-sm"
          onClick={() => close(true)}
        >
          Close
        </button>
        <div className="pr-16">{flow}</div>
      </div>
    </div>
  );
}

function ReversePrivyLinkConfirmation({
  mode,
  onContinue,
  onCancel,
}: {
  mode: ManagedAuthMode;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-5">
      <h2 tabIndex={-1} className="influence-section-title text-xl outline-none">
        Link Privy to your account?
      </h2>
      <p className="influence-copy text-sm">
        This Privy email belongs to an existing email/password account. Sign in
        with that password to prove the account is yours. We will add Privy to
        the existing account; no new account will be created.
      </p>
      {mode === "full" ? (
        <button
          type="button"
          className="influence-button-primary rounded-lg px-4 py-2 text-sm"
          onClick={onContinue}
        >
          Continue with email/password
        </button>
      ) : (
        <p role="alert" className="text-sm text-amber-300">
          Linking a new sign-in method is temporarily unavailable. You can
          still sign in with your existing email/password.
        </p>
      )}
      <button
        type="button"
        className="influence-button-secondary rounded-lg px-4 py-2 text-sm"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}
