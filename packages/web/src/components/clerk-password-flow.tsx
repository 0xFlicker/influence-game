"use client";

import { useClerk, useSignIn, useSignUp } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  createManagedAuthentication,
  exchangeManagedAuthentication,
  linkPrivyAuthentication,
  linkManagedAuthentication,
  type InfluenceSessionResult,
} from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import type { ProviderAuthenticationAttempt } from "@/lib/auth-session-coordinator";

export type PasswordFlowIntent =
  | "sign_in"
  | "create_account"
  | "link_password"
  | "reset_password";

export type ManagedAuthMode = "existing-only" | "full";

export const AUTHENTICATION_METHOD_MATRIX = {
  sign_in: ["email_password", "privy"],
  create_account: ["email_password"],
  link_password: ["email_password"],
  reset_password: ["email_password"],
} as const;

type FlowStep =
  | "credentials"
  | "verify_email"
  | "reset_code"
  | "new_password"
  | "link_confirmation"
  | "wallet_reauth"
  | "setup_incomplete"
  | "support_blocked"
  | "success";

type ClerkOperationResult = {
  error: { message?: string; longMessage?: string } | null;
};

function clerkErrorMessage(
  result: ClerkOperationResult,
  fallback: string,
): string | null {
  if (!result.error) return null;
  return result.error.longMessage ?? result.error.message ?? fallback;
}

