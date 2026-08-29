"use client";

import { useClerk, useSession, useSignIn, useSignUp } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { executeProtectCheck } from "@clerk/shared/internal/clerk-js/protectCheck";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { AccountLegalConsent } from "@/components/account-legal-consent";
import {
  acceptCurrentLegalTermsForSession,
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
  create_account: ["email_password", "privy"],
  link_password: ["email_password"],
  reset_password: ["email_password"],
} as const;

type FlowStep =
  | "credentials"
  | "account_creation_offer"
  | "account_exists"
  | "verify_email"
  | "verify_client_trust"
  | "reset_code"
  | "new_password"
  | "protect_check"
  | "link_confirmation"
  | "wallet_reauth"
  | "legal_acceptance_for_link"
  | "invite_required"
  | "setup_incomplete"
  | "support_blocked"
  | "success";

type ClerkOperationResult = {
  error: unknown | null;
};

type ClerkExistingSessionResource = {
  existingSession?: { sessionId: string } | null;
};

type ClerkPasswordResource = ClerkExistingSessionResource & {
  password: (params: {
    emailAddress: string;
    password: string;
  }) => Promise<ClerkOperationResult>;
};

type ClerkProtectResource = ClerkExistingSessionResource & {
  status: string;
  submitProtectCheck: (params: {
    proofToken: string;
  }) => Promise<ClerkOperationResult>;
};

type ClerkClientTrustResource = {
  status: string;
  supportedSecondFactors?: readonly { strategy: string }[] | null;
  mfa: {
    sendEmailCode: () => Promise<ClerkOperationResult>;
    verifyEmailCode: (params: { code: string }) => Promise<ClerkOperationResult>;
  };
};

type ProtectCheckResource = Parameters<typeof executeProtectCheck>[0];

function clerkErrorMessage(
  result: ClerkOperationResult,
  fallback: string,
): string | null {
  if (!result.error) return null;
  if (isClerkAPIResponseError(result.error)) {
    const error = result.error.errors[0];
    return error?.longMessage ?? error?.message ?? fallback;
  }
  return result.error instanceof Error ? result.error.message : fallback;
}

function clerkResultHasCode(
  result: ClerkOperationResult,
  code: string,
): boolean {
  return Boolean(result.error)
    && isClerkAPIResponseError(result.error)
    && result.error.errors.some((error) => error.code === code);
}

export async function activateClerkExistingSession<
  T extends ClerkExistingSessionResource,
>({
  signIn,
  setActive,
  exchange,
}: {
  signIn: T;
  setActive: (sessionId: string) => Promise<void>;
  exchange: () => Promise<void>;
}): Promise<boolean> {
  const sessionId = signIn.existingSession?.sessionId;
  if (!sessionId) return false;
  await setActive(sessionId);
  await exchange();
  return true;
}

export async function runClerkPasswordAttempt<T extends ClerkPasswordResource>({
  signIn,
  emailAddress,
  password,
  continueSignIn,
}: {
  signIn: T;
  emailAddress: string;
  password: string;
  continueSignIn: (signIn: T) => Promise<void>;
}): Promise<"continued" | "account_missing" | "provider_error"> {
  const result = await signIn.password({ emailAddress, password });
  if (clerkResultHasCode(result, "form_identifier_not_found")) {
    return "account_missing";
  }
  const submittedAccountAlreadyHasSession =
    clerkResultHasCode(result, "identifier_already_signed_in")
    && Boolean(signIn.existingSession?.sessionId);
  if (result.error && !submittedAccountAlreadyHasSession) {
    if (clerkResultHasCode(result, "identifier_already_signed_in")) {
      throw new Error("Sign-in could not finish. Reload and try again.");
    }
    return "provider_error";
  }
  await continueSignIn(signIn);
  return "continued";
}

export async function runClerkProtectAttempt<T extends ClerkProtectResource>({
  signIn,
  proofToken,
  retryPassword,
  continueSignIn,
}: {
  signIn: T;
  proofToken: string;
  retryPassword: () => Promise<void>;
  continueSignIn: (signIn: T) => Promise<void>;
}): Promise<void> {
  const result = await signIn.submitProtectCheck({ proofToken });
  const message = clerkErrorMessage(
    result,
    "Could not complete the security check.",
  );
  if (message) throw new Error(message);
  if (
    signIn.status === "needs_identifier"
    || signIn.status === "needs_first_factor"
  ) {
    await retryPassword();
    return;
  }
  await continueSignIn(signIn);
}

