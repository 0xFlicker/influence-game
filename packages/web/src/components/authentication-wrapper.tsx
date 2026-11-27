"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { AccountLegalConsent } from "@/components/account-legal-consent";
import { ClerkPasswordFlow, type ManagedAuthMode, type PasswordFlowIntent } from "@/components/clerk-password-flow";
import { E2ELayeredPasswordFlow } from "@/components/e2e-layered-password-flow";
import { useSignupPromptOutlet } from "@/components/signup-admission";
import { SignupAvailabilityGate } from "@/components/signup-availability";
import { useAuth } from "@/hooks/use-auth";
import { useMiniApp } from "@/components/farcaster-miniapp-provider";
import type { ProviderAuthenticationAttempt } from "@/lib/auth-session-coordinator";
import { isLayeredAuthE2EAdapterEnabled } from "@/lib/e2e-layered-auth";
import {
  PRESENTED_LEGAL_ACCEPTANCE,
  type PrivyAuthenticationRequest,
} from "@/lib/api";

type AuthenticationRequestDetail = {
  intent?: PasswordFlowIntent;
  email?: string;
};

type PrivyAccountHandoffState = "unlinked" | "creating" | "account_exists";

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
  managedAuthMode: ManagedAuthMode | "disabled";
  presentation?: "modal" | "inline";
  initialIntent?: PasswordFlowIntent;
  initialEmail?: string;
  onInlineComplete?: () => void;
}) {
  const isCreator = usePathname() === "/agents/create";
  const {
    beginAuthenticationAttempt,
    cancelAuthenticationAttempt,
    needsInvite,
    openPrivySignIn,
    resetPrivyIdentity,
  } = useAuth();
  const { suppressWebsiteAuthChrome } = useMiniApp();
  const { active: signupActive, showing: showingSignupStep, outletRef: signupOutletRef, cancel: cancelSignupStep } =
    useSignupPromptOutlet(presentation);
  const [open, setOpen] = useState(presentation === "inline");
  const [intent, setIntent] = useState<PasswordFlowIntent>(initialIntent);
  const [email, setEmail] = useState(initialEmail);
  const [attempt, setAttempt] =
    useState<ProviderAuthenticationAttempt | null>(null);
  const [reversePrivyToken, setReversePrivyToken] = useState<string | null>(null);
  const [privyAccountHandoff, setPrivyAccountHandoff] =
    useState<PrivyAccountHandoffState | null>(null);
  const [acceptedPrivyLegalTerms, setAcceptedPrivyLegalTerms] = useState(false);
  const [switchingPrivyAccount, setSwitchingPrivyAccount] = useState(false);
  const [privySwitchError, setPrivySwitchError] = useState<string | null>(null);
  const [privyAttemptError, setPrivyAttemptError] = useState<string | null>(null);
  const [privyStarting, setPrivyStarting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const invokingControlRef = useRef<HTMLElement | null>(null);
  const privySwitchGenerationRef = useRef(0);
  const isModalVisible = presentation === "modal"
    && open
    && !needsInvite
    && (attempt !== null || Boolean(reversePrivyToken) || privyStarting || signupActive);

  const restoreInvokingFocus = useCallback(() => {
    const control = invokingControlRef.current;
    invokingControlRef.current = null;
    window.requestAnimationFrame(() => control?.focus());
  }, []);

  const close = useCallback((cancelAttempt: boolean) => {
    privySwitchGenerationRef.current += 1;
    if (showingSignupStep) cancelSignupStep?.();
    if (cancelAttempt) cancelAuthenticationAttempt();
    setReversePrivyToken(null);
    setPrivyAccountHandoff(null);
    setAcceptedPrivyLegalTerms(false);
    setSwitchingPrivyAccount(false);
    setPrivySwitchError(null);
    setPrivyAttemptError(null);
    setPrivyStarting(false);
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
    cancelSignupStep,
    showingSignupStep,
  ]);

  const start = useCallback((request: AuthenticationRequestDetail) => {
    // Mini App uses Farcaster Quick Auth only — never open Privy/Clerk chrome.
    if (suppressWebsiteAuthChrome) return;
    privySwitchGenerationRef.current += 1;
    cancelAuthenticationAttempt();
    invokingControlRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setIntent(request.intent ?? "sign_in");
    setEmail(request.email ?? "");
    setReversePrivyToken(null);
    setPrivyAccountHandoff(null);
    setAcceptedPrivyLegalTerms(false);
    setSwitchingPrivyAccount(false);
    setPrivySwitchError(null);
    setPrivyAttemptError(null);
    setPrivyStarting(false);
    setAttempt(beginAuthenticationAttempt());
    setOpen(true);
  }, [
    beginAuthenticationAttempt,
    cancelAuthenticationAttempt,
    suppressWebsiteAuthChrome,
  ]);

  const selectPrimaryIntent = useCallback((
    nextIntent: "sign_in" | "create_account",
  ) => {
    if (!privyAccountHandoff && nextIntent === (showingSignupStep ? "create_account" : intent)) return;
    if (showingSignupStep) cancelSignupStep?.();
    privySwitchGenerationRef.current += 1;
    cancelAuthenticationAttempt();
    setIntent(nextIntent);
    setEmail("");
    setReversePrivyToken(null);
    setPrivyAccountHandoff(null);
    setAcceptedPrivyLegalTerms(false);
    setSwitchingPrivyAccount(false);
    setPrivySwitchError(null);
    setPrivyAttemptError(null);
    setPrivyStarting(false);
    setAttempt(beginAuthenticationAttempt());
  }, [
    beginAuthenticationAttempt,
    cancelAuthenticationAttempt,
    intent,
    privyAccountHandoff,
    cancelSignupStep,
    showingSignupStep,
  ]);

  const beginPrivyAuthentication = useCallback((
    request: PrivyAuthenticationRequest,
  ) => {
    const generation = ++privySwitchGenerationRef.current;
    setSwitchingPrivyAccount(false);
    setPrivySwitchError(null);
    setPrivyAttemptError(null);
    setAttempt(null);
    setPrivyAccountHandoff(null);
    setPrivyStarting(true);
    openPrivySignIn((outcome) => {
      if (privySwitchGenerationRef.current !== generation) return;
      setPrivyStarting(false);
      if (outcome.kind === "link_required") {
        setReversePrivyToken(outcome.token);
        return;
      }
      if (outcome.kind === "account_creation_required") {
        setAcceptedPrivyLegalTerms(false);
        setPrivyAccountHandoff("unlinked");
        setAttempt(beginAuthenticationAttempt());
        return;
      }
      if (outcome.kind === "account_already_exists") {
        setAcceptedPrivyLegalTerms(false);
        setPrivyAccountHandoff("account_exists");
        setAttempt(beginAuthenticationAttempt());
        return;
      }
      if (outcome.kind === "cancelled") {
        setAttempt(beginAuthenticationAttempt());
        return;
      }
      if (outcome.kind === "provider_error") {
        setPrivyAttemptError(outcome.message);
        setAttempt(beginAuthenticationAttempt());
      }
    }, request, () => {
      if (privySwitchGenerationRef.current === generation) setPrivyStarting(false);
    });
  }, [beginAuthenticationAttempt, openPrivySignIn]);

  const useDifferentPrivyAccount = useCallback(() => {
    const generation = ++privySwitchGenerationRef.current;
    setSwitchingPrivyAccount(true);
    setPrivySwitchError(null);
    void resetPrivyIdentity().then(() => {
      if (privySwitchGenerationRef.current !== generation) return;
      setIntent("sign_in");
      setReversePrivyToken(null);
      setPrivyAccountHandoff(null);
      setAcceptedPrivyLegalTerms(false);
      setSwitchingPrivyAccount(false);
      setAttempt(beginAuthenticationAttempt());
    }).catch((error: unknown) => {
      if (privySwitchGenerationRef.current !== generation) return;
      console.error("[InfluenceAuth] Privy sign-out failed:", error);
      setSwitchingPrivyAccount(false);
      setPrivySwitchError(
        error instanceof Error && error.message.includes("taking longer")
          ? "Privy sign-out is taking too long. Reload this page before trying another Privy account."
          : "We couldn't sign out of Privy. Reload this page before trying another Privy account.",
      );
    });
  }, [beginAuthenticationAttempt, resetPrivyIdentity]);

  useEffect(() => () => {
    privySwitchGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    if (suppressWebsiteAuthChrome) return;

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
    suppressWebsiteAuthChrome,
  ]);

  useEffect(() => {
    if (!isModalVisible) return;
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
      ).filter(element => !element.closest("[hidden]"));
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
  }, [close, isModalVisible, privyAccountHandoff]);

  // The invite prompt owns the pending Privy attempt and the page's focus.
  if (needsInvite || !open || (!attempt && !reversePrivyToken && !privyStarting && !signupActive)) return null;

  const PasswordFlow = isLayeredAuthE2EAdapterEnabled()
    ? E2ELayeredPasswordFlow
    : ClerkPasswordFlow;
  const passwordMode: ManagedAuthMode = managedAuthMode === "disabled"
    ? "existing-only"
    : managedAuthMode;
  const flow = privyStarting ? (
    <p role="status" className="influence-copy text-sm">Opening Privy…</p>
  ) : privyAccountHandoff && attempt ? (
    <PrivyAccountHandoff
      state={privyAccountHandoff}
      acceptedLegalTerms={acceptedPrivyLegalTerms}
      onAcceptedLegalTermsChange={setAcceptedPrivyLegalTerms}
      onContinue={() => {
        beginPrivyAuthentication(
          privyAccountHandoff === "creating"
            ? {
              intent: "create_account",
              legalAcceptance: PRESENTED_LEGAL_ACCEPTANCE,
            }
            : { intent: "sign_in" },
        );
      }}
      onStartSignup={() => {
        setIntent("create_account");
        setPrivyAccountHandoff("creating");
      }}
      onEmailSignIn={managedAuthMode === "disabled" ? undefined : () => selectPrimaryIntent("sign_in")}
      onUseDifferent={useDifferentPrivyAccount}
      switchingAccount={switchingPrivyAccount}
      switchError={privySwitchError}
    />
  ) : reversePrivyToken && !attempt ? (
    <ReversePrivyLinkConfirmation
      mode={passwordMode}
      onContinue={() => {
        setIntent("sign_in");
        setAttempt(beginAuthenticationAttempt());
      }}
      onCancel={() => close(true)}
    />
  ) : attempt && managedAuthMode === "disabled" ? (
    <PrivyOnlyEntry
      onContinue={() => beginPrivyAuthentication({ intent: "sign_in" })}
    />
  ) : attempt ? (
    <PasswordFlow
      key={`${intent}:${attempt.generation}`}
      intent={intent}
      mode={passwordMode}
      attempt={attempt}
      initialEmail={email}
      presentation={presentation}
      reversePrivyToken={reversePrivyToken ?? undefined}
      onIntentChange={(nextIntent, nextEmail) => {
        setEmail(nextEmail ?? "");
        setIntent(nextIntent);
      }}
      onComplete={() => {
        if (presentation === "inline") {
          onInlineComplete?.();
        } else {
          close(intent === "reset_password");
        }
      }}
      onCancel={() => close(true)}
      onContinueWithPrivy={(acceptedLegalTerms) => {
        if (intent === "create_account" && !acceptedLegalTerms) return;
        beginPrivyAuthentication(
          intent === "create_account" && acceptedLegalTerms
            ? {
              intent: "create_account",
              legalAcceptance: PRESENTED_LEGAL_ACCEPTANCE,
            }
            : { intent: "sign_in" },
        );
      }}
    />
  ) : null;
  const signupForm = managedAuthMode === "full" && intent === "create_account"
    && !privyStarting && !privyAccountHandoff && !reversePrivyToken
    ? (
      <SignupAvailabilityGate
        heading={<h2 tabIndex={-1} className="sr-only">Create account</h2>}
        pending={presentation === "modal" ? <SignupFormSkeleton /> : undefined}
      >
        {flow}
      </SignupAvailabilityGate>
    ) : flow;
  const panelBody = (
    <>
      <div hidden={showingSignupStep}>
        {privyAttemptError ? <p role="alert" className="mb-4 text-sm text-red-300">{privyAttemptError}</p> : null}
        {signupForm}
      </div>
      <div ref={signupOutletRef} />
    </>
  );
  const primaryTabs = managedAuthMode === "full"
    && (!privyStarting || showingSignupStep)
    && !privyAccountHandoff
    && (intent === "sign_in" || intent === "create_account")
    ? (
      <PrimaryIntentTabs
        intent={showingSignupStep ? "create_account" : intent}
        onSelect={selectPrimaryIntent}
      />
    )
    : null;

  if (presentation === "inline") {
    return (
      <section aria-label="Authentication" className="influence-panel rounded-xl p-6">
        {primaryTabs}
        {panelBody}
      </section>
    );
  }

  // Keep the panel in place as the forms, skeleton and availability notices swap.
  const primaryPanelHeight = isCreator ? "h-[54rem]" : "h-[48rem]";

  return createPortal(
    <div
      className="house-auth-backdrop fixed inset-0 z-[100] flex items-center justify-center px-4 py-6"
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
        className={`house-auth-panel relative max-h-full w-full max-w-lg overflow-y-auto rounded-3xl p-6 shadow-2xl outline-none sm:p-8 ${primaryTabs ? `${primaryPanelHeight} [scrollbar-gutter:stable]` : ""}`}
      >
        <div className="mb-6 flex items-center gap-4 border-b border-amber-100/15 pb-6">
          <div className="flex size-20 shrink-0 items-center justify-center rounded-full border border-amber-200/30 bg-[#100d18]/80">
            {/* eslint-disable-next-line @next/next/no-img-element -- House brand asset */}
            <img src="/logo.png" alt="The House" className="size-14 object-contain mix-blend-screen" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[.18em] text-amber-100/70">Enter The House</p>
            <p className="mt-2 text-xl font-semibold leading-tight text-amber-50">{isCreator ? "Bring your character to life." : "A place for your next move."}</p>
          </div>
        </div>
        {isCreator && <p className="mb-6 text-sm leading-6 text-white/70">Create a free account for more House messages, character images, and a place to save your Agent. Your draft stays right here.</p>}
        <div className="mb-6 flex flex-col-reverse items-stretch gap-4 sm:flex-row sm:items-center">
          {primaryTabs}
          <button
            type="button"
            aria-label="Close authentication"
            className="influence-button-secondary min-h-11 min-w-11 self-end rounded-lg px-3 py-2 text-sm sm:self-auto"
            onClick={() => close(true)}
          >
            Close
          </button>
        </div>
        {panelBody}
      </div>
    </div>,
    document.body,
  );
}

