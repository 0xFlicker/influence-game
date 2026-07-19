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
import { ClerkProvider, useClerk } from "@clerk/nextjs";
import { AuthenticationWrapper } from "@/components/authentication-wrapper";
import {
  RuntimeConfigProvider,
  useRuntimeConfig,
  type PublicRuntimeConfig,
} from "@/lib/runtime-config";
import { PrivyProvider } from "@privy-io/react-auth";
import {
  WagmiProvider as PrivyWagmiProvider,
  createConfig as createPrivyConfig,
} from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mainnet } from "viem/chains";
import { http } from "wagmi";
import {
  getAuthToken,
  type AuthenticatedPublicIdentity,
} from "@/lib/api";
import { InfluenceAuthProvider, useAuth } from "@/hooks/use-auth";
import { isE2EMode } from "@/lib/wallet-adapter";
import { InviteCodeModal } from "@/components/invite-code-modal";
import { StandingDailyAgentPrompt } from "@/components/standing-daily-agent-prompt";
import { AvatarGenerationActivity } from "@/components/avatar-generation-activity";
import { PublicIdentityOnboarding } from "@/components/public-identity-onboarding";
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

export function useAuthenticatedPublicIdentity(): AuthenticatedPublicIdentity | null {
  return useContext(PublicIdentityContext);
}

type IdentityResolution = "pending" | "available" | "legacy" | "error";

// ---------------------------------------------------------------------------
// AuthExperience — Influence-session-owned onboarding and downstream prompts
// ---------------------------------------------------------------------------

function AuthExperience({ children }: { children: React.ReactNode }) {
  const {
    authenticated,
    account,
    needsInvite,
    submitInvite,
    inviteError,
    submittingInvite,
  } = useAuth();
  const [identity, setIdentity] = useState<AuthenticatedPublicIdentity | null>(null);
  const [identityResolution, setIdentityResolution] = useState<IdentityResolution>("pending");
  const [identityDismissed, setIdentityDismissed] = useState(false);
  const [dailyAgentHandoffPublicId, setDailyAgentHandoffPublicId] =
    useState<string | null>(null);
  const identityPublicIdRef = useRef<string | null>(null);
  const signedIn = authenticated;
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
    if (!authenticated) {
      syncIdentity(null, false);
      return;
    }
    if (account) syncIdentity(account, true);
  }, [account, authenticated, syncIdentity]);

  useEffect(() => {
    function handleIdentityUpdated(event: Event) {
      const identity = (event as CustomEvent<AuthenticatedPublicIdentity>).detail;
      if (identity?.publicId) syncIdentity(identity, true);
    }
    window.addEventListener("auth:identity-updated", handleIdentityUpdated);
    return () => window.removeEventListener("auth:identity-updated", handleIdentityUpdated);
  }, [syncIdentity]);

  const inviteState = useMemo<InviteState>(() => ({
    needsInvite,
    submitInvite,
    inviteError,
    submitting: submittingInvite,
  }), [needsInvite, submitInvite, inviteError, submittingInvite]);

  const promptDecision = identityPromptDecision({
    signedIn,
    needsInvite,
    identityState: identity?.publicIdentityOnboarding.state ?? null,
    identityResolved: identityResolution === "legacy",
    dismissed: identityDismissed,
  });

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
        <div className="contents">
          {children}
        </div>
        <InviteCodeModal />
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

function ClerkInfluenceAuth({
  children,
  managedAuthMode,
}: {
  children: React.ReactNode;
  managedAuthMode: "existing-only" | "full";
}) {
  const clerk = useClerk();
  const clerkLogout = useCallback(async () => {
    await clerk.signOut();
  }, [clerk]);
  return (
    <InfluenceAuthProvider clerkLogout={clerkLogout} managedAuthEnabled>
      <AuthExperience>{children}</AuthExperience>
      <AuthenticationWrapper managedAuthMode={managedAuthMode} />
    </InfluenceAuthProvider>
  );
}

function InfluenceAuthLayer({
  children,
  managedAuthMode,
  clerkPublishableKey,
}: {
  children: React.ReactNode;
  managedAuthMode: PublicRuntimeConfig["MANAGED_AUTH_MODE"];
  clerkPublishableKey: string;
}) {
  if (managedAuthMode === "disabled") {
    return (
      <InfluenceAuthProvider>
        <AuthExperience>{children}</AuthExperience>
      </InfluenceAuthProvider>
    );
  }
  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <ClerkInfluenceAuth managedAuthMode={managedAuthMode}>
        {children}
      </ClerkInfluenceAuth>
    </ClerkProvider>
  );
}

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
            <InfluenceAuthLayer
              managedAuthMode={runtimeConfig.MANAGED_AUTH_MODE}
              clerkPublishableKey={runtimeConfig.CLERK_PUBLISHABLE_KEY}
            >
              {children}
            </InfluenceAuthLayer>
          </PrivyWagmiProvider>
        </QueryClientProvider>
      </PrivyProvider>
    </E2EAuthContext.Provider>
  );
}
