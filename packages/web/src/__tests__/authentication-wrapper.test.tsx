import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTHENTICATION_METHOD_MATRIX } from "../components/clerk-password-flow";
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
    expect(passwordFlowSource).toContain("Create an email/password account");
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

  it("reads Clerk status from the post-operation resource", () => {
    expect(passwordFlowSource).toContain("updatedClerkResource");
    expect(passwordFlowSource).toContain("signInRef.current");
    expect(passwordFlowSource).toContain("signUpRef.current");
    expect(passwordFlowSource).not.toContain(
      'if (signIn.status === "needs_new_password")',
    );
    expect(passwordFlowSource).not.toContain(
      'if (signIn.status !== "complete")',
    );
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
