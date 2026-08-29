"use client";

import { useState } from "react";
import { AccountLegalConsent } from "@/components/account-legal-consent";
import {
  acceptCurrentLegalTermsForSession,
  ApiError,
  createManagedAuthentication,
  exchangeManagedAuthentication,
  linkManagedAuthentication,
  linkPrivyAuthentication,
  type InfluenceSessionResult,
} from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import type { ProviderAuthenticationAttempt } from "@/lib/auth-session-coordinator";
import type {
  ManagedAuthMode,
  PasswordFlowIntent,
} from "@/components/clerk-password-flow";

type Step =
  | "credentials"
  | "verify_email"
  | "link_confirmation"
  | "account_creation_offer"
  | "account_exists"
  | "invite_required"
  | "legal_acceptance_for_link"
  | "setup_incomplete"
  | "wallet_reauth";

const TOKEN_BY_EMAIL: Record<string, string> = {
  "new+e2e@example.test": "clerk:new",
  "existing@example.test": "clerk:existing-email",
  "wallet@example.test": "clerk:wallet",
  "reverse@example.test": "clerk:reverse",
  "outage@example.test": "clerk:outage",
  "ui-new+e2e@example.test": "clerk:ui-new",
  "ui-signin-new+e2e@example.test": "clerk:ui-signin-new",
  "ui-existing@example.test": "clerk:ui-existing",
  "ui-wallet@example.test": "clerk:ui-wallet",
  "ui-reverse@example.test": "clerk:ui-reverse",
  "ui-outage@example.test": "clerk:ui-outage",
};

const UNREGISTERED_CLERK_EMAILS = new Set([
  "ui-signin-new+e2e@example.test",
]);

const REGISTERED_CLERK_EMAILS = new Set([
  "ui-reverse@example.test",
]);