function SignupFormSkeleton() {
  return (
    <div aria-hidden="true" data-testid="signup-form-skeleton" className="space-y-5 motion-safe:animate-pulse">
      <div className="flex h-7 items-center">
        <div className="h-3 w-32 rounded bg-white/15" />
      </div>
      <div className="space-y-4">
        {["w-10", "w-16"].map(labelWidth => (
          <div key={labelWidth} className="pb-5">
            <div className="mb-1 flex h-5 items-center">
              <div className={`h-3 rounded bg-white/15 ${labelWidth}`} />
            </div>
            <div className="h-11 rounded-lg border border-amber-200/15 bg-white/5" />
          </div>
        ))}
        <div className="flex items-start gap-3">
          <div className="mt-1 size-4 shrink-0 rounded-sm bg-white/15" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 rounded bg-white/10" />
            <div className="h-3 w-2/3 rounded bg-white/10 sm:hidden" />
          </div>
        </div>
        <div className="h-11 rounded-lg bg-indigo-400/20" />
      </div>
      <div className="flex h-4 items-center">
        <div className="h-px w-full bg-border-active" />
      </div>
      <div className="h-11 rounded-lg border border-border-active bg-white/5" />
    </div>
  );
}

function PrivyAccountHandoff({
  state,
  acceptedLegalTerms,
  onAcceptedLegalTermsChange,
  onContinue,
  onStartSignup,
  onEmailSignIn,
  onUseDifferent,
  switchingAccount,
  switchError,
}: {
  state: PrivyAccountHandoffState;
  acceptedLegalTerms: boolean;
  onAcceptedLegalTermsChange: (accepted: boolean) => void;
  onContinue: () => void;
  onStartSignup: () => void;
  onEmailSignIn?: () => void;
  onUseDifferent: () => void;
  switchingAccount: boolean;
  switchError: string | null;
}) {
  const unlinked = state === "unlinked";
  const creating = state === "creating";
  return (
    <div className="space-y-5">
      <h2 tabIndex={-1} className="influence-section-title text-xl outline-none">
        {unlinked ? "Privy sign-in has no linked account" : creating ? "Create your account" : "Account already exists"}
      </h2>
      {unlinked ? (
        <p className="influence-copy text-sm">Use the sign-in method you originally used for The House.</p>
      ) : creating ? (
        <SignupAvailabilityGate>
          <AccountLegalConsent
            checked={acceptedLegalTerms}
            disabled={switchingAccount}
            onChange={onAcceptedLegalTermsChange}
          />
          <button type="button" disabled={switchingAccount || !acceptedLegalTerms}
            className="influence-button-primary min-h-11 w-full rounded-lg px-4 py-2 text-sm" onClick={onContinue}>
            Continue with Privy
          </button>
        </SignupAvailabilityGate>
      ) : (
        <button type="button" disabled={switchingAccount}
          className="influence-button-primary min-h-11 w-full rounded-lg px-4 py-2 text-sm" onClick={onContinue}>
          Continue with Privy
        </button>
      )}
      {unlinked && onEmailSignIn && (
        <button type="button" disabled={switchingAccount}
          className="influence-button-primary min-h-11 w-full rounded-lg px-4 py-2 text-sm" onClick={onEmailSignIn}>
          Sign in with email
        </button>
      )}
      <div className="flex flex-wrap items-center gap-x-5">
        {creating && onEmailSignIn && (
          <button type="button" disabled={switchingAccount} className="influence-link min-h-11 text-sm" onClick={onEmailSignIn}>
            Back to sign in
          </button>
        )}
        <button type="button" disabled={switchingAccount} className="influence-link min-h-11 text-sm" onClick={onUseDifferent}>
          {switchingAccount ? "Signing out…" : "Use a different Privy account"}
        </button>
        {unlinked && (
          <button type="button" disabled={switchingAccount} className="influence-link min-h-11 text-sm" onClick={onStartSignup}>
            Create account
          </button>
        )}
      </div>
      {switchError ? <PrivySwitchError message={switchError} /> : null}
    </div>
  );
}