function assertClerkClientTrustEmailCodeSupported(
  signIn: ClerkClientTrustResource,
): void {
  const supportsEmailCode = signIn.supportedSecondFactors?.some(
    (factor) => factor.strategy === "email_code",
  );
  if (!supportsEmailCode) {
    throw new Error(
      "This device cannot be verified by email. Try another sign-in method.",
    );
  }
}

export async function sendClerkClientTrustEmailCode<
  T extends ClerkClientTrustResource,
>(signIn: T): Promise<void> {
  assertClerkClientTrustEmailCodeSupported(signIn);

  const result = await signIn.mfa.sendEmailCode();
  const message = clerkErrorMessage(
    result,
    "Could not send a device verification code.",
  );
  if (message) throw new Error(message);
}

export async function beginClerkClientTrustEmailCode<
  T extends ClerkClientTrustResource,
>({
  signIn,
  enterVerification,
}: {
  signIn: T;
  enterVerification: () => void;
}): Promise<void> {
  assertClerkClientTrustEmailCodeSupported(signIn);
  enterVerification();
  await sendClerkClientTrustEmailCode(signIn);
}

export async function verifyClerkClientTrustEmailCode<
  T extends ClerkClientTrustResource,
>({
  signIn,
  code,
  continueSignIn,
}: {
  signIn: T;
  code: string;
  continueSignIn: (signIn: T) => Promise<void>;
}): Promise<void> {
  const result = await signIn.mfa.verifyEmailCode({ code });
  const message = clerkErrorMessage(
    result,
    "That device verification code is invalid or expired.",
  );
  if (message) throw new Error(message);
  if (signIn.status === "needs_client_trust") {
    throw new Error(
      "Device verification is incomplete. Request a new code.",
    );
  }
  await continueSignIn(signIn);
}

