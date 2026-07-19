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
  type AuthSessionPersistence,
  type AuthSessionRemoteMessage,
  type AuthSessionTransport,
  type ProviderAuthenticationAttempt,
} from "@/lib/auth-session-coordinator";

const AUTH_GENERATION_KEY = "influence_auth_generation";
const AUTH_BROADCAST_KEY = "influence_auth_broadcast";
const AUTH_CHANNEL = "influence_auth";

type SessionAccountInput = Omit<AuthMe, "isAdmin"> | AuthMe;

export interface InfluenceSessionResponse {
  token: string;
  user: SessionAccountInput;
}

export interface InfluenceAuthState {
  ready: boolean;
  authenticated: boolean;
  account: AuthMe | null;
  hydrationError: boolean;
  openSignIn: () => void;
  openCreateAccount: () => void;
  openPrivySignIn: () => void;
  requestPrivyProof: () => Promise<string | null>;
  beginAuthenticationAttempt: () => ProviderAuthenticationAttempt;
  cancelAuthenticationAttempt: () => void;
  completeAuthenticationAttempt: (
    attempt: ProviderAuthenticationAttempt,
    exchange: () => Promise<InfluenceSessionResponse>,
  ) => Promise<boolean>;
  logout: () => Promise<void>;
  needsInvite: boolean;
  submitInvite: (code: string) => Promise<void>;
  inviteError: string | null;
  submittingInvite: boolean;
}

const InfluenceAuthContext = createContext<InfluenceAuthState | null>(null);

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

function emitAuthEvent(event: string): void {
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
      if (!wasProofRequest) coordinator.cancelProviderAttempt();
    },
  });

  const completePrivyAttempt = useCallback(async () => {
    if (pendingPrivyPurpose.current === "proof") {
      const resolveProof = pendingPrivyProofResolution.current;
      let providerToken: string | null = null;
      try {
        providerToken = await getAccessToken();
      } catch (error) {
        console.error("[InfluenceAuth] Privy proof retrieval failed:", error);
      }
      pendingPrivyProofResolution.current = null;
      pendingPrivyPurpose.current = null;
      resolveProof?.(providerToken);
      return;
    }
    const attempt = pendingPrivyAttempt.current;
    if (!attempt) return;
    const providerToken = await getAccessToken();
    if (!providerToken) {
      pendingPrivyAttempt.current = null;
      pendingPrivyPurpose.current = null;
      coordinator.cancelProviderAttempt();
      return;
    }
    try {
      const completed = await completeAuthenticationAttempt(
        attempt,
        () => loginWithPrivyToken(providerToken),
      );
      if (completed) {
        setNeedsInvite(false);
        setInviteError(null);
      }
      pendingPrivyAttempt.current = null;
      pendingPrivyToken.current = null;
      pendingPrivyPurpose.current = null;
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVITE_REQUIRED") {
        pendingPrivyToken.current = providerToken;
        setNeedsInvite(true);
        return;
      }
      pendingPrivyAttempt.current = null;
      pendingPrivyToken.current = null;
      pendingPrivyPurpose.current = null;
      coordinator.cancelProviderAttempt();
      console.error("[InfluenceAuth] Privy exchange failed:", error);
    }
  }, [completeAuthenticationAttempt, coordinator, getAccessToken]);
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
  }, [coordinator]);

  const openPrivySignIn = useCallback(() => {
    pendingPrivyProofResolution.current?.(null);
    pendingPrivyProofResolution.current = null;
    pendingPrivyPurpose.current = "authentication";
    pendingPrivyAttempt.current = coordinator.beginProviderAttempt();
    pendingPrivyToken.current = null;
    setNeedsInvite(false);
    setInviteError(null);
    openPrivyLogin();
  }, [coordinator, openPrivyLogin]);

  const requestPrivyProof = useCallback(() => {
    pendingPrivyProofResolution.current?.(null);
    pendingPrivyPurpose.current = "proof";
    pendingPrivyAttempt.current = null;
    pendingPrivyToken.current = null;
    return new Promise<string | null>((resolve) => {
      pendingPrivyProofResolution.current = resolve;
      openPrivyLogin();
    });
  }, [openPrivyLogin]);

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
    setNeedsInvite(false);
    setInviteError(null);
    await coordinator.logout();
  }, [coordinator]);

  const submitInvite = useCallback(async (code: string) => {
    const attempt = pendingPrivyAttempt.current;
    const providerToken = pendingPrivyToken.current;
    if (!attempt || !providerToken) return;
    setSubmittingInvite(true);
    setInviteError(null);
    try {
      const completed = await completeAuthenticationAttempt(
        attempt,
        () => loginWithPrivyToken(providerToken, code),
      );
      if (completed) {
        setNeedsInvite(false);
        pendingPrivyAttempt.current = null;
        pendingPrivyToken.current = null;
        pendingPrivyPurpose.current = null;
      }
    } catch (error) {
      setInviteError(
        error instanceof ApiError
          ? error.message || "Invalid invite code"
          : "Something went wrong. Try again.",
      );
    } finally {
      setSubmittingInvite(false);
    }
  }, [completeAuthenticationAttempt]);

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
