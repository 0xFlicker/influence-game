import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import { ClerkInstanceContext, InitialStateProvider } from "@clerk/shared/react";
import { ClerkAPIResponseError } from "@clerk/react/errors";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Window } from "happy-dom";
import type { ContextType } from "react";
import { ClerkPasswordFlow } from "../components/clerk-password-flow";
import { InfluenceAuthContext, type InfluenceAuthState } from "../hooks/use-auth";
import { setApiBase } from "../lib/api";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalNavigator = globalThis.navigator;
const originalFetch = globalThis.fetch;
let dom: Window;
let requests: string[];
let completed: boolean;
let current: boolean;
let accountMissing: boolean;
let getToken: () => Promise<string>;
let providerCalls: string[];
let signOutFails: boolean;

beforeEach(() => {
  dom = new Window({ url: "http://localhost/games" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.navigator });
  requests = [];
  providerCalls = [];
  signOutFails = false;
  completed = false;
  current = true;
  accountMissing = false;
  getToken = async () => "verified-provider-token";
  setApiBase("");
  globalThis.fetch = (async (url) => {
    requests.push(String(url));
    return accountMissing
      ? Response.json({ error: "Finish account setup", code: "ACCOUNT_CREATION_REQUIRED" }, { status: 409 })
      : Response.json({ token: "house-token", user: {} });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  dom.close();
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  setApiBase("");
});

function mountRecovery(newSignup = false, passwordErrorCode = "session_exists", showExistingSession = true) {
  const session = {
    id: "session-owner",
    status: "active",
    user: { primaryEmailAddress: { emailAddress: "owner@example.test", verification: { status: "verified" } } },
    getToken: () => getToken(),
  };
  const signInSnapshot = {
    signIn: {
      reset: async () => { providerCalls.push("reset-sign-in"); return { error: null }; },
      password: async () => {
        providerCalls.push("password");
        if (passwordErrorCode === "session_exists") clerk.session = session;
        return { error: new ClerkAPIResponseError("Provider rejected request", {
      status: 400, data: [{ code: passwordErrorCode, message: "Provider rejected request" }],
    }) }; } },
    errors: { fields: {} }, fetchStatus: "idle",
  };
  // A completed signup must not force account creation before the API resolves identity.
  const signUp = {
    reset: async () => { providerCalls.push("reset-sign-up"); signUp.status = "missing_requirements"; return { error: null }; },
    status: newSignup ? "missing_requirements" : "complete",
    password: async () => ({ error: null }),
    verifications: {
      sendEmailCode: async () => ({ error: null }),
      verifyEmailCode: async () => { signUp.status = "complete"; return { error: null }; },
    },
    finalize: async () => {
      clerk.session = session;
      return { error: null };
    },
  };
  const signUpSnapshot = { signUp, errors: { fields: {} }, fetchStatus: "idle" };
  const clerk = {
    loaded: true,
    isSignedIn: true,
    session: newSignup || !showExistingSession ? null : session,
    signOut: async ({ sessionId }: { sessionId: string }) => {
      providerCalls.push(`sign-out:${sessionId}`);
      if (signOutFails) throw new Error("Could not switch accounts. Try again.");
      clerk.session = null;
      clerk.__internal_lastEmittedResources.session = null;
    },
    addListener: () => () => {},
    __internal_lastEmittedResources: { session: newSignup || !showExistingSession ? null : session },
    __internal_state: {
      signInSignal: () => signInSnapshot,
      signUpSignal: () => signUpSnapshot,
      __internal_effect: () => () => {},
    },
  };
  const auth: InfluenceAuthState = {
    ready: true, authenticated: false, account: null, hydrationError: false,
    openSignIn() {}, openCreateAccount() {}, openPrivySignIn() {},
    resetPrivyIdentity: async () => {}, requestPrivyProof: async () => null,
    beginAuthenticationAttempt: () => ({ generation: "test" }),
    isAuthenticationAttemptCurrent: () => current,
    cancelAuthenticationAttempt() { current = false; },
    completeAuthenticationAttempt: async (_attempt, exchange) => { await exchange(); return current; },
    runFarcasterMiniAppLogin: async () => "failed", logout: async () => {},
    needsInvite: false, dismissInvite() {}, submitInvite: async () => {}, inviteError: null, submittingInvite: false,
  };
  return render(
    <ClerkInstanceContext.Provider value={{ value: clerk } as unknown as ContextType<typeof ClerkInstanceContext>}>
      <InitialStateProvider initialState={undefined}>
      <InfluenceAuthContext.Provider value={auth}>
        <ClerkPasswordFlow intent={newSignup ? "create_account" : "sign_in"} initialEmail="owner@example.test" mode="full" attempt={{ generation: "test" }}
          onIntentChange={() => {}} onComplete={() => { completed = true; }} onCancel={() => {}} onContinueWithPrivy={() => {}} />
      </InfluenceAuthContext.Provider>
      </InitialStateProvider>
    </ClerkInstanceContext.Provider>,
  );
}

describe("rendered Clerk session recovery", () => {
  test("signup verifies the code, finalizes the provider session, then creates the House session", async () => {
    const view = mountRecovery(true);
    await act(async () => {
      fireEvent.change(view.getByLabelText("Password"), { target: { value: "test-password" } });
      fireEvent.click(view.getByRole("checkbox"));
    });
    await act(async () => { fireEvent.submit(view.getByRole("button", { name: "Create account" }).closest("form")!); });
    expect(view.getByRole("heading", { name: "Verify your email" })).toBeDefined();
    expect(view.container.querySelectorAll("#clerk-captcha").length).toBe(1);
    await act(async () => {
      fireEvent.change(view.getByLabelText("Verification code"), { target: { value: "123456" } });
    });
    await act(async () => { fireEvent.submit(view.getByRole("button", { name: "Verify code" }).closest("form")!); });
    expect(completed).toBeTrue();
    expect(requests).toEqual(["/api/auth/managed/create"]);
  });

  test("the production session_exists response completes login for the submitted identity", async () => {
    const view = mountRecovery(false, "session_exists", false);
    await act(async () => { fireEvent.submit(view.getByRole("button", { name: "Sign in with email" }).closest("form")!); });
    expect(completed).toBeTrue();
    expect(requests).toEqual(["/api/auth/managed/exchange"]);
  });

  test("a non-field password error clears the progress text and restores submission", async () => {
    const view = mountRecovery(false, "rate_limit_exceeded", false);
    await act(async () => { fireEvent.submit(view.getByRole("button", { name: "Sign in with email" }).closest("form")!); });
    expect(view.getByRole("alert").textContent).toBe("Provider rejected request");
    expect(view.getByRole("status").textContent).toBe("");
    expect(view.getByLabelText("Password").hasAttribute("disabled")).toBeFalse();
    expect(completed).toBeFalse();
    expect(requests).toEqual([]);
  });

  test("reload recovery exchanges a verified session without password or server action", async () => {
    const view = mountRecovery();
    expect(view.container.querySelectorAll("#clerk-captcha").length).toBe(1);
    expect(view.queryByLabelText("Email")).toBeNull();
    expect(view.queryByLabelText("Password")).toBeNull();
    expect(view.queryByRole("button", { name: "Continue with Privy" })).toBeNull();
    expect(view.getByRole("button", { name: "Use another account" })).toBeDefined();
    expect(requests).toEqual([]);
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Continue as owner@example.test" })); });
    expect(completed).toBeTrue();
    expect(requests).toEqual(["/api/auth/managed/exchange"]);
    expect(view.getByRole("status").textContent).toBe("Signed in.");
  });

  test("Use another account signs out the selected session and shows an empty form", async () => {
    const view = mountRecovery();
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Use another account" })); });
    expect(providerCalls).toEqual(["sign-out:session-owner", "reset-sign-in", "reset-sign-up"]);
    expect((view.getByLabelText("Email") as HTMLInputElement).value).toBe("");
    expect((view.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect(view.queryByRole("button", { name: "Continue as owner@example.test" })).toBeNull();
    expect(view.getByRole("button", { name: "Continue with Privy" })).toBeDefined();
    expect(requests).toEqual([]);
  });

  test("a failed account switch keeps recovery available and displays the error", async () => {
    signOutFails = true;
    const view = mountRecovery();
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Use another account" })); });
    expect(view.getByRole("alert").textContent).toBe("Could not switch accounts. Try again.");
    expect(view.queryByLabelText("Password")).toBeNull();
    expect(view.getByRole("button", { name: "Use another account" }).hasAttribute("disabled")).toBeFalse();
    expect(providerCalls).toEqual(["sign-out:session-owner"]);
  });

  test("a verified provider identity still needs consent before creating a House account", async () => {
    accountMissing = true;
    const view = mountRecovery();
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Continue as owner@example.test" })); });
    expect(completed).toBeFalse();
    expect(requests).toEqual(["/api/auth/managed/exchange"]);
    expect(view.getByRole("button", { name: "Create account" }).hasAttribute("disabled")).toBeTrue();
    expect(view.getByRole("checkbox").hasAttribute("required")).toBeTrue();
  });

  test("stalled recovery offers reload without starting another operation", async () => {
    getToken = () => new Promise(() => {});
    let expire: (() => void) | undefined;
    const originalSetTimeout = globalThis.setTimeout;
    const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) => {
      if (delay === 30_000) expire = callback;
      return originalSetTimeout(callback, delay);
    }) as typeof setTimeout);
    try {
      const view = mountRecovery();
      await act(async () => { fireEvent.click(view.getByRole("button", { name: "Continue as owner@example.test" })); });
      expect(expire).toBeDefined();
      await act(async () => { expire?.(); });
      expect(view.getByRole("button", { name: "Reload sign-in" }).hasAttribute("disabled")).toBeFalse();
      expect(view.getByRole("alert").textContent).toContain("Reload to try again");
      expect(requests).toEqual([]);
      expect(completed).toBeFalse();
    } finally {
      timer.mockRestore();
    }
  });

  test("a cancelled attempt cannot exchange a late token", async () => {
    let resolve: (token: string) => void = () => {};
    getToken = () => new Promise((done) => { resolve = done; });
    const view = mountRecovery();
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Continue as owner@example.test" })); });
    current = false;
    await act(async () => { resolve("late-token"); });
    expect(requests).toEqual([]);
    expect(completed).toBeFalse();
  });
});
