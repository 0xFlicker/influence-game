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

beforeEach(() => {
  dom = new Window({ url: "http://localhost/games" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.navigator });
  requests = [];
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

function mountRecovery(newSignup = false, passwordErrorCode = "session_exists") {
  const session = {
    status: "active",
    user: { primaryEmailAddress: { emailAddress: "owner@example.test", verification: { status: "verified" } } },
    getToken: () => getToken(),
  };
  const signInSnapshot = {
    signIn: { password: async () => ({ error: new ClerkAPIResponseError("Provider rejected request", {
      status: 400, data: [{ code: passwordErrorCode, message: "Provider rejected request" }],
    }) }) },
    errors: { fields: {} }, fetchStatus: "idle",
  };
  // A completed signup must not force account creation before the API resolves identity.
  const signUp = {
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
    session: newSignup ? null : session,
    addListener: () => () => {},
    __internal_lastEmittedResources: { session: newSignup ? null : session },
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
    const view = mountRecovery();
    await act(async () => { fireEvent.submit(view.getByRole("button", { name: "Sign in with email" }).closest("form")!); });
    expect(completed).toBeTrue();
    expect(requests).toEqual(["/api/auth/managed/exchange"]);
  });

  test("a non-field password error clears the progress text and restores submission", async () => {
    const view = mountRecovery(false, "rate_limit_exceeded");
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
    expect(requests).toEqual([]);
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "Continue as owner@example.test" })); });
    expect(completed).toBeTrue();
    expect(requests).toEqual(["/api/auth/managed/exchange"]);
    expect(view.getByRole("status").textContent).toBe("Signed in.");
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
      expect(view.getByRole("alert").textContent).toContain("haven’t received confirmation");
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
