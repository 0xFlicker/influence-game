"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import {
  ApiError,
  clearAuthToken,
  getAuthToken,
  getMe,
  loginWithPrivyToken,
  storeAuthToken,
  type AuthMe,
} from "@/lib/api";
import {
  InfluenceSessionCoordinator,
  ProviderAuthenticationSettlement,
  type AuthSessionEvent,
  type AuthSessionPersistence,
  type AuthSessionRemoteMessage,
  type AuthSessionTransport,
  type ProviderAuthenticationAttempt,
} from "@/lib/auth-session-coordinator";
import { isLayeredAuthE2EAdapterEnabled } from "@/lib/e2e-layered-auth";
import { currentPrivyProof } from "@/lib/privy-proof";

const AUTH_GENERATION_KEY = "influence_auth_generation";
const AUTH_BROADCAST_KEY = "influence_auth_broadcast";
const AUTH_CHANNEL = "influence_auth";

type SessionAccountInput = Omit<AuthMe, "isAdmin"> | AuthMe;

declare global {
  interface Window {
    __INFLUENCE_E2E_AUTH__?: {
      privyToken?: string | null;
      walletProofToken?: string | null;
    };
  }
}

export interface InfluenceSessionResponse {
  token: string;
  user: SessionAccountInput;
}

export type PrivyAuthenticationOutcome =
  | { kind: "completed" }
  | { kind: "cancelled" }
  | { kind: "link_required"; token: string };

export interface InfluenceAuthState {
  ready: boolean;
  authenticated: boolean;
  account: AuthMe | null;
  hydrationError: boolean;
  openSignIn: () => void;
  openCreateAccount: () => void;
  openPrivySignIn: (
    onSettled?: (outcome: PrivyAuthenticationOutcome) => void,
  ) => void;
  requestPrivyProof: () => Promise<string | null>;
  beginAuthenticationAttempt: () => ProviderAuthenticationAttempt;
  cancelAuthenticationAttempt: () => void;
  completeAuthenticationAttempt: (
    attempt: ProviderAuthenticationAttempt,
    exchange: () => Promise<InfluenceSessionResponse>,
  ) => Promise<boolean>;
  logout: () => Promise<void>;
  needsInvite: boolean;
  dismissInvite: () => void;
  submitInvite: (code: string) => Promise<void>;
  inviteError: string | null;
  submittingInvite: boolean;
}

export const InfluenceAuthContext =
  createContext<InfluenceAuthState | null>(null);

function normalizeSessionAccount(user: SessionAccountInput): AuthMe {
  if ("isAdmin" in user) return user;
  return {
    ...user,
    isAdmin:
      user.roles.includes("sysop")
      || user.roles.includes("admin")
      || user.permissions.includes("view_admin"),
  };
}

function createGeneration(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createBrowserPersistence(): AuthSessionPersistence {
  return {
    getToken: getAuthToken,
    setToken: storeAuthToken,
    clearToken: clearAuthToken,
    getGeneration: () => {
      if (typeof window === "undefined") return "initial";
      return localStorage.getItem(AUTH_GENERATION_KEY) ?? "initial";
    },
    setGeneration: (generation) => {
      if (typeof window === "undefined") return;
      localStorage.setItem(AUTH_GENERATION_KEY, generation);
    },
  };
}

function parseRemoteMessage(value: unknown): AuthSessionRemoteMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Partial<AuthSessionRemoteMessage>;
  if (
    typeof message.generation !== "string"
    || typeof message.sourceId !== "string"
    || (
      message.transition !== "attempt"
      && message.transition !== "logout"
      && message.transition !== "expired"
    )
  ) {
    return null;
  }
  return message as AuthSessionRemoteMessage;
}