function ClerkProtectChallenge({
  protectCheck,
  onProof,
  onError,
}: {
  protectCheck: ProtectCheckResource;
  onProof: (proofToken: string) => void;
  onError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onProofRef = useRef(onProof);
  const onErrorRef = useRef(onError);
  const uiHintsRef = useRef(protectCheck.uiHints);

  useEffect(() => {
    onProofRef.current = onProof;
    onErrorRef.current = onError;
    uiHintsRef.current = protectCheck.uiHints;
  }, [onError, onProof, protectCheck.uiHints]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const controller = new AbortController();
    void executeProtectCheck(
      {
        sdkUrl: protectCheck.sdkUrl,
        token: protectCheck.token,
        uiHints: uiHintsRef.current,
      },
      container,
      { signal: controller.signal },
    )
      .then((proofToken) => {
        if (!controller.signal.aborted) onProofRef.current(proofToken);
      })
      .catch(() => {
        if (!controller.signal.aborted) onErrorRef.current();
      });
    return () => controller.abort();
  }, [protectCheck.sdkUrl, protectCheck.token]);

  return <div ref={containerRef} className="min-h-24" />;
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
  onIntentChange: (intent: PasswordFlowIntent, email?: string) => void;
  onComplete: () => void;
  onCancel: () => void;
  onContinueWithPrivy: (acceptedLegalTerms: boolean) => void;
  reversePrivyToken?: string;
}) {
  const clerk = useClerk();
  const { session: clerkSession } = useSession();
  const { signIn, errors: signInErrors, fetchStatus: signInFetchStatus } =
    useSignIn();
  const { signUp, errors: signUpErrors, fetchStatus: signUpFetchStatus } =
    useSignUp();
  const signInRef = useRef(signIn);
  const signUpRef = useRef(signUp);
  signInRef.current = signIn;
  signUpRef.current = signUp;
  const {
    completeAuthenticationAttempt,
    isAuthenticationAttemptCurrent,
    requestPrivyProof,
  } = useAuth();
  const [step, setStep] = useState<FlowStep>("credentials");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [acceptedLegalTerms, setAcceptedLegalTerms] = useState(false);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const [managedToken, setManagedToken] = useState<string | null>(null);
  const [pendingInfluenceSession, setPendingInfluenceSession] = useState<InfluenceSessionResult | null>(null);
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
    setAcceptedLegalTerms(false);
    setCode("");
    setNewPassword("");
    setInviteCode("");
    setError(null);
    setStatus("");
    setManagedToken(null);
    setPendingInfluenceSession(null);
    setSupportId(null);
    setStep("credentials");
  }, [initialEmail, intent]);

  useEffect(() => {
    if (
      resumedCompletionRef.current
      || currentSignupOwnsCompletionRef.current
      || intent !== "link_password"
      || !clerkSession
    ) {
      return;
    }
    resumedCompletionRef.current = true;
    setStep("link_confirmation");
    setStatus("Your verified email/password sign-in is ready to link.");
  }, [clerkSession, intent]);

  useEffect(() => {
    if (
      resumedCompletionRef.current
      || currentSignupOwnsCompletionRef.current
      || (
        intent !== "sign_in"
        && intent !== "create_account"
        && intent !== "link_password"
      )
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
    const result = await signInRef.current.finalize();
    const message = clerkErrorMessage(result, "Could not finish sign in.");
    if (message) throw new Error(message);
    return getActiveClerkToken();
  }

  async function finalizeSignUp(): Promise<string> {
    const result = await signUpRef.current.finalize();
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
      apiError.code === "ACCOUNT_CREATION_REQUIRED"
      || apiError.code === "MANAGED_AUTH_SETUP_INCOMPLETE"
    ) {
      setManagedToken(token);
      setStep("setup_incomplete");
      return true;
    }
    if (apiError.code === "ACCOUNT_ALREADY_EXISTS") {
      setManagedToken(null);
      setAcceptedLegalTerms(false);
      setStep("account_exists");
      return true;
    }
    if (
      apiError.code === "INVITE_REQUIRED"
      || apiError.code === "INVALID_INVITE_CODE"
    ) {
      setManagedToken(token);
      setStep("invite_required");
      if (apiError.code === "INVALID_INVITE_CODE") {
        setError("That invite code is invalid or has already been used.");
      }
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
        const managedSession = await exchangeManagedAuthentication(
          token,
          correlationId,
        );
        if (!isAuthenticationAttemptCurrent(attempt)) return;
        if (!managedSession.user.legal.accepted) {
          setPendingInfluenceSession(managedSession);
          setAcceptedLegalTerms(false);
          setStep("legal_acceptance_for_link");
          return;
        }
        await completeInfluenceSession(
          () => linkPrivyAuthentication(
            reversePrivyToken,
            managedSession.token,
            correlationId,
          ),
        );
        return;
      }
      if (
        intent === "create_account"
        || (intent === "sign_in" && currentSignupOwnsCompletionRef.current)
      ) {
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
    if (localBusy || providerBusy || busyRef.current) return;
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

  async function resumeExistingClerkSession(
    currentSignIn: typeof signIn,
  ): Promise<boolean> {
    return activateClerkExistingSession({
      signIn: currentSignIn,
      setActive: async (sessionId) => {
        await clerk.setActive({ session: sessionId });
      },
      exchange: async () => {
        await exchangeAfterVerification(await getActiveClerkToken());
      },
    });
  }

  async function continueSignIn(currentSignIn: typeof signIn): Promise<void> {
    if (await resumeExistingClerkSession(currentSignIn)) return;
    if (currentSignIn.status === "needs_protect_check") {
      if (!currentSignIn.protectCheck) {
        throw new Error("The security check is unavailable. Try again.");
      }
      setStep("protect_check");
      setStatus("Complete the security check to continue.");
      return;
    }

    if (currentSignIn.status === "needs_new_password") {
      setStep("new_password");
      return;
    }

    if (currentSignIn.status === "complete") {
      await exchangeAfterVerification(await finalizeSignIn());
      return;
    }

    if (currentSignIn.status === "needs_client_trust") {
      await beginClerkClientTrustEmailCode({
        signIn: currentSignIn,
        enterVerification: () => setStep("verify_client_trust"),
      });
      setStatus("Device verification code sent.");
      return;
    }

    if (currentSignIn.status === "needs_second_factor") {
      throw new Error(
        "This account requires an unsupported additional sign-in step.",
      );
    }

    throw new Error("Sign-in could not continue. Try again.");
  }

  async function attemptPasswordSignIn(): Promise<void> {
    const currentSignIn = signInRef.current;
    const outcome = await runClerkPasswordAttempt({
      signIn: currentSignIn,
      emailAddress: email.trim(),
      password,
      continueSignIn,
    });
    if (outcome === "account_missing") {
      setAcceptedLegalTerms(false);
      setError(null);
      setStatus("");
      setStep("account_creation_offer");
    }
  }

  async function beginClerkAccountCreation(): Promise<void> {
    currentSignupOwnsCompletionRef.current = true;
    const result = await signUpRef.current.password({
      emailAddress: email.trim(),
      password,
    });
    if (clerkResultHasCode(result, "form_identifier_exists")) {
      currentSignupOwnsCompletionRef.current = false;
      setAcceptedLegalTerms(false);
      setStatus("");
      setStep("account_exists");
      return;
    }
    const message = clerkErrorMessage(result, "Could not create the account.");
    if (message) throw new Error(message);
    const currentSignUp = signUpRef.current;
    if (currentSignUp.status === "complete") {
      await exchangeAfterVerification(await finalizeSignUp());
      return;
    }
    const sent = await currentSignUp.verifications.sendEmailCode();
    const sendError = clerkErrorMessage(
      sent,
      "Could not send a verification code.",
    );
    if (sendError) throw new Error(sendError);
    setStep("verify_email");
    setStatus("Verification code sent.");
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
        await attemptPasswordSignIn();
      }, "Signing in…");
      return;
    }

    if (intent === "create_account" && !acceptedLegalTerms) {
      setError("Agree to the Terms of Use and acknowledge the Privacy Policy to create an account.");
      return;
    }

    await run(async () => {
      await beginClerkAccountCreation();
    }, "Creating your secure sign-in…");
  }

  async function submitProtectProof(proofToken: string): Promise<void> {
    await run(async () => {
      const currentSignIn = signInRef.current;
      await runClerkProtectAttempt({
        signIn: currentSignIn,
        proofToken,
        retryPassword: async () => {
          setStep("credentials");
          await attemptPasswordSignIn();
        },
        continueSignIn,
      });
    }, "Finishing security check…");
  }

  async function verifyEmail(): Promise<void> {
    await run(async () => {
      const currentSignUp = signUpRef.current;
      const result = await currentSignUp.verifications.verifyEmailCode({
        code: code.trim(),
      });
      const message = clerkErrorMessage(
        result,
        "That verification code is invalid or expired.",
      );
      if (message) throw new Error(message);
      if (currentSignUp.status !== "complete") {
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

  async function verifyClientTrust(): Promise<void> {
    await run(async () => {
      await verifyClerkClientTrustEmailCode({
        signIn: signInRef.current,
        code: code.trim(),
        continueSignIn,
      });
    }, "Verifying device…");
  }

  async function resendClientTrustCode(): Promise<void> {
    await run(async () => {
      await sendClerkClientTrustEmailCode(signInRef.current);
      setStatus("A new device verification code was sent.");
    }, "Sending another code…");
  }

  async function returnToCredentials(resetSignIn: boolean): Promise<void> {
    if (!resetSignIn) {
      setCode("");
      setError(null);
      setStatus("");
      setStep("credentials");
      return;
    }

    await run(async () => {
      const result = await signInRef.current.reset();
      const message = clerkErrorMessage(result, "Could not restart sign in.");
      if (message) throw new Error(message);
      setCode("");
      setStatus("");
      setStep("credentials");
    }, "Restarting sign in…");
  }

  async function returnToDifferentEmail(
    provider: "sign_in" | "create_account",
  ): Promise<void> {
    await run(async () => {
      const result = provider === "sign_in"
        ? await signInRef.current.reset()
        : await signUpRef.current.reset()
      const message = clerkErrorMessage(result, "Could not restart account setup.");
      if (message) throw new Error(message);
      currentSignupOwnsCompletionRef.current = false;
      setEmail("");
      setPassword("");
      setAcceptedLegalTerms(false);
      setCode("");
      setInviteCode("");
      setManagedToken(null);
      setStatus("");
      setStep("credentials");
    }, "Restarting…");
  }

  async function resendResetCode(): Promise<void> {
    await run(async () => {
      const result = await signIn.resetPasswordEmailCode.sendCode();
      const message = clerkErrorMessage(
        result,
        "A new code could not be sent yet.",
      );
      if (message) throw new Error(message);
      setStatus("A new reset code was sent.");
    }, "Sending another code…");
  }

  async function verifyResetCode(): Promise<void> {
    await run(async () => {
      const currentSignIn = signInRef.current;
      const result = await currentSignIn.resetPasswordEmailCode.verifyCode({
        code: code.trim(),
      });
      const message = clerkErrorMessage(
        result,
        "That reset code is invalid or expired.",
      );
      if (message) throw new Error(message);
      if (currentSignIn.status !== "needs_new_password") {
        throw new Error("Password reset is not ready. Request a new code.");
      }
      setStep("new_password");
      setStatus("Code verified.");
    }, "Verifying reset code…");
  }

  async function submitNewPassword(): Promise<void> {
    await run(async () => {
      const currentSignIn = signInRef.current;
      const result = await currentSignIn.resetPasswordEmailCode.submitPassword({
        password: newPassword,
      });
      const message = clerkErrorMessage(result, "Could not reset the password.");
      if (message) throw new Error(message);
      if (currentSignIn.status !== "complete") {
        throw new Error("Password reset is incomplete.");
      }
      await exchangeAfterVerification(await finalizeSignIn());
    }, "Saving new password…");
  }

  async function confirmLink(privyToken?: string): Promise<void> {
    await run(async () => {
      const token = managedToken ?? await getActiveClerkToken();
      setManagedToken(token);
      await performLink(token, privyToken);
    }, "Linking sign-in method…");
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

  async function submitManagedInvite(): Promise<void> {
    if (!managedToken || !inviteCode.trim()) return;
    await run(async () => {
      try {
        await completeInfluenceSession(
          () => createManagedAuthentication(
            managedToken,
            correlationId,
            inviteCode.trim(),
          ),
        );
      } catch (caught) {
        if (caught instanceof ApiError && handleApiState(caught, managedToken)) {
          return;
        }
        throw caught;
      }
    }, "Verifying invite code…");
  }

  const emailError = intent === "sign_in" || intent === "reset_password"
    ? signInErrors.fields.identifier?.message
    : signUpErrors.fields.emailAddress?.message;
  const passwordError = intent === "sign_in" || intent === "reset_password"
    ? signInErrors.fields.password?.message
    : signUpErrors.fields.password?.message;
  const codeError =
    signInErrors.fields.code?.message ?? signUpErrors.fields.code?.message;
  const fieldErrorMessages = [emailError, passwordError, codeError].filter(
    (message): message is string => Boolean(message),
  );
  const flowError = error && !fieldErrorMessages.includes(error) ? error : null;

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

  if (step === "account_creation_offer") {
    return (
      <FlowPanel heading="Create your account" headingRef={headingRef}>
        <p className="influence-copy text-sm">
          We couldn&apos;t find an account for {email.trim()}. Create one with
          these details to continue.
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
              className="influence-button-primary min-h-11 w-full rounded-lg px-4 py-2 text-sm"
              onClick={() => void run(
                beginClerkAccountCreation,
                "Creating your secure sign-in…",
              )}
            >
              {busy ? "Please wait…" : "Create account"}
            </button>
          </>
        ) : (
          <p role="alert" className="text-sm text-amber-300">
            New account setup is temporarily unavailable. Existing accounts
            can still sign in.
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          className="influence-link text-sm"
          onClick={() => void returnToDifferentEmail("sign_in")}
        >
          Use a different email
        </button>
        <FlowMessages error={flowError} status={status} errorRef={errorRef} />
      </FlowPanel>
    );
  }

  if (step === "account_exists") {
    return (
      <FlowPanel heading="Account already exists" headingRef={headingRef}>
        <p className="influence-copy text-sm">
          An account already exists for {email.trim()}. Sign in instead.
        </p>
        <button
          type="button"
          disabled={busy}
          className="influence-button-primary min-h-11 w-full rounded-lg px-4 py-2 text-sm"
          onClick={() => onIntentChange("sign_in", email.trim())}
        >
          Go to sign in
        </button>
        <button
          type="button"
          disabled={busy}
          className="influence-link text-sm"
          onClick={() => void returnToDifferentEmail("create_account")}
        >
          Use a different email
        </button>
        <FlowMessages error={flowError} status={status} errorRef={errorRef} />
      </FlowPanel>
    );
  }

  if (step === "protect_check") {
    const protectCheck = signIn.protectCheck;
    if (!protectCheck) {
      return (
        <FlowPanel heading="Security check unavailable" headingRef={headingRef}>
          <p role="alert" className="text-sm text-red-300">
            The security check could not be loaded. Return to sign in and try
            again.
          </p>
          <button
            type="button"
            className="influence-button-secondary rounded-lg px-4 py-2 text-sm"
            onClick={() => {
              setStep("credentials");
            }}
          >
            Back to sign in
          </button>
        </FlowPanel>
      );
    }
    return (
      <FlowPanel heading="Security check" headingRef={headingRef}>
        <p className="influence-copy text-sm">
          Complete this check to finish signing in.
        </p>
        <ClerkProtectChallenge
          protectCheck={protectCheck}
          onProof={(proofToken) => void submitProtectProof(proofToken)}
          onError={() => {
            setStep("credentials");
            setError("The security check could not be completed. Try again.");
            setStatus("");
          }}
        />
        <FlowMessages error={flowError} status={status} errorRef={errorRef} />
      </FlowPanel>
    );
  }

  if (step === "link_confirmation") {
    return (
      <FlowPanel heading="Link this sign-in to your account?" headingRef={headingRef}>
        <p className="influence-copy text-sm">
          This verified email/password sign-in is ready to be added to your
          current Influence account; no new account was created.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} className="influence-button-primary rounded-lg px-4 py-2 text-sm" onClick={() => void confirmLink()}>
            {busy ? "Linking…" : "Link email/password"}
          </button>
          <button type="button" disabled={busy} className="influence-button-secondary rounded-lg px-4 py-2 text-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <FlowMessages error={flowError} status={status} errorRef={errorRef} />
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
        <FlowMessages error={flowError} status={status} errorRef={errorRef} />
      </FlowPanel>
    );
  }

  if (step === "setup_incomplete") {
    return (
      <FlowPanel heading="Create your account" headingRef={headingRef}>
        <p className="influence-copy text-sm">
          Your email is verified but is not connected to a House account yet.
          Create one to continue.
        </p>
        <AccountLegalConsent
          checked={acceptedLegalTerms}
          disabled={busy}
          onChange={setAcceptedLegalTerms}
        />
        {mode === "full" ? (
          <button
            type="button"
            disabled={busy || !managedToken || !acceptedLegalTerms}
            className="influence-button-primary rounded-lg px-4 py-2 text-sm"
            onClick={() => void finishManagedSetup()}
          >
            Create account
          </button>
        ) : (
          <p role="alert" className="text-sm text-amber-300">
            New account setup is temporarily unavailable. Existing
            email/password accounts can still sign in.
          </p>
        )}
        <FlowMessages error={flowError} status={status} errorRef={errorRef} />
      </FlowPanel>
    );
  }

  if (step === "invite_required") {
    return (
      <FlowPanel heading="Invite Code Required" headingRef={headingRef}>
        <p className="influence-copy text-sm">
          Enter an invite code to create your account. Your Terms acceptance
          remains attached to this creation attempt.
        </p>
        <label className="block space-y-2">
          <span className="text-sm font-medium">Invite code</span>
          <input
            type="text"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
            maxLength={12}
            autoComplete="off"
            className="influence-field w-full rounded-lg px-4 py-3 font-mono tracking-widest"
          />
        </label>
        <button
          type="button"
          disabled={busy || !inviteCode.trim()}
          className="influence-button-primary min-h-11 w-full rounded-lg px-4 py-2 text-sm"
          onClick={() => void submitManagedInvite()}
        >
          {busy ? "Verifying…" : "Submit"}
        </button>
        <FlowMessages error={flowError} status={status} errorRef={errorRef} />
      </FlowPanel>
    );
  }

  if (step === "legal_acceptance_for_link") {
    return (
      <FlowPanel heading="Accept the Terms to continue" headingRef={headingRef}>
        <p className="influence-copy text-sm">
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
          className="influence-button-primary min-h-11 w-full rounded-lg px-4 py-2 text-sm"
          onClick={() => void run(async () => {
            if (!pendingInfluenceSession || !reversePrivyToken) return;
            const acceptedSession = await acceptCurrentLegalTermsForSession(
              pendingInfluenceSession.token,
            );
            if (!isAuthenticationAttemptCurrent(attempt)) return;
            await completeInfluenceSession(
              () => linkPrivyAuthentication(
                reversePrivyToken,
                acceptedSession.token,
                correlationId,
              ),
            );
          }, "Recording acceptance…")}
        >
          {busy ? "Please wait…" : "Accept and link Privy"}
        </button>
        <FlowMessages error={flowError} status={status} errorRef={errorRef} />
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

  if (
    step === "verify_email"
    || step === "verify_client_trust"
    || step === "reset_code"
  ) {
    const recipient = email || "your verified email address";
    const verificationByStep = {
      verify_email: {
        heading: "Verify your email",
        description: `Enter the one-time code sent to ${recipient}. Invalid or expired codes do not create or link an Influence account.`,
        verify: verifyEmail,
        resend: resendVerification,
        resetSignInOnExit: false,
      },
      verify_client_trust: {
        heading: "Verify this device",
        description: `Enter the one-time code sent to ${recipient}. This confirms that this browser can sign in to your account.`,
        verify: verifyClientTrust,
        resend: resendClientTrustCode,
        resetSignInOnExit: true,
      },
      reset_code: {
        heading: "Enter your reset code",
        description: `Enter the one-time code sent to ${recipient}. Invalid or expired codes do not create or link an Influence account.`,
        verify: verifyResetCode,
        resend: resendResetCode,
        resetSignInOnExit: false,
      },
    };
    const verification = verificationByStep[step];
    return (
      <FlowPanel
        heading={verification.heading}
        headingRef={headingRef}
      >
        <p className="influence-copy text-sm">
          {verification.description}
        </p>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void verification.verify();
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
            onClick={() => void verification.resend()}
          >
            Send another code
          </button>
          <button
            type="button"
            disabled={busy}
            className="influence-link text-sm"
            onClick={() => void returnToCredentials(
              verification.resetSignInOnExit,
            )}
          >
            Use a different email
          </button>
        </div>
        <FlowMessages error={flowError} status={status} errorRef={errorRef} />
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
        <FlowMessages error={flowError} status={status} errorRef={errorRef} />
      </FlowPanel>
    );
  }

  const isSignIn = intent === "sign_in";
  const isReset = intent === "reset_password";
  const isCreateAccount = intent === "create_account";
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
        {isCreateAccount && (
          <AccountLegalConsent
            checked={acceptedLegalTerms}
            disabled={busy}
            onChange={setAcceptedLegalTerms}
          />
        )}
        <button type="submit" disabled={busy || !email.trim() || (!isReset && !password) || (isCreateAccount && !acceptedLegalTerms)} className="influence-button-primary min-h-11 w-full rounded-lg px-4 py-2 text-sm">
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

      {(isSignIn || isCreateAccount) && !reversePrivyToken && (
        <>
          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border-subtle" />
            <span className="influence-copy-muted text-xs">or</span>
            <span className="h-px flex-1 bg-border-subtle" />
          </div>
          <button
            type="button"
            disabled={busy || (isCreateAccount && !acceptedLegalTerms)}
            className="influence-button-secondary min-h-11 w-full rounded-lg px-4 py-2 text-sm"
            onClick={() => onContinueWithPrivy(acceptedLegalTerms)}
          >
            Continue with Privy
          </button>
          {isSignIn && (
            <button type="button" disabled={busy} className="influence-link text-sm" onClick={() => onIntentChange("reset_password")}>
              Forgot password?
            </button>
          )}
        </>
      )}

      {isReset && (
        <button type="button" disabled={busy} className="influence-link text-sm" onClick={() => onIntentChange("sign_in")}>
          Back to sign in
        </button>
      )}

      <FlowMessages error={flowError} status={status} errorRef={errorRef} />
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
      <p
        id={errorId}
        aria-live="polite"
        className="mt-1 min-h-4 text-xs text-red-300"
      >
        {error}
      </p>
    </div>
  );
}
