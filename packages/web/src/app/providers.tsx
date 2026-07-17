"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  RuntimeConfigProvider,
  useRuntimeConfig,
  type PublicRuntimeConfig,
} from "@/lib/runtime-config";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import {
  WagmiProvider as PrivyWagmiProvider,
  createConfig as createPrivyConfig,
} from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mainnet } from "viem/chains";
import { http } from "wagmi";
import {
  loginWithPrivyToken,
  getMe,
  setAuthToken,
  clearAuthToken,
  getAuthToken,
  ApiError,
  type AuthenticatedPublicIdentity,
} from "@/lib/api";
import { isE2EMode } from "@/lib/wallet-adapter";
import { InviteCodeModal } from "@/components/invite-code-modal";
import { StandingDailyAgentPrompt } from "@/components/standing-daily-agent-prompt";
import { AvatarGenerationActivity } from "@/components/avatar-generation-activity";
import { PublicIdentityOnboarding } from "@/components/public-identity-onboarding";
import { containedFocusTargetIndex } from "@/components/standing-daily-agent-prompt-model";
import {
  classifyAuthenticatedIdentityPayload,
  identityDismissalKey,
  identityPromptDecision,
  identitySaveHandoffPublicId,
} from "@/components/public-identity-onboarding-model";

// ---------------------------------------------------------------------------
// Wagmi config (Privy-managed)
// ---------------------------------------------------------------------------

const wagmiConfig = createPrivyConfig({
  chains: [mainnet],
  transports: { [mainnet.id]: http() },
});

const queryClient = new QueryClient();

// ---------------------------------------------------------------------------
// E2E auth context — signals e2e mode to auth gates
// ---------------------------------------------------------------------------

interface E2EAuthState {
  isE2E: boolean;
  authenticated: boolean;
  ready: boolean;
}

const E2EAuthContext = createContext<E2EAuthState>({
  isE2E: false,
  authenticated: false,
  ready: false,
});

export function useE2EAuth(): E2EAuthState {
  return useContext(E2EAuthContext);
}

function subscribeToE2EMode(): () => void {
  return () => {};
}

function useIsE2EMode(): boolean {
  const configured = process.env.NODE_ENV !== "production"
    && process.env.NEXT_PUBLIC_E2E_AUTH === "true";
  return useSyncExternalStore(
    subscribeToE2EMode,
    () => configured || isE2EMode(),
    () => configured,
  );
}

// ---------------------------------------------------------------------------
// Invite code context — prompts new users for invite code
// ---------------------------------------------------------------------------

interface InviteState {
  needsInvite: boolean;
  submitInvite: (code: string) => Promise<void>;
  inviteError: string | null;
  submitting: boolean;
}

const InviteContext = createContext<InviteState>({
  needsInvite: false,
  submitInvite: async () => {},
  inviteError: null,
  submitting: false,
});

export function useInvite(): InviteState {
  return useContext(InviteContext);
}

const PublicIdentityContext = createContext<AuthenticatedPublicIdentity | null>(null);
const IDENTITY_GATE_FOCUSABLE =
  "button:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function useAuthenticatedPublicIdentity(): AuthenticatedPublicIdentity | null {
  return useContext(PublicIdentityContext);
}

type IdentityResolution = "pending" | "available" | "legacy" | "error";

// ---------------------------------------------------------------------------
// AuthSync — production Privy → backend JWT sync (skipped in e2e)
// ---------------------------------------------------------------------------