function supportReference(): string {
  const value =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `AUTH-${value.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

export function ClerkPasswordFlow({
  intent,
  mode,
  attempt,
  initialEmail = "",
  presentation = "modal",
  onIntentChange,
  onComplete,
  onCancel,
  onContinueWithPrivy,
  reversePrivyToken,
}: {
  intent: PasswordFlowIntent;
  mode: ManagedAuthMode;
  attempt: ProviderAuthenticationAttempt;
  initialEmail?: string;
  presentation?: "modal" | "inline";
  onIntentChange: (intent: PasswordFlowIntent) => void;
  onComplete: () => void;
  onCancel: () => void;
  onContinueWithPrivy: () => void;
  reversePrivyToken?: string;
}) {
  const clerk = useClerk();
  const { signIn, errors: signInErrors, fetchStatus: signInFetchStatus } =
    useSignIn();
  const { signUp, errors: signUpErrors, fetchStatus: signUpFetchStatus } =
    useSignUp();
  const {
    completeAuthenticationAttempt,
    requestPrivyProof,
  } = useAuth();
  const [step, setStep] = useState<FlowStep>("credentials");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const [managedToken, setManagedToken] = useState<string | null>(null);
  const [supportId, setSupportId] = useState<string | null>(null);
  const [correlationId] = useState(supportReference);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const resumedCompletionRef = useRef(false);
  const currentSignupOwnsCompletionRef = useRef(false);
  const busyRef = useRef(false);
  const providerBusy =
    signInFetchStatus === "fetching" || signUpFetchStatus === "fetching";
  const busy = localBusy || providerBusy;
  const getActiveClerkToken = useCallback(async (): Promise<string> => {
    await Promise.resolve();
    const token = await clerk.session?.getToken();
    if (!token) {
      throw new Error(
        "Email/password verification finished, but the provider session is not ready. Try again.",
      );
    }
    return token;
  }, [clerk]);

  useEffect(() => {
    if (presentation !== "inline") return;
    (error ? errorRef.current : headingRef.current)?.focus();
  }, [error, presentation, step]);

  useEffect(() => {
    setEmail(initialEmail);
    setPassword("");
    setCode("");
    setNewPassword("");
    setError(null);
    setStatus("");
    setManagedToken(null);
    setSupportId(null);
    setStep("credentials");
  }, [initialEmail, intent]);

  useEffect(() => {
    if (
      resumedCompletionRef.current
      || currentSignupOwnsCompletionRef.current
      || (intent !== "create_account" && intent !== "link_password")
      || signUp.status !== "complete"
    ) {
      return;
    }
    resumedCompletionRef.current = true;
    void getActiveClerkToken()
      .then((token) => {
        setManagedToken(token);
        setStep(intent === "link_password" ? "link_confirmation" : "setup_incomplete");
        setStatus("Your verified email/password setup is ready to finish.");
      })
      .catch(() => {
        resumedCompletionRef.current = false;
      });
  }, [getActiveClerkToken, intent, signUp.status]);

  async function finalizeSignIn(): Promise<string> {
    const result = await signIn.finalize();
    const message = clerkErrorMessage(result, "Could not finish sign in.");
    if (message) throw new Error(message);
    return getActiveClerkToken();
  }

  async function finalizeSignUp(): Promise<string> {
    const result = await signUp.finalize();
    const message = clerkErrorMessage(result, "Could not finish account setup.");
    if (message) throw new Error(message);
    return getActiveClerkToken();
  }

  function showSupportBlock(): void {
    setSupportId(correlationId);
    setError(null);
    setStep("support_blocked");
  }

  async function completeInfluenceSession(
    exchange: () => Promise<InfluenceSessionResult>,
  ): Promise<void> {
    const completed = await completeAuthenticationAttempt(attempt, exchange);
    if (completed) {
      setStep("success");
      setStatus("Signed in.");
      onComplete();
    }
  }

  function handleApiState(apiError: ApiError, token: string): boolean {
    if (
      apiError.code === "ACCOUNT_LINK_CONFIRMATION_REQUIRED"
      || apiError.code === "ACCOUNT_LINK_REQUIRED"
    ) {
      setManagedToken(token);
      setStep("link_confirmation");
      return true;
    }
    if (
      apiError.code === "ACCOUNT_SETUP_INCOMPLETE"
      || apiError.code === "MANAGED_AUTH_SETUP_INCOMPLETE"
    ) {
      setManagedToken(token);
      setStep("setup_incomplete");
      return true;
    }
    if (apiError.code === "WALLET_REAUTH_REQUIRED") {
      setManagedToken(token);
      setStep("wallet_reauth");
      return true;
    }
    if (apiError.code === "ACCOUNT_SUPPORT_REQUIRED") {
      showSupportBlock();
      return true;
    }
    return false;
  }

  async function exchangeAfterVerification(token: string): Promise<void> {
    setManagedToken(token);
    if (intent === "link_password") {
      setStep("link_confirmation");
      return;
    }
    try {
      if (reversePrivyToken) {
        await completeInfluenceSession(async () => {
          const managedSession = await exchangeManagedAuthentication(
            token,
            correlationId,
          );
          return linkPrivyAuthentication(
            reversePrivyToken,
            managedSession.token,
            correlationId,
          );
        });
        return;
      }
      if (intent === "create_account") {
        await completeInfluenceSession(
          () => createManagedAuthentication(token, correlationId),
        );
      } else {
        await completeInfluenceSession(
          () => exchangeManagedAuthentication(token, correlationId),
        );
      }
    } catch (caught) {
      if (caught instanceof ApiError && handleApiState(caught, token)) return;
      throw caught;
    }
  }

  async function run(action: () => Promise<void>, progress: string): Promise<void> {
    if (busy || busyRef.current) return;
    busyRef.current = true;
    setLocalBusy(true);
    setError(null);
    setStatus(progress);
    try {
      await action();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Something went wrong. Try again.",
      );
      setStatus("");
    } finally {
      busyRef.current = false;
      setLocalBusy(false);
    }
  }

  async function submitCredentials(): Promise<void> {
    if (intent === "reset_password") {
      await run(async () => {
        const created = await signIn.create({ identifier: email.trim() });
        const createError = clerkErrorMessage(
          created,
          "Could not start password reset.",
        );
        if (createError) throw new Error(createError);
        const sent = await signIn.resetPasswordEmailCode.sendCode();
        const sendError = clerkErrorMessage(sent, "Could not send reset code.");
        if (sendError) throw new Error(sendError);
        setStep("reset_code");
        setStatus("We sent a reset code if that email can be used here.");
      }, "Sending reset code…");
      return;
    }

    if (intent === "sign_in") {
      await run(async () => {
        const result = await signIn.password({
          emailAddress: email.trim(),
          password,
        });
        const message = clerkErrorMessage(result, "Could not sign in.");
        if (message) throw new Error(message);
        if (signIn.status === "needs_new_password") {
          setStep("new_password");
          return;
        }
        if (signIn.status !== "complete") {
          throw new Error(
            "This account needs another provider step before it can sign in.",
          );
        }
        await exchangeAfterVerification(await finalizeSignIn());
      }, "Signing in…");
      return;
    }

    await run(async () => {
      currentSignupOwnsCompletionRef.current = true;
      const result = await signUp.password({
        emailAddress: email.trim(),
        password,
      });
      const message = clerkErrorMessage(result, "Could not create the account.");
      if (message) throw new Error(message);
      if (signUp.status === "complete") {
        await exchangeAfterVerification(await finalizeSignUp());
        return;
      }
      const sent = await signUp.verifications.sendEmailCode();
      const sendError = clerkErrorMessage(
        sent,
        "Could not send a verification code.",
      );
      if (sendError) throw new Error(sendError);
      setStep("verify_email");
      setStatus("Verification code sent.");
    }, "Creating your secure sign-in…");
  }

  async function verifyEmail(): Promise<void> {
    await run(async () => {
      const result = await signUp.verifications.verifyEmailCode({
        code: code.trim(),
      });
      const message = clerkErrorMessage(
        result,
        "That verification code is invalid or expired.",
      );
      if (message) throw new Error(message);
      if (signUp.status !== "complete") {
        throw new Error("Email verification is incomplete. Request a new code.");
      }
      await exchangeAfterVerification(await finalizeSignUp());
    }, "Verifying email…");
  }

  async function resendVerification(): Promise<void> {
    await run(async () => {
      const result = await signUp.verifications.sendEmailCode();
      const message = clerkErrorMessage(
        result,
        "A new code could not be sent yet. Wait a moment and try again.",
      );
      if (message) throw new Error(message);
      setStatus("A new verification code was sent.");
    }, "Sending another code…");
  }

  async function verifyResetCode(): Promise<void> {
    await run(async () => {
      const result = await signIn.resetPasswordEmailCode.verifyCode({
        code: code.trim(),
      });
      const message = clerkErrorMessage(
        result,
        "That reset code is invalid or expired.",
      );
      if (message) throw new Error(message);
      if (signIn.status !== "needs_new_password") {
        throw new Error("Password reset is not ready. Request a new code.");
      }
      setStep("new_password");
      setStatus("Code verified.");
    }, "Verifying reset code…");
  }

  async function submitNewPassword(): Promise<void> {
    await run(async () => {
      const result = await signIn.resetPasswordEmailCode.submitPassword({
        password: newPassword,
      });
      const message = clerkErrorMessage(result, "Could not reset the password.");
      if (message) throw new Error(message);
      if (signIn.status !== "complete") {
        throw new Error("Password reset is incomplete.");
      }
      await exchangeAfterVerification(await finalizeSignIn());
    }, "Saving new password…");
  }

  async function confirmLink(privyToken?: string): Promise<void> {
    if (!managedToken) {
      setError("The verified provider session expired. Start again.");
      return;
    }
    await run(() => performLink(managedToken, privyToken), "Linking sign-in method…");
  }

  async function performLink(token: string, privyToken?: string): Promise<void> {
    try {
      await completeInfluenceSession(
        () => linkManagedAuthentication(token, privyToken, correlationId),
      );
    } catch (caught) {
      if (caught instanceof ApiError && handleApiState(caught, token)) return;
      throw caught;
    }
  }

  async function reauthenticateWallet(): Promise<void> {
    await run(async () => {
      const privyToken = await requestPrivyProof();
      if (!privyToken) {
        setStatus("");
        throw new Error("Wallet verification was cancelled. Your email/password setup is preserved.");
      }
      if (!managedToken) {
        throw new Error("The verified provider session expired. Start again.");
      }
      await performLink(managedToken, privyToken);
    }, "Waiting for wallet verification…");
  }

  async function finishManagedSetup(): Promise<void> {
    if (!managedToken) {
      setError("The verified provider session expired. Start again.");
      return;
    }
    await run(async () => {
      try {
        await completeInfluenceSession(
          () => createManagedAuthentication(managedToken, correlationId),
        );
      } catch (caught) {
        if (caught instanceof ApiError && handleApiState(caught, managedToken)) {
          return;
        }
        throw caught;
      }
    }, "Finishing account setup…");
  }

  const emailError =
    signInErrors.fields.identifier?.message
    ?? signUpErrors.fields.emailAddress?.message;
  const passwordError =
    signInErrors.fields.password?.message
    ?? signUpErrors.fields.password?.message;
  const codeError =
    signInErrors.fields.code?.message ?? signUpErrors.fields.code?.message;

  if (
    mode === "existing-only"
    && (intent === "create_account" || intent === "link_password")
  ) {
    return (
      <FlowPanel heading="Account changes are temporarily unavailable" headingRef={headingRef}>
        <p className="influence-copy text-sm">
          Existing email/password and Privy sign-ins still work. Creating or
          linking a new email/password method is temporarily paused.
        </p>
        <button type="button" className="influence-button-secondary rounded-lg px-4 py-2 text-sm" onClick={() => onIntentChange("sign_in")}>
          Back to sign in
        </button>
      </FlowPanel>
    );
  }

  if (step === "support_blocked") {
    return (
      <FlowPanel heading="We need to help with this account" headingRef={headingRef}>
        <p className="influence-copy text-sm">
          We could not safely complete this sign-in or link automatically. No
          account was changed.
        </p>
        <p className="influence-copy-muted text-xs">
          Reference: <span className="font-mono">{supportId}</span>
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/privacy#contact" className="influence-button-primary rounded-lg px-4 py-2 text-sm">
            Contact support
          </Link>
          <button type="button" className="influence-button-secondary rounded-lg px-4 py-2 text-sm" onClick={() => onIntentChange("sign_in")}>
            Back to sign in
          </button>
        </div>
      </FlowPanel>
    );
  }

  if (step === "link_confirmation") {
    return (
      <FlowPanel heading="Link this sign-in to your account?" headingRef={headingRef}>
        <p className="influence-copy text-sm">
          This verified email belongs to an existing Influence account. We will
          add email/password to that account; no new account was created.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} className="influence-button-primary rounded-lg px-4 py-2 text-sm" onClick={() => void confirmLink()}>
            {busy ? "Linking…" : "Link email/password"}
          </button>
          <button type="button" disabled={busy} className="influence-button-secondary rounded-lg px-4 py-2 text-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <FlowMessages error={error} status={status} errorRef={errorRef} />
      </FlowPanel>
    );
  }

  if (step === "wallet_reauth") {
    return (
      <FlowPanel heading="Verify your wallet account" headingRef={headingRef}>
        <p className="influence-copy text-sm">
          Your email/password setup is complete. Verify the external wallet
          that owns this Influence account to link it safely.
        </p>
        <button type="button" disabled={busy} className="influence-button-primary rounded-lg px-4 py-2 text-sm" onClick={() => void reauthenticateWallet()}>
          {busy ? "Waiting…" : "Continue with Privy"}
        </button>
        <FlowMessages error={error} status={status} errorRef={errorRef} />
      </FlowPanel>
    );
  }

  if (step === "setup_incomplete") {
    return (
      <FlowPanel heading="Finish account setup" headingRef={headingRef}>
        <p className="influence-copy text-sm">
          Your email is verified. Confirm to finish creating the Influence
          account. You can also return later and complete this step.
        </p>
        {mode === "full" ? (
          <button
            type="button"
            disabled={busy || !managedToken}
            className="influence-button-primary rounded-lg px-4 py-2 text-sm"
            onClick={() => void finishManagedSetup()}
          >
            Finish account setup
          </button>
        ) : (
          <p role="alert" className="text-sm text-amber-300">
            New account setup is temporarily unavailable. Existing
            email/password accounts can still sign in.
          </p>
        )}
        <FlowMessages error={error} status={status} errorRef={errorRef} />
      </FlowPanel>
    );
  }

  if (step === "success") {
    return (
      <FlowPanel heading="Done" headingRef={headingRef}>
        <p role="status" className="influence-copy text-sm">{status}</p>
        <button type="button" className="influence-button-primary rounded-lg px-4 py-2 text-sm" onClick={onComplete}>
          Close
        </button>
      </FlowPanel>
    );
  }

  if (step === "verify_email" || step === "reset_code") {
    const verification = step === "verify_email";
    return (
      <FlowPanel
        heading={verification ? "Verify your email" : "Enter your reset code"}
        headingRef={headingRef}
      >
        <p className="influence-copy text-sm">
          Enter the one-time code sent to {email}. Invalid or expired codes do
          not create or link an Influence account.
        </p>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void (verification ? verifyEmail() : verifyResetCode());
          }}
          aria-busy={busy}
        >
          <AuthField
            id="authentication-code"
            label="Verification code"
            autoComplete="one-time-code"
            inputMode="numeric"
            value={code}
            disabled={busy}
            error={codeError}
            onChange={setCode}
          />
          <button type="submit" disabled={busy || !code.trim()} className="influence-button-primary min-h-11 w-full rounded-lg px-4 py-2 text-sm">
            {busy ? "Checking…" : "Verify code"}
          </button>
        </form>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            className="influence-link text-sm"
            onClick={() => void (
              verification
                ? resendVerification()
                : run(async () => {
                  const result = await signIn.resetPasswordEmailCode.sendCode();
                  const message = clerkErrorMessage(result, "A new code could not be sent yet.");
                  if (message) throw new Error(message);
                  setStatus("A new reset code was sent.");
                }, "Sending another code…")
            )}
          >
            Send another code
          </button>
          <button type="button" disabled={busy} className="influence-link text-sm" onClick={() => setStep("credentials")}>
            Use a different email
          </button>
        </div>
        <FlowMessages error={error} status={status} errorRef={errorRef} />
      </FlowPanel>
    );
  }

  if (step === "new_password") {
    return (
      <FlowPanel heading="Choose a new password" headingRef={headingRef}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submitNewPassword();
          }}
          aria-busy={busy}
        >
          <AuthField
            id="authentication-new-password"
            type="password"
            label="New password"
            autoComplete="new-password"
            value={newPassword}
            disabled={busy}
            error={passwordError}
            onChange={setNewPassword}
          />
          <button type="submit" disabled={busy || !newPassword} className="influence-button-primary min-h-11 w-full rounded-lg px-4 py-2 text-sm">
            {busy ? "Saving…" : "Reset password"}
          </button>
        </form>
        <FlowMessages error={error} status={status} errorRef={errorRef} />
      </FlowPanel>
    );
  }

  const isSignIn = intent === "sign_in";
  const isReset = intent === "reset_password";
  const title = isSignIn
    ? "Sign in"
    : isReset
      ? "Reset password"
      : intent === "link_password"
        ? "Add email/password"
        : "Create account";

  return (
    <FlowPanel heading={title} headingRef={headingRef}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submitCredentials();
        }}
        aria-busy={busy}
      >
        <AuthField
          id="authentication-email"
          type="email"
          label="Email"
          autoComplete="email"
          value={email}
          disabled={busy}
          error={emailError}
          onChange={setEmail}
        />
        {!isReset && (
          <AuthField
            id="authentication-password"
            type="password"
            label="Password"
            autoComplete={isSignIn ? "current-password" : "new-password"}
            value={password}
            disabled={busy}
            error={passwordError}
            onChange={setPassword}
          />
        )}
        <button type="submit" disabled={busy || !email.trim() || (!isReset && !password)} className="influence-button-primary min-h-11 w-full rounded-lg px-4 py-2 text-sm">
          {busy
            ? "Please wait…"
            : isSignIn
              ? "Sign in with email"
              : isReset
                ? "Send reset code"
                : intent === "link_password"
                  ? "Continue"
                  : "Create account"}
        </button>
      </form>

      {isSignIn && !reversePrivyToken && (
        <>
          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border-subtle" />
            <span className="influence-copy-muted text-xs">or</span>
            <span className="h-px flex-1 bg-border-subtle" />
          </div>
          <button
            type="button"
            className="influence-button-secondary min-h-11 w-full rounded-lg px-4 py-2 text-sm"
            onClick={onContinueWithPrivy}
          >
            Continue with Privy
          </button>
          <button type="button" disabled={busy} className="influence-link text-sm" onClick={() => onIntentChange("reset_password")}>
            Forgot password?
          </button>
          {mode === "full" && (
            <button type="button" disabled={busy} className="influence-link text-sm" onClick={() => onIntentChange("create_account")}>
              Create an email/password account
            </button>
          )}
        </>
      )}

      {intent === "create_account" && (
        <button type="button" disabled={busy} className="influence-link text-sm" onClick={() => onIntentChange("sign_in")}>
          Already have an account? Sign in
        </button>
      )}

      {isReset && (
        <button type="button" disabled={busy} className="influence-link text-sm" onClick={() => onIntentChange("sign_in")}>
          Back to sign in
        </button>
      )}

      <FlowMessages error={error} status={status} errorRef={errorRef} />
    </FlowPanel>
  );
}

function FlowPanel({
  heading,
  headingRef,
  children,
}: {
  heading: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <h2 ref={headingRef} tabIndex={-1} className="influence-section-title text-xl outline-none">
        {heading}
      </h2>
      {children}
    </div>
  );
}

function FlowMessages({
  error,
  status,
  errorRef,
}: {
  error: string | null;
  status: string;
  errorRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <>
      {error && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300 outline-none">
          {error}
        </div>
      )}
      <p aria-live="polite" role="status" className="influence-copy-muted min-h-5 text-xs">
        {status}
      </p>
    </>
  );
}

function AuthField({
  id,
  label,
  error,
  value,
  onChange,
  type = "text",
  autoComplete,
  inputMode,
  disabled,
}: {
  id: string;
  label: string;
  error?: string | null;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  disabled: boolean;
}) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="influence-copy-strong mb-1 block text-sm">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="influence-field min-h-11 w-full rounded-lg px-4 py-2.5 text-sm"
      />
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
