"use client";

import { useState } from "react";
import {
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
  | "setup_incomplete"
  | "wallet_reauth";

const TOKEN_BY_EMAIL: Record<string, string> = {
  "new+e2e@example.test": "clerk:new",
  "existing@example.test": "clerk:existing-email",
  "wallet@example.test": "clerk:wallet",
  "reverse@example.test": "clerk:reverse",
  "outage@example.test": "clerk:outage",
  "ui-new+e2e@example.test": "clerk:ui-new",
  "ui-existing@example.test": "clerk:ui-existing",
  "ui-wallet@example.test": "clerk:ui-wallet",
  "ui-reverse@example.test": "clerk:ui-reverse",
  "ui-outage@example.test": "clerk:ui-outage",
};

export function isLayeredAuthE2EAdapterEnabled(): boolean {
  return process.env.NODE_ENV !== "production"
    && process.env.NEXT_PUBLIC_E2E_LAYERED_AUTH === "true";
}

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
  onIntentChange: (intent: PasswordFlowIntent) => void;
  onComplete: () => void;
  onCancel: () => void;
  onContinueWithPrivy: () => void;
  reversePrivyToken?: string;
}) {
  const { completeAuthenticationAttempt, requestPrivyProof } = useAuth();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [managedToken, setManagedToken] = useState<string | null>(null);
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
      caught.code === "ACCOUNT_SETUP_INCOMPLETE"
      || caught.code === "MANAGED_AUTH_SETUP_INCOMPLETE"
    ) {
      setManagedToken(token);
      setStep("setup_incomplete");
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
        await complete(async () => {
          const managed = await exchangeManagedAuthentication(token);
          return linkPrivyAuthentication(reversePrivyToken, managed.token);
        });
      } else if (intent === "create_account") {
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
    const token = tokenForEmail();
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

  if (step === "setup_incomplete") {
    return (
      <Panel heading="Finish account setup">
        <p>Your email is verified. Confirm to create the Influence account.</p>
        <button
          type="button"
          disabled={busy || mode !== "full" || !managedToken}
          onClick={() => void run(async () => {
            if (!managedToken) return;
            await complete(() => createManagedAuthentication(managedToken));
          })}
        >
          Finish account setup
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
        <button type="submit" disabled={busy || !email.trim() || !password}>
          {intent === "create_account"
            ? "Create account"
            : intent === "link_password"
              ? "Verify and link"
              : "Sign in with email"}
        </button>
      </form>
      {intent === "sign_in" && !reversePrivyToken && (
        <>
          <button type="button" onClick={onContinueWithPrivy}>
            Continue with Privy
          </button>
          {mode === "full" && (
            <button
              type="button"
              onClick={() => onIntentChange("create_account")}
            >
              Create an email/password account
            </button>
          )}
        </>
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