export function E2ELayeredPasswordFlow({
  intent,
  mode,
  attempt,
  initialEmail = "",
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
  onIntentChange: (intent: PasswordFlowIntent, email?: string) => void;
  onComplete: () => void;
  onCancel: () => void;
  onContinueWithPrivy: (acceptedLegalTerms: boolean) => void;
  reversePrivyToken?: string;
}) {
  const {
    completeAuthenticationAttempt,
    isAuthenticationAttemptCurrent,
    requestPrivyProof,
  } = useAuth();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [acceptedLegalTerms, setAcceptedLegalTerms] = useState(false);
  const [code, setCode] = useState("");
  const [managedToken, setManagedToken] = useState<string | null>(null);
  const [pendingInfluenceSession, setPendingInfluenceSession] = useState<InfluenceSessionResult | null>(null);
  const [creatingFromSignIn, setCreatingFromSignIn] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete(
    exchange: () => Promise<InfluenceSessionResult>,
  ): Promise<void> {
    const completed = await completeAuthenticationAttempt(attempt, exchange);
    if (completed) onComplete();
  }

  function tokenForEmail(): string {
    return TOKEN_BY_EMAIL[email.trim().toLowerCase()] ?? "clerk:invalid";
  }

  function resetCredentialEntry(): void {
    setEmail("");
    setPassword("");
    setAcceptedLegalTerms(false);
    setManagedToken(null);
    setPendingInfluenceSession(null);
    setCreatingFromSignIn(false);
    setInviteCode("");
    setStep("credentials");
  }

  function handleApiError(caught: unknown, token: string): boolean {
    if (!(caught instanceof ApiError)) return false;
    if (
      caught.code === "ACCOUNT_LINK_CONFIRMATION_REQUIRED"
      || caught.code === "ACCOUNT_LINK_REQUIRED"
    ) {
      setManagedToken(token);
      setStep("link_confirmation");
      return true;
    }
    if (
      caught.code === "ACCOUNT_CREATION_REQUIRED"
    ) {
      setManagedToken(token);
      setStep("account_creation_offer");
      return true;
    }
    if (caught.code === "MANAGED_AUTH_SETUP_INCOMPLETE") {
      setManagedToken(token);
      setStep("setup_incomplete");
      return true;
    }
    if (caught.code === "ACCOUNT_ALREADY_EXISTS") {
      setManagedToken(null);
      setAcceptedLegalTerms(false);
      setStep("account_exists");
      return true;
    }
    if (
      caught.code === "INVITE_REQUIRED"
      || caught.code === "INVALID_INVITE_CODE"
    ) {
      setManagedToken(token);
      setStep("invite_required");
      if (caught.code === "INVALID_INVITE_CODE") {
        setError("That invite code is invalid or has already been used.");
      }
      return true;
    }
    if (caught.code === "WALLET_REAUTH_REQUIRED") {
      setManagedToken(token);
      setStep("wallet_reauth");
      return true;
    }
    return false;
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Authentication failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function exchange(token: string): Promise<void> {
    try {
      if (reversePrivyToken) {
        const managed = await exchangeManagedAuthentication(token);
        if (!isAuthenticationAttemptCurrent(attempt)) return;
        if (!managed.user.legal.accepted) {
          setPendingInfluenceSession(managed);
          setAcceptedLegalTerms(false);
          setStep("legal_acceptance_for_link");
          return;
        }
        await complete(
          () => linkPrivyAuthentication(reversePrivyToken, managed.token),
        );
      } else if (intent === "create_account" || creatingFromSignIn) {
        await complete(() => createManagedAuthentication(token));
      } else if (intent === "link_password") {
        setManagedToken(token);
        setStep("link_confirmation");
      } else {
        await complete(() => exchangeManagedAuthentication(token));
      }
    } catch (caught) {
      if (!handleApiError(caught, token)) throw caught;
    }
  }

  async function submitCredentials(): Promise<void> {
    if (!email.trim() || !password) return;
    if (intent === "create_account" && !acceptedLegalTerms) {
      setError("Agree to the Terms of Use and acknowledge the Privacy Policy to create an account.");
      return;
    }
    const token = tokenForEmail();
    const normalizedEmail = email.trim().toLowerCase();
    if (intent === "sign_in" && UNREGISTERED_CLERK_EMAILS.has(normalizedEmail)) {
      setManagedToken(null);
      setAcceptedLegalTerms(false);
      setStep("account_creation_offer");
      return;
    }
    if (intent === "create_account" && REGISTERED_CLERK_EMAILS.has(normalizedEmail)) {
      setAcceptedLegalTerms(false);
      setStep("account_exists");
      return;
    }
    if (intent === "create_account" || intent === "link_password") {
      setManagedToken(token);
      setStep("verify_email");
      return;
    }
    await exchange(token);
  }

  async function verifyEmail(): Promise<void> {
    if (code.trim() !== "424242") {
      throw new Error("That verification code is invalid or expired.");
    }
    if (!managedToken) throw new Error("The provider session expired.");
    await exchange(managedToken);
  }

  async function confirmLink(privyToken?: string): Promise<void> {
    if (!managedToken) throw new Error("The provider session expired.");
    try {
      await complete(
        () => linkManagedAuthentication(managedToken, privyToken),
      );
    } catch (caught) {
      if (!handleApiError(caught, managedToken)) throw caught;
    }
  }

  if (
    mode === "existing-only"
    && (intent === "create_account" || intent === "link_password")
  ) {
    return (
      <Panel heading="Account changes are temporarily unavailable">
        <p>Existing email/password and Privy sign-ins still work.</p>
        <button type="button" onClick={() => onIntentChange("sign_in")}>
          Back to sign in
        </button>
      </Panel>
    );
  }

  if (step === "link_confirmation") {
    return (
      <Panel heading="Link this sign-in to your account?">
        <p>
          This verified email belongs to an existing Influence account. No new
          account will be created.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => confirmLink())}
        >
          Link email/password
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <Message error={error} />
      </Panel>
    );
  }

  if (step === "account_creation_offer") {
    return (
      <Panel heading="Create your account">
        <p>
          {managedToken
            ? "Your verified email is not connected to a House account yet. Create one to continue."
            : `We couldn't find an account for ${email.trim()}. Create one with these details to continue.`}
        </p>
        {mode === "full" ? (
          <>
            <AccountLegalConsent
              checked={acceptedLegalTerms}
              disabled={busy}
              onChange={setAcceptedLegalTerms}
            />
            <button
              type="button"
              disabled={busy || !acceptedLegalTerms}
              onClick={() => void run(async () => {
                setCreatingFromSignIn(true);
                if (managedToken) {
                  await complete(() => createManagedAuthentication(managedToken));
                  return;
                }
                setManagedToken(tokenForEmail());
                setStep("verify_email");
              })}
            >
              Create account
            </button>
          </>
        ) : (
          <p role="alert">
            New account setup is temporarily unavailable. Existing accounts can still sign in.
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={resetCredentialEntry}
        >
          Use a different email
        </button>
        <Message error={error} />
      </Panel>
    );
  }

  if (step === "account_exists") {
    return (
      <Panel heading="Account already exists">
        <p>An account already exists for {email.trim()}. Sign in instead.</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => onIntentChange("sign_in", email.trim())}
        >
          Go to sign in
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={resetCredentialEntry}
        >
          Use a different email
        </button>
        <Message error={error} />
      </Panel>
    );
  }

  if (step === "setup_incomplete") {
    return (
      <Panel heading="Create your account">
        <p>Your email is verified. Confirm to create the House account.</p>
        <AccountLegalConsent
          checked={acceptedLegalTerms}
          disabled={busy}
          onChange={setAcceptedLegalTerms}
        />
        <button
          type="button"
          disabled={busy || mode !== "full" || !managedToken || !acceptedLegalTerms}
          onClick={() => void run(async () => {
            if (!managedToken) return;
            await complete(() => createManagedAuthentication(managedToken));
          })}
        >
          Create account
        </button>
        <Message error={error} />
      </Panel>
    );
  }

  if (step === "invite_required") {
    return (
      <Panel heading="Invite Code Required">
        <p>Enter an invite code to create your account.</p>
        <label>
          Invite code
          <input
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
          />
        </label>
        <button
          type="button"
          disabled={busy || !managedToken || !inviteCode.trim()}
          onClick={() => void run(async () => {
            if (!managedToken) return;
            try {
              await complete(
                () => createManagedAuthentication(
                  managedToken,
                  undefined,
                  inviteCode.trim(),
                ),
              );
            } catch (caught) {
              if (!handleApiError(caught, managedToken)) throw caught;
            }
          })}
        >
          Submit
        </button>
        <Message error={error} />
      </Panel>
    );
  }

  if (step === "legal_acceptance_for_link") {
    return (
      <Panel heading="Accept the Terms to continue">
        <p>
          Your email/password sign-in is verified. Accept the current Terms of
          Use before linking this Privy sign-in.
        </p>
        <AccountLegalConsent
          checked={acceptedLegalTerms}
          disabled={busy}
          onChange={setAcceptedLegalTerms}
        />
        <button
          type="button"
          disabled={busy || !acceptedLegalTerms || !pendingInfluenceSession || !reversePrivyToken}
          onClick={() => void run(async () => {
            if (!pendingInfluenceSession || !reversePrivyToken) return;
            const acceptedSession = await acceptCurrentLegalTermsForSession(
              pendingInfluenceSession.token,
            );
            if (!isAuthenticationAttemptCurrent(attempt)) return;
            await complete(
              () => linkPrivyAuthentication(
                reversePrivyToken,
                acceptedSession.token,
              ),
            );
          })}
        >
          Accept and link Privy
        </button>
        <Message error={error} />
      </Panel>
    );
  }

  if (step === "wallet_reauth") {
    return (
      <Panel heading="Verify your wallet account">
        <p>Verify the external wallet that owns this Influence account.</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(async () => {
            const token = await requestPrivyProof();
            if (!token) throw new Error("Wallet verification was cancelled.");
            await confirmLink(token);
          })}
        >
          Continue with Privy
        </button>
        <Message error={error} />
      </Panel>
    );
  }

  if (step === "verify_email") {
    return (
      <Panel heading="Verify your email">
        <label>
          Verification code
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <button
          type="button"
          disabled={busy || !code.trim()}
          onClick={() => void run(verifyEmail)}
        >
          Verify code
        </button>
        <Message error={error} />
      </Panel>
    );
  }

  const heading = intent === "create_account"
    ? "Create account"
    : intent === "link_password"
      ? "Add email/password"
      : "Sign in";

  return (
    <Panel heading={heading}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(submitCredentials);
        }}
      >
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {intent === "create_account" && (
          <AccountLegalConsent
            checked={acceptedLegalTerms}
            disabled={busy}
            onChange={setAcceptedLegalTerms}
          />
        )}
        <button type="submit" disabled={busy || !email.trim() || !password || (intent === "create_account" && !acceptedLegalTerms)}>
          {intent === "create_account"
            ? "Create account"
            : intent === "link_password"
              ? "Verify and link"
              : "Sign in with email"}
        </button>
      </form>
      {(intent === "sign_in" || intent === "create_account") && !reversePrivyToken && (
        <button
          type="button"
          disabled={busy || (intent === "create_account" && !acceptedLegalTerms)}
          onClick={() => onContinueWithPrivy(acceptedLegalTerms)}
        >
          Continue with Privy
        </button>
      )}
      <button type="button" onClick={onCancel}>Cancel</button>
      <Message error={error} />
    </Panel>
  );
}

function Panel({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <h2 tabIndex={-1} className="influence-section-title text-xl outline-none">
        {heading}
      </h2>
      {children}
    </div>
  );
}

function Message({ error }: { error: string | null }) {
  return error ? <p role="alert">{error}</p> : null;
}