function PrivySwitchError({ message }: { message: string }) {
  return (
    <div className="space-y-3">
      <p role="alert" className="text-sm text-red-300">{message}</p>
      <button
        type="button"
        className="influence-button-secondary min-h-11 rounded-lg px-4 py-2 text-sm"
        onClick={() => window.location.reload()}
      >
        Reload page
      </button>
    </div>
  );
}

function PrivyOnlyEntry({
  onContinue,
}: {
  onContinue: () => void;
}) {
  return (
    <div className="space-y-5">
      <h2 tabIndex={-1} className="influence-section-title text-xl outline-none">
        Sign in
      </h2>
      <button
        type="button"
        className="influence-button-primary min-h-11 w-full rounded-lg px-4 py-2 text-sm"
        onClick={onContinue}
      >
        Continue with Privy
      </button>
    </div>
  );
}

function PrimaryIntentTabs({
  intent,
  onSelect,
}: {
  intent: "sign_in" | "create_account";
  onSelect: (intent: "sign_in" | "create_account") => void;
}) {
  const tabs = [
    { intent: "sign_in" as const, label: "Sign in" },
    { intent: "create_account" as const, label: "Create account" },
  ];
  const tabRefs = useRef<Record<
    "sign_in" | "create_account",
    HTMLButtonElement | null
  >>({
    sign_in: null,
    create_account: null,
  });

  const selectFromKeyboard = (
    nextIntent: "sign_in" | "create_account",
  ) => {
    onSelect(nextIntent);
    window.requestAnimationFrame(() => tabRefs.current[nextIntent]?.focus());
  };

  return (
    <div
      role="tablist"
      aria-label="Authentication view"
      className="grid flex-1 grid-cols-2 rounded-lg border border-border-active bg-black/20 p-1"
    >
      {tabs.map((tab, index) => {
        const selected = intent === tab.intent;
        return (
          <button
            key={tab.intent}
            ref={(element) => {
              tabRefs.current[tab.intent] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            data-active={selected}
            className="min-h-10 rounded-md px-3 py-2 text-sm font-medium text-text-secondary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phase/70 data-[active=true]:bg-white/10 data-[active=true]:text-text-primary"
            onClick={() => onSelect(tab.intent)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                return;
              }
              event.preventDefault();
              selectFromKeyboard(tabs[index === 0 ? 1 : 0].intent);
            }}
          >
            {tab.label}
          </button>
        );
      })}
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