function AuthSync({ children }: { children: React.ReactNode }) {
  const { authenticated, getAccessToken, logout } = usePrivy();
  const e2e = useE2EAuth();
  const [needsInvite, setNeedsInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingPrivyToken, setPendingPrivyToken] = useState<string | null>(null);
  const [identity, setIdentity] = useState<AuthenticatedPublicIdentity | null>(null);
  const [identityResolution, setIdentityResolution] = useState<IdentityResolution>("pending");
  const [identityRetryNonce, setIdentityRetryNonce] = useState(0);
  const [identityDismissed, setIdentityDismissed] = useState(false);
  const [dailyAgentHandoffPublicId, setDailyAgentHandoffPublicId] =
    useState<string | null>(null);
  const identityPublicIdRef = useRef<string | null>(null);
  const appContentRef = useRef<HTMLDivElement>(null);
  const identityGateRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const signedIn = (e2e.ready && e2e.authenticated) || authenticated;
  const signedInRef = useRef(signedIn);

  useLayoutEffect(() => {
    signedInRef.current = signedIn;
  }, [signedIn]);

  const syncIdentity = useCallback((value: unknown, resolved = value != null) => {
    const payload = resolved
      ? classifyAuthenticatedIdentityPayload(value)
      : { kind: "invalid" as const };
    const next = payload.kind === "current" ? payload.identity : null;
    const previousPublicId = identityPublicIdRef.current;
    const nextPublicId = next?.publicId ?? null;

    if (previousPublicId && previousPublicId !== nextPublicId) {
      sessionStorage.removeItem(identityDismissalKey(previousPublicId));
    }
    if (previousPublicId && nextPublicId && previousPublicId !== nextPublicId) {
      sessionStorage.removeItem(identityDismissalKey(nextPublicId));
    }

    identityPublicIdRef.current = nextPublicId;
    setDailyAgentHandoffPublicId((current) =>
      current !== null && current !== nextPublicId ? null : current);
    setIdentity(next);
    setIdentityResolution(
      !resolved
        ? "pending"
        : payload.kind === "current"
          ? "available"
          : payload.kind === "legacy"
            ? "legacy"
            : "error",
    );
    setIdentityDismissed(nextPublicId
      ? sessionStorage.getItem(identityDismissalKey(nextPublicId)) === "true"
      : false);
  }, []);

  useEffect(() => {
    // In e2e mode, JWT is injected by test harness — skip Privy sync
    if (e2e.isE2E) return;

    if (!authenticated) {
      syncIdentity(null, false);
      clearAuthToken();
      window.dispatchEvent(new CustomEvent("auth:session-cleared"));
      setNeedsInvite(false);
      setPendingPrivyToken(null);
      return;
    }

    let active = true;
    void (async () => {
      let privyToken: string | null = null;
      try {
        privyToken = await getAccessToken();
        if (!active) return;
        if (!privyToken) {
          setIdentityResolution("error");
          return;
        }
        const { token, user } = await loginWithPrivyToken(privyToken);
        if (!active) return;
        syncIdentity(user, true);
        setAuthToken(token);
        setNeedsInvite(false);
        setPendingPrivyToken(null);
      } catch (err) {
        if (
          privyToken
          && err instanceof ApiError
          && err.code === "INVITE_REQUIRED"
        ) {
          if (!active) return;
          setPendingPrivyToken(privyToken);
          setNeedsInvite(true);
          return;
        }
        if (active) setIdentityResolution("error");
        console.error("[AuthSync] Failed to exchange Privy token:", err);
      }
    })();
    return () => {
      active = false;
    };
  }, [
    authenticated,
    getAccessToken,
    e2e.isE2E,
    identityRetryNonce,
    syncIdentity,
  ]);

  useEffect(() => {
    if (!e2e.isE2E) return;
    if (!e2e.authenticated || !getAuthToken()) {
      syncIdentity(null, false);
      return;
    }
    let active = true;
    getMe()
      .then((user) => {
        if (active) syncIdentity(user, true);
      })
      .catch((error) => {
        if (active) {
          setIdentityResolution("error");
          console.warn("[AuthSync] Failed to hydrate E2E session:", error);
        }
      });
    return () => {
      active = false;
    };
  }, [e2e.authenticated, e2e.isE2E, identityRetryNonce, syncIdentity]);

  useEffect(() => {
    function handleIdentityUpdated(event: Event) {
      const identity = (event as CustomEvent<AuthenticatedPublicIdentity>).detail;
      if (identity?.publicId) syncIdentity(identity, true);
    }
    window.addEventListener("auth:identity-updated", handleIdentityUpdated);
    return () => window.removeEventListener("auth:identity-updated", handleIdentityUpdated);
  }, [syncIdentity]);

  const submitInvite = useCallback(async (inviteCode: string) => {
    if (!pendingPrivyToken) return;
    setSubmitting(true);
    setInviteError(null);
    try {
      const { token, user } = await loginWithPrivyToken(pendingPrivyToken, inviteCode);
      syncIdentity(user, true);
      setAuthToken(token);
      setNeedsInvite(false);
      setPendingPrivyToken(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setInviteError(err.message || "Invalid invite code");
      } else {
        setInviteError("Something went wrong. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [pendingPrivyToken, syncIdentity]);

  useEffect(() => {
    if (e2e.isE2E) return;

    const handleExpired = () => {
      console.warn("[AuthSync] Session expired (401). Logging out.");
      logout();
    };
    window.addEventListener("auth:expired", handleExpired);
    return () => window.removeEventListener("auth:expired", handleExpired);
  }, [logout, e2e.isE2E]);

  const inviteState = useMemo<InviteState>(() => ({
    needsInvite,
    submitInvite,
    inviteError,
    submitting,
  }), [needsInvite, submitInvite, inviteError, submitting]);

  const promptDecision = identityPromptDecision({
    signedIn,
    needsInvite,
    identityState: identity?.publicIdentityOnboarding.state ?? null,
    identityResolved: identityResolution === "legacy",
    dismissed: identityDismissed,
  });
  const identityCheckBlocked = signedIn
    && !needsInvite
    && (identityResolution === "pending" || identityResolution === "error");

  useEffect(() => {
    const content = appContentRef.current;
    if (content) content.inert = identityCheckBlocked;
    if (!identityCheckBlocked) return;

    const gate = identityGateRef.current;
    if (!gate) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const focusables = Array.from(
      gate.querySelectorAll<HTMLElement>(IDENTITY_GATE_FOCUSABLE),
    );
    (focusables[0] ?? gate).focus();

    function keepFocusInsideGate(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const items = Array.from(
        gate!.querySelectorAll<HTMLElement>(IDENTITY_GATE_FOCUSABLE),
      );
      if (items.length === 0) {
        event.preventDefault();
        gate!.focus();
        return;
      }
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);
      const nextIndex = containedFocusTargetIndex(
        items.length,
        activeIndex,
        event.shiftKey,
      );
      if (nextIndex !== null) {
        event.preventDefault();
        items[nextIndex]?.focus();
      }
    }

    document.addEventListener("keydown", keepFocusInsideGate);
    return () => {
      document.removeEventListener("keydown", keepFocusInsideGate);
      if (content) content.inert = false;
      previousFocusRef.current?.focus();
    };
  }, [identityCheckBlocked]);

  function dismissIdentityForSession() {
    if (!identity || identity.publicIdentityOnboarding.state !== "deferrable") return;
    sessionStorage.setItem(identityDismissalKey(identity.publicId), "true");
    setIdentityDismissed(true);
  }

  const handleIdentitySaved = useCallback((
    updatedIdentity: AuthenticatedPublicIdentity,
  ) => {
    const handoffPublicId = identitySaveHandoffPublicId({
      signedIn: signedInRef.current,
      currentPublicId: identityPublicIdRef.current,
      savedPublicId: updatedIdentity.publicId,
    });
    if (handoffPublicId === null) return;
    setDailyAgentHandoffPublicId(handoffPublicId);
    syncIdentity(updatedIdentity, true);
  }, [syncIdentity]);

  const consumeDailyAgentHandoff = useCallback((publicId: string) => {
    setDailyAgentHandoffPublicId((current) =>
      current === publicId ? null : current);
  }, []);

  const activeDailyAgentHandoffPublicId =
    dailyAgentHandoffPublicId === identity?.publicId
      ? dailyAgentHandoffPublicId
      : null;

  return (
    <InviteContext.Provider value={inviteState}>
      <PublicIdentityContext.Provider value={identity}>
        <div ref={appContentRef} className="contents">
          {children}
        </div>
        <InviteCodeModal />
        {identityCheckBlocked && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4">
            <div
              ref={identityGateRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="identity-check-title"
              tabIndex={-1}
              className="influence-panel w-full max-w-md rounded-2xl p-6 text-center shadow-2xl"
            >
              <p className="influence-section-title">Your public profile</p>
              <h2
                id="identity-check-title"
                className="mt-2 text-xl font-bold text-text-primary"
              >
                {identityResolution === "error"
                  ? "We could not check your profile"
                  : "Checking your profile…"}
              </h2>
              {identityResolution === "error" && (
                <>
                  <p className="influence-copy mt-2 text-sm">
                    Retry before continuing to your dashboard.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setIdentityResolution("pending");
                      setIdentityRetryNonce((current) => current + 1);
                    }}
                    className="influence-button-primary mt-5 min-h-11 rounded-lg px-5 py-2.5 text-sm font-semibold"
                  >
                    Retry profile check
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {(promptDecision === "identity-required" || promptDecision === "identity-deferrable") && identity && (
          <PublicIdentityOnboarding
            identity={identity}
            onSaved={handleIdentitySaved}
            onDismiss={dismissIdentityForSession}
          />
        )}
        {promptDecision === "downstream" && (
          <StandingDailyAgentPrompt
            key={identity?.publicId ?? "legacy"}
            immediateHandoffPublicId={activeDailyAgentHandoffPublicId}
            onImmediateHandoffConsumed={consumeDailyAgentHandoff}
          />
        )}
        <AvatarGenerationActivity />
      </PublicIdentityContext.Provider>
    </InviteContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

// Dummy Privy app ID for e2e mode (Privy SDK requires a non-empty string)
const E2E_PRIVY_APP_ID = "e2e-test-privy-app-id-001";

export function Providers({
  children,
  initialRuntimeConfig,
}: {
  children: React.ReactNode;
  initialRuntimeConfig?: PublicRuntimeConfig;
}) {
  return (
    <RuntimeConfigProvider initialConfig={initialRuntimeConfig}>
      <InnerProviders>{children}</InnerProviders>
    </RuntimeConfigProvider>
  );
}

function InnerProviders({ children }: { children: React.ReactNode }) {
  const runtimeConfig = useRuntimeConfig();
  const e2e = useIsE2EMode();

  const privyAppId = e2e
    ? E2E_PRIVY_APP_ID
    : runtimeConfig.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  const e2eAuth = useMemo<E2EAuthState>(() => {
    if (!e2e) return { isE2E: false, authenticated: false, ready: false };
    const hasToken =
      typeof window !== "undefined" && !!getAuthToken();
    return { isE2E: true, authenticated: hasToken, ready: true };
  }, [e2e]);

  if (!privyAppId) {
    throw new Error("PRIVY_APP_ID is not set (check runtime env or NEXT_PUBLIC_PRIVY_APP_ID)");
  }

  return (
    <E2EAuthContext.Provider value={e2eAuth}>
      <PrivyProvider
        key={privyAppId}
        appId={privyAppId}
        config={{
          loginMethods: ["email", "wallet"],
          appearance: {
            theme: "dark",
            accentColor: "#6366f1",
          },
          embeddedWallets: {
            ethereum: { createOnLogin: "users-without-wallets" },
          },
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PrivyWagmiProvider config={wagmiConfig}>
            <AuthSync>
              {children}
            </AuthSync>
          </PrivyWagmiProvider>
        </QueryClientProvider>
      </PrivyProvider>
    </E2EAuthContext.Provider>
  );
}
