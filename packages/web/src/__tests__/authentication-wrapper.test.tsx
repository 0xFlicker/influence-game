import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activateClerkExistingSession,
  AUTHENTICATION_METHOD_MATRIX,
  beginClerkClientTrustEmailCode,
  runClerkPasswordAttempt,
  runClerkProtectAttempt,
  sendClerkClientTrustEmailCode,
  verifyClerkClientTrustEmailCode,
} from "../components/clerk-password-flow";
import {
  ApiError,
  AUTH_TOKEN_KEY,
  linkPrivyAuthentication,
  linkManagedAuthentication,
} from "../lib/api";

const wrapperSource = readFileSync(
  join(import.meta.dir, "../components/authentication-wrapper.tsx"),
  "utf8",
);
const passwordFlowSource = readFileSync(
  join(import.meta.dir, "../components/clerk-password-flow.tsx"),
  "utf8",
);
const authenticationRouteSource = readFileSync(
  join(import.meta.dir, "../components/authentication-route.tsx"),
  "utf8",
);
const apiSource = readFileSync(
  join(import.meta.dir, "../lib/api.ts"),
  "utf8",
);
const authHookSource = readFileSync(
  join(import.meta.dir, "../hooks/use-auth.ts"),
  "utf8",
);
const inviteModalSource = readFileSync(
  join(import.meta.dir, "../components/invite-code-modal.tsx"),
  "utf8",
);