function createBrowserTransport(): AuthSessionTransport {
  let channel: BroadcastChannel | null = null;
  function ensureChannel(): BroadcastChannel | null {
    if (
      !channel
      && typeof window !== "undefined"
      && "BroadcastChannel" in window
    ) {
      channel = new BroadcastChannel(AUTH_CHANNEL);
    }
    return channel;
  }

  return {
    publish(message) {
      if (typeof window === "undefined") return;
      ensureChannel()?.postMessage(message);
      localStorage.setItem(AUTH_BROADCAST_KEY, JSON.stringify(message));
    },
    subscribe(listener) {
      if (typeof window === "undefined") return () => {};
      const subscribedChannel = ensureChannel();
      const onChannelMessage = (event: MessageEvent<unknown>) => {
        const message = parseRemoteMessage(event.data);
        if (message) listener(message);
      };
      const onStorage = (event: StorageEvent) => {
        if (event.key !== AUTH_BROADCAST_KEY || !event.newValue) return;
        try {
          const message = parseRemoteMessage(JSON.parse(event.newValue));
          if (message) listener(message);
        } catch {
          // Ignore unrelated or malformed cross-tab storage values.
        }
      };
      subscribedChannel?.addEventListener("message", onChannelMessage);
      window.addEventListener("storage", onStorage);
      return () => {
        subscribedChannel?.removeEventListener("message", onChannelMessage);
        subscribedChannel?.close();
        if (channel === subscribedChannel) channel = null;
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

function emitAuthEvent(event: AuthSessionEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(event, {
      detail: event === "auth:expired" ? { coordinated: true } : undefined,
    }),
  );
}

export function InfluenceAuthProvider({
  children,
  clerkLogout,
  managedAuthEnabled = false,
}: {
  children: React.ReactNode;
  clerkLogout?: () => Promise<unknown>;
  managedAuthEnabled?: boolean;
}) {
  const { getAccessToken, logout: privyLogout } = usePrivy();
  const privyLogoutRef = useRef(privyLogout);
  const clerkLogoutRef = useRef(clerkLogout);
  privyLogoutRef.current = privyLogout;
  clerkLogoutRef.current = clerkLogout;

  const [coordinator] = useState(() =>
    new InfluenceSessionCoordinator<AuthMe>({
      persistence: createBrowserPersistence(),
      transport: createBrowserTransport(),
      hydrate: getMe,
      providerLogouts: [
        async () => {
          if (isLayeredAuthE2EAdapterEnabled()) return;
          await privyLogoutRef.current();
        },
        async () => {
          await clerkLogoutRef.current?.();
        },
      ],
      emit: emitAuthEvent,
      createGeneration,
    }));
  const [snapshot, setSnapshot] = useState(coordinator.getSnapshot);
  const pendingPrivyAttempt = useRef<ProviderAuthenticationAttempt | null>(null);
  const pendingPrivyToken = useRef<string | null>(null);
  const pendingPrivyPurpose = useRef<"authentication" | "proof" | null>(null);
  const pendingPrivyProofResolution = useRef<
    ((token: string | null) => void) | null
  >(null);
  const [privyAuthenticationSettlement] = useState(
    () => new ProviderAuthenticationSettlement<PrivyAuthenticationOutcome>({
      kind: "cancelled",
    }),
  );
  const [needsInvite, setNeedsInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [submittingInvite, setSubmittingInvite] = useState(false);

  const completeAuthenticationAttempt = useCallback(async (
    attempt: ProviderAuthenticationAttempt,
    exchange: () => Promise<InfluenceSessionResponse>,
  ) => coordinator.completeProviderAttempt(attempt, async () => {
    const result = await exchange();
    return {
      token: result.token,
      account: normalizeSessionAccount(result.user),
    };
  }), [coordinator]);

  const completePrivyLoginRef = useRef<() => Promise<void>>(async () => {});
  const { login: openPrivyLogin } = useLogin({
    onComplete: () => {
      void completePrivyLoginRef.current();
    },
    onError: () => {
      const wasProofRequest = pendingPrivyPurpose.current === "proof";
      pendingPrivyProofResolution.current?.(null);
      pendingPrivyProofResolution.current = null;
      pendingPrivyPurpose.current = null;
      pendingPrivyAttempt.current = null;
      pendingPrivyToken.current = null;
      if (!wasProofRequest) {
        coordinator.cancelProviderAttempt();
        privyAuthenticationSettlement.settle({ kind: "cancelled" });
      }
    },
  });

  const completePrivyAttempt = useCallback(async (
    existingProviderToken?: string | null,
  ) => {
    if (pendingPrivyPurpose.current === "proof") {
      const resolveProof = pendingPrivyProofResolution.current;
      let providerToken: string | null = null;
      try {
        providerToken = await getAccessToken();
      } catch (error) {
        console.error("[InfluenceAuth] Privy proof retrieval failed:", error);
      }
      if (
        pendingPrivyProofResolution.current !== resolveProof
        || pendingPrivyPurpose.current !== "proof"
      ) {
        return;
      }
      pendingPrivyProofResolution.current = null;
      pendingPrivyPurpose.current = null;
      resolveProof?.(providerToken);
      return;
    }
    const attempt = pendingPrivyAttempt.current;
    if (!attempt) return;
    const providerToken = existingProviderToken ?? await getAccessToken();
    const isCurrentAuthenticationAttempt = () => (
      pendingPrivyAttempt.current === attempt
      && pendingPrivyPurpose.current === "authentication"
    );
    if (!isCurrentAuthenticationAttempt()) return;
    if (!providerToken) {
      pendingPrivyAttempt.current = null;
      pendingPrivyPurpose.current = null;
      coordinator.cancelProviderAttempt();
      privyAuthenticationSettlement.settle({ kind: "cancelled" });
      return;
    }
    try {
      const completed = await completeAuthenticationAttempt(
        attempt,
        () => loginWithPrivyToken(providerToken),
      );
      if (!isCurrentAuthenticationAttempt()) return;
      if (completed) {
        setNeedsInvite(false);
        setInviteError(null);
      }
      pendingPrivyAttempt.current = null;
      pendingPrivyToken.current = null;
      pendingPrivyPurpose.current = null;
      privyAuthenticationSettlement.settle({
        kind: completed ? "completed" : "cancelled",
      });
    } catch (error) {
      if (!isCurrentAuthenticationAttempt()) return;
      if (error instanceof ApiError && error.code === "INVITE_REQUIRED") {
        pendingPrivyToken.current = providerToken;
        setNeedsInvite(true);
        return;
      }
      if (error instanceof ApiError && error.code === "ACCOUNT_LINK_REQUIRED") {
        pendingPrivyAttempt.current = null;
        pendingPrivyToken.current = null;
        pendingPrivyPurpose.current = null;
        coordinator.cancelProviderAttempt();
        privyAuthenticationSettlement.settle({
          kind: "link_required",
          token: providerToken,
        });
        return;
      }
      pendingPrivyAttempt.current = null;
      pendingPrivyToken.current = null;
      pendingPrivyPurpose.current = null;
      coordinator.cancelProviderAttempt();
      privyAuthenticationSettlement.settle({ kind: "cancelled" });
      console.error("[InfluenceAuth] Privy exchange failed:", error);
    }
  }, [
    completeAuthenticationAttempt,
    coordinator,
    getAccessToken,
    privyAuthenticationSettlement,
  ]);
  completePrivyLoginRef.current = completePrivyAttempt;

  useEffect(() => {
    coordinator.start();
    const unsubscribe = coordinator.subscribe(() => {
      setSnapshot(coordinator.getSnapshot());
    });
    void coordinator.bootstrap();

    const handleExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ coordinated?: boolean }>).detail;
      if (detail?.coordinated) return;
      void coordinator.expire();
    };
    const handleSessionReady = () => {
      if (
        !coordinator.getSnapshot().authenticated
        && getAuthToken()
      ) {
        void coordinator.bootstrap();
      }
    };
    window.addEventListener("auth:expired", handleExpired);
    window.addEventListener("auth:session-ready", handleSessionReady);
    return () => {
      window.removeEventListener("auth:expired", handleExpired);
      window.removeEventListener("auth:session-ready", handleSessionReady);
      unsubscribe();
      coordinator.destroy();
    };
  }, [coordinator]);

  const beginAuthenticationAttempt = useCallback(
    () => coordinator.beginProviderAttempt(),
    [coordinator],
  );

  const cancelAuthenticationAttempt = useCallback(() => {
    pendingPrivyProofResolution.current?.(null);
    pendingPrivyProofResolution.current = null;
    pendingPrivyPurpose.current = null;
    pendingPrivyAttempt.current = null;
    pendingPrivyToken.current = null;
    coordinator.cancelProviderAttempt();
    privyAuthenticationSettlement.settle({ kind: "cancelled" });
  }, [coordinator, privyAuthenticationSettlement]);

  const openPrivySignIn = useCallback((
    onSettled?: (outcome: PrivyAuthenticationOutcome) => void,
  ) => {
    privyAuthenticationSettlement.begin(onSettled);
    pendingPrivyProofResolution.current?.(null);
    pendingPrivyProofResolution.current = null;
    pendingPrivyPurpose.current = "authentication";
    pendingPrivyAttempt.current = coordinator.beginProviderAttempt();
    pendingPrivyToken.current = null;
    setNeedsInvite(false);
    setInviteError(null);
    const attempt = pendingPrivyAttempt.current;
    if (isLayeredAuthE2EAdapterEnabled()) {
      const providerToken = window.__INFLUENCE_E2E_AUTH__?.privyToken ?? null;
      void Promise.resolve().then(async () => {
        if (!attempt || !providerToken) {
          if (
            pendingPrivyAttempt.current !== attempt
            || pendingPrivyPurpose.current !== "authentication"
          ) {
            return;
          }
          pendingPrivyAttempt.current = null;
          pendingPrivyPurpose.current = null;
          coordinator.cancelProviderAttempt();
          privyAuthenticationSettlement.settle({ kind: "cancelled" });
          return;
        }
        try {
          const completed = await completeAuthenticationAttempt(
            attempt,
            () => loginWithPrivyToken(providerToken),
          );
          if (
            pendingPrivyAttempt.current !== attempt
            || pendingPrivyPurpose.current !== "authentication"
          ) {
            return;
          }
          pendingPrivyAttempt.current = null;
          pendingPrivyPurpose.current = null;
          privyAuthenticationSettlement.settle({
            kind: completed ? "completed" : "cancelled",
          });
        } catch (error) {
          if (
            pendingPrivyAttempt.current !== attempt
            || pendingPrivyPurpose.current !== "authentication"
          ) {
            return;
          }
          pendingPrivyAttempt.current = null;
          pendingPrivyPurpose.current = null;
          coordinator.cancelProviderAttempt();
          if (
            error instanceof ApiError
            && error.code === "ACCOUNT_LINK_REQUIRED"
          ) {
            privyAuthenticationSettlement.settle({
              kind: "link_required",
              token: providerToken,
            });
            return;
          }
          privyAuthenticationSettlement.settle({ kind: "cancelled" });
        }
      });
      return;
    }
    void currentPrivyProof(getAccessToken).then((providerToken) => {
      if (
        pendingPrivyAttempt.current !== attempt
        || pendingPrivyPurpose.current !== "authentication"
      ) {
        return;
      }
      if (providerToken) {
        void completePrivyAttempt(providerToken);
        return;
      }
      openPrivyLogin();
    });
  }, [
    completeAuthenticationAttempt,
    completePrivyAttempt,
    coordinator,
    getAccessToken,
    openPrivyLogin,
    privyAuthenticationSettlement,
  ]);

  const requestPrivyProof = useCallback(() => {
    if (isLayeredAuthE2EAdapterEnabled()) {
      return Promise.resolve(
        window.__INFLUENCE_E2E_AUTH__?.walletProofToken ?? null,
      );
    }
    pendingPrivyProofResolution.current?.(null);
    pendingPrivyPurpose.current = "proof";
    pendingPrivyAttempt.current = null;
    pendingPrivyToken.current = null;
    return new Promise<string | null>((resolve) => {
      pendingPrivyProofResolution.current = resolve;
      void currentPrivyProof(getAccessToken).then((providerToken) => {
        if (
          pendingPrivyProofResolution.current !== resolve
          || pendingPrivyPurpose.current !== "proof"
        ) {
          return;
        }
        if (providerToken) {
          pendingPrivyProofResolution.current = null;
          pendingPrivyPurpose.current = null;
          resolve(providerToken);
          return;
        }
        try {
          openPrivyLogin();
        } catch {
          pendingPrivyProofResolution.current = null;
          pendingPrivyPurpose.current = null;
          resolve(null);
        }
      });
    });
  }, [getAccessToken, openPrivyLogin]);

  const openSignIn = useCallback(() => {
    if (!managedAuthEnabled) {
      openPrivySignIn();
      return;
    }
    window.dispatchEvent(new CustomEvent("auth:open-sign-in"));
  }, [managedAuthEnabled, openPrivySignIn]);

  const openCreateAccount = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("auth:open-create-account"));
    }
  }, []);

  const logout = useCallback(async () => {
    pendingPrivyProofResolution.current?.(null);
    pendingPrivyProofResolution.current = null;
    pendingPrivyPurpose.current = null;
    pendingPrivyAttempt.current = null;
    pendingPrivyToken.current = null;
    privyAuthenticationSettlement.settle({ kind: "cancelled" });
    setNeedsInvite(false);
    setInviteError(null);
    setSubmittingInvite(false);
    await coordinator.logout();
  }, [coordinator, privyAuthenticationSettlement]);

  const dismissInvite = useCallback(() => {
    pendingPrivyAttempt.current = null;
    pendingPrivyToken.current = null;
    pendingPrivyPurpose.current = null;
    coordinator.cancelProviderAttempt();
    privyAuthenticationSettlement.settle({ kind: "cancelled" });
    setNeedsInvite(false);
    setInviteError(null);
    setSubmittingInvite(false);
  }, [coordinator, privyAuthenticationSettlement]);

  const submitInvite = useCallback(async (code: string) => {
    const attempt = pendingPrivyAttempt.current;
    const providerToken = pendingPrivyToken.current;
    if (!attempt || !providerToken) return;
    const isCurrentInviteAttempt = () => (
      pendingPrivyAttempt.current === attempt
      && pendingPrivyToken.current === providerToken
      && pendingPrivyPurpose.current === "authentication"
    );
    setSubmittingInvite(true);
    setInviteError(null);
    try {
      const completed = await completeAuthenticationAttempt(
        attempt,
        () => loginWithPrivyToken(providerToken, code),
      );
      if (!isCurrentInviteAttempt()) return;
      if (completed) {
        setNeedsInvite(false);
        pendingPrivyAttempt.current = null;
        pendingPrivyToken.current = null;
        pendingPrivyPurpose.current = null;
        privyAuthenticationSettlement.settle({ kind: "completed" });
      }
    } catch (error) {
      if (!isCurrentInviteAttempt()) return;
      if (
        error instanceof ApiError
        && error.code === "ACCOUNT_LINK_REQUIRED"
        && providerToken
      ) {
        setNeedsInvite(false);
        pendingPrivyAttempt.current = null;
        pendingPrivyToken.current = null;
        pendingPrivyPurpose.current = null;
        coordinator.cancelProviderAttempt();
        privyAuthenticationSettlement.settle({
          kind: "link_required",
          token: providerToken,
        });
        return;
      }
      setInviteError(
        error instanceof ApiError
          ? error.message || "Invalid invite code"
          : "Something went wrong. Try again.",
      );
    } finally {
      if (isCurrentInviteAttempt()) setSubmittingInvite(false);
    }
  }, [
    completeAuthenticationAttempt,
    coordinator,
    privyAuthenticationSettlement,
  ]);

  return createElement(
    InfluenceAuthContext.Provider,
    {
      value: {
        ...snapshot,
        openSignIn,
        openCreateAccount,
        openPrivySignIn,
        requestPrivyProof,
        beginAuthenticationAttempt,
        cancelAuthenticationAttempt,
        completeAuthenticationAttempt,
        logout,
        needsInvite,
        dismissInvite,
        submitInvite,
        inviteError,
        submittingInvite,
      },
    },
    children,
  );
}

export function useAuth(): InfluenceAuthState {
  const context = useContext(InfluenceAuthContext);
  if (!context) {
    throw new Error("useAuth must be used within InfluenceAuthProvider");
  }
  return context;
}

export { AUTH_GENERATION_KEY };