describe("unified authentication wrapper", () => {
  it("matches the settled sign-in and create-account method matrix", () => {
    expect(AUTHENTICATION_METHOD_MATRIX.sign_in).toEqual([
      "email_password",
      "privy",
    ]);
    expect(AUTHENTICATION_METHOD_MATRIX.create_account).toEqual([
      "email_password",
    ]);
    expect(passwordFlowSource).toContain("Continue with Privy");
    expect(wrapperSource).toContain('role="tablist"');
    expect(wrapperSource).toContain("Create account");
    expect(passwordFlowSource).not.toContain("Create account with Privy");
  });

  it("uses labelled native fields with persistent recovery semantics", () => {
    expect(passwordFlowSource).toContain("<form");
    expect(passwordFlowSource).toContain("<label htmlFor={id}");
    expect(passwordFlowSource).toContain('autoComplete="email"');
    expect(passwordFlowSource).toContain('"current-password"');
    expect(passwordFlowSource).toContain('"new-password"');
    expect(passwordFlowSource).toContain('autoComplete="one-time-code"');
    expect(passwordFlowSource).toContain("aria-describedby");
    expect(passwordFlowSource).toContain('aria-live="polite"');
    expect(passwordFlowSource).toContain("busyRef.current");
    expect(passwordFlowSource).toContain("Send another code");
    expect(passwordFlowSource).toContain("invalid or expired");
  });

  it("keeps account collision copy private until verification and requires explicit linking", () => {
    const preVerificationCopy = passwordFlowSource.slice(
      passwordFlowSource.indexOf('const title = isSignIn'),
    );
    expect(preVerificationCopy).not.toContain("existing Influence account");
    expect(passwordFlowSource).toContain("no new account was created");
    expect(passwordFlowSource).toContain("Link email/password");
    expect(passwordFlowSource).toContain("Verify your wallet account");
    expect(passwordFlowSource).toContain("Your email/password setup is complete");
  });

  it("renders a focus-contained cancellable modal and a non-trapping inline mode", () => {
    expect(wrapperSource).toContain('role="dialog"');
    expect(wrapperSource).toContain('aria-modal="true"');
    expect(wrapperSource).toContain('event.key === "Escape"');
    expect(wrapperSource).toContain('event.key !== "Tab"');
    expect(wrapperSource).toContain("restoreInvokingFocus");
    expect(wrapperSource).toContain("cancelAuthenticationAttempt");
    expect(wrapperSource).toContain('presentation === "inline"');
    expect(wrapperSource).toContain('aria-label="Authentication"');
    expect(wrapperSource).not.toContain('className="pr-16"');
    expect(wrapperSource).toContain("grid flex-1 grid-cols-2");
    expect(passwordFlowSource).not.toContain(
      "Create an email/password account",
    );
  });

  it("only locks document scrolling while an authentication dialog is rendered", () => {
    expect(wrapperSource).toContain(
      'const isModalVisible = presentation === "modal"',
    );
    expect(wrapperSource).toContain(
      "&& (attempt !== null || Boolean(reversePrivyToken));",
    );
    expect(wrapperSource).toContain("if (!isModalVisible) return;");
  });

  it("provides stable Clerk fallback routes without duplicating auth logic", () => {
    expect(authenticationRouteSource).toContain(
      'intent: "sign_in" | "create_account"',
    );
    expect(authenticationRouteSource).toContain("openSignIn()");
    expect(authenticationRouteSource).toContain("openCreateAccount()");
    expect(authenticationRouteSource).toContain(
      'MANAGED_AUTH_MODE === "full"',
    );
    expect(authenticationRouteSource).toContain('href="/sign-in"');
    expect(authenticationRouteSource).toContain('href="/sign-up"');
  });

  it("continues from Clerk's settled password resource without polling or identity gates", () => {
    const signInSubmit = passwordFlowSource.slice(
      passwordFlowSource.indexOf('if (intent === "sign_in")'),
      passwordFlowSource.indexOf("currentSignupOwnsCompletionRef.current = true"),
    );

    expect(signInSubmit).not.toContain("updatedClerkResource");
    expect(signInSubmit).toContain("await attemptPasswordSignIn()");
    expect(passwordFlowSource).toContain("await runClerkPasswordAttempt({");
    expect(passwordFlowSource).toContain(
      "await beginClerkClientTrustEmailCode({",
    );
    expect(passwordFlowSource).toContain(
      "await verifyClerkClientTrustEmailCode({",
    );
    expect(passwordFlowSource).not.toContain("SignInTransition");
    expect(passwordFlowSource).not.toContain("signInTransitionSourceRef");
    expect(passwordFlowSource).not.toContain("window.setTimeout");
  });

  it("sends Clerk's supported email code when a new client needs trust", async () => {
    const calls: string[] = [];
    const signIn = {
      status: "needs_client_trust",
      supportedSecondFactors: [{ strategy: "email_code" }],
      mfa: {
        async sendEmailCode() {
          calls.push("send-email-code");
          return { error: null };
        },
        async verifyEmailCode() {
          return { error: null };
        },
      },
    };

    await sendClerkClientTrustEmailCode(signIn);

    expect(calls).toEqual(["send-email-code"]);
  });

  it("enters Client Trust verification before sending and keeps it recoverable after a provider error", async () => {
    const calls: string[] = [];
    let step = "credentials";
    const signIn = {
      status: "needs_client_trust",
      supportedSecondFactors: [{ strategy: "email_code" }],
      mfa: {
        async sendEmailCode() {
          calls.push(`send:${step}`);
          return { error: { message: "Email delivery failed." } };
        },
        async verifyEmailCode() {
          return { error: null };
        },
      },
    };

    await expect(beginClerkClientTrustEmailCode({
      signIn,
      enterVerification: () => {
        step = "verify_client_trust";
        calls.push(`enter:${step}`);
      },
    })).rejects.toThrow("Email delivery failed.");

    expect(step).toBe("verify_client_trust");
    expect(calls).toEqual([
      "enter:verify_client_trust",
      "send:verify_client_trust",
    ]);
  });

  it("fails clearly when Client Trust has no email-code strategy", async () => {
    const signIn = {
      status: "needs_client_trust",
      supportedSecondFactors: [{ strategy: "phone_code" }],
      mfa: {
        async sendEmailCode() {
          return { error: null };
        },
        async verifyEmailCode() {
          return { error: null };
        },
      },
    };

    await expect(sendClerkClientTrustEmailCode(signIn)).rejects.toThrow(
      "This device cannot be verified by email. Try another sign-in method.",
    );
  });

  it("continues sign-in after the Client Trust email code is verified", async () => {
    const calls: string[] = [];
    const signIn = {
      status: "needs_client_trust",
      supportedSecondFactors: [{ strategy: "email_code" }],
      mfa: {
        async sendEmailCode() {
          return { error: null };
        },
        async verifyEmailCode({ code }: { code: string }) {
          calls.push(`verify:${code}`);
          signIn.status = "complete";
          return { error: null };
        },
      },
    };

    await verifyClerkClientTrustEmailCode({
      signIn,
      code: "123456",
      continueSignIn: async (currentSignIn) => {
        calls.push(`continue:${currentSignIn.status}`);
      },
    });

    expect(calls).toEqual(["verify:123456", "continue:complete"]);
  });

  it("keeps the Client Trust code step recoverable after an invalid code", async () => {
    let continued = false;
    const signIn = {
      status: "needs_client_trust",
      supportedSecondFactors: [{ strategy: "email_code" }],
      mfa: {
        async sendEmailCode() {
          return { error: null };
        },
        async verifyEmailCode() {
          return {
            error: {
              code: "form_code_incorrect",
              message: "That code is incorrect.",
            },
          };
        },
      },
    };

    await expect(verifyClerkClientTrustEmailCode({
      signIn,
      code: "000000",
      continueSignIn: async () => {
        continued = true;
      },
    })).rejects.toThrow("That code is incorrect.");
    expect(continued).toBeFalse();
  });

  it("does not continue when Client Trust verification does not advance", async () => {
    let continued = false;
    const signIn = {
      status: "needs_client_trust",
      supportedSecondFactors: [{ strategy: "email_code" }],
      mfa: {
        async sendEmailCode() {
          return { error: null };
        },
        async verifyEmailCode() {
          return { error: null };
        },
      },
    };

    await expect(verifyClerkClientTrustEmailCode({
      signIn,
      code: "123456",
      continueSignIn: async () => {
        continued = true;
      },
    })).rejects.toThrow("Device verification is incomplete. Request a new code.");
    expect(continued).toBeFalse();
  });

  it("password-verifies before activating Clerk's structured existing session", async () => {
    const calls: string[] = [];
    const signIn: {
      existingSession?: { sessionId: string };
      password: (params: {
        emailAddress: string;
        password: string;
      }) => Promise<{
        error: { code: string; message: string } | null;
      }>;
    } = {
      async password({ emailAddress }) {
        calls.push(`password:${emailAddress}`);
        signIn.existingSession = { sessionId: "session-for-submitted-email" };
        return {
          error: {
            code: "identifier_already_signed_in",
            message: "You're already signed in.",
          },
        };
      },
    };

    await runClerkPasswordAttempt({
      signIn,
      emailAddress: "submitted@example.test",
      password: "secret",
      continueSignIn: async (currentSignIn) => {
        await activateClerkExistingSession({
          signIn: currentSignIn,
          setActive: async (sessionId) => {
            calls.push(`activate:${sessionId}`);
          },
          exchange: async () => {
            calls.push("exchange");
          },
        });
      },
    });

    expect(calls).toEqual([
      "password:submitted@example.test",
      "activate:session-for-submitted-email",
      "exchange",
    ]);
  });

  it("does not let a stale existing session mask a password failure", async () => {
    let continued = false;
    const signIn = {
      existingSession: { sessionId: "stale-session" },
      async password() {
        return {
          error: {
            code: "form_password_incorrect",
            message: "Password is incorrect.",
          },
        };
      },
    };

    await expect(runClerkPasswordAttempt({
      signIn,
      emailAddress: "submitted@example.test",
      password: "wrong",
      continueSignIn: async () => {
        continued = true;
      },
    })).rejects.toThrow("Password is incorrect.");
    expect(continued).toBeFalse();
  });

  it("never exposes Clerk's already-signed-in error without a usable session", async () => {
    const signIn = {
      async password() {
        return {
          error: {
            code: "identifier_already_signed_in",
            message: "You're already signed in.",
          },
        };
      },
    };

    await expect(runClerkPasswordAttempt({
      signIn,
      emailAddress: "submitted@example.test",
      password: "secret",
      continueSignIn: async () => {},
    })).rejects.toThrow("Sign-in could not finish. Reload and try again.");
  });

  it("re-runs password verification after an Influence exchange failure", async () => {
    const passwordEmails: string[] = [];
    const activatedSessions: string[] = [];
    let exchangeAttempts = 0;
    const signIn: {
      existingSession?: { sessionId: string };
      password: (params: {
        emailAddress: string;
        password: string;
      }) => Promise<{ error: null }>;
    } = {
      async password({ emailAddress }) {
        passwordEmails.push(emailAddress);
        signIn.existingSession = { sessionId: `session:${emailAddress}` };
        return { error: null };
      },
    };
    const attempt = (emailAddress: string) => runClerkPasswordAttempt({
      signIn,
      emailAddress,
      password: "secret",
      continueSignIn: async (currentSignIn) => {
        await activateClerkExistingSession({
          signIn: currentSignIn,
          setActive: async (sessionId) => {
            activatedSessions.push(sessionId);
          },
          exchange: async () => {
            exchangeAttempts += 1;
            if (exchangeAttempts === 1) throw new Error("network unavailable");
          },
        });
      },
    });

    await expect(attempt("first@example.test")).rejects.toThrow(
      "network unavailable",
    );
    await attempt("second@example.test");

    expect(passwordEmails).toEqual([
      "first@example.test",
      "second@example.test",
    ]);
    expect(activatedSessions).toEqual([
      "session:first@example.test",
      "session:second@example.test",
    ]);
  });

  it("runs and submits Clerk Protect checks instead of dead-ending sign-in", () => {
    expect(passwordFlowSource).toContain("executeProtectCheck");
    expect(passwordFlowSource).toContain('status === "needs_protect_check"');
    expect(passwordFlowSource).toContain("submitProtectCheck({ proofToken })");
    expect(passwordFlowSource).not.toContain(
      "This account needs another provider step before it can sign in.",
    );
  });

  it("retries the gated password operation after a Protect proof", () => {
    expect(passwordFlowSource).toContain("await runClerkProtectAttempt({");
    expect(passwordFlowSource).toContain(
      "await attemptPasswordSignIn()",
    );
  });

  it("does not let an existing session mask a failed Protect proof", async () => {
    let continued = false;
    const signIn = {
      existingSession: { sessionId: "ambient-session" },
      status: "needs_protect_check",
      async submitProtectCheck() {
        return { error: { message: "Protect proof rejected" } };
      },
    };

    await expect(runClerkProtectAttempt({
      signIn,
      proofToken: "bad-proof",
      retryPassword: async () => {},
      continueSignIn: async () => {
        continued = true;
      },
    })).rejects.toThrow("Protect proof rejected");
    expect(continued).toBeFalse();
  });

  it("retries password when Protect returns to the first-factor step", async () => {
    let passwordRetries = 0;
    let continuations = 0;
    const signIn = {
      status: "needs_protect_check",
      async submitProtectCheck() {
        signIn.status = "needs_first_factor";
        return { error: null };
      },
    };

    await runClerkProtectAttempt({
      signIn,
      proofToken: "valid-proof",
      retryPassword: async () => {
        passwordRetries += 1;
      },
      continueSignIn: async () => {
        continuations += 1;
      },
    });

    expect(passwordRetries).toBe(1);
    expect(continuations).toBe(0);
  });

  it("restores a fresh inline password attempt after Privy cancellation", () => {
    expect(wrapperSource).toContain("openPrivySignIn((outcome) =>");
    expect(wrapperSource).toContain(
      'if (outcome.kind === "cancelled")',
    );
    expect(wrapperSource).toContain(
      "setAttempt(beginAuthenticationAttempt());",
    );
  });

  it("confirms reverse Privy linking and keeps the assertion in component memory", () => {
    expect(wrapperSource).toContain("Link Privy to your account?");
    expect(wrapperSource).toContain("Continue with email/password");
    expect(wrapperSource).toContain("no new account will be created");
    expect(wrapperSource).toContain("setReversePrivyToken(outcome.token)");
    expect(wrapperSource).not.toContain("localStorage");
    expect(passwordFlowSource).toContain("reversePrivyToken");
    expect(passwordFlowSource).toContain("const managedSession");
    expect(passwordFlowSource).toContain("linkPrivyAuthentication(");
  });

  it("uses one privacy-safe request reference and preserves Influence session semantics on link 401", () => {
    expect(apiSource).toContain('"x-correlation-id"');
    expect(passwordFlowSource).toContain("Reference:");
    expect(passwordFlowSource).toContain('href="/privacy#contact"');
    expect(passwordFlowSource).toContain("Back to sign in");
    expect(apiSource).toContain('providerAuthFetch("/api/auth/managed/link"');
    expect(apiSource).not.toContain('apiFetch("/api/auth/managed/link"');
  });

  it("keeps Privy available outside Clerk form failures", () => {
    const privyButton = passwordFlowSource.indexOf("Continue with Privy");
    const flowMessages = passwordFlowSource.lastIndexOf("<FlowMessages");
    expect(privyButton).toBeGreaterThan(0);
    expect(flowMessages).toBeGreaterThan(privyButton);
  });

  it("blocks create and link before Clerk mutation in existing-only mode", () => {
    const modeGuard = passwordFlowSource.indexOf('mode === "existing-only"');
    const credentialsForm = passwordFlowSource.indexOf("const isSignIn");
    expect(modeGuard).toBeGreaterThan(0);
    expect(modeGuard).toBeLessThan(credentialsForm);
    expect(passwordFlowSource).toContain(
      "linking a new email/password method is temporarily paused.",
    );
  });

  it("does not let resumed-signup detection overwrite an active verification flow", () => {
    const passwordSignup = passwordFlowSource.indexOf(
      "const result = await signUp.password",
    );
    expect(passwordSignup).toBeGreaterThan(0);
    expect(passwordFlowSource.slice(0, passwordSignup)).toContain(
      "currentSignupOwnsCompletionRef.current = true",
    );
    expect(passwordFlowSource).toContain(
      "|| currentSignupOwnsCompletionRef.current",
    );
  });

  it("resumes password linking from an existing Clerk session", () => {
    expect(passwordFlowSource).toContain("useSession()");
    expect(passwordFlowSource).toContain('intent !== "link_password"');
    expect(passwordFlowSource).toContain("!clerkSession");
    expect(passwordFlowSource).toContain(
      "managedToken ?? await getActiveClerkToken()",
    );
    expect(passwordFlowSource).toContain(
      "Your verified email/password sign-in is ready to link.",
    );
  });

  it("does not expire the Influence session when wallet proof must be retried", async () => {
    const originalFetch = globalThis.fetch;
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    let authExpiredEvents = 0;
    let requestHeaders: HeadersInit | undefined;
    try {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          dispatchEvent: () => {
            authExpiredEvents += 1;
            return true;
          },
        },
      });
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          getItem: (key: string) =>
            key === AUTH_TOKEN_KEY ? "valid-influence-jwt" : null,
        },
      });
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: async (_input: RequestInfo | URL, init?: RequestInit) => {
          requestHeaders = init?.headers;
          return new Response(JSON.stringify({
            error: "Wallet reauthentication is required",
            code: "WALLET_REAUTH_REQUIRED",
          }), { status: 401 });
        },
      });

      await expect(
        linkManagedAuthentication("clerk-token", undefined, "AUTH-TEST"),
      ).rejects.toBeInstanceOf(ApiError);
      expect(authExpiredEvents).toBe(0);
      expect(requestHeaders).toMatchObject({
        Authorization: "Bearer valid-influence-jwt",
        "x-correlation-id": "AUTH-TEST",
      });
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: originalFetch,
      });
      if (windowDescriptor) {
        Object.defineProperty(globalThis, "window", windowDescriptor);
      } else {
        delete (globalThis as { window?: unknown }).window;
      }
      if (storageDescriptor) {
        Object.defineProperty(globalThis, "localStorage", storageDescriptor);
      } else {
        delete (globalThis as { localStorage?: unknown }).localStorage;
      }
    }
  });

  it("reuses an active Privy session before opening wallet authentication", () => {
    const signIn = authHookSource.indexOf(
      "const openPrivySignIn = useCallback",
    );
    const currentProof = authHookSource.indexOf(
      "currentPrivyProof(getAccessToken)",
      signIn,
    );
    const interactiveLogin = authHookSource.indexOf(
      "openPrivyLogin();",
      currentProof,
    );
    expect(signIn).toBeGreaterThan(0);
    expect(currentProof).toBeGreaterThan(0);
    expect(interactiveLogin).toBeGreaterThan(currentProof);
    expect(authHookSource.slice(currentProof, interactiveLogin)).toContain(
      "completePrivyAttempt(providerToken)",
    );
    expect(authHookSource).toContain(
      "pendingPrivyProofResolution.current !== resolve",
    );
    expect(authHookSource).toContain(
      "pendingPrivyProofResolution.current !== resolveProof",
    );
  });

  it("lets invite-gated Privy users dismiss the prompt or sign out", () => {
    expect(inviteModalSource).toContain("dismissInvite");
    expect(inviteModalSource).toContain("onClick={dismissInvite}");
    expect(inviteModalSource).toContain("Sign out");
    expect(inviteModalSource).toContain("void logout()");
  });

  it("sends reverse Privy linking with the just-issued Influence token", async () => {
    const originalFetch = globalThis.fetch;
    let requestHeaders: HeadersInit | undefined;
    let requestBody = "";
    try {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: async (_input: RequestInfo | URL, init?: RequestInit) => {
          requestHeaders = init?.headers;
          requestBody = String(init?.body);
          return new Response(JSON.stringify({
            token: "final-influence-jwt",
            user: { id: "durable-user" },
          }), { status: 200 });
        },
      });

      await linkPrivyAuthentication(
        "private-privy-token",
        "intermediate-influence-jwt",
        "AUTH-REVERSE",
      );

      expect(requestHeaders).toMatchObject({
        Authorization: "Bearer intermediate-influence-jwt",
        "x-correlation-id": "AUTH-REVERSE",
      });
      expect(JSON.parse(requestBody)).toEqual({
        token: "private-privy-token",
        confirm: true,
      });
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: originalFetch,
      });
    }
  });
});
